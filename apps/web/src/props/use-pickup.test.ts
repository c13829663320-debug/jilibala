// ===== R4-09: 可拾取交互纯逻辑测试 =====
import { describe, expect, it } from 'vitest'
import {
  computeDropPosition,
  computeHoldPosition,
  createPickupState,
  distanceXZ,
  findNearbyPickable,
  interact,
  refreshNearby,
  type PickupableItem,
} from './use-pickup'
import { HOLD_DISTANCE, HOLD_HEIGHT, PICKUP_RANGE } from './prop-library'

function items(...defs: Array<[string, number, number, boolean]>): PickupableItem[] {
  return defs.map(([propId, x, z, pickable], i) => ({
    propId,
    instanceId: `${propId}-${i}`,
    x,
    z,
    pickable,
  }))
}

describe('距离检测', () => {
  it('distanceXZ 计算 XZ 平面距离', () => {
    expect(distanceXZ(0, 0, 3, 4)).toBeCloseTo(5, 5)
    expect(distanceXZ(1, 1, 1, 1)).toBe(0)
  })

  it('findNearbyPickable 只返回 PICKUP_RANGE 内的可拾取道具', () => {
    const list = items(
      ['book', 1, 0, true],       // 距玩家(0,0)=1
      ['lamp', 5, 0, true],       // 距=5，超范围
      ['table', 0.5, 0, false],   // 不可拾取
    )
    const near = findNearbyPickable(0, 0, list)
    expect(near?.propId).toBe('book')
  })

  it('范围内无可拾取道具返回 null', () => {
    const list = items(['table', 0.5, 0, false], ['lamp', 10, 0, true])
    expect(findNearbyPickable(0, 0, list)).toBeNull()
  })

  it('返回距离最近的可拾取道具', () => {
    const list = items(
      ['book', 1.5, 0, true],
      ['lamp', 0.8, 0, true],
    )
    expect(findNearbyPickable(0, 0, list)?.propId).toBe('lamp')
  })
})

describe('拾取/放下状态机', () => {
  it('初始状态为 idle', () => {
    const s = createPickupState()
    expect(s.phase).toBe('idle')
    expect(s.heldPropId).toBeNull()
  })

  it('走近道具 → phase 变为 nearby 并记录 nearPropId', () => {
    const list = items(['book', 1, 0, true])
    const s = refreshNearby(createPickupState(), 0, 0, list)
    expect(s.phase).toBe('nearby')
    expect(s.nearPropId).toBe('book')
  })

  it('附近按 E → 拾取，进入 holding 并记录 heldPropId', () => {
    const list = items(['book', 1, 0, true])
    const near = refreshNearby(createPickupState(), 0, 0, list)
    const held = interact(near)
    expect(held.phase).toBe('holding')
    expect(held.heldPropId).toBe('book')
    expect(held.nearPropId).toBeNull()
  })

  it('手持中再按 E → 放下，回到 idle', () => {
    const list = items(['book', 1, 0, true])
    const held = interact(refreshNearby(createPickupState(), 0, 0, list))
    const dropped = interact(held)
    expect(dropped.phase).toBe('idle')
    expect(dropped.heldPropId).toBeNull()
  })

  it('idle 状态按 E 不变化', () => {
    const s = createPickupState()
    expect(interact(s)).toEqual(s)
  })

  it('手持中移动不会切换到别的道具（保持 heldPropId）', () => {
    const list = items(
      ['book', 0, 0, true],
      ['lamp', 0.5, 0, true],
    )
    const held = interact(refreshNearby(createPickupState(), 0, 0, list))
    // 玩家移动到 lamp 旁边
    const moved = refreshNearby(held, 0.5, 0, list)
    expect(moved.heldPropId).toBe('book')
    expect(moved.phase).toBe('holding')
  })
})

describe('手持位置计算', () => {
  it('computeHoldPosition 在玩家身前胸口高度', () => {
    const pos = computeHoldPosition(0, 0, Math.PI)
    // rotation=PI → forward=(0,-1)，身前为 -Z
    expect(pos.x).toBeCloseTo(0, 5)
    expect(pos.z).toBeCloseTo(-HOLD_DISTANCE, 5)
    expect(pos.y).toBe(HOLD_HEIGHT)
  })

  it('面向 0 弧度时身前为 +Z', () => {
    const pos = computeHoldPosition(0, 0, 0)
    expect(pos.z).toBeCloseTo(HOLD_DISTANCE, 5)
  })

  it('computeDropPosition 落点在地面（y=0）', () => {
    const drop = computeDropPosition(0, 0, Math.PI)
    expect(drop.y).toBe(0)
    expect(drop.z).toBeCloseTo(-HOLD_DISTANCE, 5)
  })

  it('PICKUP_RANGE 默认值被 findNearbyPickable 使用', () => {
    const list = items(['book', PICKUP_RANGE - 0.01, 0, true], ['lamp', PICKUP_RANGE + 0.01, 0, true])
    expect(findNearbyPickable(0, 0, list)?.propId).toBe('book')
  })
})
