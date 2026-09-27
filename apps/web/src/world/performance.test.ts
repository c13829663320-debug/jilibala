/**
 * PerformanceHUD 纯逻辑单测：开关判定、FPS 计算、数字格式化、render info 读取。
 * 不加载 WebGL；@react-three/fiber 在 node 下可安全 import（仅取值，不渲染）。
 */
import { describe, expect, it } from 'vitest'
import {
  FpsWindow,
  computeFps,
  formatCount,
  isPerfEnabled,
  perfParamOn,
  perfStorageOn,
  readRenderInfo,
} from './PerformanceHUD'

describe('开关判定', () => {
  it('URL ?perf=1 开启', () => {
    expect(perfParamOn('?perf=1')).toBe(true)
    expect(perfParamOn('/plaza?foo=bar&perf=1')).toBe(true)
  })
  it('?perf=0 / 缺失 不开启', () => {
    expect(perfParamOn('?perf=0')).toBe(false)
    expect(perfParamOn('')).toBe(false)
    expect(perfParamOn('?performance=1')).toBe(false)
  })
  it('localStorage 开关', () => {
    const mk = (v: string | null) => ({ getItem: () => v })
    expect(perfStorageOn(mk('1'))).toBe(true)
    expect(perfStorageOn(mk('true'))).toBe(true)
    expect(perfStorageOn(mk('0'))).toBe(false)
    expect(perfStorageOn(undefined)).toBe(false)
  })
  it('URL 或 localStorage 任一为真即开启', () => {
    const lsOn = { getItem: () => '1' }
    const lsOff = { getItem: () => null }
    expect(isPerfEnabled('', lsOn)).toBe(true)
    expect(isPerfEnabled('?perf=1', lsOff)).toBe(true)
    expect(isPerfEnabled('', lsOff)).toBe(false)
  })
})

describe('FPS 计算', () => {
  it('60fps delta(1/60) 序列 → 60', () => {
    const deltas = new Array(30).fill(1 / 60)
    expect(computeFps(deltas)).toBeCloseTo(60, 1)
  })
  it('空样本 → 0', () => {
    expect(computeFps([])).toBe(0)
  })
  it('FpsWindow 滚动窗口平滑', () => {
    const w = new FpsWindow(5)
    // 前两帧慢（10fps），后面 60fps → 窗口平均后趋近 60
    w.sample(0.1); w.sample(0.1)
    for (let i = 0; i < 5; i++) w.sample(1 / 60)
    expect(w.fps()).toBeGreaterThan(40)
    expect(w.fps()).toBeLessThanOrEqual(60)
  })
  it('非正 delta 被忽略', () => {
    const w = new FpsWindow(5)
    w.sample(0); w.sample(-1); w.sample(1 / 30)
    expect(w.fps()).toBeCloseTo(30, 1)
  })
})

describe('数字格式化', () => {
  it('小数字原样', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
  })
  it('千 / 百万缩写', () => {
    expect(formatCount(1234)).toBe('1.2k')
    expect(formatCount(1_500_000)).toBe('1.50M')
  })
})

describe('readRenderInfo 读取 three renderer.info', () => {
  it('映射 calls/triangles/points/lines', () => {
    const info = { render: { calls: 42, triangles: 12345, points: 0, lines: 3 } }
    const r = readRenderInfo(info)
    expect(r.calls).toBe(42)
    expect(r.triangles).toBe(12345)
    expect(r.lines).toBe(3)
  })
  it('缺字段安全降级为 0', () => {
    expect(readRenderInfo({}).calls).toBe(0)
    expect(readRenderInfo({ render: {} }).triangles).toBe(0)
  })
})
