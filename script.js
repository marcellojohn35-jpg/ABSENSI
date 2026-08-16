console.log("Sistem Absensi URL-Based aktif (Phase 7).");

import {
    auth, db, provider, signInWithPopup, onAuthStateChanged, signOut
} from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, collection, query, where, getDocs, orderBy, limit, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ===== Auth redirect handling disabled: using popup login =====
// DOM Refs
const $ = (id) => document.getElementById(id);
const loadingState = $('loadingState');
const loginSection = $('loginSection');
const dashboardSection = $('dashboardSection');
const profileSetupSection = $('profileSetupSection');
const attendanceResultSection = $('attendanceResultSection');
const absenSection = $('absenSection');
const userManagementContainer = $('userManagementContainer');
const successScreenSection = $('successScreenSection');

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
const profileKelas = $('profileKelas');

const attendanceResultTitle = $('attendanceResultTitle');
const attendanceResultData = $('attendanceResultData');
const goToAbsenBtn = $('goToAbsenBtn');

// State
let currentUser = null;
let isProcessing = false;
let currentSessionId = null;
let umData = [];
let umFilteredData = [];
let attendanceFilteredData = [];

// ===== SESSION REDESIGN (sessionId sebagai identity utama, bukan tanggal) =====
// Dipakai khusus oleh Dashboard (teacher/admin) untuk menentukan session mana
// yang sedang dipilih/difilter — terpisah dari `currentSessionId` (dipakai oleh
// flow /absen siswa) supaya kedua flow tidak saling menimpa state.
let currentDashboardSessionId = null;
let currentDashboardSessionDate = null;
let currentDashboardSessionStatus = null;

// ===== AUTH GATE: Intended-route restoration =====
// Key sessionStorage untuk menyimpan route tujuan (pathname + query) saat user
// belum login mengakses /absen, supaya setelah login (popup) bisa dikembalikan
// persis ke route itu (termasuk ?session=... jika ada). Single-use: selalu
// di-consume (removeItem) begitu dibaca, supaya tidak ada redirect loop dan
// login normal dari '/' tidak terpengaruh saat tidak ada route tersimpan.
const POST_LOGIN_REDIRECT_KEY = 'postLoginRedirect';

function showSection(id) {
    // Menggunakan class "hidden" (bukan inline style.display) supaya tiap section
    // tetap memakai display mode aslinya dari CSS (flex untuk auth-page, block
    // untuk dashboard-page) alih-alih dipaksa "block" oleh inline style.
    [loadingState, loginSection, dashboardSection, profileSetupSection, attendanceResultSection, absenSection, userManagementContainer, successScreenSection].forEach(el => el.classList.add('hidden'));
    if (id) id.classList.remove('hidden');
}

// ===== WIB Helpers =====
function getJakartaDateStr() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const obj = {};
    parts.forEach(p => { if (p.type !== 'literal') obj[p.type] = p.value; });
    return `${obj.year}-${obj.month}-${obj.day}`;
}

function formatTimestampToWIBTime(timestamp) {
    if (!timestamp) return '-';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

// ===== Session ID resolver (LEGACY-SAFE) =====
// Session BARU (hasil handleCreateSession) selalu punya field `sessionId` (== doc.id, "session_NNN").
// Session LAMA (attendanceSessions/{tanggal}, dari sebelum redesign) TIDAK punya field `sessionId`
// sama sekali — untuk session itu, doc.id (string tanggal) sendiri yang menjadi sessionId-nya.
// Fungsi ini adalah satu-satunya tempat yang boleh melakukan fallback ini, supaya konsisten
// di seluruh file.
function resolveSessionId(sessionDocSnap) {
    const d = sessionDocSnap.data();
    return d.sessionId || sessionDocSnap.id;
}

// ===== Logic Halaman Absen (Siswa) - Phase 4 =====
async function processAbsenPage(user) {
    console.log('[ABSEN] processAbsenPage START', user?.uid);
    // Reset UI absen terlebih dahulu
    absenActionArea.style.display = 'none';
    sessionInfoDisplay.style.display = 'none';
    absenContent.innerHTML = '';
    absenProfileInfo.style.display = 'none';
    absenStatus.textContent = '';

    // STEP 1: AUTHENTICATION GATE
    if (!user) {
        // Simpan full route (termasuk query parameter) ke sessionStorage
        // agar setelah login user bisa kembali ke /absen?session=...
        sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, window.location.pathname + window.location.search);
        window.location.href = '/';
        return;
    }

    // STEP 2: CEK PROFILE USER
    console.log('[ABSEN] sebelum getDoc users');
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    console.log('[ABSEN] sesudah getDoc users', userDoc.exists(), userDoc.data());


    if (!userDoc.exists()) {
        // Profile belum ada → tampilkan form pendaftaran
        showSection(profileSetupSection);
        setupProfileForm(user);
        return;
    }

    // STEP 3: CEK ROLE — hanya student yang boleh mengakses /absen
    const uData = userDoc.data();

    if (uData.role === 'casis') {
        showSection(dashboardSection);
        await renderCasisDashboard(uData);
        return;
    }

    if (uData.role !== 'student') {
        // Teacher/Admin → dashboard
        showSection(dashboardSection);
        await renderDashboard(uData);
        return;
    }

    // STEP 4: PROFILE ADA & ROLE student → LANJUTKAN KE ABSEN
    console.log('[ABSEN] menampilkan absenSection');
    showSection(absenSection);
    console.log('[ABSEN] absenSection berhasil ditampilkan');


    const params = new URLSearchParams(window.location.search);
    const requestedSessionId = params.get('session');

    absenStatus.textContent = '⏳ Memeriksa sesi absensi...';

    let sessionSnap = null;

    if (requestedSessionId) {
        // Session eksplisit lewat URL (?session=session_002, atau legacy: ?session=2026-08-15)
        console.log('[ABSEN] sebelum getDoc session (explicit)', requestedSessionId);
        const explicitSnap = await getDoc(doc(db, 'attendanceSessions', requestedSessionId));
        console.log('[ABSEN] sesudah getDoc session (explicit)', explicitSnap.exists());
        if (explicitSnap.exists()) sessionSnap = explicitSnap;
    } else {
        // Tanpa query param → cari session yang sedang ACTIVE (BUKAN tanggal hari ini)
        console.log('[ABSEN] sebelum query session ACTIVE');
        const activeQuery = query(collection(db, 'attendanceSessions'), where('status', '==', 'ACTIVE'), limit(1));
        const activeQuerySnap = await getDocs(activeQuery);
        console.log('[ABSEN] sesudah query session ACTIVE', !activeQuerySnap.empty);
        if (!activeQuerySnap.empty) sessionSnap = activeQuerySnap.docs[0];
    }

    if (!sessionSnap) {
        currentSessionId = null;
        absenStatus.textContent = '❌ Belum ada sesi absensi aktif saat ini.';
        return;
    }

    currentSessionId = resolveSessionId(sessionSnap);

    const data = sessionSnap.data();
    const isSessionActive = data.status === 'ACTIVE';
    const startDate = data.startTime.toDate();
    const lateDate = data.lateAfter.toDate();
    const endDate = data.endTime.toDate();

    const startTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(startDate);
    const lateTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(lateDate);
    const endTimeStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(endDate);

    sessionInfoDisplay.style.display = 'block';

    sessionInfoDisplay.innerHTML = `
        <p><strong>Sesi:</strong> ${currentSessionId} ${isSessionActive ? '<span class="status-label status-HADIR">Aktif</span>' : '<span class="status-label status-BELUM_ABSEN">Diarsipkan</span>'}</p>
        <p><strong>Tanggal:</strong> ${data.date}</p>
        <p><strong>Mulai:</strong> ${startTimeStr} &middot; <strong>Batas Terlambat:</strong> ${lateTimeStr} &middot; <strong>Tutup:</strong> ${endTimeStr}</p>
    `;

    if (!isSessionActive) {
        absenStatus.textContent = '🔒 Sesi ini sudah diarsipkan (ARCHIVED). Anda tidak bisa absen di sesi ini lagi.';
        absenContent.innerHTML = '';
        absenActionArea.style.display = 'none';
        // Tampilkan tetap info profil siswa untuk konsistensi UX
        absenProfileInfo.style.display = 'block';
        absenProfileInfo.innerHTML = `
            <p><strong>Nama:</strong> ${uData.nama || 'Belum diisi'}</p>
            <p><strong>Kelas:</strong> ${uData.classId || 'Belum diisi'}</p>
            <p><strong>NIS:</strong> ${uData.nis || '-'}</p>
        `;
        return;
    }

    absenStatus.textContent = '✅ Session valid.';
    absenContent.innerHTML = '';
    absenActionArea.style.display = 'block';

    // Tampilkan info user yang sedang absen
    absenProfileInfo.style.display = 'block';

    absenProfileInfo.innerHTML = `
        <p><strong>Nama:</strong> ${uData.nama || 'Belum diisi'}</p>
        <p><strong>Kelas:</strong> ${uData.classId || 'Belum diisi'}</p>
        <p><strong>NIS:</strong> ${uData.nis || '-'}</p>
    `;
}

