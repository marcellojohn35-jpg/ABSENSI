console.log("Sistem Absensi URL-Based aktif (Phase 7).");

import {
    auth,
    authPersistenceReady,
    db,
    provider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    onAuthStateChanged,
    signOut
} from './firebase-config.js?v=3';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, collection, query, where, getDocs, orderBy, limit, deleteDoc, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

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
const tugasSection = $('tugasSection');

const absenContent = $('absenContent');
const absenStatus = $('absenStatus');
const sessionInfoDisplay = $('sessionInfoDisplay');
const absenActionArea = $('absenActionArea');
const absenNowBtn = $('absenNowBtn');
const absenProfileInfo = $('absenProfileInfo');

const loginBtn = $('loginBtn');
const logoutBtn = $('logoutBtn');
const userPhoto = $('userPhoto');
const userAvatar = $('userAvatar');
const userAvatarInitials = $('userAvatarInitials');
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
let umSelectedCasisUids = new Set();
let attendanceFilteredData = [];

// ===== MANUAL ATTENDANCE MULTI SELECT STATE =====
let manualStudents = [];
let manualSelectedStudentUids = new Set();

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

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[char]);
}

function isMobileAuthDevice() {
    return window.matchMedia('(max-width: 768px)').matches
        || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getAuthErrorMessage(error) {
    const code = String(error?.code || '');

    if (code.includes('popup-closed-by-user')) {
        return 'Login dibatalkan sebelum selesai. Silakan coba kembali.';
    }

    if (code.includes('popup-blocked')) {
        return 'Popup login diblokir browser. Izinkan popup atau coba kembali.';
    }

    if (code.includes('cancelled-popup-request')) {
        return 'Permintaan login sebelumnya dibatalkan. Silakan coba kembali.';
    }

    if (code.includes('unauthorized-domain')) {
        return 'Domain website belum diizinkan di Firebase Authentication.';
    }

    if (code.includes('network-request-failed')) {
        return 'Koneksi internet bermasalah. Periksa jaringan lalu coba kembali.';
    }

    return 'Login Google gagal. Silakan coba kembali.';
}

function isInactiveAccount(userData) {
    return ['INACTIVE', 'DELETED'].includes(userData?.accountStatus);
}

async function rejectInactiveAccount() {
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);

    alert(
        'Akun ini sedang dinonaktifkan. Hubungi admin sekolah jika ini merupakan kesalahan.'
    );

    await signOut(auth);

    if (window.location.pathname !== '/') {
        window.location.href = '/';
    }
}

// Membaca hasil login redirect setelah browser kembali dari Google.
getRedirectResult(auth).catch(error => {
    console.error('[AUTH REDIRECT ERROR]', error);
    alert(getAuthErrorMessage(error));
});

