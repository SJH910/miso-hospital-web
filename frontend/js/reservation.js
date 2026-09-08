const chatMessages = document.getElementById('chatMessages');

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

document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    renderChatBubble(chatMessages, 'patient', message);
    input.value = '';

    try {
        const answer = await sendChatMessage(message);
        renderChatBubble(chatMessages, 'bot', answer);
    } catch (err) {
        renderChatBubble(chatMessages, 'bot', err.message);
    }
});

async function init() {
    await loadUserInfo();
    const messages = await fetchChatHistory();
    if (messages.length === 0) {
        // 대화 이력이 없는 첫 방문이면, 무엇을 물어봐야 할지 안내하는 시스템 메시지로 시작
        renderChatBubble(
            chatMessages,
            'bot',
            '안녕하세요! 진료 예약을 도와드릴게요. 원하시는 날짜·시간과 진료과를 말씀해주세요.'
        );
    } else {
        messages.forEach((m) => renderChatBubble(chatMessages, m.sender, m.content));
    }
}

init();
