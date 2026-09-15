// 우측 하단 팝업 챗봇. 렌더링/통신 로직은 chat-common.js를 공유하고,
// 이 파일은 "팝업 열고 닫기"와 "이 페이지의 DOM 요소에 연결하기"만 담당한다.
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');

document.getElementById('chatToggleBtn').addEventListener('click', async () => {
    const isOpen = chatPanel.style.display !== 'none';
    chatPanel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen && chatMessages.childElementCount === 0) {
        const messages = await fetchChatHistory();
        if (messages.length === 0) {
            // 대화 이력이 없는 첫 방문이면, 챗봇이 무엇을 도와줄 수 있는지 안내하는 시스템 메시지로 시작
            renderChatBubble(
                chatMessages,
                'bot',
                '안녕하세요! 저는 미소병원 안내 챗봇이에요.\n' +
                    '진료 예약·예약 확인\n' +
                    '진료기록·스캔 문서 조회\n' +
                    '진료시간·위치 안내까지 도와드릴 수 있어요. 편하게 말씀해주세요!'
            );
        } else {
            messages.forEach((m) => renderChatBubble(chatMessages, m.sender, m.content));
        }
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
