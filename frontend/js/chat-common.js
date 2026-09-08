// 챗봇 팝업 위젯(chat-widget.js)과 전체화면 예약 상담(reservation.js)이 공통으로 쓰는 로직.
// 로직을 한 곳에 모아두면, 마크다운 링크 안전 렌더링 같은 보안 관련 코드를 두 군데서
// 따로 관리하다 한쪽만 고치는 실수를 막을 수 있다.

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((\/[a-zA-Z0-9_-]+\.html)\)/g;

// [보안] innerHTML을 쓰지 않고 "[텍스트](경로)" 마크다운 링크 문법만 직접 파싱해서 DOM으로 조립.
// 링크가 아닌 나머지 텍스트는 전부 textContent로만 들어가므로 챗봇 응답에 스크립트성
// 텍스트가 섞여 있어도 실행되지 않는다 (XSS 방지). href는 "/xxx.html" 패턴만 허용해
// javascript: 같은 위험한 스킴은 애초에 매칭되지 않는다.
function renderChatBubble(container, sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble--${sender}`;

    let lastIndex = 0;
    let match;
    MARKDOWN_LINK_PATTERN.lastIndex = 0;
    while ((match = MARKDOWN_LINK_PATTERN.exec(text)) !== null) {
        if (match.index > lastIndex) {
            bubble.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const a = document.createElement('a');
        a.href = match[2];
        a.textContent = match[1];
        a.style.color = 'inherit';
        a.style.textDecoration = 'underline';
        bubble.appendChild(a);
        lastIndex = MARKDOWN_LINK_PATTERN.lastIndex;
    }
    if (lastIndex < text.length) {
        bubble.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

async function fetchChatHistory() {
    const res = await fetch(`${WAS_BASE}/api/chat/history`, { credentials: 'include' });
    if (!res.ok) return [];
    return res.json();
}

async function sendChatMessage(message) {
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
        throw new Error(err.message || '메시지 전송에 실패했습니다.');
    }
    const data = await res.json();
    return data.answer;
}
