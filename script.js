console.log("Sistem Absensi URL-Based aktif (Phase 5).");

import {
    auth, db, provider, signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, collection, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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

function getJakartaTimeStr() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    const obj = {};
    parts.forEach(p => { if (p.type !== 'literal') obj[p.type] = p.value; });
    return `${obj.hour}:${obj.minute}`;
}

// ===== Logic Halaman Absen (Siswa) - FULLY RESTORED FROM PHASE 4 =====
async function processAbsenPage(user) {
    showSection(absenSection);
    absenActionArea.style.display = 'none';
    sessionInfoDisplay.style.display = 'none';

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');

    if (!sessionId) {
        absenStatus.textContent = '❌ QR tidak valid: Session ID tidak ditemukan.';
        return;
    }
    currentSessionId = sessionId;

    absenStatus.textContent = '⏳ Memvalidasi QR...';
    const sessionRef = doc(db, 'attendanceSessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
        absenStatus.textContent = '❌ Session tidak ditemukan. QR mungkin sudah kadaluarsa.';
        return;
    }

    const data = sessionSnap.data();
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

    if (!user) {
        absenStatus.textContent = 'Silakan login untuk melanjutkan.';
        absenContent.innerHTML = `<button id="absenLoginBtn" class="btn-primary" style="width:auto;">Login</button>`;
        document.getElementById('absenLoginBtn').onclick = () => loginBtn.click();
        return;
    }

    absenStatus.textContent = '✅ Session valid.';
    absenContent.innerHTML = '';
    absenActionArea.style.display = 'block';

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

// ===== Tombol "Absen Sekarang" (Siswa) =====
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

        const sessionRef = doc(db, 'attendanceSessions', currentSessionId);
        const sessionSnap = await getDoc(sessionRef);
        if (!sessionSnap.exists()) throw new Error('SESSION_NOT_FOUND');
        const s = sessionSnap.data();

        const dateStr = getJakartaDateStr();
        const now = new Date();
        const timeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        
        const startTime = s.startTime.toDate();
        const lateTime = s.lateAfter.toDate();
        const endTime = s.endTime.toDate();

        if (now < startTime) throw new Error('SESSION_NOT_STARTED');
        if (now > endTime) throw new Error('SESSION_CLOSED');

        const status = (now <= lateTime) ? 'HADIR' : 'TERLAMBAT';

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

// ===== Render Dashboard =====
async function renderDashboard(userData) {
    userPhoto.src = userData.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = userData.nama || 'User';
    userRole.textContent = userData.role || 'student';
    const dashboardContent = document.getElementById('dashboardContent');

    if (userData.role === 'student') {
        dashboardContent.innerHTML = `
            <p><strong>Nama:</strong> ${userData.nama}</p>
            <p><strong>Kelas:</strong> ${userData.classId}</p>
            <p><strong>Role:</strong> ${userData.role}</p>
            <p style="margin-top:20px; color:#666;">🔧 Anda adalah siswa. Dashboard admin tidak tersedia.</p>
        `;
        return;
    }

    // === DASHBOARD ADMIN / TEACHER ===
    
    // 1. Admin Panel untuk Buat Session (Jika role = admin)
    let adminPanelHTML = '';
    if (userData.role === 'admin') {
        adminPanelHTML = `
            <div id="sessionAdminPanel" style="background:#f8f9fa; padding:15px; border-radius:8px; border:1px solid #eee; margin-bottom:20px;">
                <h4>🕒 Buat Sesi Absensi Hari Ini</h4>
                <div style="margin:10px 0;"><label>Jam Mulai:</label><input type="time" id="inputStartTime" value="06:30" style="width:100%; padding:8px;"></div>
                <div style="margin:10px 0;"><label>Batas Terlambat:</label><input type="time" id="inputLateTime" value="07:00" style="width:100%; padding:8px;"></div>
                <div style="margin:10px 0;"><label>Jam Tutup:</label><input type="time" id="inputEndTime" value="08:00" style="width:100%; padding:8px;"></div>
                <button id="createSessionBtn" class="btn-primary">Buat / Perbarui Sesi Hari Ini</button>
                <div id="sessionStatusMessage" style="margin-top:10px; padding:10px; border-radius:4px; display:none;"></div>
            </div>
        `;
    }

    // 2. Filter Area
    const filterHTML = `
        <div class="filter-container">
            <input type="date" id="filterDate" value="${getJakartaDateStr()}">
            <select id="filterClass"><option value="">Semua Kelas</option></select>
            <select id="filterStatus"><option value="">Semua Status</option>
                <option value="HADIR">HADIR</option>
                <option value="TERLAMBAT">TERLAMBAT</option>
                <option value="IZIN">IZIN</option>
                <option value="SAKIT">SAKIT</option>
                <option value="ALFA">ALFA</option>
            </select>
            <input type="text" id="filterNama" placeholder="Cari nama...">
            <button id="applyFilterBtn" class="btn-primary" style="padding:8px 16px; width:auto;">Filter</button>
            <button id="exportBtn" style="background:#28a745; color:white; padding:8px 16px; border-radius:4px;">📥 Export CSV</button>
        </div>
    `;

    // 3. Summary Area
    const summaryHTML = `
        <div class="summary-container" id="summaryContainer">
            <div class="summary-card"><div class="num" id="sumTotal">-</div><div class="label">Total</div></div>
            <div class="summary-card"><div class="num" id="sumHadir">-</div><div class="label">Hadir</div></div>
            <div class="summary-card"><div class="num" id="sumTerlambat">-</div><div class="label">Terlambat</div></div>
            <div class="summary-card"><div class="num" id="sumIzin">-</div><div class="label">Izin</div></div>
            <div class="summary-card"><div class="num" id="sumSakit">-</div><div class="label">Sakit</div></div>
            <div class="summary-card"><div class="num" id="sumAlfa">-</div><div class="label">Alfa</div></div>
        </div>
    `;

    // 4. Table Area
    const tableHTML = `
        <div id="attendanceTableContainer">
            <p style="color:#666;">Memuat data...</p>
        </div>
    `;

    dashboardContent.innerHTML = `
        <div style="text-align:left;">
            <h3>📋 Dashboard ${userData.role === 'admin' ? 'Admin' : 'Guru'}</h3>
            ${adminPanelHTML}
            ${filterHTML}
            ${summaryHTML}
            ${tableHTML}
        </div>
    `;

    // Attach Listeners
    if (userData.role === 'admin') {
        document.getElementById('createSessionBtn').onclick = handleCreateSession;
        checkTodaySession();
    }

    document.getElementById('applyFilterBtn').onclick = () => loadAttendanceData();
    document.getElementById('exportBtn').onclick = exportToCSV;

    await loadClassOptions();
    await loadAttendanceData();
}

// ===== Load Class Options =====
async function loadClassOptions() {
    const select = document.getElementById('filterClass');
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        const classes = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.classId) classes.add(data.classId);
        });
        classes.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.textContent = cls;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error("Error loading classes:", error);
    }
}

