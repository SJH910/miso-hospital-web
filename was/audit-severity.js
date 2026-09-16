// mysql_audit(WAS 자신의 audit_log) 레코드를 리포트용 4단계(Critical/High/Medium/Low)로 환산한다.
// was/risk-classification.js(기록 시점, 상/중/하 3단계)와는 관심사가 다르다 — 이 파일은
// "이미 저장된 값을 조회 시점에 다시 어떻게 보여줄지"만 다룬다. chatbot-service의
// log_audit_tool.py(evaluate_severity/ADMIN_ANOMALY_ACTIONS)와 동일한 규칙을 그대로 포팅한
// 것 — 등급 기준을 바꾸려면 두 파일을 항상 같이 고쳐야 한다.

const RISK_TO_SEVERITY = { low: "LOW", medium: "MEDIUM", high: "HIGH" };

// risk_level="high"인 이벤트 중에서도 관리자 계정 침해 정황(이미 로그인에 성공했거나
// 표적이 된 상태)만 한 단계 더 위인 CRITICAL로 승격한다. totp_verify_fail/totp_disabled/
// 프롬프트 인젝션은 승격하지 않고 HIGH 유지 - "정황"이지 이미 성공한 침해는 아니기 때문.
const ADMIN_ANOMALY_ACTIONS = new Set([
  "login_anomaly_admin_repeated_failure",
  "login_anomaly_admin_new_ip",
  "login_anomaly_admin_new_location",
  // [2026-09-16] 이미 유효한 세션으로 낯선 위치에서 감사 대시보드를 열람한 정황 - 로그인
  // 시도가 아니라 "이미 인증된 세션이 실사용되는 중"이라는 점에서 login_anomaly_admin_new_ip
  // 보다도 침해 가능성이 더 뚜렷하다고 판단해 같은 수준으로 승격한다.
  "audit_access_new_location",
]);

function evaluateSeverity(row) {
  let severity = RISK_TO_SEVERITY[row.risk_level] || "NONE";
  const escalated = severity === "HIGH" && ADMIN_ANOMALY_ACTIONS.has(row.action);
  if (escalated) severity = "CRITICAL";
  return { ...row, severity, escalated };
}

module.exports = { evaluateSeverity, ADMIN_ANOMALY_ACTIONS, RISK_TO_SEVERITY };
