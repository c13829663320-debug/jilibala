import { describe, expect, it } from 'vitest'
import { checkCollision } from './terrain'
import type { SceneStructure } from '@balabala/shared'

describe('checkCollision', () => {
  const structures: SceneStructure[] = [
    {
      id: 's1',
      kind: 'box',
      label: 'House',
      position: [5, 0, 5],
      rotation: [0, 0, 0],
      scale: [2, 2, 2],
      assetUrl: '',
      source: 'parametric',
    },
  ]
  const bounds: [number, number, number, number] = [-30, -30, 30, 30]

  it('returns true when out of bounds', () => {
    expect(checkCollision([31, 0, 0], 0.5, structures, bounds)).toBe(true)
    expect(checkCollision([0, 0, -31], 0.5, structures, bounds)).toBe(true)
  })

  it('returns true when inside structure AABB', () => {
    // halfW = max(2,2)*1.5 = 3; player at (5,0,5) radius 0.5 -> collision
    expect(checkCollision([5, 0, 5], 0.5, structures, bounds)).toBe(true)
  })

  it('returns false when far from structures and inside bounds', () => {
    expect(checkCollision([0, 0, 0], 0.5, structures, bounds)).toBe(false)
    expect(checkCollision([20, 0, -20], 0.5, structures, bounds)).toBe(false)
  })

  it('radius pushes collision threshold', () => {
    // 距离结构中心 4 米：halfW=3, radius=0.5 -> 3.5 阈值，4 > 3.5 不撞
    expect(checkCollision([9, 0, 5], 0.5, structures, bounds)).toBe(false)
    // radius=2 -> 3+2=5 阈值，4 < 5 撞
    expect(checkCollision([9, 0, 5], 2, structures, bounds)).toBe(true)
  })

  it('empty structures list only checks bounds', () => {
    expect(checkCollision([0, 0, 0], 0.5, [], bounds)).toBe(false)
    expect(checkCollision([-40, 0, 0], 0.5, [], bounds)).toBe(true)
  })
})
