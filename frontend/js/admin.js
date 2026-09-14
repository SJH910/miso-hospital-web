async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html'; // 로그인 안 된 상태면 로그인 페이지로
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken); // 새로고침 등으로 토큰이 없을 경우를 대비해 /api/me에서도 재확보

    // 서버(각 라우트의 requirePermission)가 실제 권한 검사를 하지만, 관리자가 아닌 사용자가
    // 이 화면에 잘못 들어왔을 때 빈 화면 대신 안내 후 돌려보내기 위한 프론트단 보조 체크
    if (me.role !== 'admin') {
        showToast('관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `${me.name} 님`;
    renderNavLinks(me.role);
}

async function loadPatients() {
    const select = document.getElementById('patientSelect');
    const res = await fetch(`${WAS_BASE}/api/patients`, { credentials: 'include' });
    if (!res.ok) return;
    const patients = await res.json();
    patients.forEach((p) => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.username} (${p.name})`; // textContent만 사용 -> innerHTML 아님
        select.appendChild(option);
    });
}

const DOCUMENT_TYPE_LABELS = {
    prescription: '처방전',
    diagnosis: '진단서',
    receipt: '영수증',
};

function formatDocDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function formatDocAmount(amount) {
    return amount == null ? '-' : `${amount.toLocaleString()}원`;
}

// [2026-09-11] "항목/금액(들)"이 표로 인식됐을 때만 표시(parseItemTable, best-effort) - 못 알아본
// 문서는 그냥 원문 텍스트만 보이고 표는 안 뜬다. items는 { headers: string[], rows: [{label,
// values: string[]}] } 형태(서버가 탭으로 재조립한 다열 구조를 인식하면 열이 여러 개일 수 있음).
// 신뢰할 수 없는 OCR 값이라 textContent만 사용.
function renderItemTable(container, items) {
    container.innerHTML = '';
    if (!items || !items.rows || items.rows.length === 0) return;

    const table = document.createElement('table');
    table.className = 'ocr-item-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.textContent = '항목';
    headRow.appendChild(th0);
    items.headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    items.rows.forEach((row) => {
        const tr = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.textContent = row.label;
        tr.appendChild(labelTd);
        row.values.forEach((v) => {
            const td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    container.appendChild(table);
}

// [2026-09-11] "환자명/병원명/진료기간" 등 라벨:값 미리보기 - 주민번호/카드번호처럼 민감한
// 라벨은 서버(parseDisplayFields/maskFieldValue)가 이미 마스킹해서 내려줌. 원문 그대로는
// 아래 "수정하기" textarea에서 확인 가능("텍스트 결과=마스킹 / 수정하기=원문" 결정).
function renderDisplayFields(container, fields) {
    container.innerHTML = '';
    if (!fields || fields.length === 0) return;

    const dl = document.createElement('dl');
    dl.className = 'ocr-info-list';
    fields.forEach((f) => {
        const dt = document.createElement('dt');
        dt.textContent = f.label;
        const dd = document.createElement('dd');
        dd.textContent = f.value;
        dl.append(dt, dd);
    });
    container.appendChild(dl);
}

// [2026-09-10] "저장된 문서"를 카드 목록 대신 표(환자용 records.html과 같은 패턴)로 바꾸고,
// 행을 클릭하면 아래 documentDetail 패널 하나에 원문/이미지가 채워지는 구조로 변경 —
// 이전엔 항목마다 펼치는 카드였는데, 표로 훑어보고 클릭해서 상세를 보는 흐름이 환자 쪽과
// 일관되고 더 명확함. 상세 패널에서는 원문을 직접 수정하고 저장할 수도 있다.
let currentImageObjectUrl = null;
let currentDetailId = null;

function renderRow(doc) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = doc.patient_name;
    const typeTd = document.createElement('td');
    typeTd.textContent = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;
    const dateTd = document.createElement('td');
    dateTd.textContent = formatDocDate(doc.parsed_date || doc.created_at);
    const amountTd = document.createElement('td');
    amountTd.textContent = formatDocAmount(doc.parsed_amount);

    tr.append(nameTd, typeTd, dateTd, amountTd);
    // 수정 저장 후 표 행도 같이 갱신해야 해서 날짜/금액 셀 참조를 같이 넘겨준다.
    tr.addEventListener('click', () => {
        // [2026-09-11] 지금 상세 패널에 어떤 행이 떠 있는지 표에서도 바로 보이게 - 클릭한
        // 행에만 .is-selected를 남기고 나머지는 지운다.
        document.querySelectorAll('#documentList tr.is-selected').forEach((el) => el.classList.remove('is-selected'));
        tr.classList.add('is-selected');
        loadDetail(doc, dateTd, amountTd);
    });
    document.getElementById('documentList').appendChild(tr);
}

async function loadDocuments() {
    const list = document.getElementById('documentList');
    const res = await fetch(`${WAS_BASE}/api/documents`, { credentials: 'include' });
    if (!res.ok) return;
    const docs = await res.json();
    list.innerHTML = '';
    document.getElementById('documentEmptyState').hidden = docs.length > 0;
    docs.forEach(renderRow);
}

// doc은 목록 조회 때 이미 받아둔 객체(원문/파싱값 전부 포함)라 상세용 API를 따로 안 부르고
// 그대로 재사용한다 — 이미지만 클릭 시점에 따로 fetch(항상 전체 목록의 이미지를 미리
// 불러오지 않기 위함).
function loadDetail(doc, dateTd, amountTd) {
    currentDetailId = doc.id;
    if (currentImageObjectUrl) {
        URL.revokeObjectURL(currentImageObjectUrl);
        currentImageObjectUrl = null;
    }

    const detail = document.getElementById('documentDetail');
    detail.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = `${doc.patient_name} · ${DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}`;
    detail.appendChild(title);

    const meta = document.createElement('p');
    meta.style.cssText = 'color:#6b7785; font-size:14px;';
    const refreshMeta = () => {
        meta.textContent = `인식된 날짜: ${formatDocDate(doc.parsed_date)} · 인식된 금액: ${formatDocAmount(doc.parsed_amount)}`;
    };
    refreshMeta();
    detail.appendChild(meta);

    const displayFieldsContainer = document.createElement('div');
    renderDisplayFields(displayFieldsContainer, doc.parsed_display_fields);
    detail.appendChild(displayFieldsContainer);

    const itemTableContainer = document.createElement('div');
    renderItemTable(itemTableContainer, doc.parsed_items);
    detail.appendChild(itemTableContainer);

    const grid = document.createElement('div');
    grid.className = 'record-detail__grid';

    const textCol = document.createElement('div');
    textCol.className = 'record-detail__text-col';
    const textarea = document.createElement('textarea');
    textarea.rows = 8;
    textarea.value = doc.extracted_text || '';
    textCol.appendChild(textarea);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'width:auto; padding:8px 18px; margin-top:10px;';
    saveBtn.textContent = '수정 저장';
    saveBtn.addEventListener('click', async () => {
        if (!textarea.value.trim()) {
            showToast('저장할 텍스트가 없습니다.');
            return;
        }
        saveBtn.disabled = true;
        try {
            // PATCH는 텍스트만 받고, 서버가 저장 때와 같은 로직으로 날짜/금액을 다시 파싱해서
            // 같이 갱신해준다 - 그래서 응답의 parsed_date/parsed_amount로 화면을 갱신하면 됨.
            const res = await fetch(`${WAS_BASE}/api/documents/${doc.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken(),
                },
                credentials: 'include',
                body: JSON.stringify({ text: textarea.value }),
            });
            const result = await res.json();
            if (!res.ok) {
                showToast(result.message || '수정에 실패했습니다.');
                return;
            }
            doc.extracted_text = result.extracted_text;
            doc.parsed_date = result.parsed_date;
            doc.parsed_amount = result.parsed_amount;
            doc.parsed_items = result.parsed_items;
            doc.parsed_display_fields = result.parsed_display_fields;
            refreshMeta();
            renderDisplayFields(displayFieldsContainer, doc.parsed_display_fields);
            renderItemTable(itemTableContainer, doc.parsed_items);
            dateTd.textContent = formatDocDate(doc.parsed_date || doc.created_at);
            amountTd.textContent = formatDocAmount(doc.parsed_amount);
            showToast('수정을 저장했습니다.', 'success');
        } finally {
            saveBtn.disabled = false;
        }
    });
    textCol.appendChild(saveBtn);
    grid.appendChild(textCol);

    // credentials(세션 쿠키)를 실어야 해서 <img src>에 API URL을 직접 넣지 않고 fetch로 받아
    // blob URL을 만든다 (평문 URL로 직접 노출하면 documents:view 권한 체크를 안 거치는 경로가
    // 생기므로 반드시 fetch 경유 - records.js와 동일한 이유).
    if (doc.hasImage) {
        const imageCol = document.createElement('div');
        imageCol.className = 'record-detail__image-col';
        grid.appendChild(imageCol);

        fetch(`${WAS_BASE}/api/documents/${doc.id}/image`, { credentials: 'include' })
            .then((res) => {
                if (!res.ok) throw new Error('image fetch failed');
                return res.blob();
            })
            .then((blob) => {
                // 이 fetch가 끝나기 전에 다른 문서를 열었으면(currentDetailId가 바뀌었으면)
                // 이미 안 보이는 상세의 이미지이므로 버린다 - records.js에서 발견했던
                // "늦게 도착한 fetch가 엉뚱한 문서의 blob URL을 덮어쓰는" 경쟁 조건 방지.
                if (currentDetailId !== doc.id) return;
                const img = document.createElement('img');
                img.className = 'record-detail__image';
                currentImageObjectUrl = URL.createObjectURL(blob);
                img.src = currentImageObjectUrl;
                img.alt = '원본 스캔 이미지';
                imageCol.appendChild(img);
            })
            .catch(() => {
                showToast('원본 이미지를 불러오지 못했습니다.');
            });
    }

    detail.appendChild(grid);
    detail.hidden = false;
    detail.scrollIntoView({ behavior: 'smooth' });
}

