// state-sync.ts 纯逻辑单测：插值正确性 / 外推 / 冻结 / 裁剪 snap / 角度最短路径。
import { describe, it, expect } from 'vitest'
import {
  RemotePlayerBuffer,
  lerp,
  lerpAngle,
  distance,
  shouldSnap,
  interpolateSnapshots,
  normalizeAngle,
  type RemoteSnapshot,
} from './state-sync'

function snap(t: number, x: number, z: number, rotation = 0, extra: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return { x, z, rotation, serverTs: t, ...extra }
}

describe('纯函数工具', () => {
  it('lerp 线性插值', () => {
    expect(lerp(0, 10, 0.5)).toBeCloseTo(5)
    expect(lerp(2, 4, 0)).toBeCloseTo(2)
    expect(lerp(2, 4, 1)).toBeCloseTo(4)
  })

  it('distance 欧氏距离', () => {
    expect(distance(0, 0, 3, 4)).toBeCloseTo(5)
  })

  it('normalizeAngle 收敛到 (-PI, PI]', () => {
    expect(normalizeAngle(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5)
    expect(normalizeAngle(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5)
  })

  it('lerpAngle 走最短路径（不绕远）', () => {
    // -170° → +170° 实际只差 20°，t=0.5 应到 -180°/180° 交界附近，而非 0°。
    const a = (-170 * Math.PI) / 180
    const b = (170 * Math.PI) / 180
    const mid = lerpAngle(a, b, 0.5)
    // 最短路径下中点应约为 ±180°
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(0.01)
  })

  it('shouldSnap 阈值判定', () => {
    expect(shouldSnap(0, 0, 40, 0, 50)).toBe(false)
    expect(shouldSnap(0, 0, 60, 0, 50)).toBe(true)
  })
})

describe('interpolateSnapshots', () => {
  it('位置线性插值、离散字段取较新快照', () => {
    const a = snap(0, 0, 0, 0, { animation: 'idle', talkingIntensity: 0 })
    const b = snap(100, 10, 20, Math.PI / 2, { animation: 'wave', talkingIntensity: 0.8 })
    const r = interpolateSnapshots(a, b, 0.25)
    expect(r.x).toBeCloseTo(2.5)
    expect(r.z).toBeCloseTo(5)
    expect(r.animation).toBe('wave') // 即时切换
    expect(r.talkingIntensity).toBeCloseTo(0.2)
    expect(r.stale).toBe(false)
  })
})

describe('RemotePlayerBuffer · 插值', () => {
  it('在两快照之间按 interpolationDelay 延迟渲染并线性插值', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100, maxExtrapolationMs: 250, positionClipThreshold: 50 })
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0))
    // 渲染时刻 now=1250 → rt=1150，落在 1000..1100 之外（rt>1100）进入外推区。
    // 改用 now=1200 → rt=1100，正好在 b。
    let r = buf.sample(1200)
    expect(r.x).toBeCloseTo(10)
    // now=1150 → rt=1050，在 a(1000) b(1100) 正中 → x=5
    r = buf.sample(1150)
    expect(r.x).toBeCloseTo(5)
    expect(r.extrapolating).toBe(false)
    expect(r.stale).toBe(false)
  })

  it('渲染时刻早于最早快照时停在最早快照', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100 })
    buf.push(snap(1000, 5, 5))
    const r = buf.sample(500) // rt=400 < 1000
    expect(r.x).toBeCloseTo(5)
  })
})

describe('RemotePlayerBuffer · 外推与冻结', () => {
  it('rt 超前于最新快照时按速度外推', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100, maxExtrapolationMs: 250 })
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0)) // 速度 = 10/100ms = 0.1 单位/ms
    // now=1300 → rt=1200，比 last(1100) 超前 100ms → x = 10 + 0.1*100 = 20
    const r = buf.sample(1300)
    expect(r.extrapolating).toBe(true)
    expect(r.stale).toBe(false)
    expect(r.x).toBeCloseTo(20)
  })

  it('超过 maxExtrapolationMs 后冻结并标记 stale', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100, maxExtrapolationMs: 250 })
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0))
    // now=1500 → rt=1400，比 last(1100) 超前 300ms > 250 → 冻结在 last
    const r = buf.sample(1500)
    expect(r.stale).toBe(true)
    expect(r.extrapolating).toBe(false)
    expect(r.x).toBeCloseTo(10) // 不再外推，停在最后已知位置
  })
})

describe('RemotePlayerBuffer · 裁剪 snap', () => {
  it('新位置与外推位置差距超过阈值时直接 snap，不做插值', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100, maxExtrapolationMs: 250, positionClipThreshold: 50 })
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0))
    // 外推位置在 arrivalNow=1200(rt=1100)=10；新快照瞬移到 (100,0)，距离 90 > 50
    const res = buf.push(snap(1200, 100, 0), 1200)
    expect(res.snapped).toBe(true)
    expect(res.queueLength).toBe(1)
    // snap 后立即渲染应贴近新位置，而不是从 10 缓慢插值
    const r = buf.sample(1300) // rt=1200 == new snapshot ts
    expect(r.x).toBeCloseTo(100)
  })

  it('正常移动不触发 snap', () => {
    const buf = new RemotePlayerBuffer({ interpolationDelayMs: 100, positionClipThreshold: 50 })
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0), 1100)
    const res = buf.push(snap(1200, 20, 0), 1200)
    expect(res.snapped).toBe(false)
    expect(res.queueLength).toBeGreaterThanOrEqual(2)
  })
})

describe('RemotePlayerBuffer · 乱序旧包', () => {
  it('serverTs 不大于最新快照的旧包被忽略', () => {
    const buf = new RemotePlayerBuffer()
    buf.push(snap(1000, 0, 0))
    buf.push(snap(1100, 10, 0))
    const before = buf.size
    buf.push(snap(1050, -999, -999)) // 乱序旧包
    expect(buf.size).toBe(before)
    // 渲染不应被旧包污染
    const r = buf.sample(1150)
    expect(r.x).toBeCloseTo(5) // 仍在 0..10 之间插值
  })
})
