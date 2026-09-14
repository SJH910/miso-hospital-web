import re
import math

# spacy(+ 한국어 모델)는 무거운 선택적 의존성이라, 설치가 안 되어 있어도
# 정규식 기반 마스킹(주민번호/전화번호/이메일/이름 패턴)은 그대로 동작하게 방어적으로 처리.
#
# [보안 수정 2026-09-14] ko_core_news_sm(경량 모델)은 "홍길동인데"/"홍길동 취소해줘" 같은
# 실제 이름을 PERSON이 아닌 다른 라벨(LC 등)로 잘못 분류하는 경우가 많아서 한동안 라벨을
# 신뢰하지 않고 성씨 패턴으로 우회했었다. 그런데 그 우회 방식 자체가 "김치찌개"/"강남역"
# 처럼 성씨와 같은 글자로 시작하는 지명·음식명까지 이름으로 오탐하는 새 문제를 만들었다.
# 실측 결과 ko_core_news_md(중간 크기 모델)는 같은 케이스에서 라벨을 훨씬 정확하게 매긴다
# (홍길동->PS, 강남역/서울->LC, 김치찌개/미소병원->엔티티로도 안 잡힘). 그래서 우회 대신
# 더 큰 모델로 교체해 라벨을 다시 신뢰하는 원래 설계로 되돌렸다(아래 6번 블록 참고).
# spaCy 한국어는 sm/md만 제공되고 lg는 없어서 md가 현재 선택 가능한 최선이다.
try:
    import spacy
    nlp = None
    for _model_name in ("ko_core_news_md", "ko_core_news_sm"):
        try:
            nlp = spacy.load(_model_name)
            break
        except OSError:
            continue  # 이 모델이 설치 안 되어 있으면 다음(더 작은) 모델로 폴백
except ImportError:
    nlp = None  # spacy 자체가 설치 안 된 경우

# 숫자 사이 구분자로 허용하는 문자 - 공백/하이픈/물결/밑줄. [보안 수정 2026-09-10] 마침표(.)가
# 빠져있어서 "900101.1234567"/"010.1234.5678"처럼 점으로 구분한 주민번호·전화번호가 매칭 자체가
# 안 돼서 마스킹 없이 그대로 통과되던 버그가 있었음(BUG_REVIEW_2026-09-10.md 참고). 이 문자
# 클래스가 아래에 여러 번 따로 적혀있으면 한쪽만 고치고 잊어버리기 쉬우므로(이 버그 자체가
# 그렇게 생긴 것으로 보임) 상수 하나로 모아 재사용한다.
SEPARATOR = r'[\s\-\~_.]'

# 한국 성씨 화이트리스트 (단일 성 + 복성). "저는/나는 + N글자"만 보고 이름으로 단정하면
# "저는 아파요", "저는 미소병원 안내 챗봇입니다" 같은 비-이름 표현까지 마스킹되는 오탐이
# 발생함(plan.md 참고: "미소병원"이 "미**원"으로 오탐 마스킹된 실제 사례). 트리거 뒤 캡처된
# 문자열이 실제 성씨로 시작할 때만 이름으로 취급해 오탐을 줄인다. 통계상 상위 빈도 성씨
# 위주로 구성했으며, 목록에 없는 희귀 성씨는 (기존과 동일하게) 놓칠 수 있다.
KOREAN_SURNAMES = frozenset([
    "남궁", "황보", "제갈", "선우", "사공", "서문", "독고", "동방",
    "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신",
    "권", "황", "안", "송", "전", "홍", "유", "류", "고", "문", "양", "손", "배", "백",
    "허", "남", "심", "노", "하", "곽", "성", "차", "주", "우", "구", "민", "진", "지",
    "엄", "채", "원", "천", "방", "공", "현", "함", "변", "염", "여", "추", "도", "소",
    "석", "선", "설", "마", "길", "연", "위", "표", "명", "기", "반", "왕", "금", "옥",
    "육", "인", "맹", "제", "모", "피", "두", "감", "음", "사", "예", "경", "돈", "어",
    "판", "빈", "후", "봉", "편",
])
_SURNAME_ALT = '|'.join(sorted(KOREAN_SURNAMES, key=len, reverse=True))