// ===== Load Attendance Data =====
async function loadAttendanceData() {
    const date = document.getElementById('filterDate').value;
    const cls = document.getElementById('filterClass').value;
    const status = document.getElementById('filterStatus').value;
    const nama = document.getElementById('filterNama').value.toLowerCase();

    const container = document.getElementById('attendanceTableContainer');
    container.innerHTML = `<p style="color:#666;">⏳ Memuat data...</p>`;

    try {
        let q = collection(db, 'attendance');
        let constraints = [where('tanggal', '==', date)];
        if (cls) constraints.push(where('classId', '==', cls));
        if (status) constraints.push(where('status', '==', status));

        const snapshot = await getDocs(query(q, ...constraints));
        let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        if (nama) {
            const usersSnapshot = await getDocs(collection(db, 'users'));
            const userMap = {};
            usersSnapshot.forEach(d => { userMap[d.id] = d.data().nama || ''; });
            data = data.filter(d => (userMap[d.uid] || '').toLowerCase().includes(nama));
        }

        if (data.length === 0) {
            container.innerHTML = `<p style="color:#666;">Tidak ada data absensi untuk filter ini.</p>`;
            updateSummary([]);
            return;
        }

        const userDocs = await Promise.all(data.map(d => getDoc(doc(db, 'users', d.uid))));
        const userMap = {};
        userDocs.forEach(d => {
            if (d.exists()) userMap[d.id] = d.data().nama || 'Unknown';
        });

        let html = `<table class="attendance-table">
            <thead><tr><th>No</th><th>Nama</th><th>Kelas</th><th>Tanggal</th><th>Jam</th><th>Status</th></tr></thead><tbody>`;
        data.forEach((d, i) => {
            const statusClass = `status-${d.status}`;
            html += `<tr>
                <td>${i+1}</td>
                <td>${userMap[d.uid] || 'Unknown'}</td>
                <td>${d.classId || '-'}</td>
                <td>${d.tanggal}</td>
                <td>${d.jam}</td>
                <td><span class="status-label ${statusClass}">${d.status}</span></td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;

        updateSummary(data);
    } catch (error) {
        console.error("Error loading attendance:", error);
        container.innerHTML = `<p style="color:#dc3545;">❌ Gagal memuat data.</p>`;
    }
}

// ===== Update Summary =====
function updateSummary(data) {
    const total = data.length;
    const hadir = data.filter(d => d.status === 'HADIR').length;
    const terlambat = data.filter(d => d.status === 'TERLAMBAT').length;
    const izin = data.filter(d => d.status === 'IZIN').length;
    const sakit = data.filter(d => d.status === 'SAKIT').length;
    const alfa = data.filter(d => d.status === 'ALFA').length;

    document.getElementById('sumTotal').textContent = total;
    document.getElementById('sumHadir').textContent = hadir;
    document.getElementById('sumTerlambat').textContent = terlambat;
    document.getElementById('sumIzin').textContent = izin;
    document.getElementById('sumSakit').textContent = sakit;
    document.getElementById('sumAlfa').textContent = alfa;
}

// ===== Export to CSV (BUKAN Excel) =====
function exportToCSV() {
    const table = document.querySelector('.attendance-table');
    if (!table) { alert('Tidak ada data untuk diekspor.'); return; }

    let csv = [];
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cols = row.querySelectorAll('td, th');
        const rowData = [];
        cols.forEach(col => rowData.push('"' + col.innerText.replace(/"/g, '""') + '"'));
        csv.push(rowData.join(','));
    });

    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `absensi_${getJakartaDateStr()}.csv`;
    link.click();
}

// ===== Admin: Cek Sesi Hari Ini =====
async function checkTodaySession() {
    const today = getJakartaDateStr();
    const sessionRef = doc(db, 'attendanceSessions', today);
    const sessionSnap = await getDoc(sessionRef);
    const statusMsg = document.getElementById('sessionStatusMessage');
    
    if (sessionSnap.exists()) {
        const data = sessionSnap.data();
        const start = data.startTime.toDate();
        const late = data.lateAfter.toDate();
        const end = data.endTime.toDate();
        const startStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour:'2-digit', minute:'2-digit', hour12:false }).format(start);
        const lateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour:'2-digit', minute:'2-digit', hour12:false }).format(late);
        const endStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour:'2-digit', minute:'2-digit', hour12:false }).format(end);
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#d1ecf1';
        statusMsg.style.color = '#0c5460';
        statusMsg.innerHTML = `Sesi hari ini sudah ada: ${startStr} - ${lateStr} - ${endStr}. Klik tombol di atas untuk menimpa.`;
        generateAdminQR(today);
    } else {
        statusMsg.style.display = 'none';
    }
}

// ===== Admin: Handle Create/Overwrite Session =====
async function handleCreateSession() {
    const today = getJakartaDateStr();
    const startVal = document.getElementById('inputStartTime').value;
    const lateVal = document.getElementById('inputLateTime').value;
    const endVal = document.getElementById('inputEndTime').value;
    const statusMsg = document.getElementById('sessionStatusMessage');

    if (!startVal || !lateVal || !endVal) {
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#f8d7da';
        statusMsg.style.color = '#721c24';
        statusMsg.textContent = 'Harap isi semua jam.';
        return;
    }

    const [h, m] = startVal.split(':').map(Number);
    const todayDate = new Date();
    todayDate.setUTCHours(h - 7, m, 0, 0);
    const startTimestamp = Timestamp.fromDate(todayDate);

    const [h2, m2] = lateVal.split(':').map(Number);
    const lateDate = new Date();
    lateDate.setUTCHours(h2 - 7, m2, 0, 0);
    const lateTimestamp = Timestamp.fromDate(lateDate);

    const [h3, m3] = endVal.split(':').map(Number);
    const endDate = new Date();
    endDate.setUTCHours(h3 - 7, m3, 0, 0);
    const endTimestamp = Timestamp.fromDate(endDate);

    if (startTimestamp.toDate() >= lateTimestamp.toDate() || lateTimestamp.toDate() >= endTimestamp.toDate()) {
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#f8d7da';
        statusMsg.style.color = '#721c24';
        statusMsg.textContent = 'Urutan waktu salah: Start < Late < End.';
        return;
    }

    try {
        await setDoc(doc(db, 'attendanceSessions', today), {
            date: today,
            startTime: startTimestamp,
            lateAfter: lateTimestamp,
            endTime: endTimestamp,
            createdAt: serverTimestamp()
        });
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#d4edda';
        statusMsg.style.color = '#155724';
        statusMsg.textContent = '✅ Sesi berhasil dibuat/diperbarui!';
        generateAdminQR(today);
    } catch (error) {
        console.error(error);
        statusMsg.style.display = 'block';
        statusMsg.style.background = '#f8d7da';
        statusMsg.style.color = '#721c24';
        statusMsg.textContent = 'Gagal membuat sesi. Periksa Firestore Rules.';
    }
}

// ===== Admin: Generate QR (Menggunakan qrcode.js) =====
function generateAdminQR(sessionId) {
    const url = `https://absensi-yadika4.vercel.app/absen?session=${sessionId}`;
    
    // Pastikan container QR tersedia
    let qrContainer = document.getElementById('qrContainer');
    if (!qrContainer) {
        qrContainer = document.createElement('div');
        qrContainer.id = 'qrContainer';
        qrContainer.style.cssText = 'display:flex; justify-content:center; padding:20px;';
        document.getElementById('sessionAdminPanel').appendChild(qrContainer);
    }
    
    // Panggil API yang benar-benar diekspos oleh qrcode.js
    if (typeof generateQR === 'function') {
        generateQR(url, 'qrContainer');
    } else {
        console.error("generateQR tidak tersedia. Pastikan qrcode.js telah dimuat.");
        qrContainer.innerHTML = '<p style="color:#dc3545;">❌ QR Generator tidak tersedia.</p>';
    }
}

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
        await renderDashboard(userDoc.data());
    } else {
        showSection(loginSection);
    }
});

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

console.log("✅ Foundation URL-Based siap (Phase 5).");