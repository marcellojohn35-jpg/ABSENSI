const { onCall } = require("firebase-functions/v2/https");
const { onCreate } = require("firebase-functions/v2/identity");
const admin = require("firebase-admin");
admin.initializeApp();

// WIB Helper
function getJakartaTime() {
    const now = new Date();
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const parts = f.formatToParts(now);
    const d = {};
    parts.forEach(p => { if (p.type !== 'literal') d[p.type] = p.value; });
    return { date: `${d.year}-${d.month}-${d.day}`, time: `${d.hour}:${d.minute}` };
}

// Create Profile
exports.createUserProfile = onCreate(async (user) => {
    const data = { nama: user.displayName || null, nis: null, email: user.email || null, photoURL: user.photoURL || null, role: "student", classId: null, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    try { await admin.firestore().collection('users').doc(user.uid).set(data); return { success: true }; } 
    catch (e) { throw e; }
});

// Process Attendance (PURE URL-BASED)
exports.processAttendance = onCall(async (req) => {
    if (!req.auth) throw new Error('UNAUTHENTICATED');
    const uid = req.auth.uid;
    const { qrToken } = req.data; // qrToken = sessionId

    // 1. Ambil User
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) throw new Error('USER_NOT_FOUND');
    const user = userDoc.data();
    if (user.role !== 'student') throw new Error('PERMISSION_DENIED');

    // 2. Validasi Session (SOURCE OF TRUTH)
    const sessionRef = admin.firestore().collection('attendanceSessions').doc(qrToken);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) throw new Error('SESSION_NOT_FOUND');
    const s = sessionDoc.data();

    // 3. Waktu Server (WIB)
    const { date, time } = getJakartaTime();
    const parse = (t) => { const [h,m]=t.split(':').map(Number); return h*60+m; };
    const now = parse(time);
    const start = parse(s.startTime);
    const late = parse(s.lateAfter);
    const end = parse(s.endTime);

    // 4. Validasi Waktu
    if (now < start) throw new Error('SESSION_NOT_STARTED');
    if (now > end) throw new Error('SESSION_CLOSED');

    // 5. Duplicate Check
    const attRef = admin.firestore().collection('attendance').doc(`${uid}_${date}`);
    const attDoc = await attRef.get();
    if (attDoc.exists) throw new Error('DUPLICATE');

    // 6. Tentukan Status
    const status = (now <= late) ? 'HADIR' : 'TERLAMBAT';

    // 7. Write
    await attRef.set({
        uid, tanggal: date, jam: time, status, classId: user.classId, method: 'qr', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, status, tanggal: date, jam: time };
});