# [보안 수정 2026-09-14] 성씨 화이트리스트만으로는 "저는 서울에 살아요" -> "저는 서*에 살아요",
# "김치찌개 먹고 배가 아파요" -> "김**개..." 같은 새로운 오탐이 생김. 한국어 성씨(김/이/서/강 등)와
# 완전히 같은 글자로 시작하는 지명·음식명이 매우 흔한데, "N글자 뒤 조사 없이 바로 다음 조사(에/로 등)를
# 만나면 그 조사까지 통째로 이름으로 삼켜버리는" 경계 판정 버그가 원인. 장소/도구 등을 나타내는
# 조사가 뒤에 오면 애초에 이름 후보로 확장하지 못하게 막는다 (문자 단위 negative lookahead).
_NON_NAME_PARTICLES = [
    "에서", "에게", "한테", "으로", "까지", "부터", "밖에", "처럼", "만큼", "마다",
    "이랑", "랑", "로", "와", "과", "에",
]
_NON_NAME_PARTICLE_ALT = '|'.join(_NON_NAME_PARTICLES)
_NAME_CHAR = r'(?:(?!' + _NON_NAME_PARTICLE_ALT + r')[가-힣])'

# 이름 뒤에 흔히 붙는 조사/어미 경계 - name_pattern1의 lookahead 목록과 동일하게 맞춤.
# lookahead(?=)이므로 매치 결과(m.group(0))에는 조사/어미가 포함되지 않고 이름만 남는다.
_NAME_TAIL_BOUNDARY = r'(?=입니다|이에요|야|이야|라고|인데|은|는|이|가|입니|요|\b|\.|\,|$)'
# NER 결과(ent.text)에서 "성씨로 시작 + 뒤에 이름 경계가 오는" 부분만 실제 이름으로 추출.
# spaCy 한국어 sm 모델이 조사가 붙은 이름을 PERSON이 아닌 다른 라벨(LC 등)로 잘못 분류하거나
# entity span에 뒤 문맥까지 통째로 묶는 경우가 있어(plan.md 참고), 라벨을 신뢰하는 대신
# 이 성씨 패턴으로 직접 이름 경계를 판별한다.
_korean_name_in_span = re.compile(r'^(?:' + _SURNAME_ALT + r')' + _NAME_CHAR + r'{1,3}?' + _NAME_TAIL_BOUNDARY)

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
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+(' + _NAME_CHAR + r'{2,5}?)(?=\s*(?:입니다|이에요|야|이야|라고|인데|은|는|이|가|입니|요|\b|\.|\,|$))|'
        r'(이름은|이름이|저는|내 이름은|제 이름은|나는|난|내 이름이|제 이름이)\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)'
    )
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
            # 한국어 이름 처리 - 실제 성씨로 시작하지 않으면 이름이 아닌 것으로 보고
            # 마스킹하지 않는다("저는 아파요", "저는 미소병원 안내 챗봇입니다" 같은 오탐 방지).
            if not re.match(r'^(?:' + _SURNAME_ALT + r')', name):
                return match.group(0)

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
    # [보안 수정 2026-09-14] ko_core_news_md로 교체한 뒤에는 라벨 정확도가 충분히 검증돼서
    # (홍길동->PS, 강남역/서울->LC, 김치찌개/미소병원->엔티티 미검출) 다시 라벨을 1차 신뢰
    # 기준으로 사용한다 - PERSON/PS로 분류된 entity만 이름 후보로 본다. 그 안에서도 entity
    # span에 조사/어미(예: "김철수입니다"의 "입니다")가 같이 묶여 들어오는 경우가 있어서,
    # 성씨 패턴으로 실제 이름 부분만 트리밍한다. 성씨 화이트리스트에 없는 희귀 성씨라도
    # 라벨이 PERSON/PS라면(모델을 믿고) entity 전체를 이름으로 마스킹한다.
    if nlp is not None:
        doc = nlp(masked_text)
        # 인덱스 밀림을 방지하기 위해 뒤에서부터 교체
        for ent in reversed(doc.ents):
            if ent.label_ not in ("PERSON", "PS"):
                continue

            ent_text = ent.text
            # 이미 마스킹된 부분(*나 MASKED)이 포함되어 있다면 건너뜀
            if '*' in ent_text or 'MASKED' in ent_text:
                continue

            m = _korean_name_in_span.match(ent_text)
            if m:
                name = m.group(0)
            else:
                # 성씨 화이트리스트에 없어도 라벨(PERSON/PS)을 믿고 entity 전체를 이름으로 처리
                name = ent_text

            length = len(name)
            if length == 1:
                masked_name = '*'
            elif length == 2:
                masked_name = name[0] + '*'
            elif length == 3:
                masked_name = name[0] + '*' + name[2]
            else:
                masked_name = name[0] + '*' * (length - 2) + name[-1]

            replaced = masked_name + ent_text[len(name):]
            masked_text = masked_text[:ent.start_char] + replaced + masked_text[ent.end_char:]

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
