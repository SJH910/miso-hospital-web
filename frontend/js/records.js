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

    recordDetail.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = `${doc.document_type_label} - ${formatDate(doc.parsed_date || doc.created_at)}`;
    const body = document.createElement('pre');
    body.className = 'record-detail__text';
    body.textContent = doc.extracted_text;

    recordDetail.append(title, body);

    // [2026-09-10] 저장된 원본 이미지가 있으면 본인 것에 한해 볼 수 있게 함.
    // admin.js와 동일한 이유로 <a href> 대신 fetch(credentials 포함)+blob URL 사용 —
    // 평문 URL로 노출하면 세션 없이도(또는 다른 계정으로) 접근되는 경로가 생기기 때문.
    if (doc.hasImage) {
        const imageLink = document.createElement('a');
        imageLink.href = '#';
        imageLink.textContent = '원본 이미지 보기';
        imageLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const imgRes = await fetch(`${WAS_BASE}/api/documents/mine/${doc.id}/image`, { credentials: 'include' });
            if (!imgRes.ok) {
                showToast('원본 이미지를 불러오지 못했습니다.');
                return;
            }
            const blob = await imgRes.blob();
            window.open(URL.createObjectURL(blob), '_blank');
        });
        recordDetail.appendChild(imageLink);
    }

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
