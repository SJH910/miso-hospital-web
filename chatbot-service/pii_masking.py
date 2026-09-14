import re
import math
import logging

logger = logging.getLogger(__name__)

# spacy(+ 한국어 모델)는 무거운 선택적 의존성이라, 설치가 안 되어 있어도
# 정규식 기반 마스킹(주민번호/전화번호/이메일/이름 패턴)은 그대로 동작하게 방어적으로 처리.
# [보안 수정 2026-09-14] 예전엔 모델이 없으면 경고 로그 한 줄 없이 조용히 nlp=None으로 넘어가서,
# "문맥상 이름(트리거 단어 없이 등장하는 이름)" 마스킹 2차 안전망이 꺼져 있다는 걸 아무도 알아챌
# 수 없었음(BUG_REVIEW_2026-09-11 "fail-open" 항목). 서비스는 계속 죽지 않되, 최소한 시작 시
# 눈에 띄는 경고를 남겨서 배포 시 모델 설치를 빠뜨렸는지 바로 알 수 있게 한다.
try:
    import spacy
    try:
        nlp = spacy.load("ko_core_news_sm")
    except OSError:
        nlp = None  # spacy는 있지만 한국어 모델이 없는 경우
        logger.warning(
            "⚠️ spaCy 한국어 모델(ko_core_news_sm)을 찾을 수 없습니다. "
            "'python -m spacy download ko_core_news_sm'으로 설치 전까지, "
            "트리거 단어 없이 등장하는 이름(예: 상대가 이름만 말한 경우) PII 마스킹이 비활성 상태입니다."
        )
except ImportError:
    nlp = None  # spacy 자체가 설치 안 된 경우
    logger.warning(
        "⚠️ spacy 패키지가 설치되어 있지 않습니다. "
        "트리거 단어 없이 등장하는 이름 PII 마스킹이 비활성 상태입니다."
    )

# 숫자 사이 구분자로 허용하는 문자 - 공백/하이픈/물결/밑줄. [보안 수정 2026-09-10] 마침표(.)가
# 빠져있어서 "900101.1234567"/"010.1234.5678"처럼 점으로 구분한 주민번호·전화번호가 매칭 자체가
# 안 돼서 마스킹 없이 그대로 통과되던 버그가 있었음(BUG_REVIEW_2026-09-10.md 참고). 이 문자
# 클래스가 아래에 여러 번 따로 적혀있으면 한쪽만 고치고 잊어버리기 쉬우므로(이 버그 자체가
# 그렇게 생긴 것으로 보임) 상수 하나로 모아 재사용한다.
SEPARATOR = r'[\s\-\~_.]'

def build_spaced_regex(digit_counts):
    # digit_counts = [6, 7] -> 6 digits, then 7 digits
    parts = []
    for count in digit_counts:
        part = (SEPARATOR + '*').join([r'\d'] * count)
        parts.append(part)
    return re.compile(r'(' + parts[0] + r')' + SEPARATOR + r'*(' + parts[1] + r')')

def shannon_entropy(s: str) -> float:
    """
    문자열의 섀넌 엔트로피(bits/char)를 계산합니다.
    무작위성이 높을수록(=API 키/시크릿일 가능성이 높을수록) 값이 커집니다.
    자연어 문장이나 반복 문자는 낮은 값을 가집니다.
    """
    if not s:
        return 0.0
    freq = {}
    for ch in s:
        freq[ch] = freq.get(ch, 0) + 1
    length = len(s)
    entropy = 0.0
    for count in freq.values():
        p = count / length
        entropy -= p * math.log2(p)
    return entropy


# --- 내부 URL / 사설 IP 탐지 ---
_OCTET = r'(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)'

_PRIVATE_IP = (
    r'(?:10(?:\.' + _OCTET + r'){3}'
    r'|172\.(?:1[6-9]|2\d|3[01])(?:\.' + _OCTET + r'){2}'
    r'|192\.168(?:\.' + _OCTET + r'){2}'
    r'|127(?:\.' + _OCTET + r'){3})'
)

# RFC1918 사설 IP 대역 / localhost / 사내 전용 도메인 접미사(.internal, .corp, .local, .intranet)를 탐지.
# 공인 IP(8.8.8.8)나 공개 도메인(naver.com, example.com)은 매칭되지 않도록 접미사 화이트리스트 방식 사용.
_INTERNAL_URL_PATTERN = re.compile(
    r'(?:https?://)?(?:' + _PRIVATE_IP + r'|localhost)(?::\d{2,5})?(?:/[^\s,]*)?'
    r'|(?:https?://)?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.(?:internal|corp|local|intranet)(?:/[^\s,]*)?'
)

