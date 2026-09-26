# 备份、迁移与升级运维手册（叽里呱啦 / balabala-court）

> 适用对象：运维 / 部署负责人。覆盖日常备份、同机升级、跨机迁移、回滚、数据库 schema 变更与零停机评估。
>
> 关联文件：
> - 备份脚本 [`../scripts/backup.sh`](../scripts/backup.sh)、恢复脚本 [`../scripts/restore.sh`](../scripts/restore.sh)
> - Nginx [`../deploy/nginx/nginx.conf`](../deploy/nginx/nginx.conf)
> - HTTPS [`https-setup.md`](./https-setup.md)、STUN/TURN [`stun-turn.md`](./stun-turn.md)
> - 已有部署概览 [`multiplayer-deployment.md`](./multiplayer-deployment.md)

---

## 0. 关键路径与事实速查

| 项 | 值 |
|---|---|
| API 进程 | `node apps/api/dist/server.js`（Fastify 5） |
| API 端口 | `8787`（HTTP + WebSocket 同端口，`PORT` 可覆盖） |
| 健康检查 | `GET /health` → `{ok:true,...}` |
| WebSocket 路由 | `/api/ws`（房间中继，常驻长连接） |
| 请求体上限 | 20MB（`bodyLimit`，Nginx `client_max_body_size 20m` 对齐） |
| SQLite 数据库 | `apps/api/.data/app.db`（`DB_PATH` 可覆盖；node:sqlite） |
| 旧版 JSON | `apps/api/.data/cases.json`、`contents.json`（`BALABALA_*_FILE`） |
| 前端产物 | `apps/web/dist/`（Vite SPA，Nginx 托管） |
| API 产物 | `apps/api/dist/`（tsc） |
| 系统服务名（示例） | `balabala-api.service`（systemd） |

> 仓库 `.gitignore` 已忽略 `**/.data/`：数据库是运行时产物，**不进 git**，必须靠本文档的备份策略保护。

---

## 1. 备份策略

### 1.1 备份什么

| 内容 | 路径 | 是否必须 |
|---|---|---|
| SQLite 数据库 | `apps/api/.data/app.db`（含 `-wal`/`-shm`） | ✅ 核心 |
| 旧版 JSON | `apps/api/.data/*.json` | ⚠️ 兜底（已入 SQLite，仍拷贝） |
| 离线知识包 | `apps/api/data/offline-brains/*.json` | ❌ 已在 git 仓库内，随代码恢复 |
| 上传的 3D/媒体 | 视 Tripo 上传策略，默认对象在外部 API，无需备份 | — |

### 1.2 手动备份

```bash
# 在仓库根目录
./scripts/backup.sh
# 产物：./backups/balabala-backup-YYYYMMDD-HHMMSS.tar.gz

# 生产环境建议把备份指向独立磁盘
BACKUP_DIR=/mnt/nfs/balabala-backups ./scripts/backup.sh
```

脚本特性（详见脚本头注释）：
- SQLite 优先用 `sqlite3 .backup` 在线一致性快照，**不必停服**；
- 保留策略：近 7 天每日全留 + 周日备份留 4 周（28 天）；
- 对象存储上传（S3/OSS/COS）已留注释示例，按需打开。

### 1.3 自动化：cron

```cron
# crontab -e（每天凌晨 3:00 备份一次）
0 3 * * * cd /opt/balabala && /usr/bin/env BACKUP_DIR=/mnt/nfs/balabala-backups ./scripts/backup.sh >> /var/log/balabala-backup.log 2>&1
```

### 1.4 自动化：systemd timer（推荐）

`/etc/systemd/system/balabala-backup.service`：

```ini
[Unit]
Description=balabala-court 数据备份
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/opt/balabala
Environment=BACKUP_DIR=/mnt/nfs/balabala-backups
ExecStart=/opt/balabala/scripts/backup.sh
```

`/etc/systemd/system/balabala-backup.timer`：

```ini
[Unit]
Description=每天凌晨 3 点跑备份

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now balabala-backup.timer
systemctl list-timers | grep balabala
```

> `Persistent=true`：若备份时段机器关机，开机后补跑一次。

### 1.3 备份有效性验证

每周随机抽一个备份包做一次「恢复到临时目录」演练：

