# 叽里呱啦 · BalaBala 公网生产部署指南

> 本文档是**从零把「叽里呱啦」部署到一台你自己的公网服务器**的完整落地手册。
> 沙箱/开发环境无法直接跑公网，因此第一步先列清楚你需要自备的资源。
>
> 适用形态：`docker compose --profile production up -d --build`（四服务：api / web / gateway / coturn）。
>
> 架构回顾：
>
> ```
> 浏览器 ──HTTPS/443──▶ gateway(nginx, TLS终止+安全头)
>                          │  全部反代到 web:80
>                          ▼
>                        web(nginx, 静态SPA + /api反代) ──▶ api(Fastify:8787)
>
> 浏览器 WebRTC ──UDP/TCP 3478 + UDP 49152-65535──▶ coturn(host网络)
> ```

---

## 一、用户自备资源清单（动手前先备齐）

### 1.1 服务器

| 项 | 最低 | 推荐 | 说明 |
|---|---|---|---|
| CPU | 2 核 | 4 核 | api 跑 LLM 流式 + 3D 生成，CPU 密集 |
| 内存 | 4 GB | 8 GB | WS 房间中继、coturn 并发 allocation |
| 磁盘 | 40 GB SSD | 80 GB SSD | SQLite + 上传的 3D 模型 + 备份 |
| OS | Ubuntu 22.04 LTS / Debian 12 | Ubuntu 24.04 LTS | 本文命令以 apt 为例 |
| 带宽 | 5 Mbps | 10 Mbps 起 | TURN 中继按并发用户线性吃带宽，见 1.5 |
| 公网 IP | 必须（独立公网 IPv4） | 固定 IP | coturn external-ip 必须固定 |

> 云厂商任选：阿里云 ECS / 腾讯云 CVM / 华为云 / AWS EC2 / 雨云/RackNerd 等均可。
> **注意**：部分便宜 VPS 是 NAT 共享 IP，无法自己开大量 UDP 端口做 TURN——务必选「独立公网 IP」机型。

### 1.2 必须放行的端口与安全组

| 端口 | 协议 | 用途 | 谁能访问 |
|---|---|---|---|
| 22 | TCP | SSH 运维 | 仅你的办公 IP |
| 80 | TCP | gateway：ACME 证书验证 + HTTP→HTTPS 跳转 | 0.0.0.0/0 |
| 443 | TCP | gateway：HTTPS / WSS | 0.0.0.0/0 |
| 3478 | TCP+UDP | coturn：STUN/TURN 信令 | 0.0.0.0/0 |
| 49152–65535 | UDP | coturn：媒体中继端口段 | 0.0.0.0/0 |

> 不需要对外暴露：8787（api，仅内网）、8080（web，生产建议绑 127.0.0.1）。
> 5349（TURN over TLS/DTLS）默认未开证书，需要时再放行。

**云安全组配置示例**

- **阿里云 ECS**：控制台 → 实例 → 安全组 → 入方向添加：
  - TCP 80/443 授权对象 0.0.0.0/0
  - UDP 3478、TCP 3478 授权对象 0.0.0.0/0
  - UDP 端口段 `49152/65535` 授权对象 0.0.0.0/0
  - 22 端口授权对象改为你的固定办公 IP（不要开 0.0.0.0/0）
- **腾讯云 CVM**：轻量应用服务器 → 防火墙 / 云服务器 → 安全组，规则同上。
- **AWS EC2**：Security Group → Inbound rules 添加上述协议端口；注意 AWS 控制台「端口范围」填 `49152-65535`，类型选 Custom UDP。

