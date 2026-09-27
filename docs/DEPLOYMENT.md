# 公网部署指南（R5 发布版）

本指南把「叽里呱啦 BalaBala」以 Docker Compose 一键部署到公网一台 VPS。
对应编排文件在 `docker/`（R5 新增），与根目录既有 Dockerfile 并存；**首次公网发布以本目录为准**。

> 已有更细的专题文档可对照参考：`docs/https-setup.md`、`docs/stun-turn.md`、`docs/WEBRTC-TURN-GUIDE.md`、`docs/pwa-offline.md`。

---

## 0. 架构总览

```
                 ┌──────────────┐
   浏览器 ──443──▶│  nginx (TLS) │──/api/*, /api/ws──▶ api (Fastify, :3001)
   (PWA)         │              │──/  ────────────────▶ web (nginx 静态 PWA)
                 └──────┬───────┘
                        │ WebRTC 打洞失败时中继
                 ┌──────▼───────┐
                 │   coturn      │  :3478 / :5349 / 49152-49200/udp
                 └───────────────┘
```

- **api**：Fastify + WebSocket，`.data/` JSON 持久化（举报 logs、禁言 mutes/、结构化 reports/、UGC scenes/）。
- **web**：React + Vite 构建产物，PWA（HTTPS 必需）。
- **nginx**：HTTPS/WSS 终止 + 静态缓存 + WS upgrade。
- **coturn**：WebRTC 语音 TURN 中继，解决对称 NAT。

---

## 1. 所需资源清单

| 资源 | 说明 |
|---|---|
| VPS | ≥ 2 核 4G，公网 IP，Linux（Ubuntu 22.04 推荐） |
| 域名 | 已备案（国内）或免备案（海外），DNS A 记录指向 VPS IP |
| 端口 | 放行 80、443、3478(tcp/udp)、5349、49152-49200/udp |
| 证书 | Let's Encrypt 免费证书（certbot） |
| 上游账号 | StepFun（LLM）、Tripo（3D 建模）——留空走离线降级 |
| Docker | Docker Engine + docker compose plugin |

---

## 2. 步骤

### 2.1 DNS
把 `A 记录`：`@` 与 `www` 都指向 VPS 公网 IP。

### 2.2 安装 Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

### 2.3 申请 HTTPS 证书（certbot）
```bash
sudo apt install certbot -y
sudo certbot certonly --standalone -d example.com -d www.example.com
# 证书落在 /etc/letsencrypt/live/example.com/
```
把 `fullchain.pem` / `privkey.pem` 拷到 `docker/ssl/`（或用软链），与 `.env` 的 `SSL_CERT_PATH` 对齐。

### 2.4 配置环境变量
```bash
cd docker
cp .env.example .env
# 编辑 .env：DOMAIN、SSL_CERT_PATH、TURN_SECRET、WS_URL、上游 API Key
```

### 2.5 启动
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

### 2.6 验证
- `https://example.com/healthz` → `{"ok":true,...}`（经 nginx → api）
- 浏览器 DevTools → Network → `wss://example.com/api/ws` 101 Switching Protocols
- 手机 4G 下开「多人语音」，确认 TURN 中继连通（见 `docs/WEBRTC-TURN-GUIDE.md`）
- PWA：地址栏出现「安装」按钮（**必须 HTTPS**，http 下 ServiceWorker 不注册）

---

## 3. 关键约束

- **PWA 强制 HTTPS**：ServiceWorker / 推送 / 媒体录音仅在 `https://` 或 `localhost` 可用；http 公网域名会自动降级到 `offline.html` 且无法录音。
- **WSS 必须同源**：前端 `WS_URL=wss://<域名>/api/ws`，nginx 已配置 `Upgrade/Connection` 头。
- **coturn**：`TURN_SECRET` 为长期凭证密钥，**绝不**写进前端包；前端应经服务端 REST API 临时换 `username/credential`。
- **数据持久化**：`api_data` 卷挂载到容器 `/data`，备份该卷即含全部 JSON 数据。
- **admin 举报后台**：`GET /api/admin/reports`、`POST /api/admin/reports/:id/resolve` 当前**未接鉴权**，公网必须在 nginx 层加 IP 白名单或 Basic Auth（见 `docker/nginx/nginx.conf` 注释）。

---

## 4. 已知待真环境确认项

- HTTPS/WSS 端到端连通（含证书链完整）
- coturn 在对称 NAT / 移动网络下的中继成功率
- 审核词表命中率与误伤（需运营灰度调词表）
- 并发：当前单实例，WS 内存态禁言表重启后从 `.data/mutes/` 恢复
