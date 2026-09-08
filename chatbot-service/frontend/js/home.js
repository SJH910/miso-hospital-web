// index.html 전용: 로그인 상태면 로그인 유도 UI 대신 게시판 바로가기/로그아웃 UI를 보여준다.

async function applyLoggedInState(me) {
    setCsrfToken(me.csrfToken); // 새로고침 등으로 토큰이 없을 경우를 대비해 /api/me에서도 재확보

    // 헤더 nav: "로그인" 버튼 자리에 사용자 이름 + 로그아웃 버튼을 넣는다.
    const navLoginBtn = document.getElementById('navLoginBtn');
    const userChip = document.createElement('span');
    userChip.className = 'user-chip';
    userChip.textContent = `${me.name}님`; // textContent만 사용 — 서버가 내려준 값이라도 innerHTML로 조립하지 않음

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'btn-logout';
    logoutBtn.textContent = '로그아웃';
    logoutBtn.addEventListener('click', async () => {
        await fetch(`${WAS_BASE}/api/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': getCsrfToken() },
        });
        window.location.href = 'index.html';
    });

    navLoginBtn.replaceWith(userChip, logoutBtn);
    document.getElementById('navSignupLink')?.remove();
    const isAdmin = me.role === 'admin';
    if (isAdmin) {
        document.getElementById('navAdminLink').style.display = '';
    } else {
        document.getElementById('chatWidget').style.display = 'block';
    }

    // 히어로 버튼: 로그인/회원가입 대신 게시판(관리자는 문서 스캔도) 바로가기
    const heroLoginBtn = document.getElementById('heroLoginBtn');
    heroLoginBtn.textContent = '진료문의 게시판으로 이동';
    heroLoginBtn.href = 'board.html';

    const heroSignupBtn = document.getElementById('heroSignupBtn');
    if (isAdmin) {
        heroSignupBtn.textContent = '문서 스캔 페이지로 이동';
        heroSignupBtn.href = 'admin.html';
    } else {
        heroSignupBtn.remove();
    }

    // 퀵링크 카드: "로그인"은 문의 작성 바로가기로, "회원가입" 자리는 관리자만 문서 스캔으로 교체
    // (기존 3번째 카드가 이미 "진료문의 게시판→내역 확인"이라, 여기서는 그것과 안 겹치게 "글쓰기"로 분리)
    document.getElementById('quicklinkLogin').href = 'board.html#inquiryForm';
    document.getElementById('quicklinkLoginTitle').textContent = '새 문의 작성';
    document.getElementById('quicklinkLoginDesc').textContent = '지금 바로 증상을 남겨보세요';

    const quicklinkSignup = document.getElementById('quicklinkSignup');
    if (isAdmin) {
        quicklinkSignup.href = 'admin.html';
        document.getElementById('quicklinkSignupTitle').textContent = '문서 스캔';
        document.getElementById('quicklinkSignupDesc').textContent = '진단서·처방전 이미지 텍스트 추출';
    } else {
        quicklinkSignup.remove();
    }
}

async function initHome() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) return; // 로그아웃 상태 — 기본 랜딩 화면(로그인 유도) 그대로 둔다
    const me = await res.json();
    applyLoggedInState(me);
}

initHome();
