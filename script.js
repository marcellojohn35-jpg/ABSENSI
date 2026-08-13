console.log("Sistem Absensi URL-Based aktif.");

import {
    auth, db, provider, signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

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

// ===== WIB Helper =====
function getJakartaDateStr() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const obj = {};
    parts.forEach(p => { if (p.type !== 'literal') obj[p.type] = p.value; });
    return `${obj.year}-${obj.month}-${obj.day}`;
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
    sessionInfoDisplay.style.display = 'block';
    sessionInfoDisplay.innerHTML = `
        <div style="font-size:14px;">
            <p><strong>Tanggal:</strong> ${data.date}</p>
            <p><strong>Mulai:</strong> ${data.startTime} | <strong>Batas Terlambat:</strong> ${data.lateAfter} | <strong>Tutup:</strong> ${data.endTime}</p>
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

// ===== Tombol "Absen Sekarang" =====
absenNowBtn.onclick = async () => {
    if (isProcessing) return;
    isProcessing = true;
    absenNowBtn.disabled = true;
    absenNowBtn.textContent = "⏳ Memproses...";

    try {
        const functions = getFunctions();
        const processAttendance = httpsCallable(functions, 'processAttendance');
        // Kirim sessionId, BUKAN tanggal
        const result = await processAttendance({ qrToken: currentSessionId });
        showAttendanceResult(true, result.data);
    } catch (error) {
        console.error(error);
        showAttendanceResult(false, { error: error.message });
    } finally {
        isProcessing = false;
        absenNowBtn.disabled = false;
        absenNowBtn.textContent = "✅ Absen Sekarang";
    }
};

// ===== Auth Listener =====
onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    
    // Jika di halaman absen, jalankan logic absen
    if (window.location.pathname === '/absen') {
        await processAbsenPage(user);
        return;
    }

    // Logic halaman lain (/, Dashboard)
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
            window.location.reload(); // Refresh untuk memuat dashboard
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

console.log("✅ Foundation URL-Based siap.");