# --- 알려진 서비스 API 키 시그니처 탐지 ---
# 테이블 기반 설계: 새 서비스 추가 시 이 리스트에 (이름, 정규식)만 추가하면 됨.
# 주의: 더 구체적인 패턴(Anthropic: sk-ant-)을 일반 패턴(OpenAI: sk-)보다 반드시 먼저 배치할 것
#       (먼저 등록된 항목이 먼저 치환되므로, 순서가 바뀌면 sk-ant-... 가 OpenAI 규칙에 부분 매칭되어
#        [MASKED_API_KEY] 뒤에 "ant-..." 잔여 문자열이 남는 버그가 생김).
_API_KEY_SIGNATURES = [
    ("AWS Access Key", re.compile(r'AKIA[0-9A-Z]{16}')),
    ("GitHub Token", re.compile(r'gh[pousr]_[A-Za-z0-9]{36,}')),
    ("Slack Token", re.compile(r'xox[baprs]-[A-Za-z0-9-]{10,48}')),
    ("Google API Key", re.compile(r'AIza[0-9A-Za-z\-_]{30,45}')),
    ("Anthropic Key", re.compile(r'sk-ant-[A-Za-z0-9-]{20,}')),
    ("OpenAI Key", re.compile(r'sk-[A-Za-z0-9]{20,}')),
    ("JWT", re.compile(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')),
]


def _mask_known_signatures(text: str) -> str:
    for _name, pattern in _API_KEY_SIGNATURES:
        text = pattern.sub('[MASKED_API_KEY]', text)
    return text

# --- 키워드 문맥 기반 시크릿 탐지 ---
# 그룹1: 키워드+구분자(그대로 유지), 그룹2: 실제 값(마스킹 대상)
_KEYWORD_SECRET_PATTERN = re.compile(
    r'((?:api[_\s-]?key|secret|access[_\s-]?key|token|password|bearer'
    r'|API\s*키|시크릿\s*키|액세스\s*키|비밀번호)'
    r'\s*[:=]?\s*(?:은|는|이|가)?\s*)'
    r'([A-Za-z0-9][A-Za-z0-9._-]{7,})',
    re.IGNORECASE
)

# --- 엔트로피 기반 폴백 탐지 ---
# 위 세 단계(URL/시그니처/키워드)에 걸리지 않은, 영문자로 시작하는 16자 이상의
# 순수 ASCII 토큰만 후보로 삼는다 (한글 문장은 애초에 후보에서 제외되어 오탐 방지).
_ENTROPY_CANDIDATE_PATTERN = re.compile(
    r'(?<![A-Za-z0-9_.\-])[A-Za-z][A-Za-z0-9]{15,}(?![A-Za-z0-9_.\-])'
)
_ENTROPY_THRESHOLD = 3.5  # bits/char - 오탐/미탐 트레이드오프 조정 지점


def _mask_entropy_candidates(text: str) -> str:
    def repl(match):
        token = match.group(0)
        if 'MASKED' in token:  # 이미 마스킹된 placeholder는 건드리지 않음 (멱등성 보장)
            return token
        if shannon_entropy(token) >= _ENTROPY_THRESHOLD:
            return '[MASKED_API_KEY]'
        return token
    return _ENTROPY_CANDIDATE_PATTERN.sub(repl, text)


def mask_secrets(text: str) -> str:
    """
    내부 URL/사설 IP 및 API 키(시크릿) 노출을 탐지해 마스킹합니다.
    개인정보(PII) 보호가 아니라 시스템 접근 정보 유출 방지가 목적이며,
    반드시 mask_pii()의 다른 정규식(특히 8자리 차트번호 패턴)보다 먼저 실행되어야
    사설 IP의 끝자리 등이 다른 패턴에 잘못 먹히는 것을 방지할 수 있습니다.
    """
    if not text:
        return text

    masked_text = text

    # 1. 내부 URL / 사설 IP
    masked_text = _INTERNAL_URL_PATTERN.sub('[MASKED_INTERNAL_URL]', masked_text)

    # 2. 알려진 서비스 API 키 시그니처
    masked_text = _mask_known_signatures(masked_text)

    # 3. 키워드 문맥 기반 시크릿 (api_key=, secret:, Bearer 등)
    masked_text = _KEYWORD_SECRET_PATTERN.sub(r'\1[MASKED_API_KEY]', masked_text)

    # 4. 엔트로피 기반 폴백 (위 세 단계에 안 걸린 나머지 고엔트로피 후보만)
    masked_text = _mask_entropy_candidates(masked_text)

    return masked_text


def mask_pii(text: str) -> str:
    """
    사용자 입력 텍스트에서 PII(개인정보)를 탐지하고 마스킹 처리합니다.
    """
    if not text:
        return text

    masked_text = text

    # 0. 내부 URL / 사설 IP / API 키 (다른 숫자 기반 패턴보다 반드시 먼저 실행)
    masked_text = mask_secrets(masked_text)

    # 1. 주민등록번호 (RRN)
    # \d 6번 + \d 7번
    rrn_pattern = build_spaced_regex([6, 7])
    masked_text = rrn_pattern.sub(r'\1-[MASKED]', masked_text)

    # 2. 전화번호 (Phone Number)
    # 010 (3) + 4 + 4
    # '0', '1', '[016789]'
    # [보안 수정 2026-09-11] 중간 구간을 4자리로만 고정해뒀더니, 011/016/017/018/019
    # 구형 국번은 중간 구간이 3자리(예: 011-234-5678)라 매칭 자체가 안 되고 그대로
    # 통과되던 버그가 있었음(BUG_REVIEW_2026-09-10.md 참고). 4자리를 먼저 시도하고
    # 안 되면 3자리로 시도하도록 변경 - 4자리를 먼저 둬야 진짜 4자리 번호가 3자리로
    # 잘못 잘려서 뒤 패턴과 안 맞는 상황을 피할 수 있음.
    phone_part1 = r'0' + SEPARATOR + r'*1' + SEPARATOR + r'*[016789]'
    phone_part2_new = (SEPARATOR + '*').join([r'\d'] * 4)  # 010 등 신형 - 4자리
    phone_part2_old = (SEPARATOR + '*').join([r'\d'] * 3)  # 011~019 구형 - 3자리
    phone_part2 = f'(?:{phone_part2_new}|{phone_part2_old})'
    phone_part3 = (SEPARATOR + '*').join([r'\d'] * 4)
    phone_pattern = re.compile(f'({phone_part1}){SEPARATOR}*({phone_part2}){SEPARATOR}*({phone_part3})')
    masked_text = phone_pattern.sub(r'\1-****-\3', masked_text)

    # 3. 이름 (Name)
    # 문맥상 이름이 나오는 패턴을 잡아 마스킹 (lookahead 활용)
    name_pattern1 = re.compile(
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+([가-힣]{2,5}?)(?=\s*(?:입니다|이에요|야|이야|라고|인데|은|는|이|가|입니|요|\b|\.|\,|$))|'
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)'
    )

    # [보안 수정 2026-09-14] 위 정규식은 "저는/제 이름은 + 2~5자 한글"이면 무조건 이름으로
    # 취급해서 "저는 아파요"→"저는 아*요", "저는 관리자입니다"→"저는 관*자입니다",
    # 챗봇 거절 메시지 "저는 미소병원 안내 챗봇입니다"→"저는 미**원 안내 챗봇입니다"처럼
    # 일반 단어까지 오탐 마스킹하는 문제가 있었음(LogDB_plan.md 2026-09-10/09-14 기록 참고).
    # 최소한의 보강으로, 한글 후보 단어의 첫 글자가 실제 성씨인 경우에만 이름으로 인정한다.
    # 완전한 성씨 목록은 아니고(희귀 성씨는 여전히 놓칠 수 있음), 반대로 "김치"처럼 흔한
    # 성씨(김)로 시작하는 일반 단어는 여전히 오탐될 수 있다 - 정규식/화이트리스트 방식의
    # 구조적 한계이며, 이걸 근본적으로 없애려면 문맥 기반 개체명 인식(NER)이 필요하다.
    KOREAN_SURNAMES = {
        "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신",
        "권", "황", "안", "송", "전", "홍", "유", "고", "문", "양", "손", "배", "백", "허",
        "남", "심", "노", "하", "곽", "성", "차", "주", "우", "구", "나", "민", "진", "채",
    }

    def mask_name(match):
        prefix = match.group(1) or match.group(3)
        name = match.group(2) or match.group(4)

        # 영문 이름 처리
        if re.match(r'^[A-Za-z\s]+$', name):
            parts = name.split()
            if len(parts) > 1:
                masked_parts = [parts[0]] + ['*' * len(p) for p in parts[1:]]
                masked_name = ' '.join(masked_parts)
            else:
                mid = len(name) // 2
                if mid == 0: mid = 1
                masked_name = name[:mid] + '*' * (len(name) - mid)
        else:
            # [보안 수정 2026-09-14] 성씨로 시작하지 않으면 이름이 아니라고 보고 원문 그대로 둔다.
            if name[0] not in KOREAN_SURNAMES:
                return match.group(0)

            # 한국어 이름 처리
            length = len(name)
            if length == 2:
                masked_name = name[0] + '*'
            elif length == 3:
                masked_name = name[0] + '*' + name[2]
            elif length >= 4:
                masked_name = name[0] + '*' * (length - 2) + name[-1]
            else:
                masked_name = name
                
        # 정규식에서 suffix를 포함하지 않고 lookahead로만 확인했으므로, 
        # 매치된 텍스트(접두사 + 이름)만 교체하면 뒤의 문맥은 그대로 유지됩니다.
        return f"{prefix} {masked_name}"
    
    masked_text = name_pattern1.sub(mask_name, masked_text)

    # 4. 이메일 (Email)
    email_pattern = re.compile(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+')
    masked_text = email_pattern.sub('[MASKED_EMAIL]', masked_text)

    # 5. 차트 번호 (8자리 숫자)
    # 이미 마스킹된 전화번호나 주민번호에 영향을 주지 않기 위해 단어 경계(\b)를 사용하고 
    # MASKED 키워드와 겹치지 않게 조심합니다.
    # 한국어 텍스트 특성상 띄어쓰기가 없으면 \b가 안 먹힐 수 있으므로
    # 앞뒤에 숫자나 영문자가 없는 8자리 숫자를 찾습니다.
    chart_pattern = re.compile(r'(?<![A-Za-z0-9\-])\d{8}(?![A-Za-z0-9\-])')
    masked_text = chart_pattern.sub('[MASKED_CHART_NO]', masked_text)

    # 6. 문맥 없는 이름 마스킹 (spaCy NER)
    if nlp is not None:
        doc = nlp(masked_text)
        # 인덱스 밀림을 방지하기 위해 뒤에서부터 교체
        for ent in reversed(doc.ents):
            if ent.label_ in ["PERSON", "PS"]:
                name = ent.text
                # 이미 마스킹된 부분(*나 MASKED)이 포함되어 있다면 건너뜀
                if '*' in name or 'MASKED' in name:
                    continue
                
                length = len(name)
                if length == 1:
                    masked_name = '*'
                elif length == 2:
                    masked_name = name[0] + '*'
                elif length == 3:
                    masked_name = name[0] + '*' + name[2]
                elif length >= 4:
                    masked_name = name[0] + '*' * (length - 2) + name[-1]
                else:
                    masked_name = name
                    
                masked_text = masked_text[:ent.start_char] + masked_name + masked_text[ent.end_char:]

    return masked_text

if __name__ == "__main__":
    # Test cases
    test_inputs = [
        "제 주민번호는 900101-1234567 입니다.",
        "제 번호는 9001011234567이에요.",
        "주민번호 9 0 0 1 0 1 - 1 2 3 4 5 6 7 입니다.",
        "전화번호는 010-1234-5678 입니다.",
        "연락처 01012345678",
        "저는 김구야",
        "제 이름은 홍길동입니다.",
        "이름이 남궁민수야",
        "저는 윤알렉산더입니다.",
        "내 이름은 Howl Jenkins 라고",
        "내 이름은 Luis clanton 인데 호흡기 안심 클리닉은 어디에 위치 해 있어?",
        "이름이 홍길동 인데 진료 예약 가능한가요?",
        "안녕 나는 남궁민수라고해",
        "안녕 나는 남궁민수인데 안과 진료도 받아?",
        "내 이메일은 test@example.com 이야",
        "제 차트 번호는 12345678 인데요",
        "홍길동 취소해줘",
        "아파요 김구"
    ]
    
    for t in test_inputs:
        print(f"Original: {t}")
        print(f"Masked  : {mask_pii(t)}")
        print("-")
