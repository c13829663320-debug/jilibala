#!/usr/bin/env bash
# =============================================================================
# 叽里呱啦 · 数据恢复脚本
# -----------------------------------------------------------------------------
# 从 backup.sh 产出的 tar.gz 备份包恢复 SQLite + JSON 数据。
#
# 安全流程：
#   1) 校验备份包完整
#   2) 停止 API 服务（systemctl stop / 自定义 STOP_CMD）
#   3) 把现有 .data 改名留存（.data.bak-<时间戳>），不直接删
#   4) 解压并覆盖数据库 + JSON
#   5) sqlite3 integrity_check 校验（若可用）
#   6) 启动服务 + curl /health 验证
#
# 用法：
#   ./scripts/restore.sh backups/balabala-backup-20260927-030000.tar.gz
#   SERVICE_NAME=balabala-api ./scripts/restore.sh <包>
#   STOP_CMD="pm2 stop balabala-api" START_CMD="pm2 start balabala-api" \
#     ./scripts/restore.sh <包>
#   YES=1 ./scripts/restore.sh <包>     # 跳过确认（自动化用）
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/api}"
DEFAULT_DATA_DIR="${APP_DIR}/.data"
DB_FILE="${DB_PATH:-${DEFAULT_DATA_DIR}/app.db}"
DATA_DIR="${DATA_DIR:-$(dirname "${DB_FILE}")}"

SERVICE_NAME="${SERVICE_NAME:-balabala-api}"
# 自定义启停命令（覆盖 systemd）；默认用 systemctl
STOP_CMD="${STOP_CMD:-systemctl stop ${SERVICE_NAME}}"
START_CMD="${START_CMD:-systemctl start ${SERVICE_NAME}}"

BACKUP_PKG="${1:-}"
log() { echo "[restore $(date +%H:%M:%S)] $*"; }

# ---- 0) 参数校验 -----------------------------------------------------------
if [[ -z "${BACKUP_PKG}" ]]; then
  echo "用法: $0 <备份包.tar.gz>" >&2
  exit 1
fi
if [[ ! -f "${BACKUP_PKG}" ]]; then
  echo "错误：备份包不存在：${BACKUP_PKG}" >&2
  exit 1
fi
# 包完整性自检
if ! tar -tzf "${BACKUP_PKG}" >/dev/null 2>&1; then
  echo "错误：备份包已损坏（无法列出内容）：${BACKUP_PKG}" >&2
  exit 1
fi
log "备份包校验通过：${BACKUP_PKG}"
tar -tzf "${BACKUP_PKG}" | sed 's/^/    包内: /' || true

# ---- 1) 确认 ---------------------------------------------------------------
if [[ "${YES:-0}" != "1" ]]; then
  echo
  echo "即将恢复："
  echo "  备份包：${BACKUP_PKG}"
  echo "  目标库：${DB_FILE}"
  echo "  服务将被停止后重启（stop: ${STOP_CMD} / start: ${START_CMD}）"
  read -r -p "确认继续？输入 yes 继续：" ans
  [[ "${ans}" == "yes" ]] || { echo "已取消。"; exit 0; }
fi

STAGE="$(mktemp -d -t balabala-restore.XXXXXX)"
cleanup() { rm -rf "${STAGE}"; }
trap cleanup EXIT

# ---- 2) 停止服务 -----------------------------------------------------------
log "停止 API 服务：${STOP_CMD}"
# 启停失败不直接退出：systemctl 可能未配置，给出警告继续
bash -c "${STOP_CMD}" || log "警告：停止命令失败（可能未用 systemd，继续手动恢复）"

# ---- 3) 备份现有数据（不删，改名留存）--------------------------------------
if [[ -d "${DATA_DIR}" ]]; then
  SAFETY_BAK="${DATA_DIR}.bak-$(date +%Y%m%d-%H%M%S)"
  log "现有数据备份到：${SAFETY_BAK}"
  mv "${DATA_DIR}" "${SAFETY_BAK}"
else
  log "目标目录不存在，直接新建：${DATA_DIR}"
fi
mkdir -p "${DATA_DIR}"

# ---- 4) 解压并落盘 ---------------------------------------------------------
log "解压备份包到临时目录..."
tar -xzf "${BACKUP_PKG}" -C "${STAGE}"

# SQLite
if [[ -f "${STAGE}/app.db" ]]; then
  log "恢复 app.db ..."
  cp -a "${STAGE}/app.db" "${DATA_DIR}/app.db"
  for ext in -wal -shm -journal; do
    [[ -f "${STAGE}/app.db${ext}" ]] && cp -a "${STAGE}/app.db${ext}" "${DATA_DIR}/app.db${ext}" || true
  done
else
  log "警告：备份包内没有 app.db！"
fi

# JSON（若备份时有）
if [[ -d "${STAGE}/json" ]]; then
  log "恢复 JSON 数据文件..."
  cp -a "${STAGE}/json/." "${DATA_DIR}/"
fi

# ---- 5) 完整性校验 ---------------------------------------------------------
if command -v sqlite3 >/dev/null 2>&1 && [[ -f "${DATA_DIR}/app.db" ]]; then
  log "运行 PRAGMA integrity_check ..."
  if ! sqlite3 "${DATA_DIR}/app.db" "PRAGMA integrity_check;" | grep -q "^ok$"; then
    echo "错误：数据库完整性检查未通过！原始数据已保留在 ${SAFETY_BAK}" >&2
    exit 1
  fi
  log "integrity_check = ok"
else
  log "跳过 sqlite3 完整性校验（无 sqlite3 CLI 或无 db 文件）"
fi

# ---- 6) 启动服务 -----------------------------------------------------------
log "启动 API 服务：${START_CMD}"
bash -c "${START_CMD}" || log "警告：启动命令失败，请手动检查。"

# ---- 7) 健康检查 -----------------------------------------------------------
log "等待 3s 后探测 /health ..."
sleep 3
HEALTH_URL="http://127.0.0.1:${PORT:-8787}/health"
if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then
  log "健康检查通过：${HEALTH_URL}"
else
  log "警告：${HEALTH_URL} 无响应，请查看 API 日志确认启动是否正常。"
fi

cat <<EOF

===============================================================
恢复完成。
  恢复的数据库：${DATA_DIR}/app.db
  恢复前旧数据：${SAFETY_BAK:-（无）}
  确认无误后可删除旧数据：  rm -rf ${SAFETY_BAK:-<旧目录>}
===============================================================
EOF
