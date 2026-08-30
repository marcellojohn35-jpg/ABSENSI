const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, Timestamp } = require("firebase/firestore");

const rules = fs.readFileSync(path.join(__dirname, "../firebase/firestore.rules"), "utf8");

let env;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(e.message);
    failed++;
  }
}

(async () => {
  env = await initializeTestEnvironment({
    projectId: "absensi-phase4",
    firestore: { rules }
  });

  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.now();

    await setDoc(doc(db, "users/student-1"), {
      uid: "student-1",
      nama: "Student 1",
      role: "student",
      classId: "XI.1",
      email: "student1@test.com"
    });

    await setDoc(doc(db, "users/student-2"), {
      uid: "student-2",
      nama: "Student 2",
      role: "student",
      classId: "XI.2",
      email: "student2@test.com"
    });

    await setDoc(doc(db, "users/teacher-1"), {
      uid: "teacher-1",
      nama: "Teacher 1",
      role: "teacher",
      classId: "XI.1",
      email: "teacher@test.com"
    });

    await setDoc(doc(db, "users/admin-1"), {
      uid: "admin-1",
      nama: "Admin 1",
      role: "admin",
      classId: "",
      email: "admin@test.com"
    });

    await setDoc(doc(db, "attendanceSessions/session_001"), {
      date: "2026-08-19",
      startTime: "07:00",
      lateAfter: "07:30",
      endTime: "10:00",
      status: "ACTIVE",
      createdAt: now
    });

    await setDoc(doc(db, "attendance/student-2_session_001"), {
      uid: "student-1",
      tanggal: "2026-08-19",
      status: "HADIR",
      classId: "XI.1",
      method: "qr",
      sessionId: "session_001",
      createdAt: now
    });
    await setDoc(doc(db, "attendance/student-2_session_001"), {
      uid: "student-2",
      tanggal: "2026-08-19",
      status: "HADIR",
      classId: "XI.2",
      method: "qr",
      sessionId: "session_001",
      createdAt: now
    });
  });

  const student = env.authenticatedContext("student-1");
  const student2 = env.authenticatedContext("student-2");
  const teacher = env.authenticatedContext("teacher-1");
  const admin = env.authenticatedContext("admin-1");
  const anon = env.unauthenticatedContext();

  console.log("\n=== PHASE 4: DATA INTEGRITY / BOUNDARY ===");

  await test("Anonymous tidak bisa update session", () =>
    assertFails(
      updateDoc(
        doc(anon.firestore(), "attendanceSessions/session_001"),
        { status: "ARCHIVED" }
      )
    )
  );

  await test("Student tidak bisa archive session", () =>
    assertFails(
      updateDoc(
        doc(student.firestore(), "attendanceSessions/session_001"),
        { status: "ARCHIVED" }
      )
    )
  );

  await test("Student tidak bisa mengubah session", () =>
    assertFails(
      updateDoc(
        doc(student.firestore(), "attendanceSessions/session_001"),
        { startTime: "00:00" }
      )
    )
  );

  await test("Student tidak bisa menghapus session", () =>
    assertFails(
      deleteDoc(
        doc(student.firestore(), "attendanceSessions/session_001")
      )
    )
  );

  await test("Student tidak bisa mengubah identitas attendance sendiri", () =>
    assertFails(
      updateDoc(
        doc(student.firestore(), "attendance/student-2_session_001"),
        { uid: "student-2" }
      )
    )
  );

  await test("Student tidak bisa mengubah classId attendance sendiri", () =>
    assertFails(
      updateDoc(
        doc(student.firestore(), "attendance/student-2_session_001"),
        { classId: "XI.2" }
      )
    )
  );

  await test("Student tidak bisa mengubah sessionId attendance sendiri", () =>
    assertFails(
      updateDoc(
        doc(student.firestore(), "attendance/student-2_session_001"),
        { sessionId: "session_fake" }
      )
    )
  );

  await test("Student tidak bisa menghapus attendance sendiri", () =>
    assertFails(
      deleteDoc(
        doc(student.firestore(), "attendance/student-2_session_001")
      )
    )
  );

  await test("Student lain tidak bisa mengubah attendance", () =>
    assertFails(
      updateDoc(
        doc(student2.firestore(), "attendance/student-2_session_001"),
        { status: "IZIN" }
      )
    )
  );

  await test("Teacher tidak bisa mengubah attendance student lain di luar kelas", () =>
    assertFails(
      updateDoc(
        doc(teacher.firestore(), "attendance/student-2_session_001"),
        { status: "IZIN" }
      )
    )
  );

  await test("Admin bisa membaca user", () =>
    assertSucceeds(
      getDoc(doc(admin.firestore(), "users/student-1"))
    )
  );

  console.log("\n================================");
  console.log(`🔥 PHASE 4 RESULT: ${passed} PASS / ${failed} FAIL`);
  console.log("================================");

  await env.cleanup();

  process.exit(failed > 0 ? 1 : 0);
})();
