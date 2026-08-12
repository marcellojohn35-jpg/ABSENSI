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
    return typeof Html5Qrcode !== 'undefined';
}

// Buka scanner
async function openScanner() {
    // Cek apakah user masih login
    if (!auth.currentUser) {
        alert('Silakan login terlebih dahulu.');
        return;
    }
    
    // Cek apakah library tersedia
    if (!isQrLibraryAvailable()) {
        console.error('Html5Qrcode library not loaded');
        alert('Scanner tidak tersedia. Silakan reload halaman.');
        return;
    }
    
    // Reset status
    qrStatus.textContent = '';
    qrStatus.className = '';
    qrScannerInstruction.textContent = 'Arahkan kamera ke QR absensi';
    
    showSection('qrScanner');
    
    // Cek dukungan kamera
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        qrStatus.textContent = '❌ Kamera tidak tersedia atau tidak didukung.';
        qrStatus.className = 'error';
        return;
    }
    
    try {
        // Inisialisasi html5-qrcode
        html5QrCode = new Html5Qrcode("qrReader");
        
        // Konfigurasi kamera
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            videoConstraints: {
                facingMode: "environment",
                width: { ideal: 640 },
                height: { ideal: 480 }
            }
        };
        
        // Handler untuk QR terdeteksi
        const onScanSuccess = async (decodedText, decodedResult) => {
            console.log('QR detected:', decodedText);
            
            // Cegah duplicate request
            if (isProcessingAttendance) {
                console.log('Already processing, ignoring duplicate scan');
                return;
            }
            
            // Hentikan scanner segera
            await stopScanner();
            
            // Proses absensi
            await processAttendanceWithQR(decodedText);
        };
        
        const onScanFailure = (error) => {
            // Tidak perlu log setiap error, hanya untuk debugging
            // console.debug('QR scan failure:', error);
        };
        
        // Mulai scanner
        await html5QrCode.start(
            config.videoConstraints,
            onScanSuccess,
            onScanFailure
        );
        
        isScannerRunning = true;
        qrScannerInstruction.textContent = '🔍 Arahkan kamera ke QR absensi';
        
    } catch (error) {
        console.error('Error starting scanner:', error);
        
        // Cleanup jika error
        await stopScanner();
        
        // Tangani error permission
        if (error.name === 'NotAllowedError' || 
            error.name === 'PermissionDeniedError' ||
            error.message.includes('permission')) {
            qrStatus.textContent = '❌ Izin kamera diperlukan untuk scan QR. Silakan izinkan kamera di pengaturan browser.';
            qrStatus.className = 'error';
        } else if (error.name === 'NotFoundError' || 
                   error.message.includes('not found') ||
                   error.message.includes('no camera')) {
            qrStatus.textContent = '❌ Kamera tidak ditemukan. Pastikan HP Anda memiliki kamera.';
            qrStatus.className = 'error';
        } else if (error.message.includes('No video stream')) {
            qrStatus.textContent = '❌ Gagal mengakses kamera. Silakan coba lagi.';
            qrStatus.className = 'error';
        } else {
            qrStatus.textContent = '❌ Gagal membuka kamera: ' + (error.message || 'Unknown error');
            qrStatus.className = 'error';
        }
    }
}

// Stop scanner
async function stopScanner() {
    try {
        if (html5QrCode) {
            try {
                await html5QrCode.stop();
            } catch (stopError) {
                console.warn('Error stopping scanner (ignored):', stopError);
            }
            try {
                await html5QrCode.clear();
            } catch (clearError) {
                console.warn('Error clearing scanner (ignored):', clearError);
            }
        }
    } catch (error) {
        console.warn('Error in stopScanner:', error);
    }
    
    // Reset state
    isScannerRunning = false;
    
    // Hentikan semua track kamera secara manual (fallback)
    try {
        const videoElement = document.querySelector('#qrReader video');
        if (videoElement && videoElement.srcObject) {
            const tracks = videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
        }
    } catch (error) {
        console.warn('Error stopping video tracks:', error);
    }
    
    qrScannerInstruction.textContent = 'Scanner ditutup';
}

// Tutup scanner
async function closeScanner() {
    await stopScanner();
    html5QrCode = null;
    isScannerRunning = false;
    
    // Kembali ke dashboard
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
            console.error('Error returning to dashboard:', error);
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
    
    // Validasi qrData
    if (!qrData || typeof qrData !== 'string' || qrData.trim() === '') {
        showAttendanceResult(false, { error: '❌ QR absensi tidak valid (kosong).' });
        return;
    }
    
    isProcessingAttendance = true;
    
    // Tampilkan loading di status
    qrStatus.textContent = '⏳ Memproses absensi...';
    qrStatus.className = 'loading';
    qrScannerInstruction.textContent = '⏳ Menghubungi server...';
    
    try {
        // Panggil Cloud Function
        const functions = getFunctions();
        const processAttendance = httpsCallable(functions, 'processAttendance');
        
        const result = await processAttendance({
            qrToken: qrData.trim()
        });
        
        const data = result.data;
        
        // Tampilkan hasil sukses
        showAttendanceResult(true, data);
        
    } catch (error) {
        console.error('Attendance error:', error);
        
        // Parse error dari Firebase
        let errorMessage = '❌ Gagal melakukan absensi. Silakan coba lagi.';
        let errorType = 'error';
        
        // Cek apakah error dari backend
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
            errorMessage = '❌ Gagal terhubung ke server. Periksa koneksi internet dan coba lagi.';
            errorType = 'error';
        } else if (error.message?.includes('permission-denied')) {
            errorMessage = '❌ Anda tidak memiliki izin untuk melakukan ini.';
            errorType = 'error';
        }
        
        // Tampilkan hasil error
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
    // Reset state scanner
    isProcessingAttendance = false;
    isScannerRunning = false;
    html5QrCode = null;
    
    // Kembali ke dashboard dulu
    if (auth.currentUser) {
        try {
            const userDocRef = doc(db, 'users', auth.currentUser.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                showDashboard(userDoc.data());
                // Buka scanner lagi setelah dashboard render
                setTimeout(() => {
                    openScanner();
                }, 300);
            } else {
                showSection('login');
            }
        } catch (error) {
            console.error('Error returning to dashboard:', error);
            showSection('login');
        }
    } else {
        showSection('login');
    }
});

// ===== STEP 9: CLOSE SCANNER =====

closeScannerBtn?.addEventListener('click', async () => {
    await closeScanner();
});

// ===== AUTH STATE LISTENER =====
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed:', user ? user.uid : 'null');
    
    currentUser = user;
    
    if (!user) {
        // Pastikan scanner mati saat logout
        await stopScanner();
        html5QrCode = null;
        isScannerRunning = false;
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
    try {
        // Pastikan scanner mati saat logout
        await stopScanner();
        html5QrCode = null;
        isScannerRunning = false;
        isProcessingAttendance = false;
        await signOut(auth);
        showSection('login');
    } catch (error) {
        console.error('Logout error:', error);
        alert('Gagal logout: ' + error.message);
    }
});

console.log('✅ Firebase Foundation siap!');