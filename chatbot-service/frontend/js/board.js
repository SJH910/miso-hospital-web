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

    tr.append(numTd, titleTd, dateTd);
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

    // 관리자에게만 문서 스캔 페이지 이동 버튼 노출 (환자 화면에는 이 기능의 존재 자체를 드러내지 않음).
    // 실제 접근 제어는 서버(각 admin 라우트의 requirePermission)가 담당 — 이건 UI 편의를 위한 것일 뿐.
    if (me.role === 'admin') {
        document.getElementById('adminLink').style.display = 'inline-block';
    } else {
        document.getElementById('recordsLink').style.display = 'inline-block';
        document.getElementById('chatWidget').style.display = 'block';
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
