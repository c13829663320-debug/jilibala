// ===== R5: AI 网关降级纯逻辑（无 DOM/fetch，可在 Node 单测）=====
//
// - 超时判断：elapsed >= timeoutMs；
// - 失败归类：超时 / 网络错误 / 服务端错误，统一返回兜底文案，不白屏；
// - 并发闸门：最多 maxConcurrency 路并行，超出排队。

import type { AIGatewayConfig } from '@balabala/shared'

/** 是否为超时错误（AbortError / TimeoutError）。 */
export function isTimeoutError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: string; message?: string }
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  if (typeof e.message === 'string' && /timeout|timed out|abort/i.test(e.message)) return true
  return false
}

/**
 * 根据错误返回兜底文案。超时用专门的「思考太久」文案，其他用通用兜底。
 */
export function fallbackFor(err: unknown, config: AIGatewayConfig): string {
  if (isTimeoutError(err)) return `${config.fallbackText}（这次思考太久了，已超时）`
  return config.fallbackText
}

/** 纯并发闸门：acquire() 拿一个槽位，release() 归还。 */
export class ConcurrencyGate {
  private readonly max: number
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(maxConcurrency: number) {
    this.max = Math.max(1, Math.floor(maxConcurrency))
  }

  /** 当前在飞路数。 */
  get running(): number {
    return this.active
  }

  /** 排队长度。 */
  get waiting(): number {
    return this.queue.length
  }

  /** 拿槽位；满了就排队等待。 */
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  /** 归还槽位，唤醒下一个排队者。 */
  release(): void {
    this.active = Math.max(0, this.active - 1)
    const next = this.queue.shift()
    if (next) {
      this.active += 1
      next()
    }
  }
}

/** 用闸门包裹一个异步任务（自动 acquire/release）。 */
export async function withGate<T>(gate: ConcurrencyGate, task: () => Promise<T>): Promise<T> {
  await gate.acquire()
  try {
    return await task()
  } finally {
    gate.release()
  }
}
