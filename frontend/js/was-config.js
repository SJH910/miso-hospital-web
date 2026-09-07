// 프론트가 어떤 IP/호스트로 열렸든, WAS는 "같은 호스트의 3000번 포트"라고 가정하고 자동 계산.
// 예: 팀원이 http://192.168.0.15:5500 으로 열면 -> WAS_BASE는 http://192.168.0.15:3000 이 됨
const WAS_BASE = `${location.protocol}//${location.hostname}:3000`;

// [보안 강화 #5 CSRF] 로그인/me 응답으로 받은 CSRF 토큰을 탭 단위로 보관.
// sessionStorage는 탭을 닫으면 사라져 세션 쿠키의 생명주기와 유사하게 동작함.
function setCsrfToken(token) {
    if (token) sessionStorage.setItem('csrfToken', token);
}
function getCsrfToken() {
    return sessionStorage.getItem('csrfToken') || '';
}
