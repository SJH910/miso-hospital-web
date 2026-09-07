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

// 저장된 스캔 문서 목록. 서버(GET /api/documents)가 OCR 원문 자체를 내려주지 않으므로
// 여기서는 이름/날짜·시간/문서종류만 표시한다 (원문을 화면에 보여주지 않기로 한 정책).
function renderDocument(doc) {
    const li = document.createElement('li');
    const when = new Date(doc.created_at);

    const meta = document.createElement('div');
    meta.style.fontWeight = 'bold';
    meta.textContent = `${doc.patient_name} · ${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;

    const type = document.createElement('div');
    type.textContent = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;

    li.appendChild(meta);
    li.appendChild(type);
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
        const res = await fetch(`${WAS_BASE}/api/documents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken(), // [보안 강화 #5 CSRF] 상태 변경 요청에 토큰 첨부
            },
            credentials: 'include',
            body: JSON.stringify({ patient_id: patientId, document_type: documentType, text }),
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

loadUserInfo();
loadPatients();
loadDocuments();
