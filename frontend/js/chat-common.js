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

// [보안 수정 2026-09-16] 예약 확인 단계(RESERVATION_FLOW_WORKFLOW.md 옵션 A) 도입 전에는
// answer 문자열만 필요했지만, 이제 "확인이 필요한 예약 제안인지"(needsConfirmation)도
// 같이 알아야 버튼을 띄울지 판단할 수 있어 응답 객체 전체를 반환하도록 바꿨다.
// 이 함수를 쓰는 chat-widget.js/reservation.js 둘 다 { answer, needsConfirmation } 구조
// 분해로 이미 맞춰뒀다.
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
    return res.json(); // { answer, needsConfirmation }
}

// [보안 수정 2026-09-16] 둘 다 예약 department/date_str 같은 내용을 body에 담지 않는다 -
// WAS가 세션(req.session.pendingReservation)에 보관해둔 값만 사용하므로, 이 호출들은
// "확인/취소한다"는 의사만 전달할 뿐 예약 내용 자체를 조작할 방법이 없다.
async function confirmReservation() {
    const res = await fetch(`${WAS_BASE}/api/chat/confirm-reservation`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || '예약 확인에 실패했습니다.');
    }
    const data = await res.json();
    return data.answer;
}

async function cancelReservation() {
    const res = await fetch(`${WAS_BASE}/api/chat/cancel-reservation`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || '예약 취소 처리에 실패했습니다.');
    }
    const data = await res.json();
    return data.answer;
}

// 봇 말풍선 아래에 예/아니오 버튼을 붙인다. onConfirm/onCancel은 각각 confirmReservation/
// cancelReservation을 호출하고 결과 말풍선까지 그리는 콜백 - 클릭 즉시 두 버튼을 비활성화해
// 중복 클릭으로 확인 요청이 여러 번 나가는 것을 막는다(서버 쪽도 세션 삭제로 이중 방어됨).
function renderReservationConfirmButtons(container, onConfirm, onCancel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-confirm-buttons';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.textContent = '예, 예약할게요';
    yesBtn.className = 'chat-confirm-buttons__yes';

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.textContent = '아니요';
    noBtn.className = 'chat-confirm-buttons__no';

    const disableBoth = () => {
        yesBtn.disabled = true;
        noBtn.disabled = true;
    };

    yesBtn.addEventListener('click', async () => {
        disableBoth();
        renderChatBubble(container, 'patient', yesBtn.textContent);
        await onConfirm();
        wrapper.remove();
    });
    noBtn.addEventListener('click', async () => {
        disableBoth();
        renderChatBubble(container, 'patient', noBtn.textContent);
        await onCancel();
        wrapper.remove();
    });

    wrapper.appendChild(yesBtn);
    wrapper.appendChild(noBtn);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
    return wrapper;
}
