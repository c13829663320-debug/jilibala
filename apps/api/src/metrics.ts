// ===== 轻量进程内指标注册表（零新依赖）=====
// 目标：不引入 prom-client / fastify-metrics，用 Node 内置能力实现一个最小可用的
// Prometheus 文本格式 /metrics 端点，覆盖 HTTP、WebSocket、LLM 并发、错误率等关键指标。
// 指标全部为进程内存态，重启即清零；多副本部署时由 Prometheus 分别 scrape 各 Pod。
import { performance } from "node:perf_hooks";

/** 延迟桶（秒），与 Prometheus histogram 语义一致，最后一个 bucket 为 +Inf。 */
const LATENCY_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .sort()
    .join(",");
}

export class MetricsRegistry {
  // HTTP：method + route(pattern) + status -> 计数
  private httpRequests = new Map<string, number>();
  // HTTP 延迟直方图：method + route -> 各桶累计计数
  private httpLatencyBuckets = new Map<string, number[]>();
  private httpLatencySum = new Map<string, number>();
  private httpLatencyCount = new Map<string, number>();

  // WebSocket
  wsConnections = 0; // gauge：当前在线连接数
  wsConnectionsTotal = 0; // counter：累计建立
  wsDisconnectsTotal = 0; // counter：累计断开
  wsErrorsTotal = 0; // counter：连接/消息错误

  // LLM 并发（由 server.ts 的 withLlmSlot 实时写入）
  llmActive = 0; // gauge：当前占用 slot 的 LLM 调用
  llmQueueSize = 0; // gauge：等待 slot 的排队请求
  llmCallsTotal = 0; // counter：LLM 调用总数
  llmErrorsTotal = 0; // counter：LLM 失败数

  // 通用错误计数（4xx/5xx 由 HTTP 层统计，这里兜底未捕获错误）
  errorsTotal = 0;

  private readonly startedAt = performance.now();

  /** 记录一次 HTTP 响应。route 必须传 Fastify 的 routeOptions.url（模式），避免高基数。 */
  observeHttp(method: string, route: string, status: number, durationSec: number): void {
    const safeRoute = route || "unknown";
    const m = `${method} ${safeRoute} ${status}`;
    this.httpRequests.set(m, (this.httpRequests.get(m) ?? 0) + 1);

    const base = { method, route: safeRoute };
    const baseKey = labelKey(base);
    let buckets = this.httpLatencyBuckets.get(baseKey);
    if (!buckets) {
      buckets = new Array(LATENCY_BUCKETS.length + 1).fill(0);
      this.httpLatencyBuckets.set(baseKey, buckets);
    }
    for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
      if (durationSec <= LATENCY_BUCKETS[i]) buckets[i] += 1;
    }
    buckets[LATENCY_BUCKETS.length] += 1; // +Inf
    this.httpLatencySum.set(baseKey, (this.httpLatencySum.get(baseKey) ?? 0) + durationSec);
    this.httpLatencyCount.set(baseKey, (this.httpLatencyCount.get(baseKey) ?? 0) + 1);
  }

  wsConnected(): void {
    this.wsConnections += 1;
    this.wsConnectionsTotal += 1;
  }

  wsDisconnected(): void {
    this.wsConnections = Math.max(0, this.wsConnections - 1);
    this.wsDisconnectsTotal += 1;
  }

  wsError(): void {
    this.wsErrorsTotal += 1;
  }

  llmCall(ok: boolean): void {
    this.llmCallsTotal += 1;
    if (!ok) this.llmErrorsTotal += 1;
  }

  tickError(): void {
    this.errorsTotal += 1;
  }

  /** 渲染 Prometheus text exposition format。 */
  render(): string {
    const lines: string[] = [];

    // HTTP 请求计数
    lines.push("# HELP http_requests_total Total HTTP requests by method/route/status", "# TYPE http_requests_total counter");
    for (const [key, value] of this.httpRequests) {
      const [method, route, status] = key.split(" ");
      lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`);
    }

    // HTTP 延迟直方图
    lines.push("# HELP http_request_duration_seconds HTTP request latency", "# TYPE http_request_duration_seconds histogram");
    for (const [baseKey, buckets] of this.httpLatencyBuckets) {
      for (let i = 0; i < LATENCY_BUCKETS.length; i += 1) {
        lines.push(`http_request_duration_seconds_bucket{${baseKey},le="${LATENCY_BUCKETS[i]}"} ${buckets[i]}`);
      }
      lines.push(`http_request_duration_seconds_bucket{${baseKey},le="+Inf"} ${buckets[LATENCY_BUCKETS.length]}`);
      lines.push(`http_request_duration_seconds_sum{${baseKey}} ${(this.httpLatencySum.get(baseKey) ?? 0).toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{${baseKey}} ${this.httpLatencyCount.get(baseKey) ?? 0}`);
    }

    // WebSocket
    lines.push("# TYPE ws_connections gauge", `ws_connections ${this.wsConnections}`);
    lines.push("# TYPE ws_connections_total counter", `ws_connections_total ${this.wsConnectionsTotal}`);
    lines.push("# TYPE ws_disconnects_total counter", `ws_disconnects_total ${this.wsDisconnectsTotal}`);
    lines.push("# TYPE ws_errors_total counter", `ws_errors_total ${this.wsErrorsTotal}`);

    // LLM
    lines.push("# TYPE llm_active gauge", `llm_active ${this.llmActive}`);
    lines.push("# TYPE llm_queue_size gauge", `llm_queue_size ${this.llmQueueSize}`);
    lines.push("# TYPE llm_calls_total counter", `llm_calls_total ${this.llmCallsTotal}`);
    lines.push("# TYPE llm_errors_total counter", `llm_errors_total ${this.llmErrorsTotal}`);

    // 进程级
    lines.push("# TYPE process_resident_memory_bytes gauge", `process_resident_memory_bytes ${process.memoryUsage().rss}`);
    lines.push("# TYPE process_heap_used_bytes gauge", `process_heap_used_bytes ${process.memoryUsage().heapUsed}`);
    lines.push("# TYPE process_uptime_seconds gauge", `process_uptime_seconds ${(process.uptime()).toFixed(3)}`);
    lines.push("# TYPE eventloop_lag_seconds gauge", `eventloop_lag_seconds ${((performance.now() - this.startedAt) / 1000).toFixed(6)}`);
    lines.push("# TYPE app_errors_total counter", `app_errors_total ${this.errorsTotal}`);

    return lines.join("\n") + "\n";
  }
}

/** 全局单例：server.ts 与 ws.ts 共享同一注册表。 */
export const metrics = new MetricsRegistry();
