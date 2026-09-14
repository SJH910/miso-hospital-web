#!/bin/bash
# 프로젝트 루트에서 실행: bash start.sh
# WAS(3000), 프론트(5500, 캐시 무효화된 serve.py 사용), 챗봇 서비스(8000) 세 프로세스를
# 한 번에 백그라운드로 띄운다.
set -e

mkdir -p .run

nohup node was/server.js > .run/was.log 2>&1 &
echo $! > .run/was.pid

# frontend/serve.py는 캐시를 꺼서 파일 수정 후 새로고침해도 바로 반영되게 해주는 버전.
# serve.py는 "실행된 위치(cwd)" 기준으로 파일을 찾으므로, frontend/ 안으로 이동해서 실행해야 함.
# bash -c 한 줄로 cd+실행을 묶어야 백그라운드 전환 시 cd가 안 씹힘 (exec로 PID도 그대로 유지됨).
nohup bash -c "cd frontend && exec python3 serve.py 5500" > .run/frontend.log 2>&1 &
echo $! > .run/frontend.pid

# [2026-09-14] pii_masking.py의 이름 마스킹 2차 안전망(spaCy 한국어 NER)이 쓰는 모델.
# requirements.txt의 spacy 패키지만으로는 모델이 안 딸려와서, 이 모델 없이 배포하면 경고
# 로그만 남기고 조용히 비활성 상태로 뜬다(서비스 자체는 안 죽음 - pii_masking.py 참고).
# 이미 설치돼 있으면 아무것도 안 하고 넘어가도록 확인 후에만 다운로드(매 재시작마다 네트워크
# 호출하지 않기 위함).
if ! python3 -c "import ko_core_news_sm" 2>/dev/null; then
  echo "spaCy 한국어 NER 모델(ko_core_news_sm) 설치 중..."
  python3 -m spacy download ko_core_news_sm
fi

# 챗봇 서비스는 tools_db.py(예약/진료기록 직접 조회)가 WAS와 동일한 MySQL에 접속해야 하므로
# was/config.js의 기본값과 동일한 값을 환경변수로 넘겨준다. 실제 배포 시에는 .env 등으로 관리 권장.
DB_HOST="${DB_HOST:-localhost}" \
DB_USER="${DB_USER:-vulnuser}" \
DB_PASS="${DB_PASS:-vulnpass}" \
DB_NAME="${DB_NAME:-vulnapp}" \
WAS_ORIGIN="${WAS_ORIGIN:-http://localhost:3000}" \
nohup uvicorn app:app --app-dir chatbot-service --port 8000 > .run/chatbot.log 2>&1 &
echo $! > .run/chatbot.pid

sleep 1
echo "WAS 실행됨        (PID: $(cat .run/was.pid))      - 로그: .run/was.log"
echo "프론트 실행됨      (PID: $(cat .run/frontend.pid)) - 로그: .run/frontend.log"
echo "챗봇 서비스 실행됨 (PID: $(cat .run/chatbot.pid))  - 로그: .run/chatbot.log"
echo ""
echo "GEMINI_API_KEY이 설정되어 있지 않으면 챗봇은 규칙 기반 폴백으로만 답합니다."
echo "종료하려면: bash stop.sh"
echo "로그 실시간 보기: tail -f .run/was.log .run/frontend.log .run/chatbot.log"
