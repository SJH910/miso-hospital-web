// URL의 patient_id를 그대로 서버에 요청.
// [보안 강화 #3 BOLA/IDOR] 서버(routes/board.js GET /:patientId)가 세션 소유자와
// URL의 patientId 일치 여부를 검증하므로, 값을 바꿔도 403으로 차단된다.
const params = new URLSearchParams(window.location.search);
const patientId = params.get('patient_id');
const detail = document.getElementById('postDetail');

async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);
    document.getElementById('userInfo').textContent = `${me.name}님`;
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch(`${WAS_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    window.location.href = 'index.html';
});

// [보안 강화 #2 XSS] innerHTML 조립 대신 DOM 요소를 만들어 textContent로 값 대입.
function renderDetail(posts) {
    detail.innerHTML = '';
    posts.forEach((p) => {
        const wrapper = document.createElement('div');

        const meta = document.createElement('p');
        meta.style.cssText = 'color:#888; font-size:14px;';
        meta.textContent = `작성자: ${p.name} (patient_id=${p.patient_id})`;

        const title = document.createElement('h3');
        title.textContent = p.title;

        const content = document.createElement('p');
        content.textContent = p.content;

        wrapper.append(meta, title, content, document.createElement('hr'));
        detail.appendChild(wrapper);
    });
}

async function loadPost() {
    const res = await fetch(`${WAS_BASE}/api/board/${encodeURIComponent(patientId)}`, { credentials: 'include' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = document.createElement('p');
        message.textContent = err.message || '접근할 수 없습니다.';
        detail.replaceChildren(message);
        return;
    }
    const posts = await res.json();
    if (posts.length === 0) {
        const message = document.createElement('p');
        message.textContent = '해당 문의를 찾을 수 없습니다.';
        detail.replaceChildren(message);
        return;
    }
    renderDetail(posts);
}

loadUserInfo();
loadPost();
