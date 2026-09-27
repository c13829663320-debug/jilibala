// ===== R4-09: CC0 道具库测试 =====
import { describe, expect, it } from 'vitest'
import {
  PROP_LIBRARY,
  PICKUP_RANGE,
  getPropById,
  listPickablePropIds,
  isPropValid,
} from './prop-library'

describe('CC0 道具目录', () => {
  it('内置至少 12 个道具', () => {
    expect(PROP_LIBRARY.length).toBeGreaterThanOrEqual(12)
  })

  it('包含任务要求的 12 类道具', () => {
    const ids = PROP_LIBRARY.map((p) => p.id)
    for (const want of ['bench', 'table', 'lamp', 'bookshelf', 'plant', 'picture', 'fountain', 'statue', 'chessboard', 'microphone', 'dumbbell', 'book']) {
      expect(ids).toContain(want)
    }
  })

  it('所有道具 id 唯一且定义完整', () => {
    const ids = PROP_LIBRARY.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const prop of PROP_LIBRARY) {
      expect(isPropValid(prop)).toBe(true)
    }
  })

  it('每个道具至少有一个程序化几何体部件，且无外部模型 URL', () => {
    for (const prop of PROP_LIBRARY) {
      expect(prop.parts.length).toBeGreaterThanOrEqual(1)
      for (const part of prop.parts) {
        // 只允许 three.js 基础形状，不依赖外部 GLB
        expect(['box', 'cylinder', 'cone', 'sphere', 'torus', 'plane']).toContain(part.shape)
        expect(part.args.length).toBeGreaterThan(0)
      }
    }
  })

  it('可拾取标记正确：家具重件(fountain/statue/bookshelf/table/picture)不可拾取', () => {
    for (const id of ['fountain', 'statue', 'bookshelf', 'table', 'picture']) {
      expect(getPropById(id)?.pickable).toBe(false)
    }
  })

  it('互动道具标记为可拾取（dumbbell/book/microphone/chessboard）', () => {
    for (const id of ['dumbbell', 'book', 'microphone', 'chessboard']) {
      expect(getPropById(id)?.pickable).toBe(true)
    }
  })

  it('listPickablePropIds 只返回可拾取道具，且数量 > 0', () => {
    const pickable = listPickablePropIds()
    expect(pickable.length).toBeGreaterThan(0)
    for (const id of pickable) {
      expect(getPropById(id)?.pickable).toBe(true)
    }
  })

  it('每个道具都有交互动作描述与 emoji', () => {
    for (const prop of PROP_LIBRARY) {
      expect(prop.interactAction.length).toBeGreaterThan(0)
      expect(prop.emoji.length).toBeGreaterThan(0)
    }
  })

  it('PICKUP_RANGE 为 2 米（与需求一致）', () => {
    expect(PICKUP_RANGE).toBe(2.0)
  })
})
