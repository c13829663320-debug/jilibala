#!/usr/bin/env bash
# =============================================================================
# 叽里呱啦 · 数据备份脚本
# -----------------------------------------------------------------------------
# 备份内容：
#   1) SQLite 数据库（node:sqlite，生产路径 apps/api/.data/app.db）
#      - 优先用 `sqlite3 .backup` 在线一致性快照（不停服也安全）
#      - 无 sqlite3 CLI 时回退为整目录文件拷贝（db + wal + shm + journal）
#   2) 运行期 JSON 数据文件（.data/cases.json / .data/contents.json 等，若存在）
#
# 产物：$BACKUP_DIR/balabala-backup-YYYYMMDD-HHMMSS.tar.gz
#
# 保留策略：
#   - 最近 7 天的每日备份全保留
#   - 每周日（weekday=0）的备份额外保留 4 周（28 天）
#   - 超过 28 天的一律删除
#
# 用法：
#   ./scripts/backup.sh                # 用默认路径
#   DB_PATH=/path/to/app.db BACKUP_DIR=/mnt/nfs/backups ./scripts/backup.sh
#
# 定时：见 docs/backup-migration.md（cron / systemd timer）。
# 恢复：./scripts/restore.sh <备份包路径>
# =============================================================================
set -euo pipefail

# ---- 路径解析（脚本位于 <repo>/scripts/，据此定位仓库根）-------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 默认：生产进程 cwd = apps/api，SQLite 落在 apps/api/.data/app.db
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/api}"
DEFAULT_DATA_DIR="${APP_DIR}/.data"
DB_FILE="${DB_PATH:-${DEFAULT_DATA_DIR}/app.db}"
DATA_DIR="${DATA_DIR:-$(dirname "${DB_FILE}")}"

# 备份输出目录（生产建议挂载独立磁盘或 NFS：BACKUP_DIR=/mnt/nfs/balabala ./scripts/backup.sh）
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/balabala-backup-${STAMP}.tar.gz"
STAGE="$(mktemp -d -t balabala-backup.XXXXXX)"

log() { echo "[backup $(date +%H:%M:%S)] $*"; }

cleanup() { rm -rf "${STAGE}"; }
trap cleanup EXIT

mkdir -p "${BACKUP_DIR}"

# ---- 1) SQLite 一致性快照 --------------------------------------------------
if [[ -f "${DB_FILE}" ]]; then
  log "发现 SQLite 数据库：${DB_FILE}"
  if command -v sqlite3 >/dev/null 2>&1; then
    # .backup 是 SQLite 官方在线备份命令，即使 API 正在写入也能得到一致性快照
    log "使用 sqlite3 .backup 生成一致性快照..."
    sqlite3 "${DB_FILE}" ".backup '${STAGE}/app.db'"
  else
    log "未找到 sqlite3 CLI，回退为文件拷贝（建议短暂停服以保证一致性）..."
    cp -a "${DB_FILE}" "${STAGE}/app.db"
    # WAL 模式下活跃写入会产生 -wal/-shm，一并拷走
    for ext in -wal -shm -journal; do
      [[ -f "${DB_FILE}${ext}" ]] && cp -a "${DB_FILE}${ext}" "${STAGE}/app.db${ext}" || true
    done
  fi
else
  log "警告：未找到数据库文件 ${DB_FILE}，将仅备份 JSON（首次运行可忽略）。"
fi

# ---- 2) JSON 运行期数据 ---------------------------------------------------
# 现代数据已入 SQLite；这里兜底拷走 .data 下所有 *.json（旧版 cases.json/contents.json）
shopt -s nullglob
json_files=("${DATA_DIR}"/*.json)
if [[ ${#json_files[@]} -gt 0 ]]; then
  log "拷贝 ${#json_files[@]} 个 JSON 数据文件..."
  mkdir -p "${STAGE}/json"
  cp -a "${json_files[@]}" "${STAGE}/json/"
fi
shopt -u nullglob

# ---- 3) 记录元信息（便于恢复时核对）---------------------------------------
{
  echo "backup_time=$(date -Iseconds)"
  echo "db_file=${DB_FILE}"
  echo "data_dir=${DATA_DIR}"
  echo "git_commit=$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "node=$(node -v 2>/dev/null || echo unknown)"
} > "${STAGE}/MANIFEST.txt"

# ---- 4) 打包压缩 ----------------------------------------------------------
log "打包 -> ${DEST}"
tar -C "${STAGE}" -czf "${DEST}" .

# 完整性自检：包内必须能列出内容
tar -tzf "${DEST}" >/dev/null
log "完成：$(du -h "${DEST}" | cut -f1)  ${DEST}"

# ---- 5) 保留策略 ----------------------------------------------------------
# 规则：
#   - 28 天前的全部删除
#   - 7~28 天之间只保留周日（date +%w == 0）的备份
#   - 7 天内全部保留
log "执行保留策略清理..."
cd "${BACKUP_DIR}"
for f in balabala-backup-*.tar.gz; do
  [[ -e "${f}" ]] || continue
  # 文件 mtime 距今天数
  age_days=$(( ( $(date +%s) - $(stat -c %Y "${f}") ) / 86400 ))

  if (( age_days > 28 )); then
    rm -f "${f}"
    log "  删除(>28天)：${f}"
    continue
  fi

  if (( age_days > 7 )); then
    # 从文件名解析日期 YYYYMMDD（balabala-backup-YYYYMMDD-HHMMSS.tar.gz）
    filedate="${f:16:8}"
    wd="$(date -d "${filedate}" +%w 2>/dev/null || echo 1)"   # %w: 0=周日
    if [[ "${wd}" != "0" ]]; then
      rm -f "${f}"
      log "  删除(非周日周备)：${f}"
    fi
  fi
done

# ---- 6) 可选：上传到对象存储（S3 / OSS / COS）----------------------------
# 默认注释掉。取消注释并填好 bucket 后即可启用；建议搭配 `aws s3 ls` 验。
#
# --- AWS S3 / 兼容 S3 协议（MinIO、七牛等）---
# log "上传到 S3..."
# aws s3 cp "${DEST}" "s3://your-bucket/balabala/$(basename "${DEST}")"
#
# --- 阿里云 OSS ---
# ossutil cp "${DEST}" "oss://your-bucket/balabala/"
#
# --- 腾讯云 COS ---
# coscmd upload "${DEST}" "balabala/"
#
# 上传失败不应让本地备份视为失败，故以上命令均建议加 `|| log "警告：上传失败"`

log "全部完成。"
