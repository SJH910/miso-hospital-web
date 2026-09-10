// [2026-09-10] 스캔 원본 이미지(.record-detail__image, records.js/admin.js/admin.html 공용
// 클래스) 클릭 시 확대해서 보는 라이트박스. 이미지가 나중에(fetch 완료 후) 동적으로
// 추가되는 화면이 대부분이라, 개별 요소에 리스너를 붙이는 대신 document에 위임한다 -
// 그러면 이 스크립트가 로드된 시점과 무관하게 이후 생기는 이미지에도 항상 동작한다.
(function () {
    const MIN_SCALE = 0.5;
    const MAX_SCALE = 4;
    const SCALE_STEP = 0.25;
    let scale = 1;

    const overlay = document.createElement('div');
    overlay.className = 'image-zoom-overlay';
    overlay.hidden = true;

    const img = document.createElement('img');
    img.className = 'image-zoom-overlay__img';

    const controls = document.createElement('div');
    controls.className = 'image-zoom-overlay__controls';

    function makeButton(label, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.title = title;
        return btn;
    }

    const zoomOutBtn = makeButton('−', '축소');
    const resetBtn = makeButton('100%', '원래 크기');
    const zoomInBtn = makeButton('+', '확대');
    const closeBtn = makeButton('✕', '닫기');
    closeBtn.className = 'image-zoom-overlay__close';

    controls.append(zoomOutBtn, resetBtn, zoomInBtn);
    overlay.append(img, controls, closeBtn);
    document.body.appendChild(overlay);

    function applyScale() {
        img.style.transform = `scale(${scale})`;
    }

    function setScale(next) {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        applyScale();
    }

    function open(src) {
        img.src = src;
        scale = 1;
        applyScale();
        overlay.hidden = false;
    }

    function close() {
        overlay.hidden = true;
        // src=''는 일부 브라우저에서 현재 문서 URL로 재요청을 보내는 것으로 취급되는
        // 잘 알려진 함정이라 removeAttribute를 쓴다(빈 문자열 대입 대신).
        img.removeAttribute('src');
    }

    zoomInBtn.addEventListener('click', () => setScale(scale + SCALE_STEP));
    zoomOutBtn.addEventListener('click', () => setScale(scale - SCALE_STEP));
    resetBtn.addEventListener('click', () => setScale(1));
    closeBtn.addEventListener('click', close);

    // 이미지 자체가 아니라 어두운 배경을 클릭했을 때만 닫는다(이미지 위 클릭은 무시).
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    document.addEventListener('keydown', (e) => {
        if (overlay.hidden) return;
        if (e.key === 'Escape') close();
        if (e.key === '+' || e.key === '=') setScale(scale + SCALE_STEP);
        if (e.key === '-') setScale(scale - SCALE_STEP);
    });

    // 마우스 휠로도 확대/축소 (스크롤 자체는 막아야 배경 페이지가 같이 스크롤되지 않음).
    overlay.addEventListener('wheel', (e) => {
        e.preventDefault();
        setScale(scale + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
    }, { passive: false });

    document.addEventListener('click', (e) => {
        const target = e.target.closest('.record-detail__image');
        if (!target) return;
        open(target.src);
    });
})();
