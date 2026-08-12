const { onCall } = require("firebase-functions/v2/https");
const { onCreate } = require("firebase-functions/v2/identity");
const admin = require("firebase-admin");

admin.initializeApp();

// ============================================
// HELPER: WAKTU ASIA/JAKARTA (WIB)
// ============================================
function getJakartaTime() {
    const now = new Date();
    // Konversi ke WIB (UTC+7)
    const wibOffset = 7 * 60 * 60 * 1000; // 7 jam dalam ms
    const wibTime = new Date(now.getTime() + wibOffset);
    return wibTime;
}

function formatTanggalWIB(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatJamWIB(date) {
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// ============================================
// HELPERS: DETERMINE STATUS
// ============================================
function determineStatus(jamWIB, schoolStartTime, lateThreshold) {
    // schoolStartTime: "07:00", lateThreshold: 5
    const [startHour, startMinute] = schoolStartTime.split(':').map(Number);
    const [jamHour, jamMinute] = jamWIB.split(':').map(Number);
    
    const startTotalMinutes = startHour * 60 + startMinute;
    const jamTotalMinutes = jamHour * 60 + jamMinute;
    
    // Batas toleransi: start + lateThreshold
    const thresholdTotalMinutes = startTotalMinutes + lateThreshold;
    
    if (jamTotalMinutes <= thresholdTotalMinutes) {
        return 'HADIR';
    } else {
        return 'TERLAMBAT';
    }
}

// ============================================
// 1. createUserProfile (Auth Trigger)
// ============================================
exports.createUserProfile = onCreate(async (user) => {
    const { uid, email, displayName, photoURL } = user;
    
    console.log(`[createUserProfile] Membuat profil untuk UID: ${uid}`);
    
    const userData = {
        nama: displayName || null,
        nis: null,
        email: email || null,
        photoURL: photoURL || null,
        role: "student",
        classId: null,
        waliKelasId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    try {
        await admin.firestore().collection('users').doc(uid).set(userData);
        console.log(`[createUserProfile] Profil berhasil dibuat untuk ${uid}`);
        return { success: true };
    } catch (error) {
        console.error(`[createUserProfile] Error: ${error.message}`);
        throw error;
    }
});

// ============================================
// 2. processAttendance (Callable)
// ============================================
exports.processAttendance = onCall(async (request) => {
    // 1. Validasi authentication
    if (!request.auth) {
        throw new Error('UNAUTHENTICATED: Silakan login terlebih dahulu.');
    }
    
    const uid = request.auth.uid;
    console.log(`[processAttendance] Proses absensi untuk UID: ${uid}`);
    
    // 2. QR Token validation (MVP static)
    const { qrToken } = request.data;
    if (qrToken !== 'qrmvp2026') {
        throw new Error('INVALID_QR: QR Token tidak valid.');
    }
    
    // 3. Ambil user data dari Firestore
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
        throw new Error('USER_NOT_FOUND: User tidak ditemukan.');
    }
    
    const userData = userDoc.data();
    
    // 4. Validasi role = student
    if (userData.role !== 'student') {
        throw new Error('PERMISSION_DENIED: Hanya student yang bisa absen.');
    }
    
    // 5. Ambil classId dari database (BUKAN dari client)
    const classId = userData.classId;
    if (!classId) {
        throw new Error('PROFILE_INCOMPLETE: Profil belum lengkap. Silakan isi data diri dulu.');
    }
    
    // 6. Waktu server Asia/Jakarta
    const wibNow = getJakartaTime();
    const tanggal = formatTanggalWIB(wibNow);
    const jam = formatJamWIB(wibNow);
    
    console.log(`[processAttendance] Waktu WIB: ${tanggal} ${jam}`);
    
    // 7. Baca settings
    let schoolStartTime = '07:00';
    let lateThreshold = 5;
    
    try {
        const settingsDoc = await admin.firestore().collection('settings').doc('app').get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            schoolStartTime = settings.schoolStartTime || '07:00';
            lateThreshold = settings.lateThreshold ?? 5;
        }
    } catch (error) {
        console.warn('[processAttendance] Gagal baca settings, pakai fallback');
    }
    
    // 8. Tentukan status
    const status = determineStatus(jam, schoolStartTime, lateThreshold);
    console.log(`[processAttendance] Status: ${status}`);
    
    // 9. Document ID: uid_tanggal
    const docId = `${uid}_${tanggal}`;
    const docRef = admin.firestore().collection('attendance').doc(docId);
    
    // 10. Transaction untuk mencegah double attendance
    await admin.firestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (doc.exists) {
            throw new Error('DUPLICATE: Anda sudah absen hari ini.');
        }
        
        // 11. Buat attendance
        const attendanceData = {
            uid: uid,
            tanggal: tanggal,
            jam: jam,
            status: status,
            statusReason: null,
            classId: classId,
            method: 'qr',
            createdBy: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        transaction.set(docRef, attendanceData);
        console.log(`[processAttendance] Attendance berhasil dibuat: ${docId}`);
    });
    
    return {
        success: true,
        status: status,
        tanggal: tanggal,
        jam: jam
    };
});