function showSection(id) {
    // Menggunakan class "hidden" (bukan inline style.display) supaya tiap section
    // tetap memakai display mode aslinya dari CSS (flex untuk auth-page, block
    // untuk dashboard-page) alih-alih dipaksa "block" oleh inline style.
    [loadingState, loginSection, dashboardSection, profileSetupSection, attendanceResultSection, absenSection, userManagementContainer, successScreenSection, tugasSection].forEach(el => el.classList.add('hidden'));
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

function formatAttendanceDate(dateValue) {
    if (!dateValue || dateValue === '-') return '-';

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    if (!match) return dateValue;

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(date).replace(/\./g, '');
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

    // STEP 3: CEK STATUS DAN ROLE
    const uData = userDoc.data();

    if (isInactiveAccount(uData)) {
        await rejectInactiveAccount();
        return;
    }

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
            <p><strong>Nama:</strong> ${escapeHtml(uData.nama || 'Belum diisi')}</p>
            <p><strong>Kelas:</strong> ${escapeHtml(uData.classId || 'Belum diisi')}</p>
        `;
        return;
    }

    const hourWIB = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            hour12: false
        }).format(new Date())
    );

    let greeting = 'Halo';

    if (hourWIB >= 4 && hourWIB < 11) {
        greeting = 'Selamat pagi';
    } else if (hourWIB >= 11 && hourWIB < 15) {
        greeting = 'Selamat siang';
    } else if (hourWIB >= 15 && hourWIB < 18) {
        greeting = 'Selamat sore';
    } else {
        greeting = 'Selamat malam';
    }

    absenStatus.innerHTML = `
        <span class="student-greeting">
            ${greeting}, ${escapeHtml(uData.nama || 'Siswa')} 👋
        </span>
        <span class="student-reminder">
            Siap memulai hari? Catat kehadiranmu sekarang.
        </span>
    `;

    absenActionArea.style.display = 'block';

    // Tampilkan info user yang sedang absen
    absenProfileInfo.style.display = 'block';

    absenProfileInfo.innerHTML = `
        <p><strong>Nama:</strong> ${escapeHtml(uData.nama || 'Belum diisi')}</p>
        <p><strong>Kelas:</strong> ${escapeHtml(uData.classId || 'Belum diisi')}</p>
    `;
}


// ===== GEOLOCATION CONFIG (RELIABLE LOBBY CHECK) =====
const GEOLOCATION_CONFIG = {
    enabled: true,
    targetLat: -6.263838,
    targetLng: 106.916585,
    radiusMeters: 25,
    maxAcceptableAccuracyMeters: 50,
    excellentAccuracyMeters: 20,
    watchTimeoutMs: 12000
};

function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function verifyAttendanceLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('GEOLOCATION_NOT_SUPPORTED'));
            return;
        }

        let watchId = null;
        let timeoutId = null;
        let finished = false;
        let bestReading = null;

        const cleanup = () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }

            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        };

        const finishResolve = value => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve(value);
        };

        const finishReject = error => {
            if (finished) return;
            finished = true;
            cleanup();
            reject(error);
        };

        const classifyBestReading = () => {
            if (!bestReading) {
                finishReject(new Error('GEOLOCATION_ERROR:3'));
                return;
            }

            const { accuracy, distance } = bestReading;

            if (accuracy > GEOLOCATION_CONFIG.maxAcceptableAccuracyMeters) {
                finishReject(new Error(
                    `LOCATION_ACCURACY_LOW:${Math.round(accuracy)}:${Math.round(distance)}`
                ));
                return;
            }

            if (distance <= GEOLOCATION_CONFIG.radiusMeters) {
                finishResolve(bestReading);
                return;
            }

            const nearestPossibleDistance =
                Math.max(0, distance - accuracy);

            if (nearestPossibleDistance > GEOLOCATION_CONFIG.radiusMeters) {
                finishReject(new Error(
                    `OUTSIDE_ATTENDANCE_AREA:${Math.round(distance)}:${Math.round(accuracy)}`
                ));
                return;
            }

            finishReject(new Error(
                `LOCATION_ACCURACY_LOW:${Math.round(accuracy)}:${Math.round(distance)}`
            ));
        };

        watchId = navigator.geolocation.watchPosition(
            position => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const rawAccuracy = Number(position.coords.accuracy);

                const accuracy =
                    Number.isFinite(rawAccuracy)
                        ? rawAccuracy
                        : Infinity;

                const distance = getDistanceMeters(
                    lat,
                    lng,
                    GEOLOCATION_CONFIG.targetLat,
                    GEOLOCATION_CONFIG.targetLng
                );

                const reading = {
                    latitude: lat,
                    longitude: lng,
                    accuracy,
                    distance
                };

                if (
                    !bestReading ||
                    reading.accuracy < bestReading.accuracy ||
                    (
                        reading.accuracy === bestReading.accuracy &&
                        reading.distance < bestReading.distance
                    )
                ) {
                    bestReading = reading;
                }

                console.log('[GEOLOCATION SAMPLE]', reading);

                if (
                    reading.accuracy <= GEOLOCATION_CONFIG.excellentAccuracyMeters &&
                    reading.distance <= GEOLOCATION_CONFIG.radiusMeters
                ) {
                    finishResolve(reading);
                }
            },

            error => {
                console.error('[GEOLOCATION ERROR]', error);

                if (error.code === 1) {
                    finishReject(new Error('GEOLOCATION_ERROR:1'));
                    return;
                }

                if (error.code !== 2 && error.code !== 3) {
                    finishReject(
                        new Error(`GEOLOCATION_ERROR:${error.code}`)
                    );
                }
            },

            {
                enableHighAccuracy: true,
                timeout: GEOLOCATION_CONFIG.watchTimeoutMs,
                maximumAge: 0
            }
        );

        timeoutId = setTimeout(
            classifyBestReading,
            GEOLOCATION_CONFIG.watchTimeoutMs
        );
    });
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

        // ===== GEOLOCATION CHECK =====
        if (GEOLOCATION_CONFIG.enabled) {
            absenNowBtn.textContent = "📍 Memeriksa lokasi...";

            const location = await verifyAttendanceLocation();

            console.log('[ABSEN] lokasi valid:', location);

            absenNowBtn.textContent = "⏳ Memproses...";
        }

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
        const attendanceTime = new Intl.DateTimeFormat('id-ID', {
            timeZone: 'Asia/Jakarta',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(new Date());

        showAttendanceResult(true, {
            status,
            tanggal: s.date,
            jam: attendanceTime,
            nama: userData.nama || 'Siswa',
            kelas: userData.classId || '-'
        });

    } catch (error) {
        console.error(error);

        let errorMessage = error.message;

        if (error.code === 'permission-denied') {
            let duplicateConfirmed = false;

            try {
                if (currentUser && currentSessionId) {
                    const existingAttendance = await getDoc(
                        doc(
                            db,
                            'attendance',
                            `${currentUser.uid}_${currentSessionId}`
                        )
                    );

                    duplicateConfirmed = existingAttendance.exists();
                }
            } catch (duplicateCheckError) {
                console.log(
                    '[ABSEN] duplicate check tidak tersedia:',
                    duplicateCheckError?.message || duplicateCheckError
                );
            }

            errorMessage = duplicateConfirmed
                ? 'DUPLICATE_ATTENDANCE'
                : 'PERMISSION_DENIED_ATTENDANCE';
        }

        showAttendanceResult(false, {
            error: errorMessage
        });

    } finally {
        isProcessing = false;
        absenNowBtn.disabled = false;
        absenNowBtn.textContent = "ABSEN SEKARANG";
    }
};

// ===== Render Dashboard CASIS =====
async function renderCasisDashboard(userData) {
    const casisName = userData.nama || 'Pendaftar';
    setUserAvatar(userData.photoURL || currentUser?.photoURL, casisName);
    userName.textContent = casisName;
    userRole.textContent = 'Casis';
    userRole.className = 'role-casis';

    const dashboardContent = document.getElementById('dashboardContent');

    dashboardContent.innerHTML = `
        <h3 class="page-title">Dashboard Casis</h3>

        <div class="card">
            <div class="profile-summary">
                <div class="profile-row">
                    <span class="label">Nama</span>
                    <span class="value">${escapeHtml(userData.nama || '-')}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Kelas</span>
                    <span class="value">${escapeHtml(userData.classId || '-')}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Email</span>
                    <span class="value">${escapeHtml(userData.email || currentUser?.email || '-')}</span>
                </div>

                <div class="profile-row">
                    <span class="label">Status</span>
                    <span class="value">Pendaftar</span>
                </div>
            </div>
        </div>
    `;
}

// ===== User Avatar =====
function setUserAvatar(photoURL, name = 'User') {
    const safeName = String(name || 'User').trim();

    const initials = safeName
        .split(/\\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join('') || '?';

    userAvatarInitials.textContent = initials;

    const showFallback = () => {
        userPhoto.removeAttribute('src');
        userAvatar.classList.add('is-fallback');
    };

    const showPhoto = (url) => {
        userAvatar.classList.remove('is-fallback');
        userPhoto.src = url;
    };

    userPhoto.onerror = showFallback;

    if (photoURL) {
        showPhoto(photoURL);
    } else {
        showFallback();
    }
}

// ===== Render Dashboard =====
const ROLE_LABEL = {
    student: 'Siswa',
    casis: 'Casis',
    teacher: 'Guru',
    admin: 'Admin'
};

async function renderDashboard(userData) {
    const dashboardUserName = userData.nama || 'User';
    setUserAvatar(userData.photoURL || currentUser?.photoURL, dashboardUserName);
    userName.textContent = dashboardUserName;
    userRole.textContent = ROLE_LABEL[userData.role] || userData.role || 'Siswa';
    userRole.className = 'role-' + (userData.role || 'student');

    const dashboardContent = document.getElementById('dashboardContent');

    if (userData.role === 'student') {
        dashboardContent.innerHTML = `
            <h3 class="page-title">Dashboard Siswa</h3>
            <div class="card">
                <div class="profile-summary">
                    <div class="profile-row"><span class="label">Nama</span><span class="value">${escapeHtml(userData.nama || '-')}</span></div>
                    <div class="profile-row"><span class="label">Kelas</span><span class="value">${escapeHtml(userData.classId || '-')}</span></div>
                    <div class="profile-row"><span class="label">Role</span><span class="value">Siswa</span></div>
                </div>
            </div>
            <button id="tugasBtn" class="btn btn-primary btn-block mt-16">
                📚 Lihat Tugas / PR
            </button>
        `;
        const tugasBtnEl = document.getElementById('tugasBtn');
        if (tugasBtnEl) tugasBtnEl.onclick = openTugasPage;
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
            <button id="userManagementBtn" class="btn btn-secondary btn-block mb-8">
                👥 Manajemen User
            </button>
            <button id="tugasBtn" class="btn btn-secondary btn-block mb-16">
                📚 Tugas / PR
            </button>
        `;
    }

    // ===== MANUAL ATTENDANCE PANEL =====
    // Teacher: hanya kelas sendiri + IZIN/SAKIT/ALFA
    // Admin: semua siswa + 5 status
    let teacherManualHTML = '';

    if (userData.role === 'teacher' || userData.role === 'admin') {
        const isAdminPanel = userData.role === 'admin';

        const panelTitle = isAdminPanel
            ? '📝 Manual Attendance (Admin)'
            : '📝 Manual Attendance (Teacher)';

        const panelDesc = isAdminPanel
            ? 'Tetapkan/koreksi status attendance untuk siswa mana pun.'
            : 'Tetapkan/koreksi status IZIN/SAKIT/ALFA untuk siswa di semua kelas.';

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

                <div class="mb-12">
                    <input
                        type="text"
                        id="manualStudentSearch"
                        placeholder="🔍 Cari nama siswa..."
                        autocomplete="off"
                        class="w-full"
                    >
                </div>

                <div class="filter-container mb-12">
                    <select id="manualClassFilter" class="flex-1">
                        <option value="">Semua Kelas</option>
                    </select>

                    <select id="manualAttendanceStatusFilter" class="flex-1">
                        <option value="">Semua Status</option>
                        <option value="BELUM_ABSEN">BELUM ABSEN</option>
                        <option value="HADIR">HADIR</option>
                        <option value="TERLAMBAT">TERLAMBAT</option>
                        <option value="IZIN">IZIN</option>
                        <option value="SAKIT">SAKIT</option>
                        <option value="ALFA">ALFA</option>
                    </select>
                </div>

                <div class="toolbar-row">
                    <label class="checkbox-label">
                        <input type="checkbox" id="manualSelectAll">
                        <span>Pilih Semua Hasil</span>
                    </label>

                    <strong id="manualSelectedCount">0 siswa terpilih</strong>
                </div>

                <div id="manualStudentList" class="scroll-list-box">
                    <div class="text-secondary">Memuat siswa...</div>
                </div>

                <div class="filter-container mb-0">
                    <select id="manualStatusSelect" class="flex-1">
                        <option value="">Pilih Status...</option>
                        ${statusOptionsHTML}
                    </select>

                    <button id="manualSetStatusBtn" class="btn btn-primary">
                        Terapkan ke Siswa Terpilih
                    </button>
                </div>

                <div
                    id="manualStatusMessage"
                    class="alert mt-16"
                    style="display:none;"
                ></div>
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
            <select id="filterSession" class="filter-select-wide">
                <option value="">Memuat daftar sesi...</option>
            </select>
            <span id="filterSessionDateLabel" class="filter-date-label"></span>
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
        <div class="attendance-rate-box">
            <span class="attendance-rate-label">Tingkat Kehadiran</span>
            <div class="attendance-rate-track"><div class="attendance-rate-fill" id="attendanceRateFill"></div></div>
            <span class="attendance-rate-text" id="attendanceRateText">-</span>
        </div>
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
            <div class="empty-state">
                <div class="spinner" role="status" aria-label="Memuat"></div>
                <div class="empty-state-desc">Memuat data...</div>
            </div>
        </div>
    `;

    const roleHeader = userData.role === 'admin' ? 'Admin' : 'Guru';

    dashboardContent.innerHTML = `
        <div>
            <div class="mb-16">
                <h3 class="page-title mb-2">Dashboard ${roleHeader}</h3>
                <p class="page-subtitle mb-0">Kelola dan pantau kehadiran siswa.</p>
            </div>
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

        document.getElementById('tugasBtn').onclick = openTugasPage;

        checkTodaySession();
    }

    document.getElementById('applyFilterBtn').onclick = () => loadAttendanceData();
    document.getElementById('exportBtn').onclick = exportToExcel;

    // Manual attendance listeners
    if (userData.role === 'teacher' || userData.role === 'admin') {
        document.getElementById('manualSetStatusBtn').onclick = () => handleManualStatus(userData);

        document.getElementById('manualStudentSearch').addEventListener('input', () => {
            renderManualStudentList();
        });

        document.getElementById('manualClassFilter').addEventListener('change', () => {
            renderManualStudentList();
        });

        document.getElementById('manualAttendanceStatusFilter').addEventListener('change', () => {
            renderManualStudentList();
        });

        document.getElementById('manualSelectAll').addEventListener('change', (event) => {
            const visibleStudents = getVisibleManualStudents();

            if (event.target.checked) {
                visibleStudents.forEach(student => {
                    manualSelectedStudentUids.add(student.uid);
                });
            } else {
                visibleStudents.forEach(student => {
                    manualSelectedStudentUids.delete(student.uid);
                });
            }

            renderManualStudentList();
        });

    }

    await loadClassOptions();
    // Isi dropdown session (sumber kebenaran filter attendance) lalu load data
    // untuk session yang otomatis terpilih (default: session ACTIVE).
    await initSessionSelector();

    if (userData.role === 'teacher' || userData.role === 'admin') {
        await populateManualStudentDropdown(userData);
    }
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
    if (dateLabel) dateLabel.textContent = currentDashboardSessionDate ? `Tanggal: ${formatAttendanceDate(currentDashboardSessionDate)}` : '';

    select.onchange = async () => {
        const opt = select.options[select.selectedIndex];
        currentDashboardSessionId = select.value || null;
        currentDashboardSessionDate = opt ? opt.dataset.date : null;
        currentDashboardSessionStatus = opt ? opt.dataset.status : null;
        if (dateLabel) dateLabel.textContent = currentDashboardSessionDate ? `Tanggal: ${formatAttendanceDate(currentDashboardSessionDate)}` : '';

        if (document.getElementById('teacherManualPanel')) {
            await populateManualStudentDropdown({
                role: document.body.dataset.currentRole || 'teacher'
            });
        }
    };
}

// ===== MANUAL ATTENDANCE MULTI SELECT =====

