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
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// [2026-09-16] "상세" 컬럼에 원본 JSON 문자열({"risk":null,"category":null,...})을 그대로
// 보여주면 null 값까지 다 나열돼서 보안 관제 화면치고 지저분함 - null인 키는 걸러내고
// "key: value" 형태로 사람이 읽기 편하게 재조립한다. detail 자체가 없거나 값이 다 null이면
// 보여줄 게 없다는 뜻이라 '-'로 표시.
function formatDetail(detail) {
    if (!detail || typeof detail !== 'object') return '-';
    const parts = Object.entries(detail)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${key}: ${value}`);
    return parts.length > 0 ? parts.join(', ') : '-';
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
// track.source(chatbot_sqlite/mysql_chat)별 카드였는데, 두 저장소가 같은 대화를 원문 그대로
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
        detailTd.textContent = formatDetail(row.detail);

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

// [2026-09-16] "관리자 A가 최근에 뭘 했는지" 보려면 계정으로도 좁힐 수 있어야 함 - 계정
// 목록은 이미 있는 GET /api/accounts(accounts:manage 권한, admin 전용)를 그대로 재사용하고
// role이 admin인 것만 걸러 드롭다운을 채운다(요청: "관리자만 넣어서"). 새 엔드포인트를 안
// 만들어도 되고, patient 수백 명이 섞여 드롭다운이 무의미해지는 것도 방지된다.
async function loadAdminAccountOptions() {
    const select = document.getElementById('auditActorFilter');
    try {
        const res = await fetch(`${WAS_BASE}/api/accounts`, { credentials: 'include' });
        if (!res.ok) return; // 실패해도 "전체 계정" 옵션만으로 나머지 필터는 정상 동작해야 함
        const accounts = await res.json();
        accounts
            .filter((account) => account.role === 'admin')
            .forEach((account) => {
                const option = document.createElement('option');
                option.value = account.id;
                option.textContent = `${account.username} (${account.name})`;
                select.appendChild(option);
            });
    } catch (err) {
        console.error('[admin account options] 조회 실패:', err.message);
    }
}

async function loadAuditHistory() {
    const risk = document.getElementById('auditRiskFilter').value;
    const category = document.getElementById('auditCategoryFilter').value;
    const actor = document.getElementById('auditActorFilter').value;
    // datetime-local의 value는 초 단위까지 포함된 지역시각 문자열(예: "2026-09-15T17:03:05") -
    // new Date()가 브라우저/서버(같은 시스템 타임존 가정) 양쪽에서 동일하게 지역시각으로
    // 해석하므로 타임존 변환 없이 그대로 보낸다.
    const from = document.getElementById('auditFromFilter').value;
    const to = document.getElementById('auditToFilter').value;
    const params = new URLSearchParams({ limit: AUDIT_HISTORY_PAGE_SIZE, offset: auditHistoryOffset });
    if (risk) params.set('risk', risk);
    if (category) params.set('category', category);
    if (actor) params.set('actor', actor);
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

document.getElementById('auditActorFilter').addEventListener('change', () => {
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

// 드롭다운/날짜는 change 시 이미 자동 조회되지만(위 리스너들), 명시적으로 "조회"를
// 눌러 확인하고 싶은 사용자를 위한 버튼 - 같은 loadAuditHistory()를 그냥 다시 부른다.
document.getElementById('auditSearchButton').addEventListener('click', () => {
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
    document.getElementById('auditActorFilter').value = '';
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
    await Promise.all([loadDashboard(), loadAuditHistory(), loadAdminAccountOptions()]);
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
