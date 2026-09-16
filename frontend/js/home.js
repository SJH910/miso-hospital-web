// index.html 전용: 로그인 상태면 로그인 유도 UI 대신 게시판 바로가기/로그아웃 UI를 보여준다.

// 퀵링크 카드 아이콘(Lucide SVG, 정적 마크업이라 innerHTML로 교체해도 안전 - 사용자 입력 아님).
// 카드 자리(quicklinkLogin/quicklinkSignup)는 역할에 따라 용도가 바뀌므로 아이콘도 같이 바꿔야 의미가 맞는다.
const ICON_PEN_LINE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>';
const ICON_CALENDAR_CHECK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="m9 15 2 2 4-4"/></svg>';
const ICON_SCAN_TEXT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/></svg>';
const ICON_CALENDAR_CLOCK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 14v2.2l1.6 1"/><path d="M16 2v3"/><path d="M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338"/><path d="M3 9h5.859"/><path d="M8 2v3"/><circle cx="16" cy="16" r="6"/></svg>';

function setQuicklinkIcon(cardId, svg) {
    document.getElementById(cardId).querySelector('.quicklink-icon').innerHTML = svg;
}

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
        setQuicklinkIcon('quicklinkLogin', ICON_PEN_LINE);

        const quicklinkSignup = document.getElementById('quicklinkSignup');
        quicklinkSignup.href = 'admin-reservations.html';
        document.getElementById('quicklinkSignupTitle').textContent = '예약 관리';
        document.getElementById('quicklinkSignupDesc').textContent = '예약 요청을 확인하고 승인하기';
        setQuicklinkIcon('quicklinkSignup', ICON_CALENDAR_CLOCK);
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
    setQuicklinkIcon('quicklinkLogin', ICON_PEN_LINE);

    const quicklinkSignup = document.getElementById('quicklinkSignup');
    if (isAdmin) {
        quicklinkSignup.href = 'admin.html';
        document.getElementById('quicklinkSignupTitle').textContent = '문서 스캔';
        document.getElementById('quicklinkSignupDesc').textContent = '진단서·처방전 이미지 텍스트 추출';
        setQuicklinkIcon('quicklinkSignup', ICON_SCAN_TEXT);
    } else {
        quicklinkSignup.href = 'reservation.html';
        document.getElementById('quicklinkSignupTitle').textContent = '진료 예약';
        document.getElementById('quicklinkSignupDesc').textContent = '챗봇과 대화하며 예약하기';
        setQuicklinkIcon('quicklinkSignup', ICON_CALENDAR_CHECK);
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
