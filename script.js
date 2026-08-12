l// ===== EXISTING CODE =====
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
const qrGeneratorSection = document.getElementById('qrGeneratorSection');

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

// ===== QR GENERATOR DOM REFERENCES =====
const generateQrBtn = document.getElementById('generateQrBtn');
const downloadQrBtn = document.getElementById('downloadQrBtn');
const printQrBtn = document.getElementById('printQrBtn');
const qrTestResult = document.getElementById('qrTestResult');
const qrTokenDisplay = document.getElementById('qrTokenDisplay');
const qrStatusMessage = document.getElementById('qrStatusMessage');

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
    qrGeneratorSection.style.display = 'none';
    
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
    } else if (sectionId === 'qrGenerator') {
        qrGeneratorSection.style.display = 'block';
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
        // ===== DASHBOARD WITH QR GENERATOR & SCANNER =====
        document.getElementById('dashboardContent').innerHTML = `
            <p>✅ Selamat datang di dashboard!</p>
            <p><strong>Nama:</strong> ${userData.nama}</p>
            <p><strong>NIS:</strong> ${userData.nis}</p>
            <p><strong>Kelas:</strong> ${userData.classId}</p>
            <p><strong>Role:</strong> ${userData.role}</p>
            
            <div style="margin-top:16px;padding:16px;background:#e8f5e9;border-radius:8px;border:1px solid #c8e6c9;">
                <p><strong>🧪 QR Test</strong></p>
                <p style="font-size:14px;color:#555;">Token: <code style="background:#f5f5f5;padding:2px 8px;border-radius:4px;">qrmvp2026</code></p>
                
                <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
                    <button id="generateQrBtn" style="background:#28a745;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Generate QR</button>
                    <button id="downloadQrBtn" style="background:#007bff;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Download PNG</button>
                    <button id="printQrBtn" style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Print QR</button>
                </div>
                
                <div id="qrTestResult" style="margin-top:16px;display:flex;justify-content:center;min-height:50px;"></div>
                <div id="qrTokenDisplay" style="margin-top:8px;font-size:14px;color:#666;"></div>
            </div>
            
            <button id="scanQrBtn" style="margin-top:16px;background:#17a2b8;color:white;border:none;padding:12px 24px;border-radius:4px;cursor:pointer;font-size:16px;width:100%;">📷 Scan QR Absensi</button>
            <div id="qrStatusMessage" style="margin-top:12px;padding:12px;border-radius:4px;display:none;"></div>
        `;
        
        // ===== QR GENERATOR: Event Listeners =====
        document.getElementById('generateQrBtn')?.addEventListener('click', () => {
            if (typeof generateQR === 'function') {
                generateQR('qrmvp2026', 'qrTestResult');
            } else {
                console.error('[QR] generateQR function not available');
                alert('QR Generator belum siap. Silakan reload halaman.');
            }
        });
        
        document.getElementById('downloadQrBtn')?.addEventListener('click', () => {
            if (typeof downloadQR === 'function') {
                downloadQR();
            } else {
                alert('Download QR tidak tersedia.');
            }
        });
        
        document.getElementById('printQrBtn')?.addEventListener('click', () => {
            if (typeof printQR === 'function') {
                printQR();
            } else {
                alert('Print QR tidak tersedia.');
            }
        });
        
        // ===== STEP 9: Scan QR Button =====
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

// ============================================
// QR SCANNER — ROOT CAUSE FIX
// ============================================

// Cek apakah library tersedia
function isQrLibraryAvailable() {
    const available = typeof Html5Qrcode !== 'undefined';
    console.log('[QR DEBUG] Html5Qrcode:', available ? 'function' : 'undefined');
    return available;
}

// Set status QR
function setQrStatus(type, message) {
    if (qrStatus) {
        qrStatus.textContent = message;
        qrStatus.className = type;
    }
    console.log('[QR] Status:', type, message);
}

function clearQrStatus() {
    if (qrStatus) {
        qrStatus.textContent = '';
        qrStatus.className = '';
    }
}

// ============================================
// OPEN SCANNER — FIXED
// ============================================
async function openScanner() {
    console.log('[QR] ========================================');
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
    if (qrScannerInstruction) qrScannerInstruction.textContent = '📷 Menyiapkan kamera...';
    isScannerRunning = false;
    isProcessingAttendance = false;
    
    showSection('qrScanner');
    
    // DEBUG: Cek lingkungan
    console.log('[QR DEBUG] protocol:', location.protocol);
    console.log('[QR DEBUG] hostname:', location.hostname);
    console.log('[QR DEBUG] mediaDevices:', !!navigator.mediaDevices);
    console.log('[QR DEBUG] getUserMedia:', !!navigator.mediaDevices?.getUserMedia);
    console.log('[QR DEBUG] qrReader:', document.getElementById('qrReader'));
    
    // Cek dukungan kamera
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[QR] Camera API not supported');
        setQrStatus('error', '❌ Kamera tidak tersedia atau tidak didukung.');
        if (qrScannerInstruction) qrScannerInstruction.textContent = 'Kamera tidak didukung';
        return;
    }
    
    // Beri waktu DOM render
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const container = document.getElementById('qrReader');
    if (!container) {
        console.error('[QR] Container #qrReader not found');
        setQrStatus('error', '❌ Terjadi kesalahan internal. Silakan reload halaman.');
        return;
    }
    
    console.log('[QR] Container found, initializing scanner...');
    setQrStatus('loading', '📷 Meminta izin kamera...');
    
    try {
        // Bersihkan instance sebelumnya
        if (html5QrCode) {
            console.log('[QR] Cleaning up previous instance');
            try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
            try { await html5QrCode.clear(); } catch (e) { /* ignore */ }
            html5QrCode = null;
        }
        
        // Inisialisasi html5-qrcode
        console.log('[QR] Creating Html5Qrcode instance...');
        html5QrCode = new Html5Qrcode("qrReader");
        console.log('[QR] Html5Qrcode instance created');
        
        // ===== CAMERA CONFIG =====
        const cameraConfig = {
            facingMode: "environment"
        };
        
        // ===== SCAN CONFIG =====
        const scanConfig = {
            fps: 15,
            qrbox: { width: 280, height: 280 },
            aspectRatio: 1.0
        };
        
        console.log('[QR] Camera config:', JSON.stringify(cameraConfig, null, 2));
        console.log('[QR] Scan config:', JSON.stringify(scanConfig, null, 2));
        
        // ===== HANDLER QR DETEKSI =====
        const onScanSuccess = async (decodedText, decodedResult) => {
            console.log('[QR] ========================================');
            console.log('[QR] 🎯 QR DETECTED!');
            console.log('[QR] TEXT:', decodedText);
            console.log('[QR] ========================================');
            
            if (isProcessingAttendance) {
                console.log('[QR] Already processing, ignoring duplicate');
                return;
            }
            
            isProcessingAttendance = true;
            
            setQrStatus('success', '✅ QR TERDETEKSI: ' + decodedText);
            if (qrScannerInstruction) {
                qrScannerInstruction.textContent = '✅ QR berhasil dibaca. Memproses absensi...';
            }
            
            try {
                await stopScannerInternal();
            } catch (error) {
                console.warn('[QR] Stop scanner warning:', error);
            }
            
            await processAttendanceWithQR(decodedText);
        };
        
        let lastScanFailure = 0;
        const onScanFailure = (errorMessage) => {
            const now = Date.now();
            if (now - lastScanFailure > 3000) {
                console.log('[QR] Waiting for QR...', errorMessage || '');
                lastScanFailure = now;
            }
        };
        
        // ===== START SCANNER — FIXED API CALL =====
        console.log('[QR] Starting scanner with correct API...');
        setQrStatus('loading', '📷 Membuka kamera...');
        if (qrScannerInstruction) qrScannerInstruction.textContent = '📷 Mengakses kamera...';
        
        await html5QrCode.start(
            cameraConfig,
            scanConfig,
            onScanSuccess,
            onScanFailure
        );
        
        console.log('[QR DEBUG] ✅ CAMERA STARTED SUCCESSFULLY');
        isScannerRunning = true;
        setQrStatus('success', '📷 Kamera aktif. Arahkan QR ke kotak scan.');
        if (qrScannerInstruction) qrScannerInstruction.textContent = '🔍 Arahkan QR ke kotak scan';
        
    } catch (error) {
        console.error('[QR] ❌ START ERROR');
        console.error('[QR] name:', error?.name);
        console.error('[QR] message:', error?.message);
        console.error('[QR] full error:', error);
        
        // Cleanup
        await stopScannerInternal();
        
        // Tangani error
        if (error.name === 'NotAllowedError' || 
            error.name === 'PermissionDeniedError' ||
            (error.message && error.message.toLowerCase().includes('permission'))) {
            setQrStatus('error', '❌ Izin kamera ditolak. Izinkan akses kamera di browser.');
            if (qrScannerInstruction) qrScannerInstruction.textContent = 'Izin kamera ditolak';
        } else if (error.name === 'NotFoundError' || 
                   (error.message && error.message.toLowerCase().includes('not found'))) {
            setQrStatus('error', '❌ Kamera tidak ditemukan. Pastikan HP Anda memiliki kamera.');
            if (qrScannerInstruction) qrScannerInstruction.textContent = 'Kamera tidak ditemukan';
        } else if (error.name === 'NotReadableError' || 
                   (error.message && error.message.toLowerCase().includes('readable'))) {
            setQrStatus('error', '❌ Kamera sedang digunakan aplikasi lain. Tutup aplikasi kamera.');
            if (qrScannerInstruction) qrScannerInstruction.textContent = 'Kamera sibuk';
        } else if (error.name === 'OverconstrainedError' || 
                   (error.message && error.message.toLowerCase().includes('overconstrained'))) {
            // Fallback ke kamera pertama yang tersedia
            console.log('[QR] Overconstrained, trying fallback to first camera...');
            setQrStatus('loading', '⚠️ Mencoba kamera lain...');
            
            try {
                const cameras = await Html5Qrcode.getCameras();
                console.log('[QR] Available cameras:', cameras);
                
                if (cameras && cameras.length > 0) {
                    const fallbackCameraId = cameras[0].id;
                    console.log('[QR] Fallback camera ID:', fallbackCameraId);
                    
                    // Buat instance baru
                    if (html5QrCode) {
                        try { await html5QrCode.stop(); } catch (e) { /* ignore */ }
                        try { await html5QrCode.clear(); } catch (e) { /* ignore */ }
                        html5QrCode = null;
                    }
                    
                    html5QrCode = new Html5Qrcode("qrReader");
                    
                    const fallbackScanConfig = {
                        fps: 15,
                        qrbox: { width: 280, height: 280 },
                        aspectRatio: 1.0
                    };
                    
                    const fallbackSuccess = async (decodedText, decodedResult) => {
                        console.log('[QR] 🎯 QR DETECTED (fallback)!');
                        console.log('[QR] TEXT:', decodedText);
                        if (isProcessingAttendance) return;
                        isProcessingAttendance = true;
                        setQrStatus('success', '✅ QR TERDETEKSI: ' + decodedText);
                        if (qrScannerInstruction) {
                            qrScannerInstruction.textContent = '✅ QR berhasil dibaca. Memproses absensi...';
                        }
                        try { await stopScannerInternal(); } catch (e) { /* ignore */ }
                        await processAttendanceWithQR(decodedText);
                    };
                    
                    let lastFallbackFailure = 0;
                    const fallbackFailure = (errorMessage) => {
                        const now = Date.now();
                        if (now - lastFallbackFailure > 3000) {
                            console.log('[QR] Waiting for QR (fallback)...', errorMessage || '');
                            lastFallbackFailure = now;
                        }
                    };
                    
                    await html5QrCode.start(
                        { deviceId: { exact: fallbackCameraId } },
                        fallbackScanConfig,
                        fallbackSuccess,
                        fallbackFailure
                    );
                    
                    console.log('[QR DEBUG] ✅ FALLBACK CAMERA STARTED');
                    isScannerRunning = true;
                    setQrStatus('success', '📷 Kamera aktif (fallback). Arahkan QR ke kotak scan.');
                    if (qrScannerInstruction) qrScannerInstruction.textContent = '🔍 Arahkan QR ke kotak scan';
                } else {
                    setQrStatus('error', '❌ Tidak ada kamera tersedia.');
                    if (qrScannerInstruction) qrScannerInstruction.textContent = 'Tidak ada kamera';
                }
            } catch (fallbackError) {
                console.error('[QR] Fallback error:', fallbackError);
                setQrStatus('error', '❌ Gagal mengakses kamera. Silakan coba browser lain.');
                if (qrScannerInstruction) qrScannerInstruction.textContent = 'Kamera tidak kompatibel';
            }
        } else if (error.message && error.message.includes('SecurityError')) {
            setQrStatus('error', '❌ Akses kamera ditolak. Pastikan menggunakan HTTPS.');
            if (qrScannerInstruction) qrScannerInstruction.textContent = 'HTTPS diperlukan';
        } else {
            setQrStatus('error', '❌ Gagal membuka kamera: ' + (error.message || 'Unknown error'));
            if (qrScannerInstruction) qrScannerInstruction.textContent = 'Error: ' + (error.message || 'Unknown');
        }
    }
}

