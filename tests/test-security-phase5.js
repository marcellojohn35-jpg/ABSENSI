const fs=require("fs");
const path=require("path");
const {initializeTestEnvironment,assertFails,assertSucceeds}=require("@firebase/rules-unit-testing");
const {doc,getDoc,setDoc,updateDoc,deleteDoc,Timestamp}=require("firebase/firestore");

const rules=fs.readFileSync(path.join(__dirname, "../firebase/firestore.rules"),"utf8");
let env,pass=0,fail=0;

async function t(n,f){
  try{await f();console.log("✅ "+n);pass++}
  catch(e){console.log("❌ "+n);console.log(e.message);fail++}
}

(async()=>{
  env=await initializeTestEnvironment({
    projectId:"absensi-phase5",
    firestore:{rules}
  });

  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore(),now=Timestamp.now();

    await setDoc(doc(db,"users/student-1"),{
      uid:"student-1",nama:"Student 1",role:"student",
      classId:"XI.1",email:"student1@test.com"
    });

    await setDoc(doc(db,"users/student-2"),{
      uid:"student-2",nama:"Student 2",role:"student",
      classId:"XI.2",email:"student2@test.com"
    });

    await setDoc(doc(db,"users/teacher-1"),{
      uid:"teacher-1",nama:"Teacher 1",role:"teacher",
      classId:"XI.1",email:"teacher@test.com"
    });

    await setDoc(doc(db,"users/admin-1"),{
      uid:"admin-1",nama:"Admin 1",role:"admin",
      classId:"",email:"admin@test.com"
    });

    await setDoc(doc(db,"attendanceSessions/session_001"),{
      sessionId:"session_001",
      date:"2026-08-19",
      startTime:Timestamp.fromDate(new Date("2026-08-19T07:00:00Z")),
      lateAfter:Timestamp.fromDate(new Date("2026-08-19T07:30:00Z")),
      endTime:Timestamp.fromDate(new Date("2026-08-19T10:00:00Z")),
      status:"ACTIVE",
      createdAt:now
    });
  });

  const s=env.authenticatedContext("student-1");
  const s2=env.authenticatedContext("student-2");
  const teacher=env.authenticatedContext("teacher-1");
  const admin=env.authenticatedContext("admin-1");
  const anon=env.unauthenticatedContext();

  console.log("\n=== PHASE 5: FINAL REGRESSION ===");

  await t("Anon tidak bisa create session",()=>assertFails(
    setDoc(doc(anon.firestore(),"attendanceSessions/session_002"),{
      sessionId:"session_002",date:"2026-08-19",
      startTime:Timestamp.now(),lateAfter:Timestamp.now(),
      endTime:Timestamp.now(),status:"ACTIVE",createdAt:Timestamp.now()
    })
  ));

  await t("Student tidak bisa create session",()=>assertFails(
    setDoc(doc(s.firestore(),"attendanceSessions/session_002"),{
      sessionId:"session_002",date:"2026-08-19",
      startTime:Timestamp.now(),lateAfter:Timestamp.now(),
      endTime:Timestamp.now(),status:"ACTIVE",createdAt:Timestamp.now()
    })
  ));

  await t("Student tidak bisa delete session",()=>assertFails(
    deleteDoc(doc(s.firestore(),"attendanceSessions/session_001"))
  ));

  await t("Student tidak bisa delete user",()=>assertFails(
    deleteDoc(doc(s.firestore(),"users/student-1"))
  ));

  await t("Teacher tidak bisa delete user",()=>assertFails(
    deleteDoc(doc(teacher.firestore(),"users/student-1"))
  ));

  await t("Anon tidak bisa baca user",()=>assertFails(
    getDoc(doc(anon.firestore(),"users/student-1"))
  ));

  await t("Student bisa baca dirinya",()=>assertSucceeds(
    getDoc(doc(s.firestore(),"users/student-1"))
  ));

  await t("Teacher bisa baca user",()=>assertSucceeds(
    getDoc(doc(teacher.firestore(),"users/student-2"))
  ));

  await t("Admin bisa baca user",()=>assertSucceeds(
    getDoc(doc(admin.firestore(),"users/student-2"))
  ));

  await t("Student tidak bisa update role",()=>assertFails(
    updateDoc(doc(s.firestore(),"users/student-1"),{role:"admin"})
  ));

  console.log("\n==============================");
  console.log(`🔥 PHASE 5 RESULT: ${pass} PASS / ${fail} FAIL`);
  console.log("==============================");

  await env.cleanup();
  process.exit(fail?1:0);
})();
