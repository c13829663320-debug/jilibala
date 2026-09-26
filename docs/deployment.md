# 叽里呱啦 · Docker 一键部署

本文档面向**有 Docker 环境**的服务器（Linux x86_64），用一条命令拉起整套服务。
无 Docker / 内网离线场景请看 [self-hosting.md](./self-hosting.md)。

## 架构

```
                    ┌───────────────────────────────┐
浏览器 ──:8080────▶ │ web (nginx:1.27-alpine)        │
                    │  · 静态托管 apps/web/dist      │
                    │  · 反代 /api、/api/ws、/health │
                    └──────────────┬──────────────────┘
                                   │ 内网 bridge
                    ┌──────────────▼──────────────────┐
                    │ api (node:22-alpine)           │
                    │  Fastify 5, :8787               │
                    │  node:sqlite + JSON             │
                    └──────────────┬──────────────────┘
                                   │ 命名卷
                    ┌──────────────▼──────────────────┐
                    │ 卷 balabala_data  → /data      │
                    │  app.db / cases.json / …        │
                    └─────────────────────────────────┘
```

> API 进程本身不托管前端静态资源（未注册 `@fastify/static`），因此采用
> **nginx 静态 + 反向代理**的分离方案。nginx 是唯一对外端口，api 仅在内部网络可达。

---

## 快速开始

### 1. 前置要求
- Docker Engine ≥ 20.10（含 Compose v2，即 `docker compose` 子命令）
- 服务器可访问 Docker Hub / 国内镜像加速器，以及上游 API
  （`api.tripo3d.ai`、`api.stepfun.com`、`api.evomap.ai`）。

### 2. 配置环境变量
```bash
cp .env.example .env
# 至少填入上游密钥（不填也能启动，但 3D / AI 对话会走降级占位）
vi .env
```

### 3. 构建并启动
```bash
docker compose up -d --build
```
首次构建约 5–10 分钟（需下载 base 镜像 + npm ci + vite 打包）。

### 4. 验证
```bash
# 容器状态（两个服务应为 healthy / running）
docker compose ps

# API 健康检查（经 nginx 同源）
curl http://127.0.0.1:8080/api/health
# 期望返回 {"ok":true,"service":"balabala-api",...}
```
浏览器打开 `http://<服务器IP>:8080` 即可。

---

## 端口说明

| 端口 | 服务 | 对外？ | 说明 |
|------|------|--------|------|
| `${WEB_PORT:-8080}` | nginx (web) | **是** | 唯一入口，浏览器/客户端访问端口 |
| 80 | nginx (容器内) | 否 | compose 映射到宿主 `${WEB_PORT}` |
| 8787 | Fastify (api) | 否 | 仅在 `balabala_internal` 内网可达 |

如需让 API 直连对外（调试用），取消 `docker-compose.yml` 中 `api.ports` 的注释，
并在 `.env` 设置 `PORT`。生产环境建议保持 API 不暴露。

---

## 环境变量完整参考

所有变量在 `.env` 中配置；`docker compose` 自动读取。下表中「必填」指**启用对应功能时必填**，
不填服务也能启动（对应功能降级）。

