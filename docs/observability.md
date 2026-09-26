# 叽里呱啦 BalaBala · 可观测性方案（Observability）

本文档定义 API 服务（`apps/api`，Fastify 5 + pino）的日志、指标、告警规范。
原则：**零新增运行时依赖优先**，能用 Node 内置能力解决就不引第三方包。

---

## 1. 健康检查端点

| 端点 | 类型 | 用途 | 失败行为 |
|------|------|------|----------|
| `GET /healthz` | 存活（liveness） | 进程在跑即可，不探测依赖 | 进程挂了才失败；k8s liveness probe |
| `GET /readyz` | 就绪（readiness） | 探测 SQLite 可写（建探针表 + INSERT/DELETE） | DB 不可写时返回 **503**，负载均衡摘流 |
| `GET /health` | 兼容旧版 | 保留原有字段（tripo/stepfun 配置状态） | 仅向后兼容，新接入方用 healthz/readyz |

`/healthz` 返回示例：
```json
{ "status": "ok", "service": "balabala-api", "version": "0.1.0", "uptime": 123.4, "time": "2026-09-27T..." }
```

`/readyz` 返回示例（DB 异常时 statusCode=503）：
```json
{ "status": "ok", "version": "0.1.0", "uptime": 123.4, "dependencies": { "db": "ok" } }
```

> 约定：**存活探针只看进程，就绪探针看依赖**。不要在 `/healthz` 里查 DB，否则 DB 抖动会导致容器被反复重启。

---

## 2. 结构化日志（pino / JSON）

Fastify 已启用 `logger: true`（内置 pino），默认输出 **单行 JSON**，每条日志天然带：
`level` / `time` / `pid` / `hostname` / `reqId` / `req.method` / `req.url` / `res.statusCode` / `responseTime`。

### 2.1 日志字段规范

| 字段 | 来源 | 说明 |
|------|------|------|
| `level` | pino | 30=info, 40=warn, 50=error, 60=fatal |
| `reqId` | Fastify | 每个请求一个 ID，**串起同一次请求的所有日志** |
| `req.method` / `req.url` / `req.remoteAddress` | pino std serializer | 路由 URL 可能含参数，高基数告警时注意 |
| `res.statusCode` / `responseTime` | pino | 错误率 / 延迟看板直接取 |
| `error` | 业务代码 | `app.log.error({ error, provider }, '...')` 必须带 error 对象 |

业务日志必须用结构化方式带上下文，**禁止拼字符串**：
```ts
// ✅ 好：可被日志系统按 provider / characterId 聚合
app.log.warn({ provider: 'StepFun', characterId: id, error }, 'celebrity chat failed');
// ❌ 坏：无法检索
app.log.warn('celebrity chat failed for ' + id);
```

### 2.2 请求 ID 追踪

Fastify 自动生成 `reqId`（header `x-request-id` 可透传）。前端在跨服务调用时应：
- 出口：把当前 `x-request-id` 透传到下游 LLM / 3D 服务；
- 入口：网关 / 反向代理注入 `x-request-id`，Fastify 自动识别并沿用。

### 2.3 日志轮转（log rotation）

生产不要让 stdout 无限增长。两种方式：

**方式 A：容器 / systemd 由外部收集（推荐）**
容器化部署时日志打到 stdout，由 Docker logging driver / journald / Promtail 收集，应用内不做轮转。

**方式 B：落盘 + logrotate（裸机部署）**
用 pino 多目标（pino-roll / pino/file）写文件，并配合系统 logrotate：

`/etc/logrotate.d/balabala-api` 示例：
```
/var/log/balabala/api.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 app app
    sharedscripts
    postrotate
        systemctl reload balabala-api >/dev/null 2>&1 || true
    endscript
}
```

代码侧多目标写法（需要 `pino` / `pino-roll`，按需引入，默认不引）：
```ts
import pino from 'pino';
const app = Fastify({
  logger: pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: {
      targets: [
        { target: 'pino/file', options: { destination: 1 } },           // stdout
        { target: 'pino/file', options: { destination: '/var/log/balabala/api.jsonl' } },
      ],
    },
  }),
});
```

