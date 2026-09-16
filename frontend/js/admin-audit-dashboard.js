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

// chatbot_sqlite(챗봇 서비스 자체 SQLite 로그)와 mysql_chat(WAS의 대화 이력 MySQL 테이블)은
// 같은 대화(환자 질문/챗봇 응답)를 각자 원문 그대로 한 번씩 더 저장하는 구조라 - 예전엔 이
// 둘을 별개 카드로 나눠서 보여줬더니 "발견 내역"이 사실상 같은 문장을 두 번 보여주는 것과
// 다름없었음(2026-09-16, 관리자 확인). 화면에서는 하나로 합치고, finding.source로 어느
// 저장소인지만 짧은 태그로 표시한다.
const PII_SOURCE_SHORT_LABELS = {
    chatbot_sqlite: 'SQLite',
    mysql_chat: 'MySQL',
};

// [2026-09-14] 그동안 findings[]는 API 응답에 이미 있었는데(마스킹된 값 = masked_preview)
// 화면이 건수만 보여주고 버려서, "위험 로그가 마스킹 처리된 것을 확인" 항목을 시연할 방법이
// 없었음. 원문은 API도 절대 내려주지 않으므로(log_audit_tool.py scan_for_pii 참고)
// 여기서도 masked_preview(=마스킹 이후 값)만 표시 — 원문 노출 위험 없음.
//
// [2026-09-16] finding 하나를 식별하는 키. timestamp만으로는 같은 밀리초에 두 건이 잡히면
// 충돌할 수 있어 source+field+masked_preview까지 합쳐 사실상 유일하게 만든다. 아래
// updatePiiScanCard의 증분 갱신(새로 생긴 항목만 append)이 "어디까지가 이미 그려진 항목인지"
// 판단하는 데 쓰인다.
function findingKey(finding) {
    return `${finding.source}|${finding.timestamp}|${finding.field}|${finding.masked_preview}`;
}

function appendFindingLi(ul, finding) {
    const li = document.createElement('li');
    li.dataset.key = findingKey(finding);

    const time = document.createElement('span');
    time.className = 'pii-finding__time';
    time.textContent = formatDateTime(finding.timestamp);

    const source = document.createElement('span');
    source.className = 'pii-finding__badge';
    source.textContent = PII_SOURCE_SHORT_LABELS[finding.source] || finding.source;

    const field = document.createElement('span');
    field.className = 'pii-finding__field';
    field.textContent = finding.field;

    const preview = document.createElement('span');
    preview.className = 'pii-finding__preview';
    preview.textContent = finding.masked_preview;

    li.append(time, source, field, preview);

    if (finding.known_exception) {
        const badge = document.createElement('span');
        badge.className = 'pii-finding__badge';
        badge.textContent = '알려진 예외';
        li.appendChild(badge);
    }

    ul.appendChild(li);
}

function renderPiiFindingList(findings) {
    const details = document.createElement('details');
    details.className = 'pii-finding-list';

    const summary = document.createElement('summary');
    summary.textContent = `발견 내역 보기 (${findings.length}건)`;
    details.appendChild(summary);

    const ul = document.createElement('ul');
    findings.forEach((finding) => appendFindingLi(ul, finding));
    details.appendChild(ul);
    return details;
}

// [2026-09-16] 10초마다 innerHTML=''로 통째로 다시 그리면 <details>의 열림 상태뿐 아니라
// 그 안 <ul>의 스크롤 위치까지 매번 초기화된다(Sunjung Hwang, 175f1ae) - 기존 DOM 노드를
// 그대로 두고 새로 생긴 <li>만 append하면 브라우저가 scrollTop을 알아서 유지해준다. 원래는
// track.source(칩bot_sqlite/mysql_chat)별 카드였는데, 두 저장소가 같은 대화를 원문 그대로
// 중복 저장하는 구조라 발견 내역이 사실상 같은 문장을 두 번 보여주는 것과 다름없어서(관리자
// 확인, 2026-09-16) "마스킹 실패"/"원문 저장 현황" 두 카드로 재설계했다 - source가 아니라
// 고정된 cardId로 기존 카드를 찾는다는 점만 다르고, 증분 갱신 로직 자체는 동일하다.
function updatePiiScanCard(container, cardId, { title, description, tone, found, findings }) {
    let card = container.querySelector(`.pii-scan-card[data-card-id="${cardId}"]`);

    if (!card) {
        card = document.createElement('div');
        card.className = 'pii-scan-card';
        card.dataset.cardId = cardId;

        const titleEl = document.createElement('div');
        titleEl.className = 'pii-scan-card__title';
        titleEl.textContent = title;

        const desc = document.createElement('p');
        desc.style.cssText = 'color:#6b7785; font-size:12.5px; margin:2px 0 10px;';
        desc.textContent = description;

        const stats = document.createElement('div');
        stats.className = 'pii-scan-card__stats';

        const foundEl = document.createElement('span');
        foundEl.className = 'pii-scan-card__found';

        stats.appendChild(foundEl);
        card.append(titleEl, desc, stats);
        container.appendChild(card);
    }

    const foundEl = card.querySelector('.pii-scan-card__found');
    const isBad = tone === 'bad' && found > 0;
    foundEl.className = isBad ? 'pii-scan-card__found' : 'pii-scan-card__found pii-scan-card__found--zero';
    foundEl.textContent = `발견 ${found}건`;

    if (!findings || findings.length === 0) {
        const existingDetails = card.querySelector('details.pii-finding-list');
        if (existingDetails) existingDetails.remove();
        return;
    }

    const existingDetails = card.querySelector('details.pii-finding-list');
    if (!existingDetails) {
        card.appendChild(renderPiiFindingList(findings));
        return;
    }

    const ul = existingDetails.querySelector('ul');
    const existingKeys = Array.from(ul.querySelectorAll('li')).map((li) => li.dataset.key);
    const newKeys = findings.map(findingKey);
    const overlapMatches = existingKeys.every((key, i) => key === newKeys[i]);

    if (overlapMatches && newKeys.length >= existingKeys.length) {
        // 기존 항목은 그대로 두고 뒤에 새로 생긴 것만 추가 - <ul> 노드 자체를 안 건드리므로
        // 열림/스크롤 상태가 자연히 유지된다.
        for (let i = existingKeys.length; i < findings.length; i++) {
            appendFindingLi(ul, findings[i]);
        }
    } else if (!overlapMatches) {
        // 순서/내용이 어긋난 예외적인 경우(정상 흐름에서는 발생하지 않음)에만 통째로 다시
        // 그리되, 열려있던 상태만이라도 보존한다.
        const wasOpen = existingDetails.open;
        const rebuilt = renderPiiFindingList(findings);
        rebuilt.open = wasOpen;
        existingDetails.replaceWith(rebuilt);
        return;
    }

    existingDetails.querySelector('summary').textContent = `발견 내역 보기 (${findings.length}건)`;
}

