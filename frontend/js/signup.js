document.getElementById('signupForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value.trim();
    const rrn = document.getElementById('rrn').value.trim();

    // 클라이언트 단 기본 검증 (서버 검증을 대체하지 않음 - 서버가 최종 방어선)
    if (!username || !password || !name || !rrn) {
        showToast('모든 항목을 입력해주세요.');
        return;
    }
    if (password.length < 8) {
        showToast('비밀번호는 8자 이상 입력해주세요.');
        return;
    }

    const res = await fetch(`${WAS_BASE}/api/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, name, rrn }),
    });
    const data = await res.json();

    if (data.success) {
        showToast('가입이 완료되었습니다. 로그인해주세요.', 'success');
        setTimeout(() => { window.location.href = 'login.html'; }, 1200);
    } else {
        // [보안 강화 #10 User Enumeration] 서버가 중복/실패 시에도 동일한 일반 메시지만 반환하므로
        // 이 메시지만으로는 "그 아이디가 이미 존재하는지" 알 수 없음.
        showToast(data.message || '가입 처리 중 문제가 발생했습니다.');
    }
});
