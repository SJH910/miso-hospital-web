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
  // [2026-09-16] 감사 대시보드 열람 자체를 low로 고정해뒀더니, 세션이 탈취돼서 낯선 위치에서
  // 몰래 들여다보는 경우와 관리자 본인이 평소 위치에서 보는 경우가 똑같이 낮은 등급으로
  // 섞여버렸다 - "누가 봤는지"(행위자)는 있어도 "정상적인 접근인지"는 구분이 안 됨. 로그인 때
  // 이미 쓰고 있는 신규 IP/지역 탐지(auth.js의 isNewAdminLocation)를 대시보드 조회 시점에도
  // 재사용해서, 낯선 위치에서의 열람이면 audit_log_viewed/audit_dashboard_viewed 대신 이
  // 액션으로 기록한다(auditLog.js 참고) - 침입 정황을 admin_action 노이즈에 묻히지 않게 함.
  audit_access_new_location: "high",
  // [보안 강화 2026-09-14] express.json() 기본 요청 크기 제한(100KB)을 넘는 요청은 body-parser가
  // 라우트 핸들러 진입 전에 막아버려서, 지금까지는 login_anomaly_long_input(아래 medium)조차
  // 기록 안 되고 그냥 500 에러로 끝났음 - "긴 문자열 미탐"의 극단적인 경우. server.js의 에러
  // 핸들러에서 이 이벤트를 별도로 남긴다. login_anomaly_long_input(200자 초과)보다 훨씬 큰
  // 규모(100KB)라 medium으로 분류 - 같은 성격의 이벤트끼리 등급을 맞춤.
  oversized_request_payload: "medium",
  // [2026-09-16] 세션 자체가 없는 상태로 권한이 필요한 API를 직접 호출한 시도 - 정상적인
  // 프론트엔드 흐름에서는 발생하지 않는(로그인 페이지로 리다이렉트되지, API를 직접 찌르지 않음)
  // 패턴이라 정찰/스캐닝 또는 세션 쿠키 탈취 후 재사용 시도로 본다.
  admin_path_access_no_session: "high",

  // 중(MEDIUM) - 자동화된 공격 패턴일 가능성이 있으나, 특정 고위험 계정으로 한정되지는 않음.
  // 계정 역할 변경은 그 자체는 정상 운영 행위이지만 권한 상승을 동반할 수 있어 상시 관찰 대상으로 분류.
  login_anomaly_repeated_failure: "medium",
  login_anomaly_high_frequency: "medium",
  login_anomaly_long_input: "medium",
  account_role_change: "medium",
  // [2026-09-16] 로그인은 했지만 권한이 없는 API/리소스에 접근하려다 막힌 경우 - UI 실수일
  // 수도 있어 no_session보다는 낮지만, 권한 상승 시도나 IDOR 탐색일 가능성도 있어 상시 관찰.
  admin_path_access_forbidden: "medium",
  // [2026-09-16] IP 차단/해제 자체는 관리자의 정상적인 대응 조치라 anomaly는 아니지만,
  // 보안에 직접 영향을 주는 조작이라 상시 관찰 대상(account_role_change와 같은 급)으로 둔다 -
  // "누가 언제 어떤 IP를 왜 차단/해제했는지"가 감사 로그에 남아야 오남용(예: 무고한 IP를
  // 실수로 영구 차단)도 나중에 추적 가능.
  ip_blocked: "medium",
  ip_unblocked: "medium",

  // 하(LOW) - 정상 흐름이거나, 아직 이상탐지 임계값에 도달하지 않은 단발성 이벤트.
  login_success: "low",
  login_fail: "low",
  totp_verify_success: "low",
  totp_enrolled: "low",
  patient_register: "low",
  // [2026-09-16] 감사 로그 대시보드 자체를 열람하는 행위는 지금까지 어디에도 기록이
  // 안 남았음 — 마스킹된 PII 미리보기·위험 이벤트가 담긴 화면이라, 내부자가 몰래
  // 들여다봐도 흔적이 없던 공백. 정상적인 admin 업무이므로 low로 분류.
  audit_log_viewed: "low",
  audit_dashboard_viewed: "low",
};

// 목록에 없는 action(향후 추가되는 이벤트)은 안전 측으로 "low"가 아니라 "medium"으로 분류해
// 신규 이벤트가 조용히 저위험 취급되는 것을 방지한다.
const DEFAULT_RISK_LEVEL = "medium";

function classifyRisk(action) {
  return RISK_LEVELS[action] || DEFAULT_RISK_LEVEL;
}

// [2026-09-15] risk_level(상/중/하)만으로는 "완전히 정상적인 활동"(로그인 성공 등)과
// "아직 이상탐지 임계값에 안 걸렸을 뿐인 이벤트"가 같은 low 등급에 섞여 있어서, 관리자
// 대시보드에서 "탐지된 위험 신호만" 보고 싶어도 걸러낼 방법이 없었음(로그인 성공/실패가
// 반복 기록되며 실제 이상탐지 이벤트를 묻어버림). risk_level과는 독립된 축으로,
// "이상탐지 로직이 만든 이벤트인가"만 별도로 표시한다.
const ANOMALY_ACTIONS = new Set([
  "login_anomaly_admin_repeated_failure",
  "login_anomaly_admin_new_ip",
  "login_anomaly_admin_new_location",
  "login_anomaly_sqli_pattern",
  "login_anomaly_repeated_failure",
  "login_anomaly_high_frequency",
  "login_anomaly_long_input",
  "totp_verify_fail",
  "totp_disabled",
  "oversized_request_payload",
  "admin_path_access_no_session",
  "admin_path_access_forbidden",
  "audit_access_new_location",
]);

// [2026-09-16] "이상탐지 아님"(routine) 하나로 뭉쳐두니, 로그인/TOTP 같은 인증 이벤트와
// "관리자가 어떤 기능을 실제로 썼는지"(계정 관리, 감사 로그 열람, 진료기록 조회 등 - 앞으로
// 늘어날 예정)가 같이 섞여서 "관리자 기능 사용 이력만" 따로 보고 싶어도 방법이 없었음
// (로그인 성공/실패가 반복 기록되며 그 안의 관리자 행동 기록을 묻어버림). auth는 그 자체로
// 위험도 없는 "로그인 상태 변화" 이벤트만 명시적으로 나열하고, 그 외 나머지(이상탐지도 아니고
// 인증도 아닌 모든 것)는 전부 admin_action으로 취급 - 새 관리자 기능 로그가 추가돼도 이
// 목록에 매번 추가할 필요 없이 자동으로 admin_action으로 분류된다(안전측 기본값).
const AUTH_ACTIONS = new Set([
  "login_success",
  "login_fail",
  "totp_verify_success",
  "totp_enrolled",
]);

function classifyCategory(action) {
  if (ANOMALY_ACTIONS.has(action)) return "anomaly";
  if (AUTH_ACTIONS.has(action)) return "auth";
  return "admin_action";
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

module.exports = {
  classifyRisk,
  classifyCategory,
  maskUsername,
  maskAuditDetail,
  RISK_LEVELS,
  DEFAULT_RISK_LEVEL,
  ANOMALY_ACTIONS,
  AUTH_ACTIONS,
};
