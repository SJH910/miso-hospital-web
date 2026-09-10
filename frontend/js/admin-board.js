const inquiryList = document.getElementById('inquiryList');
const emptyState = document.getElementById('emptyState');

// 별도 페이지라 board.js가 로드되지 않으므로 로그인/권한 검증을 이 파일이 직접 담당한다.
// 서버(board.js의 requirePermission("board:reply"))가 실제 접근 제어를 하고,
// 여기서는 staff/admin이 아닌 사용자가 잘못 들어왔을 때 안내 후 돌려보내는 프론트단 보조 체크만 한다.
async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    if (me.role !== 'staff' && me.role !== 'admin') {
        showToast('원무/관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님`;
    renderNavLinks(me.role);
}

function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [XSS 방지] 서버 값을 조립할 때 innerHTML 대신 DOM API + textContent만 사용.
// [2026-09-10] 답변은 수정 불가·추가만 가능한 구조로 변경 — post.answer(단일 값) 대신
// post.answers(배열, board_answers 이력 전체)를 받는다. 기존 답변은 읽기 전용으로 나열하고,
// 새 답변을 쓸 빈 textarea는 항상 별도로 둔다(기존 답변을 고쳐 쓰는 UI 자체를 없앰).
function renderInquiryCard(post) {
    const card = document.createElement('div');
    card.className = 'panel inquiry-card';

    const meta = document.createElement('p');
    meta.className = 'inquiry-card__meta';
    meta.textContent = `${post.patient_name} · ${formatDate(post.created_at)}`;

    const title = document.createElement('h4');
    title.textContent = post.title;

    const content = document.createElement('p');
    content.className = 'inquiry-card__content';
    content.textContent = post.content;

    card.append(meta, title, content);

    const answers = post.answers || [];
    answers.forEach((a) => {
        const answerBox = document.createElement('div');
        answerBox.className = 'inquiry-card__answer';

        const answeredLabel = document.createElement('p');
        answeredLabel.className = 'inquiry-card__answered-label';
        answeredLabel.textContent = `${a.answered_by_name} · ${formatDate(a.created_at)}`;

        const answerText = document.createElement('p');
        answerText.textContent = a.answer;

        answerBox.append(answeredLabel, answerText);
        card.appendChild(answerBox);
    });

    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.placeholder = answers.length ? '추가 답변을 입력하세요.' : '답변을 입력하세요.';
    card.appendChild(textarea);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'width:auto; padding:8px 18px; margin-top:10px;';
    saveBtn.textContent = answers.length ? '답변 추가' : '답변 등록';
    saveBtn.addEventListener('click', () => submitAnswer(post.id, textarea.value, saveBtn));
    card.appendChild(saveBtn);

    inquiryList.appendChild(card);
}

async function loadInquiries() {
    const res = await fetch(`${WAS_BASE}/api/board`, { credentials: 'include' });
    if (!res.ok) return;
    const posts = await res.json();
    inquiryList.innerHTML = '';
    emptyState.hidden = posts.length > 0;
    posts.forEach(renderInquiryCard);
}

async function submitAnswer(id, answer, button) {
    if (!answer.trim()) {
        showToast('답변 내용을 입력해주세요.');
        return;
    }

    button.disabled = true;
    try {
        const res = await fetch(`${WAS_BASE}/api/board/${id}/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken(),
            },
            credentials: 'include',
            body: JSON.stringify({ answer }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showToast(err.message || '답변 등록에 실패했습니다.');
            return;
        }

        showToast('답변을 등록했습니다.', 'success');
        loadInquiries();
    } finally {
        button.disabled = false;
    }
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
loadInquiries();
