import { describe, it, expect } from 'vitest'
import {
  pickLod,
  shouldCull,
  shouldUpdateAnimation,
  horizontalDistance,
  DEFAULT_LOD_CONFIG,
} from './avatar-lod'

describe('avatar-lod：距离分级', () => {
  it('近距 → LOD0（高模/每帧/阴影开）', () => {
    const d = pickLod(2)
    expect(d.level).toBe('LOD0')
    expect(d.visible).toBe(true)
    expect(d.useHighPoly).toBe(true)
    expect(d.animationEveryNFrames).toBe(1)
    expect(d.castShadow).toBe(true)
  })

  it('中距 → LOD1（简化体/每2帧/阴影开）', () => {
    const d = pickLod(12)
    expect(d.level).toBe('LOD1')
    expect(d.visible).toBe(true)
    expect(d.useHighPoly).toBe(false)
    expect(d.animationEveryNFrames).toBe(2)
    expect(d.castShadow).toBe(true)
  })

  it('远距（未超 max）→ LOD2（最简体/每4帧/阴影关）', () => {
    const d = pickLod(40)
    expect(d.level).toBe('LOD2')
    expect(d.visible).toBe(true)
    expect(d.useHighPoly).toBe(false)
    expect(d.animationEveryNFrames).toBe(4)
    expect(d.castShadow).toBe(false)
  })

  it('极远 → Culled（不渲染）', () => {
    const d = pickLod(100)
    expect(d.level).toBe('Culled')
    expect(d.visible).toBe(false)
    expect(d.castShadow).toBe(false)
  })

  it('边界值正确分区', () => {
    expect(pickLod(DEFAULT_LOD_CONFIG.nearDistance - 0.01).level).toBe('LOD0')
    expect(pickLod(DEFAULT_LOD_CONFIG.nearDistance).level).toBe('LOD1')
    expect(pickLod(DEFAULT_LOD_CONFIG.midDistance - 0.01).level).toBe('LOD1')
    expect(pickLod(DEFAULT_LOD_CONFIG.midDistance).level).toBe('LOD2')
    expect(pickLod(DEFAULT_LOD_CONFIG.maxRenderDistance - 0.01).level).toBe('LOD2')
    expect(pickLod(DEFAULT_LOD_CONFIG.maxRenderDistance).level).toBe('Culled')
  })

  it('负距离按 0 处理（LOD0）', () => {
    expect(pickLod(-5).level).toBe('LOD0')
  })

  it('自定义配置生效', () => {
    const cfg = { nearDistance: 3, midDistance: 10, maxRenderDistance: 20 }
    expect(pickLod(5, cfg).level).toBe('LOD1')
    expect(pickLod(25, cfg).level).toBe('Culled')
  })
})

describe('avatar-lod：裁剪与动画抽帧', () => {
  it('shouldCull 仅在超 maxRenderDistance 时为真', () => {
    expect(shouldCull(79)).toBe(false)
    expect(shouldCull(80)).toBe(true)
    expect(shouldCull(200)).toBe(true)
  })

  it('LOD0 每帧更新', () => {
    const d = pickLod(1)
    for (const f of [0, 1, 2, 7, 99]) expect(shouldUpdateAnimation(d, f)).toBe(true)
  })

  it('LOD1 每 2 帧更新一次', () => {
    const d = pickLod(12)
    expect(shouldUpdateAnimation(d, 0)).toBe(true)
    expect(shouldUpdateAnimation(d, 1)).toBe(false)
    expect(shouldUpdateAnimation(d, 2)).toBe(true)
  })

  it('LOD2 每 4 帧更新一次', () => {
    const d = pickLod(40)
    expect(shouldUpdateAnimation(d, 0)).toBe(true)
    expect(shouldUpdateAnimation(d, 1)).toBe(false)
    expect(shouldUpdateAnimation(d, 3)).toBe(false)
    expect(shouldUpdateAnimation(d, 4)).toBe(true)
  })

  it('Culled 永不更新动画', () => {
    const d = pickLod(100)
    expect(shouldUpdateAnimation(d, 0)).toBe(false)
    expect(shouldUpdateAnimation(d, 4)).toBe(false)
  })
})

describe('avatar-lod：水平距离', () => {
  it('计算 XZ 平面距离', () => {
    expect(horizontalDistance(0, 0, 3, 4)).toBeCloseTo(5)
    expect(horizontalDistance(10, 10, 10, 10)).toBe(0)
  })
})
