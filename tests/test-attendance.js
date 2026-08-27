const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const {
  doc,
  setDoc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "absensi-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });

  try {
    const student1 = testEnv.authenticatedContext("student-1");
    const student2 = testEnv.authenticatedContext("student-2");

    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000);
    const lateAfter = new Date(now.getTime() + 30 * 60 * 1000);
    const end = new Date(now.getTime() + 60 * 60 * 1000);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, "users/student-1"), {
        role: "student",
        nama: "Student 1",
        classId: "XI.1",
      });

      await setDoc(doc(db, "users/student-2"), {
        role: "student",
        nama: "Student 2",
        classId: "XI.2",
      });

      await setDoc(doc(db, "attendanceSessions/session_001"), {
        sessionId: "session_001",
        date: "2026-08-19",
        startTime: Timestamp.fromDate(start),
        lateAfter: Timestamp.fromDate(lateAfter),
        endTime: Timestamp.fromDate(end),
        status: "ACTIVE",
        createdAt: Timestamp.fromDate(start),
      });
    });

    const attendanceRef = doc(
      student1.firestore(),
      "attendance/student-1_session_001"
    );

    console.log("TEST 1: Student absen untuk dirinya sendiri");

    await assertSucceeds(
      setDoc(attendanceRef, {
        uid: "student-1",
        tanggal: "2026-08-19",
        status: "HADIR",
        classId: "XI.1",
        method: "qr",
        sessionId: "session_001",
        createdAt: serverTimestamp(),
      })
    );

    console.log("TEST 2: Student mencoba absen untuk student lain");

    await assertFails(
      setDoc(
        doc(student1.firestore(), "attendance/student-2_session_001"),
        {
          uid: "student-2",
          tanggal: "2026-08-19",
          status: "HADIR",
          classId: "XI.2",
          method: "qr",
          sessionId: "session_001",
          createdAt: serverTimestamp(),
        }
      )
    );

    console.log("TEST 3: Student mencoba memakai classId palsu");

    await assertFails(
      setDoc(
        doc(student1.firestore(), "attendance/student-1_session_002"),
        {
          uid: "student-1",
          tanggal: "2026-08-19",
          status: "HADIR",
          classId: "XI.2",
          method: "qr",
          sessionId: "session_001",
          createdAt: serverTimestamp(),
        }
      )
    );

    console.log("TEST 4: Student mencoba memakai method manual");

    await assertFails(
      setDoc(
        doc(student2.firestore(), "attendance/student-2_session_001"),
        {
          uid: "student-2",
          tanggal: "2026-08-19",
          status: "IZIN",
          classId: "XI.2",
          method: "manual",
          sessionId: "session_001",
          createdAt: serverTimestamp(),
        }
      )
    );

    console.log("TEST 5: Student mencoba mengubah attendance");

    await assertFails(
      updateDoc(attendanceRef, {
        status: "IZIN",
      })
    );

    console.log("\n🔥 SEMUA TEST ATTENDANCE STUDENT SELESAI!");

  } finally {
    await testEnv.cleanup();
  }
})();
