// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    onAuthStateChanged,
    signOut,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDJTRAZyRZO2NsRD1jW2gkaapyhMRauYZ0",
    authDomain: "absensi-smasyadika4.firebaseapp.com",
    projectId: "absensi-smasyadika4",
    storageBucket: "absensi-smasyadika4.firebasestorage.app",
    messagingSenderId: "199523857348",
    appId: "1:199523857348:web:e67a6253ac1b4444e86a91"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

// Simpan sesi login di browser.
// User tetap login setelah refresh / browser ditutup,
// sampai logout dilakukan secara eksplisit.
const authPersistenceReady = setPersistence(
    auth,
    browserLocalPersistence
).catch((error) => {
    console.error('[AUTH PERSISTENCE ERROR]', error);
});

const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export {
    auth,
    authPersistenceReady,
    db,
    provider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    onAuthStateChanged,
    signOut
};