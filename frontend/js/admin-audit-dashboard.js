// 별도 페이지라 admin.js가 로드되지 않으므로 로그인/권한 검증을 이 파일이 직접 담당한다.
// 서버(GET /api/audit-log/summary의 requirePermission("audit:view"))가 실제 접근 제어를 하고,
// 여기서는 admin이 아닌 사용자가 잘못 들어왔을 때 안내 후 돌려보내는 프론트단 보조 체크만 한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        // [2026-09-16] Discord 알림 링크(?event=<id> 포함)로 로그인 없이 들어온 경우, 로그인만
        // 시키고 홈으로 보내버리면 다시 대시보드를 찾아 들어가야 한다 - 현재 위치(쿼리 포함)를
        // ?redirect=로 실어 보내 로그인 후 원래 보려던 화면(+이벤트)으로 정확히 돌아오게 한다.
        const here = encodeURIComponent(window.location.pathname.split('/').pop() + window.location.search);
        window.location.href = `login.html?redirect=${here}`;
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
        // Discord 알림 링크(?event=<record_id>&source=<source>)로 들어왔을 때 해당 행을
        // 찾아 강조하기 위함 - mysql_audit(WAS)/audit_jsonl(챗봇) 두 source가 섞여 있어
        // record_id만으로는 구분 안 되므로 source까지 같이 심어둔다.
        if (item.record_id !== undefined && item.record_id !== null) {
            tr.dataset.id = item.record_id;
            tr.dataset.source = item.source;
        }

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
//
// [2026-09-16] finding 하나를 식별하는 키. timestamp만으로는 같은 밀리초에 두 건이 잡히면
// 충돌할 수 있어 field+masked_preview까지 합쳐 사실상 유일하게 만든다. 아래 renderPiiScanRow의
// 증분 갱신(새로 생긴 항목만 append)이 "어디까지가 이미 그려진 항목인지" 판단하는 데 쓰인다.
function findingKey(finding) {
    return `${finding.timestamp}|${finding.field}|${finding.masked_preview}`;
}

