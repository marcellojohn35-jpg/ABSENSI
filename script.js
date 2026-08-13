console.log("Sistem Absensi URL-Based aktif (Firestore Rules).");

import {
    auth, db, provider, signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// DOM Refs
const $ = (id) => document.getElementById(id);
const loadingState = $('loadingState');
const loginSection = $('loginSection');
const dashboardSection = $('dashboardSection');
const profileSetupSection = $('profileSetupSection');
const attendanceResultSection = $('attendanceResultSection');
const absenSection = $('absenSection');

const absenContent = $('absenContent');
const absenStatus = $('absenStatus');
const sessionInfoDisplay = $('sessionInfoDisplay');
const absenActionArea = $('absenActionArea');
const absenNowBtn = $('absenNowBtn');
const absenProfileInfo = $('absenProfileInfo');

const loginBtn = $('loginBtn');
const logoutBtn = $('logoutBtn');
const userPhoto = $('userPhoto');
const userName = $('userName');
const userRole = $('userRole');

const profileForm = $('profileForm');
const profileNama = $('profileNama');
const profileNis = $('profileNis');
const profileKelas = $('profileKelas');

const attendanceResultTitle = $('attendanceResultTitle');
const attendanceResultData = $('attendanceResultData');
const goToAbsenBtn = $('goToAbsenBtn');

// State
let currentUser = null;
let isProcessing = false;
let currentSessionId = null;

function showSection(id) {
    [loadingState, loginSection, dashboardSection, profileSetupSection, attendanceResultSection, absenSection].forEach(el => el.style.display = 'none');
    if (id) id.style.display = 'block';
}

// ===== WIB Helpers =====
function getJakartaDateStr() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const obj = {};
    parts.forEach(p => { if (p.type !== 'literal') obj[p.type] = p.value; });
    return `${obj.year}-${obj.month}-${obj.day}`;
}

// Helper untuk mendapatkan jam:menit dalam string WIB untuk tampilan UI
function getJakartaTimeStr() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const obj = {};
    parts.forEach(p => { if (p.type !== 'literal') obj[p.type] = p.value; });
    return `${obj.hour}:${obj.minute}`;
}

// ===== Logic Halaman Absen =====
async function processAbsenPage(user) {
    showSection(absenSection);
    absenActionArea.style.display = 'none';
    sessionInfoDisplay.style.display = 'none';

    // 1. Baca Session ID dari URL
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');

    if (!sessionId) {
        absenStatus.textContent = '❌ QR tidak valid: Session ID tidak ditemukan.';
        return;
    }
    currentSessionId = sessionId;

    // 2. Validasi Session
    absenStatus.textContent = '⏳ Memvalidasi QR...';
    const sessionRef = doc(db, 'attendanceSessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
        absenStatus.textContent = '❌ Session tidak ditemukan. QR mungkin sudah kadaluarsa.';
        return;
    }

    const data = sessionSnap.data();
    
    // [FIX BUG 3] Konversi Timestamp ke Date untuk mengambil jam:menit tampilan
    const startDate = data.startTime.toDate();
    const lateDate = data.lateAfter.toDate();
    const endDate = data.endTime.toDate();
    
    const startTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(startDate);
    const lateTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(lateDate);
    const endTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(endDate);

    sessionInfoDisplay.style.display = 'block';
    sessionInfoDisplay.innerHTML = `
        <div style="font-size:14px;">
            <p><strong>Tanggal:</strong> ${data.date}</p>
            <p><strong>Mulai:</strong> ${startTimeStr} | <strong>Batas Terlambat:</strong> ${lateTimeStr} | <strong>Tutup:</strong> ${endTimeStr}</p>
        </div>
    `;

    // 3. Cek Auth
    if (!user) {
        absenStatus.textContent = 'Silakan login untuk melanjutkan.';
        absenContent.innerHTML = `<button id="absenLoginBtn" class="btn-primary" style="width:auto;">Login</button>`;
        document.getElementById('absenLoginBtn').onclick = () => loginBtn.click();
        return;
    }

    // 4. User sudah login, tampilkan UI Siap Absen
    absenStatus.textContent = '✅ Session valid.';
    absenContent.innerHTML = '';
    absenActionArea.style.display = 'block';

    // Tampilkan Profile
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
        const uData = userDoc.data();
        absenProfileInfo.style.display = 'block';
        absenProfileInfo.innerHTML = `
            <p><strong>Nama:</strong> ${uData.nama || 'Belum diisi'}</p>
            <p><strong>Kelas:</strong> ${uData.classId || 'Belum diisi'}</p>
            <p><strong>NIS:</strong> ${uData.nis || '-'}</p>
        `;
    }
}

