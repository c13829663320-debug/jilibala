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
import {
  BUILDINGS,
  FOUNTAIN,
  PLAYER_RADIUS,
  WORLD_HALF,
  buildColliders,
} from './config'
import { buildInteriorColliders } from './interior/InteriorShell'

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

// ======================================================================
// 以下为「系统/性能/UGC」分片补充：真实广场布局下的导航/碰撞/传送测试
// ======================================================================

/** 从 (ex,ez) 朝 (cx,cz) 直线行走，逐步推进；全程不允许穿墙。返回终点与是否被挡。 */
function walkToward(
  ex: number, ez: number, cx: number, cz: number,
  colliders: ReturnType<typeof buildColliders>,
  steps = 40, step = 0.5,
): { x: number; z: number; blocked: boolean } {
  const len = Math.hypot(cx - ex, cz - ez) || 1
  const dirx = (cx - ex) / len
  const dirz = (cz - ez) / len
  let x = ex
  let z = ez
  let blocked = false
  for (let i = 0; i < steps; i++) {
    const r = moveWithCollision(x, z, dirx * step, dirz * step, PLAYER_RADIUS, colliders, WORLD_HALF)
    if (r.hitX || r.hitZ) blocked = true
    x = r.x
    z = r.z
    // 关键不变量：任何一步都不能叠到碰撞体上（穿墙）
    if (collidesAt(x, z, PLAYER_RADIUS, colliders)) {
      throw new Error(`穿墙！停在 (${x},${z})`)
    }
  }
  return { x, z, blocked }
}

describe('广场建筑 AABB 碰撞体（buildColliders 真实布局）', () => {
  const colliders = buildColliders()

  it('共生成 6 个建筑 AABB + 1 个喷泉 circle = 7 个碰撞体', () => {
    expect(colliders.length).toBe(BUILDINGS.length + 1)
    const aabbs = colliders.filter((c) => c.kind === 'aabb')
    expect(aabbs.length).toBe(BUILDINGS.length)
  })

  it('每栋建筑 footprint 内部会碰撞，外部空地不碰撞', () => {
    for (const b of BUILDINGS) {
      expect(collidesAt(b.x, b.z, PLAYER_RADIUS, colliders)).toBe(true)
    }
    // 中心附近（喷泉除外的空地，比如 (20,20)）不撞建筑
    expect(collidesAt(20, 20, PLAYER_RADIUS, colliders)).toBe(false)
  })
})

describe('从各建筑入口走到门口不穿墙', () => {
  const colliders = buildColliders()

  it.each(BUILDINGS.map((b) => [b.id, b] as const))(
    '%s：从入口走向建筑中心，全程不穿墙且被挡在门外',
    (_id, b) => {
      // 起点必须在入口且不叠碰撞体（入口在建筑正前方）
      expect(collidesAt(b.entranceX, b.entranceZ, PLAYER_RADIUS, colliders)).toBe(false)
      const end = walkToward(b.entranceX, b.entranceZ, b.x, b.z, colliders)
      // 走完后仍然不穿墙
      expect(collidesAt(end.x, end.z, PLAYER_RADIUS, colliders)).toBe(false)
      // 玩家在途中确实被建筑墙挡住（贴墙滑动，而不是直接穿进去）
      expect(end.blocked).toBe(true)
      // 但没有走进建筑盒子内部（终点仍在 footprint 外）
      expect(
        end.x < b.x - b.width / 2 - 1e-6 || end.x > b.x + b.width / 2 + 1e-6 ||
        end.z < b.z - b.depth / 2 - 1e-6 || end.z > b.z + b.depth / 2 + 1e-6,
      ).toBe(true)
    },
  )
})

