const fs = require("fs");
const path = require("path");

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");

const {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} = require("firebase/firestore");

const rules = fs.readFileSync(
  path.join(__dirname, "../firebase/firestore.rules"),
  "utf8"
);

let passed = 0;
let failed = 0;

async function control(name, expectation, operation) {
  try {
    if (expectation === "allow") {
      await assertSucceeds(operation());
    } else {
      await assertFails(operation());
    }

    console.log(`✅ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`🚨 CONTROL FAILED: ${name}`);
    console.log(`   Expected: ${expectation.toUpperCase()}`);
    console.log(`   ${error.message}`);
    failed += 1;
  }
}

function attendancePayload({
  uid,
  classId,
  sessionId = "session_active",
  tanggal = "2026-08-30",
  status = "HADIR",
  method = "qr",
  extra = {},
}) {
  return {
    uid,
    tanggal,
    status,
    classId,
    method,
    sessionId,
    createdAt: serverTimestamp(),
    ...extra,
  };
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "absensi-full-security-audit",
    firestore: { rules },
  });

  const now = Date.now();
  const activeStart = Timestamp.fromMillis(now - 60 * 60 * 1000);
  const activeLate = Timestamp.fromMillis(now + 30 * 60 * 1000);
  const activeEnd = Timestamp.fromMillis(now + 60 * 60 * 1000);
  const futureStart = Timestamp.fromMillis(now + 60 * 60 * 1000);
  const futureLate = Timestamp.fromMillis(now + 90 * 60 * 1000);
  const futureEnd = Timestamp.fromMillis(now + 120 * 60 * 1000);
  const expiredStart = Timestamp.fromMillis(now - 120 * 60 * 1000);
  const expiredLate = Timestamp.fromMillis(now - 90 * 60 * 1000);
  const expiredEnd = Timestamp.fromMillis(now - 60 * 60 * 1000);

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      const users = [
        ["student-active", "student", "ACTIVE", "x.1"],
        ["student-other", "student", "ACTIVE", "x.2"],
        ["student-inactive", "student", "INACTIVE", "x.1"],
        ["student-deleted", "student", "DELETED", "x.1"],
        ["student-direct", "student", "ACTIVE", "x.1"],
        ["teacher-active", "teacher", "ACTIVE", "x.1"],
        ["teacher-inactive", "teacher", "INACTIVE", "x.1"],
        ["admin-active", "admin", "ACTIVE", "-"],
        ["admin-inactive", "admin", "INACTIVE", "-"],
        ["casis-active", "casis", "ACTIVE", "x.1"],
        ["casis-extra", "casis", "ACTIVE", "x.1"],
      ];

      for (const [uid, role, accountStatus, classId] of users) {
        await setDoc(doc(db, `users/${uid}`), {
          uid,
          role,
          accountStatus,
          classId,
          nama: uid,
          email: `${uid}@example.test`,
        });
      }

      for (let index = 1; index <= 10; index += 1) {
        const uid = `batch-student-${index}`;
        await setDoc(doc(db, `users/${uid}`), {
          uid,
          role: "student",
          accountStatus: "ACTIVE",
          classId: "x.1",
          nama: uid,
          email: `${uid}@example.test`,
        });
      }

      await setDoc(doc(db, "attendanceSessions/session_active"), {
        sessionId: "session_active",
        date: "2026-08-30",
        startTime: activeStart,
        lateAfter: activeLate,
        endTime: activeEnd,
        status: "ACTIVE",
        createdAt: activeStart,
      });

      await setDoc(doc(db, "attendanceSessions/session_archived"), {
        sessionId: "session_archived",
        date: "2026-08-29",
        startTime: expiredStart,
        lateAfter: expiredLate,
        endTime: expiredEnd,
        status: "ARCHIVED",
        createdAt: expiredStart,
      });

      await setDoc(doc(db, "attendanceSessions/session_future"), {
        sessionId: "session_future",
        date: "2026-08-31",
        startTime: futureStart,
        lateAfter: futureLate,
        endTime: futureEnd,
        status: "ACTIVE",
        createdAt: activeStart,
      });

      await setDoc(doc(db, "attendanceSessions/session_expired"), {
        sessionId: "session_expired",
        date: "2026-08-30",
        startTime: expiredStart,
        lateAfter: expiredLate,
        endTime: expiredEnd,
        status: "ACTIVE",
        createdAt: expiredStart,
      });

      await setDoc(doc(db, "settings/sessionCounter"), {
        lastNumber: 7,
        activeSessionId: "session_active",
      });

      await setDoc(doc(db, "attendance/student-active_session_active"), {
        uid: "student-active",
        tanggal: "2026-08-30",
        status: "HADIR",
        classId: "x.1",
        method: "qr",
        sessionId: "session_active",
        createdAt: activeStart,
      });

      await setDoc(doc(db, "attendance/student-deleted_session_archived"), {
        uid: "student-deleted",
        tanggal: "2026-08-29",
        status: "HADIR",
        classId: "x.1",
        method: "qr",
        sessionId: "session_archived",
        createdAt: expiredStart,
      });
    });

    const anon = env.unauthenticatedContext();
    const newCasis = env.authenticatedContext("new-casis");
    const malformedCasis = env.authenticatedContext("malformed-casis");
    const activeStudent = env.authenticatedContext("student-active");
    const otherStudent = env.authenticatedContext("student-other");
    const inactiveStudent = env.authenticatedContext("student-inactive");
    const directStudent = env.authenticatedContext("student-direct");
    const activeTeacher = env.authenticatedContext("teacher-active");
    const inactiveTeacher = env.authenticatedContext("teacher-inactive");
    const activeAdmin = env.authenticatedContext("admin-active");
    const inactiveAdmin = env.authenticatedContext("admin-inactive");
    const activeCasis = env.authenticatedContext("casis-active");
    const extraCasis = env.authenticatedContext("casis-extra");
    const unknownAuth = env.authenticatedContext("unknown-google-user");

    console.log("\n=== BASE AUTHORIZATION ===");

    await control("Anonymous cannot read users", "deny", () =>
      getDoc(doc(anon.firestore(), "users/student-active"))
    );

    await control("Student can read only their own profile", "allow", () =>
      getDoc(doc(activeStudent.firestore(), "users/student-active"))
    );

    await control("Student cannot read another profile", "deny", () =>
      getDoc(doc(activeStudent.firestore(), "users/student-other"))
    );

    await control("Unapproved Google account cannot read session schedule", "deny", () =>
      getDoc(doc(unknownAuth.firestore(), "attendanceSessions/session_active"))
    );

    console.log("\n=== USER PROFILE SCHEMA / REVOCATION ===");

    await control("New user can create a valid CASIS profile", "allow", () =>
      setDoc(doc(newCasis.firestore(), "users/new-casis"), {
        uid: "new-casis",
        nama: "New Casis",
        email: "new-casis@example.test",
        classId: "x.1",
        role: "casis",
        accountStatus: "ACTIVE",
        updatedAt: serverTimestamp(),
      })
    );

    await control("New user cannot self-create as admin", "deny", () =>
      setDoc(doc(malformedCasis.firestore(), "users/malformed-casis"), {
        role: "admin",
      })
    );

    await control("CASIS create requires a complete typed schema", "deny", () =>
      setDoc(doc(malformedCasis.firestore(), "users/malformed-casis"), {
        role: "casis",
      })
    );

    await control("Student cannot replace name with an object", "deny", () =>
      updateDoc(doc(activeStudent.firestore(), "users/student-active"), {
        nama: { breaksDashboard: true },
      })
    );

    await control("Student cannot mutate official NIS", "deny", () =>
      updateDoc(doc(otherStudent.firestore(), "users/student-other"), {
        nis: "FAKE-NIS",
      })
    );

    await control("Inactive student cannot keep changing profile data", "deny", () =>
      updateDoc(doc(inactiveStudent.firestore(), "users/student-inactive"), {
        nama: "Still writing",
      })
    );

    await control("Inactive teacher cannot read all student data", "deny", () =>
      getDocs(collection(inactiveTeacher.firestore(), "users"))
    );

    await control("Inactive admin cannot change another user's role", "deny", () =>
      updateDoc(doc(inactiveAdmin.firestore(), "users/student-other"), {
        role: "teacher",
      })
    );

    console.log("\n=== CANDIDATE SCHEMA ===");

    await control("CASIS candidate cannot add arbitrary authorization fields", "deny", () =>
      setDoc(doc(extraCasis.firestore(), "candidates/casis-extra"), {
        uid: "casis-extra",
        nama: "Extra Casis",
        nisn: "1234567890",
        status: "DRAFT",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        requestedRole: "admin",
      })
    );

    await control("CASIS candidate creation validates field types", "deny", () =>
      setDoc(doc(activeCasis.firestore(), "candidates/casis-active"), {
        uid: "casis-active",
        nama: { not: "a string" },
        nisn: 123,
        status: "DRAFT",
        createdAt: "yesterday",
        updatedAt: false,
      })
    );

    console.log("\n=== SESSION / COUNTER INTEGRITY ===");

    await control("Teacher cannot create attendance session", "deny", () =>
      setDoc(doc(activeTeacher.firestore(), "attendanceSessions/teacher-session"), {
        sessionId: "teacher-session",
        date: "2026-08-30",
        startTime: activeStart,
        lateAfter: activeLate,
        endTime: activeEnd,
        status: "ACTIVE",
        createdAt: serverTimestamp(),
      })
    );

    await control("Inactive admin cannot create attendance session", "deny", () =>
      setDoc(doc(inactiveAdmin.firestore(), "attendanceSessions/inactive-admin-session"), {
        sessionId: "inactive-admin-session",
        date: "2026-08-30",
        startTime: activeStart,
        lateAfter: activeLate,
        endTime: activeEnd,
        status: "ACTIVE",
        createdAt: serverTimestamp(),
      })
    );

    await control("Admin cannot create a second standalone ACTIVE session", "deny", () =>
      setDoc(doc(activeAdmin.firestore(), "attendanceSessions/second-active"), {
        sessionId: "second-active",
        date: "not-a-date",
        startTime: activeStart,
        lateAfter: activeLate,
        endTime: activeEnd,
        status: "ACTIVE",
        createdAt: serverTimestamp(),
      })
    );

    await control("Session counter cannot move backwards or point to missing session", "deny", () =>
      updateDoc(doc(activeAdmin.firestore(), "settings/sessionCounter"), {
        lastNumber: 1,
        activeSessionId: "missing-session",
      })
    );

    console.log("\n=== ATTENDANCE WRITE BOUNDARIES ===");

    await control("Inactive student cannot create attendance", "deny", () =>
      setDoc(
        doc(inactiveStudent.firestore(), "attendance/student-inactive_session_active"),
        attendancePayload({ uid: "student-inactive", classId: "x.1" })
      )
    );

    await control("Student cannot attend before session starts", "deny", () =>
      setDoc(
        doc(otherStudent.firestore(), "attendance/student-other_session_future"),
        attendancePayload({
          uid: "student-other",
          classId: "x.2",
          sessionId: "session_future",
          tanggal: "2026-08-31",
        })
      )
    );

    await control("Student cannot attend after session closes", "deny", () =>
      setDoc(
        doc(otherStudent.firestore(), "attendance/student-other_session_expired"),
        attendancePayload({
          uid: "student-other",
          classId: "x.2",
          sessionId: "session_expired",
        })
      )
    );

    await control("Attendance cannot contain extra unvalidated fields", "deny", () =>
      setDoc(
        doc(otherStudent.firestore(), "attendance/student-other_session_active"),
        attendancePayload({
          uid: "student-other",
          classId: "x.2",
          extra: { injected: true },
        })
      )
    );

    await control("Direct client write without server-issued location proof is denied", "deny", () =>
      setDoc(
        doc(directStudent.firestore(), "attendance/student-direct_session_active"),
        attendancePayload({ uid: "student-direct", classId: "x.1" })
      )
    );

    await control("Inactive teacher cannot correct attendance", "deny", () =>
      updateDoc(
        doc(inactiveTeacher.firestore(), "attendance/student-active_session_active"),
        { status: "IZIN" }
      )
    );

    await control("Inactive admin cannot delete attendance", "deny", () =>
      deleteDoc(
        doc(inactiveAdmin.firestore(), "attendance/student-active_session_active")
      )
    );

    await control("Admin can correct history for a now-deleted student", "allow", () =>
      updateDoc(
        doc(activeAdmin.firestore(), "attendance/student-deleted_session_archived"),
        { status: "IZIN" }
      )
    );

    console.log("\n=== MULTI-STUDENT BATCH ===");

    await control("Teacher multi-select can atomically write 10 students", "allow", () => {
      const batch = writeBatch(activeTeacher.firestore());

      for (let index = 1; index <= 10; index += 1) {
        const uid = `batch-student-${index}`;
        batch.set(
          doc(activeTeacher.firestore(), `attendance/${uid}_session_active`),
          attendancePayload({
            uid,
            classId: "x.1",
            status: "IZIN",
            method: "manual",
          })
        );
      }

      return batch.commit();
    });

    console.log("\n========================================");
    console.log(`SECURITY AUDIT CONTROLS: ${passed} PASS / ${failed} FAILED`);
    console.log("========================================");

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await env.cleanup();
  }
})();