async function populateManualStudentDropdown(userData) {
    console.log('[MANUAL] loading students...', {
        role: userData.role,
        classId: userData.classId
    });

    try {
        const [snapshot, attendanceSnapshot] = await Promise.all([
            getDocs(collection(db, 'users')),
            currentDashboardSessionId
                ? getDocs(query(
                    collection(db, 'attendance'),
                    where('sessionId', '==', currentDashboardSessionId)
                ))
                : Promise.resolve(null)
        ]);

        const attendanceByUid = new Map();

        if (attendanceSnapshot) {
            attendanceSnapshot.forEach(docSnap => {
                const attendance = docSnap.data();
                if (attendance.uid) {
                    attendanceByUid.set(attendance.uid, attendance.status);
                }
            });
        }

        const students = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();

            if (data.role !== 'student') return;
            if (['INACTIVE', 'DELETED'].includes(data.accountStatus)) return;

            // Teacher dapat melihat siswa aktif dari semua kelas.

            students.push({
                uid: docSnap.id,
                ...data,
                attendanceStatus:
                    attendanceByUid.get(docSnap.id) || 'BELUM_ABSEN'
            });
        });

        students.sort((a, b) =>
            (a.nama || '').localeCompare(b.nama || '', 'id')
        );

        manualStudents = students;

        const classFilter =
            document.getElementById('manualClassFilter');

        if (classFilter) {
            const selectedClass = classFilter.value;
            const classes = [...new Set(
                students
                    .map(student => student.classId)
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'id'));

            classFilter.innerHTML =
                '<option value="">Semua Kelas</option>' +
                classes.map(classId =>
                    `<option value="${escapeHtml(classId)}">${escapeHtml(classId)}</option>`
                ).join('');

            if (classes.includes(selectedClass)) {
                classFilter.value = selectedClass;
            }
        }

        // Selection yang UID-nya sudah tidak ada dibersihkan.
        const validUids = new Set(students.map(student => student.uid));

        manualSelectedStudentUids = new Set(
            [...manualSelectedStudentUids].filter(uid => validUids.has(uid))
        );

        renderManualStudentList();

        console.log('[MANUAL] students loaded:', manualStudents.length);

    } catch (error) {
        console.error('[MANUAL] Error loading students:', error);

        const list = document.getElementById('manualStudentList');
        if (list) {
            list.innerHTML = `
                <div class="alert alert-danger">
                    ❌ Gagal memuat daftar siswa.
                </div>
            `;
        }
    }
}

function getVisibleManualStudents() {
    const searchInput =
        document.getElementById('manualStudentSearch');
    const classFilter =
        document.getElementById('manualClassFilter');
    const statusFilter =
        document.getElementById('manualAttendanceStatusFilter');

    const keyword =
        (searchInput?.value || '').trim().toLowerCase();
    const selectedClass = classFilter?.value || '';
    const selectedStatus = statusFilter?.value || '';

    return manualStudents.filter(student => {
        const nama = (student.nama || '').toLowerCase();
        const classId = (student.classId || '').toLowerCase();
        const status =
            student.attendanceStatus || 'BELUM_ABSEN';

        const matchesSearch =
            !keyword ||
            nama.includes(keyword) ||
            classId.includes(keyword);

        const matchesClass =
            !selectedClass ||
            student.classId === selectedClass;

        const matchesStatus =
            !selectedStatus ||
            status === selectedStatus;

        return matchesSearch && matchesClass && matchesStatus;
    });
}

