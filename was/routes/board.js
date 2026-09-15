const express = require("express");
const sanitizeHtml = require("sanitize-html");
const pool = require("../db");
const { verifyCsrfToken } = require("../middleware/csrf");
const requirePermission = require("../middleware/requirePermission");
const { hasPermission } = requirePermission;
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// post_id 목록에 대한 답변 이력을 한 번에 조회해 { [post_id]: [answer, ...] } 형태로 묶는다.
// N+1 쿼리를 피하려고 답변 전체를 한 번에 가져온 뒤 여기서 그룹핑한다(게시글 수가 아주 많지
// 않은 문의게시판 특성상 부담 없는 수준).
async function attachAnswers(posts) {
  if (posts.length === 0) return posts;
  const postIds = posts.map((p) => p.id);
  const [answerRows] = await pool.query(
    `SELECT ba.id, ba.post_id, ba.answer, ba.created_at, p.name AS answered_by_name
     FROM board_answers ba JOIN patients p ON p.id = ba.answered_by
     WHERE ba.post_id IN (?)
     ORDER BY ba.id ASC`,
    [postIds]
  );
  const byPostId = {};
  for (const row of answerRows) {
    if (!byPostId[row.post_id]) byPostId[row.post_id] = [];
    byPostId[row.post_id].push({
      id: row.id,
      answer: row.answer,
      answered_by_name: row.answered_by_name,
      created_at: row.created_at,
    });
  }
  return posts.map((p) => ({ ...p, answers: byPostId[p.id] || [] }));
}

// board:reply(staff/admin)가 있으면 답변 대상을 찾기 위해 전체 문의를 보고,
// 없으면(patient, board:read) 본인 문의만 본다.
router.get("/", asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  if (await hasPermission(req.session.role, "board:reply")) {
    const [rows] = await pool.query(
      `SELECT bp.id, bp.patient_id, p.name AS patient_name, bp.title, bp.content, bp.created_at
       FROM board_posts bp JOIN patients p ON p.id = bp.patient_id
       ORDER BY bp.id DESC`
    );
    return res.json(await attachAnswers(rows));
  }

  if (await hasPermission(req.session.role, "board:read")) {
    const [rows] = await pool.query(
      "SELECT id, patient_id, title, created_at FROM board_posts WHERE patient_id = ? ORDER BY id DESC",
      [req.session.patientId]
    );
    return res.json(await attachAnswers(rows));
  }

  return res.status(403).json({ message: "권한이 없습니다." });
}));

// [보안 강화 #5 CSRF] 상태 변경 요청(POST)에 CSRF 토큰 검증 미들웨어 적용.
router.post("/", verifyCsrfToken, requirePermission("board:write"), asyncHandler(async (req, res) => {
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
}));

// staff/admin이 문의에 답변을 등록. :id는 board_posts.id (환자별 문의가 아니라 문의 하나 단위).
// [결정 2026-09-10] 답변은 수정/삭제 불가, 추가만 가능 — 그래서 UPDATE가 아니라 항상 INSERT.
// 같은 문의에 여러 번 호출하면 새 답변이 계속 쌓인다(이력 보존).
router.post("/:id/answer", verifyCsrfToken, requirePermission("board:reply"), asyncHandler(async (req, res) => {
  const { answer } = req.body;
  if (!answer || typeof answer !== "string") {
    return res.status(400).json({ message: "답변 내용을 확인해주세요." });
  }
  const safeAnswer = sanitizeHtml(answer, { allowedTags: [], allowedAttributes: {} });

  const [postRows] = await pool.query("SELECT id FROM board_posts WHERE id = ?", [req.params.id]);
  if (postRows.length === 0) {
    return res.status(404).json({ message: "문의를 찾을 수 없습니다." });
  }

  const [result] = await pool.query(
    "INSERT INTO board_answers (post_id, answered_by, answer) VALUES (?, ?, ?)",
    [req.params.id, req.session.patientId, safeAnswer]
  );
  res.json({ id: result.insertId, post_id: Number(req.params.id), answer: safeAnswer });
}));

// [보안 강화 #3 BOLA/IDOR] URL의 patientId가 세션 소유자와 일치하는지 반드시 검증.
// 일치하지 않으면 403으로 즉시 차단 - "로그인 여부"만이 아니라 "이 리소스의 소유자인지"까지 확인.
// 단, board:reply(staff/admin)는 GET "/" 목록에서도 전체 문의를 보므로, 상세조회도 동일하게
// 본인 것이 아니어도 통과시킨다 (답변을 달려면 다른 환자의 문의도 상세히 봐야 하므로).
//
// [보안 수정 2026-09-15] requirePermission은 권한 하나만 검사하는데, staff는 board:read가
// 없고 board:reply만 있어서(db/init.sql) 예전엔 여기 진입 자체가 미들웨어 단계에서 403으로
// 막혔음 - 바로 아래 board:reply 예외 처리(주석에 의도는 적혀있었음)에 staff가 영영 도달을
// 못 하던 버그(BUG_REVIEW_2026-09-10.md 참고). requirePermission 공용 미들웨어는 단일 권한만
// 받게 설계돼 있어 다른 모든 라우트에 영향 주지 않으려고, 이 라우트에만 board:read 또는
// board:reply 둘 중 하나면 통과하는 인라인 체크로 대체한다.
router.get("/:patientId", asyncHandler(async (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  const canReply = await hasPermission(req.session.role, "board:reply");
  const canRead = await hasPermission(req.session.role, "board:read");
  if (!canRead && !canReply) {
    return res.status(403).json({ message: "권한이 없습니다." });
  }
  if (!canReply && Number(req.params.patientId) !== req.session.patientId) {
    return res.status(403).json({ message: "접근 권한이 없습니다." });
  }

  const [rows] = await pool.query(
    `SELECT bp.id, bp.patient_id, bp.title, bp.content, p.name
     FROM board_posts bp JOIN patients p ON p.id = bp.patient_id
     WHERE bp.patient_id = ?`,
    [req.params.patientId]
  );
  res.json(await attachAnswers(rows));
}));

module.exports = router;
