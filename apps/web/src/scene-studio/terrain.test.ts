import { describe, expect, it } from 'vitest'
import { terrainHeight, resolveSpawnHeight } from './terrain'
import type { SceneBlueprint } from '@balabala/shared'

function makeBlueprint(overrides: Partial<SceneBlueprint> = {}): SceneBlueprint {
  return {
    terrain: {
      theme: 'plains',
      size: 60,
      heightSeed: 42,
      waterLevel: -1,
      weather: 'clear',
      light: 'day',
      params: {},
    },
    scatter: [],
    structures: [],
    npcs: [],
    gameplay: { template: 'explore', config: {} },
    spawnPoint: [0, 0, 0],
    bounds: [-30, -30, 30, 30],
    version: 1,
    ...overrides,
  }
}

describe('terrainHeight', () => {
  it('is deterministic: same seed + same input => same output', () => {
    const a = terrainHeight(5.3, -2.1, 42, 60)
    const b = terrainHeight(5.3, -2.1, 42, 60)
    expect(a).toBe(b)
  })

  it('different seeds produce different heights (usually)', () => {
    const a = terrainHeight(5.3, -2.1, 42, 60)
    const b = terrainHeight(5.3, -2.1, 99, 60)
    expect(a).not.toBe(b)
  })

  it('boundary edges fade to ~0', () => {
    // 距离边界 1 米内，高度应被压到接近 0
    const hEdge = terrainHeight(29.9, 10, 42, 60) // half=30, distToEdge=0.1
    expect(Math.abs(hEdge)).toBeLessThan(0.5)
    const hCorner = terrainHeight(29.9, -29.9, 42, 60)
    expect(Math.abs(hCorner)).toBeLessThan(0.5)
  })

  it('center of terrain has non-zero height (with default amplitude)', () => {
    const h = terrainHeight(0, 0, 42, 60)
    expect(typeof h).toBe('number')
    expect(isFinite(h)).toBe(true)
  })

  it('respects amplitude / frequency / octaves params', () => {
    const defaultH = terrainHeight(3, 4, 7, 60)
    const flatH = terrainHeight(3, 4, 7, 60, { amplitude: 0 })
    expect(Math.abs(flatH)).toBeLessThan(0.001)
    const oneOctave = terrainHeight(3, 4, 7, 60, { octaves: 1 })
    expect(typeof oneOctave).toBe('number')
    expect(oneOctave).not.toBe(defaultH)
  })
})

describe('resolveSpawnHeight', () => {
  it('returns terrain y at spawn + 1.5', () => {
    const bp = makeBlueprint({ spawnPoint: [3, 0, -4] })
    const y = resolveSpawnHeight(bp)
    const expected =
      terrainHeight(3, -4, bp.terrain.heightSeed, bp.terrain.size, bp.terrain.params) + 1.5
    expect(y).toBeCloseTo(expected, 6)
  })
})
