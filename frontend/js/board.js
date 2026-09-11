const inquiryList = document.getElementById('inquiryList');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
let allPosts = [];

function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

// [보안 강화 #2 XSS] innerHTML 대신 DOM API + textContent 사용.
// textContent로 대입된 값은 항상 순수 텍스트로만 렌더링되어, 스크립트 태그가 들어있어도 실행되지 않는다.
function renderPost(post, index) {
    const tr = document.createElement('tr');

    const numTd = document.createElement('td');
    numTd.className = 'col-num';
    numTd.textContent = index + 1;

    const titleTd = document.createElement('td');
    const a = document.createElement('a');
    a.href = `view.html?patient_id=${encodeURIComponent(post.patient_id)}`;
    a.textContent = post.title;
    titleTd.appendChild(a);

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
    inquiryList.appendChild(tr);
}

function renderList(posts) {
    inquiryList.innerHTML = '';
    emptyState.hidden = posts.length > 0;
    posts.forEach(renderPost);
}

async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html'; // 로그인 안 된 상태면 로그인 페이지로
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken); // 새로고침 등으로 토큰이 없을 경우를 대비해 /api/me에서도 재확보
    document.getElementById('userInfo').textContent = `${me.name}님`;

    // staff는 board:write/board:read 권한이 없어 이 페이지의 작성 폼·상세보기(view.html)를 쓸 수 없다.
    // 전체 문의 조회·답변은 admin-board.html 전용 화면에서 처리하므로 그쪽으로 보낸다.
    if (me.role === 'staff') {
        window.location.href = 'admin-board.html';
        return;
    }

    // nav는 페이지와 무관하게 항상 동일(js/nav.js) - 실제 접근 제어는 서버(각 라우트의
    // requirePermission)가 담당하므로, 여기서 링크를 보여주고 감추는 건 UI 편의를 위한 것일 뿐.
    renderNavLinks(me.role);
    if (me.role === 'patient') {
        document.getElementById('chatWidget').style.display = 'block';
    }
    // [2026-09-11] "문의 답변" 링크를 상단 네비에서 빼고 여기로 옮김 - staff는 이미 위에서
    // admin-board.html로 리다이렉트돼서 이 지점에 도달 안 하므로, 사실상 admin에게만 보임.
    if (me.role === 'admin' || me.role === 'staff') {
        document.getElementById('goToAdminBoardBtn').hidden = false;
    }
}

async function loadMyInquiries() {
    const res = await fetch(`${WAS_BASE}/api/board`, { credentials: 'include' });
    if (!res.ok) return; // loadUserInfo에서 이미 로그인 여부를 처리하므로 여기서는 조용히 무시
    allPosts = await res.json();
    renderList(allPosts);
}

document.getElementById('inquiryForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const title = document.getElementById('title').value;
    const content = document.getElementById('content').value;

    const res = await fetch(`${WAS_BASE}/api/board`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(), // [보안 강화 #5 CSRF] 상태 변경 요청에 토큰 첨부
        },
        credentials: 'include',
        body: JSON.stringify({ title, content }),
    });

    if (!res.ok) {
        const err = await res.json();
        showToast(err.message || '등록 실패');
        return;
    }

    const newPost = await res.json();
    allPosts.unshift(newPost); // 서버가 sanitize한 값이 오므로 렌더링도 안전함
    renderList(allPosts);

    document.getElementById('title').value = '';
    document.getElementById('content').value = '';
});

document.getElementById('goToAdminBoardBtn').addEventListener('click', () => {
    window.location.href = 'admin-board.html';
});

document.getElementById('scrollToWriteBtn').addEventListener('click', () => {
    document.getElementById('writeSection').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('title').focus();
});

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
loadMyInquiries();
