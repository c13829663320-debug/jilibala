import { describe, it, expect } from 'vitest'
import { gazeAnglesTo, createGazeTracker, wrapAngle } from './gaze-system'

describe('注视系统：角度计算', () => {
  it('正前方目标偏航≈0', () => {
    const a = gazeAnglesTo({ x: 0, z: 2 }, { x: 0, z: 0 }, 0)
    expect(a.yaw).toBeCloseTo(0, 5)
  })

  it('右侧目标偏航=+PI/2（three.js 前方为 +Z）', () => {
    const a = gazeAnglesTo({ x: 2, z: 0 }, { x: 0, z: 0 }, 0)
    expect(a.yaw).toBeCloseTo(Math.PI / 2, 5)
  })

  it('自身朝向会被扣除', () => {
    // 面向 PI/2（朝 +X），目标在原坐标右侧 (+x)
    const a = gazeAnglesTo({ x: 2, z: 0 }, { x: 0, z: 0 }, Math.PI / 2)
    expect(a.yaw).toBeCloseTo(0, 5)
  })

  it('wrapAngle 把角度折叠到 [-PI, PI]', () => {
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 5)
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 5)
  })
})

describe('注视系统：优先级', () => {
  it('无目标时走 random', () => {
    const g = createGazeTracker({ random: () => 0.99, blinkMs: 99999 })
    const u = g.update(0)
    expect(u.source).toBe('random')
  })

  it('speaker 目标优先于 random', () => {
    const g = createGazeTracker({ random: () => 0.99, blinkMs: 99999 })
    g.setTarget('speaker', { x: 1, z: 2 })
    const u = g.update(0)
    expect(u.source).toBe('speaker')
    expect(u.point).toEqual({ x: 1, z: 2 })
  })

  it('user 优先于 speaker', () => {
    const g = createGazeTracker({ random: () => 0.99, blinkMs: 99999 })
    g.setTarget('speaker', { x: 1, z: 2 })
    g.setTarget('user', { x: 5, z: 5 })
    expect(g.update(0).source).toBe('user')
    // 清除 user 后回退 speaker
    g.setTarget('user', null)
    expect(g.update(0).source).toBe('speaker')
  })
})

describe('注视系统：眨眼', () => {
  it('眨眼期间 eyeOpen 下降', () => {
    // random 返回 0 让 nextBlinkAt 立刻触发
    const g = createGazeTracker({ random: () => 0, blinkMs: 0, blinkDurationMs: 200 })
    // t=0 触发眨眼开始
    g.update(0)
    // 眨眼中点应闭合
    const mid = g.update(100)
    expect(mid.eyeOpen).toBeLessThan(0.5)
    // 眨眼结束恢复
    const end = g.update(250)
    expect(end.eyeOpen).toBeCloseTo(1, 3)
  })
})

describe('注视系统：随机扫视', () => {
  it('random 模式下随时间换点', () => {
    let i = 0
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    const g = createGazeTracker({
      random: () => seq[i++ % seq.length],
      saccadeMs: 100,
      blinkMs: 99999,
    })
    const p1 = g.update(0).point
    const p2 = g.update(200).point // 超过 saccade 间隔，换点
    expect(p2).not.toEqual(p1)
  })
})
