const express = require("express");
const pool = require("../db");
const config = require("../config");
const { encryptText, decryptText, maskPii } = require("../crypto-utils");
const { verifyCsrfToken } = require("../middleware/csrf");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// 환자 본인의 상담 이력만 조회 (IDOR 방지: 세션의 patientId만 사용, URL 파라미터로 안 받음)
router.get("/history", asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const [rows] = await pool.query(
    "SELECT id, sender, content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY id",
    [req.session.patientId]
  );
  // [안정성 강화] RRN_ENCRYPTION_KEY가 바뀌면 예전 키로 암호화된 메시지는 복호화가 실패한다.
  // 메시지 하나 복호화 실패로 전체 요청(나아가 서버 전체)이 죽지 않도록, 실패한 메시지는
  // 건너뛰고 나머지는 정상적으로 보여준다.
  const masked = [];
  for (const row of rows) {
    try {
      masked.push({
        id: row.id,
        sender: row.sender,
        content: maskPii(decryptText(row.content)),
        created_at: row.created_at,
      });
    } catch (err) {
      console.error(`[chat history] 메시지 id=${row.id} 복호화 실패 (암호화 키 변경 가능성) - 건너뜀`);
    }
  }
  res.json(masked);
}));

// chatbot-service 호출 공통 로직 - /와 /confirm-reservation이 body만 다르게 채워서 재사용한다.
async function callChatbotService(body) {
  const upstream = await fetch(`${config.chatbotServiceUrl}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // [보안 강화 2026-09-10] chatbot-service가 이 헤더로 호출자를 검증 - config.js 참고
      "X-Internal-Auth": config.chatbotServiceKey,
      // [보안 수정] chatbot-service의 rate limit이 WAS IP 하나로 전체 환자에게 공용으로
      // 걸리던 문제 수정용 - 세션에서만 가져온 값이라 클라이언트가 조작 불가(위 IDOR 방지와
      // 동일한 신뢰 근거). rate_limit_key.py 참고.
      "X-Patient-Id": String(body.patient_id),
    },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) throw new Error(`챗봇 서비스 응답 오류: ${upstream.status}`);
  return upstream.json();
}

// 환자가 메시지를 보내면: (1) 원문 암호화 저장 (2) 챗봇 서비스에 질문+patient_id 전달해 답변 생성
// (3) 답변도 암호화 저장 (4) 화면에는 마스킹된 텍스트만 응답
//
// [챗봇팀 요청사항 반영] report_merge.md 3.1 — 챗봇이 "누가 물어보는지" 알아야 본인 예약/진료기록을
// 조회하는 도구(tools_db.py)를 쓸 수 있으므로, question과 함께 patient_id를 반드시 실어 보낸다.
router.post("/", verifyCsrfToken, asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const { message } = req.body;
  if (!message || typeof message !== "string" || message.length > 1000) {
    return res.status(400).json({ message: "메시지를 확인해주세요." });
  }

  // [보안 수정 2026-09-16] 새 메시지가 들어오면 이전에 확인 대기 중이던 예약 제안은 무효화한다.
  // 예: "내과 예약해줘"로 확인 메시지를 받은 뒤 확인하지 않고 "정형외과 예약해줘"라고 다시
  // 물으면, 세션에 남아있던 옛 pending("내과")이 새 pending("정형외과")과 섞이거나 "예" 버튼이
  // 엉뚱한 예약(내과)을 확정해버리는 것을 막는다. 이번 응답에 새 pending이 오면 아래에서 다시 채운다.
  delete req.session.pendingReservation;

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'patient', ?)",
    [req.session.patientId, encryptText(message)]
  );

  let answer;
  let needsConfirmation = false;
  try {
    const data = await callChatbotService({
      question: message,
      patient_id: req.session.patientId, // 세션에서만 가져옴 - 클라이언트가 조작 불가 (IDOR 방지)
    });
    answer = data.answer;
    if (data.pending_reservation) {
      // 서버(WAS)가 세션에만 보관 - 브라우저에는 이 dict 자체를 내려보내지 않는다. 프론트는
      // "확인이 필요하다"는 사실(needsConfirmation)과 사람이 읽을 answer 문구만 받는다.
      req.session.pendingReservation = data.pending_reservation;
      needsConfirmation = true;
    }
  } catch (err) {
    console.error("[chat] 챗봇 서비스 호출 실패:", err.message);
    answer = "죄송합니다, 지금은 상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'bot', ?)",
    [req.session.patientId, encryptText(answer)]
  );

  res.json({ answer: maskPii(answer), needsConfirmation });
}));

// [보안 수정 2026-09-16] 예약 확인("예" 버튼). 클라이언트는 department/date_str 같은 예약
// 내용을 전혀 보내지 않는다 - 세션에 저장해둔 pendingReservation(서버가 직접 만든 값)만
// 사용하므로 요청 body를 조작해도 다른 시간/진료과로 바꿔치기할 수 없다.
router.post("/confirm-reservation", verifyCsrfToken, asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  const pending = req.session.pendingReservation;
  if (!pending) {
    return res.status(400).json({ message: "확인할 예약이 없습니다. 다시 예약을 요청해주세요." });
  }
  // [중복 예약 방지] 성공/실패와 무관하게 먼저 지운다 - 지우기 전에 응답을 기다리면 사용자가
  // 버튼을 두 번 누르거나 새로고침 후 다시 눌렀을 때 같은 예약이 중복으로 들어갈 수 있다.
  delete req.session.pendingReservation;

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'patient', ?)",
    [req.session.patientId, encryptText("[예약 확인]")]
  );

  let answer;
  try {
    const data = await callChatbotService({
      question: "(예약 확인)",
      patient_id: req.session.patientId,
      confirm_pending_reservation: true,
      pending_department: pending.department,
      pending_date_str: pending.date_str,
    });
    answer = data.answer;
  } catch (err) {
    console.error("[chat] 예약 확인 중 챗봇 서비스 호출 실패:", err.message);
    answer = "죄송합니다, 지금은 예약을 확정할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'bot', ?)",
    [req.session.patientId, encryptText(answer)]
  );

  res.json({ answer: maskPii(answer) });
}));

// [보안 수정 2026-09-16] 예약 취소("아니오" 버튼) - 세션의 pending만 지우고 챗봇 서비스는
// 호출하지 않는다 (확정 시도 자체가 없었으므로).
router.post("/cancel-reservation", verifyCsrfToken, asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  delete req.session.pendingReservation;

  const answer = "예약 요청을 취소했습니다. 다시 말씀해주시면 도와드릴게요.";
  await pool.query(
    "INSERT INTO chat_messages (patient_id, sender, content) VALUES (?, 'bot', ?)",
    [req.session.patientId, encryptText(answer)]
  );

  res.json({ answer });
}));

module.exports = router;