// ===== Tombol "Absen Sekarang" (Siswa) =====
absenNowBtn.onclick = async () => {
    if (isProcessing) return;

    isProcessing = true;
    absenNowBtn.disabled = true;
    absenNowBtn.textContent = "⏳ Memproses...";

    try {
        if (!currentUser) throw new Error('UNAUTHENTICATED');
        if (!currentSessionId) throw new Error('SESSION_ID_MISSING');

        const uid = currentUser.uid;

        const userDoc = await getDoc(doc(db, 'users', uid));

        if (!userDoc.exists()) {
            throw new Error('USER_NOT_FOUND');
        }

        const userData = userDoc.data();

        if (userData.role !== 'student') {
            throw new Error('PERMISSION_DENIED');
        }

        const sessionRef = doc(db, 'attendanceSessions', currentSessionId);
        console.log('[ABSEN] sebelum getDoc session', currentSessionId);
    const sessionSnap = await getDoc(sessionRef);
    console.log('[ABSEN] sesudah getDoc session', sessionSnap.exists());


        if (!sessionSnap.exists()) {
            throw new Error('SESSION_NOT_FOUND');
        }

        const s = sessionSnap.data();

        // Guard client-side (defense in depth — enforcement sesungguhnya ada di Firestore Rules):
        // session ARCHIVED (termasuk legacy session yang tidak punya field `status` sama sekali)
        // tidak boleh dipakai untuk absen baru.
        if (s.status !== 'ACTIVE') {
            throw new Error('SESSION_ARCHIVED');
        }

        const docId = `${uid}_${currentSessionId}`;
        const now = new Date();

        const startTime = s.startTime.toDate();
        const lateTime = s.lateAfter.toDate();
        const endTime = s.endTime.toDate();

        if (now < startTime) {
            throw new Error('SESSION_NOT_STARTED');
        }

        if (now > endTime) {
            throw new Error('SESSION_CLOSED');
        }

        const status = (now <= lateTime) ? 'HADIR' : 'TERLAMBAT';


        console.log('[ABSEN DEBUG FULL]', JSON.stringify({
            uid,
            role: userData.role,
            classId: userData.classId,
            currentSessionId,
            docId,
            now: now.toISOString(),
            startTime: startTime.toISOString(),
            lateTime: lateTime.toISOString(),
            endTime: endTime.toISOString(),
            status
        }, null, 2));

        // ===== CREATE ATTENDANCE =====
        // Duplicate dicegah oleh Firestore Rules melalui !exists(docId).
        // Jangan melakukan getDoc() terlebih dahulu karena student tidak
        // boleh membaca dokumen attendance yang belum ada.
        const attendanceRef = doc(db, 'attendance', docId);

        await setDoc(attendanceRef, {
            uid: uid,
            tanggal: s.date,
            status: status,
            classId: userData.classId,
            sessionId: currentSessionId,
            method: 'qr',
            createdAt: serverTimestamp()
        });

        // SUCCESS: tampilkan success screen
        showAttendanceResult(true, {
            status,
            tanggal: s.date
        });

    } catch (error) {
        console.error(error);

        let errorMessage = error.message;

        if (error.code === 'permission-denied') {
            errorMessage = 'Permintaan ditolak oleh sistem. Pastikan session valid, waktu tepat, dan Anda belum absen.';
        }

        showAttendanceResult(false, {
            error: errorMessage
        });

    } finally {
        isProcessing = false;
        absenNowBtn.disabled = false;
        absenNowBtn.textContent = "✅ Absen Sekarang";
    }
};

// ===== Render Dashboard CASIS =====
async function renderCasisDashboard(userData) {
    userPhoto.src = userData.photoURL || currentUser?.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = userData.nama || 'Pendaftar';
    userRole.textContent = 'Casis';
    userRole.className = 'role-casis';

    const dashboardContent = document.getElementById('dashboardContent');

    dashboardContent.innerHTML = `
        <h3 class="page-title">Dashboard Casis</h3>

        <div class="card">
            <div class="profile-summary">
                <div class="profile-row">
                    <span class="label">Nama</span>
                    <span class="value">${userData.nama || '-'}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Kelas</span>
                    <span class="value">${userData.classId || '-'}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Email</span>
                    <span class="value">${userData.email || currentUser?.email || '-'}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Status</span>
                    <span class="value">Pendaftar</span>
                </div>
            </div>
        </div>
    `;
}

// ===== Render Dashboard =====
const ROLE_LABEL = {
    student: 'Siswa',
    casis: 'Casis',
    teacher: 'Guru',
    admin: 'Admin'
};

