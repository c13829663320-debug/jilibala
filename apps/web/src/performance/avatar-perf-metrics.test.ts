import { describe, it, expect } from 'vitest'
import { AnimTimer, buildSample } from './avatar-perf-metrics'

describe('AnimTimer：动画评估耗时滚动平均', () => {
  it('无采样时 avg/last 为 0', () => {
    const t = new AnimTimer(() => 0)
    expect(t.avg).toBe(0)
    expect(t.last).toBe(0)
  })

  it('begin/end 记录耗时并求平均', () => {
    let now = 0
    const t = new AnimTimer(() => now)
    t.begin(); now = 5; t.end()   // 5ms
    t.begin(); now = 12; t.end()  // 7ms
    expect(t.last).toBe(7)
    expect(t.avg).toBeCloseTo(6)
    expect(t.sampleCount).toBe(2)
  })

  it('未 begin 直接 end 返回 0', () => {
    const t = new AnimTimer(() => 100)
    expect(t.end()).toBe(0)
  })

  it('滚动窗口只保留最近 WINDOW 个样本', () => {
    let now = 0
    const t = new AnimTimer(() => now)
    for (let i = 0; i < 50; i++) {
      t.begin(); now += 2; t.end()
    }
    // 窗口 30，每个样本 2ms → 平均 2
    expect(t.sampleCount).toBe(30)
    expect(t.avg).toBeCloseTo(2)
  })
})

describe('buildSample：聚合面板数据', () => {
  it('把 stats + timer 拼成面板样本', () => {
    const t = new AnimTimer(() => 0)
    const s = buildSample('u1', 'LOD1', { drawCalls: 4, triangles: 12000, bones: 0 }, t)
    expect(s).toMatchObject({
      avatarId: 'u1',
      level: 'LOD1',
      drawCalls: 4,
      triangles: 12000,
      bones: 0,
      avgAnimEvalMs: 0,
    })
  })
})