// OCR 원문(신뢰할 수 없는 값)을 다시 화면에 그리는 부분이라 textContent만 사용 -> innerHTML 금지.
function renderConfidencePreview(text) {
    const container = document.getElementById('confidencePreview');
    container.textContent = text || '(미리보기 없음)';
}

// [2026-09-10] 파일을 고르는 즉시 원본 이미지를 오른쪽에 미리보기로 보여준다 - 아직 서버에
// 올리기 전(스캔/저장 전)이라 로컬 File 그대로 URL.createObjectURL로 미리보기만 만들면 됨
// (fetch로 서버에서 받아올 필요가 없음 - 저장된 문서 목록/환자 상세 화면과는 다른 상황).
document.getElementById('scanImage').addEventListener('change', function () {
    const preview = document.getElementById('scanImagePreview');
    const file = this.files[0];
    if (preview.src) URL.revokeObjectURL(preview.src);
    if (!file) {
        preview.hidden = true;
        preview.removeAttribute('src');
        return;
    }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
});

// [2026-09-11] "인식 결과 미리보기"/"원문 텍스트 수정"을 버튼이 아니라 탭으로 전환 - 둘 중 선택된
// 쪽만 밑줄(.is-active, style.css)로 표시되고, 그 탭에 해당하는 영역만 보인다. scanDisplayFields는
// 마스킹된 값을 보여주는데 바로 아래 textarea에 마스킹 없는 원문이 항상 같이 보이면 마스킹한
// 의미가 없어서, 명시적으로 탭을 눌러야만 원문 textarea가 나타나게 함.
const previewTabBtn = document.getElementById('previewTabBtn');
const editTabBtn = document.getElementById('editTabBtn');
const confidencePreviewEl = document.getElementById('confidencePreview');
const resultTextGroup = document.getElementById('resultTextGroup');

