#!/usr/bin/env bash
# ===== E2E 冒烟：拉起 API -> 跑 smoke.mjs -> 关闭服务 -> 输出通过/失败 =====
# 用法：  bash e2e/run-smoke.sh
# 环境变量：
#   SMOKE_PORT   服务端口（默认 8787）
#   SMOKE_KEEP   =1 时保留临时 DB 与日志，便于排查
set -u

PORT="${SMOKE_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"

TMP_DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/balabala-smoke-XXXXXX")"
SERVER_LOG="${TMP_DB_DIR}/server.log"
PID_FILE="${TMP_DB_DIR}/api.pid"

cleanup() {
  if [ -f "${PID_FILE}" ]; then
    kill "$(cat "${PID_FILE}")" >/dev/null 2>&1 || true
  fi
  # 兜底：杀掉本脚本拉起的 tsx 进程
  pkill -f "tsx apps/api/src/server.ts" >/dev/null 2>&1 || true
  if [ "${SMOKE_KEEP:-0}" = "1" ]; then
    echo "[smoke] 保留临时目录：${TMP_DB_DIR}  (日志: ${SERVER_LOG})"
  else
    rm -rf "${TMP_DB_DIR}"
  fi
}
trap cleanup EXIT INT TERM

cd "${ROOT}"

echo "[smoke] 启动 API on ${BASE} (DB: ${TMP_DB_DIR}/test.db)"
PORT="${PORT}" DB_PATH="${TMP_DB_DIR}/test.db" \
  npx tsx apps/api/src/server.ts >"${SERVER_LOG}" 2>&1 &
echo $! > "${PID_FILE}"

# 等服务起来（最多 25s）
for i in $(seq 1 50); do
  if curl -s -o /dev/null "${BASE}/healthz" 2>/dev/null; then
    echo "[smoke] 服务已就绪（等待 ${i}*0.5s）"
    break
  fi
  sleep 0.5
done

SMOKE_BASE_URL="${BASE}" node "${HERE}/smoke.mjs"
RC=$?

if [ "${RC}" -ne 0 ]; then
  echo "[smoke] === 失败，服务日志末尾 ==="
  tail -40 "${SERVER_LOG}"
fi

exit "${RC}"
