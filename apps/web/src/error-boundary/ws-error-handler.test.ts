// ===== ws-error-handler 纯逻辑单测（Node 环境，无 WebSocket 全局）=====
import { describe, expect, it } from 'vitest'
import {
  WS_BACKOFF_BASE_MS,
  WS_BACKOFF_MAX_MS,
  computeBackoffDelay,
  canMutate,
  initialWsErrorState,
  reduceWsError,
  wsBannerText,
} from './ws-error-handler'

describe('指数退避计算', () => {
  it('第 1 次失败 = 1s', () => {
    expect(computeBackoffDelay(1)).toBe(WS_BACKOFF_BASE_MS)
  })
  it('第 2/3/4 次 = 2s/4s/8s 翻倍', () => {
    expect(computeBackoffDelay(2)).toBe(2000)
    expect(computeBackoffDelay(3)).toBe(4000)
    expect(computeBackoffDelay(4)).toBe(8000)
  })
  it('第 5 次 = 16s', () => {
    expect(computeBackoffDelay(5)).toBe(16000)
  })
  it('超过阈值后封顶在 30s', () => {
    expect(computeBackoffDelay(6)).toBe(WS_BACKOFF_MAX_MS)
    expect(computeBackoffDelay(10)).toBe(WS_BACKOFF_MAX_MS)
    expect(computeBackoffDelay(100)).toBe(WS_BACKOFF_MAX_MS)
  })
  it('attempt<=0 当作第 1 次处理（防御非法输入）', () => {
    expect(computeBackoffDelay(0)).toBe(WS_BACKOFF_BASE_MS)
    expect(computeBackoffDelay(-3)).toBe(WS_BACKOFF_BASE_MS)
  })
})

describe('WS 连接状态机', () => {
  it('初始状态：connecting，可写', () => {
    const s = initialWsErrorState()
    expect(s.status).toBe('connecting')
    expect(s.readOnly).toBe(false)
    expect(canMutate(s)).toBe(false) // connecting 时还不能写
  })

  it('onopen → connected，重试计数归零，可写', () => {
    const s = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    expect(s.status).toBe('connected')
    expect(s.retryCount).toBe(0)
    expect(s.readOnly).toBe(false)
    expect(canMutate(s)).toBe(true)
  })

  it('连接失败 1 次 → reconnecting，退避 1s，仍自动重连', () => {
    const open = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    const s = reduceWsError(open, { type: 'CLOSE', error: 'disconnected' })
    expect(s.status).toBe('reconnecting')
    expect(s.retryCount).toBe(1)
    expect(s.nextRetryInMs).toBe(1000)
    expect(s.readOnly).toBe(false)
    expect(s.lastError).toBe('disconnected')
  })

  it('连续失败多次：退避逐次翻倍，第 2 次 2s、第 3 次 4s', () => {
    let s = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    s = reduceWsError(s, { type: 'CLOSE' })
    expect(s.nextRetryInMs).toBe(1000)
    s = reduceWsError(s, { type: 'CLOSE' })
    expect(s.retryCount).toBe(2)
    expect(s.nextRetryInMs).toBe(2000)
    s = reduceWsError(s, { type: 'CLOSE' })
    expect(s.retryCount).toBe(3)
    expect(s.nextRetryInMs).toBe(4000)
  })

  it('失败达到阈值 → offline 只读模式，不再自动重连', () => {
    let s = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    s = reduceWsError(s, { type: 'CLOSE' }) // 1
    s = reduceWsError(s, { type: 'CLOSE' }) // 2
    s = reduceWsError(s, { type: 'CLOSE' }) // 3
    s = reduceWsError(s, { type: 'CLOSE' }) // 4
    expect(s.status).toBe('reconnecting')
    expect(s.readOnly).toBe(false)
    s = reduceWsError(s, { type: 'CLOSE' }) // 5 → 阈值
    expect(s.status).toBe('offline')
    expect(s.readOnly).toBe(true)
    expect(canMutate(s)).toBe(false)
  })

  it('offline 状态下用户点「立即重连」→ connecting（保持只读直到真的 OPEN）', () => {
    let s = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    for (let i = 0; i < 5; i++) s = reduceWsError(s, { type: 'CLOSE' })
    expect(s.status).toBe('offline')
    const retry = reduceWsError(s, { type: 'MANUAL_RETRY' })
    expect(retry.status).toBe('connecting')
    expect(retry.readOnly).toBe(true) // 假在线保护
    // 真的连上了 → 解除只读
    const back = reduceWsError(retry, { type: 'OPEN' })
    expect(back.status).toBe('connected')
    expect(back.readOnly).toBe(false)
    expect(back.retryCount).toBe(0)
  })

  it('STOP（离开房间）→ offline 只读，不再调度重连', () => {
    const s = reduceWsError(initialWsErrorState(), { type: 'STOP' })
    expect(s.status).toBe('offline')
    expect(s.readOnly).toBe(true)
    expect(s.nextRetryInMs).toBe(0)
  })

  it('横幅文案：reconnecting/offline/connected 各有文案', () => {
    const connected = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    expect(wsBannerText(connected)).toBeNull()

    let s = reduceWsError(initialWsErrorState(), { type: 'OPEN' })
    s = reduceWsError(s, { type: 'CLOSE' })
    expect(wsBannerText(s)).toContain('正在自动重连')

    for (let i = 0; i < 4; i++) s = reduceWsError(s, { type: 'CLOSE' })
    expect(wsBannerText(s)).toContain('只读模式')
  })
})