**宿主机 ufw 同步配置**（云安全组之外，系统层再兜一层）：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49152:65535/udp
sudo ufw enable
```

### 1.3 域名与 DNS

1. 准备一个域名（如 `balabala.example.com`）。
2. 在 DNS 控制台添加 **A 记录**：`@`（和 `www` 如需）→ 服务器公网 IP。
3. 验证解析已生效（**部署前在本地执行**，必须返回服务器 IP）：

   ```bash
   dig +short balabala.example.com
   # 期望输出：你的服务器公网 IP
   ```

> 没有域名也能跑（用 IP 自签证书），但浏览器会报不安全警告，且 WSS 要求安全上下文——**强烈建议有域名**。

### 1.4 TLS 证书（三选一，推荐 Let's Encrypt）

| 方式 | 适合 | 说明 |
|---|---|---|
| **Let's Encrypt + certbot**（推荐） | 有域名、80 可通 | 免费，90 天自动续期 |
| 云厂商免费证书 | 已用阿里云/腾讯云 | 下载 Nginx 版 PEM，手动放进 certs 卷 |
| 自签名 | 内网/临时测试 | 浏览器不信任，仅排障用 |

certbot 安装与签发见下文「第 4 步」。

### 1.5 coturn 与带宽规划

- coturn 用 **host 网络**跑在同一台服务器（compose 已写 `network_mode: host`），
  因此 3478 与 49152–65535 直接占用宿主端口，安全组必须整段放行 UDP。
- 每条 TURN 中继流双向各占一份带宽。粗略估算：
  - 空间语音（Opus）约 **30–80 kbps/路/方向**。
  - 10 人房间若全部走中继 ≈ 10 人 × 2 方向 × 60 kbps ≈ **1.2 Mbps**。
  - 同时有 10 个这样的房间 ≈ 12 Mbps——这就是推荐 10 Mbps 起步的原因。
- 带宽不够时优先优化：多数客户端 P2P 打洞成功后不走中继，TURN 只是兜底；
  可在 `deploy/coturn/turnserver.conf` 调小 `total-quota` / `user-quota` 限制并发。

---

## 二、全新服务器从零部署

> 以下命令在服务器上以 sudo/root 执行，假设仓库克隆到 `/opt/balabala`。

### 第 0 步：登录并升级系统

```bash
ssh root@<服务器公网IP>
apt update && apt upgrade -y
```

### 第 1 步：安装 Docker 与 Compose 插件

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version   # 确认 v2 插件可用
```

### 第 2 步：（可选）配置 ufw 防火墙

按 1.2 表格配置；先别 enable 以免把自己 SSH 断开——确认 22 已放行再 `ufw enable`。

### 第 3 步：克隆仓库并配置环境变量

```bash
mkdir -p /opt && cd /opt
git clone <你的仓库地址> balabala
cd balabala
cp .env.example .env
```

编辑 `.env`，至少改这些：

```dotenv
DOMAIN=balabala.example.com
# 生产形态：web 容器只绑回环，避免 8080 绕过 HTTPS
WEB_HOST=127.0.0.1
WEB_PORT=8080

# coturn
TURN_REALM=balabala.example.com
TURN_USER=balabala
TURN_PASSWORD=<openssl rand -base64 24 生成>
TURN_EXTERNAL_IP=<服务器公网IP>

# 上游密钥（留空则对应功能降级）
STEPFUN_API_KEY=...
TRIPO_API_KEY=...
```

### 第 4 步：获取 TLS 证书（Let's Encrypt）

先确保 DNS 已解析到本机、80 端口已放行。用 webroot 方式（gateway 容器已把
`./deploy/letsencrypt` 挂到 `/var/www/letsencrypt`，但首次申请时 gateway 还没起，
先用 certbot standalone 或临时 python 起 80）：

```bash
apt install -y certbot
mkdir -p /opt/balabala/deploy/letsencrypt/.well-known/acme-challenge

# 方式 A：standalone（临时占用 80，确保此时 80 没被别的进程占）
certbot certonly --standalone -d balabala.example.com --agree-tos -m you@example.com --no-eff-email

# 证书落在：
#   /etc/letsencrypt/live/balabala.example.com/fullchain.pem
#   /etc/letsencrypt/live/balabala.example.com/privkey.pem
```

**把证书分发进 gateway 的 `certs` 命名卷**（gateway 容器从 `/etc/nginx/certs/` 读）：

> `.env` 里的 `CERT_PATH` 指向宿主证书目录（本例 `/etc/letsencrypt/live/balabala.example.com`），
> 下面的命令直接引用它。

