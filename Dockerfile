# syntax=docker/dockerfile:1.6
# ============================================================
# 叽里呱啦 · BalaBala —— Docker 多阶段构建
#
# 产物：
#   * runtime-api  : Fastify API（Node 22），内部监听 8787，托管 /api/* 与 /api/ws
#   * runtime-web  : nginx 静态托管 apps/web/dist，并反向代理 /api、/health 到 api
#
# 说明：本仓库 API 进程本身不托管前端静态资源（未注册 @fastify/static），
# 因此采用「nginx 静态 + 反向代理」的分离方案。详见 docs/deployment.md。
# ============================================================

# ---------- Stage 0: base ----------
FROM node:22-alpine AS base
ENV NODE_ENV=production \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# 容器内时区/证书（对外访问 Tripo / StepFun / Evomap 需要）
RUN apk add --no-cache tzdata ca-certificates wget && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

# ---------- Stage 1: deps（仅装依赖，最大化层缓存） ----------
# 先拷贝各 workspace 的 package.json 与 lockfile，利用 Docker 层缓存。
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --no-audit --no-fund

# ---------- Stage 2: build（编译 api / web / shared） ----------
FROM deps AS build
# 拷贝全部源码（.dockerignore 已排除 node_modules / dist / .git 等）
COPY . .

# packages/shared 的 package.json main 指向 src/index.ts（TS 源码，供 tsx dev 使用）。
# 生产环境用 node 直跑编译产物，必须先把 shared 编译成 JS，否则运行时
# 会因内部 `./x.js` 子导入指向不存在的 .js 文件而 ERR_MODULE_NOT_FOUND。
RUN npx tsc packages/shared/src/index.ts \
      --outDir packages/shared/dist \
      --module NodeNext --moduleResolution NodeNext \
      --target ES2022 --skipLibCheck --declaration false

# 运行态 shared 包入口改指编译产物 dist/index.js
RUN cat > packages/shared/package.json <<'JSON'
{
  "name": "@balabala/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
JSON

# 编译 API（tsc -> apps/api/dist）与前端（tsc -b && vite build -> apps/web/dist）
RUN npm run build --workspace apps/api
RUN npm run build --workspace apps/web

# 裁剪出生产依赖（移除 tsc/vite/tsx/vitest 等 devDependencies）
RUN npm prune --omit=dev --no-audit --no-fund

# ---------- Stage 3a: runtime-api ----------
FROM base AS runtime-api
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DB_PATH=/data/app.db \
    BALABALA_CASES_FILE=/data/cases.json \
    BALABALA_CONTENTS_FILE=/data/contents.json \
    LLM_MAX_CONCURRENCY=4

# 仅拷贝运行所需：生产 node_modules、api 产物、shared 产物、离线知识库
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/data/offline-brains ./apps/api/data/offline-brains
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

# node_modules/@balabala/shared 是 workspace 符号链接，随 node_modules 一起拷贝；
# 它指向 ./packages/shared，上面已用改写后的 package.json（main=dist/index.js）覆盖。
WORKDIR /app/apps/api

# 数据目录归属非 root 用户（node:alpine 自带 node 用户，uid=1000）
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 8787

# 健康检查：探测 /health（Fastify 已暴露，返回 {ok:true}）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true' || exit 1

CMD ["node", "dist/server.js"]

# ---------- Stage 3b: runtime-web（nginx 静态 + 反向代理） ----------
FROM nginx:1.27-alpine AS runtime-web
COPY nginx/balabala.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
