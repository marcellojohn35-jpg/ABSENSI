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

// ===== DOM REFERENCES =====
const loadingState = document.getElementById('loadingState');
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const profileSetupSection = document.getElementById('profileSetupSection');

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

// ===== HELPER FUNCTIONS =====

// Tampilkan section tertentu, sembunyikan yang lain
function showSection(sectionId) {
    loadingState.style.display = 'none';
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'none';
    profileSetupSection.style.display = 'none';
    
    if (sectionId === 'loading') {
        loadingState.style.display = 'block';
    } else if (sectionId === 'login') {
        loginSection.style.display = 'block';
    } else if (sectionId === 'dashboard') {
        dashboardSection.style.display = 'block';
    } else if (sectionId === 'profileSetup') {
        profileSetupSection.style.display = 'block';
    }
}

// ===== LOAD USER PROFILE =====
async function loadUserProfile(user) {
    showSection('loading');
    
    try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
            // Profil belum ada → menunggu createUserProfile dari Cloud Function
            console.log('Profil belum ada, menunggu createUserProfile...');
            
            // Coba cek lagi setelah 2 detik (memberi waktu trigger)
            setTimeout(async () => {
                try {
                    const retryDoc = await getDoc(userDocRef);
                    if (retryDoc.exists()) {
                        showDashboard(retryDoc.data());
                    } else {
                        // Jika masih belum ada, minta user lengkapi profil manual
                        showProfileSetup(user);
                    }
                } catch (error) {
                    console.error('Error retrying profile check:', error);
                    showProfileSetup(user);
                }
            }, 2000);
            
            return;
        }
        
        // Profil ada → tampilkan dashboard
        showDashboard(userDoc.data());
        
    } catch (error) {
        console.error('Error loading user profile:', error);
        showSection('login');
        alert('Terjadi error saat memuat profil. Silakan coba lagi.');
    }
}

// ===== DASHBOARD =====
function showDashboard(userData) {
    // Tampilkan info user
    userPhoto.src = userData.photoURL || 'https://via.placeholder.com/50';
    userName.textContent = userData.nama || 'User';
    userRole.textContent = userData.role || 'student';
    roleDisplay.textContent = userData.role || 'student';
    
    showSection('dashboard');
    
    // Cek apakah profil lengkap (classId & nis ada)
    if (!userData.classId || !userData.nis) {
        // Tampilkan notifikasi untuk melengkapi profil
        document.getElementById('dashboardContent').innerHTML = `
            <p>⚠️ Profil Anda belum lengkap. Silakan lengkapi data diri.</p>
            <button id="lengkapiProfilBtn">Lengkapi Profil</button>
        `;
        
        document.getElementById('lengkapiProfilBtn')?.addEventListener('click', () => {
            showProfileSetup(auth.currentUser);
        });
    } else {
        document.getElementById('dashboardContent').innerHTML = `
            <p>✅ Selamat datang di dashboard!</p>
            <p><strong>Nama:</strong> ${userData.nama}</p>
            <p><strong>NIS:</strong> ${userData.nis}</p>
            <p><strong>Kelas:</strong> ${userData.classId}</p>
            <p><strong>Role:</strong> ${userData.role}</p>
            <p style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:4px;">
                🎯 Fitur absensi akan segera hadir.<br>
                Scan QR untuk absensi.
            </p>
        `;
    }
}

// ===== PROFILE SETUP =====
function showProfileSetup(user) {
    showSection('profileSetup');
    
    // Pre-fill nama dari Google jika ada
    if (user.displayName) {
        profileNama.value = user.displayName;
    }
    
    // Handle form submit
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
            // Refresh dashboard menggunakan helper yang sama
            await loadUserProfile(user);
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Gagal menyimpan profil. Silakan coba lagi.');
        }
    };
}

// ===== AUTH STATE LISTENER =====
// Hanya SATU listener utama
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed:', user ? user.uid : 'null');
    
    if (!user) {
        // User belum login
        showSection('login');
        return;
    }
    
    // User sudah login → load profile
    await loadUserProfile(user);
});

// ===== LOGIN GOOGLE =====
loginBtn?.addEventListener('click', async () => {
    try {
        showSection('loading');
        await signInWithPopup(auth, provider);
        // Auth state listener akan menangani selanjutnya
    } catch (error) {
        console.error('Login error:', error);
        showSection('login');
        alert('Login gagal: ' + error.message);
    }
});

// ===== LOGOUT =====
logoutBtn?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showSection('login');
    } catch (error) {
        console.error('Logout error:', error);
        alert('Gagal logout: ' + error.message);
    }
});

console.log('✅ Firebase Foundation siap!');