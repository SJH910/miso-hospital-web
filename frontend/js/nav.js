// 로그인 후 화면이면 어디서나 같은 상단 nav를 쓰기 위한 공용 정의.
// 페이지마다 따로 하드코딩하면 메뉴가 추가/변경될 때마다 여러 파일을 일일이 고쳐야 하므로,
// 링크 목록을 여기 한 곳에서만 관리하고 각 페이지는 renderNavLinks(role)만 호출한다.
// roles: null이면 로그인만 되어 있으면 항상 노출, 배열이면 그 역할일 때만 노출.
const NAV_ITEMS = [
    { href: 'board.html', label: '진료문의 게시판', roles: null },
    { href: 'admin.html', label: '문서 스캔', roles: ['admin'] },
    { href: 'admin-holidays.html', label: '휴진일 관리', roles: ['admin'] },
    { href: 'admin-reservations.html', label: '예약 관리', roles: ['admin', 'staff'] },
    // [2026-09-11] "문의 답변"은 상단 네비에서 빼고 board.html 안의 버튼으로 이동 -
    // admin-board.js 참고. staff는 board.html 진입 시 자동으로 admin-board.html로 보내지므로
    // (board.js의 loadUserInfo) 이 링크가 없어도 여전히 도달 가능.
    { href: 'admin-accounts.html', label: '계정 관리', roles: ['admin', 'staff'] },
    { href: 'admin-totp-setup.html', label: '로그인 보안', roles: ['admin'] },
    { href: 'reservation.html', label: '진료 예약', roles: ['patient'] },
    { href: 'records.html', label: '내 진료기록', roles: ['patient'] },
];

// [XSS 방지] href/label은 이 파일에 고정된 값만 사용(외부 입력 없음) - textContent로만 대입.
function renderNavLinks(role) {
    const container = document.getElementById('navLinks');
    if (!container) return;
    container.innerHTML = '';
    NAV_ITEMS.forEach((item) => {
        if (item.roles && !item.roles.includes(role)) return;
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.label;
        container.appendChild(a);
    });
}
