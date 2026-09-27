import { describe, it, expect } from 'vitest'
import { planCrowdRender, fullModelUserIds, type CrowdPlayer } from './crowdRenderList'

const p = (id: string, x: number, z: number): CrowdPlayer => ({ userId: id, x, z })

describe('planCrowdRender', () => {
  it('nearest maxVisible render as full', () => {
    const players = [p('a', 1, 0), p('b', 2, 0), p('c', 3, 0), p('d', 4, 0)]
    const plan = planCrowdRender(players, { x: 0, z: 0 }, { maxVisible: 2 })
    expect(plan.map((d) => [d.userId, d.tier])).toEqual([
      ['a', 'full'],
      ['b', 'full'],
      ['c', 'billboard'],
      ['d', 'billboard'],
    ])
  })

  it('sorts by distance ascending regardless of input order', () => {
    const players = [p('far', 50, 0), p('near', 1, 0), p('mid', 10, 0)]
    const plan = planCrowdRender(players, { x: 0, z: 0 }, { maxVisible: 16 })
    expect(plan.map((d) => d.userId)).toEqual(['near', 'mid', 'far'])
  })

  it('beyond full+billboard band downgrades to capsule', () => {
    const players = Array.from({ length: 40 }, (_, i) => p(`u${i}`, i + 1, 0))
    const plan = planCrowdRender(players, { x: 0, z: 0 }, { maxVisible: 16, billboardBand: 16 })
    const capsule = plan.filter((d) => d.tier === 'capsule')
    expect(capsule.length).toBe(8)
    expect(plan.filter((d) => d.tier === 'full').length).toBe(16)
    expect(plan.filter((d) => d.tier === 'billboard').length).toBe(16)
  })

  it('allowCapsule=false collapses far to billboard', () => {
    const players = Array.from({ length: 40 }, (_, i) => p(`u${i}`, i + 1, 0))
    const plan = planCrowdRender(players, { x: 0, z: 0 }, { maxVisible: 16, billboardBand: 16, allowCapsule: false })
    expect(plan.every((d) => d.tier !== 'capsule')).toBe(true)
    expect(plan.filter((d) => d.tier === 'billboard').length).toBe(24)
  })

  it('empty input yields empty plan', () => {
    expect(planCrowdRender([], { x: 0, z: 0 })).toEqual([])
  })
})

describe('fullModelUserIds', () => {
  it('returns only the nearest N', () => {
    const players = [p('a', 1, 0), p('b', 2, 0), p('c', 3, 0)]
    expect(fullModelUserIds(players, { x: 0, z: 0 }, 2)).toEqual(['a', 'b'])
  })
})