function renderManualStudentList() {
    const list = document.getElementById('manualStudentList');
    const selectAll = document.getElementById('manualSelectAll');
    const countEl = document.getElementById('manualSelectedCount');

    if (!list) return;

    const visibleStudents = getVisibleManualStudents();

    if (countEl) {
        countEl.textContent =
            `${manualSelectedStudentUids.size} siswa terpilih`;
    }

    if (visibleStudents.length === 0) {
        list.innerHTML = `
            <div class="text-secondary" style="padding:12px;text-align:center;">
                Tidak ada siswa yang ditemukan.
            </div>
        `;

        if (selectAll) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
            selectAll.disabled = true;
        }

        return;
    }

    const selectedVisibleCount = visibleStudents.filter(student =>
        manualSelectedStudentUids.has(student.uid)
    ).length;

    if (selectAll) {
        selectAll.disabled = false;
        selectAll.checked =
            selectedVisibleCount === visibleStudents.length;

        selectAll.indeterminate =
            selectedVisibleCount > 0 &&
            selectedVisibleCount < visibleStudents.length;
    }

    list.innerHTML = '';

    visibleStudents.forEach(student => {
        const label = document.createElement('label');

        label.style.cssText = `
            display:flex;
            align-items:center;
            gap:10px;
            padding:9px 8px;
            cursor:pointer;
            border-radius:6px;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked =
            manualSelectedStudentUids.has(student.uid);

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                manualSelectedStudentUids.add(student.uid);
            } else {
                manualSelectedStudentUids.delete(student.uid);
            }

            renderManualStudentList();
        });

        const text = document.createElement('span');
        text.textContent =
            `${student.nama || 'Unknown'} (${student.classId || '-'}) — ${
                student.attendanceStatus === 'BELUM_ABSEN'
                    ? 'BELUM ABSEN'
                    : student.attendanceStatus
            }`;

        label.appendChild(checkbox);
        label.appendChild(text);
        list.appendChild(label);
    });
}

// ===== HANDLE MANUAL STATUS =====
// Teacher: kelas sendiri, IZIN/SAKIT/ALFA
// Admin: semua kelas, HADIR/TERLAMBAT/IZIN/SAKIT/ALFA
//
// Semua validasi UX di sini bukan pengganti Firestore Rules.

async function handleManualStatus(userData) {
    const statusSelect = document.getElementById('manualStatusSelect');
    const msgEl = document.getElementById('manualStatusMessage');

    const status = statusSelect?.value;
    const selectedUids = [...manualSelectedStudentUids];
    const isAdmin = userData.role === 'admin';

    const allowedStatuses = isAdmin
        ? ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALFA']
        : ['IZIN', 'SAKIT', 'ALFA'];

    if (selectedUids.length === 0) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent = 'Pilih minimal satu siswa terlebih dahulu.';
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

    // Teacher hanya boleh manual pada ACTIVE.
    // Ini UX guard; Firestore Rules tetap enforcement utama.
    if (
        !isAdmin &&
        currentDashboardSessionStatus !== 'ACTIVE'
    ) {
        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';
        msgEl.textContent =
            '❌ Teacher hanya boleh input manual attendance pada session yang sedang ACTIVE.';
        return;
    }

    const button = document.getElementById('manualSetStatusBtn');

    if (button) {
        button.disabled = true;
        button.textContent = '⏳ Memproses...';
    }

    msgEl.className = 'alert alert-warning';
    msgEl.style.display = 'block';
    msgEl.textContent =
        `⏳ Memproses ${selectedUids.length} siswa...`;

    try {
        const sessionIdForManual = currentDashboardSessionId;
        const dateForManual =
            currentDashboardSessionDate || getJakartaDateStr();

        /*
         * ========================================================
         * PHASE 1: Baca semua data DULU.
         *
         * Tidak ada write sampai seluruh target berhasil divalidasi.
         * Ini penting supaya batch tidak menghasilkan sebagian update
         * karena satu target bermasalah.
         * ========================================================
         */

        const targetResults = await Promise.all(
            selectedUids.map(async targetUid => {
                const [targetSnap, attendanceSnap] = await Promise.all([
                    getDoc(doc(db, 'users', targetUid)),
                    getDoc(
                        doc(
                            db,
                            'attendance',
                            `${targetUid}_${sessionIdForManual}`
                        )
                    )
                ]);

                if (!targetSnap.exists()) {
                    throw new Error(
                        `Profil siswa ${targetUid} tidak ditemukan.`
                    );
                }

                const targetData = targetSnap.data();

                if (targetData.role !== 'student') {
                    throw new Error(
                        `${targetData.nama || targetUid} bukan student.`
                    );
                }

                if (!targetData.classId) {
                    throw new Error(
                        `${targetData.nama || targetUid} belum memiliki kelas.`
                    );
                }

                const attendanceData = attendanceSnap.exists()
                    ? attendanceSnap.data()
                    : null;

                return {
                    targetUid,
                    targetData,
                    attendanceSnap,
                    attendanceData
                };
            })
        );

        /*
         * ========================================================
         * PHASE 2: Buat SATU Firestore WriteBatch.
         * Existing -> update status saja.
         * Baru     -> create attendance lengkap.
         * ========================================================
         */

        const batch = writeBatch(db);

        targetResults.forEach(result => {
            const {
                targetUid,
                targetData,
                attendanceSnap
            } = result;

            const attendanceRef = doc(
                db,
                'attendance',
                `${targetUid}_${sessionIdForManual}`
            );

            if (attendanceSnap.exists()) {
                // UPDATE:
                // Jangan sentuh uid/classId/sessionId/tanggal/createdAt/method.
                batch.update(attendanceRef, {
                    status: status
                });

                console.log(
                    '[MANUAL BATCH] UPDATE',
                    targetData.nama || targetUid,
                    status
                );

            } else {
                // CREATE:
                batch.set(attendanceRef, {
                    uid: targetUid,
                    tanggal: dateForManual,
                    status: status,
                    classId: targetData.classId,
                    sessionId: sessionIdForManual,
                    method: 'manual',
                    createdAt: serverTimestamp()
                });

                console.log(
                    '[MANUAL BATCH] CREATE',
                    targetData.nama || targetUid,
                    status
                );
            }
        });

        /*
         * Satu commit.
         * Firestore batch bersifat atomic: seluruh write berhasil
         * atau seluruh write gagal.
         */
        await batch.commit();

        msgEl.className = 'alert alert-success';
        msgEl.style.display = 'block';
        msgEl.textContent =
            `✅ ${selectedUids.length} siswa berhasil ditetapkan menjadi ${status}.`;

        // Clear selection setelah sukses.
        manualSelectedStudentUids.clear();

        if (statusSelect) {
            statusSelect.value = '';
        }

        await populateManualStudentDropdown(userData);
        await loadAttendanceData();

    } catch (error) {
        console.error('[MANUAL BATCH ERROR]', error);

        msgEl.className = 'alert alert-danger';
        msgEl.style.display = 'block';

        if (error.code === 'permission-denied') {
            msgEl.textContent =
                '❌ Firestore menolak perubahan. Periksa role, kelas, session, atau status.';
        } else {
            msgEl.textContent =
                `❌ Gagal menetapkan attendance: ${error.message}`;
        }

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Terapkan ke Siswa Terpilih';
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
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon" aria-hidden="true">🗓️</div>
                <div class="empty-state-title">Pilih Sesi</div>
                <div class="empty-state-desc">Pilih session terlebih dahulu untuk menampilkan data absensi.</div>
            </div>
        `;
        attendanceFilteredData = [];
        updateSummary([]);
        return;
    }

    container.innerHTML = `
        <div class="empty-state">
            <div class="spinner" role="status" aria-label="Memuat"></div>
            <div class="empty-state-desc">Memuat data...</div>
        </div>
    `;

    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const userList = [];

        usersSnapshot.forEach(d => {
            const data = d.data();

            userList.push({
                uid: d.id,
                nama: data.nama || 'Unknown',
                classId: data.classId || '-',
                role: data.role || 'student',
                accountStatus: data.accountStatus || 'ACTIVE'
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

            // Siswa nonaktif tidak dihitung BELUM ABSEN pada sesi baru,
            // tetapi tetap muncul jika memiliki histori pada sesi terpilih.
            if (
                ['INACTIVE', 'DELETED'].includes(user.accountStatus)
                && !att
            ) {
                return null;
            }

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
        }).filter(Boolean);

        // Urutkan: yang sudah absen berdasarkan jam paling awal, BELUM ABSEN paling bawah.
        fullData.sort((a, b) => {
            const aAbsent = a.status === 'BELUM_ABSEN';
            const bAbsent = b.status === 'BELUM_ABSEN';

            if (aAbsent && !bAbsent) return 1;
            if (!aAbsent && bAbsent) return -1;
            if (aAbsent && bAbsent) return 0;

            const aTime = a.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER;
            const bTime = b.createdAt?.seconds ?? Number.MAX_SAFE_INTEGER;

            return aTime - bTime;
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
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon" aria-hidden="true">📭</div>
                    <div class="empty-state-title">Belum Ada Data</div>
                    <div class="empty-state-desc">Tidak ada data absensi untuk filter ini.</div>
                </div>
            `;
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
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody>
        `;

        attendanceFilteredData.forEach((d, i) => {
            const statusClass = `status-${d.status}`;
            const statusLabel = d.status === 'BELUM_ABSEN' ? 'BELUM ABSEN' : d.status;
            const dateLabel = formatAttendanceDate(d.tanggal);

            html += `
                <tr>
                    <td class="attendance-number-cell">${i + 1}</td>
                    <td class="attendance-name-cell">
                        <span class="attendance-name-text">${escapeHtml(d.nama)}</span>
                        <span class="attendance-mobile-meta" aria-label="Kelas ${escapeHtml(d.classId)}, tanggal ${escapeHtml(dateLabel)}, pukul ${escapeHtml(d.jam)}">
                            <span>${escapeHtml(d.classId)}</span>
                            <span>${escapeHtml(dateLabel)}</span>
                            <span>${escapeHtml(d.jam)}</span>
                        </span>
                    </td>
                    <td class="attendance-class-cell">${escapeHtml(d.classId)}</td>
                    <td class="attendance-date-cell">${escapeHtml(dateLabel)}</td>
                    <td class="attendance-time-cell">${escapeHtml(d.jam)}</td>
                    <td class="attendance-status-cell">
                        <span class="status-label ${statusClass}">${statusLabel}</span>
                    </td>
                    <td class="attendance-action-cell">
                        ${
                            d.status !== 'BELUM_ABSEN'
                                ? `<button
                                    class="btn btn-secondary attendance-rollback-btn"
                                    data-uid="${escapeHtml(d.uid)}"
                                    data-session-id="${escapeHtml(d.sessionId)}"
                                    aria-label="Batalkan absensi ${escapeHtml(d.nama)}"
                                    title="Batalkan absensi"
                                   >
                                    <span aria-hidden="true">↩</span>
                                    <span>Batalkan</span>
                                   </button>`
                                : '<span class="attendance-no-action" aria-hidden="true">—</span>'
                        }
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        container.querySelectorAll('.attendance-rollback-btn').forEach(button => {
            button.onclick = () => rollbackAttendance(
                button.dataset.uid,
                button.dataset.sessionId,
                button.closest('tr')?.querySelector('.attendance-name-text')?.textContent || 'siswa',
                button
            );
        });

        updateSummary(attendanceFilteredData);

    } catch (error) {
        console.error("Error loading attendance:", error);
        container.innerHTML = `
            <div class="empty-state state-error">
                <div class="empty-state-icon" aria-hidden="true">⚠️</div>
                <div class="empty-state-title">Gagal Memuat Data</div>
                <div class="empty-state-desc">Terjadi kesalahan saat memuat data. Silakan coba lagi.</div>
            </div>
        `;
    }
}


// ===== ROLLBACK ATTENDANCE =====
// Hanya ADMIN yang boleh menghapus record attendance.
// Firestore Rules tetap menjadi enforcement utama.
async function rollbackAttendance(uid, sessionId, nama, button = null) {
    if (!uid || !sessionId) {
        showRollbackMessage(
            'danger',
            '❌ Data attendance tidak valid.'
        );
        return;
    }

    const confirmed = confirm(
        `Batalkan absensi ${nama || 'siswa'}?\n\n` +
        `Data absensi akan dihapus dan siswa kembali menjadi BELUM ABSEN.`
    );

    if (!confirmed) return;

    const originalText = button?.textContent || '↩️ Rollback';

    if (button) {
        button.disabled = true;
        button.textContent = '⏳ Membatalkan...';
    }

    showRollbackMessage(
        'warning',
        `⏳ Membatalkan absensi ${nama || 'siswa'}...`
    );

    try {
        const attendanceRef = doc(
            db,
            'attendance',
            `${uid}_${sessionId}`
        );

        await deleteDoc(attendanceRef);

        showRollbackMessage(
            'success',
            `✅ Absensi ${nama || 'siswa'} berhasil dibatalkan. Siswa sekarang berstatus BELUM ABSEN.`
        );

        await loadAttendanceData();

    } catch (error) {
        console.error('[ROLLBACK ERROR]', error);

        if (error.code === 'permission-denied') {
            showRollbackMessage(
                'danger',
                '❌ Anda tidak memiliki izin untuk melakukan rollback.'
            );
        } else {
            showRollbackMessage(
                'danger',
                `❌ Gagal melakukan rollback: ${error.message}`
            );
        }

        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function showRollbackMessage(type, message) {
    let messageEl = document.getElementById('rollbackMessage');

    if (!messageEl) {
        const container = document.getElementById('attendanceTableContainer');

        if (!container) return;

        messageEl = document.createElement('div');
        messageEl.id = 'rollbackMessage';
        messageEl.style.marginBottom = '12px';

        container.parentNode.insertBefore(messageEl, container);
    }

    messageEl.className = `alert alert-${type}`;
    messageEl.style.display = 'block';
    messageEl.textContent = message;
}

window.rollbackAttendance = rollbackAttendance;

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

    // Attendance rate: presentasi visual saja, dihitung dari angka di atas.
    const rateFill = document.getElementById('attendanceRateFill');
    const rateText = document.getElementById('attendanceRateText');
    if (rateFill && rateText) {
        const rate = total > 0 ? Math.round(((hadir + terlambat) / total) * 100) : 0;
        rateFill.style.width = rate + '%';
        rateText.textContent = total > 0 ? rate + '%' : '-';
    }
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

    // Urutan prioritas status (dari atas ke bawah)
    const statusOrder = ['HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALFA', 'BELUM_ABSEN'];
    const sortedData = [...attendanceFilteredData].sort((a, b) => {
        const classDiff = CLASS_LIST.indexOf(a.classId) - CLASS_LIST.indexOf(b.classId);
        if (classDiff !== 0) return classDiff;

        const statusDiff = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        if (statusDiff !== 0) return statusDiff;

        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;

        const timeA = a.createdAt.seconds ?? a.createdAt._seconds ?? 0;
        const timeB = b.createdAt.seconds ?? b.createdAt._seconds ?? 0;
        return timeA - timeB;
    });
    
    sortedData.forEach((d, i) => {
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

        const originalStatus = sortedData[rowNumber - 2]?.status;
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

        const currentCasisUids = new Set(
            umData.filter(u => u.role === 'casis').map(u => u.uid)
        );

        umSelectedCasisUids = new Set(
            [...umSelectedCasisUids].filter(uid => currentCasisUids.has(uid))
        );

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
        if (u.accountStatus === 'DELETED') return false;

        const matchNama = u.nama.toLowerCase().includes(namaFilter);
        const matchKelas = !kelasFilter || u.classId === kelasFilter;
        const matchRole = !roleFilter || u.role === roleFilter;

        return matchNama && matchKelas && matchRole;
    });

    // Build filter UI
    const filterUI = `
        <div class="filter-container um-filter-bar">
            <input type="text" id="umFilterNama" placeholder="Cari nama..." value="${escapeHtml(namaFilter)}">

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

    // Build compact user list
    const displayUsers = [...umFilteredData].sort((a, b) => {
        const aPriority = a.role === 'casis' ? 0 : 1;
        const bPriority = b.role === 'casis' ? 0 : 1;

        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }

        return (a.nama || '').localeCompare(b.nama || '', 'id');
    });

    const visibleCasis = displayUsers.filter(u => u.role === 'casis');
    const visibleCasisUids = visibleCasis.map(u => u.uid);

    const allVisibleCasisSelected =
        visibleCasisUids.length > 0 &&
        visibleCasisUids.every(uid => umSelectedCasisUids.has(uid));

    let tableHTML = `
        <div class="um-list">
            <div class="um-list-summary">
                <strong>${displayUsers.length} user</strong>
                <span>${visibleCasis.length} casis menunggu</span>
            </div>

            ${visibleCasis.length > 0 ? `
                <div class="um-bulk-toolbar">
                    <label class="um-select-all">
                        <input
                            type="checkbox"
                            id="umSelectAllCasis"
                            ${allVisibleCasisSelected ? 'checked' : ''}
                        >
                        <span>Pilih semua casis (${visibleCasis.length})</span>
                    </label>

                    <button
                        type="button"
                        id="umApproveSelectedBtn"
                        class="btn btn-primary"
                        ${umSelectedCasisUids.size === 0 ? 'disabled' : ''}
                    >
                        Terima terpilih (${umSelectedCasisUids.size})
                    </button>
                </div>
            ` : ''}
    `;

    if (displayUsers.length === 0) {
        tableHTML += `
            <div class="state-message um-empty">
                Tidak ada user ditemukan.
            </div>
        `;
    } else {
        displayUsers.forEach(u => {
            const isInactive = u.accountStatus === 'INACTIVE';
            const isCasis = u.role === 'casis';

            const statusText = isCasis
                ? 'MENUNGGU'
                : isInactive
                    ? 'NONAKTIF'
                    : 'AKTIF';

            const statusClass = isCasis
                ? 'um-status-pending'
                : isInactive
                    ? 'um-status-inactive'
                    : 'um-status-active';

            const actionHTML = isCasis
                ? `
                    <button class="um-menu-item um-menu-approve btn-approve"
                            data-uid="${escapeHtml(u.uid)}">
                        <span>✓</span>
                        <span>Terima sebagai siswa</span>
                    </button>

                    <button class="um-menu-item um-menu-danger btn-reject"
                            data-uid="${escapeHtml(u.uid)}">
                        <span>×</span>
                        <span>Tolak pendaftaran</span>
                    </button>
                `
                : u.role === 'student'
                    ? `
                        <button class="um-menu-item btn-edit"
                                data-uid="${escapeHtml(u.uid)}">
                            <span>✎</span>
                            <span>Edit user</span>
                        </button>

                        <button class="um-menu-item btn-toggle-status"
                                data-uid="${escapeHtml(u.uid)}"
                                data-next-status="${
                                    isInactive ? 'ACTIVE' : 'INACTIVE'
                                }">
                            <span>${isInactive ? '✓' : '⊘'}</span>
                            <span>${
                                isInactive ? 'Aktifkan akun' : 'Nonaktifkan akun'
                            }</span>
                        </button>

                        <button class="um-menu-item um-menu-danger btn-delete-user"
                                data-uid="${escapeHtml(u.uid)}">
                            <span>⌫</span>
                            <span>Hapus user</span>
                        </button>
                    `
                    : `
                        <button class="um-menu-item btn-edit"
                                data-uid="${escapeHtml(u.uid)}">
                            <span>✎</span>
                            <span>Edit user</span>
                        </button>
                    `;

            tableHTML += `
                <div class="um-user-row ${isCasis ? 'um-user-row-selectable' : ''}">
                    ${isCasis ? `
                        <label
                            class="um-row-checkbox"
                            aria-label="Pilih ${escapeHtml(u.nama || 'casis')}"
                        >
                            <input
                                type="checkbox"
                                class="um-casis-checkbox"
                                data-uid="${escapeHtml(u.uid)}"
                                ${umSelectedCasisUids.has(u.uid) ? 'checked' : ''}
                            >
                        </label>
                    ` : ''}

                    <div class="um-user-main">
                        <div class="um-user-name">
                            ${escapeHtml(u.nama || '-')}
                        </div>

                        <div class="um-user-meta">
                            <span>${escapeHtml(u.classId || 'Tanpa kelas')}</span>
                            <span aria-hidden="true">•</span>
                            <span>${escapeHtml(ROLE_LABEL[u.role] || u.role || '-')}</span>
                            ${
                                u.nis
                                    ? `
                                        <span aria-hidden="true">•</span>
                                        <span>NIS ${escapeHtml(u.nis)}</span>
                                    `
                                    : ''
                            }
                        </div>
                    </div>

                    <span class="um-status ${statusClass}">
                        ${statusText}
                    </span>

                    <div class="um-actions">
                        <button
                            type="button"
                            class="um-menu-trigger"
                            aria-label="Buka aksi untuk ${escapeHtml(u.nama || 'user')}"
                            aria-expanded="false"
                        >
                            ⋮
                        </button>

                        <div class="um-action-menu" hidden>
                            ${actionHTML}
                        </div>
                    </div>
                </div>
            `;
        });
    }

    tableHTML += `</div>`;

    container.innerHTML = `
        ${filterUI}
        ${tableHTML}
    `;

    container.querySelectorAll('.um-menu-trigger').forEach(button => {
        button.onclick = event => {
            event.stopPropagation();

            const menu = button.nextElementSibling;
            const willOpen = menu.hidden;

            container.querySelectorAll('.um-action-menu').forEach(otherMenu => {
                otherMenu.hidden = true;
            });

            container.querySelectorAll('.um-menu-trigger').forEach(otherButton => {
                otherButton.setAttribute('aria-expanded', 'false');
            });

            menu.hidden = !willOpen;
            button.setAttribute(
                'aria-expanded',
                willOpen ? 'true' : 'false'
            );
        };
    });

    container.onclick = event => {
        if (event.target.closest('.um-actions')) return;

        container.querySelectorAll('.um-action-menu').forEach(menu => {
            menu.hidden = true;
        });

        container.querySelectorAll('.um-menu-trigger').forEach(button => {
            button.setAttribute('aria-expanded', 'false');
        });
    };

    // Attach listeners
    document.getElementById('umApplyFilterBtn').onclick = renderUserManagement;

    document.querySelectorAll('.um-casis-checkbox').forEach(checkbox => {
        checkbox.onchange = () => {
            const uid = checkbox.dataset.uid;

            if (checkbox.checked) {
                umSelectedCasisUids.add(uid);
            } else {
                umSelectedCasisUids.delete(uid);
            }

            renderUserManagement();
        };
    });

    const selectAllCasis = document.getElementById('umSelectAllCasis');

    if (selectAllCasis) {
        selectAllCasis.onchange = () => {
            visibleCasisUids.forEach(uid => {
                if (selectAllCasis.checked) {
                    umSelectedCasisUids.add(uid);
                } else {
                    umSelectedCasisUids.delete(uid);
                }
            });

            renderUserManagement();
        };
    }

    const approveSelectedBtn =
        document.getElementById('umApproveSelectedBtn');

    if (approveSelectedBtn) {
        approveSelectedBtn.onclick = async () => {
            const selectedCasis = umData.filter(user =>
                user.role === 'casis' &&
                umSelectedCasisUids.has(user.uid)
            );

            if (selectedCasis.length === 0) return;

            const confirmed = confirm(
                `Terima ${selectedCasis.length} casis terpilih sebagai siswa?\n\n` +
                'Nama dan kelas mereka akan langsung masuk ke daftar siswa.'
            );

            if (!confirmed) return;

            try {
                approveSelectedBtn.disabled = true;
                approveSelectedBtn.textContent = '⏳ Memproses...';

                const batch = writeBatch(db);

                selectedCasis.forEach(user => {
                    batch.update(doc(db, 'users', user.uid), {
                        role: 'student',
                        accountStatus: 'ACTIVE',
                        approvedAt: serverTimestamp(),
                        approvedBy: currentUser?.uid || null,
                        updatedAt: serverTimestamp()
                    });
                });

                await batch.commit();

                umSelectedCasisUids.clear();

                alert(
                    `✅ ${selectedCasis.length} casis berhasil diterima sebagai siswa.`
                );

                await loadUserManagementData();

            } catch (error) {
                console.error('[BULK CASIS APPROVE ERROR]', error);

                alert(
                    '❌ Penerimaan massal gagal. Tidak ada data yang diubah.\n\n' +
                    `Pesan: ${error.message || error}`
                );

                approveSelectedBtn.disabled = false;
                approveSelectedBtn.textContent =
                    `Terima terpilih (${umSelectedCasisUids.size})`;
            }
        };
    }

    document.getElementById('umResetFilterBtn').onclick = () => {
        document.getElementById('umFilterNama').value = '';
        document.getElementById('umFilterKelas').value = '';
        document.getElementById('umFilterRole').value = '';

        renderUserManagement();
    };

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.onclick = () => openEditModal(btn.dataset.uid);
    });

    document.querySelectorAll('.btn-toggle-status').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const nextStatus = btn.dataset.nextStatus;
            const user = umData.find(item => item.uid === uid);

            if (!user || user.role !== 'student') return;
            if (!['ACTIVE', 'INACTIVE'].includes(nextStatus)) return;

            const actionLabel =
                nextStatus === 'INACTIVE'
                    ? 'menonaktifkan'
                    : 'mengaktifkan kembali';

            if (!confirm(
                `Yakin ingin ${actionLabel} ${user.nama || 'siswa ini'}?`
            )) {
                return;
            }

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Memproses...';

                await updateDoc(doc(db, 'users', uid), {
                    accountStatus: nextStatus,
                    updatedAt: serverTimestamp()
                });

                user.accountStatus = nextStatus;

                alert(
                    nextStatus === 'INACTIVE'
                        ? `🚫 ${user.nama} berhasil dinonaktifkan.`
                        : `✅ ${user.nama} berhasil diaktifkan kembali.`
                );

                renderUserManagement();

            } catch (error) {
                console.error('[ACCOUNT STATUS ERROR]', error);
                alert('❌ Gagal mengubah status akun siswa.');

                btn.disabled = false;
                btn.textContent =
                    nextStatus === 'INACTIVE'
                        ? '🚫 Nonaktifkan'
                        : '✅ Aktifkan';
            }
        };
    });

    document.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.onclick = async () => {
            const uid = btn.dataset.uid;
            const user = umData.find(item => item.uid === uid);

            if (!user || user.role !== 'student') return;

            const confirmed = confirm(
                `Hapus akun ${user.nama || 'siswa ini'}?\n\n` +
                `• Siswa tidak bisa login atau absen\n` +
                `• Siswa hilang dari Manajemen User\n` +
                `• Histori absensi lama tetap disimpan\n\n` +
                `Tindakan ini tidak bisa dibatalkan melalui website.`
            );

            if (!confirmed) return;

            try {
                btn.disabled = true;
                btn.textContent = '⏳ Menghapus...';

                await updateDoc(doc(db, 'users', uid), {
                    accountStatus: 'DELETED',
                    deletedAt: serverTimestamp(),
                    deletedBy: currentUser?.uid || null,
                    updatedAt: serverTimestamp()
                });

                user.accountStatus = 'DELETED';

                alert(`🗑️ Akun ${user.nama} berhasil dihapus.`);
                renderUserManagement();

            } catch (error) {
                console.error('[DELETE STUDENT ERROR]', error);

                alert(
                    '❌ Gagal menghapus akun siswa. ' +
                    'Pastikan akun yang digunakan adalah admin.'
                );

                btn.disabled = false;
                btn.textContent = '🗑️ Hapus';
            }
        };
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
                    accountStatus: 'ACTIVE',
                    approvedAt: serverTimestamp(),
                    approvedBy: currentUser?.uid || null,
                    updatedAt: serverTimestamp()
                });

                umSelectedCasisUids.delete(uid);

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
                <input type="text" id="editNama" value="${escapeHtml(user.nama || '')}" required>

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
                <input type="text" id="editNis" value="${escapeHtml(user.nis || '')}">

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

        if (isInactiveAccount(userData)) {
            await rejectInactiveAccount();
            return;
        }

        if (!['student', 'teacher', 'admin', 'casis'].includes(userData.role)) {
            alert('Role akun tidak valid. Hubungi admin sekolah.');
            await signOut(auth);
            return;
        }

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
                accountStatus: 'ACTIVE',
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
function showAttendanceResult(success, data = {}) {
    const homeUrl = currentSessionId
        ? '/absen?session=' + encodeURIComponent(currentSessionId)
        : '/absen';

    const bindLogout = (id) => {
        const button = document.getElementById(id);

        if (!button) return;

        button.onclick = async () => {
            button.disabled = true;
            button.textContent = 'Keluar...';

            try {
                await signOut(auth);
                window.location.href = '/';
            } catch (error) {
                console.error('Logout error:', error);
                button.disabled = false;
                button.textContent = 'Logout';
            }
        };
    };

    const bindHome = (id) => {
        const button = document.getElementById(id);

        if (!button) return;

        button.onclick = () => {
            window.location.href = homeUrl;
        };
    };

    // =====================================================
    // SUCCESS
    // =====================================================
    if (success) {
        showSection(successScreenSection);

        const card = successScreenSection.querySelector(
            '.student-result-card'
        );

        if (!card) {
            console.error('Success card tidak ditemukan');
            return;
        }

        const isLate = data.status === 'TERLAMBAT';
        const statusText = isLate ? 'Terlambat' : 'Hadir';

        card.className =
            'student-card student-result-card result-v10 result-success';

        card.innerHTML = `
            <div class="result-v10-topbar">
                <div>
                    <span class="result-v10-brand">
                        ABSENSI YADIKA 4
                    </span>
                    <strong>Hasil Absensi</strong>
                </div>

                <button
                    id="successLogoutBtn"
                    class="result-v10-logout"
                    type="button"
                >
                    Logout
                </button>
            </div>

            <div class="result-v10-status result-v10-status-success">
                <span class="result-v10-status-dot">✓</span>
                <span>Absensi berhasil dicatat</span>
            </div>

            <div class="result-v10-hero">
                <div class="result-v10-icon result-v10-icon-success">
                    ✓
                </div>

                <h2>Absensi Berhasil</h2>

                <p>
                    Kehadiran kamu sudah tersimpan untuk sesi ini.
                </p>
            </div>

            <div class="result-v10-info result-v10-info-success">
                <div class="result-v10-time">
                    <span>Jam datang</span>

                    <strong>
                        ${escapeHtml(data.jam || '-')}
                    </strong>

                    <small>WIB</small>
                </div>

                <div class="result-v10-grid">
                    <div>
                        <span>Status</span>
                        <strong>${escapeHtml(statusText)}</strong>
                    </div>

                    <div>
                        <span>Nama</span>
                        <strong>
                            ${escapeHtml(data.nama || '-')}
                        </strong>
                    </div>

                    <div>
                        <span>Kelas</span>
                        <strong>
                            ${escapeHtml(data.kelas || '-')}
                        </strong>
                    </div>

                    <div>
                        <span>Tanggal</span>
                        <strong>
                            ${escapeHtml(data.tanggal || '-')}
                        </strong>
                    </div>
                </div>
            </div>

            <div class="result-v10-guidance result-v10-guidance-success">
                <strong>Selesai</strong>

                <p>
                    Kamu tidak perlu melakukan absensi lagi
                    untuk sesi ini.
                </p>
            </div>

            <button
                id="successBackBtn"
                class="result-v10-primary"
                type="button"
            >
                Kembali ke Home
            </button>
        `;

        bindHome('successBackBtn');
        bindLogout('successLogoutBtn');

        return;
    }

    // =====================================================
    // ERROR STATE
    // =====================================================
    showSection(attendanceResultSection);

    const card = attendanceResultSection.querySelector(
        '.student-result-card'
    );

    if (!card) {
        console.error('Attendance result card tidak ditemukan');
        return;
    }

    const rawError = String(data.error || '');

    let state = {
        type: 'system',
        badge: 'Absensi belum tercatat',
        title: 'Absensi Gagal',
        detail:
            'Sistem belum bisa mencatat absensi kamu. Silakan coba lagi.',
        guideTitle: 'Yang bisa kamu lakukan',
        steps: [
            'Pastikan koneksi internet aktif.',
            'Kembali ke halaman absensi.',
            'Coba lagi beberapa saat.'
        ],
        primary: 'Kembali ke Home',
        retryLocation: false
    };

    const isLocationError =
        rawError.includes('LOCATION_') ||
        rawError.includes('GEOLOCATION_') ||
        rawError.includes('OUTSIDE_ATTENDANCE_AREA');

    if (
        rawError.includes('DUPLICATE_ATTENDANCE') ||
        rawError.includes('DUPLICATE')
    ) {
        state = {
            type: 'duplicate',
            badge: 'Sudah tercatat',
            title: 'Kamu Sudah Absen',
            detail:
                'Absensi kamu untuk sesi ini sudah tercatat sebelumnya.',
            guideTitle: 'Tidak perlu absen lagi',
            steps: [
                'Kehadiran sudah tersimpan.',
                'Tidak perlu menekan tombol absen lagi.',
                'Kamu bisa kembali ke Home.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };

    } else if (rawError.includes('LOCATION_ACCURACY_LOW')) {
        state = {
            type: 'location',
            badge: 'Lokasi belum akurat',
            title: 'Lokasi Belum Tepat',
            detail:
                'Posisi HP belum cukup akurat untuk memastikan kamu berada di area absensi.',
            guideTitle: 'Perbaiki lokasi',
            steps: [
                'Pastikan GPS / Lokasi aktif.',
                'Pilih Precise / Lokasi Tepat.',
                'Tetap berada di area lobby lalu coba lagi.'
            ],
            primary: 'Coba Lokasi Lagi',
            retryLocation: true
        };

    } else if (
        rawError.includes('OUTSIDE_ATTENDANCE_AREA')
    ) {
        state = {
            type: 'location',
            badge: 'Di luar area',
            title: 'Lokasi Terlalu Jauh',
            detail:
                'Sistem membaca posisi kamu berada di luar area absensi.',
            guideTitle: 'Sebelum mencoba lagi',
            steps: [
                'Datang ke area lobby sekolah.',
                'Pastikan GPS / Lokasi aktif.',
                'Tunggu posisi stabil lalu coba lagi.'
            ],
            primary: 'Coba Lokasi Lagi',
            retryLocation: true
        };

    } else if (
        rawError.includes('GEOLOCATION_ERROR:1')
    ) {
        state = {
            type: 'location',
            badge: 'Izin lokasi diperlukan',
            title: 'Izinkan Lokasi',
            detail:
                'Browser belum mendapat izin untuk membaca lokasi HP kamu.',
            guideTitle: 'Atur izin lokasi',
            steps: [
                'Izinkan lokasi untuk website ini.',
                'Pilih Precise / Lokasi Tepat.',
                'Kembali ke halaman ini lalu coba lagi.'
            ],
            primary: 'Coba Lokasi Lagi',
            retryLocation: true
        };

    } else if (
        rawError.includes('GEOLOCATION_ERROR:2')
    ) {
        state = {
            type: 'location',
            badge: 'GPS belum tersedia',
            title: 'Nyalakan GPS',
            detail:
                'HP belum bisa memberikan lokasi kamu ke sistem.',
            guideTitle: 'Periksa HP kamu',
            steps: [
                'Nyalakan GPS / Lokasi.',
                'Pastikan mode pesawat tidak aktif.',
                'Tunggu beberapa detik lalu coba lagi.'
            ],
            primary: 'Coba Lokasi Lagi',
            retryLocation: true
        };

    } else if (
        rawError.includes('GEOLOCATION_ERROR:3')
    ) {
        state = {
            type: 'location',
            badge: 'Lokasi terlalu lama',
            title: 'Lokasi Belum Ditemukan',
            detail:
                'GPS membutuhkan waktu lebih lama untuk menemukan posisi yang cukup akurat.',
            guideTitle: 'Coba lagi',
            steps: [
                'Tetap berada di lobby.',
                'Pastikan GPS / Lokasi aktif.',
                'Tunggu sebentar lalu coba lagi.'
            ],
            primary: 'Coba Lokasi Lagi',
            retryLocation: true
        };

    } else if (
        rawError.includes('GEOLOCATION_NOT_SUPPORTED')
    ) {
        state = {
            type: 'system',
            badge: 'Browser tidak didukung',
            title: 'Lokasi Tidak Didukung',
            detail:
                'Browser ini tidak dapat memberikan lokasi yang dibutuhkan untuk absensi.',
            guideTitle: 'Gunakan browser lain',
            steps: [
                'Gunakan Chrome atau browser terbaru.',
                'Aktifkan izin lokasi.',
                'Buka kembali halaman absensi.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };

    } else if (
        rawError.includes('SESSION_NOT_FOUND') ||
        rawError.includes('SESSION_ARCHIVED')
    ) {
        state = {
            type: 'session',
            badge: 'Sesi tidak tersedia',
            title: 'Sesi Sudah Berakhir',
            detail:
                'QR atau link absensi ini sudah tidak berlaku.',
            guideTitle: 'Apa selanjutnya?',
            steps: [
                'Jangan gunakan QR lama.',
                'Gunakan sesi absensi yang sedang aktif.',
                'Hubungi guru jika sesi seharusnya masih terbuka.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };

    } else if (
        rawError.includes('SESSION_CLOSED')
    ) {
        state = {
            type: 'session',
            badge: 'Waktu habis',
            title: 'Absensi Sudah Ditutup',
            detail:
                'Waktu untuk melakukan absensi pada sesi ini sudah selesai.',
            guideTitle: 'Sesi telah selesai',
            steps: [
                'Kamu tidak dapat absen lewat sesi ini.',
                'Jangan gunakan QR lama.',
                'Hubungi guru jika membutuhkan bantuan.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };

    } else if (
        rawError.includes('SESSION_NOT_STARTED')
    ) {
        state = {
            type: 'session',
            badge: 'Belum dibuka',
            title: 'Absensi Belum Dimulai',
            detail:
                'Sesi absensi belum masuk waktu aktif.',
            guideTitle: 'Tunggu sesi dimulai',
            steps: [
                'Tetap gunakan QR yang benar.',
                'Tunggu sampai waktu absensi dimulai.',
                'Coba kembali setelah sesi aktif.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };

    } else if (
        rawError.includes('permission-denied') ||
        rawError.includes('Permintaan ditolak oleh sistem')
    ) {
        state = {
            type: 'system',
            badge: 'Tidak dapat diproses',
            title: 'Absensi Belum Tercatat',
            detail:
                'Sistem menolak permintaan absensi ini.',
            guideTitle: 'Periksa sebelum mencoba lagi',
            steps: [
                'Pastikan sesi absensi masih aktif.',
                'Pastikan kamu menggunakan akun sendiri.',
                'Kembali ke Home lalu coba lagi.'
            ],
            primary: 'Kembali ke Home',
            retryLocation: false
        };
    }

    const stepsHtml = state.steps
        .map(
            (step, index) => `
                <li>
                    <span>${index + 1}</span>
                    <p>${escapeHtml(step)}</p>
                </li>
            `
        )
        .join('');

    const accentClass =
        state.type === 'location'
            ? 'result-v10-location'
            : state.type === 'duplicate'
                ? 'result-v10-duplicate'
                : state.type === 'session'
                    ? 'result-v10-session'
                    : 'result-v10-error';

    card.className =
        `student-card student-result-card result-v10 ${accentClass}`;

    card.innerHTML = `
        <div class="result-v10-topbar">
            <div>
                <span class="result-v10-brand">
                    ABSENSI YADIKA 4
                </span>
                <strong>Hasil Absensi</strong>
            </div>

            <button
                id="attendanceErrorLogoutBtn"
                class="result-v10-logout"
                type="button"
            >
                Logout
            </button>
        </div>

        <div class="result-v10-status">
            <span class="result-v10-status-dot">!</span>
            <span>${escapeHtml(state.badge)}</span>
        </div>

        <div class="result-v10-hero">
            <div class="result-v10-icon">
                !
            </div>

            <h2>${escapeHtml(state.title)}</h2>

            <p>${escapeHtml(state.detail)}</p>
        </div>

        <div class="result-v10-guidance">
            <strong>
                ${escapeHtml(state.guideTitle)}
            </strong>

            <ol>
                ${stepsHtml}
            </ol>
        </div>

        <button
            id="goToAbsenBtn"
            class="result-v10-primary"
            type="button"
        >
            ${escapeHtml(state.primary)}
        </button>
    `;

    const primaryButton = document.getElementById(
        'goToAbsenBtn'
    );

    if (primaryButton) {
        primaryButton.onclick = async () => {
            if (
                state.retryLocation &&
                currentUser
            ) {
                primaryButton.disabled = true;
                primaryButton.textContent =
                    'Memeriksa lokasi...';

                try {
                    await processAbsenPage(currentUser);

                    if (absenNowBtn) {
                        absenNowBtn.click();
                    }
                } catch (error) {
                    console.error(
                        'Retry location error:',
                        error
                    );

                    primaryButton.disabled = false;
                    primaryButton.textContent =
                        state.primary;
                }

                return;
            }

            window.location.href = homeUrl;
        };
    }

    bindLogout('attendanceErrorLogoutBtn');
}


// ===== Auth Actions =====
loginBtn.onclick = async () => {
    try {
        loginBtn.disabled = true;
        loginBtn.textContent = '⏳ Menghubungkan Google...';

        // Pastikan sesi login disimpan sebelum membuka Google Login.
        await authPersistenceReady;

        // Kalau Firebase ternyata sudah memulihkan user,
        // jangan munculkan popup Google lagi.
        if (auth.currentUser) {
            console.log('[AUTH] Existing session restored:', auth.currentUser.uid);
            return;
        }

        await signInWithPopup(auth, provider);

    } catch (error) {
        console.error('[AUTH LOGIN ERROR]', error);
        alert(getAuthErrorMessage(error));

    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Masuk dengan Google';
    }
};

const studentHomeLogoutBtn =
    document.getElementById('studentHomeLogoutBtn');

if (studentHomeLogoutBtn) {
    studentHomeLogoutBtn.onclick = async () => {
        const confirmed = window.confirm(
            'Logout dari akun?\n\nKamu akan keluar dari akun ini.'
        );

        if (!confirmed) return;

        try {
            await signOut(auth);
            window.location.href = '/';
        } catch (e) {
            console.error('Student logout error:', e);
            alert('Logout gagal. Silakan coba lagi.');
        }
    };
}

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
// ============================================
// TUGAS / PR MODULE
// ============================================
const TUGAS_MAPEL = [
    'Matematika', 'Fisika', 'Agama',
    'Bahasa Indonesia', 'Bahasa Inggris',
    'Kimia', 'Biologi', 'Lainnya'
];

let tugasData = [];
let tugasSearchKeyword = '';
let tugasFilterMapel = '';
let tugasFilterKelas = '';
let tugasEditingId = null;

function formatTugasDate(ts) {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Jakarta'
    }).format(d);
}

async function loadTugasData() {
    const snap = await getDocs(
        query(collection(db, 'tugas'), orderBy('createdAt', 'desc'))
    );
    tugasData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function getVisibleTugas() {
    const kw = tugasSearchKeyword.trim().toLowerCase();
    return tugasData.filter(t => {
        const matchKw = !kw
            || (t.title || '').toLowerCase().includes(kw)
            || (t.description || '').toLowerCase().includes(kw);
        return matchKw
            && (!tugasFilterMapel || t.mapel === tugasFilterMapel)
            && (!tugasFilterKelas || t.classId === tugasFilterKelas);
    });
}

async function buildKelasOptions(selected, includeAll) {
    const snap = await getDocs(
        query(collection(db, 'users'), where('role', '==', 'student'))
    );
    const kelasList = [...new Set(
        snap.docs.map(d => d.data().classId).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'id'));

    let opts = includeAll ? '<option value="all">📢 Semua Kelas</option>' : '';
    opts += '<option value="">Semua Kelas</option>';
    opts += kelasList.map(c =>
        `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
    ).join('');
    return opts;
}

function renderTugasList() {
    const list = document.getElementById('tugasList');
    const countEl = document.getElementById('tugasResultCount');
    if (!list) return;

    const visible = getVisibleTugas();
    if (countEl) {
        countEl.textContent = `${visible.length} dari ${tugasData.length} tugas`;
    }

    if (visible.length === 0) {
        list.innerHTML = `<div class="text-secondary" style="padding:16px;text-align:center;">
            ${tugasData.length === 0
                ? 'Belum ada tugas.'
                : 'Tidak ada tugas yang cocok.'}</div>`;
        return;
    }

    list.innerHTML = visible.map(t => {
        const kelasLabel = t.classId === 'all' ? '📢 Semua Kelas' : escapeHtml(t.classId || '-');
        const canEdit = window.currentTugasRole !== 'student'
            && (window.currentTugasRole === 'admin'
                || t.createdBy === (currentUser?.uid || null));
        const actions = canEdit
            ? `<button class="btn btn-secondary btn-xs" onclick="window.openTugasEdit('${t.id}')">✏️</button>
               <button class="btn btn-danger btn-xs" onclick="window.deleteTugas('${t.id}')">🗑️</button>`
            : '';
        return `<div class="card" style="margin-bottom:12px;">
            <div style="font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:2px;">
                ${escapeHtml(t.mapel || '-')} · ${kelasLabel}
            </div>
            <div style="font-weight:600;font-size:15px;margin-bottom:4px;">
                ${escapeHtml(t.title || '(tanpa judul)')}
            </div>
            <div style="font-size:13px;color:#374151;white-space:pre-wrap;margin-bottom:6px;">
                ${escapeHtml(t.description || '')}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                <div style="font-size:11px;color:#6b7280;">
                    ${escapeHtml(t.createdByName || '-')} · ${formatTugasDate(t.createdAt)}
                </div>
                <div style="display:flex;gap:4px;">${actions}</div>
            </div>
        </div>`;
    }).join('');
}

// Editor state
let tugasEditorMode = 'create'; // 'create' | 'edit'

function openTugasEditor(id) {
    const t = id ? tugasData.find(x => x.id === id) : null;
    tugasEditingId = id || null;
    tugasEditorMode = t ? 'edit' : 'create';

    document.getElementById('tugasEditorTitle').textContent = t ? '✏️ Edit Tugas' : '➕ Tambah Tugas';
    document.getElementById('tugasTitle').value = t?.title || '';
    document.getElementById('tugasDescription').value = t?.description || '';
    document.getElementById('tugasMapel').value = t?.mapel || 'Matematika';
    document.getElementById('tugasEditor').style.display = 'block';
    document.getElementById('tugasEditorMsg').style.display = 'none';
}

function closeTugasEditor() {
    document.getElementById('tugasEditor').style.display = 'none';
    tugasEditingId = null;
}

window.openTugasEdit = (id) => openTugasEditor(id);

window.deleteTugas = async (id) => {
    const t = tugasData.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`Hapus tugas "${t.title}"?`)) return;
    try {
        await deleteDoc(doc(db, 'tugas', id));
        await loadTugasData();
        renderTugasList();
    } catch (error) {
        alert(`Gagal menghapus: ${error.message}`);
    }
};

async function handleSaveTugas() {
    const title = document.getElementById('tugasTitle').value.trim();
    const description = document.getElementById('tugasDescription').value.trim();
    const mapel = document.getElementById('tugasMapel').value;
    const classId = document.getElementById('tugasClassId').value;
    const msgEl = document.getElementById('tugasEditorMsg');
    const isAdmin = window.currentTugasRole === 'admin';

    msgEl.style.display = 'none';
    msgEl.className = 'alert';

    if (!title) { msgEl.className='alert alert-danger'; msgEl.textContent='Judul wajib diisi.'; msgEl.style.display='block'; return; }
    if (title.length > 200) { msgEl.className='alert alert-danger'; msgEl.textContent='Judul maks 200 karakter.'; msgEl.style.display='block'; return; }
    if (!mapel) { msgEl.className='alert alert-danger'; msgEl.textContent='Pilih mapel.'; msgEl.style.display='block'; return; }
    if (!classId) { msgEl.className='alert alert-danger'; msgEl.textContent=isAdmin ? 'Pilih kelas (atau Semua Kelas).' : 'Pilih kelas.'; msgEl.style.display='block'; return; }
    if (!isAdmin && classId === 'all') { msgEl.className='alert alert-danger'; msgEl.textContent='Hanya admin bisa broadcast.'; msgEl.style.display='block'; return; }
    if (description.length > 4000) { msgEl.className='alert alert-danger'; msgEl.textContent='Deskripsi maks 4000 karakter.'; msgEl.style.display='block'; return; }

    const btn = document.getElementById('tugasSaveBtn');
    btn.disabled = true;
    btn.textContent = '⏳';

    try {
        const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
        const createdByName = userSnap.data()?.nama || currentUser?.displayName || 'Unknown';

        if (tugasEditingId) {
            await updateDoc(doc(db, 'tugas', tugasEditingId), {
                title, description, mapel, classId, updatedAt: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, 'tugas'), {
                title, description, mapel, classId,
                createdBy: currentUser.uid, createdByName,
                createdAt: serverTimestamp()
            });
        }

        closeTugasEditor();
        await loadTugasData();
        renderTugasList();
    } catch (error) {
        console.error('[TUGAS SAVE]', error);
        msgEl.className = 'alert alert-danger';
        msgEl.textContent = `Gagal: ${error.message}`;
        msgEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Simpan';
    }
}

async function renderTugasPage(userData) {
    window.currentTugasRole = userData.role;
    const canManage = userData.role === 'teacher' || userData.role === 'admin';

    const kelasFilterOpts = await buildKelasOptions(tugasFilterKelas, true);
    const kelasEditorOpts = await buildKelasOptions('', userData.role === 'admin');

    const content = document.getElementById('tugasContent');
    content.innerHTML = `
        ${canManage ? `
        <div class="card" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div class="card-title">📝 Kelola Tugas</div>
                <button id="tugasAddBtn" class="btn btn-primary">➕ Tambah</button>
            </div>
            <div id="tugasEditor" style="display:none;padding-top:12px;border-top:1px solid #e5e7eb;">
                <div class="card-title" id="tugasEditorTitle">➕ Tambah Tugas</div>
                <div class="form-group">
                    <label for="tugasTitle">Judul *</label>
                    <input type="text" id="tugasTitle" maxlength="200" placeholder="Contoh: Latihan Soal Bab 3" class="w-full">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div class="form-group">
                        <label for="tugasMapel">Mapel *</label>
                        <select id="tugasMapel" class="w-full">
                            ${TUGAS_MAPEL.map(m => `<option value="${m}">${m}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="tugasClassId">Kelas Target *</label>
                        <select id="tugasClassId" class="w-full">
                            <option value="">— Pilih —</option>
                            ${kelasEditorOpts}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label for="tugasDescription">Deskripsi / Catatan</label>
                    <textarea id="tugasDescription" rows="3" maxlength="4000" placeholder="Detail tugas, halaman, instruksi..." class="w-full"></textarea>
                </div>
                <div id="tugasEditorMsg" class="alert" style="display:none;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="tugasSaveBtn" class="btn btn-primary">💾 Simpan</button>
                    <button id="tugasCancelBtn" class="btn btn-secondary">Batal</button>
                </div>
            </div>
        </div>
        ` : ''}

        <div class="card" style="margin-bottom:16px;">
            <div class="card-title">🔍 Filter &amp; Cari</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;">
                <div class="form-group mb-0">
                    <label>Cari</label>
                    <input type="text" id="tugasSearch" placeholder="Judul / deskripsi..." value="${escapeHtml(tugasSearchKeyword)}" class="w-full">
                </div>
                <div class="form-group mb-0">
                    <label>Mapel</label>
                    <select id="tugasMapelFilter" class="w-full">
                        <option value="">Semua</option>
                        ${TUGAS_MAPEL.map(m => `<option value="${m}">${m}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group mb-0">
                    <label>Kelas</label>
                    <select id="tugasKelasFilter" class="w-full">${kelasFilterOpts}</select>
                </div>
                <button id="tugasResetBtn" class="btn btn-secondary">Reset</button>
            </div>
            <div id="tugasResultCount" class="text-secondary" style="font-size:12px;margin-top:6px;"></div>
        </div>

        <div id="tugasList"></div>
    `;

    // Wire events
    if (canManage) {
        document.getElementById('tugasAddBtn').onclick = () => openTugasEditor(null);
        document.getElementById('tugasSaveBtn').onclick = handleSaveTugas;
        document.getElementById('tugasCancelBtn').onclick = closeTugasEditor;
    }
    document.getElementById('tugasSearch').oninput = e => { tugasSearchKeyword = e.target.value; renderTugasList(); };
    document.getElementById('tugasMapelFilter').onchange = e => { tugasFilterMapel = e.target.value; renderTugasList(); };
    document.getElementById('tugasKelasFilter').onchange = e => { tugasFilterKelas = e.target.value; renderTugasList(); };
    document.getElementById('tugasResetBtn').onclick = () => {
        tugasSearchKeyword = ''; tugasFilterMapel = ''; tugasFilterKelas = '';
        document.getElementById('tugasSearch').value = '';
        document.getElementById('tugasMapelFilter').value = '';
        document.getElementById('tugasKelasFilter').value = '';
        renderTugasList();
    };

    await loadTugasData();
    renderTugasList();
}

async function openTugasPage() {
    if (!currentUser) { showSection(loginSection); return; }
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (!userDoc.exists()) {
            showSection(profileSetupSection); setupProfileForm(currentUser); return;
        }
        const uData = userDoc.data();
        if (isInactiveAccount(uData)) { await rejectInactiveAccount(); return; }
        showSection(tugasSection);
        await renderTugasPage(uData);
    } catch (error) {
        console.error('[TUGAS PAGE ERROR]', error);
        alert('Gagal membuka halaman tugas.');
    }
}

document.getElementById('backToDashboardFromTugasBtn').onclick = async () => {
    if (!currentUser) { showSection(loginSection); return; }
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            showSection(dashboardSection);
            await renderDashboard(userDoc.data());
        } else {
            showSection(profileSetupSection);
            setupProfileForm(currentUser);
        }
    } catch (error) {
        console.error('[BACK FROM TUGAS]', error);
    }
};

window.openTugasPage = openTugasPage;
console.log("✅ Modul Tugas siap.");