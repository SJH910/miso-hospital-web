// 화면 상단에 잠깐 떴다가 사라지는 에러/안내 팝업. alert()보다 자연스럽게 실패 메시지를 보여준다.
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 다음 프레임에 클래스를 추가해야 CSS transition이 애니메이션으로 재생됨
    requestAnimationFrame(() => toast.classList.add('toast--show'));

    setTimeout(() => {
        toast.classList.remove('toast--show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 2500);
}
