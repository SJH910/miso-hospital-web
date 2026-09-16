// [2026-09-16] 관리자 감사 대시보드처럼 로그인이 필요한 페이지가 세션 없을 때 여기로 보낼 때,
// ?redirect=원래페이지.html을 붙여 보내면 로그인 성공 후 홈이 아니라 그 페이지로 돌아간다
// (Discord 알림 링크를 눌렀는데 로그인 화면 거치고 나면 홈으로 튕겨서 다시 대시보드를 찾아
// 들어가야 하는 문제 - discord-notify.js/admin-audit-dashboard.js 참고).
// Open Redirect 방지: 같은 디렉터리의 .html 파일명 하나만 허용(프로토콜/호스트/경로 구분자
// 없는 값만) - 그 외 값(외부 URL 등)은 무시하고 기본값(index.html)으로 되돌린다.
function getSafeRedirectTarget() {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect && /^[a-zA-Z0-9_-]+\.html(\?[a-zA-Z0-9_=&-]*)?$/.test(redirect)) {
        return redirect;
    }
    return 'index.html';
}

document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const userid = document.getElementById('userid').value;
    const userpw = document.getElementById('password').value;
    const totpCode = document.getElementById('totpCode').value.trim();

    const body = { username: userid, password: userpw };
    if (totpCode) body.totpCode = totpCode; // 코드 입력창이 이미 떠 있는 재시도라면 함께 전송

    const res = await fetch(`${WAS_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // 세션 쿠키를 주고받기 위해 필요
        body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
        setCsrfToken(data.csrfToken); // [보안 강화 #5] 로그인 시 발급된 CSRF 토큰 저장
        // 로그인 후 바로 게시판으로 보내지 않고 메인 페이지로 이동 — 메인 페이지가 로그인 상태를 감지해서
        // 로그인 UI 대신 게시판/로그아웃 UI를 보여준다 (js/home.js). ?redirect=가 있으면(위 설명 참고)
        // 그 페이지로 대신 이동.
        window.location.href = getSafeRedirectTarget();
    } else if (data.requiresTotp) {
        // [관리자 신규 위치 추가 인증] 비밀번호는 맞았지만 처음 보는 위치라 코드가 더 필요한 상태.
        // 폼을 초기화하지 않고 코드 입력창만 추가로 보여준 뒤, 사용자가 다시 제출하면 위에서
        // totpCode를 함께 실어 보낸다.
        document.getElementById('totpGroup').hidden = false;
        document.getElementById('totpCode').focus();
        showToast(data.message);
    } else {
        showToast(data.message || '로그인 실패');
    }
});
