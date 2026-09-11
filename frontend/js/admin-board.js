const inquiryList = document.getElementById('inquiryList');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const inquiryDetail = document.getElementById('inquiryDetail');
let allPosts = [];

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
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// [2026-09-11] 카드형 목록 -> 표(번호/제목/작성일/답변 상태) + 클릭 시 아래 공용 상세 패널로
// 개편(환자용 board.html과 같은 톤으로 통일). 답변완료/답변대기 배지는 그대로 유지.
// [XSS 방지] 서버 값을 조립할 때 innerHTML 대신 DOM API + textContent만 사용.
function renderRow(post, index) {
    const tr = document.createElement('tr');
    tr.dataset.postId = post.id; // 답변 등록 후 이 행을 다시 찾아 배지를 갱신하기 위함

    const numTd = document.createElement('td');
    numTd.className = 'col-num';
    numTd.textContent = index + 1;

    const titleTd = document.createElement('td');
    titleTd.textContent = post.title;

    const dateTd = document.createElement('td');
    dateTd.className = 'col-date';
    dateTd.textContent = formatDate(post.created_at);

    const statusTd = document.createElement('td');
    statusTd.className = 'col-date';
    const hasAnswer = (post.answers || []).length > 0;
    const badge = document.createElement('span');
    badge.className = 'answer-badge';
    badge.textContent = hasAnswer ? '답변완료' : '답변대기';
    if (!hasAnswer) badge.style.cssText = 'background:#eef0f2; color:var(--text-muted);';
    statusTd.appendChild(badge);

    tr.append(numTd, titleTd, dateTd, statusTd);
    tr.addEventListener('click', () => renderDetail(post, statusTd));
    inquiryList.appendChild(tr);
}

// [2026-09-11] 표 아래 페이지 번호 추가. 서버는 전체 목록을 한 번에 내려주므로 클라이언트에서
// 잘라서 보여주기만 한다(board.js와 동일한 방식).
const PAGE_SIZE = 10;
let currentPage = 1;

function renderList(posts, resetPage = true) {
    if (resetPage) currentPage = 1;
    const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;

    inquiryList.innerHTML = '';
    emptyState.hidden = posts.length > 0;
    posts.slice(start, start + PAGE_SIZE).forEach((post, i) => renderRow(post, start + i));
    renderPagination(posts, totalPages);
}

function renderPagination(posts, totalPages) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    function makeButton(label, targetPage, { active = false, disabled = false } = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        if (active) btn.className = 'pagination__page--active';
        if (disabled) {
            btn.disabled = true;
        } else {
            btn.addEventListener('click', () => {
                currentPage = targetPage;
                renderList(posts, false);
            });
        }
        return btn;
    }

    container.appendChild(makeButton('«', 1, { disabled: currentPage === 1 }));
    container.appendChild(makeButton('‹', currentPage - 1, { disabled: currentPage === 1 }));
    for (let page = 1; page <= totalPages; page++) {
        container.appendChild(makeButton(String(page), page, { active: page === currentPage }));
    }
    container.appendChild(makeButton('›', currentPage + 1, { disabled: currentPage === totalPages }));
    container.appendChild(makeButton('»', totalPages, { disabled: currentPage === totalPages }));
}

async function loadInquiries() {
    const res = await fetch(`${WAS_BASE}/api/board`, { credentials: 'include' });
    if (!res.ok) return;
    allPosts = await res.json();
    renderList(allPosts);
}

// post: 목록에서 이미 받아둔 객체(내용/답변 이력 전부 포함) - 상세용 API를 따로 안 부르고 재사용.
// statusTd: 답변 추가 후 표의 배지도 같이 갱신하기 위한 참조.
function renderDetail(post, statusTd) {
    inquiryDetail.innerHTML = '';

    const meta = document.createElement('p');
    meta.style.cssText = 'color:#6b7785; font-size:14px;';
    meta.textContent = `${post.patient_name} · ${formatDateTime(post.created_at)}`;

    const title = document.createElement('h3');
    title.textContent = post.title;

    const content = document.createElement('p');
    content.className = 'inquiry-card__content';
    content.textContent = post.content;

    inquiryDetail.append(meta, title, content);

    const answers = post.answers || [];
    answers.forEach((a) => {
        const answerBox = document.createElement('div');
        answerBox.className = 'inquiry-card__answer';

        const answeredLabel = document.createElement('p');
        answeredLabel.className = 'inquiry-card__answered-label';
        answeredLabel.textContent = `${a.answered_by_name} · ${formatDateTime(a.created_at)}`;

        const answerText = document.createElement('p');
        answerText.textContent = a.answer;

        answerBox.append(answeredLabel, answerText);
        inquiryDetail.appendChild(answerBox);
    });

    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.placeholder = answers.length ? '추가 답변을 입력하세요.' : '답변을 입력하세요.';
    inquiryDetail.appendChild(textarea);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'width:auto; padding:8px 18px; margin-top:10px;';
    saveBtn.textContent = answers.length ? '답변 추가' : '답변 등록';
    saveBtn.addEventListener('click', () => submitAnswer(post, textarea, saveBtn, statusTd));
    inquiryDetail.appendChild(saveBtn);

    inquiryDetail.hidden = false;
    inquiryDetail.scrollIntoView({ behavior: 'smooth' });
}

async function submitAnswer(post, textarea, button, statusTd) {
    const answer = textarea.value;
    if (!answer.trim()) {
        showToast('답변 내용을 입력해주세요.');
        return;
    }

    button.disabled = true;
    try {
        const res = await fetch(`${WAS_BASE}/api/board/${post.id}/answer`, {
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
        await loadInquiries();
        // 방금 답변한 문의를 목록에서 다시 찾아 상세를 새로고침 - 사용자가 방금 한 일의
        // 결과(추가된 답변, 답변완료로 바뀐 배지)를 바로 확인할 수 있게.
        const refreshed = allPosts.find((p) => p.id === post.id);
        if (refreshed) {
            const row = inquiryList.querySelector(`tr[data-post-id="${post.id}"]`);
            const refreshedStatusTd = row ? row.children[3] : statusTd;
            renderDetail(refreshed, refreshedStatusTd);
        }
    } finally {
        button.disabled = false;
    }
}

searchInput.addEventListener('input', () => {
    const keyword = searchInput.value.trim().toLowerCase();
    const filtered = keyword
        ? allPosts.filter((p) => p.title.toLowerCase().includes(keyword))
        : allPosts;
    renderList(filtered);
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
loadInquiries();
