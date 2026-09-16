// 별도 페이지로 분리되면서 admin.js가 로드되지 않으니, 로그인/관리자 검증을 이 파일이 직접 담당한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        const here = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
        window.location.href = `login.html?redirect=${here}`;
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    // 서버(ipBlocklist.js의 requirePermission("security:manage"))가 실제 권한 검사를 하지만,
    // 권한 없는 사용자가 이 화면에 잘못 들어왔을 때 빈 화면 대신 안내 후 돌려보내기 위한
    // 프론트단 보조 체크.
    if (me.role !== 'admin') {
        showToast('관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `${me.name} 님`;
    renderNavLinks(me.role);
}

function formatDateTime(isoString) {
    if (!isoString) return '영구';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [XSS 방지] textContent만 사용
function renderBlockRow(block) {
    const tbody = document.getElementById('blockList');
    const tr = document.createElement('tr');

    const ipTd = document.createElement('td');
    ipTd.textContent = block.ip;

    const reasonTd = document.createElement('td');
    reasonTd.textContent = block.reason || '-';

    const byTd = document.createElement('td');
    byTd.textContent = block.blocked_by_username || '-';

    const atTd = document.createElement('td');
    atTd.className = 'col-date';
    atTd.textContent = formatDateTime(block.blocked_at);

    const expiresTd = document.createElement('td');
    expiresTd.textContent = formatDateTime(block.expires_at);

    const actionTd = document.createElement('td');
    const unblockBtn = document.createElement('button');
    unblockBtn.type = 'button';
    unblockBtn.textContent = '해제';
    unblockBtn.className = 'btn-logout';
    unblockBtn.addEventListener('click', () => unblockIp(block.id));
    actionTd.appendChild(unblockBtn);

    tr.append(ipTd, reasonTd, byTd, atTd, expiresTd, actionTd);
    tbody.appendChild(tr);
}

async function loadBlocklist() {
    const res = await fetch(`${WAS_BASE}/api/ip-blocklist`, { credentials: 'include' });
    if (!res.ok) return;
    const blocks = await res.json();
    const tbody = document.getElementById('blockList');
    tbody.innerHTML = '';
    document.getElementById('blockListEmpty').hidden = blocks.length > 0;
    blocks.forEach(renderBlockRow);
}

async function unblockIp(id) {
    const res = await fetch(`${WAS_BASE}/api/ip-blocklist/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '해제에 실패했습니다.');
        return;
    }
    showToast('차단을 해제했습니다.');
    loadBlocklist();
}

document.getElementById('addBlockButton').addEventListener('click', async () => {
    const ip = document.getElementById('blockIp').value.trim();
    const reason = document.getElementById('blockReason').value.trim();
    const duration = document.getElementById('blockDuration').value;
    if (!ip) {
        showToast('IP 주소를 입력해주세요.');
        return;
    }

    const res = await fetch(`${WAS_BASE}/api/ip-blocklist`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ ip, reason, duration }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '차단에 실패했습니다.');
        return;
    }

    showToast('IP를 차단했습니다.');
    document.getElementById('blockIp').value = '';
    document.getElementById('blockReason').value = '';
    loadBlocklist();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${WAS_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    window.location.href = 'index.html';
});

(async function init() {
    await loadUserInfo();
    // [2026-09-16] 감사 대시보드의 "차단" 버튼(admin-audit-dashboard.js)이 ?ip=<주소>로
    // 넘어오면 입력창에 미리 채워준다 - 사고 대응 흐름(이벤트 확인 → 바로 차단)을 한 번의
    // 이동으로 이어지게 하기 위함.
    const prefillIp = new URLSearchParams(window.location.search).get('ip');
    if (prefillIp) {
        document.getElementById('blockIp').value = prefillIp;
        document.getElementById('blockReason').focus();
    }
    loadBlocklist();
})();
