import { describe, it, expect } from 'vitest'
import {
  sortAssetsByPriority,
  nextBatch,
  pickIdlePrefetch,
  distance2d,
  isCelebrityAsset,
  type AssetLoadRequest,
} from './assetPriority'

const scene = (url: string, x = 0, z = 0): AssetLoadRequest => ({ url, priority: 'scene', x, z })
const celeb = (url: string, x = 0, z = 0): AssetLoadRequest => ({ url, priority: 'celebrity', x, z })
const decor = (url: string, x = 0, z = 0): AssetLoadRequest => ({ url, priority: 'decoration', x, z })

describe('distance2d', () => {
  it('computes horizontal distance', () => {
    expect(distance2d({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5)
  })
  it('clamps non-finite to 0', () => {
    expect(distance2d({ x: NaN, z: 0 }, { x: 0, z: 0 })).toBe(0)
  })
})

describe('sortAssetsByPriority', () => {
  it('celebrity beats scene beats decoration regardless of input order', () => {
    const ordered = sortAssetsByPriority([
      decor('tree.glb', 0, 0),
      scene('court.glb', 0, 0),
      celeb('luyuxun.glb', 100, 100),
    ])
    expect(ordered.map((a) => a.url)).toEqual(['luyuxun.glb', 'court.glb', 'tree.glb'])
  })

  it('same priority: nearer to camera loads first', () => {
    const ordered = sortAssetsByPriority(
      [scene('far.glb', 50, 50), scene('near.glb', 2, 0), scene('mid.glb', 10, 0)],
      { x: 0, z: 0 },
    )
    expect(ordered.map((a) => a.url)).toEqual(['near.glb', 'mid.glb', 'far.glb'])
  })

  it('preserves original order on ties (stable)', () => {
    const a = scene('a.glb', 5, 5)
    const b = scene('b.glb', 5, 5)
    const c = scene('c.glb', 5, 5)
    const ordered = sortAssetsByPriority([a, b, c], { x: 0, z: 0 })
    expect(ordered.map((x) => x.url)).toEqual(['a.glb', 'b.glb', 'c.glb'])
  })

  it('treats missing camera as origin', () => {
    const near = scene('near.glb', 1, 0)
    const far = scene('far.glb', 20, 0)
    expect(sortAssetsByPriority([far, near])[0].url).toBe('near.glb')
  })
})

describe('nextBatch', () => {
  it('returns at most maxCount, ordered', () => {
    const batch = nextBatch(
      [decor('t1'), scene('s1'), celeb('c1'), scene('s2'), celeb('c2')],
      { x: 0, z: 0 },
      2,
    )
    expect(batch.map((b) => b.url)).toEqual(['c1', 'c2'])
  })
  it('clamps non-positive max to empty', () => {
    expect(nextBatch([scene('s')], { x: 0, z: 0 }, 0)).toHaveLength(0)
  })
})

describe('pickIdlePrefetch', () => {
  it('skips already loaded/loading and returns top priority', () => {
    const loaded = new Set(['c1.glb'])
    const picked = pickIdlePrefetch(
      [celeb('c1.glb'), celeb('c2.glb'), scene('s1.glb'), decor('d1.glb')],
      { x: 0, z: 0 },
      loaded,
      2,
    )
    expect(picked.map((p) => p.url)).toEqual(['c2.glb', 's1.glb'])
  })
})

describe('isCelebrityAsset', () => {
  it('flags celebrity only', () => {
    expect(isCelebrityAsset(celeb('x'))).toBe(true)
    expect(isCelebrityAsset(scene('x'))).toBe(false)
  })
})
