// db/init.sql로 스키마를 만든 뒤 이 스크립트로 더미 데이터를 넣는다.
// 비밀번호 해시(bcrypt), 주민번호 암호화(AES)는 SQL이 아닌 여기서 수행해야
// 실제 서비스 코드(auth.js)와 동일한 방식으로 저장된 데이터가 만들어진다.
// 실행: node seed.js  (was/ 폴더에서)
const bcrypt = require("bcrypt");
const pool = require("./db");
const { encryptRrn } = require("./crypto-utils");

const DUMMY_PATIENTS = [
  { username: "patient1", password: "pass1234", name: "김환자", rrn: "990101-1234567", role: "patient" },
  { username: "patient2", password: "pw5678", name: "이몽룡", rrn: "850520-2345678", role: "patient" },
  { username: "patient3", password: "qwerty1", name: "성춘향", rrn: "920315-2456789", role: "patient" },
  // 원무/접수: 예약 관리, 문의 답변, 환자 등록, 진료기록 마스킹 열람
  { username: "staff1", password: "staff1234", name: "박원무", rrn: "880101-1111111", role: "staff" },
  // 문서 스캔(OCR) 기능은 이 계정(role='admin')만 사용 가능
  { username: "admin", password: "admin_test_123!", name: "관리자", rrn: "000000-1000000", role: "admin" },
];

const DUMMY_POSTS = [
  { patientIndex: 0, title: "어제부터 열이 나고 기침이 심해요", content: "체온은 38.2도이고 목도 아픕니다. 언제 방문하면 될까요?" },
  { patientIndex: 1, title: "허리 디스크 재발한 것 같습니다", content: "예전에 수술받은 부위가 다시 저리고 아픕니다. MRI 재검사가 필요할까요?" },
  { patientIndex: 2, title: "우울증 약 복용 중 부작용 문의", content: "처방받은 약을 먹은 뒤로 어지럼증이 심합니다. 용량을 줄여도 될까요?" },
];

async function seed() {
  const patientIds = [];

  for (const p of DUMMY_PATIENTS) {
    const hashedPassword = await bcrypt.hash(p.password, 12);
    const encryptedRrn = encryptRrn(p.rrn);
    const [result] = await pool.query(
      "INSERT INTO patients (username, password, name, rrn, role) VALUES (?, ?, ?, ?, ?)",
      [p.username, hashedPassword, p.name, encryptedRrn, p.role]
    );
    patientIds.push(result.insertId);
    console.log(`patient 생성: ${p.username} (id=${result.insertId})`);
  }

  for (const post of DUMMY_POSTS) {
    await pool.query(
      "INSERT INTO board_posts (patient_id, title, content) VALUES (?, ?, ?)",
      [patientIds[post.patientIndex], post.title, post.content]
    );
  }
  console.log("board_posts 더미 데이터 삽입 완료");

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