---

## 3. 指标（Metrics）

### 3.1 方案：零依赖 `/metrics` 端点

已在 `apps/api/src/metrics.ts` 实现一个进程内最小 Prometheus 注册表，`GET /metrics`
直接返回 **Prometheus text exposition format**，无需 `prom-client` / `fastify-metrics`。
多副本部署时由 Prometheus 分别 scrape 每个 Pod。

### 3.2 关键指标清单

| 指标 | 类型 | 标签 | 含义 / 告警用途 |
|------|------|------|----------------|
| `http_requests_total` | counter | method, route, status | 请求量、错误率（5xx / 总量） |
| `http_request_duration_seconds` | histogram | method, route | P50/P95/P99 延迟 |
| `ws_connections` | gauge | — | 当前 WebSocket 在线连接数 |
| `ws_connections_total` / `ws_disconnects_total` | counter | — | 连接建立/断开，异常断开抖动 |
| `ws_errors_total` | counter | — | WS 错误数 |
| `llm_active` | gauge | — | 当前占用 slot 的 LLM 并发（上限由 LLM_MAX_CONCURRENCY 控制） |
| `llm_queue_size` | gauge | — | 等待 LLM slot 的排队请求，持续 >0 说明上游限流 |
| `llm_calls_total` / `llm_errors_total` | counter | — | LLM 成功率 |
| `process_resident_memory_bytes` / `process_heap_used_bytes` | gauge | — | 内存 |
| `process_uptime_seconds` | gauge | — | 频繁重启（uptime 异常小） |
| `app_errors_total` | counter | — | 未被 HTTP 覆盖的兜底错误 |

验证：
```bash
curl -s http://127.0.0.1:8787/metrics
# HELP http_requests_total Total HTTP requests by method/route/status
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/healthz",status="200"} 3
```

### 3.3 为什么不直接引 prom-client

- 当前指标面很窄（HTTP / WS / LLM / 进程），手写注册表约 100 行即可覆盖；
- 避免给 API 镜像增加依赖与体积；
- 后续若要 histogram 分位、进程自动指标，再迁移到 `prom-client`，`/metrics` 路径不变。

---

## 4. 告警建议

在 Prometheus Alertmanager / 云监控里配置：

| 告警 | PromQL 示例（参考） | 阈值 | 级别 |
|------|---------------------|------|------|
| 高 5xx 错误率 | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` | > 5% 持续 5min | P1 |
| 内存过高 | `process_resident_memory_bytes / container_memory_limit_bytes` | > 85% 持续 10min | P2 |
| CPU 过高 | `rate(process_cpu_seconds_total[5m])` | > 80% 持续 10min | P2 |
| 磁盘将满 | node_filesystem_avail_bytes / total | < 10%（>90% 已用） | P1 |
| LLM 排队堆积 | `llm_queue_size` | > 0 持续 10min（上游限流） | P2 |
| LLM 错误率 | `rate(llm_errors_total[10m]) / rate(llm_calls_total[10m])` | > 20% | P2 |
| WS 异常断开抖动 | `rate(ws_disconnects_total[5m])` 突增 | 相对基线 >3x | P3 |
| 服务频繁重启 | `increase(process_uptime_seconds[1h]) < 3600` | 1 小时内重启 >3 次 | P1 |
| 就绪探针失败 | 外部 blackbox 探 `/readyz` | 连续 3 次 503 | P1 |

---

## 5. 仪表盘建议（Grafana）

- **API 总览**：QPS、P95 延迟、5xx 错误率、在线 WS 连接数；
- **LLM 面板**：`llm_active` / `llm_queue_size` / LLM 成功率；
- **资源面板**：RSS、堆内存、CPU、事件循环 lag、重启次数；
- **日志检索**：按 `reqId` 串起单次请求全链路，按 `level=50` 过滤错误。