function appendFindingLi(ul, finding) {
    const li = document.createElement('li');
    li.dataset.key = findingKey(finding);

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

// [2026-09-16] 애초에 10초마다 innerHTML=''로 통째로 다시 그리는 게 문제의 근원이었음 - <details>의
// open 상태뿐 아니라 그 안 <ul>의 스크롤 위치(max-height+overflow-y:auto)까지 매번 초기화됐다.
// open 여부만 기억해서 복원하는 방식으로 먼저 고쳤더니 열림 상태는 유지됐지만, <ul> 자체가 매번
// 새 DOM 노드로 교체되다 보니 scrollTop을 코드로 다시 대입해도 타이밍에 따라 브라우저가 이를
// 반영하지 못하는 경우가 있었음(레이아웃 계산 전 대입 등). 근본 해결은 "웬만하면 기존 DOM 노드를
// 아예 건드리지 않는 것" - 감사 로그 findings는 과거 기록이 사라지거나 수정되지 않고 뒤에 새
// 항목만 追加되는 append-only 데이터이므로, 이미 그려진 <li>들은 그대로 두고 새로 생긴 것만
// 기존 <ul> 끝에 추가한다. 기존 노드를 안 건드리면 브라우저가 scrollTop을 알아서 그대로 유지하므로
// 수동 복원 자체가 필요 없어진다. 카드/통계 텍스트도 마찬가지로 element를 재사용해 갱신만 한다.
function renderPiiScanRow(piiScanTrack) {
    const container = document.getElementById('piiScanRow');

    const existingCards = new Map();
    container.querySelectorAll('.pii-scan-card').forEach((card) => {
        if (card.dataset.source) existingCards.set(card.dataset.source, card);
    });

    const seenSources = new Set();

    piiScanTrack.forEach((track) => {
        seenSources.add(track.source);
        let card = existingCards.get(track.source);

        if (!card) {
            card = document.createElement('div');
            card.className = 'pii-scan-card';
            card.dataset.source = track.source;

            const title = document.createElement('div');
            title.className = 'pii-scan-card__title';
            title.textContent = PII_SOURCE_LABELS[track.source] || track.source;

            const stats = document.createElement('div');
            stats.className = 'pii-scan-card__stats';

            const scanned = document.createElement('span');
            scanned.className = 'pii-scan-card__scanned';

            const found = document.createElement('span');
            found.className = 'pii-scan-card__found';

            stats.append(scanned, found);
            card.append(title, stats);
            container.appendChild(card);
        }

        const scanned = card.querySelector('.pii-scan-card__scanned');
        scanned.textContent = `스캔 ${track.scanned}건`;

        const found = card.querySelector('.pii-scan-card__found');
        found.textContent = `발견 ${track.found}건`;
        found.className = track.found > 0 ? 'pii-scan-card__found' : 'pii-scan-card__found pii-scan-card__found--zero';

        if (!track.findings || track.findings.length === 0) {
            const existingDetails = card.querySelector('details.pii-finding-list');
            if (existingDetails) existingDetails.remove();
            return;
        }

        const existingDetails = card.querySelector('details.pii-finding-list');
        if (!existingDetails) {
            card.appendChild(renderPiiFindingList(track.findings));
            return;
        }

        const ul = existingDetails.querySelector('ul');
        const existingKeys = Array.from(ul.querySelectorAll('li')).map((li) => li.dataset.key);
        const newKeys = track.findings.map(findingKey);
        const overlapMatches = existingKeys.every((key, i) => key === newKeys[i]);

        if (overlapMatches && newKeys.length >= existingKeys.length) {
            // 기존 항목은 그대로 두고 뒤에 새로 생긴 것만 추가 - <ul> 노드 자체를 안 건드리므로
            // 열림/스크롤 상태가 자연히 유지된다.
            for (let i = existingKeys.length; i < track.findings.length; i++) {
                appendFindingLi(ul, track.findings[i]);
            }
        } else if (!overlapMatches) {
            // 순서/내용이 어긋난 예외적인 경우(정상 흐름에서는 발생하지 않음)에만 통째로 다시
            // 그리되, 열려있던 상태만이라도 보존한다.
            const wasOpen = existingDetails.open;
            const rebuilt = renderPiiFindingList(track.findings);
            rebuilt.open = wasOpen;
            existingDetails.replaceWith(rebuilt);
            return;
        }

        existingDetails.querySelector('summary').textContent = `발견 내역 보기 (${track.findings.length}건)`;
    });

    existingCards.forEach((card, source) => {
        if (!seenSources.has(source)) card.remove();
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
// 대신, 서버가 원래 의도한 대로 offset 기반으로 페이지씩 받아온다.
// [2026-09-16] 처음엔 총 건수 API가 없어 "이번 페이지가 꽉 찼는가"로만 다음 페이지 여부를
// 판단했는데(이전/다음 한 칸씩만 가능), 백엔드가 COUNT(*)를 같이 내려주도록 바뀌면서 총
// 페이지 수를 알 수 있게 됐다. 페이지가 많아지면 숫자 버튼이 한없이 늘어나므로 10페이지씩
// 묶어서 보여주고(PAGE_NUMBERS_PER_GROUP), 그룹을 넘어가는 이동은 이전/다음 버튼으로 한다.
const AUDIT_HISTORY_PAGE_SIZE = 20;
const PAGE_NUMBERS_PER_GROUP = 10;
let auditHistoryOffset = 0;
let auditHistoryTotal = 0;

function renderAuditHistoryTable(rows) {
    const tbody = document.getElementById('auditHistoryList');
    const emptyState = document.getElementById('auditHistoryEmpty');
    tbody.innerHTML = '';
    emptyState.hidden = rows.length > 0;

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.dataset.id = row.id; // Discord 알림 링크(?event=)로 들어왔을 때 해당 행을 찾아 강조하기 위함

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

    // [2026-09-16] 스크롤 대신 "페이지 하나가 항상 한 화면에 다 보이길" 원해서, 마지막 페이지처럼
    // 행 수가 PAGE_SIZE보다 적을 때는 빈 행으로 채워 표 높이를 페이지마다 동일하게 만든다 -
    // 그래야 바로 아래 페이지 번호 버튼이 페이지를 넘겨도 항상 같은 위치에 남는다. (다만 "상세"
    // 칸 내용이 유난히 길어 줄바꿈되는 행이 있으면 그 행 하나만큼은 여전히 더 높아질 수 있음 -
    // 행 개수 차이로 인한 흔한 경우만 해결한다.)
    if (rows.length > 0) {
        for (let i = rows.length; i < AUDIT_HISTORY_PAGE_SIZE; i++) {
            const filler = document.createElement('tr');
            filler.className = 'audit-history-filler-row';
            const td = document.createElement('td');
            td.colSpan = 6;
            td.innerHTML = '&nbsp;';
            filler.appendChild(td);
            tbody.appendChild(filler);
        }
    }
}

function goToAuditHistoryPage(pageNumber) {
    auditHistoryOffset = (pageNumber - 1) * AUDIT_HISTORY_PAGE_SIZE;
    loadAuditHistory();
}

function renderAuditHistoryPagination() {
    const container = document.getElementById('auditHistoryPagination');
    container.innerHTML = '';

    function makeButton(label, disabled, onClick, isCurrent) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.disabled = disabled;
        if (isCurrent) btn.className = 'pagination__page--active';
        if (!disabled) btn.addEventListener('click', onClick);
        return btn;
    }

    const totalPages = Math.max(1, Math.ceil(auditHistoryTotal / AUDIT_HISTORY_PAGE_SIZE));
    const currentPage = Math.floor(auditHistoryOffset / AUDIT_HISTORY_PAGE_SIZE) + 1;
    const groupStart = Math.floor((currentPage - 1) / PAGE_NUMBERS_PER_GROUP) * PAGE_NUMBERS_PER_GROUP + 1;
    const groupEnd = Math.min(groupStart + PAGE_NUMBERS_PER_GROUP - 1, totalPages);

    // 한 칸씩 이전/다음 이동은 그대로 유지 - 숫자 버튼과 별개로 항상 존재.
    container.appendChild(makeButton('‹ 이전', currentPage === 1, () => {
        goToAuditHistoryPage(currentPage - 1);
    }));

    if (groupStart > 1) {
        container.appendChild(makeButton('…', false, () => goToAuditHistoryPage(groupStart - 1)));
    }
    for (let page = groupStart; page <= groupEnd; page++) {
        container.appendChild(makeButton(String(page), page === currentPage, () => goToAuditHistoryPage(page), page === currentPage));
    }
    if (groupEnd < totalPages) {
        container.appendChild(makeButton('…', false, () => goToAuditHistoryPage(groupEnd + 1)));
    }

    container.appendChild(makeButton('다음 ›', currentPage === totalPages, () => {
        goToAuditHistoryPage(currentPage + 1);
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
    const data = await res.json();
    auditHistoryTotal = data.total;
    renderAuditHistoryTable(data.rows);
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

function highlightRow(row) {
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('audit-history-highlight');
    setTimeout(() => row.classList.remove('audit-history-highlight'), 4000);
}

// [2026-09-16] Discord 알림의 "대시보드 바로가기" 링크(?event=<audit_log.id>&source=was)로
// 들어왔을 때, 관리자가 100건 넘는 이력 중에서 그 이벤트를 직접 찾아야 하는 문제를 없애기
// 위함 - 해당 이벤트가 있는 페이지로 자동 이동한 뒤 강조 표시한다. GET /api/audit-log/:id가
// "필터 없는 기본 정렬 기준으로 몇 번째(rank)인지"를 같이 내려주므로 그걸로 페이지를 계산한다 -
// 그래서 혹시 필터가 걸려있으면 먼저 초기화한다(그 필터 기준으로는 위치가 안 맞을 수 있어서).
// mysql_audit(WAS) 전용 - "감사 로그 전체 이력" 표는 이 소스만 담고 있다.
async function jumpToAuditEvent(eventId) {
    const res = await fetch(`${WAS_BASE}/api/audit-log/${eventId}`, { credentials: 'include' });
    if (!res.ok) {
        showToast('알림에 표시된 이벤트를 찾을 수 없습니다.');
        return;
    }
    const event = await res.json();

    document.getElementById('auditRiskFilter').value = '';
    document.getElementById('auditCategoryFilter').value = '';
    document.getElementById('auditFromFilter').value = '';
    document.getElementById('auditToFilter').value = '';
    auditHistoryOffset = Math.floor(event.rank / AUDIT_HISTORY_PAGE_SIZE) * AUDIT_HISTORY_PAGE_SIZE;

    await loadAuditHistory();
    highlightRow(document.querySelector(`#auditHistoryList tr[data-id="${event.id}"]`));
}

// [2026-09-16 정정] 챗봇 쪽(source=chatbot) 이벤트는 audit_log 테이블에 없어서 위 함수를
// 못 쓰지만, chatbot-service/audit_summary.py의 notable 항목이 이미 record_id(=event_id)를
// 들고 있고 admin-audit-dashboard.js의 "위험도 요약" 표(페이지네이션 없이 항상 최근 20건
// 전체를 렌더링)에서 그대로 찾을 수 있다 - 별도 조회 없이 이미 로드된 DOM에서 찾기만 하면 됨.
// record_id 체계가 mysql_audit(auto-increment 정수)과 audit_jsonl(문자열 event_id)로 서로
// 달라 우연히 같은 값이 나올 수 있으므로 source까지 같이 확인한다.
function jumpToNotableEvent(eventId) {
    const row = document.querySelector(`#notableList tr[data-id="${eventId}"][data-source="audit_jsonl"]`);
    if (!row) {
        showToast('알림에 표시된 이벤트가 위험도 요약(최근 20건) 밖으로 밀려나 찾을 수 없습니다.');
        return;
    }
    highlightRow(row);
}

(async function init() {
    await loadUserInfo();
    await Promise.all([loadDashboard(), loadAuditHistory()]);
    setInterval(loadDashboard, AUTO_REFRESH_INTERVAL_MS);

    const params = new URLSearchParams(window.location.search);
    const targetEventId = params.get('event');
    if (targetEventId) {
        if (params.get('source') === 'chatbot') {
            jumpToNotableEvent(targetEventId);
        } else {
            jumpToAuditEvent(targetEventId);
        }
    }
})();