| 变量 | 含义 | 默认值 | 必填/选填 | 示例 |
|------|------|--------|-----------|------|
| `NODE_ENV` | Node 运行环境 | `production` | 选填 | `production` |
| `LOG_LEVEL` | Fastify 日志级别（fatal/error/warn/info/debug/trace） | `info` | 选填 | `info` |
| `PORT` | API 容器内监听端口 | `8787` | 选填 | `8787` |
| `WEB_PORT` | 宿主浏览器访问端口（映射 nginx:80） | `8080` | 选填 | `8080` |
| `DB_PATH` | SQLite 数据库文件路径（容器内） | `/data/app.db` | 选填 | `/data/app.db` |
| `BALABALA_CASES_FILE` | 兼容旧版案件 JSON 路径（兜底） | `/data/cases.json` | 选填 | `/data/cases.json` |
| `BALABALA_CONTENTS_FILE` | 兼容旧版广场内容 JSON 路径（兜底） | `/data/contents.json` | 选填 | `/data/contents.json` |
| `TRIPO_API_KEY` | Tripo 3D 生成 API Key | （空） | 3D 建模时必填 | `sk-xxxx` |
| `TRIPO_API_BASE_URL` | Tripo API 地址 | `https://api.tripo3d.ai/v2/openapi` | 选填 | 同上 |
| `STEPFUN_API_KEY` | StepFun（阶跃星辰）LLM Key | （空） | AI 对话时必填 | `sk-xxxx` |
| `STEPFUN_API_BASE_URL` | StepFun API 地址 | `https://api.stepfun.com/v1` | 选填 | 同上 |
| `STEPFUN_MODEL` | StepFun 模型名 | `step-3.5-flash` | 选填 | `step-3.5-flash` |
| `EVOMAP_API_KEY` | Evomap LLM Key | （空） | AI 对话时必填 | `sk-xxxx` |
| `EVOMAP_API_BASE_URL` | Evomap API 地址 | `https://api.evomap.ai/v1` | 选填 | 同上 |
| `EVOMAP_MODEL` | Evomap 模型名 | `evomap-deepseek-v4-flash` | 选填 | `evomap-deepseek-v4-flash` |
| `LLM_MAX_CONCURRENCY` | LLM 全局并发信号量（上游并发上限约 5，保守 4） | `4` | 选填 | `4` |
| `TRIPO_HTTPS_PROXY` | Node 访问 Tripo 的 HTTP(S) 代理 | （空，直连） | 服务器无法直连时填 | `http://host:port` |
| `HTTPS_PROXY` | 全局 HTTPS 代理（undici 读取） | （空） | 选填 | `http://host:port` |
| `HTTP_PROXY` | 全局 HTTP 代理 | （空） | 选填 | `http://host:port` |
| `CORS_ORIGIN` | 允许的跨域来源（保留项；当前同源反代无需） | （空，反射任意） | 选填 | `https://your.example.com` |
| `WS_MAX_CLIENTS` | WS 连接数上限提示（保留项；按资源规划） | （不限制） | 选填 | `200` |

---

## 数据卷与备份

- 数据全部落在命名卷 **`balabala_data`**，挂载到容器内 `/data`：
  - `app.db` —— SQLite 主库（案件、内容、用户、证书、狼人杀等所有持久化数据）
  - `cases.json` / `contents.json` —— 旧版 JSON 兜底（仅在未启用 SQLite 时产生）
- 离线知识库 `apps/api/data/offline-brains/*.json` 随镜像分发，**不属于用户数据**，无需备份。

### 备份
```bash
# 1) 停应用（避免 SQLite 写入中途拷贝），或用 SQLite 在线备份
docker compose stop api

# 2) 把卷里的数据拷到宿主
docker run --rm -v balabala_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/balabala-data-$(date +%F).tar.gz -C /data .

docker compose start api
```

### 恢复
```bash
docker compose stop api
docker run --rm -v balabala_data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/balabala-data-2026-01-01.tar.gz -C /data"
docker compose up -d
```

> 卷位置查看：`docker volume inspect balabala_data`。

---

## 日志查看

```bash
# 实时跟踪全部服务日志
docker compose logs -f

# 只看 API（Fastify pino JSON 日志）
docker compose logs -f api

# 只看 nginx 访问日志
docker compose logs -f web

# 最近 200 行并带时间戳
docker compose logs --tail=200 -t api
```
日志默认输出到容器 stdout/stderr，由 Docker 接管；如需对接 ELK/Loki，
配置 Docker 日志驱动或挂卷 `/var/lib/docker/containers` 即可。

---

## 升级步骤

```bash
# 1) 拉取最新代码
git pull

# 2) （可选）备份数据
docker compose stop api
docker run --rm -v balabala_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/pre-upgrade.tar.gz -C /data .

# 3) 重新构建并滚动重启（数据卷保留）
docker compose up -d --build

# 4) 验证
curl http://127.0.0.1:8080/api/health
docker compose ps
```

### 常见运维操作
```bash
docker compose restart api          # 只重启 API
docker compose down                 # 停止并删容器（卷保留）
docker compose down -v              # ⚠️ 同时删除数据卷（清空数据）
docker compose pull && docker compose up -d --build   # 重建镜像
```

---

## 故障排查

| 现象 | 排查 |
|------|------|
| `curl /api/health` 不通 | `docker compose ps` 看 api 是否 healthy；`docker compose logs api` |
| 页面打开但 AI 无响应 | 检查 `.env` 中 `STEPFUN_API_KEY` / `EVOMAP_API_KEY`，`/health` 会回显 `stepfunConfigured` |
| WebSocket 连不上 | 确认 nginx 反代带 `Upgrade` 头（已内置）；反向代理层勿漏 `Connection: upgrade` |
| 上游 API 超时 | 在 `.env` 配 `HTTPS_PROXY` 或 `TRIPO_HTTPS_PROXY` |
| 端口占用 | 改 `.env` 的 `WEB_PORT` |
