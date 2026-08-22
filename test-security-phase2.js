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
} = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "absensi-security-phase2",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
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
    // SEED
    // =========================================================

    await env.withSecurityRulesDisabled(async (context) => {
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
      await setDoc(doc(db, "attendanceSessions/session_active"), {
        sessionId: "session_active",
        date: today,
        startTime: Timestamp.fromDate(start),
        lateAfter: Timestamp.fromDate(lateAfter),
        endTime: Timestamp.fromDate(end),
        status: "ACTIVE",
        createdAt: Timestamp.fromDate(start),
      });

      // ARCHIVED SESSION
      await setDoc(doc(db, "attendanceSessions/session_archived"), {
        sessionId: "session_archived",
        date: today,
        startTime: Timestamp.fromDate(start),
        lateAfter: Timestamp.fromDate(lateAfter),
        endTime: Timestamp.fromDate(end),
        status: "ARCHIVED",
        createdAt: Timestamp.fromDate(start),
      });

      // Existing attendance
      await setDoc(doc(db, "attendance/student-1_existing"), {
        uid: "student-1",
        tanggal: today,
        status: "IZIN",
        classId: "XI.1",
        method: "manual",
        sessionId: "session_active",
        createdAt: Timestamp.fromDate(start),
      });

      // Existing candidate
      await setDoc(doc(db, "candidates/casis-1"), {
        uid: "casis-1",
        nama: "Casis 1",
        nisn: "1234567890",
        status: "DRAFT",
        createdAt: Timestamp.fromDate(start),
        updatedAt: Timestamp.fromDate(start),
      });
    });

    const student = env.authenticatedContext("student-1");
    const student2 = env.authenticatedContext("student-2");
    const teacher = env.authenticatedContext("teacher-1");
    const admin = env.authenticatedContext("admin-1");
    const casis = env.authenticatedContext("casis-1");

    // =========================================================
    // 1. DUPLICATE ATTENDANCE
    // =========================================================

    console.log("\n=== DUPLICATE ATTENDANCE ===");

    await test("Student tidak bisa membuat attendance dengan docId yang sudah ada", () =>
      assertFails(
        setDoc(
          doc(student.firestore(), "attendance/student-1_existing"),
          {
            uid: "student-1",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_active",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    // =========================================================
    // 2. SESSION MANIPULATION
    // =========================================================

    console.log("\n=== SESSION MANIPULATION ===");

    await test("Student tidak bisa memakai sessionId palsu", () =>
      assertFails(
        setDoc(
          doc(student.firestore(), "attendance/student-1_fake_session"),
          {
            uid: "student-1",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_fake",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    await test("Student tidak bisa memakai tanggal berbeda dari session", () =>
      assertFails(
        setDoc(
          doc(student.firestore(), "attendance/student-1_wrong_date"),
          {
            uid: "student-1",
            tanggal: "2026-08-20",
            status: "HADIR",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_active",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    await test("Student tidak bisa absen pada session ARCHIVED", () =>
      assertFails(
        setDoc(
          doc(student2.firestore(), "attendance/student-2_archived"),
          {
            uid: "student-2",
            tanggal: today,
            status: "HADIR",
            classId: "XI.2",
            method: "qr",
            sessionId: "session_archived",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    // =========================================================
    // 3. ATTENDANCE FIELD MANIPULATION
    // =========================================================

    console.log("\n=== ATTENDANCE FIELD MANIPULATION ===");

    await test("Student tidak bisa memalsukan createdAt", () =>
      assertFails(
        setDoc(
          doc(student.firestore(), "attendance/student-1_fake_created"),
          {
            uid: "student-1",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_active",
            createdAt: Timestamp.fromDate(start),
          }
        )
      )
    );

    await test("Student tidak bisa memakai status palsu", () =>
      assertFails(
        setDoc(
          doc(student.firestore(), "attendance/student-1_fake_status"),
          {
            uid: "student-1",
            tanggal: today,
            status: "ALFA",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_active",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    // =========================================================
    // 4. TEACHER CORRECTION
    // =========================================================

    console.log("\n=== TEACHER CORRECTION ===");

    await test("Teacher bisa koreksi status siswa di kelas sendiri", () =>
      assertSucceeds(
        updateDoc(
          doc(teacher.firestore(), "attendance/student-1_existing"),
          {
            status: "SAKIT",
          }
        )
      )
    );

    await test("Teacher tidak bisa mengubah classId attendance", () =>
      assertFails(
        updateDoc(
          doc(teacher.firestore(), "attendance/student-1_existing"),
          {
            classId: "XI.2",
          }
        )
      )
    );

    await test("Teacher tidak bisa mengubah uid attendance", () =>
      assertFails(
        updateDoc(
          doc(teacher.firestore(), "attendance/student-1_existing"),
          {
            uid: "student-2",
          }
        )
      )
    );

    // =========================================================
    // 5. ADMIN CORRECTION
    // =========================================================

    console.log("\n=== ADMIN CORRECTION ===");

    await test("Admin bisa koreksi status attendance", () =>
      assertSucceeds(
        updateDoc(
          doc(admin.firestore(), "attendance/student-1_existing"),
          {
            status: "HADIR",
          }
        )
      )
    );

    await test("Admin tidak bisa mengubah uid attendance", () =>
      assertFails(
        updateDoc(
          doc(admin.firestore(), "attendance/student-1_existing"),
          {
            uid: "student-2",
          }
        )
      )
    );

    await test("Admin tidak bisa mengubah sessionId", () =>
      assertFails(
        updateDoc(
          doc(admin.firestore(), "attendance/student-1_existing"),
          {
            sessionId: "session_archived",
          }
        )
      )
    );

    // =========================================================
    // 6. CASIS MANIPULATION
    // =========================================================

    console.log("\n=== CASIS MANIPULATION ===");

    await test("Casis tidak bisa mengubah status", () =>
      assertFails(
        updateDoc(
          doc(casis.firestore(), "candidates/casis-1"),
          {
            status: "APPROVED",
          }
        )
      )
    );

    await test("Casis tidak bisa mengubah uid", () =>
      assertFails(
        updateDoc(
          doc(casis.firestore(), "candidates/casis-1"),
          {
            uid: "casis-999",
          }
        )
      )
    );

    await test("Casis tidak bisa mengubah createdAt", () =>
      assertFails(
        updateDoc(
          doc(casis.firestore(), "candidates/casis-1"),
          {
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    // =========================================================
    // 7. SESSION VALIDATION
    // =========================================================

    console.log("\n=== SESSION VALIDATION ===");

    await test("Teacher tidak bisa membuat session dengan waktu terbalik", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendanceSessions/session_bad_time"),
          {
            sessionId: "session_bad_time",
            date: today,
            startTime: Timestamp.fromDate(end),
            lateAfter: Timestamp.fromDate(lateAfter),
            endTime: Timestamp.fromDate(start),
            status: "ACTIVE",
            createdAt: Timestamp.now(),
          }
        )
      )
    );

    await test("Teacher tidak bisa membuat session tanpa field wajib", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendanceSessions/session_missing"),
          {
            sessionId: "session_missing",
            date: today,
            status: "ACTIVE",
          }
        )
      )
    );

    // =========================================================
    // RESULT
    // =========================================================

    console.log("\n================================");
    console.log(`🔥 PHASE 2 RESULT: ${passed} PASS / ${failed} FAIL`);
    console.log("================================");

    if (failed > 0) {
      process.exitCode = 1;
    }

  } finally {
    await env.cleanup();
  }
})();
