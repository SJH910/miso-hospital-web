// 우측 하단 팝업 챗봇. 렌더링/통신 로직은 chat-common.js를 공유하고,
// 이 파일은 "팝업 열고 닫기"와 "이 페이지의 DOM 요소에 연결하기"만 담당한다.
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');

document.getElementById('chatToggleBtn').addEventListener('click', async () => {
    const isOpen = chatPanel.style.display !== 'none';
    chatPanel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen && chatMessages.childElementCount === 0) {
        const messages = await fetchChatHistory();
        messages.forEach((m) => renderChatBubble(chatMessages, m.sender, m.content));
    }
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
