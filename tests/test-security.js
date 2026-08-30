const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  serverTimestamp,
} = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "absensi-security-test",
    firestore: {
      rules: fs.readFileSync("firebase/firestore.rules", "utf8"),
    },
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e) {
      console.log(`❌ ${name}`);
      console.log(`   ${e.message}`);
      failed++;
    }
  }

  const now = new Date();

  const start = new Date(now.getTime() - 60 * 60 * 1000);
  const lateAfter = new Date(now.getTime() + 30 * 60 * 1000);
  const end = new Date(now.getTime() + 60 * 60 * 1000);

  const today = "2026-08-19";

  try {
    // =========================================================
    // SEED DATABASE
    // =========================================================

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // USERS
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

      await setDoc(doc(db, "users/student-3"), {
        role: "student",
        nama: "Student 3",
        classId: "XI.1",
      });

      await setDoc(doc(db, "users/teacher-1"), {
        role: "teacher",
        nama: "Teacher 1",
        classId: "XI.1",
      });

      await setDoc(doc(db, "users/admin-1"), {
        role: "admin",
        nama: "Admin 1",
        classId: "XII.1",
      });

      await setDoc(doc(db, "users/casis-1"), {
        role: "casis",
        nama: "Casis 1",
        classId: "XI.1",
      });

      // ACTIVE SESSION
      await setDoc(doc(db, "attendanceSessions/session_001"), {
        sessionId: "session_001",
        date: today,
        startTime: Timestamp.fromDate(start),
        lateAfter: Timestamp.fromDate(lateAfter),
        endTime: Timestamp.fromDate(end),
        status: "ACTIVE",
        createdAt: Timestamp.fromDate(start),
      });

      // ARCHIVED SESSION
      await setDoc(doc(db, "attendanceSessions/session_002"), {
        sessionId: "session_002",
        date: today,
        startTime: Timestamp.fromDate(start),
        lateAfter: Timestamp.fromDate(lateAfter),
        endTime: Timestamp.fromDate(end),
        status: "ARCHIVED",
        createdAt: Timestamp.fromDate(start),
      });

      // CASIS
      await setDoc(doc(db, "candidates/casis-1"), {
        uid: "casis-1",
        nama: "Casis 1",
        nisn: "1234567890",
        status: "DRAFT",
        createdAt: Timestamp.fromDate(start),
        updatedAt: Timestamp.fromDate(start),
      });
    });

    const student1 = env.authenticatedContext("student-1");
    const student2 = env.authenticatedContext("student-2");
    const teacher = env.authenticatedContext("teacher-1");
    const admin = env.authenticatedContext("admin-1");
    const casis = env.authenticatedContext("casis-1");

    // =========================================================
    // USERS
    // =========================================================

    console.log("\n=== USERS ===");

    await test("Student baca profil sendiri", () =>
      assertSucceeds(
        student1.firestore()
          .doc("users/student-1")
          .get()
      )
    );

    await test("Student tidak bisa baca student lain", () =>
      assertFails(
        student1.firestore()
          .doc("users/student-2")
          .get()
      )
    );

    await test("Admin bisa baca student lain", () =>
      assertSucceeds(
        admin.firestore()
          .doc("users/student-2")
          .get()
      )
    );

    await test("Student bisa update profil sendiri", () =>
      assertSucceeds(
        updateDoc(
          doc(student1.firestore(), "users/student-1"),
          { nama: "Student Updated" }
        )
      )
    );

    await test("Student tidak bisa mengubah role", () =>
      assertFails(
        updateDoc(
          doc(student1.firestore(), "users/student-1"),
          { role: "admin" }
        )
      )
    );

    // =========================================================
    // SESSION
    // =========================================================

    console.log("\n=== ATTENDANCE SESSION ===");

    await test("Teacher tidak bisa membuat session", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendanceSessions/session_003"),
          {
            sessionId: "session_003",
            date: today,
            startTime: Timestamp.fromDate(start),
            lateAfter: Timestamp.fromDate(lateAfter),
            endTime: Timestamp.fromDate(end),
            status: "ACTIVE",
            createdAt: Timestamp.fromDate(start),
          }
        )
      )
    );

    await test("Student tidak bisa membuat session", () =>
      assertFails(
        setDoc(
          doc(student1.firestore(), "attendanceSessions/session_004"),
          {
            sessionId: "session_004",
            date: today,
            startTime: Timestamp.fromDate(start),
            lateAfter: Timestamp.fromDate(lateAfter),
            endTime: Timestamp.fromDate(end),
            status: "ACTIVE",
            createdAt: Timestamp.fromDate(start),
          }
        )
      )
    );

    await test("Teacher tidak bisa archive session ACTIVE", () =>
      assertFails(
        updateDoc(
          doc(teacher.firestore(), "attendanceSessions/session_001"),
          { status: "ARCHIVED" }
        )
      )
    );

    await test("Student tidak bisa menghapus session", () =>
      assertFails(
        deleteDoc(
          doc(student1.firestore(), "attendanceSessions/session_002")
        )
      )
    );

    // =========================================================
    // STUDENT QR
    // =========================================================

    console.log("\n=== STUDENT QR ATTENDANCE ===");

    const qrRef = doc(
      student1.firestore(),
      "attendance/student-1_session_001"
    );

    await test("Student bisa QR attendance dirinya", () =>
      assertSucceeds(
        setDoc(qrRef, {
          uid: "student-1",
          tanggal: today,
          status: "HADIR",
          classId: "XI.1",
          method: "qr",
          sessionId: "session_001",
          createdAt: serverTimestamp(),
        })
      )
    );

    await test("Student tidak bisa absen UID orang lain", () =>
      assertFails(
        setDoc(
          doc(student1.firestore(), "attendance/student-2_session_001"),
          {
            uid: "student-2",
            tanggal: today,
            status: "HADIR",
            classId: "XI.2",
            method: "qr",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Student tidak bisa memalsukan classId", () =>
      assertFails(
        setDoc(
          doc(student1.firestore(), "attendance/student-1_session_001"),
          {
            uid: "student-3",
            tanggal: today,
            status: "HADIR",
            classId: "XI.2",
            method: "qr",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Student tidak bisa memakai method manual", () =>
      assertFails(
        setDoc(
          doc(student2.firestore(), "attendance/student-2_session_001"),
          {
            uid: "student-2",
            tanggal: today,
            status: "IZIN",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Student tidak bisa update attendance", () =>
      assertFails(
        updateDoc(qrRef, { status: "IZIN" })
      )
    );

    // =========================================================
    // TEACHER MANUAL
    // =========================================================

    console.log("\n=== TEACHER MANUAL ===");

    await test("Teacher bisa manual attendance kelas sendiri", () =>
      assertSucceeds(
        setDoc(
          doc(teacher.firestore(), "attendance/student-3_session_001"),
          {
            uid: "student-3",
            tanggal: today,
            status: "IZIN",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher tidak bisa manual attendance kelas lain", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/student-2_session_001"),
          {
            uid: "student-2",
            tanggal: today,
            status: "IZIN",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher tidak bisa memberi status HADIR manual", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/student-3_session_001"),
          {
            uid: "student-1",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_001",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    // =========================================================
    // ADMIN MANUAL
    // =========================================================

    console.log("\n=== ADMIN MANUAL ===");

    await test("Admin bisa manual attendance lintas kelas", () =>
      assertSucceeds(
        setDoc(
          doc(admin.firestore(), "attendance/student-2_session_002"),
          {
            uid: "student-2",
            tanggal: today,
            status: "HADIR",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_002",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Admin tidak bisa attendance target bukan student", () =>
      assertFails(
        setDoc(
          doc(admin.firestore(), "attendance/teacher-1_session_002"),
          {
            uid: "teacher-1",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_002",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    // =========================================================
    // CASIS
    // =========================================================

    console.log("\n=== CASIS ===");

    await test("Casis bisa baca data sendiri", () =>
      assertSucceeds(
        casis.firestore()
          .doc("candidates/casis-1")
          .get()
      )
    );

    await test("Casis tidak bisa baca casis lain", () =>
      assertFails(
        casis.firestore()
          .doc("candidates/casis-999")
          .get()
      )
    );

    await test("Casis tidak bisa menghapus data", () =>
      assertFails(
        deleteDoc(
          doc(casis.firestore(), "candidates/casis-1")
        )
      )
    );

    // =========================================================
    // RESULTS
    // =========================================================

    console.log("\n================================");
    console.log(`🔥 RESULT: ${passed} PASS / ${failed} FAIL`);
    console.log("================================");

    if (failed > 0) {
      process.exitCode = 1;
    }

  } finally {
    await env.cleanup();
  }
})();
