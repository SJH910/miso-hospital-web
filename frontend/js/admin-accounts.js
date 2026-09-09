const accountList = document.getElementById('accountList');
const accountListSection = document.getElementById('accountListSection');

let myId = null;

// 별도 페이지라 board.js/admin.js가 로드되지 않으므로 로그인/권한 검증을 이 파일이 직접 담당한다.
// 서버(accounts.js의 requirePermission)가 실제 접근 제어를 하고, 여기서는 staff/admin이
// 아닌 사용자가 잘못 들어왔을 때 안내 후 돌려보내는 프론트단 보조 체크 + 화면 구성만 한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    if (me.role !== 'staff' && me.role !== 'admin') {
        showToast('원무/관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    myId = me.id;
    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님`;
    renderNavLinks(me.role);

    // 전체 계정 목록 + 역할 변경(accounts:manage)은 admin 전용.
    // staff는 위 "환자 등록"(patients:register) 섹션만 사용한다.
    if (me.role === 'admin') {
        accountListSection.style.display = '';
        loadAccounts();
    }
}

const ROLE_LABELS = { patient: '환자', staff: '원무/접수', admin: '관리자' };

// [XSS 방지] innerHTML 대신 DOM API + textContent만 사용.
function renderAccountRow(account) {
    const tr = document.createElement('tr');

    const usernameTd = document.createElement('td');
    usernameTd.textContent = account.username;

    const nameTd = document.createElement('td');
    nameTd.textContent = account.name;

    const roleTd = document.createElement('td');
    roleTd.textContent = ROLE_LABELS[account.role] || account.role;

    const actionTd = document.createElement('td');
    const isSelf = account.id === myId;

    if (isSelf) {
        const label = document.createElement('span');
        label.style.color = '#6b7785';
        label.textContent = '본인 계정';
        actionTd.appendChild(label);
    } else {
        const select = document.createElement('select');
        for (const [value, label] of Object.entries(ROLE_LABELS)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            if (value === account.role) option.selected = true;
            select.appendChild(option);
        }

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn-primary';
        applyBtn.style.cssText = 'width:auto; padding:6px 14px; margin-left:8px;';
        applyBtn.textContent = '변경';
        applyBtn.addEventListener('click', () => changeRole(account.id, select.value, applyBtn));

        actionTd.append(select, applyBtn);
    }

    tr.append(usernameTd, nameTd, roleTd, actionTd);
    accountList.appendChild(tr);
}

async function loadAccounts() {
    const res = await fetch(`${WAS_BASE}/api/accounts`, { credentials: 'include' });
    if (!res.ok) return;
    const accounts = await res.json();
    accountList.innerHTML = '';
    accounts.forEach(renderAccountRow);
}

async function changeRole(id, role, button) {
    button.disabled = true;
    try {
        const res = await fetch(`${WAS_BASE}/api/accounts/${id}/role`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken(),
            },
            credentials: 'include',
            body: JSON.stringify({ role }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.message || '역할 변경에 실패했습니다.');
            return;
        }

        showToast('역할을 변경했습니다.', 'success');
        loadAccounts();
    } finally {
        button.disabled = false;
    }
}

document.getElementById('registerButton').addEventListener('click', async () => {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const name = document.getElementById('regName').value.trim();
    const rrn = document.getElementById('regRrn').value.trim();

    if (!username || !password || !name || !rrn) {
        showToast('모든 항목을 입력해주세요.');
        return;
    }

    const res = await fetch(`${WAS_BASE}/api/accounts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ username, password, name, rrn }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '등록에 실패했습니다.');
        return;
    }

    showToast('환자 계정을 등록했습니다.', 'success');
    document.getElementById('regUsername').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('regName').value = '';
    document.getElementById('regRrn').value = '';

    // admin이면 방금 등록한 계정이 전체 목록에도 바로 반영되도록 갱신
    if (accountListSection.style.display !== 'none') loadAccounts();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${WAS_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    window.location.href = 'index.html';
});

loadUserInfo();