```bash
# 不解压到生产，只验证包可解压 + db 可打开
tar -tzf backups/balabala-backup-*.tar.gz
mkdir /tmp/restore-check && tar -xzf backups/xxx.tar.gz -C /tmp/restore-check
sqlite3 /tmp/restore-check/app.db "PRAGMA integrity_check; SELECT count(*) FROM cases;" 2>/dev/null || true
```

---

## 2. 恢复

```bash
./scripts/restore.sh backups/balabala-backup-20260927-030000.tar.gz
```

脚本自动完成：停服务 → 旧 `.data` 改名留存（`.data.bak-<时间戳>`，不删除）→ 解压覆盖 → `integrity_check` → 启服务 → curl `/health`。
非 systemd 部署用 `STOP_CMD`/`START_CMD` 覆盖，见脚本头注释。

---

## 3. 升级流程（同机）

### 3.1 标准发布步骤（有短暂停服窗口）

适用于单人维护、可接受 30~60 秒房间掉线的场景。

```bash
cd /opt/balabala

# 0) 记录当前版本，便于回滚
PREV_COMMIT=$(git rev-parse --short HEAD)
echo "当前版本: $PREV_COMMIT" | tee /tmp/balabala-prev-version

# 1) 拉新代码
git fetch --all
git checkout origin/main          # 或具体 tag

# 2) 安装依赖（含 lockfile 严格模式）
npm ci

# 3) 构建
npm run build                     # = apps/api/dist + apps/web/dist

# 4) 跑测试（必须通过再继续）
npm run test --workspace apps/api

# 5) 发版前备份（关键！）
./scripts/backup.sh

# 6) 停服（WebSocket 会断连，客户端自动重连）
sudo systemctl stop balabala-api

# 7) 替换产物 / 重启（systemd 直接跑 dist，无需手动 cp）
sudo systemctl start balabala-api

# 8) 验证
sleep 3
curl -fsS http://127.0.0.1:8787/health
# 浏览器打开 https://your-domain.com，确认首页、多人房间 WS 正常
sudo systemctl status balabala-api
```

> 若前端是独立目录部署，第 7 步后需 `sudo nginx -s reload`（Vite hash 产物其实不必 reload，index.html 即时生效）。

### 3.2 systemd 服务参考单元

`/etc/systemd/system/balabala-api.service`：

```ini
[Unit]
Description=balabala-court API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/balabala/apps/api
Environment=PORT=8787
EnvironmentFile=/opt/balabala/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

---

## 4. 跨机迁移

### 4.1 新机准备

1. 装 Node 22+、nginx、（可选）sqlite3、certbot。
2. 新域名/或旧域名 A 记录切到新机器公网 IP。
3. 拉代码：`git clone <repo> /opt/balabala && cd /opt/balabala && npm ci && npm run build`。
4. 配置 `.env`（复制旧机 `STEPFUN_API_KEY` 等）。
5. 按 [`https-setup.md`](./https-setup.md) 申请证书。

### 4.2 迁移数据（停机窗口切流）

```bash
# —— 旧机 ——
./scripts/backup.sh                       # 生成最新 tar.gz
scp backups/balabala-backup-*.tar.gz new-server:/tmp/

