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
} = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "absensi-security-phase3",
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

  const now = Timestamp.now();

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
      });

      await setDoc(doc(db, "users/casis-1"), {
        role: "casis",
        nama: "Casis 1",
        classId: "XI.1",
      });

      await setDoc(doc(db, "attendanceSessions/session_001"), {
        sessionId: "session_001",
        date: "2026-08-19",
        startTime: Timestamp.fromDate(
          new Date(Date.now() - 60 * 60 * 1000)
        ),
        lateAfter: Timestamp.fromDate(
          new Date(Date.now() + 30 * 60 * 1000)
        ),
        endTime: Timestamp.fromDate(
          new Date(Date.now() + 60 * 60 * 1000)
        ),
        status: "ACTIVE",
        createdAt: now,
      });

      await setDoc(doc(db, "attendance/student-1_session_001"), {
        uid: "student-1",
        tanggal: "2026-08-19",
        status: "HADIR",
        classId: "XI.1",
        method: "qr",
        sessionId: "session_001",
        createdAt: now,
      });

      await setDoc(doc(db, "candidates/casis-1"), {
        uid: "casis-1",
        nama: "Casis 1",
        nisn: "1234567890",
        status: "DRAFT",
        createdAt: now,
        updatedAt: now,
      });
    });

    const anon = env.unauthenticatedContext();
    const student1 = env.authenticatedContext("student-1");
    const student2 = env.authenticatedContext("student-2");
    const teacher = env.authenticatedContext("teacher-1");
    const casis = env.authenticatedContext("casis-1");
    const admin = env.authenticatedContext("admin-1");

    // =========================================================
    // UNAUTHENTICATED
    // =========================================================

    console.log("\n=== UNAUTHENTICATED ===");

    await test("Anonymous tidak bisa baca users", () =>
      assertFails(
        anon.firestore()
          .doc("users/student-1")
          .get()
      )
    );

    await test("Anonymous tidak bisa baca attendance", () =>
      assertFails(
        anon.firestore()
          .doc("attendance/student-1_session_001")
          .get()
      )
    );

    await test("Anonymous tidak bisa baca session", () =>
      assertFails(
        anon.firestore()
          .doc("attendanceSessions/session_001")
          .get()
      )
    );

    await test("Anonymous tidak bisa membuat user", () =>
      assertFails(
        setDoc(
          doc(anon.firestore(), "users/hacker"),
          {
            role: "admin",
            nama: "Hacker",
          }
        )
      )
    );

    // =========================================================
    // STUDENT PRIVILEGE ESCALATION
    // =========================================================

    console.log("\n=== STUDENT PRIVILEGE ESCALATION ===");

    await test("Student tidak bisa mengubah role sendiri menjadi admin", () =>
      assertFails(
        updateDoc(
          doc(student1.firestore(), "users/student-1"),
          { role: "admin" }
        )
      )
    );

    await test("Student tidak bisa mengubah role sendiri menjadi teacher", () =>
      assertFails(
        updateDoc(
          doc(student1.firestore(), "users/student-1"),
          { role: "teacher" }
        )
      )
    );

    await test("Student tidak bisa mengubah classId student lain", () =>
      assertFails(
        updateDoc(
          doc(student1.firestore(), "users/student-2"),
          { classId: "XI.1" }
        )
      )
    );

    await test("Student tidak bisa menghapus profil sendiri", () =>
      assertFails(
        deleteDoc(
          doc(student1.firestore(), "users/student-1")
        )
      )
    );

    await test("Student tidak bisa menghapus attendance", () =>
      assertFails(
        deleteDoc(
          doc(student1.firestore(), "attendance/student-1_session_001")
        )
      )
    );

    await test("Student tidak bisa mengubah attendance student lain", () =>
      assertFails(
        updateDoc(
          doc(student1.firestore(), "attendance/student-1_session_001"),
          { status: "IZIN" }
        )
      )
    );

    // =========================================================
    // TEACHER PRIVILEGE ESCALATION
    // =========================================================

    console.log("\n=== TEACHER PRIVILEGE ESCALATION ===");

    await test("Teacher tidak bisa mengubah role student menjadi admin", () =>
      assertFails(
        updateDoc(
          doc(teacher.firestore(), "users/student-1"),
          { role: "admin" }
        )
      )
    );

    await test("Teacher tidak bisa mengubah profil teacher lain", () =>
      assertFails(
        updateDoc(
          doc(teacher.firestore(), "users/student-2"),
          { nama: "Hacked" }
        )
      )
    );

    await test("Teacher tidak bisa menghapus user", () =>
      assertFails(
        deleteDoc(
          doc(teacher.firestore(), "users/student-1")
        )
      )
    );

    await test("Teacher tidak bisa menghapus attendance", () =>
      assertFails(
        deleteDoc(
          doc(teacher.firestore(), "attendance/student-1_session_001")
        )
      )
    );

    // =========================================================
    // CASIS PRIVILEGE ESCALATION
    // =========================================================

    console.log("\n=== CASIS PRIVILEGE ESCALATION ===");

    await test("Casis tidak bisa membuat profile user", () =>
      assertFails(
        setDoc(
          doc(casis.firestore(), "users/casis-1"),
          {
            role: "admin",
            nama: "Escalated",
          }
        )
      )
    );

    await test("Casis tidak bisa membuat attendance", () =>
      assertFails(
        setDoc(
          doc(casis.firestore(), "attendance/casis-1_attack"),
          {
            uid: "casis-1",
            tanggal: "2026-08-19",
            status: "HADIR",
            classId: "XI.1",
            method: "qr",
            sessionId: "session_001",
            createdAt: Timestamp.now(),
          }
        )
      )
    );


    // =========================================================
    // ADMIN BOUNDARY
    // =========================================================

    console.log("\n=== ADMIN BOUNDARY ===");

    await test("Admin tidak bisa menghapus student", () =>
      assertFails(
        deleteDoc(
          doc(admin.firestore(), "users/student-1")
        )
      )
    );

    await test("Admin bisa rollback attendance", () =>
      assertSucceeds(
        deleteDoc(
          doc(admin.firestore(), "attendance/student-1_session_001")
        )
      )
    );

    // =========================================================
    // RESULTS
    // =========================================================

    console.log("\n================================");
    console.log(`🔥 PHASE 3 RESULT: ${passed} PASS / ${failed} FAIL`);
    console.log("================================");

    if (failed > 0) {
      process.exitCode = 1;
    }

  } finally {
    await env.cleanup();
  }
})();
