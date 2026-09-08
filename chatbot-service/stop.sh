#!/bin/bash
# 프로젝트 루트에서 실행: bash stop.sh
for name in was frontend chatbot; do
  if [ -f ".run/$name.pid" ]; then
    kill "$(cat .run/$name.pid)" 2>/dev/null && echo "$name 종료됨" || echo "$name 은 이미 종료된 상태"
    rm -f ".run/$name.pid"
  fi
done