```bash
# 先确保卷存在（首次 up 后会自动建；没有则手动建）
docker volume create balabala_certs

docker run --rm \
  -v balabala_certs:/etc/nginx/certs \
  -v "${CERT_PATH:-/etc/letsencrypt/live/balabala.example.com}:/from:ro" \
  alpine sh -c "cp /from/fullchain.pem /from/privkey.pem /etc/nginx/certs/"
```

**配置自动续期**（certbot renew 后自动刷新进卷）：

```bash
# 续期钩子：证书更新后重新拷贝进卷并 reload gateway
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/balabala.sh <<'HOOK'
#!/bin/bash
set -e
docker run --rm \
  -v balabala_certs:/etc/nginx/certs \
  -v /etc/letsencrypt/live/balabala.example.com:/from:ro \
  alpine sh -c "cp /from/fullchain.pem /from/privkey.pem /etc/nginx/certs/"
docker exec balabala-gateway nginx -s reload || true
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/balabala.sh

# 测试续期流程（不会真的续）：
certbot renew --dry-run
```

> 之后 systemd 的 certbot.timer 会自动 `renew`，钩子自动刷新证书 + reload gateway。

### 第 5 步：一键拉起四服务

```bash
cd /opt/balabala
docker compose --profile production up -d --build
```

观察启动顺序：api(healthy) → web(healthy) → gateway(healthy)；coturn 独立起。

```bash
docker compose ps
docker compose logs -f api gateway coturn
```

### 第 6 步：验证（详见第三节）

### 第 7 步：配置备份定时任务

仓库自带 `scripts/backup.sh`（SQLite 一致性快照 + JSON，自动保留 28 天）。
容器化部署时数据在命名卷 `balabala_data`，先把 db 路径指到卷内：

```bash
# 从 api 容器里看 db 实际路径（默认 /data/app.db）
docker compose exec api ls -l /data

# 用 cron 每天凌晨 3 点备份（数据在命名卷，借容器 tar 出来）
crontab -e
# 加入：
0 3 * * * docker run --rm -v balabala_data:/data -v /opt/balabala/backups:/backups alpine \
  sh -c "cp -a /data/app.db* /data/*.json /backups/ 2>/dev/null; cd /backups && tar -czf balabala-$(date +\%Y\%m\%d-\%H\%M\%S).tar.gz app.db* *.json 2>/dev/null && rm -f app.db* *.json"
```

> 恢复：`docker run --rm -v balabala_data:/data -v /opt/balabala/backups:/backups alpine sh -c "cd /data && tar -xzf /backups/<备份包>.tar.gz"`。
> 建议同时把备份包对象存储（OSS/COS/S3），脚本里已留上传示例。

### 第 8 步：CI/CD 衔接

- **手动**：发版后服务器 `cd /opt/balabala && git pull && docker compose --profile production up -d --build`。
- **GitHub Actions 自动**（推荐）：在 `.github/workflows/` 加一个 deploy job，
  通过 SSH（`appleboy/ssh-action`）在 push 到 main 后执行上面的 pull/build 命令；
  或部署一个 webhook 接收端触发。首次可先手动跑通再接 CI。

---

## 三、HTTPS / WSS / coturn 全链路验证

### 3.1 基础 HTTP 探测（在本地或服务器上）

```bash
# api 存活（经 gateway → web → api）
curl -i https://balabala.example.com/healthz
curl -i https://balabala.example.com/health

# 首页 HTML
curl -I https://balabala.example.com/

# HTTP 应 301 到 HTTPS
curl -I http://balabala.example.com/
```

### 3.2 浏览器验证

1. 打开 `https://balabala.example.com`，正常进入应用。
2. **DevTools → Security 面板**：证书有效、颁发者 Let's Encrypt、无红字。
3. **DevTools → Network**：
   - 筛 `WS`，进入一个房间后应看到 `wss://balabala.example.com/api/ws` 101 Switching Protocols。
   - 普通接口 200，控制台无混合内容（mixed content）报错。
4. 手机 4G（非同一内网）打开，确认公网可达。

### 3.3 coturn 连通性（trickle ICE）

