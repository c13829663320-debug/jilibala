// ===== R4-01: 位置插值器单测（纯逻辑，无 DOM）=====
import { describe, expect, it } from 'vitest'
import { PositionInterpolator } from './position-interpolator'

const U = 'remote-1'

function make() {
  // 100ms 插值延迟，600ms 外推上限
  return new PositionInterpolator({ interpolationDelayMs: 100, maxExtrapolationMs: 600 })
}

describe('PositionInterpolator 远端位置插值与丢包外推', () => {
  it('1. 首个样本后立即查询：返回样本位置', () => {
    const ip = make()
    ip.update({ userId: U, x: 10, z: 20, rotation: 0.5, seq: 1, t: 0 })
    const p = ip.getPosition(U, 0)!
    expect(p.x).toBeCloseTo(10)
    expect(p.z).toBeCloseTo(20)
    expect(p.extrapolating).toBe(false)
  })

  it('2. 线性插值：两样本间，渲染位置滞后 100ms 落在中间', () => {
    const ip = make()
    // t=0 在 (0,0)，t=100 在 (10,0)
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 2, t: 100 })
    // now=150 → 渲染目标时刻 = 150-100 = 50，恰好在两样本中点
    const p = ip.getPosition(U, 150)!
    expect(p.x).toBeCloseTo(5, 3)
    expect(p.z).toBeCloseTo(0)
    expect(p.extrapolating).toBe(false)
  })

  it('3. 插值延迟生效：now=last.t 时仍渲染 prev 侧（不超前）', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 2, t: 100 })
    // now=100 → 目标时刻 0 → 应渲染 prev=(0,0)，而不是 (10,0)
    const p = ip.getPosition(U, 100)!
    expect(p.x).toBeCloseTo(0, 3)
  })

  it('4. 序号跳跃检测：seq 1→5 识别为丢包，进入外推状态', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 5, t: 100 }) // 跳了 3 个包
    expect(ip.hasGap(U)).toBe(true)
    // now=250：age=150ms > 100ms 插值窗，进入外推
    const p = ip.getPosition(U, 250)!
    expect(p.extrapolating).toBe(true)
  })

  it('5. 丢包外推：位置沿最近速度方向继续前进', () => {
    const ip = make()
    // 速度 = (10-0)/0.1s = 100 单位/秒，沿 +x
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 5, t: 100 }) // 丢包
    // now=300：age=200ms，外推 0.2s → x = 10 + 100*0.2 = 30
    const p = ip.getPosition(U, 300)!
    expect(p.extrapolating).toBe(true)
    expect(p.x).toBeCloseTo(30, 3)
  })

  it('6. 外推超时后停止：超过 maxExtrapolationMs 保持最后已知位置', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 5, t: 100 })
    // now=1000：age=900ms > 600ms 上限 → 不再外推，停在 (10,0)
    const p = ip.getPosition(U, 1000)!
    expect(p.x).toBeCloseTo(10, 3)
    expect(p.extrapolating).toBe(true) // 仍有未补偿缺口，但位置冻结
  })

  it('7. 乱序旧样本被忽略：seq 回退不改变位置', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 2, t: 100 })
    // 迟到的旧包 seq=1
    ip.update({ userId: U, x: -999, z: -999, rotation: 0, seq: 1, t: 50 })
    const p = ip.getPosition(U, 150)!
    // 不应被污染到 -999
    expect(p.x).toBeGreaterThan(-100)
    expect(p.z).toBeGreaterThan(-100)
  })

  it('8. 新样本到达后停止外推：缺口清零，位置收敛到新样本', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 0, seq: 1, t: 0 })
    ip.update({ userId: U, x: 10, z: 0, rotation: 0, seq: 5, t: 100 }) // 丢包
    expect(ip.hasGap(U)).toBe(true)
    // 下一个真实包 seq=6（连续）到达
    ip.update({ userId: U, x: 20, z: 0, rotation: 0, seq: 6, t: 200 })
    expect(ip.hasGap(U)).toBe(false)
    // now=250 → 插值窗内，应平滑回到真实轨迹，而非外推值
    const p = ip.getPosition(U, 250)!
    expect(p.extrapolating).toBe(false)
    // 目标时刻=150，在 (10,0)@100 与 (20,0)@200 之间 → x=15
    expect(p.x).toBeCloseTo(15, 3)
  })

  it('9. rotation 透传，remove/clear 生效', () => {
    const ip = make()
    ip.update({ userId: U, x: 0, z: 0, rotation: 1.23, seq: 1, t: 0 })
    expect(ip.getPosition(U, 0)!.rotation).toBeCloseTo(1.23)
    ip.remove(U)
    expect(ip.getPosition(U, 0)).toBeNull()

    ip.update({ userId: U, x: 1, z: 2, rotation: 0, seq: 1, t: 0 })
    ip.clear()
    expect(ip.getPosition(U, 0)).toBeNull()
  })
})
