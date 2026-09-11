// index.html 전용: 로그인 상태면 로그인 유도 UI 대신 게시판 바로가기/로그아웃 UI를 보여준다.

async function applyLoggedInState(me) {
    setCsrfToken(me.csrfToken); // 새로고침 등으로 토큰이 없을 경우를 대비해 /api/me에서도 재확보

    // 헤더 nav: "로그인" 버튼 자리에 사용자 이름 + 로그아웃 버튼을 넣는다.
    const navLoginBtn = document.getElementById('navLoginBtn');
    const userChip = document.createElement('span');
    userChip.id = 'userInfo'; // nav.js의 renderUserMenu()가 이 id로 admin 드롭다운을 붙임 - 다른 페이지는 다 정적 <span id="userInfo">가 있는데 이 페이지만 동적 생성이라 빠져있었음
    userChip.className = 'user-chip';
    userChip.textContent = `${me.name} 님`; // textContent만 사용 — 서버가 내려준 값이라도 innerHTML로 조립하지 않음

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
    renderNavLinks(me.role);
    const isAdmin = me.role === 'admin';
    const isStaff = me.role === 'staff';
    if (!isAdmin && !isStaff) {
        document.getElementById('chatWidget').style.display = 'block';
    }

    // staff는 이 페이지가 다루는 "환자용 랜딩(문의 등록/히어로/퀵링크)"의 대상이 아니므로,
    // 관리 화면으로 바로 안내하고 나머지(히어로/퀵링크 문구 교체)는 건드리지 않는다.
    if (isStaff) {
        const heroLoginBtn = document.getElementById('heroLoginBtn');
        heroLoginBtn.textContent = '문의 답변으로 이동';
        heroLoginBtn.href = 'admin-board.html';

        const heroSignupBtn = document.getElementById('heroSignupBtn');
        heroSignupBtn.textContent = '예약 관리로 이동';
        heroSignupBtn.href = 'admin-reservations.html';

        document.getElementById('quicklinkLogin').href = 'admin-board.html';
        document.getElementById('quicklinkLoginTitle').textContent = '문의 답변';
        document.getElementById('quicklinkLoginDesc').textContent = '환자 문의를 확인하고 답변하기';

        const quicklinkSignup = document.getElementById('quicklinkSignup');
        quicklinkSignup.href = 'admin-reservations.html';
        document.getElementById('quicklinkSignupTitle').textContent = '예약 관리';
        document.getElementById('quicklinkSignupDesc').textContent = '예약 요청을 확인하고 승인하기';
        return;
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
        // 로그아웃 상태에서 "회원가입" 버튼이던 자리를 환자에게는 "진료 예약하기"로 재활용
        heroSignupBtn.textContent = '진료 예약하기';
        heroSignupBtn.href = 'reservation.html';
    }

    // 퀵링크 카드: "로그인"은 문의 작성 바로가기로, "회원가입" 자리는 관리자는 문서 스캔,
    // 환자는 진료 예약으로 교체 (기존엔 환자일 때 이 카드를 통째로 지웠었음)
    document.getElementById('quicklinkLogin').href = 'board.html#inquiryForm';
    document.getElementById('quicklinkLoginTitle').textContent = '새 문의 작성';
    document.getElementById('quicklinkLoginDesc').textContent = '지금 바로 증상을 남겨보세요';

    const quicklinkSignup = document.getElementById('quicklinkSignup');
    if (isAdmin) {
        quicklinkSignup.href = 'admin.html';
        document.getElementById('quicklinkSignupTitle').textContent = '문서 스캔';
        document.getElementById('quicklinkSignupDesc').textContent = '진단서·처방전 이미지 텍스트 추출';
    } else {
        quicklinkSignup.href = 'reservation.html';
        document.getElementById('quicklinkSignupTitle').textContent = '진료 예약';
        document.getElementById('quicklinkSignupDesc').textContent = '챗봇과 대화하며 예약하기';
    }
}

async function initHome() {
    // 로그인 여부와 무관하게 "진료문의 게시판"(roles:null 항목)은 항상 보여야 하므로,
    // 로그인 상태 확인 전에 role 없이 한 번 먼저 그려둔다.
    renderNavLinks(null);

    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) return; // 로그아웃 상태 — 기본 랜딩 화면(로그인 유도) 그대로 둔다
    const me = await res.json();
    applyLoggedInState(me);
}

initHome();