function setOcrTab(tab) {
    const isPreview = tab === 'preview';
    previewTabBtn.classList.toggle('is-active', isPreview);
    previewTabBtn.setAttribute('aria-selected', String(isPreview));
    editTabBtn.classList.toggle('is-active', !isPreview);
    editTabBtn.setAttribute('aria-selected', String(!isPreview));
    confidencePreviewEl.hidden = !isPreview;
    resultTextGroup.hidden = isPreview;
}

previewTabBtn.addEventListener('click', () => setOcrTab('preview'));
editTabBtn.addEventListener('click', () => setOcrTab('edit'));
setOcrTab('preview');

document.getElementById('scanButton').addEventListener('click', async function () {
    const fileInput = document.getElementById('scanImage');
    const statusEl = document.getElementById('scanStatus');
    const resultEl = document.getElementById('resultText');
    const file = fileInput.files[0];
    if (!file) {
        statusEl.textContent = '이미지를 먼저 선택해주세요.';
        return;
    }

    statusEl.textContent = '텍스트 추출 중...';
    this.disabled = true;

    try {
        const formData = new FormData();
        formData.append('image', file);

        const res = await fetch(`${WAS_BASE}/api/ocr`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrfToken() }, // [보안 강화 #5 CSRF] 상태 변경 요청에 토큰 첨부
            credentials: 'include',
            body: formData,
        });
        const result = await res.json();

        if (!res.ok) {
            statusEl.textContent = result.message || '텍스트 추출에 실패했습니다.';
            return;
        }

        // .value로만 삽입 (innerHTML 아님) -> OCR 결과에 <script>가 섞여 있어도 텍스트로만 취급되어 실행되지 않음
        resultEl.value = result.text;
        renderConfidencePreview(result.text);
        // [2026-09-11] 저장된 문서 상세보기와 동일한 구조화 미리보기를 스캔 직후에도 표시 -
        // /api/ocr 응답에 parsed_display_fields/parsed_items가 포함되도록 서버(ocr.js)도 같이 수정함.
        renderDisplayFields(document.getElementById('scanDisplayFields'), result.parsed_display_fields);
        renderItemTable(document.getElementById('scanItemTable'), result.parsed_items);
        statusEl.textContent = result.text ? '추출 완료.' : '이미지에서 텍스트를 찾지 못했습니다.';
    } catch (err) {
        statusEl.textContent = '텍스트 추출 중 오류가 발생했습니다.';
    } finally {
        this.disabled = false;
    }
});

