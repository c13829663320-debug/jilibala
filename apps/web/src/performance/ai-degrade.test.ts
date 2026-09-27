import { describe, it, expect } from 'vitest'
import {
  isTimeoutError,
  fallbackFor,
  ConcurrencyGate,
  withGate,
} from './ai-degrade'
import { DEFAULT_AI_GATEWAY_CONFIG } from '@balabala/shared'

describe('isTimeoutError', () => {
  it('detects AbortError / TimeoutError', () => {
    expect(isTimeoutError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isTimeoutError(new Error('The operation was timed out'))).toBe(true)
  })
  it('ignores ordinary errors', () => {
    expect(isTimeoutError(new Error('network down'))).toBe(false)
    expect(isTimeoutError(null)).toBe(false)
  })
})

describe('fallbackFor', () => {
  it('timeout gets extra wording', () => {
    const out = fallbackFor(new Error('aborted'), DEFAULT_AI_GATEWAY_CONFIG)
    expect(out).toContain('超时')
  })
  it('other errors get plain fallback', () => {
    expect(fallbackFor(new Error('boom'), DEFAULT_AI_GATEWAY_CONFIG)).toBe(
      DEFAULT_AI_GATEWAY_CONFIG.fallbackText,
    )
  })
})

describe('ConcurrencyGate', () => {
  it('caps parallelism and queues overflow', async () => {
    const gate = new ConcurrencyGate(2)
    const order: string[] = []
    const p1 = withGate(gate, async () => { order.push('start1'); await sleep(10); order.push('end1') })
    const p2 = withGate(gate, async () => { order.push('start2'); await sleep(10); order.push('end2') })
    expect(gate.running).toBe(2)
    // third must wait
    let started3 = false
    const p3 = withGate(gate, async () => { started3 = true })
    expect(gate.waiting).toBe(1)
    await Promise.all([p1, p2, p3])
    expect(started3).toBe(true)
    expect(order).toEqual(['start1', 'start2', 'end1', 'end2'])
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
