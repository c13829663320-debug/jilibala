# 真人多人房间 · 部署与组网方案

## 概述

Round3 真人多人房间需要 **WebSocket 实时中继** + **WebRTC P2P 语音**。两者对网络有不同要求：

| 组件 | 协议 | 要求 |
|---|---|---|
| 房间中继（位置/动作/表情/信令） | WebSocket (WS/WSS) | 客户端需能访问 API 服务的 `/api/ws` |
| 空间语音 | WebRTC (UDP/TCP) | P2P 直连优先，需 STUN 服务器辅助 NAT 穿越；对称 NAT 需 TURN 中继 |

开发环境（`npm run dev`）已通过 Vite 代理将 `/api`（含 WS）转发到 API 服务，单机多开浏览器即可联调。

---

## 方案一：本地多开联调（零部署）

**适用**：开发验证、同一台机器多个浏览器标签/实例。

```bash
# 项目根目录
npm install
npm run dev
# API: http://localhost:8787  Web: http://localhost:5173
```

1. 打开两个浏览器窗口（或正常模式 + 无痕模式，确保不同 userId）
2. 均访问 http://localhost:5173
3. A：首页 → 多人房间 → 创建房间 → 进入广场
4. B：首页 → 多人房间 → 加入房间码 → 输入 A 的房间码 → 进入
5. 双方可见彼此化身，点击右下角麦克风按钮授权后开启空间语音

> WebRTC 在 `localhost` 下无需 HTTPS 即可获取麦克风权限。

---

## 方案二：局域网部署（多设备同 WiFi）

**适用**：办公室/家庭内多台电脑/手机一起玩。

### 步骤

1. **找到开发机的局域网 IP**（如 `192.168.1.100`）

2. **启动服务并监听所有网卡**：
   ```bash
   # API 默认监听 0.0.0.0:8787（Fastify）
   # Web 需显式监听 0.0.0.0
   npm run dev:api &
   cd apps/web && npx vite --host 0.0.0.0 --port 5173
   ```

3. **其他设备访问** `http://192.168.1.100:5173`

4. **WebSocket 自动走 Vite 代理**（`/api/ws` → `localhost:8787`），无需额外配置。

5. **WebRTC 语音**：局域网内 P2P 直连通常无需 STUN/TURN，同一子网下直接互通。

> 注意：手机浏览器要求 HTTPS 才能获取麦克风权限。局域网 HTTP 下语音可能不可用，可使用 `mkcert` 生成本地证书，或参考方案三的 HTTPS 配置。

---

## 方案三：公网部署（VPS + 反向代理）

**适用**：互联网用户随时随地加入。推荐使用任意 VPS（阿里云/腾讯云/AWS/DigitalOcean 等）。

### 3.1 生产构建

```bash
npm install
npm run build
# 产物：
#   apps/api/dist/          (tsc 输出)
#   apps/web/dist/          (vite 构建 + PWA)
```

### 3.2 启动生产服务

```bash
# API（Node 进程）
cd apps/api && node dist/server.js
# 默认端口 8787，可用 PORT 环境变量覆盖

# Web 静态文件（用任意静态服务器）
cd apps/web/dist && npx serve -l 5173
# 或用 nginx/caddy 托管
```

### 3.3 Nginx 反向代理（推荐）

将 Web 静态文件 + API + WebSocket 统一在 443 端口：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Web 静态资源
    root /var/www/balabala/web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API + WebSocket 反代
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;

        # WebSocket 升级头
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WS 长连接超时
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # /health 直连
    location = /health {
        proxy_pass http://127.0.0.1:8787/health;
    }
}
```

### 3.4 HTTPS 证书

```bash
# Let's Encrypt 免费证书
sudo certbot --nginx -d your-domain.com
```

HTTPS 是必须的：浏览器在非安全上下文（HTTP 公网）下会拒绝 `getUserMedia`（麦克风），WebRTC 也无法建立。

### 3.5 WebRTC STUN/TURN

- **STUN**：代码已配置 Google 公共 STUN (`stun:stun.l.google.com:19302`)，大多数家用网络 NAT 可穿越。
- **TURN**（对称 NAT/企业防火墙下必需）：自行部署 [coturn](https://github.com/coturn/coturn)：
  ```bash
  sudo apt install coturn
  # /etc/turnserver.conf 配置：
  listening-port=3478
  tls-listening-port=5349
  realm=your-domain.com
  server-name=your-domain.com
  lt-cred-mech
  user=balabala:your-secure-password
  ```
  然后在 `apps/web/src/voice/useSpatialVoice.ts` 的 `DEFAULT_RTC_CONFIG` 中增加 TURN 服务器：
  ```typescript
  const DEFAULT_RTC_CONFIG: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:your-domain.com:3478', username: 'balabala', credential: 'your-secure-password' },
    ],
  }
  ```

### 3.6 环境变量

API 服务读取以下环境变量（`.env` 文件或系统环境）：

| 变量 | 说明 | 多人房间必需 |
|---|---|---|
| `PORT` | API 端口，默认 8787 | 否 |
| `STEPFUN_API_KEY` | StepFun LLM 密钥 | 否（场景游戏需要） |
| `STEPFUN_API_BASE_URL` | StepFun API 地址 | 否 |
| `EVOMAP_API_KEY` | EvoMap 备用 LLM | 否 |
| `TRIPO_API_KEY` | Tripo 3D 生成 | 否 |

> 多人房间核心功能（WS 中继 + WebRTC 信令）**不需要任何 AI 密钥**，纯实时通信。

---

## 方案四：Docker 一键部署

```dockerfile
# Dockerfile（多阶段构建）
FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install && npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./api/dist
COPY --from=builder /app/apps/web/dist ./web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json .
EXPOSE 8787
CMD ["node", "api/dist/server.js"]
```

配合 nginx 容器做静态托管 + 反代，或用 Caddy 自动 HTTPS：

```Caddyfile
your-domain.com {
    root * /var/www/web/dist
    file_server
    reverse_proxy /api/* localhost:8787
}
```

---

## 云端环境限制说明

本项目在 Linux 云开发环境中验证时遇到以下限制：

1. **无 GPU / 硬件 WebGL**：3D 场景使用 SwiftShader 软件渲染，CPU 占用极高，可能导致浏览器事件循环饥饿、WebSocket 频繁重连。**真机（有 GPU）无此问题**。
2. **ngrok / cloudflared 隧道被安全策略阻断**：无法将本地端口暴露到公网。需自行部署到 VPS（方案三）。
3. **无物理声卡**：多开联调使用 `--use-fake-device-for-media-stream` 假音频设备验证 WebRTC 链路。

## 联调验证结果

详见 `qa-results/multiplayer/REPORT.md`：
- ✅ 房间创建/加入（6位房间码）
- ✅ 双客户端同房间、化身互相可见
- ✅ 在线人数实时同步
- ⚠️ 位置/语音同步：代码逻辑正确（单元测试覆盖 + WebRTC createOffer 验证），云端软件渲染环境导致 WS 不稳定，建议真机复测