async function renderDashboard(userData) {
    userPhoto.src = userData.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = userData.nama || 'User';
    userRole.textContent = ROLE_LABEL[userData.role] || userData.role || 'Siswa';
    userRole.className = 'role-' + (userData.role || 'student');

    const dashboardContent = document.getElementById('dashboardContent');

    if (userData.role === 'student') {
        dashboardContent.innerHTML = `
            <h3 class="page-title">Dashboard Siswa</h3>
            <div class="card">
                <div class="profile-summary">
                    <div class="profile-row"><span class="label">Nama</span><span class="value">${userData.nama || '-'}</span></div>
                    <div class="profile-row"><span class="label">Kelas</span><span class="value">${userData.classId || '-'}</span></div>
                    <div class="profile-row"><span class="label">Role</span><span class="value">Siswa</span></div>
                </div>
            </div>
        `;
        return;
    }

    // === DASHBOARD ADMIN / TEACHER ===

    // 1. Admin Panel untuk Buat Session (Jika role = admin)
    let adminPanelHTML = '';
    let userManagementBtnHTML = '';

    if (userData.role === 'admin') {
        adminPanelHTML = `
            <div id="sessionAdminPanel" class="card">
                <div class="card-title">🕒 Buat Sesi Absensi Hari Ini</div>

                <div class="form-group">
                    <label for="inputStartTime">Jam Mulai</label>
                    <input type="time" id="inputStartTime" value="06:30">
                </div>

                <div class="form-group">
                    <label for="inputLateTime">Batas Terlambat</label>
                    <input type="time" id="inputLateTime" value="07:00">
                </div>

                <div class="form-group">
                    <label for="inputEndTime">Jam Tutup</label>
                    <input type="time" id="inputEndTime" value="08:00">
                </div>

                <button id="createSessionBtn" class="btn btn-primary mt-16">
                    Buat Sesi Baru (Arsipkan Sesi Aktif Sebelumnya)
                </button>

                <div id="sessionStatusMessage" class="alert mt-16" style="display:none;"></div>
            </div>
        `;

        userManagementBtnHTML = `
            <button id="userManagementBtn" class="btn btn-secondary btn-block" style="margin-bottom:16px;">
                👥 Manajemen User
            </button>
        `;
    }

    // ===== MANUAL ATTENDANCE PANEL (TEACHER: kelas sendiri, IZIN/SAKIT/ALFA — ADMIN: semua kelas, 5 status) =====
    // Hanya salah satu yang pernah dirender untuk satu user (role tidak pernah dobel),
    // jadi element id boleh sama persis untuk kedua kasus.
    let teacherManualHTML = '';
    if (userData.role === 'teacher' || userData.role === 'admin') {
        const isAdminPanel = userData.role === 'admin';
        const panelTitle = isAdminPanel ? '📝 Manual Attendance (Admin)' : '📝 Manual Attendance (Teacher)';
        const panelDesc = isAdminPanel
            ? 'Tetapkan/koreksi status attendance untuk siswa mana pun.'
            : 'Tetapkan/koreksi status IZIN/SAKIT/ALFA untuk siswa di kelas Anda.';
        const statusOptionsHTML = isAdminPanel
            ? `
                        <option value="HADIR">HADIR</option>
                        <option value="TERLAMBAT">TERLAMBAT</option>
                        <option value="IZIN">IZIN</option>
                        <option value="SAKIT">SAKIT</option>
                        <option value="ALFA">ALFA</option>`
            : `
                        <option value="IZIN">IZIN</option>
                        <option value="SAKIT">SAKIT</option>
                        <option value="ALFA">ALFA</option>`;

        teacherManualHTML = `
            <div id="teacherManualPanel" class="card">
                <div class="card-title">${panelTitle}</div>
                <p class="card-desc">
                    ${panelDesc}
                </p>
                <div class="filter-container" style="margin-bottom:0;">
                    <select id="manualStudentSelect" style="flex:2;">
                        <option value="">Pilih Siswa...</option>
                    </select>
                    <select id="manualStatusSelect" style="flex:1;">
                        <option value="">Pilih Status...</option>${statusOptionsHTML}
                    </select>
                    <button id="manualSetStatusBtn" class="btn btn-primary">Set Status</button>
                </div>
                <div id="manualStatusMessage" class="alert mt-16" style="display:none;"></div>
            </div>
        `;
    }
    // ===== END MANUAL ATTENDANCE PANEL =====

    // 2. Filter Area
    // CATATAN REDESIGN: `filterDate` (query driver lama, berbasis tanggal) DIHAPUS.
    // Sumber kebenaran filter attendance sekarang HANYA `filterSession`
    // (selectedSessionId -> where('sessionId','==', selectedSessionId)) — tidak ada
    // dua sumber kebenaran. Tanggal tetap ditampilkan sebagai info non-interaktif
    // di sebelah dropdown (diisi oleh initSessionSelector()/onchange-nya).
    const filterHTML = `
        <div class="filter-container">
            <select id="filterSession" style="min-width:220px;">
                <option value="">Memuat daftar sesi...</option>
            </select>
            <span id="filterSessionDateLabel" class="text-secondary" style="align-self:center; font-size:13px;"></span>

            <select id="filterClass">
                <option value="">Semua Kelas</option>
            </select>

            <select id="filterStatus">
                <option value="">Semua Status</option>
                <option value="HADIR">HADIR</option>
                <option value="TERLAMBAT">TERLAMBAT</option>
                <option value="IZIN">IZIN</option>
                <option value="SAKIT">SAKIT</option>
                <option value="ALFA">ALFA</option>
                <option value="BELUM_ABSEN">BELUM ABSEN</option>
            </select>

            <input type="text" id="filterNama" placeholder="Cari nama...">

            <button id="applyFilterBtn" class="btn btn-primary">
                Filter
            </button>

            <button id="exportBtn" class="btn btn-success">
                📥 Export Excel
            </button>
        </div>
    `;

    // 3. Summary Area
    const summaryHTML = `
        <div class="summary-container" id="summaryContainer">
            <div class="summary-card">
                <div class="num" id="sumTotal">-</div>
                <div class="label">Total</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumHadir">-</div>
                <div class="label">Hadir</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumTerlambat">-</div>
                <div class="label">Terlambat</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumIzin">-</div>
                <div class="label">Izin</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumSakit">-</div>
                <div class="label">Sakit</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumAlfa">-</div>
                <div class="label">Alfa</div>
            </div>

            <div class="summary-card">
                <div class="num" id="sumBelum">-</div>
                <div class="label">Belum Absen</div>
            </div>
        </div>
    `;

    // 4. Table Area
    const tableHTML = `
        <div id="attendanceTableContainer">
            <p class="state-message">Memuat data...</p>
        </div>
    `;

    const roleHeader = userData.role === 'admin' ? 'Admin' : 'Guru';

    dashboardContent.innerHTML = `
        <div>
            <h3 class="page-title" style="margin-bottom:16px;">Dashboard ${roleHeader}</h3>
            ${userManagementBtnHTML}
            ${teacherManualHTML}
            ${adminPanelHTML}
            ${filterHTML}
            ${summaryHTML}
            ${tableHTML}
        </div>
    `;

    // Attach Listeners
    if (userData.role === 'admin') {
        document.getElementById('createSessionBtn').onclick = handleCreateSession;

        document.getElementById('userManagementBtn').onclick = () => {
            showSection(userManagementContainer);
            loadUserManagementData();
        };

        checkTodaySession();
    }

    document.getElementById('applyFilterBtn').onclick = () => loadAttendanceData();
    document.getElementById('exportBtn').onclick = exportToExcel;

    // Manual attendance listeners (teacher: kelas sendiri, admin: semua kelas)
    if (userData.role === 'teacher' || userData.role === 'admin') {
        document.getElementById('manualSetStatusBtn').onclick = () => handleManualStatus(userData);
        // Populate student dropdown setelah data dimuat
        setTimeout(() => populateManualStudentDropdown(userData), 500);
    }

    await loadClassOptions();
    // Isi dropdown session (sumber kebenaran filter attendance) lalu load data
    // untuk session yang otomatis terpilih (default: session ACTIVE).
    await initSessionSelector();
}

