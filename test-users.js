const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const { doc, getDoc, setDoc, updateDoc } = require("firebase/firestore");

const fs = require("fs");

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "absensi-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });

  try {
    const student = testEnv.authenticatedContext("student-1");
    const otherStudent = testEnv.authenticatedContext("student-2");
    const admin = testEnv.authenticatedContext("admin-1");

    // Seed data menggunakan privileged context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, "users/student-1"), {
        role: "student",
        nama: "Student 1",
      });

      await setDoc(doc(db, "users/student-2"), {
        role: "student",
        nama: "Student 2",
      });

      await setDoc(doc(db, "users/admin-1"), {
        role: "admin",
        nama: "Admin",
      });
    });

    console.log("TEST 1: Student membaca dirinya sendiri");
    await assertSucceeds(
      getDoc(doc(student.firestore(), "users/student-1"))
    );

    console.log("TEST 2: Student membaca student lain");
    await assertFails(
      getDoc(doc(student.firestore(), "users/student-2"))
    );

    console.log("TEST 3: Admin membaca student lain");
    await assertSucceeds(
      getDoc(doc(admin.firestore(), "users/student-2"))
    );

    console.log("TEST 4: Student mengubah datanya sendiri");
    await assertSucceeds(
      updateDoc(doc(student.firestore(), "users/student-1"), {
        nama: "Student Updated",
      })
    );

    console.log("TEST 5: Student mencoba mengubah role");
    await assertFails(
      updateDoc(doc(student.firestore(), "users/student-1"), {
        role: "admin",
      })
    );

    console.log("\n🔥 SEMUA TEST USERS SELESAI!");

  } finally {
    await testEnv.cleanup();
  }
})();
