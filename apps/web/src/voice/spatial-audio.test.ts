// ===== spatial-audio 纯逻辑单测（Node 环境，不依赖浏览器 API）=====
import { describe, expect, it } from 'vitest'
import {
  computeDistanceGain,
  computeStereoPan,
  pickSubscribers,
  type Vec2,
} from './spatial-audio'

describe('computeDistanceGain 距离衰减', () => {
  it('distance=0 返回 1（贴脸最大声）', () => {
    expect(computeDistanceGain(0, 1, 15, 1)).toBe(1)
  })

  it('负值距离视为贴脸，返回 1', () => {
    expect(computeDistanceGain(-3, 1, 15, 1)).toBe(1)
  })

  it('distance <= refDistance 时保持 1（参考距离内不衰减）', () => {
    expect(computeDistanceGain(0.5, 1, 15, 1)).toBe(1)
    expect(computeDistanceGain(1, 1, 15, 1)).toBe(1)
  })

  it('refDistance < distance < maxDistance 时按 inverse 模型衰减', () => {
    // ref=1, rolloff=1, dist=2 → 1/(1+1*(2-1)) = 0.5
    expect(computeDistanceGain(2, 1, 15, 1)).toBeCloseTo(0.5)
    // dist=6 → 1/(1+5) ≈ 0.1667
    expect(computeDistanceGain(6, 1, 15, 1)).toBeCloseTo(1 / 6)
  })

  it('rolloff 越大衰减越快', () => {
    const gentle = computeDistanceGain(5, 1, 15, 0.5)
    const steep = computeDistanceGain(5, 1, 15, 2)
    expect(steep).toBeLessThan(gentle)
  })

  it('distance >= maxDistance 返回 0（含边界）', () => {
    expect(computeDistanceGain(15, 1, 15, 1)).toBe(0)
    expect(computeDistanceGain(100, 1, 15, 1)).toBe(0)
  })

  it('非法参数不抛错并给出保守结果', () => {
    expect(computeDistanceGain(NaN, 1, 15, 1)).toBe(0)
    expect(computeDistanceGain(5, 0, 15, 1)).toBeGreaterThanOrEqual(0)
    expect(computeDistanceGain(5, 1, 0, 1)).toBe(0) // maxDistance<=ref 直接 0
    expect(computeDistanceGain(5, 1, 15, -1)).toBeGreaterThanOrEqual(0)
  })

  it('返回值始终在 [0,1]', () => {
    for (const d of [-10, 0, 0.5, 1, 2, 7, 14.999, 15, 50]) {
      const g = computeDistanceGain(d, 1, 15, 1)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
    }
  })
})

describe('pickSubscribers 距离订阅裁剪', () => {
  const local: Vec2 = { x: 0, z: 0 }

  it('空输入返回空数组', () => {
    expect(pickSubscribers(local, new Map(), 8, 15)).toEqual([])
  })

  it('按距离升序返回最近的玩家', () => {
    const peers = new Map<string, Vec2>([
      ['far', { x: 10, z: 0 }],
      ['near', { x: 1, z: 0 }],
      ['mid', { x: 5, z: 0 }],
    ])
    expect(pickSubscribers(local, peers, 8, 15)).toEqual(['near', 'mid', 'far'])
  })

  it('裁剪到 maxCount', () => {
    const peers = new Map<string, Vec2>([
      ['a', { x: 1, z: 0 }],
      ['b', { x: 2, z: 0 }],
      ['c', { x: 3, z: 0 }],
      ['d', { x: 4, z: 0 }],
    ])
    expect(pickSubscribers(local, peers, 2, 15)).toEqual(['a', 'b'])
  })

  it('过滤掉距离 > maxDistance 的玩家', () => {
    const peers = new Map<string, Vec2>([
      ['near', { x: 3, z: 0 }],
      ['out', { x: 20, z: 0 }],
      ['edge', { x: 15, z: 0 }], // 边界 <= maxDistance 保留
    ])
    expect(pickSubscribers(local, peers, 8, 15)).toEqual(['near', 'edge'])
  })

  it('maxCount <= 0 返回空', () => {
    const peers = new Map<string, Vec2>([['a', { x: 1, z: 0 }]])
    expect(pickSubscribers(local, peers, 0, 15)).toEqual([])
  })

  it('距离相同时按 userId 字典序，结果稳定', () => {
    const peers = new Map<string, Vec2>([
      ['zoe', { x: 1, z: 0 }],
      ['amy', { x: 1, z: 0 }],
      ['bob', { x: 1, z: 0 }],
    ])
    expect(pickSubscribers(local, peers, 8, 15)).toEqual(['amy', 'bob', 'zoe'])
  })
})

describe('computeStereoPan 立体声方位', () => {
  const local: Vec2 = { x: 0, z: 0 }

  it('正前方 pan = 0', () => {
    // peer 在 -z（前方）
    expect(computeStereoPan(local, { x: 0, z: -5 })).toBeCloseTo(0)
  })

  it('正右方 pan = 1', () => {
    expect(computeStereoPan(local, { x: 5, z: 0 })).toBeCloseTo(1)
  })

  it('正左方 pan = -1', () => {
    expect(computeStereoPan(local, { x: -5, z: 0 })).toBeCloseTo(-1)
  })

  it('返回值始终在 [-1,1]', () => {
    for (const p of [
      { x: 0, z: 5 },    // 正后方
      { x: 3, z: -3 },  // 右前
      { x: -3, z: -3 },  // 左前
      { x: 100, z: 100 },
    ]) {
      const pan = computeStereoPan(local, p)
      expect(pan).toBeGreaterThanOrEqual(-1)
      expect(pan).toBeLessThanOrEqual(1)
    }
  })

  it('对角线方位介于 0 和 ±1 之间', () => {
    // 右前方 45° → pan ≈ 0.5
    expect(computeStereoPan(local, { x: 3, z: -3 })).toBeCloseTo(0.5)
  })
})
