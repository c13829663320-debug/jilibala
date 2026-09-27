// ===== R5: AI 调用统一网关 =====
//
// 所有前端 AI 调用统一走这里：
//   - 超时（默认 30s，可配）：到点 AbortController.abort()，不无限转圈；
//   - 并发上限（默认 3 路）：超出排队，避免用户狂点把后端打挂；
//   - 失败降级：超时/网络错误返回兜底文案，不白屏、不抛未捕获。
//
// 纯策略在 ai-degrade.ts（可单测）；本模块负责接 fetch / AbortController。

import { DEFAULT_AI_GATEWAY_CONFIG, type AIGatewayConfig } from '@balabala/shared'
import { ConcurrencyGate, fallbackFor } from './ai-degrade'

/** 全局默认网关实例（模块级单例，跨组件共享并发额度）。 */
const globalGate = new ConcurrencyGate(DEFAULT_AI_GATEWAY_CONFIG.maxConcurrency)

export interface AiCallResult<T> {
  ok: boolean
  data?: T
  /** 兜底文案（ok=false 时）。 */
  fallback: string
  timedOut: boolean
}

/**
 * 执行一次 AI JSON 调用。
 * @param url      AI 接口地址
 * @param init     fetch init（method/body/headers）
 * @param config   超时/并发/兜底（可只覆盖部分）
 */
export async function callAI<T = unknown>(
  url: string,
  init: RequestInit = {},
  config: Partial<AIGatewayConfig> = {},
): Promise<AiCallResult<T>> {
  const cfg: AIGatewayConfig = { ...DEFAULT_AI_GATEWAY_CONFIG, ...config }

  return globalGate.acquire().then(async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), cfg.timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as T
      return { ok: true, data, fallback: cfg.fallbackText, timedOut: false }
    } catch (err) {
      return { ok: false, fallback: fallbackFor(err, cfg), timedOut: /abort/i.test(String((err as Error)?.name)) }
    } finally {
      window.clearTimeout(timer)
      globalGate.release()
    }
  })
}
