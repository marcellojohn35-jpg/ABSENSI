const { HttpsError, onCall } = require("firebase-functions/v2/https");

// Endpoint lama dinonaktifkan karena melewati Firestore Rules
// dan tidak menjalankan pemeriksaan lokasi terbaru.
exports.processAttendance = onCall(() => {
    throw new HttpsError(
        "failed-precondition",
        "Endpoint absensi lama sudah dinonaktifkan. Gunakan alur absensi terbaru."
    );
});
