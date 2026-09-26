# HTTPS 证书获取与配置（叽里呱啦 / balabala-court）

> 适用范围：公网生产部署。HTTPS 不是可选项——浏览器在非安全上下文（公网 HTTP）下会拒绝 `getUserMedia`（麦克风），WebRTC 空间语音与 `wss://` 信令都无法工作。
>
> 配套文件：[`../deploy/nginx/nginx.conf`](../deploy/nginx/nginx.conf)、[`stun-turn.md`](./stun-turn.md)、[`backup-migration.md`](./backup-migration.md)。
> 全文以域名 `your-domain.com` 为例，替换为你的真实域名即可。

---

## 0. 前置条件

| 项 | 要求 |
|---|---|
| 域名 | 已注册，A 记录指向服务器公网 IPv4（如 `203.0.113.10`） |
| 端口 | 安全组/防火墙放行 **80**（ACME 验证 + HTTP→HTTPS）与 **443** |
| Nginx | 已按 [`nginx.conf`](../deploy/nginx/nginx.conf) 部署，`server_name` 已改成真实域名 |
| webroot 目录 | `/var/www/letsencrypt` 存在，且 nginx 的 `/.well-known/acme-challenge/` 指向它 |

```bash
sudo mkdir -p /var/www/letsencrypt
sudo chown -R www-data:www-data /var/www/letsencrypt   # Debian/Ubuntu
# RHEL/CentOS 用: sudo chown -R nginx:nginx /var/www/letsencrypt
```

---

## 1. Let's Encrypt 证书（推荐，webroot 模式）

为什么用 **webroot** 而不是 `--nginx` 插件：webroot 不要求 nginx 停机、不临时改配置，续期时也不需要 reload nginx 插件，最稳定。

### 1.1 安装 certbot

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install -y certbot

# RHEL / CentOS / Rocky
# sudo dnf install -y certbot

# 验证
certbot --version
```

> 不需要 `python3-certbot-nginx` 插件——我们用 `--webroot`。

### 1.2 首次申请证书

```bash
sudo certbot certonly \
  --webroot \
  -w /var/www/letsencrypt \
  -d your-domain.com \
  --agree-tos \
  --no-eff-email \
  -m you@example.com \
  --redirect
```

参数说明：
- `--webroot -w /var/www/letsencrypt`：把验证文件写到该目录，由 nginx 的 `/.well-known/acme-challenge/` location 提供出去。
- `-d your-domain.com`：申请该域名证书（多域名追加多个 `-d`）。
- `certonly`：只拿证书，不自动改 nginx 配置（我们已手写好）。

成功后证书落在：

```
/etc/letsencrypt/live/your-domain.com/fullchain.pem   # 证书链
/etc/letsencrypt/live/your-domain.com/privkey.pem     # 私钥
```

这与 `deploy/nginx/nginx.conf` 里 `ssl_certificate` / `ssl_certificate_key` 的路径一致。

### 1.3 让 nginx 加载证书

先确认 nginx.conf 中 `ssl_certificate*` 路径已指向上面两个文件，然后：

```bash
sudo nginx -t          # 语法检查
sudo systemctl reload nginx
```

打开 `https://your-domain.com`，应出现锁形证书标识。

---

## 2. 证书自动续期

Let's Encrypt 证书有效期 **90 天**，必须自动续期。

### 2.1 测试续期流程

```bash
sudo certbot renew --dry-run
```

`--dry-run` 会真实走一遍验证但不写证书。看到 `Congratulations, all simulated renewals succeeded` 即正常。

### 2.2 systemd timer（Debian/Ubuntu 官方包默认已带）

```bash
# certbot 包通常自带 timer，确认存在：
systemctl list-timers | grep certbot

# 若没有，手动创建：
sudo systemctl edit --full --force certbot-renew.service <<'EOF'
[Unit]
Description=Let's Encrypt certificate renewal

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
EOF

sudo systemctl edit --full --force certbot-renew.timer <<'EOF'
[Unit]
Description=Twice daily renewal of Let's Encrypt certificates

[Timer]
OnCalendar=*-*-* 00:00,12:00:00
RandomizedDelaySec=12h
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer
```

要点：
- `--deploy-hook "systemctl reload nginx"`：**仅在证书真的续期成功后**才 reload nginx，避免每次都 reload。
- `RandomizedDelaySec=12h`：错峰，避免所有用户同一时刻打 Let's Encrypt。
- 一天两次（00:00 / 12:00），证书剩余 30 天内才会真正续。

