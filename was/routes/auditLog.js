const express = require("express");
const pool = require("../db");
const config = require("../config");
const requirePermission = require("../middleware/requirePermission");
const { evaluateSeverity } = require("../audit-severity");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

const VALID_RISK_LEVELS = ["low", "medium", "high"];

// 최신순 페이지네이션. limit은 남용 방지를 위해 100으로 상한.
// ?risk=high 처럼 위험도로 필터링 가능 - 운영 중 "상 등급만 훑어보기" 같은 용도.
router.get("/", requirePermission("audit:view"), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { risk } = req.query;

  if (risk && !VALID_RISK_LEVELS.includes(risk)) {
    return res.status(400).json({ message: "risk 값이 올바르지 않습니다 (low/medium/high)." });
  }

  const whereClause = risk ? "WHERE al.risk_level = ?" : "";
  const params = risk ? [risk, limit, offset] : [limit, offset];

  const [rows] = await pool.query(
    `SELECT al.id, al.actor_id, p.username AS actor_username, al.action, al.target_type, al.target_id, al.detail, al.risk_level, al.created_at
     FROM audit_log al LEFT JOIN patients p ON p.id = al.actor_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  res.json(rows);
}));

// [체크리스트 7번 - 대시보드 2단계] mysql_audit(WAS 자신의 DB)은 여기서 직접 조회하고,
// audit_jsonl/chatbot_sqlite/mysql_chat(챗봇 쪽 암호화 키가 있어야 읽는 저장소)은
// chatbot-service의 GET /audit-summary를 내부 인증으로 호출해 가져와 합친다.
// 챗봇 서비스가 죽어있어도 WAS 자신의 데이터는 보여줘야 하므로, 그 부분만 실패로 표시하고
// 요청 전체를 막지 않는다 (이 프로젝트 전반의 "외부 의존성 장애가 핵심 기능을 막으면 안 된다" 원칙).
router.get("/summary", requirePermission("audit:view"), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, actor_id, action, risk_level, created_at FROM audit_log ORDER BY created_at DESC"
  );

  const evaluated = rows.map((r) =>
    evaluateSeverity({
      source: "mysql_audit",
      record_id: r.id,
      timestamp: r.created_at,
      actor_id: r.actor_id,
      action: r.action,
      risk_level: r.risk_level,
    })
  );

  const summary = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
  for (const item of evaluated) {
    summary[item.severity.toLowerCase()] += 1;
  }
  const notable = evaluated
    .filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH")
    .slice(0, 20);

  const mysqlAuditTrack = { source: "mysql_audit", total: rows.length, summary, notable, error: null };

  let chatbotSummary = null;
  let chatbotError = null;
  try {
    const upstream = await fetch(`${config.chatbotServiceUrl}/audit-summary`, {
      headers: { "X-Internal-Auth": config.chatbotServiceKey },
    });
    if (!upstream.ok) throw new Error(`챗봇 서비스 응답 오류: ${upstream.status}`);
    chatbotSummary = await upstream.json();
  } catch (err) {
    console.error("[audit-log summary] 챗봇 서비스 호출 실패:", err.message);
    chatbotError = "챗봇 서비스에 연결할 수 없어 해당 데이터는 제외됨";
  }

  res.json({
    generated_at: new Date().toISOString(),
    risk_level_tracks: chatbotSummary
      ? [mysqlAuditTrack, chatbotSummary.risk_level_track]
      : [mysqlAuditTrack],
    pii_scan_track: chatbotSummary ? chatbotSummary.pii_scan_track : [],
    static_findings: chatbotSummary ? chatbotSummary.static_findings : [],
    chatbot_error: chatbotError,
  });
}));

module.exports = router;
