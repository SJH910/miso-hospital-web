const pool = require("./db");
const { classifyRisk, maskAuditDetail } = require("./risk-classification");
const { notifyDiscord } = require("./discord-notify");

// [2026-09-16] 이 액션들은 risk_level은 low(정상적인 admin 업무)지만, "누가 감사 대시보드에
// 접근했는지"는 세션이 탈취됐을 때 특히 중요한 신호라 등급과 무관하게 항상 Discord로 알린다 -
// riskLevel==="high"인 이벤트만 알리는 아래 기본 게이트와 별도 경로.
const ALWAYS_NOTIFY_ACTIONS = new Set(["audit_log_viewed", "audit_dashboard_viewed"]);

// 민감한 동작(로그인, 계정 역할 변경 등)이 일어날 때 audit_log에 기록한다.
// 실패해도 원래 요청 처리를 막으면 안 되므로 에러는 로그만 남기고 던지지 않는다.
// [보안 강화] 기록 시점에 위험도(상/중/하)를 분류해 같이 저장하고, detail 안의 식별정보는
// 저장 전에 마스킹한다 - 나중에 재분류하는 게 아니라 "탐지한 시점의 판단"을 그대로 남기는 방식.
async function logAudit(actorId, action, targetType, targetId, detail) {
  try {
    const riskLevel = classifyRisk(action);
    const maskedDetail = maskAuditDetail(detail);

    const [result] = await pool.query(
      "INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, risk_level) VALUES (?, ?, ?, ?, ?, ?)",
      [actorId, action, targetType ?? null, targetId ?? null, maskedDetail ? JSON.stringify(maskedDetail) : null, riskLevel]
    );

    // [Discord 실시간 알림] riskLevel이 high거나 대시보드 접근처럼 항상 알려야 하는 액션이면
    // 관리자 웹 세션과 분리된 채널로 즉시 알림. await하지 않는다 - 알림 전송(네트워크 I/O)이
    // 원래 요청 처리를 지연시키면 안 되므로 fire-and-forget. notifyDiscord 자체도 내부에서
    // 실패를 삼키지만, 한 번 더 감싼다.
    // [2026-09-16] INSERT를 먼저 해야 result.insertId를 알 수 있어서, 원래 INSERT보다 앞에
    // 있던 이 호출을 뒤로 옮겼다 - 어차피 INSERT는 이미 await하고 있어 전체 지연 시간은
    // 그대로고, insertId를 알림 링크(?event=<id>)에 실어 보내 관리자가 클릭 한 번으로
    // 정확히 그 이벤트가 있는 페이지로 이동할 수 있게 한다.
    if (riskLevel === "high" || ALWAYS_NOTIFY_ACTIONS.has(action)) {
      // target이 있는 이벤트(로그인 이상탐지 등)는 지금까지처럼 target=type#id로 표시하고,
      // target이 없는 이벤트(대시보드 열람처럼 대상 개념 자체가 없는 액션)는 대신 detail을
      // 보여준다 - 이전에는 target 없는 이벤트가 "target=-#-"라는 의미 없는 placeholder만
      // 보여주고, 정작 유용한 detail(예: 어떤 필터로 조회했는지)은 DB에만 저장되고 Discord
      // 알림에는 전혀 전달되지 않고 있었음.
      const notifyDetail =
        targetType || targetId
          ? `target=${targetType ?? "-"}#${targetId ?? "-"}`
          : maskedDetail
            ? JSON.stringify(maskedDetail)
            : null;
      // [2026-09-16] Discord 메시지가 지금까지 숫자 계정 ID만 보여줘서("행위자: 5") 관리자가
      // 매번 DB를 뒤져야 누군지 알 수 있었음 - 알림 직전에만 username을 조회해 같이 보여준다.
      // 조회 자체가 실패해도(예: 탈퇴한 계정) 알림 자체를 막으면 안 되므로 실패는 삼키고
      // ID만으로 계속 진행한다. high/ALWAYS_NOTIFY 이벤트만 타는 경로라 매 감사 로그 기록마다
      // 쿼리가 느는 건 아니다.
      (async () => {
        let actorUsername = null;
        if (actorId) {
          try {
            const [userRows] = await pool.query("SELECT username FROM patients WHERE id = ?", [actorId]);
            actorUsername = userRows[0]?.username ?? null;
          } catch (e) {
            console.error("[discord notify] actor username 조회 실패", e.message);
          }
        }
        return notifyDiscord(action, actorId, notifyDetail, result.insertId, actorUsername);
      })().catch((err) => {
        console.error("[discord notify hook error]", err.message);
      });
    }
  } catch (err) {
    console.error("[audit log error]", err);
  }
}

// [2026-09-16] 감사 대시보드 열람 기록(자동 폴링)에서 처음 쓰인 "짧은 시간 안 반복은 최초
// 1건만" 디바운스를, 세션 없음(401)/권한 없음(403) 접근 시도 기록에도 그대로 적용하기 위해
// 공용 유틸로 뽑았다. requirePermission처럼 rate limit이 없는 라우트를 세션 없이 반복
// 호출하면 요청마다 INSERT가 쌓여 audit_log가 무한정 불어날 수 있기 때문 - 호출부가 원하는
// 기준(IP+path, 계정+path, 계정+action 등)으로 dedupeKey만 넘기면 된다.
const recentlyLoggedAt = new Map(); // dedupeKey -> 마지막 기록 시각(ms)
const DEFAULT_LOG_DEBOUNCE_MS = 5 * 60 * 1000;

function logAuditOnce(dedupeKey, actorId, action, targetType, targetId, detail, windowMs = DEFAULT_LOG_DEBOUNCE_MS) {
  const now = Date.now();
  const last = recentlyLoggedAt.get(dedupeKey);
  if (last !== undefined && now - last < windowMs) return;
  recentlyLoggedAt.set(dedupeKey, now);
  logAudit(actorId, action, targetType, targetId, detail);
}

module.exports = { logAudit, logAuditOnce, DEFAULT_LOG_DEBOUNCE_MS };
