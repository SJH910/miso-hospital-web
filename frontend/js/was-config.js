// 로컬 개발(serve.py, 5500번 포트)에서는 "같은 호스트의 3000번 포트"가 WAS라고 가정하고 자동 계산.
// 예: 팀원이 http://192.168.0.15:5500 으로 열면 -> WAS_BASE는 http://192.168.0.15:3000 이 됨
// [배포 2026-09-15] 운영(도메인+nginx)에서는 3000번 포트를 외부에 안 열어두고, nginx가
// 같은 도메인의 /api 경로를 내부적으로 WAS(3000)에 리버스 프록시한다 - 그래서 5500 포트가
// 아니면 같은 오리진(빈 문자열)을 쓴다. 같은 오리진이면 브라우저가 CORS 프리플라이트 자체를
// 안 보내므로 was/config.js의 FRONTEND_ORIGIN 설정도 이 경로에선 신경 쓸 필요가 없다
// (로컬 개발용 cross-origin 5500<->3000 조합에만 필요). 실제 배포 중 이 로직이 없어서
// 브라우저가 https://도메인:3000으로 요청하다가 TLS 없는 포트라 실패하는 걸 재현/발견함.
const WAS_BASE = (location.port === '5500')
    ? `${location.protocol}//${location.hostname}:3000`
    : '';

// [보안 강화 #5 CSRF] 로그인/me 응답으로 받은 CSRF 토큰을 탭 단위로 보관.
// sessionStorage는 탭을 닫으면 사라져 세션 쿠키의 생명주기와 유사하게 동작함.
function setCsrfToken(token) {
    if (token) sessionStorage.setItem('csrfToken', token);
}
function getCsrfToken() {
    return sessionStorage.getItem('csrfToken') || '';
}