document.getElementById('saveButton').addEventListener('click', async function () {
    const statusEl = document.getElementById('saveStatus');
    const patientId = document.getElementById('patientSelect').value;
    const documentType = document.getElementById('documentTypeSelect').value;
    const text = document.getElementById('resultText').value;

    if (!patientId) {
        statusEl.textContent = '환자를 선택해주세요.';
        return;
    }
    if (!documentType) {
        statusEl.textContent = '문서 종류를 선택해주세요.';
        return;
    }
    if (!text.trim()) {
        statusEl.textContent = '저장할 텍스트가 없습니다.';
        return;
    }

    statusEl.textContent = '저장 중...';
    this.disabled = true;

    try {
        // [2026-09-10] JSON -> FormData로 변경: 텍스트뿐 아니라 원본 이미지도 저장 확정 시점에
        // 같이 보낸다. #scanImage는 OCR 이후에도 초기화하지 않으므로(별도 reset 없음) 여기서
        // 다시 읽으면 사용자가 처음 선택했던 그 파일이 그대로 잡힌다.
        const fileInput = document.getElementById('scanImage');
        const formData = new FormData();
        formData.append('patient_id', patientId);
        formData.append('document_type', documentType);
        formData.append('text', text);
        if (fileInput.files[0]) {
            formData.append('image', fileInput.files[0]);
        }

        const res = await fetch(`${WAS_BASE}/api/documents`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrfToken() }, // [보안 강화 #5 CSRF] 상태 변경 요청에 토큰 첨부
            credentials: 'include',
            body: formData,
        });
        const result = await res.json();

        if (!res.ok) {
            statusEl.textContent = result.message || '저장에 실패했습니다.';
            return;
        }

        statusEl.textContent = '저장 완료.';
        await loadDocuments();
    } catch (err) {
        statusEl.textContent = '저장 중 오류가 발생했습니다.';
    } finally {
        this.disabled = false;
    }
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
loadPatients();
loadDocuments();