# —— 新机 ——
./scripts/restore.sh /tmp/balabala-backup-*.tar.gz   # 自动停/启服务
```

### 4.3 切流

1. 旧机 `systemctl stop balabala-api`（停止写入，避免迁移期间产生新数据）。
2. 旧机再打一次备份，scp 到新机再 restore 一次（增量补齐停服窗口后的写入）。
3. DNS A 记录切到新机。TTL 之前已调低（建议迁移前一天把 TTL 改成 300s）。
4. 观察新机日志 15~30 分钟，确认 `/health`、WS、语音正常。
5. 旧机保留 1~2 周再下线（回滚兜底）。

---

## 5. 回滚方案

### 5.1 回滚到上一个代码版本

```bash
cd /opt/balabala
PREV=$(cat /tmp/balabala-prev-version)     # 升级前记录的 commit
sudo systemctl stop balabala-api
git checkout "$PREV"
npm ci
npm run build
sudo systemctl start balabala-api
curl -fsS http://127.0.0.1:8787/health
```

### 5.2 回滚到上一个数据版本（误删/误写后）

```bash
./scripts/restore.sh backups/balabala-backup-<事故前时间>.tar.gz
```

> restore 脚本不会删旧数据，恢复前的数据会留在 `apps/api/.data.bak-<时间戳>/`，确认无误后再清理。

### 5.3 回滚纪律

- 每次升级前**必须**跑一次 `backup.sh`，并记录 `PREV_COMMIT`；
- 旧版本 `dist/` 目录在 `git checkout` 后由 `npm run build` 重建，无需额外保留；
- 数据库若做了 schema 变更，回滚代码前**必须**先把数据库回滚到对应 schema（见下节）。

---

## 6. 数据库 schema 变更

本项目使用 `node:sqlite`（Node 22 内置），**没有 Prisma/Knex 等 migration 框架**。schema 定义集中在 `apps/api/src/db.ts` 的 `initDb()`（`CREATE TABLE IF NOT EXISTS ...`）。

### 6.1 加新表 / 加新列（向后兼容）

`CREATE TABLE IF NOT EXISTS` 对已有库自动跳过；新增列用 `ALTER TABLE ... ADD COLUMN`。在 `initDb()` 里做幂等处理：

```sql
-- 示例：给 cases 加一列（在 db.ts 启动时执行）
ALTER TABLE cases ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';
```

> SQLite 原生 `ADD COLUMN IF NOT EXISTS` 支持因版本而异；node:sqlite 较新版本支持。稳妥写法是先查 `PRAGMA table_info(cases)` 判断列是否存在再 ALTER。

### 6.2 破坏性变更（删列/改类型/改约束）

SQLite 不支持 `DROP COLUMN` 的老版本流程是「建新表 → 拷数据 → 删旧表 → 改名」：

```sql
BEGIN;
CREATE TABLE cases_new ( /* 新 schema */ );
INSERT INTO cases_new SELECT /* 列对齐 */ FROM cases;
DROP TABLE cases;
ALTER TABLE cases_new RENAME TO cases;
COMMIT;
```

**纪律：**
1. 变更前先 `./scripts/backup.sh`；
2. 在 `initDb()` 里写幂等迁移块，**不要**手动进生产库敲 SQL；
3. 本地用一个旧版 `.db` 跑新版代码，确认 `initDb()` 能平滑升级；
4. 回滚时：代码回旧版 + 数据用 6.1 之前的备份恢复（破坏性变更无法用旧代码读新 schema）。

---

## 7. 零停机升级可行性评估

### 7.1 现状约束

- API 是**单进程 Node**，内存里维护着房间/WebSocket 状态（`ws.ts` 的 `Map<roomId, Room>`）。
- 重启进程 = 所有房间连接断开，客户端依赖前端自动重连 `/api/ws`。
- 没有负载均衡多副本，SQLite 是单文件写模型，**多写者会锁库**。

结论：**当前架构无法做到严格零停机**，但可以把窗口压缩到 ~30 秒。

### 7.2 最小化停机（蓝绿单机版）

```bash
# 准备第二份代码目录（绿）
cd /opt/balabala-green && git checkout origin/main && npm ci && npm run build

# 用临时端口 8788 先把绿跑起来（指向同一份 .data 只读启动做冒烟）
PORT=8788 node apps/api/dist/server.js &
curl http://127.0.0.1:8788/health

# 冒烟通过后，正式切：
sudo systemctl stop balabala-api           # 红停
./scripts/backup.sh                        # 最后一份备份
# 把绿目录软链成生产目录 / 切换 systemd WorkingDirectory 到绿
sudo systemctl start balabala-api
```

### 7.3 真正零停机需要的改造（未来）

| 改造 | 作用 |
|---|---|
| 无状态 API + 多副本（前置 Nginx upstream 加 2 个 node） | 滚动重启不中断 |
| 房间状态外置（Redis Pub/Sub 共享 WS 路由） | 任意副本持有连接均可中继 |
| SQLite → PostgreSQL（写并发上来后） | 多副本可同时写 |
| WS 优雅退出：`SIGTERM` 时停止接收新连接、等在飞请求处理完再退 | 配合负载均衡摘流 |

> 在完成上述改造前，建议把升级窗口选在凌晨低峰期，并在前端做 WS 断线自动重连（已实现），用户侧体感只是一次短暂重连。

---

## 8. 运维巡检清单（日常）

```bash
# 服务存活
systemctl status balabala-api nginx coturn

# 健康端点
curl -fsS https://your-domain.com/health

# 磁盘（数据库 + 备份所在盘）
df -h /var /mnt/nfs

# 最近备份是否新鲜（应 < 25h）
ls -lt /mnt/nfs/balabala-backups | head

# 证书到期
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -enddate

# API 错误日志
journalctl -u balabala-api --since "1 hour ago" -p err
```
