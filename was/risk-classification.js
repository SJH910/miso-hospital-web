// 감사 로그(audit_log) 이벤트의 위험도(상/중/하)를 분류하고, 저장 전 식별정보를 마스킹한다.
// 챗봇 쪽 감사 로그(chatbot-service/audit-agent/risk_classification.py)와 등급 기준·마스킹 방식을
// 동일하게 맞춰서, 로그를 보는 관리자가 두 파이프라인을 같은 잣대로 읽을 수 있게 한다.
// 자세한 분류 근거는 SECURITY_THREAT_MODEL.md 참고.

const RISK_LEVELS = {
  // 상(HIGH) - 관리자 계정을 노린 정황이거나, 실제 침해 시도가 의심되는 신호.
  // 발생 즉시 사람이 확인해야 하는 등급.
  login_anomaly_admin_repeated_failure: "high",
  login_anomaly_admin_new_ip: "high",
  login_anomaly_admin_new_location: "high",
  totp_verify_fail: "high",
  // TOTP 해제는 관리자 계정의 "마지막 방어선"을 없애는 방향의 조작이라 totp_enrolled/
  // verify_success(보호를 추가/사용하는 동작, low)와 묶으면 안 됨 - 세션이 탈취된 공격자가
  // 신규 위치 로그인 시 코드 요구를 피하려고 제일 먼저 시도할 법한 조치이기도 하고, 드물게만
  // 발생하는 이벤트라 high로 잡아도 알림 피로(노이즈)가 거의 없음.
  totp_disabled: "high",
  // [보안 강화 2026-09-14] 로그인 아이디/비밀번호에 SQL 인젝션 패턴(' OR '1'='1', UNION SELECT,
  // ;DROP TABLE, SQL 주석(--/#) 등)이 그대로 들어오면, 쿼리는 파라미터화되어 있어 실행되진
  // 않지만 지금까지는 그냥 평범한 login_fail(low)로만 기록되어 공격 시도 자체가 오타와
  // 구분 없이 묻히고 있었음. 성공 여부와 무관하게 "침해 시도가 의심되는 신호"라 high로 분류.
  login_anomaly_sqli_pattern: "high",

  // 중(MEDIUM) - 자동화된 공격 패턴일 가능성이 있으나, 특정 고위험 계정으로 한정되지는 않음.
  // 계정 역할 변경은 그 자체는 정상 운영 행위이지만 권한 상승을 동반할 수 있어 상시 관찰 대상으로 분류.
  login_anomaly_repeated_failure: "medium",
  login_anomaly_high_frequency: "medium",
  login_anomaly_long_input: "medium",
  account_role_change: "medium",

  // 하(LOW) - 정상 흐름이거나, 아직 이상탐지 임계값에 도달하지 않은 단발성 이벤트.
  login_success: "low",
  login_fail: "low",
  totp_verify_success: "low",
  totp_enrolled: "low",
  patient_register: "low",
};

// 목록에 없는 action(향후 추가되는 이벤트)은 안전 측으로 "low"가 아니라 "medium"으로 분류해
// 신규 이벤트가 조용히 저위험 취급되는 것을 방지한다.
const DEFAULT_RISK_LEVEL = "medium";

function classifyRisk(action) {
  return RISK_LEVELS[action] || DEFAULT_RISK_LEVEL;
}

// 챗봇 쪽 masking.py의 이메일 마스킹 규칙(로컬파트 앞 3글자만 노출, 나머지 '*')과 동일한 방식을
// 아이디에도 적용 - 두 로그 파이프라인의 마스킹 정책을 통일하기 위함.
function maskUsername(username) {
  if (typeof username !== "string" || username.length === 0) return username;
  if (username.length > 3) {
    return username.slice(0, 3) + "*".repeat(username.length - 3);
  }
  return username[0] + "*".repeat(username.length - 1);
}

// detail 안의 식별정보 중 username만 마스킹한다. ip는 마스킹하지 않음 - 침해 대응 시
// "어디서 접근했는지" 추적에 필수적인 값이고, 이 로그 자체가 audit:view 권한(admin 전용)으로
// 이미 접근이 제한되어 있어 IP까지 가릴 실익이 적다고 판단 (SECURITY_THREAT_MODEL.md 참고).
function maskAuditDetail(detail) {
  if (!detail || typeof detail !== "object") return detail;
  const masked = { ...detail };
  if ("username" in masked) {
    masked.username = maskUsername(masked.username);
  }
  return masked;
}

module.exports = { classifyRisk, maskUsername, maskAuditDetail, RISK_LEVELS, DEFAULT_RISK_LEVEL };
