# WebRTC STUN / TURN 部署指南（Round4 R4-04）

> 本文说明如何为「叽里呱啦 BalaBala」广场语音部署 **coturn** 中继服务器，
> 让处在对称 NAT（公司内网、手机 4G、严格防火墙）后的玩家也能互相语音通话。
>
> ⚠️ **注意**：coturn 安装与防火墙配置需要 `sudo/root` 权限。本项目的开发云环境
> 没有 root、也没有物理声卡，**无法在这里真机演示**；以下仅提供配置模板与步骤，
> 请在你自己的 VPS（Ubuntu/Debian）上按步骤执行。

---

## 1. 为什么需要 TURN

WebRTC 打 P2P 时靠 STUN 服务器交换公网地址：

- **同一个 WiFi / 内网**：直接通，不需要任何服务器。
- **普通家庭 NAT**：公共 STUN（Google `stun.l.google.com:19302`）即可打通。
- **对称 NAT（Symmetric NAT）**：运营商 4G、公司防火墙、酒店网络——STUN 交换到的地址不可达，P2P 失败。
  这时必须用 **TURN 中继**：双方都把媒体流发到你的 TURN 服务器，由它转发，成功率接近 100%。

广场语音在 STUN 打不通时，前端会自动回落到「文字喊话」（头顶气泡），见
`apps/web/src/voice/voice-fallback.ts`。TURN 是为了让语音在最差网络下也能通。

---

## 2. 安装 coturn（Ubuntu/Debian VPS，需 root）

```bash
sudo apt update
sudo apt install -y coturn
```

启用服务（开机自启）：

```bash
sudo systemctl enable coturn
sudo systemctl start coturn
```

---

## 3. 配置 coturn

编辑 `/etc/turnserver.conf`（或 `/etc/coturn/turnserver.conf`，按发行版）：

```ini
# 监听端口
listening-port=3478
# TLS/DTLS 端口（配合 Nginx 反代 WSS 时可只开本地）
tls-listening-port=5349

# 你的 VPS 公网 IP（必填，否则候选地址不对）
external-ip=YOUR_VPS_PUBLIC_IP

# 长期凭证（静态账号密码；生产建议用下面第 5 节的 REST 临时凭证）
fingerprint
lt-cred-mech
user=balabala:change-me-strong-password

#  realms
realm=your-turn.example.com
server-name=your-turn.example.com

# 日志
log-file=/var/log/turnserver.log

# 安全：不允许明文 relay（可选）
# no-cli
# no-tcp-relay
```

重启生效：

```bash
sudo systemctl restart coturn
```

---

## 4. 防火墙放行

TURN 需要同时放 UDP（主）和 TCP（兜底）：

```bash
# ufw 示例
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# relay 端口范围（coturn 默认 49152-65535），一般只需在云厂商安全组放行 UDP
# 云厂商控制台安全组：放行 UDP 3478 与 UDP 49152:65535
```

验证（在本机/另一台机器）：

```bash
# 装好 turnutils 后测试分配
turnutils_uclient -u balabala -w change-me-strong-password -p 3478 YOUR_VPS_PUBLIC_IP
```

在线测试：<https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>
填入你的 TURN 配置，看是否能拿到 `relay` 类型的 candidate。

---

## 5. 临时凭证（REST API，推荐生产用）

静态密码泄露后所有人都能用你的中继（烧流量）。coturn 支持「时间窗口临时凭证」：

- 服务端保存一个共享密钥 `AUTH_SECRET`。
- 前端要连 TURN 时，向后端请求一对短期 `username / credential`：
  - `username = 过期时间戳:用户id`
  - `credential = base64(HMAC-SHA1(AUTH_SECRET, username))`
- coturn 用同一个密钥校验，**不用把长期密码写进前端代码**。

后端伪代码（Node）：

```js
import crypto from 'crypto'
const SECRET = process.env.TURN_AUTH_SECRET
export function tempTurnCreds(userId: string) {
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600 // 12 小时有效
  const username = `${expiry}:${userId}`
  const credential = crypto.createHmac('sha1', SECRET).update(username).digest('base64')
  return { urls: ['turn:your-turn.example.com:3478'], username, credential }
}
```

coturn 端启用：在 `turnserver.conf` 加

```ini
use-auth-secret
static-auth-secret=YOUR_LONG_RANDOM_SECRET
```

前端进入广场前调用一次该接口，把返回的 ICE server 注入 `RTCPeerConnection`。

---

## 6. Nginx 反向代理 WSS（给 HTTPS 站点用）

生产环境前端是 `https://`，浏览器要求 WebRTC 的 TURN 也走 `turns:`（TLS）或至少同源。
把 WSS（WebSocket 信令）反代到后端 API：

```nginx
server {
  listen 443 ssl http2;
  server_name your-app.example.com;

  ssl_certificate     /etc/letsencrypt/live/your-app.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-app.example.com/privkey.pem;

  # 静态前端
  root /var/www/balabala/dist;
  index index.html;

  # REST API
  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # WebSocket 信令（带 Upgrade 头）
  location /api/ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400; # 长连接不超时
  }

  # TURN over TLS（turns:）可选：把 5349 直接交给 coturn，不经过 Nginx
}
```

HTTP 跳转 HTTPS：

```nginx
server {
  listen 80;
  server_name your-app.example.com;
  return 301 https://$host$request_uri;
}
```

---

## 7. 前端接入

配好后在 `.env` 填入（参考 `.env.example`）：

```bash
VITE_STUN_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
VITE_TURN_SERVERS=[{"urls":["turn:your-turn.example.com:3478"],"username":"balabala","credential":"change-me-strong-password"}]
```

`apps/web/src/voice/useSpatialVoice.ts` 里把这些环境变量读进 `RTCConfiguration.iceServers`
（当前代码用默认 Google STUN；接入 TURN 时在此合并 `VITE_TURN_SERVERS`）。

---

## 8. 验证清单（真机，需两台不同网络的设备）

- [ ] 两台设备都连同一个 WiFi：语音通（说明 P2P/STUN OK）。
- [ ] 一台切手机 4G，一台连 WiFi：
  - 通 → STUN 够了；
  - 不通但 TURN 配上后通 → TURN 中继生效；
  - 还不通 → 检查 coturn 日志 `/var/log/turnserver.log`、防火墙 relay 端口范围。
- [ ] 故意断麦克风 → 前端弹出权限引导 + 自动切「文字喊话」，头顶气泡可见。

> 本云环境无物理声卡、无 root，以上真机项无法自动化验证，已在代码中注释标注。
