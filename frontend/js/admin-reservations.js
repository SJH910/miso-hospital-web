const reservationList = document.getElementById('reservationList');
const emptyState = document.getElementById('emptyState');

// 별도 페이지라 admin.js가 로드되지 않으므로 로그인/권한 검증을 이 파일이 직접 담당한다.
// 서버(reservations.js의 requirePermission("reservations:manage"))가 실제 접근 제어를 하고,
// 여기서는 staff/admin이 아닌 사용자가 잘못 들어왔을 때 안내 후 돌려보내는 프론트단 보조 체크만 한다.
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

    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님`;
    renderNavLinks(me.role);
}

function formatDateTime(isoString) {
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 상태별 행 강조색·배지·버튼 문구를 한 곳에서 관리 - 세 상태가 화면에서 뚜렷이 구분되도록
// (요청됨=주의를 끄는 노란 계열, 확정됨=초록, 취소됨=회색+취소선).
const STATUS_META = {
    requested: { label: '신규 요청', pillClass: 'status-pill--requested', rowClass: 'status-row--requested' },
    confirmed: { label: '확정됨', pillClass: 'status-pill--confirmed', rowClass: 'status-row--confirmed' },
    cancelled: { label: '취소됨', pillClass: 'status-pill--cancelled', rowClass: 'status-row--cancelled' },
};

// [XSS 방지] textContent만 사용 -> 서버 값(환자명/진료과 등)을 그대로 마크업으로 조립하지 않는다.
function renderReservationRow(reservation) {
    const tr = document.createElement('tr');
    const meta = STATUS_META[reservation.status] || STATUS_META.requested;
    tr.classList.add(meta.rowClass);

    const patientTd = document.createElement('td');
    patientTd.textContent = reservation.patient_name;

    const deptTd = document.createElement('td');
    deptTd.textContent = reservation.department;

    const whenTd = document.createElement('td');
    whenTd.textContent = formatDateTime(reservation.reserved_at);

    const statusTd = document.createElement('td');
    statusTd.className = 'col-no-strike';
    const pill = document.createElement('span');
    pill.className = `status-pill ${meta.pillClass}`;
    pill.textContent = meta.label;
    statusTd.appendChild(pill);

    const actionTd = document.createElement('td');
    actionTd.className = 'col-no-strike';

    const isConfirmed = reservation.status === 'confirmed';
    const isCancelled = reservation.status === 'cancelled';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-action btn-action--confirm';
    confirmBtn.textContent = isConfirmed ? '✓ 승인됨' : '승인';
    confirmBtn.disabled = isConfirmed;
    confirmBtn.addEventListener('click', () => updateStatus(reservation.id, 'confirmed'));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-action btn-action--cancel';
    cancelBtn.textContent = isCancelled ? '취소됨' : '취소';
    cancelBtn.disabled = isCancelled;
    cancelBtn.addEventListener('click', () => updateStatus(reservation.id, 'cancelled'));

    actionTd.append(confirmBtn, cancelBtn);
    tr.append(patientTd, deptTd, whenTd, statusTd, actionTd);
    reservationList.appendChild(tr);
}

async function loadReservations() {
    const res = await fetch(`${WAS_BASE}/api/reservations`, { credentials: 'include' });
    if (!res.ok) return;
    const reservations = await res.json();
    reservationList.innerHTML = '';
    emptyState.hidden = reservations.length > 0;
    reservations.forEach(renderReservationRow);
}

async function updateStatus(id, status) {
    const res = await fetch(`${WAS_BASE}/api/reservations/${id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ status }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '처리에 실패했습니다.');
        return;
    }

    showToast(status === 'confirmed' ? '예약을 승인했습니다.' : '예약을 취소했습니다.', 'success');
    loadReservations();
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${WAS_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    window.location.href = 'index.html';
});

loadUserInfo();
loadReservations();
