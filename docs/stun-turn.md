# STUN / TURN 部署文档（coturn）

> 多人房间的**空间语音**基于 WebRTC（实装于 `apps/web/src/voice/useSpatialVoice.ts`，`RTCPeerConnection` 已在生产代码中创建）。STUN/TURN 用于 NAT 穿越：
>
> - **STUN**：帮客户端发现自己的公网地址映射。当前代码已内置 Google 公共 STUN `stun:stun.l.google.com:19302`，绝大多数家用宽带 NAT 可直接 P2P 打洞成功。
> - **TURN**：对称 NAT（运营商 CGNAT、严格企业防火墙）下 P2P 打洞失败时，用 TURN 服务器**中继**媒体流，保证通话不黑屏。
>
> 结论：**Google STUN 即可覆盖多数场景；自部署 coturn TURN 是生产环境的对称 NAT 兜底**。以下为完整部署指南。
>
> 配套配置：[`../deploy/coturn/turnserver.conf`](../deploy/coturn/turnserver.conf)；HTTPS 前提见 [`https-setup.md`](./https-setup.md)。

---

## 1. 架构与端口

```
浏览器 A ──UDP/TLS──▶ coturn:3478/5349 ──relay──▶ 浏览器 B
                        (UDP 中继端口 49152-65535)
```

| 端口 | 协议 | 用途 |
|---|---|---|
| 3478 | UDP + TCP | STUN/TURN 明文主端口 |
| 5349 | TLS/DTLS | TURN over TLS（可选，企业墙只放 443 时可改） |
| 49152–65535 | UDP | 媒体中继端口范围（`min-port`/`max-port`） |

> TURN 媒体走 **UDP** 为主；只放行 TCP 会大幅降低语音质量并增加延迟。

---

## 2. 安装 coturn

### 2.1 apt 安装（Debian/Ubuntu）

```bash
sudo apt update
sudo apt install -y coturn

# 开启开机自启（Debian 包默认安装后不启动，需要显式打开）
sudo systemctl edit --full coturn
# 把 ExecStart 指向你的配置文件，或直接用默认 /etc/turnserver.conf
sudo systemctl enable --now coturn
```

### 2.2 Docker 安装

```bash
docker run -d --name coturn \
  --network=host \
  --restart=unless-stopped \
  -v /etc/coturn/turnserver.conf:/etc/coturn/turnserver.conf \
  coturn/coturn:latest \
  -c /etc/coturn/turnserver.conf
```

> `--network=host` 是 coturn 在 Docker 下最省心的方式：否则 `-p` 映射 UDP 高位端口范围非常繁琐，且 `external-ip` 仍要正确设置。

---

## 3. 配置

把 [`../deploy/coturn/turnserver.conf`](../deploy/coturn/turnserver.conf) 拷到 `/etc/turnserver.conf`（apt）或 `/etc/coturn/turnserver.conf`（Docker），**必改三处**：

```ini
external-ip=203.0.113.10                 # ← 改成服务器真实公网 IP
realm=your-domain.com                    # ← 改成你的域名
user=balabala:CHANGE_ME_to_a_long_random_password   # ← 改成强密码
```

生成强随机密码：

```bash
openssl rand -base64 24
```

启动 / 重启：

```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

---

## 4. 凭据生成与轮换

### 4.1 静态凭据（简单，单机）

配置文件里的 `user=balabala:<password>` 就是静态账号密码。前端 `RTCConfiguration` 里写死同一份。

轮换步骤：

```bash
# 1. 改 turnserver.conf 里的 user= 为新凭据
# 2. 重启 coturn
sudo systemctl restart coturn
# 3. 同步更新前端 iceServers（见第 6 节）并发版
# 4. 老凭据在 coturn 重启后即失效
```

> 注意：静态凭据写在前端 JS 里，任何人都能 F12 看到。**这只防君子不防小人**——如果你的 TURN 带宽计费昂贵，建议用下面的临时凭据方案。

### 4.2 临时凭据（REST API + 时间戳，生产推荐）

coturn 支持「用共享密钥 HMAC 生成短期用户名/密码」（TURN REST API）：

- 共享密钥：在 `turnserver.conf` 加 `static-auth-secret=<随机长串>`
- 后端（Fastify API）在客户端进入房间时签发：
  - `username = <过期时间戳>:<用户标识>`，例如 `1735689600:user-abc`
  - `credential = base64(HMAC-SHA1(shared_secret, username))`
- 前端拿到后临时填入 `iceServers`，到期自动失效。

这样**密码不进前端代码**，可按用户限流、可即时吊销。本项目当前版本尚未实现该端点，列入后续优化；现阶段先用静态凭据 + 强密码即可。

---

## 5. 防火墙 / 安全组放行

按你云厂商的安全组 + 主机防火墙两层放行：

```bash
# ufw（Debian/Ubuntu）
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp

