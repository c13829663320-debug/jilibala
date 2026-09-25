/**
 * 碰撞系统单测：圆 vs AABB、圆 vs 圆、分轴滑动、世界边界阻挡。
 * 这些是纯函数，不需要 WebGL / Canvas，vitest 直接跑。
 */
import { describe, expect, it } from 'vitest'
import {
  aabbCollider,
  circleVsAABB,
  circleVsCircle,
  circleCollider,
  clampToBoundary,
  collidesAt,
  moveWithCollision,
} from './collision'

describe('circleVsAABB 圆-盒相交', () => {
  const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }

  it('圆心在盒子内部 → 相交', () => {
    expect(circleVsAABB(5, 5, 0.5, box)).toBe(true)
  })
  it('圆在盒子正外侧、半径够不到 → 不相交', () => {
    // 圆心在 (12, 5)，盒子右边 maxX=10，间距 2 > r=0.5
    expect(circleVsAABB(12, 5, 0.5, box)).toBe(false)
  })
  it('圆贴在盒子边上 → 相交', () => {
    // 圆心在 (10.3, 5)，距边 0.3 < r=0.5
    expect(circleVsAABB(10.3, 5, 0.5, box)).toBe(true)
  })
  it('圆在盒子角外、半径够不到角 → 不相交', () => {
    // (13,13) 到角 (10,10) 距离 sqrt(18)≈4.24 > r=0.5
    expect(circleVsAABB(13, 13, 0.5, box)).toBe(false)
  })
  it('圆刚好碰到盒子角 → 相交', () => {
    // (10.5, 10.5) 到角 (10,10) 距离 sqrt(0.5)≈0.707 > r=0.5 → 不相交
    expect(circleVsAABB(10.5, 10.5, 0.5, box)).toBe(false)
    // (10.2, 10.2) 距离 sqrt(0.08)≈0.28 < r=0.5 → 相交
    expect(circleVsAABB(10.2, 10.2, 0.5, box)).toBe(true)
  })
})

describe('circleVsCircle 圆-圆相交', () => {
  it('两圆分离 → 不相交', () => {
    expect(circleVsCircle(0, 0, 0.5, 10, 0, 0.5)).toBe(false)
  })
  it('两圆相切/重叠 → 相交', () => {
    // 圆心距 1.0，半径和 0.5+0.6=1.1 → 相交
    expect(circleVsCircle(0, 0, 0.5, 1.0, 0, 0.6)).toBe(true)
  })
})

describe('collidesAt 综合判定', () => {
  it('建筑 AABB + 喷泉 circle 混合判定', () => {
    const colliders = [
      aabbCollider(0, 10, 0, 10),       // 建筑
      circleCollider(20, 20, 2),        // 喷泉
    ]
    // 站在建筑里
    expect(collidesAt(5, 5, 0.5, colliders)).toBe(true)
    // 站在喷泉上
    expect(collidesAt(20, 20, 0.5, colliders)).toBe(true)
    // 站在空地
    expect(collidesAt(50, 50, 0.5, colliders)).toBe(false)
  })
})

describe('clampToBoundary 世界边界', () => {
  it('超出边界的位置被夹回 [-half+r, half-r]', () => {
    const r = 0.5
    const half = 130
    const res = clampToBoundary(999, -999, r, half)
    expect(res.x).toBe(half - r)
    expect(res.z).toBe(-(half - r))
  })
  it('边界内位置原样保留', () => {
    const res = clampToBoundary(10, -20, 0.5, 130)
    expect(res.x).toBe(10)
    expect(res.z).toBe(-20)
  })
})

describe('moveWithCollision 分轴滑动', () => {
  // 一堵沿 Z 方向的墙：x=0..2, z=-100..100
  const wall = [aabbCollider(0, 2, -100, 100)]
  const half = 130

  it('靠近墙时向右走会被挡住（小步长不穿透）', () => {
    // 玩家圆心 x=-1（圆右缘 -0.5，距墙左缘 x=0 还有 0.5），r=0.5。
    // 再走 dx=0.6 → x=-0.4，圆右缘 0.1 已经压进墙内 → 应被挡。
    const res = moveWithCollision(-1, 0, 0.6, 0, 0.5, wall, half)
    expect(res.hitX).toBe(true)
    expect(res.x).toBe(-1) // X 位移被放弃，位置不变
  })

  it('斜向撞墙时沿墙滑动（Z 仍能动）', () => {
    // 站在墙左边 x=-1, z=0，向右前方走 dx=0.6, dz=0.5
    const res = moveWithCollision(-1, 0, 0.6, 0.5, 0.5, wall, half)
    expect(res.hitX).toBe(true)
    expect(res.x).toBe(-1) // X 被挡
    expect(res.z).toBe(0.5) // Z 成功滑动
  })

  it('无阻碍时自由移动', () => {
    const res = moveWithCollision(-50, -50, 10, 10, 0.5, wall, half)
    expect(res.x).toBe(-40)
    expect(res.z).toBe(-40)
    expect(res.hitX).toBe(false)
    expect(res.hitZ).toBe(false)
  })

  it('世界边界阻挡：从内部向外冲不出界', () => {
    // 站在 x=120（half=130, r=0.5, lim=129.5），再走 dx=20
    const res = moveWithCollision(120, 0, 20, 0, 0.5, [], half)
    expect(res.x).toBeLessThanOrEqual(129.5 + 1e-9)
    expect(res.x).toBe(129.5)
  })

  it('喷泉圆柱会阻挡玩家（靠近到半径边界后被挡住）', () => {
    const fountain = [circleCollider(0, 0, 3)]
    // 从 (5,0) 向左走 dx=-1 → x=4（距圆心 4 > 半径和 3.5），可以走
    const approach = moveWithCollision(5, 0, -1, 0, 0.5, fountain, half)
    expect(approach.x).toBe(4)
    // 再向左走 dx=-2 → 目标 x=2（距圆心 2 < 3.5），被挡住，停在 x=4
    const blocked = moveWithCollision(4, 0, -2, 0, 0.5, fountain, half)
    expect(blocked.x).toBe(4)
    expect(blocked.hitX).toBe(true)
  })
})
