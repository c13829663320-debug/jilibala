# 叽里呱啦 · 自部署 / 离线部署指南

适用场景：
- 没有 Docker，需要在裸机（systemd / pm2）上直接跑；
- 内网 / 离线环境，无法 `npm install` 联网拉包；
- 仅内网部署，需要把对外 API（Tripo / StepFun / Evomap）走代理或内网中转。

## 目录
1. [裸机部署（有公网）](#1-裸机部署有公网)
2. [离线环境部署](#2-离线环境部署)
3. [国内镜像源加速](#3-国内镜像源加速)
4. [仅内网：外部 API 代理方案](#4-仅内网外部-api-代理方案)
5. [systemd 单元示例](#5-systemd-单元示例)

---

## 1. 裸机部署（有公网）

### 1.1 前置
- Node.js **22.x**（运行时用到内置 `node:sqlite`，必须 ≥ 22.5）
- npm 10+
- （前端由 nginx/caddy 托管，或直接用 `vite preview` 仅作调试）

### 1.2 安装与构建
```bash
# 1) 拉代码
git clone <repo-url> balabala && cd balabala

# 2) 安装全部依赖（含 workspaces）
npm ci

# 3) 构建
npm run build --workspace apps/api     # tsc -> apps/api/dist
npm run build --workspace apps/web     # tsc -b && vite build -> apps/web/dist
```

### 1.3 编译 shared 包（关键）
`packages/shared` 的 `package.json` `main` 指向 `src/index.ts`（供 tsx 开发用）。
直接 `node apps/api/dist/server.js` 时，Node 无法执行其中的 `.ts` 与 `.js` 子导入，
会报 `ERR_MODULE_NOT_FOUND`。生产裸机二选一：

**方案 A（推荐，真编译产物）：**
```bash
npx tsc packages/shared/src/index.ts \
  --outDir packages/shared/dist \
  --module NodeNext --moduleResolution NodeNext \
  --target ES2022 --skipLibCheck --declaration false
# 运行态把 shared 入口指向编译产物
cat > packages/shared/package.json <<'JSON'
{
  "name": "@balabala/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js"
}
JSON
```

**方案 B（用 tsx 直跑源码，免编译 shared）：**
```bash
# 不编译 shared，直接用 tsx 运行（dev 同款，tsx 已在 devDependencies）
npx tsx apps/api/src/server.ts
```

### 1.4 配置与启动
```bash
cp .env.example .env && vi .env        # 填密钥
export PORT=8787 DB_PATH=./.data/app.db NODE_ENV=production

# 启动 API（方案 A）
cd apps/api && node dist/server.js

# 前端静态产物在 apps/web/dist，用任意静态服务器托管并反代 /api 到 :8787，
# 例：nginx root 指向 apps/web/dist，location /api/ proxy_pass http://127.0.0.1:8787。
```

进程管理推荐用 systemd（见第 5 节）或 pm2：
```bash
npm i -g pm2
pm2 start apps/api/dist/server.js --name balabala-api
pm2 save && pm2 startup
```

---

## 2. 离线环境部署

目标机器无公网，需在**一台有网的同架构机器**上备好产物，再整体拷贝过去。

### 2.1 离线缓存 npm 依赖（整包 node_modules）
在**与目标机相同 OS / CPU 架构 / Node 大版本**的机器上：
```bash
git clone <repo> balabala && cd balabala
npm ci --omit=dev        # 仅生产依赖（如需在目标机构建，去掉 --omit=dev）
# 把整个仓库（含 node_modules）打包
tar czf balabala-bundle.tar.gz --exclude=.git .
```
拷贝 `balabala-bundle.tar.gz` 到内网机器解压即可，**无需联网 npm install**。

### 2.2 仅缓存所需包（更省空间，npm pack）
```bash
# 导出 lockfile 中所有依赖的 tarball 到本地目录
npm ci --cache /tmp/npm-cache
npm pack $(node -e "console.log(Object.keys(require('./package-lock.json').packages||{}).filter(k=>k&&!k.startsWith('node_modules')).join(' '))") 2>/dev/null || true
# 更稳妥：把整个 ~/.npm 缓存目录随包带走，目标机执行
#   npm ci --cache /path/to/npm-cache --offline
```

### 2.3 离线 Docker 镜像
```bash
# 有网机：导出镜像
docker compose build
docker save balabala/api:latest balabala/web:latest -o balabala-images.tar

# 拷到内网机导入
docker load -i balabala-images.tar
# 离线启动（镜像已在本地，--build 会跳过拉取；仍需 .env 与 compose 文件）
docker compose up -d
```
> 注意：离线机上 `docker compose up --build` 仍需 Dockerfile 能联网装 apt/npm 包。
> 纯离线建议直接 `docker load` 预构建镜像，并用 `docker compose up -d`（去掉 `--build`）。

---

## 3. 国内镜像源加速

### npm
```bash
# 临时
npm ci --registry=https://registry.npmmirror.com

# 持久化
npm config set registry https://registry.npmmirror.com
```
Dockerfile 内如需加速，在 `deps` stage 加：
```dockerfile
RUN npm config set registry https://registry.npmmirror.com && npm ci --no-audit --no-fund
```

### Docker Hub 镜像加速器
在 `/etc/docker/daemon.json` 配置国内加速器后 `systemctl restart docker`：
```json
{ "registry-mirrors": ["https://docker.mirrors.ustc.edu.cn"] }
```

---

## 4. 仅内网：外部 API 代理方案

内网服务器无法直连 `api.tripo3d.ai` / `api.stepfun.com` / `api.evomap.ai`，
任选其一：

### 4.1 出口正向代理（推荐）
在一台能出公网的机器上跑一个 HTTP 代理（squid / tinyproxy），内网应用通过
环境变量走代理。代码已通过 `undici` 读取 `HTTPS_PROXY` / `TRIPO_HTTPS_PROXY`：
```bash
# .env
HTTPS_PROXY=http://<proxy-host>:3128
TRIPO_HTTPS_PROXY=http://<proxy-host>:3128   # 仅 Tripo
```

### 4.2 内网反向中转（无代理软件时）
在 DMZ 区起一个轻量反代（nginx / Caddy），把对外域名指到内网地址：
```nginx
# DMZ 反代示例：对内暴露 https://llm.internal.stepfun.local -> 真实 StepFun
location /v1/ {
    proxy_pass https://api.stepfun.com/v1/;
    proxy_set_header Host api.stepfun.com;
}
```
然后在内网 `.env` 把 `*_API_BASE_URL` 改成内网地址：
```bash
STEPFUN_API_BASE_URL=https://llm.internal.stepfun.local/v1
EVOMAP_API_BASE_URL=https://llm.internal.evomap.local/v1
TRIPO_API_BASE_URL=https://tripo.internal.local/v2/openapi
```
API Key 保持不变，由内网反代透传。

### 4.3 离线降级
未配置任何上游 Key 时，应用会走内置离线知识库（`apps/api/data/offline-brains/*.json`）
与本地占位回复，可在内网无外网时演示核心交互，但不会真正调用大模型。

---

## 5. systemd 单元示例

`/etc/systemd/system/balabala-api.service`：
```ini
[Unit]
Description=BalaBala (叽里呱啦) Fastify API
After=network.target

[Service]
Type=simple
# 按实际路径修改
WorkingDirectory=/opt/balabala/apps/api
EnvironmentFile=/opt/balabala/.env
Environment=NODE_ENV=production
Environment=PORT=8787
Environment=DB_PATH=/opt/balabala/apps/api/.data/app.db
ExecStart=/usr/bin/node /opt/balabala/apps/api/dist/server.js
Restart=always
RestartSec=3
# 非 root 运行
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

前端静态产物建议用 nginx 托管（同 Docker 方案的 `nginx/balabala.conf`，把
`proxy_pass http://api:8787` 改为 `http://127.0.0.1:8787`）。

启用：
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now balabala-api
sudo systemctl status balabala-api
journalctl -u balabala-api -f
```
