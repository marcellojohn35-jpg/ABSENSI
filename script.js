// ===== EXISTING CODE =====
console.log("Absensi Prototype aktif!");

// ===== FOUNDATION: FIREBASE MODULAR IMPORT =====
import { 
    auth, 
    db, 
    provider, 
    signInWithPopup, 
    onAuthStateChanged, 
    signOut 
} from './firebase-config.js';

import { 
    doc, 
    getDoc, 
    setDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// ===== STEP 9: IMPORT FUNCTIONS =====
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js";

// ===== DOM REFERENCES =====
const loadingState = document.getElementById('loadingState');
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const profileSetupSection = document.getElementById('profileSetupSection');
const qrScannerSection = document.getElementById('qrScannerSection');
const attendanceResultSection = document.getElementById('attendanceResultSection');

const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');

const userPhoto = document.getElementById('userPhoto');
const userName = document.getElementById('userName');
const userRole = document.getElementById('userRole');
const roleDisplay = document.getElementById('roleDisplay');

const profileForm = document.getElementById('profileForm');
const profileNama = document.getElementById('profileNama');
const profileNis = document.getElementById('profileNis');
const profileKelas = document.getElementById('profileKelas');

// ===== STEP 9: QR SCANNER DOM REFERENCES =====
const closeScannerBtn = document.getElementById('closeScannerBtn');
const qrStatus = document.getElementById('qrStatus');
const qrScannerInstruction = document.getElementById('qrScannerInstruction');
const qrReader = document.getElementById('qrReader');

const attendanceResultTitle = document.getElementById('attendanceResultTitle');
const attendanceResultData = document.getElementById('attendanceResultData');
const scanAgainBtn = document.getElementById('scanAgainBtn');

// ===== STATE =====
let isProcessingAttendance = false;
let html5QrCode = null;
let isScannerRunning = false;
let currentUser = null;

// ===== HELPER FUNCTIONS =====

// Tampilkan section tertentu, sembunyikan yang lain
function showSection(sectionId) {
    loadingState.style.display = 'none';
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'none';
    profileSetupSection.style.display = 'none';
    qrScannerSection.style.display = 'none';
    attendanceResultSection.style.display = 'none';
    
    if (sectionId === 'loading') {
        loadingState.style.display = 'block';
    } else if (sectionId === 'login') {
        loginSection.style.display = 'block';
    } else if (sectionId === 'dashboard') {
        dashboardSection.style.display = 'block';
    } else if (sectionId === 'profileSetup') {
        profileSetupSection.style.display = 'block';
    } else if (sectionId === 'qrScanner') {
        qrScannerSection.style.display = 'block';
    } else if (sectionId === 'attendanceResult') {
        attendanceResultSection.style.display = 'block';
    }
}

// ===== LOAD USER PROFILE =====
async function loadUserProfile(user) {
    showSection('loading');
    
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            console.log('Profil belum ada, menunggu createUserProfile...');
            
            setTimeout(async () => {
                try {
                    const retryDoc = await getDoc(userDocRef);
                    if (retryDoc.exists()) {
                        showDashboard(retryDoc.data());
                    } else {
                        showProfileSetup(user);
                    }
                } catch (error) {
                    console.error('Error retrying profile check:', error);
                    showProfileSetup(user);
                }
            }, 2000);
            
            return;
        }
        
        showDashboard(userDoc.data());
        
    } catch (error) {
        console.error('Error loading user profile:', error);
        showSection('login');
        alert('Terjadi error saat memuat profil. Silakan coba lagi.');
    }
}

// ===== DASHBOARD =====
function showDashboard(userData) {
    userPhoto.src = userData.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = userData.nama || 'User';
    userRole.textContent = userData.role || 'student';
    roleDisplay.textContent = userData.role || 'student';
    
    showSection('dashboard');
    
    // Cek apakah profil lengkap (classId & nis ada)
    if (!userData.classId || !userData.nis) {
        document.getElementById('dashboardContent').innerHTML = `
            <p>⚠️ Profil Anda belum lengkap. Silakan lengkapi data diri.</p>
            <button id="lengkapiProfilBtn">Lengkapi Profil</button>
        `;
        
        document.getElementById('lengkapiProfilBtn')?.addEventListener('click', () => {
            showProfileSetup(auth.currentUser);
        });
    } else {
        // ===== STEP 9: Tambahkan tombol Scan QR =====
        document.getElementById('dashboardContent').innerHTML = `
            <p>✅ Selamat datang di dashboard!</p>
            <p><strong>Nama:</strong> ${userData.nama}</p>
            <p><strong>NIS:</strong> ${userData.nis}</p>
            <p><strong>Kelas:</strong> ${userData.classId}</p>
            <p><strong>Role:</strong> ${userData.role}</p>
            <button id="scanQrBtn">📷 Scan QR Absensi</button>
            <div id="qrStatusMessage" style="margin-top:12px;padding:12px;border-radius:4px;display:none;"></div>
        `;
        
        document.getElementById('scanQrBtn')?.addEventListener('click', () => {
            openScanner();
        });
    }
}

