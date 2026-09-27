import { describe, it, expect } from 'vitest'
import {
  nextBackoffDelay,
  detectSeqGap,
  buildRetransmitRequest,
  extrapolatePosition,
} from './reconnect-strategy'

describe('nextBackoffDelay', () => {
  it('doubles each attempt: 1s/2s/4s/8s', () => {
    expect(nextBackoffDelay(1)).toBe(1000)
    expect(nextBackoffDelay(2)).toBe(2000)
    expect(nextBackoffDelay(3)).toBe(4000)
    expect(nextBackoffDelay(4)).toBe(8000)
  })
  it('caps at maxDelayMs', () => {
    // 1,2,4,8,16,32->30
    expect(nextBackoffDelay(6)).toBe(30000)
    expect(nextBackoffDelay(20)).toBe(30000)
  })
  it('respects custom initial/max', () => {
    expect(nextBackoffDelay(1, 500, 5000)).toBe(500)
    expect(nextBackoffDelay(4, 500, 5000)).toBe(4000)
    expect(nextBackoffDelay(5, 500, 5000)).toBe(5000)
  })
})

describe('detectSeqGap', () => {
  it('returns gap when seq jumps', () => {
    expect(detectSeqGap(10, 13)).toBe(2) // expected 11, got 13 -> lost 11,12
  })
  it('no gap on consecutive', () => {
    expect(detectSeqGap(10, 11)).toBe(0)
  })
  it('ignores out-of-order/duplicate', () => {
    expect(detectSeqGap(10, 10)).toBe(0)
    expect(detectSeqGap(10, 9)).toBe(0)
  })
  it('first sample has no previous -> no gap', () => {
    expect(detectSeqGap(undefined, 5)).toBe(0)
  })
})

describe('buildRetransmitRequest', () => {
  it('requests a window ending at lastAckedSeq', () => {
    expect(buildRetransmitRequest(100, 10)).toEqual({ type: 'request_replay', fromSeq: 91, toSeq: 100 })
  })
  it('clamps fromSeq at 0', () => {
    expect(buildRetransmitRequest(3, 10)).toEqual({ type: 'request_replay', fromSeq: 0, toSeq: 3 })
  })
})

describe('extrapolatePosition', () => {
  it('projects along recent velocity', () => {
    const prev = { x: 0, z: 0, t: 0 }
    const last = { x: 1, z: 0, t: 1000 } // vx = 1 m/s
    const out = extrapolatePosition(prev, last, 2000) // +1s
    expect(out.x).toBeCloseTo(2)
    expect(out.z).toBeCloseTo(0)
  })
  it('degenerate timing falls back to last position', () => {
    const last = { x: 5, z: 5, t: 1000 }
    expect(extrapolatePosition(last, last, 2000)).toEqual({ x: 5, z: 5 })
  })
})
