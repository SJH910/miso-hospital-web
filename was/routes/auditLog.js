const express = require("express");
const pool = require("../db");
const config = require("../config");
const requirePermission = require("../middleware/requirePermission");
const { evaluateSeverity } = require("../audit-severity");
const { classifyCategory, ANOMALY_ACTIONS, AUTH_ACTIONS } = require("../risk-classification");
const { logAuditOnce } = require("../audit");
const asyncHandler = require("../middleware/asyncHandler");
// [2026-09-16] 로그인 때 쓰는 관리자 신규 IP/지역 탐지를 감사 대시보드 열람 시점에도
// 재사용 - isNewAdminLocation은 맵을 읽기만 하는 순수 함수라 로그인 흐름 밖에서 호출해도
// 안전하다(auth.js 참고, router에 프로퍼티로 붙여 내보냄).
const { isNewAdminLocation } = require("./auth");

const router = express.Router();

const VALID_RISK_LEVELS = ["low", "medium", "high"];
// [2026-09-16] "routine"(이상탐지 아님) 하나였던 걸 auth/admin_action으로 더 세분화 -
// 로그인 노이즈에 관리자 기능 사용 기록이 묻히는 문제 해결(risk-classification.js 참고).
const VALID_CATEGORIES = ["anomaly", "auth", "admin_action"];

// [2026-09-16] 이 대시보드(마스킹된 PII 미리보기·위험 이벤트가 담긴 화면)를 관리자가 언제
// 열람했는지 지금까지 어디에도 안 남고 있었음 - 내부자가 몰래 들여다봐도 흔적이 없던 공백이라
// 감사 이벤트로 기록한다. 다만 /summary는 admin-audit-dashboard.js가 10초마다 자동 폴링하므로
// 매 폴링을 다 기록하면 "노이즈 문제"를 해결하려던 이 기능 자체가 새 노이즈가 됨 - 계정당
// 일정 시간(5분) 안의 반복 열람은 최초 1건만 남기는 디바운스를 둔다(was/audit.js의 logAuditOnce).
function logViewOnce(actorId, action, detail) {
  logAuditOnce(`${actorId}:${action}`, actorId, action, null, null, detail);
}

// [2026-09-16] "누가 봤는지"뿐 아니라 "정상적인 위치에서 봤는지"까지 구분하기 위함 - 이미
// 유효한 세션이 이 관리자 계정이 한 번도 접속한 적 없는 IP/지역에서 쓰이고 있다면(세션 탈취
// 후 실사용 정황) 평범한 admin_action이 아니라 이상탐지(anomaly, high)로 기록한다.
// req.session.username은 로그인 시점에 심어둔다(auth.js) - 옛 세션(이 변경 전에 로그인한
// 세션)엔 없을 수 있으니 없으면 그냥 평소 위치로 간주(과탐지보다 미탐지가 안전한 기본값).
async function resolveViewAction(req, routineAction) {
  if (
    req.session.role === "admin" &&
    req.session.username &&
    (await isNewAdminLocation({ username: req.session.username, ip: req.ip }))
  ) {
    return "audit_access_new_location";
  }
  return routineAction;
}