// ===== PROFILE SETUP =====
function showProfileSetup(user) {
    showSection('profileSetup');
    
    if (user.displayName) {
        profileNama.value = user.displayName;
    }
    
    profileForm.onsubmit = async (e) => {
        e.preventDefault();
        
        const nama = profileNama.value.trim();
        const nis = profileNis.value.trim() || null;
        const classId = profileKelas.value.trim() || null;
        
        if (!nama) {
            alert('Nama wajib diisi');
            return;
        }
        
        try {
            const userDocRef = doc(db, 'users', user.uid);
            await setDoc(userDocRef, {
                nama: nama,
                nis: nis,
                email: user.email || null,
                photoURL: user.photoURL || null,
                role: 'student',
                classId: classId,
                waliKelasId: null,
                updatedAt: serverTimestamp()
            }, { merge: true });
            
            alert('Profil berhasil disimpan!');
            await loadUserProfile(user);
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Gagal menyimpan profil. Silakan coba lagi.');
        }
    };
}

// ===== STEP 9: QR SCANNER FUNCTIONS =====

// Cek apakah library tersedia
function isQrLibraryAvailable() {
    const available = typeof Html5Qrcode !== 'undefined';
    console.log('[QR] Library available:', available);
    return available;
}

// Set status QR
function setQrStatus(type, message) {
    qrStatus.textContent = message;
    qrStatus.className = type;
    console.log('[QR] Status:', type, message);
}

function clearQrStatus() {
    qrStatus.textContent = '';
    qrStatus.className = '';
}