// ===== Dashboard: Isi dropdown pilihan session (LEGACY-SAFE) =====
// Sumber kebenaran TUNGGAL untuk "attendance mana yang ditampilkan" adalah
// currentDashboardSessionId hasil dropdown ini -> where('sessionId','==', ...).
// `filterDate` (lama) sudah dihapus sepenuhnya dari UI dan tidak lagi dipakai
// di mana pun sebagai query driver.
async function initSessionSelector() {
    const select = document.getElementById('filterSession');
    const dateLabel = document.getElementById('filterSessionDateLabel');
    if (!select) return;

    const snap = await getDocs(query(collection(db, 'attendanceSessions'), orderBy('createdAt', 'desc')));

    if (snap.empty) {
        select.innerHTML = '<option value="">Belum ada sesi</option>';
        currentDashboardSessionId = null;
        currentDashboardSessionDate = null;
        currentDashboardSessionStatus = null;
        if (dateLabel) dateLabel.textContent = '';
        await loadAttendanceData();
        return;
    }

    let optionsHTML = '';
    let activeSessionId = null;
    const firstDocSessionId = resolveSessionId(snap.docs[0]);

    snap.forEach((docSnap) => {
        const d = docSnap.data();
        const sid = resolveSessionId(docSnap);
        const isLegacy = !d.sessionId; // session lama tidak punya field sessionId sama sekali
        const status = d.status || (isLegacy ? 'LEGACY' : '-');
        const label = isLegacy
            ? `${sid} (legacy, ${d.date || '-'})`
            : `${sid} — ${d.date || '-'} (${status})`;

        optionsHTML += `<option value="${sid}" data-date="${d.date || ''}" data-status="${status}">${label}</option>`;

        if (status === 'ACTIVE') activeSessionId = sid;
    });

    // Default pilihan: session ACTIVE kalau ada; kalau tidak ada sama sekali, pakai
    // dokumen paling atas (terbaru berdasarkan createdAt).
    const defaultSessionId = activeSessionId || firstDocSessionId;

    select.innerHTML = optionsHTML;
    select.value = defaultSessionId;

    const selectedOption = select.options[select.selectedIndex];
    currentDashboardSessionId = select.value || null;
    currentDashboardSessionDate = selectedOption ? selectedOption.dataset.date : null;
    currentDashboardSessionStatus = selectedOption ? selectedOption.dataset.status : null;
    if (dateLabel) dateLabel.textContent = currentDashboardSessionDate ? `Tanggal: ${currentDashboardSessionDate}` : '';

    select.onchange = async () => {
        const opt = select.options[select.selectedIndex];
        currentDashboardSessionId = select.value || null;
        currentDashboardSessionDate = opt ? opt.dataset.date : null;
        currentDashboardSessionStatus = opt ? opt.dataset.status : null;
        if (dateLabel) dateLabel.textContent = currentDashboardSessionDate ? `Tanggal: ${currentDashboardSessionDate}` : '';
    };
}

// ===== POPULATE MANUAL STUDENT DROPDOWN =====
async function populateManualStudentDropdown(userData) {
    console.log('[MANUAL] teacher data:', userData);
    console.log('[MANUAL] teacher UID:', currentUser?.uid, 'classId:', userData.classId, 'role:', userData.role);
    const select = document.getElementById('manualStudentSelect');
    if (!select) return;

    try {
        const snapshot = await getDocs(collection(db, 'users'));
        console.log('[MANUAL] users snapshot size:', snapshot.size);
        const students = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.role !== 'student') { console.log('[MANUAL] skip non-student:', doc.id, data.role); return; }
            // Teacher hanya boleh melihat/memilih student di classId-nya sendiri.
            // Ini validasi UX saja — enforcement sebenarnya ada di Firestore Rules.
            if (userData.role === 'teacher' && data.classId !== userData.classId) { console.log('[MANUAL] skip class:', doc.id, data.classId, 'teacherClass:', userData.classId); return; }
            students.push({ uid: doc.id, ...data });
        });

        // Sort by nama
        console.log('[MANUAL] students after filter:', students.length, students);
        students.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));

        select.innerHTML = '<option value="">Pilih Siswa...</option>';
        students.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.uid;
            opt.textContent = `${s.nama || 'Unknown'} (${s.classId || '-'})`;
            select.appendChild(opt);
        });
    } catch (error) {
        console.error('Error loading students for manual attendance:', error);
    }
}

// ===== HANDLE MANUAL STATUS (TEACHER: kelas sendiri, IZIN/SAKIT/ALFA — ADMIN: semua kelas, 5 status) =====
// CATATAN: semua validasi di fungsi ini hanya UX. Enforcement sebenarnya ada di firestore.rules.
async function handleManualStatus(userData) {
    const uidSelect = document.getElementById('manualStudentSelect');
    const statusSelect = document.getElementById('manualStatusSelect');
    const msgEl = document.getElementById('manualStatusMessage');

    const targetUid = uidSelect.value;
    const status = statusSelect.value;
    const isAdmin = userData.role === 'admin';

    // Status yang diizinkan per role (UX guard — rules yang jadi source of truth)
    const allowedStatuses = isAdmin
        ? ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALFA']
        : ['IZIN', 'SAKIT', 'ALFA'];

    if (!targetUid) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = 'Pilih siswa terlebih dahulu.';
        return;
    }

    if (!status) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = 'Pilih status terlebih dahulu.';
        return;
    }

    if (!allowedStatuses.includes(status)) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = isAdmin
            ? '❌ Status tidak valid.'
            : '❌ Anda hanya boleh menetapkan status IZIN/SAKIT/ALFA.';
        return;
    }

    if (!currentDashboardSessionId) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = 'Pilih session terlebih dahulu.';
        return;
    }

    // Teacher hanya boleh manual attendance pada session ACTIVE (Admin boleh ACTIVE maupun ARCHIVED).
    // UX guard saja — enforcement sesungguhnya ada di firestore.rules.
    if (!isAdmin && currentDashboardSessionStatus !== 'ACTIVE') {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = '❌ Teacher hanya boleh input manual attendance pada session yang sedang ACTIVE.';
        return;
    }

    msgEl.className = 'alert alert-warning';
    msgEl.style.display = 'block';
    msgEl.textContent = '⏳ Memproses...';

    try {
        const sessionIdForManual = currentDashboardSessionId;
        const dateForManual = currentDashboardSessionDate || getJakartaDateStr();
        const docId = `${targetUid}_${sessionIdForManual}`;
        const attendanceRef = doc(db, 'attendance', docId);

        const existingSnap = await getDoc(attendanceRef);

        if (existingSnap.exists()) {
            // ===== PATH: UPDATE (koreksi attendance existing) =====
            // WAJIB updateDoc({ status }) saja — tidak boleh setDoc ulang, supaya
            // createdAt dan field identitas lain (uid/tanggal/classId/sessionId/method) tidak berubah.
            const existingData = existingSnap.data();
            console.log('[MANUAL DEBUG UPDATE]', { teacherClassId: userData.classId, targetUid, existingClassId: existingData.classId, sessionId: sessionIdForManual, existingData });

            if (!isAdmin && existingData.classId !== userData.classId) {
                msgEl.className = 'alert alert-danger';
                msgEl.textContent = '❌ Siswa ini bukan bagian dari kelas Anda.';
                return;
            }

            await updateDoc(attendanceRef, { status: status });

            msgEl.className = 'alert alert-success';
            msgEl.textContent = `✅ Status attendance berhasil dikoreksi menjadi ${status}.`;

        } else {
            // ===== PATH: CREATE (attendance manual baru) =====
            const targetDoc = await getDoc(doc(db, 'users', targetUid));
            if (!targetDoc.exists()) {
                throw new Error('Target user not found');
            }
            const targetData = targetDoc.data();
            console.log('[MANUAL DEBUG TARGET]', { targetUid, targetName: targetData.nama, targetClassId: targetData.classId, teacherClassId: userData.classId, sessionId: sessionIdForManual });

            // ===== VALIDASI CLASSID TARGET STUDENT =====
            if (!targetData.classId) {
                msgEl.className = 'alert alert-danger';
                msgEl.textContent = '❌ Siswa ini belum memiliki kelas. Harap update profile siswa terlebih dahulu.';
                return;
            }

            if (!isAdmin && targetData.classId !== userData.classId) {
                msgEl.className = 'alert alert-danger';
                msgEl.textContent = '❌ Siswa ini bukan bagian dari kelas Anda.';
                return;
            }

            await setDoc(attendanceRef, {
                uid: targetUid,
                tanggal: dateForManual,
                status: status,
                classId: targetData.classId,  // ← Langsung pakai, tanpa fallback
                sessionId: sessionIdForManual,
                method: 'manual',
                createdAt: serverTimestamp()
            });

            msgEl.className = 'alert alert-success';
            msgEl.textContent = `✅ Status ${status} berhasil ditetapkan untuk ${targetData.nama || targetUid}.`;
        }

        await loadAttendanceData();
        await populateManualStudentDropdown(userData);

    } catch (error) {
        console.error('Manual status error:', error);
        msgEl.className = 'alert alert-danger';
        if (error.code === 'permission-denied') {
            msgEl.textContent = '❌ Anda tidak memiliki izin untuk menetapkan status ini.';
        } else {
            msgEl.textContent = `❌ Gagal menetapkan status: ${error.message}`;
        }
    }
}

