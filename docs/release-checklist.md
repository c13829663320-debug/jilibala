# 叽里呱啦 BalaBala · 发布前检查清单（Release Checklist）

每次发版（生产 / 预发）前逐项核对。每项都给出**验证命令**，命令通过才算勾上。
最后更新：CI 增强 + healthz/readyz/metrics + E2E 冒烟落地后。

---

## 1. 代码维度

- [ ] 单元测试全绿
  ```bash
  npm test   # 期望：API 368 + Web 206 全部 passed，exit 0
  ```
- [ ] E2E 冒烟全绿（不依赖浏览器）
  ```bash
  bash e2e/run-smoke.sh   # 期望：9/9 通过，exit 0
  ```
- [ ] Lint 通过（若仓库未引入 ESLint，本项跳过并注明）
  ```bash
  # 仓库当前未配置 eslint：本项 N/A。引入后执行：npm run lint
  ```
- [ ] 无遗留 `console.log` / `debugger`（生产代码）
  ```bash
  grep -rn "console\.\(log\|debug\)\|debugger" apps/api/src apps/web/src --include="*.ts" --include="*.tsx"
  # 期望：仅命中注释或白名单文件，无业务残留
  ```
- [ ] 无硬编码密钥 / token
  ```bash
  grep -rnE "(sk-|api[_-]?key|secret|token|password)\s*[:=]\s*['\"][A-Za-z0-9_-]{16,}" apps/api/src apps/web/src
  # 期望：无命中；密钥一律走 process.env / .env（.env 已 gitignore）
  ```

## 2. 构建维度

- [ ] 干净环境 `npm ci` 成功
  ```bash
  npm ci --no-audit --no-fund
  ```
- [ ] `npm run build` 成功（api tsc + web vite build + shared tsc）
  ```bash
  npm run build   # 期望：exit 0，无 TS 报错
  ```
- [ ] 前端产物存在且大小合理
  ```bash
  ls -la apps/web/dist/index.html
  du -sh apps/web/dist/
  # 期望：index.html 存在；dist 总体积在可接受范围（当前 ~17MB，含 3D 模型 PWA 预缓存）
  ```
- [ ] API 类型检查通过
  ```bash
  npx tsc -p apps/api/tsconfig.json --noEmit
  ```

## 3. 部署维度

- [ ] docker compose 配置校验（若使用）
  ```bash
  docker compose config -q   # 期望：无报错
  ```
- [ ] 环境变量齐全（对照 .env.example）
  ```bash
  diff <(grep -oE "^[A-Z0-9_]+" .env.example | sort) <(grep -oE "^[A-Z0-9_]+" .env | sort)
  # 期望：.env 覆盖 .env.example 中所有必填项
  ```
- [ ] 健康检查通过（在预发环境）
  ```bash
  curl -fsS https://<预发域名>/healthz    # 200
  curl -fsS https://<预发域名>/readyz     # 200，dependencies.db == "ok"
  ```
- [ ] 负载均衡已配置就绪探针指向 `/readyz`、存活探针指向 `/healthz`

## 4. 回滚维度

- [ ] 上一版本镜像 / git tag 已保留
  ```bash
  docker images | grep balabala   # 期望：上一版镜像仍在
  git tag --sort=-creatordate | head
  ```
- [ ] 回滚步骤已演练（或至少在文档中明确）
  - [ ] 镜像回滚：`docker compose up -d balabala-api:<上一版本>`
  - [ ] 代码回滚：`git revert <commit>` 或 `git checkout <上一 tag>` 后重新部署
- [ ] 回滚后 `/healthz` `/readyz` 仍为 200

## 5. 数据维度

- [ ] 发布前已备份 SQLite 数据库
  ```bash
  cp apps/api/.data/app.db apps/api/.data/app.db.bak-$(date +%Y%m%d)
  ```
- [ ] Schema 向后兼容（老版本代码能读新 schema，或停机窗口内升级）
  - [ ] db.ts 中 `ALTER TABLE ... ADD COLUMN` 均带 `IF NOT EXISTS` 守卫
- [ ] 迁移脚本已在预发库跑过一遍

## 6. 安全维度

- [ ] 依赖漏洞扫描
  ```bash
  npm audit --omit=dev   # 期望：无 high/critical
  ```
- [ ] CORS 配置正确（生产不允许 `origin: true` 全开放，或收敛白名单）
  ```bash
  grep -n "cors" apps/api/src/server.ts
  ```
- [ ] 生产强制 HTTPS（网关 / 反代理层 301 到 https）
- [ ] 密钥不在代码库、不在镜像层（走环境变量 / Secret Manager）
  ```bash
  grep -rn "TRIPO_API_KEY\|STEPFUN_API_KEY" apps/api/src   # 期望：仅 process.env 读取
  ```

## 7. 监控维度

- [ ] 告警规则已配置（见 docs/observability.md 第 4 节）
  - [ ] 5xx 错误率 > 5%
  - [ ] 内存 > 85% / CPU > 80% / 磁盘 > 90%
  - [ ] WS 异常断开抖动 / 服务频繁重启
- [ ] Grafana 仪表盘可看（QPS、P95、WS 在线数、LLM 队列）
  ```bash
  curl -fsS https://<预发域名>/metrics | grep -E "http_requests_total|ws_connections|llm_active"
  ```
- [ ] 日志可查（按 reqId 能串起单次请求）

## 8. 冒烟 / 验收维度

- [ ] 预发环境冒烟通过
  ```bash
  SMOKE_BASE_URL=https://<预发域名> node e2e/smoke.mjs
  # 期望：/healthz /readyz /api/celebrities /api/contents /metrics / WS 全 PASS
  ```
- [ ] 关键用户路径人工过一遍：打开首页 → 进广场 → 发起一次趣味法庭 → WS 实时广播正常
- [ ] 回滚方案已同步给值班同学

---

## 发布签字

- 代码负责人：__________  日期：________
- 测试 / 验收：__________  日期：________
- 值班 / 运维：__________  日期：________