# firewalld（RHEL/CentOS）
sudo firewall-cmd --permanent --add-port=3478/udp
sudo firewall-cmd --permanent --add-port=3478/tcp
sudo firewall-cmd --permanent --add-port=5349/tcp
sudo firewall-cmd --permanent --add-port=49152-65535/udp
sudo firewall-cmd --reload
```

**云厂商安全组**（阿里云 / 腾讯云控制台）同样要放行上述 UDP/TCP 端口，否则 ufw 放行了也连不上。

> 安全提示：3478 是公开服务端口，**不要**额外暴露 coturn 的 CLI/管理端口；`no-admin` 已在配置里关掉。

---

## 6. 与应用集成（前端 ICE servers 配置位置）

文件：**`apps/web/src/voice/useSpatialVoice.ts`**，函数上方的 `DEFAULT_RTC_CONFIG`（当前约第 73 行）。

当前（仅 Google STUN）：

```typescript
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
```

接入自部署 TURN 后改为：

```typescript
const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:your-domain.com:3478?transport=udp',
        'turn:your-domain.com:3478?transport=tcp',
        // 'turns:your-domain.com:5349?transport=tcp',  // 配了 TLS 证书再开
      ],
      username: 'balabala',
      credential: '<与 turnserver.conf 中 user= 一致的密码>',
    },
  ],
};
```

改完重新构建前端：

```bash
npm run build -w apps/web
# 产物 apps/web/dist/ 由 nginx 托管，reload 后生效
```

> 域名用 `your-domain.com` 而非 IP，是因为 TURN over TLS(5349) 需要证书与域名匹配。3478 明文 UDP 下用 IP 也可。

---

## 7. 验证方法

### 7.1 服务器侧

```bash
# 端口监听
sudo ss -ulnp | grep 3478
sudo ss -tlnp | grep 3478

# 日志（打洞失败时看这里）
sudo tail -f /var/log/coturn/turnserver.log
```

### 7.2 在线工具 trickle-ice

打开 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ ：

1. 在 **STUN or TURN URI** 填 `turn:your-domain.com:3478?transport=udp`
2. **username** / **credential** 填 turnserver.conf 里的 `user=`
3. 点 **Add Server** → **Gather candidates**
4. 结果里应出现 `type: relayed` 的候选（带你 TURN 服务器公网 IP）。
   - 只有 `host` / `srflx` 没有 `relayed` → TURN 凭据或端口不通。
   - 完全没有候选 → STUN/TURN 地址错误或被防火墙拦。

### 7.3 真机联调

两台**不同网络**的手机/电脑（一个用 WiFi、一个切 4G）加入同一房间：

- 能通话 → P2P 或中继正常。
- 一方能听见、另一方听不见 → 通常是单边对称 NAT，确认 relayed 候选已被使用。

---

## 8. 预留 / 未来启用说明

- **当前版本**：WebRTC 空间语音已实装（`useSpatialVoice.ts`），Google STUN 默认开启；自部署 TURN 为生产对称 NAT 兜底，按本文启用即可，无需改其他代码。
- **未来增强**：
  - TURN REST API 临时凭据（见 4.2），避免静态密码进前端；
  - `turns:` over TLS(5349)，对抗只放 443/853 等端口的企业网络；
  - 多 TURN 节点就近调度（按客户端 GeoDNS 返回最近节点）。
- **若某版本临时下线语音功能**（`useSpatialVoice.ts` 不再创建 `RTCPeerConnection`），coturn 可暂停运行，本文档保留为未来重新启用时的部署参考。