// ===== Load Class Options =====
async function loadClassOptions() {
    const select = document.getElementById('filterClass');

    try {
        const snapshot = await getDocs(collection(db, 'users'));
        console.log('[MANUAL] users snapshot size:', snapshot.size);
        const classes = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();

            if (data.classId) {
                classes.add(data.classId);
            }
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
// CATATAN REDESIGN: sumber kebenaran filter attendance sekarang `currentDashboardSessionId`
// (diisi oleh initSessionSelector()/dropdown filterSession), BUKAN tanggal. Tidak ada lagi
// `filterDate` — dihapus sepenuhnya dari UI, supaya tidak ada 2 sumber kebenaran.
async function loadAttendanceData() {
    const cls = document.getElementById('filterClass').value;
    const status = document.getElementById('filterStatus').value;
    const nama = document.getElementById('filterNama').value.toLowerCase();

    const container = document.getElementById('attendanceTableContainer');

    if (!currentDashboardSessionId) {
        container.innerHTML = `<p class="state-message">Pilih session terlebih dahulu.</p>`;
        attendanceFilteredData = [];
        updateSummary([]);
        return;
    }

    container.innerHTML = `<p class="state-message">⏳ Memuat data...</p>`;

    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const userList = [];

        usersSnapshot.forEach(d => {
            const data = d.data();

            userList.push({
                uid: d.id,
                nama: data.nama || 'Unknown',
                classId: data.classId || '-',
                role: data.role || 'student'
            });
        });

        let q = collection(db, 'attendance');
        let constraints = [where('sessionId', '==', currentDashboardSessionId)];

        if (cls) {
            constraints.push(where('classId', '==', cls));
        }

        if (status && status !== 'BELUM_ABSEN') {
            constraints.push(where('status', '==', status));
        }

        const snapshot = await getDocs(query(q, ...constraints));

        let attendanceData = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        let fullData = userList.map(user => {
            const att = attendanceData.find(d => d.uid === user.uid);

            let jam = '-';

            if (att && att.createdAt) {
                jam = formatTimestampToWIBTime(att.createdAt);
            }

            return {
                uid: user.uid,
                nama: user.nama,
                classId: user.classId,
                tanggal: att ? att.tanggal : (currentDashboardSessionDate || '-'),
                jam: jam,
                status: att ? att.status : 'BELUM_ABSEN',
                sessionId: att ? att.sessionId : currentDashboardSessionId,
                method: att ? att.method : '-',
                createdAt: att ? att.createdAt : null,
                role: user.role
            };
        });

        if (cls) {
            fullData = fullData.filter(d => d.classId === cls);
        }

        if (nama) {
            fullData = fullData.filter(d => d.nama.toLowerCase().includes(nama));
        }

        if (status) {
            fullData = fullData.filter(d => d.status === status);
        }

        // FILTER: HANYA user dengan role 'student' yang boleh masuk laporan
        attendanceFilteredData = fullData.filter(d => d.role === 'student');

        if (attendanceFilteredData.length === 0) {
            container.innerHTML = `<p class="state-message">Tidak ada data absensi untuk filter ini.</p>`;
            updateSummary([]);
            return;
        }

        let html = `
            <div class="table-responsive">
            <table class="attendance-table">
                <thead>
                    <tr>
                        <th>No</th>
                        <th>Nama</th>
                        <th>Kelas</th>
                        <th>Tanggal</th>
                        <th>Jam</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
        `;

        attendanceFilteredData.forEach((d, i) => {
            const statusClass = `status-${d.status}`;

            html += `
                <tr>
                    <td>${i + 1}</td>
                    <td>${d.nama}</td>
                    <td>${d.classId}</td>
                    <td>${d.tanggal}</td>
                    <td>${d.jam}</td>
                    <td>
                        <span class="status-label ${statusClass}">
                            ${d.status === 'BELUM_ABSEN' ? 'BELUM ABSEN' : d.status}
                        </span>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        updateSummary(attendanceFilteredData);

    } catch (error) {
        console.error("Error loading attendance:", error);
        container.innerHTML = `<p class="state-message state-error">❌ Gagal memuat data. Silakan coba lagi.</p>`;
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
    const belum = data.filter(d => d.status === 'BELUM_ABSEN').length;

    document.getElementById('sumTotal').textContent = total;
    document.getElementById('sumHadir').textContent = hadir;
    document.getElementById('sumTerlambat').textContent = terlambat;
    document.getElementById('sumIzin').textContent = izin;
    document.getElementById('sumSakit').textContent = sakit;
    document.getElementById('sumAlfa').textContent = alfa;
    document.getElementById('sumBelum').textContent = belum;
}

// ===== Export to Excel (XLSX) =====
async function exportToExcel() {
    if (!attendanceFilteredData || attendanceFilteredData.length === 0) {
        alert('Tidak ada data untuk diekspor.');
        return;
    }

    if (typeof ExcelJS === 'undefined') {
        alert('Library Excel belum termuat. Coba refresh halaman.');
        return;
    }

    const statusColors = {
        HADIR: 'FFD4EDDA',
        TERLAMBAT: 'FFFFF3CD',
        IZIN: 'FFD1ECF1',
        SAKIT: 'FFF8D7DA',
        ALFA: 'FFE2E3E5',
        BELUM_ABSEN: 'FFE2E3E5'
    };

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Absensi');

    sheet.columns = [
        { header: 'No', key: 'no', width: 6 },
        { header: 'Nama', key: 'nama', width: 30 },
        { header: 'Kelas', key: 'classId', width: 12 },
        { header: 'Tanggal', key: 'tanggal', width: 14 },
        { header: 'Jam', key: 'jam', width: 10 },
        { header: 'Status', key: 'status', width: 16 }
    ];

    attendanceFilteredData.forEach((d, i) => {
        sheet.addRow({
            no: i + 1,
            nama: d.nama,
            classId: d.classId,
            tanggal: d.tanggal,
            jam: d.jam,
            status: d.status === 'BELUM_ABSEN' ? 'BELUM ABSEN' : d.status
        });
    });

    // Header styling
    const headerRow = sheet.getRow(1);

    headerRow.height = 22;

    headerRow.eachCell(cell => {
        cell.font = {
            bold: true,
            color: { argb: 'FFFFFFFF' }
        };

        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4285F4' }
        };

        cell.alignment = {
            horizontal: 'center',
            vertical: 'middle'
        };

        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });

    // Data styling
    const alignMap = {
        no: 'center',
        nama: 'left',
        classId: 'center',
        tanggal: 'center',
        jam: 'center',
        status: 'center'
    };

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        row.eachCell((cell, colNumber) => {
            const key = sheet.columns[colNumber - 1].key;

            cell.alignment = {
                horizontal: alignMap[key] || 'center',
                vertical: 'middle'
            };

            cell.border = {
                top: {
                    style: 'thin',
                    color: { argb: 'FFDDDDDD' }
                },
                left: {
                    style: 'thin',
                    color: { argb: 'FFDDDDDD' }
                },
                bottom: {
                    style: 'thin',
                    color: { argb: 'FFDDDDDD' }
                },
                right: {
                    style: 'thin',
                    color: { argb: 'FFDDDDDD' }
                }
            };
        });

        const originalStatus = attendanceFilteredData[rowNumber - 2]?.status;
        const color = statusColors[originalStatus];

        if (color) {
            row.getCell('status').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: color }
            };
        }
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    sheet.autoFilter = {
        from: {
            row: 1,
            column: 1
        },
        to: {
            row: 1,
            column: 6
        }
    };

    const buffer = await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `absensi_${currentDashboardSessionId || getJakartaDateStr()}.xlsx`;
    link.click();
}

// ===== Admin: Cek Session yang Sedang ACTIVE =====
// CATATAN REDESIGN: sebelumnya function ini membaca attendanceSessions/{tanggal}.
// Sekarang sessionId TIDAK LAGI berbasis tanggal, jadi satu-satunya cara benar
// untuk tahu "session apa yang sedang berlaku" adalah query status == 'ACTIVE'.
// Nama function TETAP dipertahankan (checkTodaySession) untuk meminimalkan diff —
// hanya isi/behavior yang berubah.
async function checkTodaySession() {
    const statusMsg = document.getElementById('sessionStatusMessage');

    console.log('[ADMIN] sebelum query session ACTIVE');
    const activeQuery = query(collection(db, 'attendanceSessions'), where('status', '==', 'ACTIVE'), limit(1));
    const activeQuerySnap = await getDocs(activeQuery);
    console.log('[ADMIN] sesudah query session ACTIVE', !activeQuerySnap.empty);

    if (!activeQuerySnap.empty) {
        const sessionSnap = activeQuerySnap.docs[0];
        const data = sessionSnap.data();
        const sid = resolveSessionId(sessionSnap);

        const start = data.startTime.toDate();
        const late = data.lateAfter.toDate();
        const end = data.endTime.toDate();

        const startStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
        const lateStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(late);
        const endStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(end);

        statusMsg.className = 'alert alert-info';
        statusMsg.style.display = 'block';

        statusMsg.innerHTML = `
            Session aktif saat ini: <strong>${sid}</strong> (${data.date}) —
            ${startStr} - ${lateStr} - ${endStr}.
            Klik tombol di atas untuk membuat sesi baru (sesi ini akan diarsipkan).
        `;

    } else {
        statusMsg.style.display = 'none';
    }
}

// ===== Admin: Handle Create Session Baru (archive lama + create baru, ATOMIK) =====
// CATATAN REDESIGN: sebelumnya function ini overwrite attendanceSessions/{tanggal}.
// Sekarang SELALU membuat dokumen session_NNN baru (ID dari counter), dan meng-arsipkan
// session ACTIVE lama (jika ada) — dalam SATU Firestore transaction supaya tidak pernah
// ada kondisi 2 session ACTIVE sekaligus jika salah satu write gagal.
async function handleCreateSession() {
    const today = getJakartaDateStr();

    const startVal = document.getElementById('inputStartTime').value;
    const lateVal = document.getElementById('inputLateTime').value;
    const endVal = document.getElementById('inputEndTime').value;
    const statusMsg = document.getElementById('sessionStatusMessage');

    if (!startVal || !lateVal || !endVal) {
        statusMsg.className = 'alert alert-danger';
        statusMsg.style.display = 'block';
        statusMsg.textContent = 'Harap isi semua jam.';
        return;
    }

    // ===== TIMEZONE FIX (DIPERTAHANKAN, TIDAK BOLEH DIUBAH) =====
    // Bangun Timestamp dari komponen tanggal WIB `today`, BUKAN dari
    // UTC-day "sekarang" — supaya hasil selalu jatuh pada tanggal WIB
    // yang sama dengan `today`, berapa pun jam saat tombol ini ditekan.
    const [yy, mm, dd] = today.split('-').map(Number);

    function wibTimeToTimestamp(hh, min) {
        return Timestamp.fromMillis(Date.UTC(yy, mm - 1, dd, hh - 7, min, 0, 0));
    }

    const [h, m] = startVal.split(':').map(Number);
    const startTimestamp = wibTimeToTimestamp(h, m);

    const [h2, m2] = lateVal.split(':').map(Number);
    const lateTimestamp = wibTimeToTimestamp(h2, m2);

    const [h3, m3] = endVal.split(':').map(Number);
    const endTimestamp = wibTimeToTimestamp(h3, m3);
    // ===== END TIMEZONE FIX =====

    if (
        startTimestamp.toDate() >= lateTimestamp.toDate() ||
        lateTimestamp.toDate() >= endTimestamp.toDate()
    ) {
        statusMsg.className = 'alert alert-danger';
        statusMsg.style.display = 'block';
        statusMsg.textContent = 'Urutan waktu salah: Start < Late < End.';
        return;
    }

    const counterRef = doc(db, 'settings', 'sessionCounter');

    try {
        const newSessionId = await runTransaction(db, async (transaction) => {
            // ===== SEMUA READ DULU (syarat Firestore transaction) =====
            const counterSnap = await transaction.get(counterRef);
            const lastNumber = counterSnap.exists() ? (counterSnap.data().lastNumber || 0) : 0;
            const oldActiveSessionId = counterSnap.exists() ? (counterSnap.data().activeSessionId || null) : null;

            let oldSessionRef = null;
            let oldSessionSnap = null;
            if (oldActiveSessionId) {
                oldSessionRef = doc(db, 'attendanceSessions', oldActiveSessionId);
                oldSessionSnap = await transaction.get(oldSessionRef);
            }

            // ===== BARU SETELAH ITU WRITE =====
            const newNumber = lastNumber + 1;
            const newSessionId = `session_${String(newNumber).padStart(3, '0')}`;
            const newSessionRef = doc(db, 'attendanceSessions', newSessionId);

            // Arsipkan session ACTIVE lama HANYA jika memang masih ACTIVE saat dibaca
            // (defense in depth — mencegah archive dokumen yang statusnya sudah berubah).
            if (oldSessionRef && oldSessionSnap && oldSessionSnap.exists() && oldSessionSnap.data().status === 'ACTIVE') {
                transaction.update(oldSessionRef, { status: 'ARCHIVED' });
            }

            transaction.set(newSessionRef, {
                sessionId: newSessionId,
                date: today,
                startTime: startTimestamp,
                lateAfter: lateTimestamp,
                endTime: endTimestamp,
                status: 'ACTIVE',
                createdAt: serverTimestamp()
            });

            transaction.set(counterRef, {
                lastNumber: newNumber,
                activeSessionId: newSessionId
            }, { merge: true });

            return newSessionId;
        });

        statusMsg.className = 'alert alert-success';
        statusMsg.style.display = 'block';
        statusMsg.textContent = `✅ Sesi ${newSessionId} berhasil dibuat & diaktifkan! Sesi sebelumnya (jika ada) sudah diarsipkan.`;

        // Refresh status panel admin + dropdown session + tabel dashboard
        await checkTodaySession();
        await initSessionSelector();

    } catch (error) {
        console.error(error);

        statusMsg.className = 'alert alert-danger';
        statusMsg.style.display = 'block';
        statusMsg.textContent = 'Gagal membuat sesi. Periksa Firestore Rules.';
    }
}

// ============================================
// USER MANAGEMENT (PHASE 7)
// ============================================

// Hardcoded class list sesuai request (digunakan juga di Profile Setup)
const CLASS_LIST = [
    'x.1', 'x.2', 'x.3', 'x.4',
    'xi.1', 'xi.2', 'xi.3', 'xi.4',
    'xii.1', 'xii.2', 'xii.3', 'xii.4', 'xii.5'
];

// Load user management data
async function loadUserManagementData() {
    const content = document.getElementById('umContent');

    content.innerHTML = `<p class="state-message">⏳ Memuat data user...</p>`;

    try {
        const snapshot = await getDocs(collection(db, 'users'));
        console.log('[MANUAL] users snapshot size:', snapshot.size);

        umData = snapshot.docs.map(d => ({
            uid: d.id,
            ...d.data()
        }));

        // Filter out any users without nama (just in case)
        umData = umData.filter(u => u.nama);

        renderUserManagement();

    } catch (error) {
        console.error("Error loading user management data:", error);
        content.innerHTML = `<p class="state-message state-error">❌ Gagal memuat data user. Silakan coba lagi.</p>`;
    }
}

// Render user management UI
function renderUserManagement() {
    const container = document.getElementById('umContent');

    // Apply filters
    const namaFilter = document.getElementById('umFilterNama')?.value?.toLowerCase() || '';
    const kelasFilter = document.getElementById('umFilterKelas')?.value || '';
    const roleFilter = document.getElementById('umFilterRole')?.value || '';

    umFilteredData = umData.filter(u => {
        const matchNama = u.nama.toLowerCase().includes(namaFilter);
        const matchKelas = !kelasFilter || u.classId === kelasFilter;
        const matchRole = !roleFilter || u.role === roleFilter;

        return matchNama && matchKelas && matchRole;
    });

    // Build filter UI
    const filterUI = `
        <div class="filter-container">
            <input type="text" id="umFilterNama" placeholder="Cari nama..." value="${namaFilter}">

            <select id="umFilterKelas">
                <option value="">Semua Kelas</option>
                ${CLASS_LIST.map(c => `
                    <option value="${c}" ${c === kelasFilter ? 'selected' : ''}>
                        ${c}
                    </option>
                `).join('')}
            </select>

            <select id="umFilterRole">
                <option value="">Semua Role</option>
                <option value="student" ${roleFilter === 'student' ? 'selected' : ''}>Siswa</option>
                <option value="casis" ${roleFilter === 'casis' ? 'selected' : ''}>Casis</option>
                <option value="teacher" ${roleFilter === 'teacher' ? 'selected' : ''}>Guru</option>
                <option value="admin" ${roleFilter === 'admin' ? 'selected' : ''}>Admin</option>
            </select>

            <button id="umApplyFilterBtn" class="btn btn-primary">
                Filter
            </button>

            <button id="umResetFilterBtn" class="btn btn-secondary">
                Reset
            </button>
        </div>
    `;

    // Build table
    let tableHTML = `
        <div class="table-responsive">
        <table class="um-table">
            <thead>
                <tr>
                    <th>No</th>
                    <th>Nama</th>
                    <th>Kelas</th>
                    <th>Role</th>
                    <th>NIS</th>
                    <th>Aksi</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (umFilteredData.length === 0) {
        tableHTML += `
            <tr>
                <td colspan="6" class="state-message">
                    Tidak ada user ditemukan.
                </td>
            </tr>
        `;
    } else {
        umFilteredData.forEach((u, i) => {
            tableHTML += `
                <tr>
                    <td>${i + 1}</td>
                    <td>${u.nama || '-'}</td>
                    <td>${u.classId || '-'}</td>
                    <td>${ROLE_LABEL[u.role] || u.role || '-'}</td>
                    <td>${u.nis || '-'}</td>
                    <td>
                        ${
                            u.role === 'casis'
                                ? `
                                    <button class="btn-approve" data-uid="${u.uid}">
                                        ✅ Approve
                                    </button>
                                    <button class="btn-reject" data-uid="${u.uid}">
                                        ❌ Tolak
                                    </button>
                                `
                                : `
                                    <button class="btn-edit" data-uid="${u.uid}">
                                        ✏️ Edit
                                    </button>
                                `
                        }
                    </td>
                </tr>
            `;
        });
    }

    tableHTML += `</tbody></table></div>`;

    container.innerHTML = `
        ${filterUI}
        ${tableHTML}
    `;

    // Attach listeners
    document.getElementById('umApplyFilterBtn').onclick = renderUserManagement;

    document.getElementById('umResetFilterBtn').onclick = () => {
        document.getElementById('umFilterNama').value = '';
        document.getElementById('umFilterKelas').value = '';
        document.getElementById('umFilterRole').value = '';

        renderUserManagement();
    };

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.onclick = () => openEditModal(btn.dataset.uid);
    });

    // ===== APPROVE CASIS =====
    document.querySelectorAll('.btn-approve').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const user = umData.find(u => u.uid === uid);

            if (!user) return;

            if (!confirm(`Approve ${user.nama || 'casis ini'} menjadi Siswa?`)) {
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Memproses...';

                await updateDoc(doc(db, 'users', uid), {
                    role: 'student',
                    updatedAt: serverTimestamp()
                });

                alert(`✅ ${user.nama || 'Casis'} berhasil disetujui menjadi Siswa.`);

                await loadUserManagementData();

            } catch (error) {
                console.error('[CASIS APPROVE ERROR]', error);

                alert(
                    `❌ Gagal approve casis.\n\n` +
                    `Kode: ${error.code || 'N/A'}\n` +
                    `Pesan: ${error.message || error}`
                );

                btn.disabled = false;
                btn.textContent = '✅ Approve';
            }
        };
    });

    // ===== TOLAK CASIS =====
    document.querySelectorAll('.btn-reject').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const user = umData.find(u => u.uid === uid);

            if (!user) return;

            if (!confirm(
                `Tolak dan hapus pendaftaran ${user.nama || 'casis ini'}?\n\n` +
                `Data pendaftaran akan dihapus dari database.`
            )) {
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Menghapus...';

                await deleteDoc(doc(db, 'users', uid));

                alert(
                    `🗑️ Pendaftaran ${user.nama || 'Casis'} berhasil ditolak dan dihapus.`
                );

                await loadUserManagementData();

            } catch (error) {
                console.error('[CASIS REJECT ERROR]', error);

                alert(
                    `❌ Gagal menghapus pendaftaran.\n\n` +
                    `Kode: ${error.code || 'N/A'}\n` +
                    `Pesan: ${error.message || error}`
                );

                btn.disabled = false;
                btn.textContent = '❌ Tolak';
            }
        };
    });
}

