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

    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님 (관리자)`;
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

// 저장된 스캔 문서 목록.
// [2026-09-10] 원문(왼쪽, 작게)/원본 이미지(오른쪽, 바로 보이게)를 나란히 표시하도록 변경 —
// 이전엔 서버가 원문을 아예 내려주지 않고 이미지도 클릭해야 여는 링크였는데, admin(저장한
// 사람) 본인이 OCR 오인식 여부를 바로 확인할 수 있도록 GET /api/documents 응답에 extracted_text를
// 포함시키고, 이미지도 클릭 없이 로드되게 바꿈(records.js의 환자용 화면과 동일한 레이아웃/패턴 재사용).
function renderDocument(doc) {
    const li = document.createElement('li');
    li.className = 'document-item';
    const when = new Date(doc.created_at);

    const meta = document.createElement('div');
    meta.style.fontWeight = 'bold';
    meta.textContent = `${doc.patient_name} · ${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;

    const type = document.createElement('div');
    type.textContent = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;

    li.append(meta, type);

    const grid = document.createElement('div');
    grid.className = 'record-detail__grid';

    const textCol = document.createElement('div');
    textCol.className = 'record-detail__text-col';
    const body = document.createElement('pre');
    body.className = 'record-detail__text';
    body.textContent = doc.extracted_text || '(추출된 텍스트 없음)';
    textCol.appendChild(body);
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
                const img = document.createElement('img');
                img.className = 'record-detail__image';
                img.src = URL.createObjectURL(blob);
                img.alt = '원본 스캔 이미지';
                imageCol.appendChild(img);
            })
            .catch(() => {
                showToast('원본 이미지를 불러오지 못했습니다.');
            });
    }

    li.appendChild(grid);
    document.getElementById('documentList').appendChild(li);
}

async function loadDocuments() {
    const list = document.getElementById('documentList');
    const res = await fetch(`${WAS_BASE}/api/documents`, { credentials: 'include' });
    if (!res.ok) return;
    const docs = await res.json();
    list.innerHTML = '';
    docs.forEach(renderDocument);
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
