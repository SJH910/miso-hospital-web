const pool = require("./db");
const { classifyRisk, maskAuditDetail } = require("./risk-classification");
const { notifyDiscord } = require("./discord-notify");

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
    if (riskLevel === "high") {
      notifyDiscord(action, actorId, `target=${targetType ?? "-"}#${targetId ?? "-"}`).catch((err) => {
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
