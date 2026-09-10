const recordList = document.getElementById('recordList');
const emptyState = document.getElementById('emptyState');
const recordDetail = document.getElementById('recordDetail');
const medicalRecordList = document.getElementById('medicalRecordList');
const medicalRecordEmpty = document.getElementById('medicalRecordEmpty');

function formatDate(isoOrDateString) {
    if (!isoOrDateString) return '-';
    const d = new Date(isoOrDateString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function formatAmount(amount) {
    return amount == null ? '-' : `${amount.toLocaleString()}원`;
}

// ── 의료진 작성 진료 기록 (medical_records, GET /api/records) ──
// [XSS 방지] textContent만 사용
async function loadMedicalRecords() {
    const res = await fetch(`${WAS_BASE}/api/records`, { credentials: 'include' });
    if (!res.ok) return; // 401/403이면 조용히 빈 목록으로 둠 (로그인 체크는 loadUserInfo가 이미 처리)
    const records = await res.json();
    medicalRecordList.innerHTML = '';
    medicalRecordEmpty.hidden = records.length > 0;
    records.forEach((r) => {
        const tr = document.createElement('tr');
        const dateTd = document.createElement('td');
        dateTd.textContent = formatDate(r.created_at);
        const diagnosisTd = document.createElement('td');
        diagnosisTd.textContent = r.diagnosis;
        const treatmentTd = document.createElement('td');
        treatmentTd.textContent = r.treatment || '-';
        tr.append(dateTd, diagnosisTd, treatmentTd);
        medicalRecordList.appendChild(tr);
    });
}

// ── 스캔 문서 (scanned_documents, GET /api/documents/mine) ──
function renderRow(doc) {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const typeTd = document.createElement('td');
    typeTd.textContent = doc.document_type_label;
    const dateTd = document.createElement('td');
    dateTd.textContent = formatDate(doc.parsed_date || doc.created_at);
    const amountTd = document.createElement('td');
    amountTd.textContent = formatAmount(doc.parsed_amount);

    tr.append(typeTd, dateTd, amountTd);
    tr.addEventListener('click', () => loadDetail(doc.id));
    recordList.appendChild(tr);
}

async function loadScannedDocuments() {
    const res = await fetch(`${WAS_BASE}/api/documents/mine`, { credentials: 'include' });
    if (!res.ok) return;
    const docs = await res.json();
    recordList.innerHTML = '';
    emptyState.hidden = docs.length > 0;
    docs.forEach(renderRow);
}

// loadDetail을 다시 호출할 때마다 recordDetail.innerHTML을 비우면서 이전 <img>의 blob URL을
// 회수 안 하면 메모리에 계속 쌓이므로, 직전에 만든 blob URL을 기억해뒀다가 다음 호출 시 해제한다.
let currentImageObjectUrl = null;

// [보안] URL이 아니라 클릭한 문서의 id로만 요청 - 서버가 세션의 patientId로 소유권을 다시 검증하므로
// 설령 id를 조작해도 타인의 기록은 절대 내려오지 않는다.
async function loadDetail(id) {
    const res = await fetch(`${WAS_BASE}/api/documents/mine/${id}`, { credentials: 'include' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '조회에 실패했습니다.');
        return;
    }
    const doc = await res.json();

    if (currentImageObjectUrl) {
        URL.revokeObjectURL(currentImageObjectUrl);
        currentImageObjectUrl = null;
    }
    recordDetail.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = `${doc.document_type_label} - ${formatDate(doc.parsed_date || doc.created_at)}`;
    recordDetail.appendChild(title);

    // [2026-09-10] 텍스트(왼쪽)/원본 이미지(오른쪽) 2단 배치로 변경.
    const grid = document.createElement('div');
    grid.className = 'record-detail__grid';

    const textCol = document.createElement('div');
    textCol.className = 'record-detail__text-col';
    const body = document.createElement('pre');
    body.className = 'record-detail__text';
    body.textContent = doc.extracted_text;
    textCol.appendChild(body);
    grid.appendChild(textCol);

    // 저장된 원본 이미지가 있으면 본인 것에 한해, 클릭해서 여는 링크가 아니라 바로 화면에
    // 보이도록 <img>로 표시. src에 API URL을 직접 넣으면 인증 안 된 요청으로도 브라우저가
    // 이미지를 시도하므로(쿠키는 credentials 옵션 없이는 안 실림 - 결국 401), fetch로 받아
    // blob URL을 만들어 넣는다(admin.js와 동일한 패턴, 다만 클릭 없이 로드 시 바로 실행).
    if (doc.hasImage) {
        const imageCol = document.createElement('div');
        imageCol.className = 'record-detail__image-col';
        grid.appendChild(imageCol);

        fetch(`${WAS_BASE}/api/documents/mine/${doc.id}/image`, { credentials: 'include' })
            .then((imgRes) => {
                if (!imgRes.ok) throw new Error('image fetch failed');
                return imgRes.blob();
            })
            .then((blob) => {
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

    recordDetail.appendChild(grid);
    recordDetail.hidden = false;
    recordDetail.scrollIntoView({ behavior: 'smooth' });
}

async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);
    document.getElementById('userInfo').textContent = `${me.name}님`;
    renderNavLinks(me.role);
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
loadMedicalRecords();
loadScannedDocuments();
