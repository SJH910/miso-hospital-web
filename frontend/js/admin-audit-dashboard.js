// 별도 페이지라 admin.js가 로드되지 않으므로 로그인/권한 검증을 이 파일이 직접 담당한다.
// 서버(GET /api/audit-log/summary의 requirePermission("audit:view"))가 실제 접근 제어를 하고,
// 여기서는 admin이 아닌 사용자가 잘못 들어왔을 때 안내 후 돌려보내는 프론트단 보조 체크만 한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    if (me.role !== 'admin') {
        showToast('관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `${me.name}님`;
    renderNavLinks(me.role);
}

const SEVERITY_META = {
    CRITICAL: { label: 'Critical', className: 'sev-critical' },
    HIGH: { label: 'High', className: 'sev-high' },
    MEDIUM: { label: 'Medium', className: 'sev-medium' },
    LOW: { label: 'Low', className: 'sev-low' },
    NONE: { label: 'None', className: 'sev-none' },
};

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return String(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [XSS 방지] 서버 값을 조립할 때 innerHTML 대신 DOM API + textContent만 사용.
function renderKpiRow(tracks) {
    const totals = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    let grandTotal = 0;
    tracks.forEach((track) => {
        totals.CRITICAL += track.summary.critical || 0;
        totals.HIGH += track.summary.high || 0;
        totals.MEDIUM += track.summary.medium || 0;
        totals.LOW += track.summary.low || 0;
        grandTotal += track.total || 0;
    });

    const container = document.getElementById('kpiRow');
    container.innerHTML = '';
    ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].forEach((level) => {
        const meta = SEVERITY_META[level];
        const tile = document.createElement('div');
        tile.className = `kpi-tile ${meta.className}`;

        const count = document.createElement('div');
        count.className = 'kpi-tile__count';
        count.textContent = totals[level];

        const label = document.createElement('div');
        label.className = 'kpi-tile__label';
        label.textContent = meta.label;

        tile.append(count, label);
        container.appendChild(tile);
    });

    const totalTile = document.createElement('div');
    totalTile.className = 'kpi-tile sev-total';
    const totalCount = document.createElement('div');
    totalCount.className = 'kpi-tile__count';
    totalCount.textContent = grandTotal;
    const totalLabel = document.createElement('div');
    totalLabel.className = 'kpi-tile__label';
    totalLabel.textContent = '전체 이벤트';
    totalTile.append(totalCount, totalLabel);
    container.appendChild(totalTile);
}

function renderNotableTable(tracks) {
    const tbody = document.getElementById('notableList');
    const emptyState = document.getElementById('notableEmpty');
    tbody.innerHTML = '';

    const notable = tracks
        .flatMap((track) => track.notable || [])
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    emptyState.hidden = notable.length > 0;

    notable.forEach((item) => {
        const tr = document.createElement('tr');

        const sevTd = document.createElement('td');
        const pill = document.createElement('span');
        const meta = SEVERITY_META[item.severity] || SEVERITY_META.NONE;
        pill.className = `status-pill severity-pill ${meta.className}`;
        pill.textContent = meta.label;
        sevTd.appendChild(pill);

        const sourceTd = document.createElement('td');
        sourceTd.textContent = item.source;

        const timeTd = document.createElement('td');
        timeTd.className = 'col-date';
        timeTd.textContent = formatDateTime(item.timestamp);

        const actorTd = document.createElement('td');
        actorTd.textContent = item.actor_id ?? '-';

        const actionTd = document.createElement('td');
        actionTd.textContent = item.action + (item.escalated ? ' (관리자 침해 정황으로 승격)' : '');

        tr.append(sevTd, sourceTd, timeTd, actorTd, actionTd);
        tbody.appendChild(tr);
    });
}

const PII_SOURCE_LABELS = {
    chatbot_sqlite: '챗봇 대화 로그 (SQLite)',
    mysql_chat: '진료 예약 챗봇 대화 (MySQL)',
};

function renderPiiScanRow(piiScanTrack) {
    const container = document.getElementById('piiScanRow');
    container.innerHTML = '';

    piiScanTrack.forEach((track) => {
        const card = document.createElement('div');
        card.className = 'pii-scan-card';

        const title = document.createElement('div');
        title.className = 'pii-scan-card__title';
        title.textContent = PII_SOURCE_LABELS[track.source] || track.source;

        const stats = document.createElement('div');
        stats.className = 'pii-scan-card__stats';

        const scanned = document.createElement('span');
        scanned.textContent = `스캔 ${track.scanned}건`;

        const found = document.createElement('span');
        found.className = track.found > 0 ? 'pii-scan-card__found' : 'pii-scan-card__found pii-scan-card__found--zero';
        found.textContent = `발견 ${track.found}건`;

        stats.append(scanned, found);
        card.append(title, stats);
        container.appendChild(card);
    });
}

function renderStaticFindings(findings) {
    const container = document.getElementById('staticFindingsList');
    const emptyState = document.getElementById('staticFindingsEmpty');
    container.innerHTML = '';
    emptyState.hidden = findings.length > 0;

    findings.forEach((finding) => {
        const card = document.createElement('div');
        card.className = 'panel inquiry-card';

        const meta = SEVERITY_META[finding.severity] || SEVERITY_META.NONE;
        const pill = document.createElement('span');
        pill.className = `status-pill severity-pill ${meta.className}`;
        pill.textContent = meta.label;

        const title = document.createElement('h4');
        title.style.margin = '10px 0 4px';
        title.textContent = finding.category;

        const location = document.createElement('p');
        location.className = 'inquiry-card__meta';
        location.textContent = finding.location;

        const summary = document.createElement('p');
        summary.className = 'inquiry-card__content';
        summary.textContent = finding.summary;

        const remediation = document.createElement('p');
        remediation.className = 'inquiry-card__content';
        remediation.style.color = 'var(--accent)';
        remediation.textContent = `개선 방향: ${finding.remediation}`;

        card.append(pill, title, location, summary, remediation);
        container.appendChild(card);
    });
}

async function loadDashboard() {
    const res = await fetch(`${WAS_BASE}/api/audit-log/summary`, { credentials: 'include' });
    if (!res.ok) {
        showToast('감사 로그를 불러오지 못했습니다.');
        return;
    }
    const data = await res.json();

    const errorBanner = document.getElementById('chatbotErrorBanner');
    if (data.chatbot_error) {
        errorBanner.textContent = `⚠️ ${data.chatbot_error} — 로그인 이상탐지 데이터만 표시됩니다.`;
        errorBanner.hidden = false;
    } else {
        errorBanner.hidden = true;
    }

    renderKpiRow(data.risk_level_tracks);
    renderNotableTable(data.risk_level_tracks);
    renderPiiScanRow(data.pii_scan_track);
    renderStaticFindings(data.static_findings);

    document.getElementById('generatedAt').textContent = `조회 시각: ${formatDateTime(data.generated_at)}`;
}

document.getElementById('refreshButton').addEventListener('click', () => {
    loadDashboard();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${WAS_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    window.location.href = 'index.html';
});

const AUTO_REFRESH_INTERVAL_MS = 10000;

(async function init() {
    await loadUserInfo();
    await loadDashboard();
    setInterval(loadDashboard, AUTO_REFRESH_INTERVAL_MS);
})();
