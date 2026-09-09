async function loadUserInfo() {
    const res = await fetch(`${WAS_BASE}/api/me`, { credentials: 'include' });
    if (!res.ok) {
        window.location.href = 'login.html';
        return;
    }
    const me = await res.json();
    setCsrfToken(me.csrfToken);

    if (me.role !== 'admin') {
        showToast('관리자 계정으로만 접근할 수 있습니다.');
        window.location.href = 'board.html';
        return;
    }

    document.getElementById('userInfo').textContent = `접속자: ${me.name} 님 (관리자)`;
}

async function loadStatus() {
    const res = await fetch(`${WAS_BASE}/api/totp/status`, { credentials: 'include' });
    if (!res.ok) return;
    const { enabled } = await res.json();

    const statusBox = document.getElementById('statusBox');
    statusBox.textContent = enabled
        ? '✅ 현재 TOTP 추가 인증이 활성화되어 있습니다.'
        : '⚠️ 아직 등록되지 않았습니다.';

    document.getElementById('enrollSection').hidden = enabled;
    document.getElementById('enabledSection').hidden = !enabled;
}

let pendingSecret = null; // 등록 확인 전까지만 잠깐 들고 있는 값. 확인 성공 시 서버에 저장됨.

document.getElementById('startEnrollButton').addEventListener('click', async () => {
    const res = await fetch(`${WAS_BASE}/api/totp/setup`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!res.ok) {
        showToast('등록 시작에 실패했습니다.');
        return;
    }
    const { secret } = await res.json();
    pendingSecret = secret;

    document.getElementById('secretDisplay').textContent = secret;
    document.getElementById('secretBox').hidden = false;
});

document.getElementById('confirmEnrollButton').addEventListener('click', async () => {
    const code = document.getElementById('verifyCode').value.trim();
    if (!pendingSecret || !code) {
        showToast('먼저 등록을 시작하고 코드를 입력해주세요.');
        return;
    }

    const res = await fetch(`${WAS_BASE}/api/totp/verify-setup`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({ secret: pendingSecret, code }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.message || '등록에 실패했습니다.');
        return;
    }

    showToast('TOTP가 등록되었습니다.', 'success');
    pendingSecret = null;
    document.getElementById('secretBox').hidden = true;
    document.getElementById('verifyCode').value = '';
    loadStatus();
});

document.getElementById('disableButton').addEventListener('click', async () => {
    const res = await fetch(`${WAS_BASE}/api/totp`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRF-Token': getCsrfToken() },
    });
    if (!res.ok) {
        showToast('해제에 실패했습니다.');
        return;
    }
    showToast('TOTP가 해제되었습니다.', 'success');
    loadStatus();
});

loadUserInfo();
loadStatus();
