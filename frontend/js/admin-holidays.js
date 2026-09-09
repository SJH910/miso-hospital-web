const holidayList = document.getElementById('holidayList');

// 별도 페이지로 분리되면서 admin.js가 로드되지 않으니, 로그인/관리자 검증을 이 파일이 직접 담당한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    // 서버(holidays.js의 requirePermission)가 실제 권한 검사를 하지만, 관리자가 아닌 사용자가
    // 이 화면에 잘못 들어왔을 때 빈 화면 대신 안내 후 돌려보내기 위한 프론트단 보조 체크
    if (me.role !== 'admin') {
        showToast('관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님 (관리자)`;
    renderNavLinks(me.role);
}

// [XSS 방지] textContent만 사용
function renderHolidayRow(holiday) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${holiday.holiday_date} - ${holiday.reason}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '삭제';
    deleteBtn.className = 'btn-logout';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.addEventListener('click', () => deleteHoliday(holiday.id));

    li.append(label, deleteBtn);
    holidayList.appendChild(li);
}

async function loadHolidays() {
    const res = await fetch(`${WAS_BASE}/api/holidays`, { credentials: 'include' });
    if (!res.ok) return;
    const holidays = await res.json();
    holidayList.innerHTML = '';
    holidays.forEach(renderHolidayRow);
}

async function deleteHoliday(id) {
    const res = await fetch(`${WAS_BASE}/api/holidays/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '삭제에 실패했습니다.');
        return;
    }
    loadHolidays();
}

document.getElementById('addHolidayButton').addEventListener('click', async () => {
    const holiday_date = document.getElementById('holidayDate').value;
    const reason = document.getElementById('holidayReason').value.trim();
    if (!holiday_date || !reason) {
        showToast('날짜와 사유를 모두 입력해주세요.');
        return;
    }

    const res = await fetch(`${WAS_BASE}/api/holidays`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ holiday_date, reason }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '등록에 실패했습니다.');
        return;
    }

    document.getElementById('holidayDate').value = '';
    document.getElementById('holidayReason').value = '';
    loadHolidays();
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
loadHolidays();