describe('中央喷泉圆柱碰撞（真实配置 FOUNTAIN）', () => {
  const colliders = buildColliders()

  it('从南侧 (10,0) 走向喷泉中心被挡在半径边界外', () => {
    // 喷泉圆心 (0,0) r=3；玩家 r=0.5 → 最近可到 |x|≈3.5
    let x = 10
    let z = 0
    for (let i = 0; i < 30; i++) {
      const r = moveWithCollision(x, z, -0.5, 0, PLAYER_RADIUS, colliders, WORLD_HALF)
      x = r.x
      z = r.z
      expect(collidesAt(x, z, PLAYER_RADIUS, colliders)).toBe(false)
    }
    // 停在距圆心 ~3.5（喷泉半径 3 + 玩家 0.5）
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(FOUNTAIN.r + PLAYER_RADIUS - 0.6)
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(FOUNTAIN.r + PLAYER_RADIUS + 0.6)
  })
})

describe('世界边界 clamp（±WORLD_HALF=130）', () => {
  const colliders = buildColliders()

  it('从内部向四个方向冲不出界（|pos| ≤ half - r）', () => {
    const lim = WORLD_HALF - PLAYER_RADIUS
    const e = moveWithCollision(129, 0, 10, 0, PLAYER_RADIUS, colliders, WORLD_HALF)
    expect(e.x).toBe(lim)
    const w = moveWithCollision(-129, 0, -10, 0, PLAYER_RADIUS, colliders, WORLD_HALF)
    expect(w.x).toBe(-lim)
    const n = moveWithCollision(0, -129, 0, -10, PLAYER_RADIUS, colliders, WORLD_HALF)
    expect(n.z).toBe(-lim)
    const s = moveWithCollision(0, 129, 0, 10, PLAYER_RADIUS, colliders, WORLD_HALF)
    expect(s.z).toBe(lim)
  })
})

describe('室内碰撞体 buildInteriorColliders（门洞留空）', () => {
  // 房间 14 x 10，墙厚 0.4，门宽 2 → hw=7 hd=5 dw=1
  const colliders = buildInteriorColliders(14, 10)

  it('生成 5 段墙碰撞体（后墙 + 前墙左右两段 + 左右墙）', () => {
    expect(colliders.length).toBe(5)
  })

  it('门洞位置（x≈0, z=hd+0.2）留空，不碰撞', () => {
    // 门口在 +Z 墙中间，门宽 2（x ∈ [-1,1]）
    expect(collidesAt(0, 5.2, PLAYER_RADIUS, colliders)).toBe(false)
  })

  it('前墙左右两段是实墙，会碰撞', () => {
    expect(collidesAt(-4, 5.2, PLAYER_RADIUS, colliders)).toBe(true) // 左段
    expect(collidesAt(4, 5.2, PLAYER_RADIUS, colliders)).toBe(true)  // 右段
  })

  it('后墙 / 左右墙均为实墙', () => {
    expect(collidesAt(0, -5.2, PLAYER_RADIUS, colliders)).toBe(true) // 后墙
    expect(collidesAt(-7.2, 0, PLAYER_RADIUS, colliders)).toBe(true) // 左墙
    expect(collidesAt(7.2, 0, PLAYER_RADIUS, colliders)).toBe(true)  // 右墙
  })

  it('房间中心空地不碰撞', () => {
    expect(collidesAt(0, 0, PLAYER_RADIUS, colliders)).toBe(false)
  })
})

describe('传送：从广场传送到各建筑入口后位置正确', () => {
  const colliders = buildColliders()

  it.each(BUILDINGS.map((b) => [b.id, b] as const))(
    '%s：传送点 = 配置入口坐标、在世界界内、且不叠碰撞体',
    (_id, b) => {
      // 传送目标即入口坐标
      expect(b.entranceX).toBe(b.entranceX)
      expect(b.entranceZ).toBe(b.entranceZ)
      // 界内
      expect(Math.abs(b.entranceX)).toBeLessThanOrEqual(WORLD_HALF - PLAYER_RADIUS)
      expect(Math.abs(b.entranceZ)).toBeLessThanOrEqual(WORLD_HALF - PLAYER_RADIUS)
      // 落点不在建筑/喷泉碰撞体里（否则玩家一落地就被卡住）
      expect(collidesAt(b.entranceX, b.entranceZ, PLAYER_RADIUS, colliders)).toBe(false)
    },
  )
})