// Open edit modal
function openEditModal(uid) {
    const user = umData.find(u => u.uid === uid);

    if (!user) return;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'editUserModal';

    const roleOptions = ['student', 'teacher', 'admin'].map(r =>
        `<option value="${r}" ${user.role === r ? 'selected' : ''}>
            ${ROLE_LABEL[r]}
        </option>`
    ).join('');

    modal.innerHTML = `
        <div class="modal-content">
            <h3>✏️ Edit User</h3>

            <form id="editUserForm">
                <label>Nama:</label>
                <input type="text" id="editNama" value="${user.nama || ''}" required>

                <label>Kelas:</label>
                <select id="editKelas">
                    <option value="">-- Pilih Kelas --</option>
                    ${CLASS_LIST.map(c => `
                        <option value="${c}" ${user.classId === c ? 'selected' : ''}>
                            ${c}
                        </option>
                    `).join('')}
                </select>

                <label>NIS (Opsional):</label>
                <input type="text" id="editNis" value="${user.nis || ''}">

                <label>Role:</label>
                <select id="editRole">
                    ${roleOptions}
                </select>

                <div class="modal-actions">
                    <button type="button" id="cancelEditBtn" class="btn-secondary">
                        Batal
                    </button>

                    <button type="submit" id="saveEditBtn" class="btn-primary">
                        Simpan
                    </button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    // Attach listeners
    document.getElementById('cancelEditBtn').onclick = () => modal.remove();

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    document.getElementById('editUserForm').onsubmit = async (e) => {
        e.preventDefault();

        const nama = document.getElementById('editNama').value.trim();
        const classId = document.getElementById('editKelas').value || null;
        const nis = document.getElementById('editNis').value.trim() || null;
        const role = document.getElementById('editRole').value;

        if (!nama) {
            alert('Nama wajib diisi.');
            return;
        }

        try {
            await setDoc(doc(db, 'users', uid), {
                nama,
                classId,
                nis,
                role,
                updatedAt: serverTimestamp()
            }, { merge: true });

            modal.remove();
            alert('✅ User berhasil diperbarui!');
            loadUserManagementData();

        } catch (error) {
            console.error("Error updating user:", error);

            const errorDetails = `Kode: ${error.code || 'N/A'}, Pesan: ${error.message || error}`;

            alert(`❌ Gagal memperbarui user.\n\nDetail Error:\n${errorDetails}`);
        }
    };
}

// ===== Auth Listener =====
onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (window.location.pathname === '/absen') {
        await processAbsenPage(user);
        return;
    }

    if (user) {
        // ===== AUTH GATE: Intended-route restoration =====
        // Kalau user baru saja login (popup) setelah di-redirect dari /absen
        // (lihat processAbsenPage STEP 1), kembalikan ke route itu SEBELUM
        // merender dashboard di '/'. Single-use (removeItem) supaya tidak ada
        // redirect loop, dan login normal dari '/' (tanpa route tersimpan)
        // tetap berjalan seperti sebelumnya karena getItem() akan null.
        const pendingRedirect = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
        if (pendingRedirect) {
            sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
            window.location.href = pendingRedirect;
            return;
        }

        console.log('[ABSEN] sebelum getDoc users');
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    console.log('[ABSEN] sesudah getDoc users', userDoc.exists(), userDoc.data());


        if (!userDoc.exists()) {
            showSection(profileSetupSection);
            setupProfileForm(user);
            return;
        }

        const userData = userDoc.data();

        if (userData.role === 'casis') {
            showSection(dashboardSection);
            await renderCasisDashboard(userData);
            return;
        }

        showSection(dashboardSection);
        await renderDashboard(userData);

    } else {
        showSection(loginSection);
    }
});

// ===== Profile Setup (dengan CLASS_LIST) =====
function setupProfileForm(user) {
    if (user.displayName) {
        profileNama.value = user.displayName;
    }

    // Ganti input text kelas menjadi dropdown
    const kelasInput = document.getElementById('profileKelas');

    if (kelasInput) {
        const parent = kelasInput.parentNode;

        // Buat elemen dropdown
        const select = document.createElement('select');
        select.id = 'profileKelas';
        select.style.cssText = 'width:100%; padding:8px; margin-top:4px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;';

        // Tambahkan opsi default
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Pilih Kelas --';
        select.appendChild(defaultOpt);

        // Tambahkan 13 kelas
        CLASS_LIST.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.textContent = cls;
            select.appendChild(opt);
        });

        // Ganti input dengan dropdown
        parent.replaceChild(select, kelasInput);
    }

    profileForm.onsubmit = async (e) => {
        e.preventDefault();

        const nama = profileNama.value.trim();
        const classId = document.getElementById('profileKelas').value.trim() || null;

        // Validasi kelas wajib dipilih
        if (!classId) {
            alert('Kelas wajib dipilih.');
            return;
        }

        if (!nama) {
            return alert('Nama wajib diisi');
        }

        try {
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                nama,
                email: user.email || null,
                classId,
                role: 'casis',
                updatedAt: serverTimestamp()
            }, { merge: true });

            alert('Profil tersimpan!');

            // Reload untuk memicu onAuthStateChanged dan melanjutkan ke absen
            window.location.reload();

        } catch (e) {
            alert('Gagal menyimpan.');
        }
    };
}

// ===== Attendance Result =====
function showAttendanceResult(success, data) {
    if (success) {
        // Tampilkan SUCCESS SCREEN
        showSection(successScreenSection);

        // Tombol logout di success screen
        document.getElementById('successBackBtn').onclick = () => {
            if (currentUser) {
                showSection(dashboardSection);
            } else {
                window.location.href = '/';
            }
        };

        document.getElementById('successLogoutBtn').onclick = async () => {
            try {
                await signOut(auth);
                window.location.href = '/';
            } catch (e) {
                console.error('Logout error:', e);
            }
        };

        return;
    }

    // GAGAL - tampilkan error di attendanceResultSection (existing behavior)
    showSection(attendanceResultSection);
    attendanceResultTitle.className = 'error';

    let msg = '❌ Gagal melakukan absensi.';
    if (data.error?.includes('SESSION_NOT_FOUND')) {
        msg = '⚠️ Session tidak ditemukan.';
    } else if (data.error?.includes('SESSION_ARCHIVED')) {
        msg = '🔒 Sesi ini sudah diarsipkan, tidak bisa absen lagi.';
    } else if (data.error?.includes('SESSION_CLOSED')) {
        msg = '⏰ Sesi sudah ditutup.';
    } else if (data.error?.includes('SESSION_NOT_STARTED')) {
        msg = '⏰ Sesi belum dimulai.';
    } else if (data.error?.includes('DUPLICATE')) {
        msg = '⚠️ Maaf, Anda sudah melakukan absensi sebelumnya. Anda tidak perlu melakukan absensi lagi hari ini.';
    } else if (data.error?.includes('permission-denied')) {
        msg = 'Akses ditolak oleh sistem.';
    }

    attendanceResultTitle.textContent = msg;
    attendanceResultData.innerHTML = `<p>${data.error || ''}</p>`;

    goToAbsenBtn.onclick = () => {
        window.location.href = '/absen?session=' + currentSessionId;
    };

    document.getElementById('attendanceErrorLogoutBtn').onclick = async () => {
        try {
            await signOut(auth);
            window.location.href = '/';
        } catch (e) {
            console.error('Logout error:', e);
        }
    };
}

// ===== Auth Actions =====
loginBtn.onclick = async () => {
    try {
        loginBtn.disabled = true;
        loginBtn.textContent = '⏳ Login...';

        await signInWithPopup(auth, provider);

    } catch (e) {
        console.error('[AUTH LOGIN ERROR]', e);
        alert('Login gagal: ' + (e.message || e));

    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login dengan Google';
    }
};

logoutBtn.onclick = async () => {
    try {
        await signOut(auth);
    } catch (e) {
        alert('Logout gagal.');
    }
};

// ===== Back to Dashboard Button (User Management) =====
document.getElementById('backToDashboardBtn').onclick = async () => {
    if (!currentUser) {
        showSection(loginSection);
        return;
    }

    try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            showSection(dashboardSection);
            await renderDashboard(userDoc.data());
        } else {
            showSection(profileSetupSection);
            setupProfileForm(currentUser);
        }

    } catch (error) {
        console.error("Error returning to dashboard:", error);
        alert('Gagal kembali ke dashboard.');
    }
};

console.log("✅ Foundation URL-Based siap (Phase 7).");