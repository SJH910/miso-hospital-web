const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');

document.getElementById('chatToggleBtn').addEventListener('click', async () => {
    const isOpen = chatPanel.style.display !== 'none';
    chatPanel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen && chatMessages.childElementCount === 0) {
        await loadHistory();
    }
});

// [보안] innerHTML을 쓰지 않고, "[텍스트](경로)" 마크다운 링크 문법만 직접 파싱해서
// DOM 요소로 조립한다. 링크가 아닌 나머지 텍스트는 전부 textContent로만 들어가므로
// 챗봇 응답에 스크립트성 텍스트가 섞여 있어도 실행되지 않는다 (XSS 방지).
// report_merge.md 3.3 요청사항: 진료기록 조회 도구가 반환하는 "[진료 기록 바로가기](/records.html)"를
// 클릭 가능한 링크로 보여줘야 함.
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((\/[a-zA-Z0-9_-]+\.html)\)/g;

function appendMessage(sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${sender}`;

    let lastIndex = 0;
    let match;
    MARKDOWN_LINK_PATTERN.lastIndex = 0;
    while ((match = MARKDOWN_LINK_PATTERN.exec(text)) !== null) {
        // 링크 앞의 일반 텍스트
        if (match.index > lastIndex) {
            bubble.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        // 링크만 <a> 태그로 - href는 "/xxx.html" 패턴만 허용했으므로 javascript: 등 위험한 스킴 불가
        const a = document.createElement('a');
        a.href = match[2];
        a.textContent = match[1];
        a.style.color = 'inherit';
        a.style.textDecoration = 'underline';
        bubble.appendChild(a);
        lastIndex = MARKDOWN_LINK_PATTERN.lastIndex;
    }
    // 마지막 링크 뒤의 나머지 텍스트 (또는 링크가 아예 없으면 전체 텍스트)
    if (lastIndex < text.length) {
        bubble.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadHistory() {
    const res = await fetch(`${WAS_BASE}/api/chat/history`, { credentials: 'include' });
    if (!res.ok) return;
    const messages = await res.json();
    messages.forEach((m) => appendMessage(m.sender, m.content));
}

document.getElementById('chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    appendMessage('patient', message);
    input.value = '';

    const res = await fetch(`${WAS_BASE}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ message }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        appendMessage('bot', err.message || '메시지 전송에 실패했습니다.');
        return;
    }
    const data = await res.json();
    appendMessage('bot', data.answer);
});