// ===== Tombol "Absen Sekarang" (Direct Firestore Write) =====
absenNowBtn.onclick = async () => {
    if (isProcessing) return;
    isProcessing = true;
    absenNowBtn.disabled = true;
    absenNowBtn.textContent = "⏳ Memproses...";

    try {
        if (!currentUser) throw new Error('UNAUTHENTICATED');
        
        const uid = currentUser.uid;
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (!userDoc.exists()) throw new Error('USER_NOT_FOUND');
        const userData = userDoc.data();
        if (userData.role !== 'student') throw new Error('PERMISSION_DENIED');

        // Ambil data session lagi untuk validasi client-side (UX)
        const sessionRef = doc(db, 'attendanceSessions', currentSessionId);
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) throw new Error('SESSION_NOT_FOUND');
        const s = sessionSnap.data();

        // Waktu server yang akan dikirim
        const dateStr = getJakartaDateStr();
        const now = new Date();
        const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        
        // [FIX BUG 3] Perbandingan menggunakan objek Date asli (dari Timestamp)
        const startTime = s.startTime.toDate();
        const lateTime = s.lateAfter.toDate();
        const endTime = s.endTime.toDate();

        // Validasi Pra-Kirim
        if (now < startTime) throw new Error('SESSION_NOT_STARTED');
        if (now > endTime) throw new Error('SESSION_CLOSED');

        const status = (now <= lateTime) ? 'HADIR' : 'TERLAMBAT';

        // Tulis langsung ke Firestore (Rules akan validasi ulang)
        const docId = `${uid}_${dateStr}`;
        await setDoc(doc(db, 'attendance', docId), {
            uid: uid,
            tanggal: dateStr,
            jam: timeStr,
            status: status,
            classId: userData.classId,
            sessionId: currentSessionId,
            method: 'qr',
            createdAt: serverTimestamp()
        });

        showAttendanceResult(true, { status, tanggal: dateStr, jam: timeStr });

    } catch (error) {
        console.error(error);
        let errorMessage = error.message;
        if (error.code === 'permission-denied') {
            errorMessage = 'Permintaan ditolak oleh sistem. Pastikan session valid, waktu tepat, dan Anda belum absen.';
        }
        showAttendanceResult(false, { error: errorMessage });
    } finally {
        isProcessing = false;
        absenNowBtn.disabled = false;
        absenNowBtn.textContent = "✅ Absen Sekarang";
    }
};

// ===== Auth Listener =====
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    
    if (window.location.pathname === '/absen') {
        await processAbsenPage(user);
        return;
    }

    if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
            showSection(profileSetupSection);
            setupProfileForm(user);
            return;
        }
        showSection(dashboardSection);
        renderDashboard(userDoc.data());
    } else {
        showSection(loginSection);
    }
});

// ===== Dashboard =====
function renderDashboard(data) {
    userPhoto.src = data.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = data.nama || 'User';
    userRole.textContent = data.role || 'student';
    document.getElementById('dashboardContent').innerHTML = `
        <p><strong>Nama:</strong> ${data.nama}</p>
        <p><strong>Kelas:</strong> ${data.classId}</p>
        <p><strong>Role:</strong> ${data.role}</p>
        <p style="margin-top:20px; color:#666;">🔧 Dashboard Admin/Development.</p>
    `;
}

// ===== Profile Setup =====
function setupProfileForm(user) {
    if (user.displayName) profileNama.value = user.displayName;
    profileForm.onsubmit = async (e) => {
        e.preventDefault();
        const nama = profileNama.value.trim();
        const nis = profileNis.value.trim() || null;
        const classId = profileKelas.value.trim() || null;
        if (!nama) return alert('Nama wajib diisi');
        try {
            await setDoc(doc(db, 'users', user.uid), {
                nama, nis, classId, role: 'student', updatedAt: serverTimestamp()
            }, { merge: true });
            alert('Profil tersimpan!');
            window.location.reload();
        } catch (e) { alert('Gagal menyimpan.'); }
    };
}

// ===== Attendance Result =====
function showAttendanceResult(success, data) {
    showSection(attendanceResultSection);
    if (success) {
        attendanceResultTitle.textContent = '✅ ABSENSI BERHASIL';
        attendanceResultTitle.className = 'success';
        attendanceResultData.innerHTML = `
            <p><strong>Status:</strong> ${data.status}</p>
            <p><strong>Tanggal:</strong> ${data.tanggal}</p>
            <p><strong>Jam:</strong> ${data.jam}</p>
        `;
    } else {
        let msg = '❌ Gagal melakukan absensi.';
        if (data.error?.includes('SESSION_NOT_FOUND')) msg = '⚠️ Session tidak ditemukan.';
        else if (data.error?.includes('SESSION_CLOSED')) msg = '⏰ Sesi sudah ditutup.';
        else if (data.error?.includes('SESSION_NOT_STARTED')) msg = '⏰ Sesi belum dimulai.';
        else if (data.error?.includes('DUPLICATE')) msg = 'ℹ️ Anda sudah absen hari ini.';
        else if (data.error?.includes('permission-denied')) msg = 'Akses ditolak oleh sistem.';
        attendanceResultTitle.textContent = msg;
        attendanceResultTitle.className = 'error';
        attendanceResultData.innerHTML = `<p>${data.error || ''}</p>`;
    }
    goToAbsenBtn.onclick = () => window.location.href = '/absen?session=' + currentSessionId;
}

// ===== Auth Actions =====
loginBtn.onclick = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (e) { alert('Login gagal: ' + e.message); }
};
logoutBtn.onclick = async () => {
    try { await signOut(auth); } catch (e) { alert('Logout gagal.'); }
};

console.log("✅ Foundation URL-Based siap (Rules only).");