// Cek apakah element video memiliki track aktif
function hasActiveVideoTracks() {
    try {
        const video = document.querySelector('#qrReader video');
        if (video && video.srcObject) {
            const tracks = video.srcObject.getTracks();
            return tracks.some(t => t.readyState === 'live');
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Buka scanner
async function openScanner() {
    console.log('[QR] openScanner() called');
    
    if (!auth.currentUser) {
        console.log('[QR] User not logged in');
        alert('Silakan login terlebih dahulu.');
        return;
    }
    
    if (!isQrLibraryAvailable()) {
        console.error('[QR] Html5Qrcode library not loaded');
        setQrStatus('error', '❌ QR Scanner gagal dimuat. Silakan reload halaman.');
        return;
    }
    
    // Reset status
    clearQrStatus();
    qrScannerInstruction.textContent = '⏳ Menyiapkan kamera...';
    isScannerRunning = false;
    isProcessingAttendance = false;
    
    showSection('qrScanner');
    
    // Cek dukungan kamera
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[QR] Camera API not supported');
        setQrStatus('error', '❌ Kamera tidak tersedia atau tidak didukung.');
        qrScannerInstruction.textContent = 'Kamera tidak didukung';
        return;
    }
    
    // Beri waktu DOM render
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const container = document.getElementById('qrReader');
    if (!container) {
        console.error('[QR] Container #qrReader not found');
        setQrStatus('error', '❌ Terjadi kesalahan internal. Silakan reload halaman.');
        return;
    }
    
    console.log('[QR] Container found, initializing scanner...');
    setQrStatus('loading', '⏳ Meminta izin kamera...');
    
    try {
        // Bersihkan instance sebelumnya
        if (html5QrCode) {
            console.log('[QR] Cleaning up previous instance');
            try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
            try { await html5QrCode.clear(); } catch (e) { /* ignore */ }
            html5QrCode = null;
        }
        
        // Dapatkan daftar kamera
        console.log('[QR] Getting camera list...');
        let cameras = [];
        try {
            cameras = await Html5Qrcode.getCameras();
            console.log('[QR] Cameras detected:', cameras.length);
            cameras.forEach((c, i) => {
                console.log(`[QR] Camera ${i}:`, c.id, c.label);
            });
        } catch (cameraError) {
            console.warn('[QR] Could not get camera list:', cameraError);
        }
        
        // Pilih kamera belakang jika tersedia
        let selectedCameraId = null;
        let selectedLabel = 'default';
        
        if (cameras && cameras.length > 0) {
            // Cari kamera dengan label "back", "rear", atau "environment"
            const backCamera = cameras.find(c => {
                const label = c.label.toLowerCase();
                return label.includes('back') || 
                       label.includes('rear') || 
                       label.includes('environment');
            });
            
            if (backCamera) {
                selectedCameraId = backCamera.id;
                selectedLabel = backCamera.label || 'back camera';
                console.log('[QR] Selected back camera:', selectedLabel);
            } else {
                selectedCameraId = cameras[0].id;
                selectedLabel = cameras[0].label || 'camera 0';
                console.log('[QR] No back camera found, using first:', selectedLabel);
            }
        }
        
        // Inisialisasi html5-qrcode
        console.log('[QR] Creating Html5Qrcode instance...');
        html5QrCode = new Html5Qrcode("qrReader");
        console.log('[QR] Html5Qrcode instance created');
        
        // Konfigurasi kamera
        const config = {
            fps: 15,
            qrbox: { width: 200, height: 200 },
            videoConstraints: {
                facingMode: "environment"
            }
        };
        
        // Jika ada camera ID spesifik, gunakan
        let startConfig = config.videoConstraints;
        if (selectedCameraId) {
            startConfig = {
                deviceId: { exact: selectedCameraId }
            };
        }
        
        console.log('[QR] Starting scanner with config:', JSON.stringify(startConfig, null, 2));
        
        // Handler QR terdeteksi
        const onScanSuccess = async (decodedText, decodedResult) => {
            console.log('[QR] QR detected! Text:', decodedText);
            
            if (isProcessingAttendance) {
                console.log('[QR] Already processing, ignoring duplicate');
                return;
            }
            
            // STOP scanner segera
            console.log('[QR] Stopping scanner after detection');
            await stopScannerInternal();
            
            // Proses absensi
            await processAttendanceWithQR(decodedText);
        };
        
        const onScanFailure = (errorMessage) => {
            // Hanya log jika ada error yang signifikan
            // console.debug('[QR] Scan failure:', errorMessage);
        };
        
        // START scanner
        console.log('[QR] Starting scanner...');
        setQrStatus('loading', '📷 Membuka kamera...');
        qrScannerInstruction.textContent = '📷 Mengakses kamera...';
        
        await html5QrCode.start(
            startConfig,
            onScanSuccess,
            onScanFailure
        );
        
        console.log('[QR] Scanner started successfully!');
        isScannerRunning = true;
        setQrStatus('success', '📷 Kamera aktif. Arahkan kamera ke QR.');
        qrScannerInstruction.textContent = '🔍 Arahkan kamera ke QR absensi';
        
    } catch (error) {
        console.error('[QR] Error starting scanner:', error);
        console.error('[QR] Error name:', error.name);
        console.error('[QR] Error message:', error.message);
        
        // Cleanup
        await stopScannerInternal();
        
        // Tangani berbagai error
        if (error.name === 'NotAllowedError' || 
            error.name === 'PermissionDeniedError' ||
            (error.message && error.message.toLowerCase().includes('permission'))) {
            setQrStatus('error', '❌ Izin kamera ditolak. Izinkan akses kamera di browser.');
            qrScannerInstruction.textContent = 'Izin kamera ditolak';
        } else if (error.name === 'NotFoundError' || 
                   (error.message && error.message.toLowerCase().includes('not found'))) {
            setQrStatus('error', '❌ Kamera tidak ditemukan. Pastikan HP Anda memiliki kamera.');
            qrScannerInstruction.textContent = 'Kamera tidak ditemukan';
        } else if (error.message && error.message.includes('SecurityError')) {
            setQrStatus('error', '❌ Akses kamera ditolak. Pastikan menggunakan HTTPS.');
            qrScannerInstruction.textContent = 'HTTPS diperlukan';
        } else if (error.message && error.message.toLowerCase().includes('no video stream')) {
            setQrStatus('error', '❌ Gagal mengakses kamera. Silakan coba lagi.');
            qrScannerInstruction.textContent = 'Gagal akses kamera';
        } else if (error.message && error.message.toLowerCase().includes('overconstrained')) {
            // Coba fallback ke kamera default tanpa constraint
            console.log('[QR] Overconstrained error, trying fallback without deviceId...');
            setQrStatus('loading', '📷 Mencoba kamera default...');
            qrScannerInstruction.textContent = '📷 Mengakses kamera default...';
            
            try {
                // Buat instance baru dengan konfigurasi sederhana
                if (html5QrCode) {
                    try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
                    try { await html5QrCode.clear(); } catch (e) { /* ignore */ }
                    html5QrCode = null;
                }
                
                html5QrCode = new Html5Qrcode("qrReader");
                
                const fallbackConfig = {
                    fps: 15,
                    qrbox: { width: 200, height: 200 },
                    videoConstraints: {
                        facingMode: "environment"
                    }
                };
                
                const onScanSuccessFallback = async (decodedText, decodedResult) => {
                    console.log('[QR] QR detected! Text:', decodedText);
                    if (isProcessingAttendance) return;
                    await stopScannerInternal();
                    await processAttendanceWithQR(decodedText);
                };
                
                const onScanFailureFallback = (errorMessage) => {
                    // console.debug('[QR] Fallback scan failure:', errorMessage);
                };
                
                await html5QrCode.start(
                    fallbackConfig.videoConstraints,
                    onScanSuccessFallback,
                    onScanFailureFallback
                );
                
                console.log('[QR] Fallback scanner started successfully!');
                isScannerRunning = true;
                setQrStatus('success', '📷 Kamera aktif. Arahkan kamera ke QR.');
                qrScannerInstruction.textContent = '🔍 Arahkan kamera ke QR absensi';
                
            } catch (fallbackError) {
                console.error('[QR] Fallback also failed:', fallbackError);
                setQrStatus('error', '❌ Kamera tidak kompatibel. Silakan coba browser lain.');
                qrScannerInstruction.textContent = 'Kamera tidak kompatibel';
            }
        } else {
            setQrStatus('error', '❌ Gagal membuka kamera: ' + (error.message || 'Unknown error'));
            qrScannerInstruction.textContent = 'Error: ' + (error.message || 'Unknown');
        }
    }
}

// Stop scanner internal
async function stopScannerInternal() {
    console.log('[QR] stopScannerInternal() called');
    
    if (html5QrCode) {
        try {
            await html5QrCode.stop();
            console.log('[QR] Scanner stopped');
        } catch (stopError) {
            console.warn('[QR] Error stopping scanner:', stopError);
        }
        try {
            await html5QrCode.clear();
            console.log('[QR] Scanner cleared');
        } catch (clearError) {
            console.warn('[QR] Error clearing scanner:', clearError);
        }
        html5QrCode = null;
    }
    
    isScannerRunning = false;
    
    // Hentikan semua track kamera (fallback)
    try {
        const videoElement = document.querySelector('#qrReader video');
        if (videoElement && videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            console.log('[QR] Stopping', tracks.length, 'video tracks');
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    } catch (error) {
        console.warn('[QR] Error stopping video tracks:', error);
    }
}

// Tutup scanner
async function closeScanner() {
    console.log('[QR] closeScanner() called');
    
    await stopScannerInternal();
    clearQrStatus();
    qrScannerInstruction.textContent = 'Scanner ditutup';
    
    if (auth.currentUser) {
        try {
            const userDocRef = doc(db, 'users', auth.currentUser.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                showDashboard(userDoc.data());
            } else {
                showSection('login');
            }
        } catch (error) {
            console.error('[QR] Error returning to dashboard:', error);
            showSection('login');
        }
    } else {
        showSection('login');
    }
}

// ===== STEP 9: PROCESS ATTENDANCE =====

async function processAttendanceWithQR(qrData) {
    if (isProcessingAttendance) {
        return;
    }
    
    if (!qrData || typeof qrData !== 'string' || qrData.trim() === '') {
        showAttendanceResult(false, { error: '❌ QR absensi tidak valid (kosong).' });
        return;
    }
    
    isProcessingAttendance = true;
    
    setQrStatus('loading', '⏳ Memproses absensi...');
    qrScannerInstruction.textContent = '⏳ Menghubungi server...';
    
    try {
        const functions = getFunctions();
        const processAttendance = httpsCallable(functions, 'processAttendance');
        
        console.log('[QR] Calling processAttendance with qrToken:', qrData.trim());
        
        const result = await processAttendance({
            qrToken: qrData.trim()
        });
        
        const data = result.data;
        console.log('[QR] Attendance result:', data);
        
        showAttendanceResult(true, data);
        
    } catch (error) {
        console.error('[QR] Attendance error:', error);
        
        let errorMessage = '❌ Gagal melakukan absensi. Silakan coba lagi.';
        let errorType = 'error';
        
        if (error.code === 'already-exists' || 
            error.message?.includes('sudah absen') ||
            error.message?.includes('DUPLICATE')) {
            errorMessage = 'ℹ️ Anda sudah melakukan absensi hari ini.';
            errorType = 'info';
        } else if (error.message?.includes('INVALID_QR') || 
                   error.message?.includes('QR Token tidak valid')) {
            errorMessage = '❌ QR absensi tidak valid.';
            errorType = 'error';
        } else if (error.message?.includes('PERMISSION_DENIED') || 
                   error.message?.includes('Hanya student')) {
            errorMessage = '❌ Anda tidak memiliki izin untuk melakukan absensi.';
            errorType = 'error';
        } else if (error.message?.includes('PROFILE_INCOMPLETE') || 
                   error.message?.includes('Profil belum lengkap')) {
            errorMessage = '⚠️ Profil belum lengkap. Silakan lengkapi data diri Anda.';
            errorType = 'info';
        } else if (error.message?.includes('USER_NOT_FOUND') || 
                   error.message?.includes('User tidak ditemukan')) {
            errorMessage = '❌ Data pengguna tidak ditemukan.';
            errorType = 'error';
        } else if (error.message?.includes('UNAUTHENTICATED') || 
                   error.message?.includes('Silakan login')) {
            errorMessage = '⚠️ Silakan login terlebih dahulu.';
            errorType = 'info';
        } else if (error.message?.includes('Network') || 
                   error.message?.includes('network') ||
                   error.message?.includes('Failed to fetch')) {
            errorMessage = '❌ Gagal terhubung ke server. Periksa koneksi internet.';
            errorType = 'error';
        } else if (error.message?.includes('permission-denied')) {
            errorMessage = '❌ Anda tidak memiliki izin untuk melakukan ini.';
            errorType = 'error';
        }
        
        showAttendanceResult(false, { error: errorMessage, type: errorType });
        
    } finally {
        isProcessingAttendance = false;
    }
}

// ===== STEP 9: SHOW ATTENDANCE RESULT =====

function showAttendanceResult(success, data) {
    showSection('attendanceResult');
    
    if (success) {
        attendanceResultTitle.textContent = '✅ ABSENSI BERHASIL';
        attendanceResultTitle.className = 'success';
        
        attendanceResultData.innerHTML = `
            <p><strong>Status:</strong> ${data.status || 'HADIR'}</p>
            <p><strong>Tanggal:</strong> ${data.tanggal || '-'}</p>
            <p><strong>Jam:</strong> ${data.jam || '-'}</p>
        `;
    } else {
        const errorType = data.type || 'error';
        attendanceResultTitle.textContent = data.error || '❌ Gagal Absensi';
        attendanceResultTitle.className = errorType;
        
        attendanceResultData.innerHTML = `
            <p>${data.error || 'Terjadi kesalahan. Silakan coba lagi.'}</p>
        `;
    }
}

// ===== STEP 9: SCAN AGAIN =====

scanAgainBtn?.addEventListener('click', async () => {
    console.log('[QR] Scan Again clicked');
    
    isProcessingAttendance = false;
    isScannerRunning = false;
    
    if (html5QrCode) {
        try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
        try { await html5QrCode.clear(); } catch (e) { /* ignore */ }
        html5QrCode = null;
    }
    
    if (auth.currentUser) {
        try {
            const userDocRef = doc(db, 'users', auth.currentUser.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                showDashboard(userDoc.data());
                setTimeout(() => { openScanner(); }, 300);
            } else {
                showSection('login');
            }
        } catch (error) {
            console.error('[QR] Error returning to dashboard:', error);
            showSection('login');
        }
    } else {
        showSection('login');
    }
});

// ===== STEP 9: CLOSE SCANNER =====

closeScannerBtn?.addEventListener('click', async () => {
    console.log('[QR] Close Scanner button clicked');
    await closeScanner();
});

// ===== AUTH STATE LISTENER =====
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed:', user ? user.uid : 'null');
    
    currentUser = user;
    
    if (!user) {
        console.log('[QR] User logged out, stopping scanner');
        await stopScannerInternal();
        isProcessingAttendance = false;
        showSection('login');
        return;
    }
    
    await loadUserProfile(user);
});

// ===== LOGIN GOOGLE =====
loginBtn?.addEventListener('click', async () => {
    try {
        showSection('loading');
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error('Login error:', error);
        showSection('login');
        alert('Login gagal: ' + error.message);
    }
});

// ===== LOGOUT =====
logoutBtn?.addEventListener('click', async () => {
    console.log('[QR] Logout clicked, stopping scanner');
    try {
        await stopScannerInternal();
        isProcessingAttendance = false;
        await signOut(auth);
        showSection('login');
    } catch (error) {
        console.error('Logout error:', error);
        alert('Gagal logout: ' + error.message);
    }
});

console.log('✅ Firebase Foundation siap!');
console.log('[QR] Script loaded. Html5Qrcode available:', typeof Html5Qrcode !== 'undefined');