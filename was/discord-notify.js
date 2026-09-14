// Discord 웹훅으로 riskLevel=high 이벤트를 실시간 알림.
//
// 관리자 웹 세션과 완전히 분리된 알림 경로다 - 오늘 병합된 감사 로그 대시보드
// (was/audit-severity.js, chatbot-service/audit_summary.py, 2a1a303)는 조회형이라, 세션이
// 탈취되면 침입자도 같은 화면을 볼 수 있다는 문제가 남는다. Discord는 그 세션과 무관한 별도
// 채널이라 이 문제를 보완한다(제안서: https://claude.ai/code/artifact/2f536ff6-4219-4fd1-8e3b-
// 55437c7f5112 "왜 디스코드인가" 참고).
//
// 같은 action(+actor)은 짧은 시간 안에 재발송하지 않는다 - 인메모리 디바운스라 서버 재시작 시
// 초기화되는데, 이건 ANOMALY_DETECTION.md의 기존 인메모리 카운터와 동일한 종류의 한계로 이미
// 이 프로젝트가 감수하고 있는 트레이드오프다.
//
// 요구사항/동작 명세는 test-discord-notify.js 참고 (TDD로 먼저 작성됨).
const DEBOUNCE_MS = 5 * 60 * 1000; // 5분
const recentSent = new Map(); // "action::actor" -> 마지막 발송 시각(ms)

// [가독성 개선 2026-09-11] SECURITY_AUDIT_CRITERIA.md의 등급 매핑 표를 그대로 옮긴 한글
// 라벨/사유/등급. was/risk-classification.js의 RISK_LEVELS에서 "high"인 5개 action이 전부다
// (login_anomaly_admin_* 3종 + totp_verify_fail + totp_disabled) - 그 외 action이 여기로
// 들어올 일은 현재 코드상 없지만, 앞으로 RISK_LEVELS에 새 "high" 이벤트가 추가될 경우
// (경우의 수 대비) 코드 없이도 무슨 상황인지는 알 수 있도록 일반적인 기본값을 둔다.
const EVENT_LABELS = {
  login_anomaly_admin_repeated_failure: ["관리자 계정 반복 실패", "고권한 계정이 집중 공격받는 중 (5분 내 3회)", "CRITICAL"],
  login_anomaly_admin_new_ip: ["관리자 신규 IP 로그인", "이미 로그인에 성공한 이벤트 - 계정 탈취 가능성", "CRITICAL"],
  login_anomaly_admin_new_location: ["관리자 신규 지역 로그인", "신규 IP 로그인과 동일 + 지리적으로도 이상", "CRITICAL"],
  totp_verify_fail: ["TOTP 인증 실패", "비밀번호 통과 후 2차인증 실패 - 탈취 정황", "HIGH"],
  totp_disabled: ["TOTP 해제", "2차인증 자체를 제거하는 조작", "HIGH"],
};
const DEFAULT_LABEL = ["미분류 위험 이벤트", "was/risk-classification.js에 새로 추가됐지만 아직 한글 라벨이 없는 high 등급 이벤트 - 코드 확인 필요", "HIGH"];
const SEVERITY_EMOJI = { CRITICAL: "🔴", HIGH: "🟠" };

function shouldSend(action, actor, now = Date.now()) {
  const key = `${action}::${actor ?? "-"}`;
  const lastSent = recentSent.get(key);
  if (lastSent !== undefined && now - lastSent < DEBOUNCE_MS) {
    return false;
  }
  recentSent.set(key, now);
  return true;
}

async function notifyDiscord(action, actor, detail) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // 알림은 부가 기능 - 설정 없다고 본 서비스(감사 기록)를 막으면 안 됨
  if (!shouldSend(action, actor)) return;

  const [label, reason, severity] = EVENT_LABELS[action] || DEFAULT_LABEL;
  const emoji = SEVERITY_EMOJI[severity] || "🚨";

  const lines = [
    `${emoji} **[${severity}] ${label}**`,
    `사유: ${reason}`,
    `이벤트: \`${action}\``,
  ];
  if (actor !== undefined && actor !== null) lines.push(`행위자(계정 ID): \`${actor}\``);
  if (detail) lines.push(`상세: ${detail}`);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n") }),
    });
    if (!res.ok) {
      console.error(`[discord notify error] 웹훅 응답 오류: ${res.status}`);
    }
  } catch (err) {
    // 알림 실패가 감사 로그 기록 자체를 막으면 안 되므로 로그만 남기고 삼킨다.
    console.error("[discord notify error]", err.message);
  }
}

module.exports = { notifyDiscord, shouldSend, _recentSent: recentSent };
