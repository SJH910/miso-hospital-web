const express = require("express");
const pool = require("../db");
const config = require("../config");
const { encryptText, decryptText, maskPii } = require("../crypto-utils");
const { verifyCsrfToken } = require("../middleware/csrf");

const router = express.Router();

// 환자 본인의 상담 이력만 조회 (IDOR 방지: 세션의 patientId만 사용, URL 파라미터로 안 받음)
router.get("/history", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const [rows] = await pool.query(
    "SELECT id, sender, content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY id",
    [req.session.patientId]
  );
  const masked = rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    content: maskPii(decryptText(row.content)),
    created_at: row.created_at,
  }));
  res.json(masked);
});

// 환자가 메시지를 보내면: (1) 원문 암호화 저장 (2) 챗봇 서비스에 질문+patient_id 전달해 답변 생성
// (3) 답변도 암호화 저장 (4) 화면에는 마스킹된 텍스트만 응답
//
// [챗봇팀 요청사항 반영] report_merge.md 3.1 — 챗봇이 "누가 물어보는지" 알아야 본인 예약/진료기록을
// 조회하는 도구(tools_db.py)를 쓸 수 있으므로, question과 함께 patient_id를 반드시 실어 보낸다.
router.post("/", verifyCsrfToken, async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const { message } = req.body;
  if (!message || typeof message !== "string" || message.length > 1000) {
    return res.status(400).json({ message: "메시지를 확인해주세요." });
  }

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'patient', ?)",
    [req.session.patientId, encryptText(message)]
  );

  let answer;
  try {
    const upstream = await fetch(`${config.chatbotServiceUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: message,
        patient_id: req.session.patientId, // 세션에서만 가져옴 - 클라이언트가 조작 불가 (IDOR 방지)
      }),
    });
    if (!upstream.ok) throw new Error(`챗봇 서비스 응답 오류: ${upstream.status}`);
    const data = await upstream.json();
    answer = data.answer;
  } catch (err) {
    console.error("[chat] 챗봇 서비스 호출 실패:", err.message);
    answer = "죄송합니다, 지금은 상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'bot', ?)",
    [req.session.patientId, encryptText(answer)]
  );

  res.json({ answer: maskPii(answer) });
});

module.exports = router;