### 2.3 crontab 备选（无 systemd 的环境）

```cron
# /etc/crontab 或 crontab -e：每天 3:30 尝试续期
30 3 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
```

---

## 3. 自签名证书（内网 / 测试）

手机等真机在内网调试 WebRTC 麦克风权限时，需要 HTTPS，但没有公网域名。用自签名证书：

```bash
# 生成 10 年自签名证书，SAN 包含局域网 IP
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout /etc/nginx/ssl/selfsigned.key \
  -out    /etc/nginx/ssl/selfsigned.crt \
  -subj "/CN=192.168.1.100" \
  -addext "subjectAltName=IP:192.168.1.100,DNS:localhost"
```

把 nginx.conf 里 443 server 的两行换成：

```nginx
ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
ssl_certificate_key /etc/nginx/ssl/selfsigned.key;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> 自签名证书浏览器会告警，需手动点「高级 → 继续前往」。**不要用于公网**。
> 更友好的内网方案是 `mkcert`（在本机装根 CA 后信任），但它不自动覆盖手机。

---

## 4. 云厂商证书导入（备选）

如果你用阿里云 / 腾讯云 / AWS 的免费 DV 证书，流程如下：

### 4.1 申请与下载

| 云厂商 | 控制台入口 | 下载格式 |
|---|---|---|
| 阿里云 | 数字证书管理服务 → 免费证书 | 选 **Nginx** 格式，得到 `.pem` + `.key` |
| 腾讯云 | SSL 证书 → 免费证书 | 选 **Nginx** 格式，得到 `xxx_bundle.crt` + `xxx.key` |
| AWS | ACM | 云负载均衡直接托管，不用下载；若走 EC2 自建则用 ACM 导出或改用 Let's Encrypt |

### 4.2 安装到服务器

```bash
# 以阿里云 Nginx 格式为例
sudo mkdir -p /etc/nginx/ssl/your-domain.com
sudo scp your-domain.com.pem  user@server:/tmp/fullchain.pem
sudo scp your-domain.com.key  user@server:/tmp/privkey.pem

sudo mv /tmp/fullchain.pem /etc/nginx/ssl/your-domain.com/
sudo mv /tmp/privkey.pem   /etc/nginx/ssl/your-domain.com/
sudo chmod 600 /etc/nginx/ssl/your-domain.com/privkey.pem
```

改 nginx.conf：

```nginx
ssl_certificate     /etc/nginx/ssl/your-domain.com/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/your-domain.com/privkey.pem;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4.3 续期提醒

云厂商免费 DV 证书通常 **1 年**到期，**不会自动续期**。到期前控制台会短信/邮件提醒，需重新下载并覆盖上面两个文件后 reload。
> 想要全自动续期，仍推荐第 1、2 节的 Let's Encrypt 方案。

---

## 5. 证书路径与 nginx 引用一览

| 场景 | ssl_certificate | ssl_certificate_key |
|---|---|---|
| Let's Encrypt（生产） | `/etc/letsencrypt/live/your-domain.com/fullchain.pem` | `/etc/letsencrypt/live/your-domain.com/privkey.pem` |
| 自签名（内网测试） | `/etc/nginx/ssl/selfsigned.crt` | `/etc/nginx/ssl/selfsigned.key` |
| 云厂商证书 | `/etc/nginx/ssl/your-domain.com/fullchain.pem` | `/etc/nginx/ssl/your-domain.com/privkey.pem` |

私钥权限必须是 `600`，属主为运行 nginx 的用户（`www-data` / `nginx`）：

```bash
sudo chmod 600 /etc/letsencrypt/live/your-domain.com/privkey.pem
sudo chown www-data:www-data /etc/letsencrypt/live/your-domain.com/privkey.pem
```

---

## 6. 验证清单

```bash
# 1. 配置语法
sudo nginx -t

# 2. 证书链与有效期
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null \
  | openssl x509 -noout -dates -subject

# 3. HTTPS 可访问
curl -I https://your-domain.com/health

# 4. HTTP 已跳转
curl -I http://your-domain.com/ | grep -i location     # 应返回 301 → https://...

# 5. A+ 评级（可选）
# https://www.ssllabs.com/ssltest/analyze.html?d=your-domain.com
```