// ============================================
// STOP SCANNER — FIXED
// ============================================
async function stopScannerInternal() {
    console.log('[QR] stopScannerInternal() called');
    
    if (!html5QrCode) {
        isScannerRunning = false;
        console.log('[QR] No scanner instance to stop');
        return;
    }
    
    try {
        if (isScannerRunning) {
            await html5QrCode.stop();
            console.log('[QR] Scanner stopped');
        }
    } catch (error) {
        console.warn('[QR] stop warning:', error);
    }
    
    try {
        await html5QrCode.clear();
        console.log('[QR] Scanner cleared');
    } catch (error) {
        console.warn('[QR] clear warning:', error);
    }
    
    html5QrCode = null;
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

// ============================================
// CLOSE SCANNER
// ============================================
async function closeScanner() {
    console.log('[QR] closeScanner() called');
    
    await stopScannerInternal();
    clearQrStatus();
    if (qrScannerInstruction) qrScannerInstruction.textContent = 'Scanner ditutup';
    
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

// ============================================
// PROCESS ATTENDANCE (DIPERTAHANKAN)
// ============================================
async function processAttendanceWithQR(qrData) {
    console.log('[QR] processAttendanceWithQR() called with:', qrData);
    
    if (isProcessingAttendance) {
        console.log('[QR] Already processing, ignoring');
        return;
    }
    
    if (!qrData || typeof qrData !== 'string' || qrData.trim() === '') {
        console.log('[QR] Empty QR data');
        showAttendanceResult(false, { error: '❌ QR absensi tidak valid (kosong).' });
        return;
    }
    
    isProcessingAttendance = true;
    
    setQrStatus('loading', '⏳ Memproses absensi...');
    if (qrScannerInstruction) qrScannerInstruction.textContent = '⏳ Menghubungi server...';
    
    try {
        const functions = getFunctions();
        const processAttendance = httpsCallable(functions, 'processAttendance');
        
        const trimmedToken = qrData.trim();
        console.log('[QR] Calling processAttendance with qrToken:', trimmedToken);
        
        const result = await processAttendance({
            qrToken: trimmedToken
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
console.log('[QR DEBUG] Script loaded. Html5Qrcode available:', typeof Html5Qrcode !== 'undefined');
console.log('[QR-GENERATOR] QRCode.js available:', typeof QRCode !== 'undefined');
console.log('[QR-GENERATOR] qrcode.js functions:', typeof generateQR !== 'undefined');