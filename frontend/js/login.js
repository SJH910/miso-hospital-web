document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const userid = document.getElementById('userid').value;
    const userpw = document.getElementById('password').value;

    const res = await fetch(`${WAS_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // 세션 쿠키를 주고받기 위해 필요
        body: JSON.stringify({ username: userid, password: userpw }),
    });
    const data = await res.json();

    if (data.success) {
        setCsrfToken(data.csrfToken); // [보안 강화 #5] 로그인 시 발급된 CSRF 토큰 저장
        // 로그인 후 바로 게시판으로 보내지 않고 메인 페이지로 이동 — 메인 페이지가 로그인 상태를 감지해서
        // 로그인 UI 대신 게시판/로그아웃 UI를 보여준다 (js/home.js).
        window.location.href = 'index.html';
    } else {
        showToast(data.message || '로그인 실패');
    }
});
