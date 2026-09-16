// 로그인 후 화면이면 어디서나 같은 상단 nav를 쓰기 위한 공용 정의.
// 페이지마다 따로 하드코딩하면 메뉴가 추가/변경될 때마다 여러 파일을 일일이 고쳐야 하므로,
// 링크 목록을 여기 한 곳에서만 관리하고 각 페이지는 renderNavLinks(role)만 호출한다.
// roles: null이면 로그인만 되어 있으면 항상 노출, 배열이면 그 역할일 때만 노출.
const NAV_ITEMS = [
    { href: 'board.html', label: '진료문의 게시판', roles: null },
    { href: 'admin-reservations.html', label: '예약 관리', roles: ['admin', 'staff'] },
    // [2026-09-11] "문의 답변"은 상단 네비에서 빼고 board.html 안의 버튼으로 이동 -
    // admin-board.js 참고. staff는 board.html 진입 시 자동으로 admin-board.html로 보내지므로
    // (board.js의 loadUserInfo) 이 링크가 없어도 여전히 도달 가능.
    { href: 'admin-accounts.html', label: '계정 관리', roles: ['admin', 'staff'] },
    { href: 'reservation.html', label: '진료 예약', roles: ['patient'] },
    { href: 'records.html', label: '내 진료기록', roles: ['patient'] },
];

// [2026-09-11] admin만 쓰는 기능(다른 역할과 공유하지 않음)은 상단 네비에 계속 늘어놓지 않고,
// "{이름} 님" 위에 마우스를 올리면 뜨는 드롭다운으로 옮김 - staff와도 같이 쓰는 예약 관리/계정
// 관리는 그대로 상단 네비에 남겨둠(staff도 봐야 하는 링크라 드롭다운 뒤에 숨기면 안 됨).
const ADMIN_MENU_ITEMS = [
    { href: 'admin.html', label: '문서 스캔' },
    { href: 'admin-holidays.html', label: '휴진일 관리' },
    { href: 'admin-totp-setup.html', label: '로그인 보안' },
    { href: 'admin-audit-dashboard.html', label: '감사 로그' },
];

// [버그 수정 2026-09-16] 로그인 안 된 상태로 보호된 페이지(예: reservation.html)에 들어가면
// 각 페이지의 loadUserInfo()가 /api/me 401을 보고 login.html로 리다이렉트하는데, 그 상태에서
// 브라우저 "뒤로가기"를 누르면 브라우저가 페이지를 다시 요청하지 않고 bfcache(뒤로/앞으로
// 가기 캐시)에서 그대로 복원한다 - 리다이렉트를 일으켰던 스크립트가 다시 실행되지 않아서,
// 세션이 없는데도 로그인된 것처럼 보이는 페이지(예: 챗봇 위젯)가 그대로 뜬다. 이 상태로
// CSRF 토큰이 필요한 요청(예약 등)을 보내면 sessionStorage에 토큰이 없어 "유효하지 않은
// CSRF 토큰입니다"로 실패해서 원인을 알기 어려운 에러만 보게 됨(실사용 중 발견).
// pageshow의 event.persisted로 bfcache 복원을 감지해 loadUserInfo를 다시 실행한다 - 세션이
// 여전히 없으면 그제야 로그인 화면으로 보내진다. 각 페이지가 이미 최상위(전역 스코프)에
// loadUserInfo를 정의해두므로, 여기 한 곳에서만 재실행을 걸어주면 페이지마다 따로 안 고쳐도 됨.
window.addEventListener('pageshow', (event) => {
    if (event.persisted && typeof loadUserInfo === 'function') {
        loadUserInfo();
    }
});

// [XSS 방지] href/label은 이 파일에 고정된 값만 사용(외부 입력 없음) - textContent로만 대입.
function renderNavLinks(role) {
    const container = document.getElementById('navLinks');
    if (container) {
        container.innerHTML = '';
        NAV_ITEMS.forEach((item) => {
            if (item.roles && !item.roles.includes(role)) return;
            const a = document.createElement('a');
            a.href = item.href;
            a.textContent = item.label;
            container.appendChild(a);
        });
    }
    renderUserMenu(role);
}

// [2026-09-11] "{이름} 님"(#userInfo, 각 페이지의 loadUserInfo가 textContent로 먼저 채워둠) 위에
// 마우스를 올리면 admin 전용 메뉴가 드롭다운으로 뜨게 함. 드롭다운을 #userInfo의 자식으로 넣고
// CSS :hover로 보이게/숨기게 처리(style.css의 .user-chip.has-dropdown/.user-dropdown 참고) -
// 페이지 이동 없이 role이 바뀔 일은 없지만, 재호출 대비 기존 드롭다운은 항상 먼저 지우고 새로 만든다.
function renderUserMenu(role) {
    const userInfo = document.getElementById('userInfo');
    if (!userInfo) return;
    const existing = userInfo.querySelector('.user-dropdown');
    if (existing) existing.remove();
    userInfo.classList.remove('has-dropdown');
    if (role !== 'admin') return;

    userInfo.classList.add('has-dropdown');
    const dropdown = document.createElement('div');
    dropdown.className = 'user-dropdown';
    ADMIN_MENU_ITEMS.forEach((item) => {
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        dropdown.appendChild(a);
    });
    userInfo.appendChild(dropdown);
}
