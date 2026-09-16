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

    // [Discord 실시간 알림] riskLevel이 high면 관리자 웹 세션과 분리된 채널로 즉시 알림.
    // await하지 않는다 - 알림 전송(네트워크 I/O)이 감사 로그 기록/원래 요청 처리를 지연시키면
    // 안 되므로 fire-and-forget. notifyDiscord 자체도 내부에서 실패를 삼키지만, 한 번 더 감싼다.
    if (riskLevel === "high" || ALWAYS_NOTIFY_ACTIONS.has(action)) {
      // target이 있는 이벤트(로그인 이상탐지 등)는 지금까지처럼 target=type#id로 표시하고,
      // target이 없는 이벤트(대시보드 열람처럼 대상 개념 자체가 없는 액션)는 대신 detail을
      // 보여준다 - [2026-09-16] 이전에는 target 없는 이벤트가 "target=-#-"라는 의미 없는
      // placeholder만 보여주고, 정작 유용한 detail(예: 어떤 필터로 조회했는지)은 DB에만
      // 저장되고 Discord 알림에는 전혀 전달되지 않고 있었음.
      const notifyDetail =
        targetType || targetId
          ? `target=${targetType ?? "-"}#${targetId ?? "-"}`
          : maskedDetail
            ? JSON.stringify(maskedDetail)
            : null;
      notifyDiscord(action, actorId, notifyDetail).catch((err) => {
        console.error("[discord notify hook error]", err.message);
      });
    }

    await pool.query(
      "INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, risk_level) VALUES (?, ?, ?, ?, ?, ?)",
      [actorId, action, targetType ?? null, targetId ?? null, maskedDetail ? JSON.stringify(maskedDetail) : null, riskLevel]
    );
  } catch (err) {
    console.error("[audit log error]", err);
  }
}

module.exports = { logAudit };