// 최신순 페이지네이션. limit은 남용 방지를 위해 100으로 상한.
// ?risk=high 처럼 위험도로, ?category=anomaly|routine처럼 "이상탐지 이벤트인가"로 필터링 가능 -
// risk_level=low 안에 정상 로그인 성공/실패와 이상탐지 미달 이벤트가 섞여 있어서, 등급과는
// 별도로 "탐지된 신호만 보기"가 필요해 추가됨 (action 목록 자체는 risk-classification.js가
// 기준 - 감사로그 기록 시점의 분류와 조회 시점의 필터가 항상 같은 기준을 쓰게 하기 위함).
router.get("/", requirePermission("audit:view"), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { risk, category, from, to, actor } = req.query;

  if (risk && !VALID_RISK_LEVELS.includes(risk)) {
    return res.status(400).json({ message: "risk 값이 올바르지 않습니다 (low/medium/high)." });
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: "category 값이 올바르지 않습니다 (anomaly/auth/admin_action)." });
  }
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if ((from && Number.isNaN(fromDate.getTime())) || (to && Number.isNaN(toDate.getTime()))) {
    return res.status(400).json({ message: "from/to는 올바른 날짜 형식이어야 합니다." });
  }
  const actorId = actor ? Number(actor) : null;
  if (actor && (!Number.isInteger(actorId) || actorId <= 0)) {
    return res.status(400).json({ message: "actor 값이 올바르지 않습니다." });
  }

  const conditions = [];
  const params = [];
  if (risk) {
    conditions.push("al.risk_level = ?");
    params.push(risk);
  }
  if (category) {
    // ANOMALY_ACTIONS/AUTH_ACTIONS는 고정된 액션 이름 목록(사용자 입력 아님)이라 그대로 SQL에
    // 넣어도 안전 - 그래도 파라미터 바인딩으로 통일해 다른 조건들과 같은 패턴을 유지한다.
    // admin_action은 "이상탐지도 인증도 아닌 나머지 전부"라 두 목록을 합쳐 NOT IN으로 뺀다 -
    // 새 관리자 기능 로그가 추가돼도 이 목록을 매번 안 고쳐도 자동으로 admin_action이 된다.
    const actions =
      category === "anomaly" ? [...ANOMALY_ACTIONS] : category === "auth" ? [...AUTH_ACTIONS] : [...ANOMALY_ACTIONS, ...AUTH_ACTIONS];
    conditions.push(`al.action ${category === "admin_action" ? "NOT IN" : "IN"} (${actions.map(() => "?").join(",")})`);
    params.push(...actions);
  }
  if (actorId) {
    conditions.push("al.actor_id = ?");
    params.push(actorId);
  }
  // 특정 시:분:초 구간만 찾고 싶을 때(예: "17시 3분대에 뭐가 있었나") 쓰는 필터 - 프론트가
  // <input type="datetime-local" step="1">로 초 단위까지 지정해 보내면 그대로 반영된다.
  if (fromDate) {
    conditions.push("al.created_at >= ?");
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push("al.created_at <= ?");
    params.push(toDate);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  logViewOnce(
    req.session.patientId,
    await resolveViewAction(req, "audit_log_viewed"),
    { risk: risk || null, category: category || null, actor: actorId || null, ip: req.ip }
  );

  // [2026-09-16] 프론트에서 숫자 페이지 버튼(예: 1~10페이지 한 번에 표시)을 만들려면 전체
  // 건수가 필요한데, 지금까지는 "이번 페이지가 꽉 찼는가"로만 다음 페이지 가능 여부를 판단해서
  // (이전/다음 이동만 가능) 총 페이지 수를 알 수 없었다. COUNT(*)를 같은 WHERE 조건으로
  // 병렬 조회해 total을 함께 내려준다.
  const [[rows], [countRows]] = await Promise.all([
    pool.query(
      `SELECT al.id, al.actor_id, p.username AS actor_username, al.action, al.target_type, al.target_id, al.detail, al.risk_level, al.created_at
       FROM audit_log al LEFT JOIN patients p ON p.id = al.actor_id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM audit_log al ${whereClause}`,
      params
    ),
  ]);
  res.json({
    rows: rows.map((r) => ({ ...r, category: classifyCategory(r.action) })),
    total: countRows[0].total,
  });
}));

// [체크리스트 7번 - 대시보드 2단계] mysql_audit(WAS 자신의 DB)은 여기서 직접 조회하고,
// audit_jsonl/chatbot_sqlite/mysql_chat(챗봇 쪽 암호화 키가 있어야 읽는 저장소)은
// chatbot-service의 GET /audit-summary를 내부 인증으로 호출해 가져와 합친다.
// 챗봇 서비스가 죽어있어도 WAS 자신의 데이터는 보여줘야 하므로, 그 부분만 실패로 표시하고
// 요청 전체를 막지 않는다 (이 프로젝트 전반의 "외부 의존성 장애가 핵심 기능을 막으면 안 된다" 원칙).
router.get("/summary", requirePermission("audit:view"), asyncHandler(async (req, res) => {
  logViewOnce(req.session.patientId, await resolveViewAction(req, "audit_dashboard_viewed"), { ip: req.ip });

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
    pii_scan: chatbotSummary ? chatbotSummary.pii_scan : null,
    static_findings: chatbotSummary ? chatbotSummary.static_findings : [],
    chatbot_error: chatbotError,
  });
}));

// [2026-09-16] Discord 알림 링크(?event=<id>)로 들어왔을 때, 필터/페이지를 몰라도 그 이벤트가
// 있는 페이지로 자동 이동하기 위한 단일 조회. "/summary"보다 뒤에 둬야 한다 - Express가 경로를
// 등록 순서대로 매칭해서, 이 "/:id"가 먼저 있으면 "/summary" 요청까지 id="summary"로 먹어버린다.
// 페이지 위치는 필터 없는 기본 정렬(최신순) 기준의 순번(rank, 0-based)으로 계산 - 이 행보다
// created_at이 더 최신인 행 개수와 같다. 필터가 걸린 상태로 들어왔다면 이 값이 안 맞을 수 있는데,
// 알림 직후에는 보통 필터가 비어있는 상태로 열어보는 경우라 이 정도 가정으로 충분하다고 판단.
router.get("/:id", requirePermission("audit:view"), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "id가 올바르지 않습니다." });
  }

  const [rows] = await pool.query(
    `SELECT al.id, al.actor_id, p.username AS actor_username, al.action, al.target_type, al.target_id, al.detail, al.risk_level, al.created_at
     FROM audit_log al LEFT JOIN patients p ON p.id = al.actor_id
     WHERE al.id = ?`,
    [id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ message: "해당 이벤트를 찾을 수 없습니다." });
  }
  const row = rows[0];

  // [버그 수정 2026-09-16] RANK는 MySQL 8.0+ 예약어(윈도우 함수)라 별칭으로 그냥 쓰면
  // 문법 오류(ER_PARSE_ERROR) - rank_count처럼 예약어가 아닌 이름으로 바꿔야 함.
  const [rankRows] = await pool.query(
    "SELECT COUNT(*) AS rank_count FROM audit_log WHERE created_at > ?",
    [row.created_at]
  );

  res.json({ ...row, category: classifyCategory(row.action), rank: rankRows[0].rank_count });
}));

module.exports = router;
