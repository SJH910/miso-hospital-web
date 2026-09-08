const pool = require("./db");

// 민감한 동작(로그인, 계정 역할 변경 등)이 일어날 때 audit_log에 기록한다.
// 실패해도 원래 요청 처리를 막으면 안 되므로 에러는 로그만 남기고 던지지 않는다.
async function logAudit(actorId, action, targetType, targetId, detail) {
  try {
    await pool.query(
      "INSERT INTO audit_log (actor_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)",
      [actorId, action, targetType ?? null, targetId ?? null, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error("[audit log error]", err);
  }
}

module.exports = { logAudit };