// [2026-09-16 재설계] "발견"을 두 종류로 나눠서 보여준다 - masking_failures(masked_text처럼
// 저장 전에 이미 마스킹됐어야 할 필드에서 발견 = 진짜 마스킹 버그)를 앞에 강조해서 보여주고,
// raw_storage_findings(original/response/content처럼 애초에 마스킹 대상이 아니고 암호화로만
// 보호되는 필드에서 발견 = 정상 상태)는 참고용으로 톤을 낮춰 보여준다. 이 구분이 없으면
// 발견 건수 대부분이 후자로 채워져서 진짜 버그가 그 안에 묻힌다.
function renderPiiScanRow(piiScan) {
    const container = document.getElementById('piiScanRow');
    if (!piiScan) {
        container.innerHTML = '';
        return;
    }

    let scannedNote = container.querySelector('.pii-scan-scanned-note');
    if (!scannedNote) {
        scannedNote = document.createElement('p');
        scannedNote.className = 'pii-scan-scanned-note';
        scannedNote.style.cssText = 'color:#97a1ac; font-size:12.5px; margin:0 0 10px;';
        container.insertBefore(scannedNote, container.firstChild);
    }
    scannedNote.textContent = `SQLite + MySQL 통합 스캔 ${piiScan.scanned}건`;

    updatePiiScanCard(container, 'masking_failures', {
        title: '마스킹 실패',
        description: '저장 전 이미 마스킹됐어야 할 텍스트에 PII가 남아있는 경우 — 조치가 필요합니다.',
        tone: 'bad',
        found: piiScan.masking_failures.found,
        findings: piiScan.masking_failures.findings,
    });
    updatePiiScanCard(container, 'raw_storage_findings', {
        title: '원문 저장 현황',
        description: '암호화로만 보호되는 원문 저장 필드 — 애초에 마스킹 대상이 아니라 발견돼도 정상입니다.',
        tone: 'neutral',
        found: piiScan.raw_storage_findings.found,
        findings: piiScan.raw_storage_findings.findings,
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
    const category = document.getElementById('auditCategoryFilter').value;
    // datetime-local의 value는 초 단위까지 포함된 지역시각 문자열(예: "2026-09-15T17:03:05") -
    // new Date()가 브라우저/서버(같은 시스템 타임존 가정) 양쪽에서 동일하게 지역시각으로
    // 해석하므로 타임존 변환 없이 그대로 보낸다.
    const from = document.getElementById('auditFromFilter').value;
    const to = document.getElementById('auditToFilter').value;
    const params = new URLSearchParams({ limit: AUDIT_HISTORY_PAGE_SIZE, offset: auditHistoryOffset });
    if (risk) params.set('risk', risk);
    if (category) params.set('category', category);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

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

document.getElementById('auditCategoryFilter').addEventListener('change', () => {
    auditHistoryOffset = 0;
    loadAuditHistory();
});

document.getElementById('auditFromFilter').addEventListener('change', () => {
    auditHistoryOffset = 0;
    loadAuditHistory();
});

document.getElementById('auditToFilter').addEventListener('change', () => {
    auditHistoryOffset = 0;
    loadAuditHistory();
});

document.getElementById('auditTimeFilterClear').addEventListener('click', () => {
    document.getElementById('auditFromFilter').value = '';
    document.getElementById('auditToFilter').value = '';
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
    renderPiiScanRow(data.pii_scan);
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
