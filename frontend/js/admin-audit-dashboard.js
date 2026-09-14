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

    document.getElementById('userInfo').textContent = `${me.name} 님`;
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

// [2026-09-14] 그동안 findings[]는 API 응답에 이미 있었는데(마스킹된 값 = masked_preview)
// 화면이 건수만 보여주고 버려서, "위험 로그가 마스킹 처리된 것을 확인" 항목을 시연할 방법이
// 없었음. 원문은 API도 절대 내려주지 않으므로(log_audit_tool.py scan_for_pii 참고)
// 여기서도 masked_preview(=마스킹 이후 값)만 표시 — 원문 노출 위험 없음.
function renderPiiFindingList(findings) {
    const details = document.createElement('details');
    details.className = 'pii-finding-list';

    const summary = document.createElement('summary');
    summary.textContent = `발견 내역 보기 (${findings.length}건)`;
    details.appendChild(summary);

    const ul = document.createElement('ul');
    findings.forEach((finding) => {
        const li = document.createElement('li');

        const time = document.createElement('span');
        time.className = 'pii-finding__time';
        time.textContent = formatDateTime(finding.timestamp);

        const field = document.createElement('span');
        field.className = 'pii-finding__field';
        field.textContent = finding.field;

        const preview = document.createElement('span');
        preview.className = 'pii-finding__preview';
        preview.textContent = finding.masked_preview;

        li.append(time, field, preview);

        if (finding.known_exception) {
            const badge = document.createElement('span');
            badge.className = 'pii-finding__badge';
            badge.textContent = '알려진 예외';
            li.appendChild(badge);
        }

        ul.appendChild(li);
    });
    details.appendChild(ul);
    return details;
}

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

        if (track.findings && track.findings.length > 0) {
            card.appendChild(renderPiiFindingList(track.findings));
        }

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

// [2026-09-14] GET /api/audit-log(페이지네이션+risk 필터)는 백엔드에 이미 있었는데 이걸 호출하는
// 화면이 없어서 "감사 로그 조회" 항목을 curl/DB 직접 조회로만 시연할 수 있었음. limit 상한이
// 100(auditLog.js)이라 전체를 한 번에 받아 클라이언트에서 자르는 방식(board.js 등과 동일한 패턴)
// 대신, 서버가 원래 의도한 대로 offset 기반으로 페이지씩 받아온다. 총 건수 API가 없어 번호형
// 페이지네이션은 못 만들고, 이번 페이지가 PAGE_SIZE만큼 꽉 찼는지로 "다음" 가능 여부만 판단한다.
const AUDIT_HISTORY_PAGE_SIZE = 20;
let auditHistoryOffset = 0;
let auditHistoryHasNext = false;

function renderAuditHistoryTable(rows) {
    const tbody = document.getElementById('auditHistoryList');
    const emptyState = document.getElementById('auditHistoryEmpty');
    tbody.innerHTML = '';
    emptyState.hidden = rows.length > 0;

    rows.forEach((row) => {
        const tr = document.createElement('tr');

        const timeTd = document.createElement('td');
        timeTd.className = 'col-date';
        timeTd.textContent = formatDateTime(row.created_at);

        const sevTd = document.createElement('td');
        const pill = document.createElement('span');
        const meta = SEVERITY_META[String(row.risk_level).toUpperCase()] || SEVERITY_META.NONE;
        pill.className = `status-pill severity-pill ${meta.className}`;
        pill.textContent = meta.label;
        sevTd.appendChild(pill);

        const actorTd = document.createElement('td');
        actorTd.textContent = row.actor_username || row.actor_id || '-';

        const actionTd = document.createElement('td');
        actionTd.textContent = row.action;

        const targetTd = document.createElement('td');
        targetTd.textContent = row.target_type ? `${row.target_type} #${row.target_id ?? '-'}` : '-';

        const detailTd = document.createElement('td');
        detailTd.textContent = row.detail ? JSON.stringify(row.detail) : '-';

        tr.append(timeTd, sevTd, actorTd, actionTd, targetTd, detailTd);
        tbody.appendChild(tr);
    });
}

function renderAuditHistoryPagination() {
    const container = document.getElementById('auditHistoryPagination');
    container.innerHTML = '';

    function makeButton(label, disabled, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.disabled = disabled;
        if (!disabled) btn.addEventListener('click', onClick);
        return btn;
    }

    const pageLabel = document.createElement('span');
    pageLabel.className = 'pagination__page-label';
    pageLabel.textContent = `페이지 ${Math.floor(auditHistoryOffset / AUDIT_HISTORY_PAGE_SIZE) + 1}`;

    container.appendChild(makeButton('‹ 이전', auditHistoryOffset === 0, () => {
        auditHistoryOffset = Math.max(0, auditHistoryOffset - AUDIT_HISTORY_PAGE_SIZE);
        loadAuditHistory();
    }));
    container.appendChild(pageLabel);
    container.appendChild(makeButton('다음 ›', !auditHistoryHasNext, () => {
        auditHistoryOffset += AUDIT_HISTORY_PAGE_SIZE;
        loadAuditHistory();
    }));
}

async function loadAuditHistory() {
    const risk = document.getElementById('auditRiskFilter').value;
    const params = new URLSearchParams({ limit: AUDIT_HISTORY_PAGE_SIZE, offset: auditHistoryOffset });
    if (risk) params.set('risk', risk);

    const res = await fetch(`${WAS_BASE}/api/audit-log?${params}`, { credentials: 'include' });
    if (!res.ok) {
        showToast('감사 로그 이력을 불러오지 못했습니다.');
        return;
    }
    const rows = await res.json();
    auditHistoryHasNext = rows.length === AUDIT_HISTORY_PAGE_SIZE;
    renderAuditHistoryTable(rows);
    renderAuditHistoryPagination();
}

document.getElementById('auditRiskFilter').addEventListener('change', () => {
    auditHistoryOffset = 0;
    loadAuditHistory();
});

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
    loadAuditHistory();
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
    await Promise.all([loadDashboard(), loadAuditHistory()]);
    setInterval(loadDashboard, AUTO_REFRESH_INTERVAL_MS);
})();
