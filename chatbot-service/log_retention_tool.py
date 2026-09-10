"""
감사 로그 보존 기한 정리 도구 (report_merge_final.md "감사 로그 보존 정책" 항목).

결정된 정책(2026-09-10):
  - 감사 로그(행위 기록) — 2년: MySQL audit_log, chatbot_logs.db(SQLite) logs 테이블,
    audit-logs/audit_log.jsonl.* 로테이션 백업 파일. 이 스크립트가 다루는 범위.
  - 환자 진료/상담 데이터 — 10년: MySQL chat_messages, medical_records. 감사 로그가 아니라
    별도 정책 대상이라 이 스크립트는 건드리지 않는다(의료법상 진료기록 보존기간에 맞춘 별도
    결정 — 삭제 기능이 필요해지면 별도로 설계/구현할 것).

기본은 항상 dry-run(무엇이/몇 건이 지워질지 보여주기만 함)이고, 실제 삭제는 --execute를
명시적으로 줬을 때만 수행한다 — 자동 스케줄러 없이 관리자가 직접 확인 후 실행하는 것으로
결정했기 때문(자동화하면 날짜 계산 실수 등으로 조용히 과삭제될 위험이 더 큼).

실행: 프로젝트 루트 또는 chatbot-service/ 어디서 실행해도 동작하도록 전부 __file__ 기준
절대경로로 처리한다 (log_audit_tool.py와 동일한 이유 — cwd 의존 버그 회피).
"""
import argparse
import glob
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymysql

CHATBOT_SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CHATBOT_SERVICE_DIR.parent

AUDIT_RETENTION_DAYS = 730  # 2년


def _connect_mysql():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        user=os.getenv("DB_USER", "vulnuser"),
        password=os.getenv("DB_PASS", os.getenv("DB_PASSWORD", "vulnpass")),
        database=os.getenv("DB_NAME", "vulnapp"),
        cursorclass=pymysql.cursors.DictCursor,
    )


# ── 1. MySQL audit_log ────────────────────────────────────────────────────
def purge_mysql_audit_log(cutoff, execute):
    conn = _connect_mysql()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM audit_log WHERE created_at < %s", (cutoff,))
            count = cur.fetchone()["cnt"]
            if execute and count:
                cur.execute("DELETE FROM audit_log WHERE created_at < %s", (cutoff,))
                conn.commit()
    finally:
        conn.close()
    return count


# ── 2. chatbot_logs.db(SQLite) logs 테이블 ────────────────────────────────
def purge_chatbot_sqlite(cutoff, execute):
    db_file = PROJECT_ROOT / "chatbot_logs.db"
    if not db_file.exists():
        return 0
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")  # SQLite CURRENT_TIMESTAMP와 같은 포맷
    conn = sqlite3.connect(str(db_file))
    try:
        cur = conn.execute("SELECT COUNT(*) FROM logs WHERE timestamp < ?", (cutoff_str,))
        count = cur.fetchone()[0]
        if execute and count:
            conn.execute("DELETE FROM logs WHERE timestamp < ?", (cutoff_str,))
            conn.commit()
    finally:
        conn.close()
    return count


# ── 3. audit-logs/audit_log.jsonl.* 로테이션 백업 파일 ─────────────────────
# 오늘 쓰고 있는 audit_log.jsonl(로테이션 안 된 파일)은 절대 건드리지 않는다 — 아직 하루가
# 안 지나 로테이션되지 않았을 뿐 삭제 대상이 될 수 없는 파일이기 때문.
# 개별 레코드 단위로 지우지 않고 "파일(하루치) 단위"로만 지우는 이유: 각 레코드의 hash가
# 직전 레코드의 hash를 포함하는 해시체인 구조라, 파일 중간 레코드만 골라 지우면 그 이후
# 레코드들의 체인이 전부 깨진다. 반면 오래된 날짜의 백업 파일 전체를 통째로 지우는 것은
# 남아있는(더 최근) 파일들의 체인 내부 무결성에는 영향이 없다 — 서버 재시작 시 이어받는
# previous_hash도 "가장 최근" 백업 파일 기준이라(hash_chain.py) 오래된 파일 삭제와 무관하다.
def purge_audit_jsonl_backups(cutoff, execute):
    log_dir = PROJECT_ROOT / "audit-logs"
    backups = glob.glob(str(log_dir / "audit_log.jsonl.*"))
    to_delete = []
    for path in backups:
        suffix = Path(path).name.split("audit_log.jsonl.", 1)[-1]
        try:
            file_date = datetime.strptime(suffix, "%Y-%m-%d")
        except ValueError:
            continue  # 알 수 없는 형식의 파일은 안전하게 건드리지 않음
        if file_date < cutoff:
            to_delete.append(path)

    if execute:
        for path in to_delete:
            os.remove(path)

    return sorted(to_delete)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="실제로 삭제한다. 주지 않으면 dry-run(몇 건/어떤 파일이 지워질지만 출력).",
    )
    args = parser.parse_args()

    # tzinfo 없는 naive datetime으로 통일 — MySQL TIMESTAMP/SQLite 저장값, 백업 파일명에서
    # strptime으로 뽑은 날짜 모두 naive라 비교 시 섞이면 TypeError가 남.
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=AUDIT_RETENTION_DAYS)
    print(f"보존 기한: {AUDIT_RETENTION_DAYS}일(2년) — 기준 시각(UTC) {cutoff.isoformat()} 이전 데이터가 대상")
    print(f"모드: {'실제 삭제' if args.execute else 'dry-run(삭제 안 함)'}\n")

    mysql_count = purge_mysql_audit_log(cutoff, args.execute)
    print(f"[MySQL audit_log] 대상 {mysql_count}건" + (" 삭제 완료" if args.execute and mysql_count else ""))

    sqlite_count = purge_chatbot_sqlite(cutoff, args.execute)
    print(f"[chatbot_logs.db logs] 대상 {sqlite_count}건" + (" 삭제 완료" if args.execute and sqlite_count else ""))

    jsonl_files = purge_audit_jsonl_backups(cutoff, args.execute)
    print(f"[audit-logs 백업 파일] 대상 {len(jsonl_files)}개" + (" 삭제 완료" if args.execute and jsonl_files else ""))
    for f in jsonl_files:
        print(f"  - {f}")

    if not args.execute and (mysql_count or sqlite_count or jsonl_files):
        print("\n실제로 삭제하려면 --execute를 붙여서 다시 실행하세요.")


if __name__ == "__main__":
    main()
