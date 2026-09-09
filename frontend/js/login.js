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
        // 로그인 UI 대신 게시판/로그아웃 UI를 보여준다 (js/home.js).
        window.location.href = 'index.html';
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