1. 打开 <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>。
2. 添加你的 TURN 服务器：
   - STUN/TURN URL：`turn:balabala.example.com:3478?transport=udp`
   - Username：`.env` 里的 `TURN_USER`
   - Credential：`.env` 里的 `TURN_PASSWORD`
3. 点 Gather candidates，**应看到一条 `relay` 类型的 candidate，地址是你的公网 IP**。
   - 只有 `host` / `srflx` 没有 `relay` → coturn 不通（查安全组 3478/UDP、external-ip、凭据）。

> 前端要真正用上 TURN，需在 `apps/web` 的 RTC 配置里把这个 TURN 服务器加进
> `iceServers`（当前默认只带 Google STUN；生产部署后追加，见 `docs/stun-turn.md`）。

---

## 四、回滚与升级

### 常规升级

```bash
cd /opt/balabala
git pull
docker compose --profile production up -d --build
# 观察 healthcheck 全绿
docker compose ps
```

### 镜像版本管理

- 上面 `up -d --build` 总是打 `:latest`。要可回滚，建议给镜像打 git sha 标签：

  ```bash
  TAG=$(git rev-parse --short HEAD)
  docker compose build api web gateway
  docker tag balabala/api:latest balabala/api:$TAG
  ```

- 回滚到上一版：

  ```bash
  git checkout <上一个稳定commit>
  docker compose --profile production up -d --build
  ```

- 数据兼容：api 的 SQLite schema 若有迁移，发版说明里会写；
  回滚前先 `scripts/backup.sh` 打快照。

---

## 五、故障排查（FAQ）

| 现象 | 排查 |
|---|---|
| `curl https://域名/healthz` 连接超时 | 云安全组/ufw 没放 443；`docker compose ps` gateway 没起；`docker compose logs gateway` 看 nginx 报错（常是证书文件不存在） |
| 浏览器证书警告 | 证书没分发进 `certs` 卷；确认 `/etc/nginx/certs/fullchain.pem` 存在且未过期 `certbot certificates` |
| 80 能通、443 不通 | 安全组只放了 80；gateway 容器没监听 443（`docker compose logs gateway`） |
| WS 一直 connecting / 几秒就断 | gateway 到 web 的 Upgrade 头未透传（检查 `nginx.conf` 的 `map $http_upgrade`）；或中间运营商拦 WSS；查 DevTools Console 混合内容 |
| TURN 没有 relay candidate | 3478/UDP 未放行（最常见）；`TURN_EXTERNAL_IP` 填成内网 IP；`TURN_USER/PASSWORD` 前端与 coturn 不一致；coturn 日志 `docker compose logs coturn` |
| coturn 中继端口不通 | host 网络下安全组没放行整段 UDP 49152-65535；云厂商可能限制高端口段，换机型/提工单 |
| api 容器 unhealthy | `docker compose logs api`；常见是上游 LLM key 缺失导致启动报错、或 `/data` 权限 |
| 8080 端口公网可访问 | `.env` 里 `WEB_HOST` 没设成 `127.0.0.1`，重新 `docker compose up -d` |
| 证书续期失败 | `certbot renew --dry-run`；确认 80 的 ACME 路径能访问 `https://域名/.well-known/acme-challenge/xxx`；gateway 已挂 `./deploy/letsencrypt` |
| 升级后白屏 | 强刷（Ctrl+Shift+R）清 PWA 缓存；旧 service worker 未更新；查 `apps/web/dist` 是否构建成功 |

### 常用应急命令

```bash
docker compose ps                       # 服务状态
docker compose logs --tail=100 gateway # 看反代日志
docker compose exec gateway nginx -t    # 校验 gateway 配置
docker compose exec api wget -qO- localhost:8787/healthz   # 容器内直探 api
docker compose restart gateway          # 只重启反代
```

---

## 附：相关文档

- 快速/内网部署：`docs/deployment.md`、`docs/self-hosting.md`
- HTTPS 细节：`docs/https-setup.md`
- STUN/TURN 原理与前端接入：`docs/stun-turn.md`
- 备份与迁移：`docs/backup-migration.md`、`scripts/backup.sh`
