const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  Timestamp,
  serverTimestamp,
} = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "absensi-manual-test",
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

  const today = "2026-08-22";

  try {
    // =========================================================
    // SEED
    // =========================================================

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // STUDENTS
      await setDoc(doc(db, "users/student-1"), {
        role: "student",
        nama: "Student 1",
        classId: "XI.1",
      });

      await setDoc(doc(db, "users/student-2"), {
        role: "student",
        nama: "Student 2",
        classId: "XI.1",
      });

      await setDoc(doc(db, "users/student-3"), {
        role: "student",
        nama: "Student 3",
        classId: "XI.2",
      });

      // TEACHER XI.1
      await setDoc(doc(db, "users/teacher-1"), {
        role: "teacher",
        nama: "Teacher 1",
        classId: "XI.1",
      });

      // ADMIN
      await setDoc(doc(db, "users/admin-1"), {
        role: "admin",
        nama: "Admin 1",
        classId: "",
      });

      // ACTIVE SESSION
      await setDoc(doc(db, "attendanceSessions/session_manual"), {
        sessionId: "session_manual",
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

      // EXISTING ATTENDANCE
      await setDoc(doc(db, "attendance/student-1_session_manual"), {
        uid: "student-1",
        tanggal: today,
        status: "IZIN",
        classId: "XI.1",
        method: "manual",
        sessionId: "session_manual",
        createdAt: Timestamp.fromDate(start),
      });
    });

    const teacher = env.authenticatedContext("teacher-1");
    const admin = env.authenticatedContext("admin-1");

    // =========================================================
    // 1. TEACHER CREATE
    // =========================================================

    console.log("\n=== TEACHER MANUAL CREATE ===");

    await test("Teacher bisa create IZIN siswa kelas sendiri", () =>
      assertSucceeds(
        setDoc(
          doc(teacher.firestore(), "attendance/student-2_session_manual"),
          {
            uid: "student-2",
            tanggal: today,
            status: "IZIN",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher bisa create SAKIT siswa kelas sendiri", () =>
      assertSucceeds(
        setDoc(
          doc(teacher.firestore(), "attendance/student-2_sakit"),
          {
            uid: "student-2",
            tanggal: today,
            status: "SAKIT",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher bisa create ALFA siswa kelas sendiri", () =>
      assertSucceeds(
        setDoc(
          doc(teacher.firestore(), "attendance/student-2_alfa"),
          {
            uid: "student-2",
            tanggal: today,
            status: "ALFA",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    // =========================================================
    // 2. TEACHER BOUNDARY
    // =========================================================

    console.log("\n=== TEACHER BOUNDARY ===");

    await test("Teacher tidak bisa create HADIR", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/teacher_bad_hadir"),
          {
            uid: "student-2",
            tanggal: today,
            status: "HADIR",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher tidak bisa create TERLAMBAT", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/teacher_bad_telat"),
          {
            uid: "student-2",
            tanggal: today,
            status: "TERLAMBAT",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher tidak bisa create student kelas lain", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/student-3_wrong_class"),
          {
            uid: "student-3",
            tanggal: today,
            status: "IZIN",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    await test("Teacher tidak bisa memalsukan classId target", () =>
      assertFails(
        setDoc(
          doc(teacher.firestore(), "attendance/student-2_fake_class"),
          {
            uid: "student-2",
            tanggal: today,
            status: "IZIN",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    // =========================================================
    // 3. TEACHER UPDATE
    // =========================================================

    console.log("\n=== TEACHER MANUAL UPDATE ===");

    await test("Teacher bisa update status existing", () =>
      assertSucceeds(
        updateDoc(
          doc(teacher.firestore(), "attendance/student-1_session_manual"),
          {
            status: "SAKIT",
          }
        )
      )
    );

    // =========================================================
    // 4. ADMIN CREATE
    // =========================================================

    console.log("\n=== ADMIN MANUAL CREATE ===");

    const adminStatuses = [
      ["HADIR", "student-3_admin_hadir"],
      ["TERLAMBAT", "student-3_admin_terlambat"],
      ["IZIN", "student-3_admin_izin"],
      ["SAKIT", "student-3_admin_sakit"],
      ["ALFA", "student-3_admin_alfa"],
    ];

    for (const [status, id] of adminStatuses) {
      await test(`Admin bisa create ${status} kelas mana pun`, () =>
        assertSucceeds(
          setDoc(
            doc(admin.firestore(), `attendance/${id}`),
            {
              uid: "student-3",
              tanggal: today,
              status,
              classId: "XI.2",
              method: "manual",
              sessionId: "session_manual",
              createdAt: serverTimestamp(),
            }
          )
        )
      );
    }

    // =========================================================
    // 5. ADMIN UPDATE
    // =========================================================

    console.log("\n=== ADMIN UPDATE ===");

    await test("Admin bisa koreksi existing menjadi HADIR", () =>
      assertSucceeds(
        updateDoc(
          doc(admin.firestore(), "attendance/student-1_session_manual"),
          {
            status: "HADIR",
          }
        )
      )
    );

    await test("Admin bisa koreksi existing menjadi TERLAMBAT", () =>
      assertSucceeds(
        updateDoc(
          doc(admin.firestore(), "attendance/student-1_session_manual"),
          {
            status: "TERLAMBAT",
          }
        )
      )
    );

    // =========================================================
    // 6. ADMIN ARCHIVED SESSION
    // =========================================================

    console.log("\n=== ADMIN ARCHIVED SESSION ===");

    await test("Admin bisa manual attendance pada session ARCHIVED", () =>
      assertSucceeds(
        setDoc(
          doc(admin.firestore(), "attendance/student-3_archived"),
          {
            uid: "student-3",
            tanggal: today,
            status: "IZIN",
            classId: "XI.2",
            method: "manual",
            sessionId: "session_archived",
            createdAt: serverTimestamp(),
          }
        )
      )
    );

    // =========================================================
    // 7. BATCH MULTI CREATE
    // =========================================================

    console.log("\n=== BATCH MULTI CREATE ===");

    await test("Teacher bisa batch create beberapa siswa sekaligus", async () => {
      const batch = writeBatch(teacher.firestore());

      for (const uid of ["student-1", "student-2"]) {
        batch.set(
          doc(teacher.firestore(), `attendance/${uid}_batch_create`),
          {
            uid,
            tanggal: today,
            status: "IZIN",
            classId: "XI.1",
            method: "manual",
            sessionId: "session_manual",
            createdAt: serverTimestamp(),
          }
        );
      }

      await batch.commit();
    });

    // =========================================================
    // 8. BATCH MULTI UPDATE
    // =========================================================

    console.log("\n=== BATCH MULTI UPDATE ===");

    await test("Admin bisa batch update beberapa attendance", async () => {
      const batch = writeBatch(admin.firestore());

      batch.update(
        doc(admin.firestore(), "attendance/student-1_session_manual"),
        { status: "IZIN" }
      );

      batch.update(
        doc(admin.firestore(), "attendance/student-2_session_manual"),
        { status: "SAKIT" }
      );

      await batch.commit();
    });

    // =========================================================
    // 9. ATOMIC BATCH FAILURE
    // =========================================================

    console.log("\n=== ATOMIC BATCH FAILURE ===");

    await test(
      "Batch campuran valid + invalid gagal seluruhnya",
      async () => {
        const validRef = doc(
          teacher.firestore(),
          "attendance/student-1_atomic"
        );

        const invalidRef = doc(
          teacher.firestore(),
          "attendance/student-3_atomic"
        );

        const batch = writeBatch(teacher.firestore());

        batch.set(validRef, {
          uid: "student-1",
          tanggal: today,
          status: "IZIN",
          classId: "XI.1",
          method: "manual",
          sessionId: "session_manual",
          createdAt: serverTimestamp(),
        });

        // Student-3 adalah XI.2 -> teacher XI.1 tidak boleh
        batch.set(invalidRef, {
          uid: "student-3",
          tanggal: today,
          status: "IZIN",
          classId: "XI.2",
          method: "manual",
          sessionId: "session_manual",
          createdAt: serverTimestamp(),
        });

        await assertFails(batch.commit());

        const checkValid = await getDoc(validRef);
        const checkInvalid = await getDoc(invalidRef);

        if (checkValid.exists()) {
          throw new Error(
            "ATOMICITY GAGAL: write valid ikut tersimpan"
          );
        }

        if (checkInvalid.exists()) {
          throw new Error(
            "Write invalid ternyata tersimpan"
          );
        }
      }
    );

    // =========================================================
    // RESULT
    // =========================================================

    console.log("\n==============================");
    console.log(`🔥 MANUAL ATTENDANCE RESULT: ${passed} PASS / ${failed} FAIL`);
    console.log("==============================");

    if (failed > 0) {
      process.exitCode = 1;
    }

  } finally {
    await env.cleanup();
  }
})();
