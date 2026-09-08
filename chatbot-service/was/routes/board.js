const express = require("express");
const sanitizeHtml = require("sanitize-html");
const pool = require("../db");
const { verifyCsrfToken } = require("../middleware/csrf");
const requirePermission = require("../middleware/requirePermission");
const { hasPermission } = requirePermission;

const router = express.Router();

// board:reply(staff/admin)가 있으면 답변 대상을 찾기 위해 전체 문의를 보고,
// 없으면(patient, board:read) 본인 문의만 본다.
router.get("/", async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  if (await hasPermission(req.session.role, "board:reply")) {
    const [rows] = await pool.query(
      `SELECT bp.id, bp.patient_id, p.name AS patient_name, bp.title, bp.content, bp.answer, bp.answered_at, bp.created_at
       FROM board_posts bp JOIN patients p ON p.id = bp.patient_id
       ORDER BY bp.id DESC`
    );
    return res.json(rows);
  }

  if (await hasPermission(req.session.role, "board:read")) {
    const [rows] = await pool.query(
      "SELECT id, patient_id, title, answer, answered_at, created_at FROM board_posts WHERE patient_id = ? ORDER BY id DESC",
      [req.session.patientId]
    );
    return res.json(rows);
  }

  return res.status(403).json({ message: "권한이 없습니다." });
});

// [보안 강화 #5 CSRF] 상태 변경 요청(POST)에 CSRF 토큰 검증 미들웨어 적용.
router.post("/", verifyCsrfToken, requirePermission("board:write"), async (req, res) => {
  const { title, content } = req.body;
  if (!title || typeof title !== "string" || title.length > 200) {
    return res.status(400).json({ message: "제목을 확인해주세요." });
  }

  // [보안 강화 #2 Stored XSS] 저장 전 HTML 태그/속성을 모두 제거해 스크립트 삽입을 원천 차단.
  // allowedTags/allowedAttributes를 빈 배열로 두어 순수 텍스트만 남긴다.
  const safeTitle = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
  const safeContent = sanitizeHtml(content || "", { allowedTags: [], allowedAttributes: {} });

  const [result] = await pool.query(
    "INSERT INTO board_posts (patient_id, title, content) VALUES (?, ?, ?)",
    [req.session.patientId, safeTitle, safeContent]
  );
  res.json({ id: result.insertId, patient_id: req.session.patientId, title: safeTitle, content: safeContent });
});

// staff/admin이 문의에 답변을 등록. :id는 board_posts.id (환자별 문의가 아니라 문의 하나 단위).
router.patch("/:id/answer", verifyCsrfToken, requirePermission("board:reply"), async (req, res) => {
  const { answer } = req.body;
  if (!answer || typeof answer !== "string") {
    return res.status(400).json({ message: "답변 내용을 확인해주세요." });
  }
  const safeAnswer = sanitizeHtml(answer, { allowedTags: [], allowedAttributes: {} });

  const [result] = await pool.query(
    "UPDATE board_posts SET answer = ?, answered_by = ?, answered_at = NOW() WHERE id = ?",
    [safeAnswer, req.session.patientId, req.params.id]
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "문의를 찾을 수 없습니다." });
  }
  res.json({ id: Number(req.params.id), answer: safeAnswer });
});

// [보안 강화 #3 BOLA/IDOR] URL의 patientId가 세션 소유자와 일치하는지 반드시 검증.
// 일치하지 않으면 403으로 즉시 차단 - "로그인 여부"만이 아니라 "이 리소스의 소유자인지"까지 확인.
router.get("/:patientId", requirePermission("board:read"), async (req, res) => {
  if (Number(req.params.patientId) !== req.session.patientId) {
    return res.status(403).json({ message: "접근 권한이 없습니다." });
  }

  const [rows] = await pool.query(
    `SELECT bp.id, bp.patient_id, bp.title, bp.content, bp.answer, bp.answered_at, p.name
     FROM board_posts bp JOIN patients p ON p.id = bp.patient_id
     WHERE bp.patient_id = ?`,
    [req.params.patientId]
  );
  res.json(rows);
});

module.exports = router;
