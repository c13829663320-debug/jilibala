import { describe, expect, it } from 'vitest'
import type { CourtTurn } from '@balabala/shared'
import {
  buildFixedSeats,
  calculateSupportRate,
  horizontalDistance,
  isNpcKind,
  SEAT_BOUNDS,
  seatModelUrl,
  SPEAKABLE_ROLES,
} from './courtroom-seats'

function fakeTurn(partial: Partial<CourtTurn>): CourtTurn {
  return {
    id: partial.id ?? 't1',
    caseId: 'c1',
    round: 1,
    turn: 1,
    speaker: partial.speaker ?? 'plaintiff',
    speakerId: partial.speakerId ?? 'plaintiff',
    speakerName: partial.speakerName ?? 'x',
    content: partial.content ?? '',
    referenced_evidence: partial.referenced_evidence ?? [],
    response_to_turn_id: null,
    createdAt: new Date().toISOString(),
  }
}

describe('seatModelUrl 席位→GLB 映射', () => {
  it('maps each core role to its model', () => {
    expect(seatModelUrl('judge')).toBe('/models/court/judge.glb')
    expect(seatModelUrl('plaintiff')).toBe('/models/court/plaintiff.glb')
    expect(seatModelUrl('plaintiff-counsel')).toBe('/models/court/plaintiff-counsel.glb')
    expect(seatModelUrl('defendant')).toBe('/models/court/defendant.glb')
    expect(seatModelUrl('defendant-counsel')).toBe('/models/court/defendant-counsel.glb')
    expect(seatModelUrl('witness')).toBe('/models/court/witness.glb')
    expect(seatModelUrl('juror')).toBe('/models/court/juror.glb')
  })
  it('audience indexes to 01..06 padded names', () => {
    expect(seatModelUrl('audience', 0)).toBe('/models/court/audience-01.glb')
    expect(seatModelUrl('audience', 5)).toBe('/models/court/audience-06.glb')
  })
})

describe('buildFixedSeats 固定席位布局', () => {
  const seats = buildFixedSeats()

  it('builds 13 seats: 7 core + 6 audience', () => {
    expect(seats).toHaveLength(13)
    const kinds = seats.map((s) => s.kind)
    for (const k of ['judge', 'plaintiff', 'plaintiff-counsel', 'defendant', 'defendant-counsel', 'witness', 'juror']) {
      expect(kinds).toContain(k)
    }
    expect(kinds.filter((k) => k === 'audience')).toHaveLength(6)
  })

  it('every seat position stays inside the room bounds', () => {
    for (const s of seats) {
      const [x, y, z] = s.position
      expect(x).toBeGreaterThanOrEqual(SEAT_BOUNDS.xMin)
      expect(x).toBeLessThanOrEqual(SEAT_BOUNDS.xMax)
      expect(y).toBeGreaterThanOrEqual(SEAT_BOUNDS.yMin)
      expect(y).toBeLessThanOrEqual(SEAT_BOUNDS.yMax)
      expect(z).toBeGreaterThanOrEqual(SEAT_BOUNDS.zMin)
      expect(z).toBeLessThanOrEqual(SEAT_BOUNDS.zMax)
    }
  })

  it('judge faces the courtroom (+z, facing=0); parties/counsel/juror/audience face the judge (-z, π)', () => {
    const judge = seats.find((s) => s.kind === 'judge')!
    expect(judge.facing).toBe(0)
    for (const s of seats) {
      if (s.kind === 'judge' || s.kind === 'witness') continue
      expect(Math.abs(s.facing - Math.PI)).toBeLessThan(1e-9)
    }
  })

  it('witness sits to the side at [1.0,0.6,-1.9] angled toward the judge (facing=-0.5, not on the central axis)', () => {
    const w = seats.find((s) => s.kind === 'witness')!
    expect(w.position).toEqual([1.0, 0.6, -1.9])
    expect(w.facing).toBeCloseTo(-0.5, 6)
    expect(w.position[0]).not.toBe(0) // 不挡中轴
  })

  it('audience NPCs do not stack on the same step (stepped benches allow <1.0 front/back stagger)', () => {
    const audience = seats.filter((s) => s.kind === 'audience')
    for (let i = 0; i < audience.length; i++) {
      for (let j = i + 1; j < audience.length; j++) {
        const d = horizontalDistance(audience[i].position, audience[j].position)
        expect(d).toBeGreaterThanOrEqual(0.5)
      }
    }
  })

  it('witness / juror / audience are flagged NPC; core speakers are not', () => {
    for (const s of seats) {
      if (['witness', 'juror', 'audience'].includes(s.kind)) expect(s.npc).toBe(true)
      else expect(s.npc).toBe(false)
    }
  })

  it('plaintiff/defendant and counsel share the same row z=-1.3 (counsel just further out in x)', () => {
    const pCounsel = seats.find((s) => s.kind === 'plaintiff-counsel')!
    const dCounsel = seats.find((s) => s.kind === 'defendant-counsel')!
    expect(pCounsel.position[2]).toBeCloseTo(-1.3)
    expect(dCounsel.position[2]).toBeCloseTo(-1.3)
    expect(pCounsel.position[0]).toBeLessThan(0)
    expect(dCounsel.position[0]).toBeGreaterThan(0)
  })

  it('exact sixth-round seat positions (GLB pinhole-projection locked, verbatim)', () => {
    expect(seats.find((s) => s.kind === 'judge')!.position).toEqual([0, 0.98, -3.1])
    expect(seats.find((s) => s.kind === 'plaintiff')!.position).toEqual([-1.5, 0.6, -1.3])
    expect(seats.find((s) => s.kind === 'plaintiff-counsel')!.position).toEqual([-2.2, 0.6, -1.3])
    expect(seats.find((s) => s.kind === 'defendant')!.position).toEqual([1.5, 0.6, -1.3])
    expect(seats.find((s) => s.kind === 'defendant-counsel')!.position).toEqual([2.2, 0.6, -1.3])
    expect(seats.find((s) => s.kind === 'juror')!.position).toEqual([1.5, 0.71, 1.77])
    const aud = seats.filter((s) => s.kind === 'audience')
    expect(aud[0].position).toEqual([-2.6, 0.71, 1.77])
    expect(aud[1].position).toEqual([-1.5, 0.71, 1.77])
    expect(aud[2].position).toEqual([2.6, 0.71, 1.77])
    expect(aud[3].position).toEqual([-2.3, 0.87, 2.54])
    expect(aud[4].position).toEqual([-1.2, 0.87, 2.54])
    expect(aud[5].position).toEqual([1.2, 0.87, 2.54])
  })
})

describe('isNpcKind / SPEAKABLE_ROLES NPC 不进发言轮次', () => {
  it('only judge/plaintiff/defendant/defender may speak', () => {
    expect(SPEAKABLE_ROLES.has('judge')).toBe(true)
    expect(SPEAKABLE_ROLES.has('plaintiff')).toBe(true)
    expect(SPEAKABLE_ROLES.has('defendant')).toBe(true)
    expect(SPEAKABLE_ROLES.has('defender')).toBe(true)
  })
  it('witness/juror/audience are NPC kinds', () => {
    expect(isNpcKind('witness')).toBe(true)
    expect(isNpcKind('juror')).toBe(true)
    expect(isNpcKind('audience')).toBe(true)
    expect(isNpcKind('judge')).toBe(false)
    expect(isNpcKind('defender')).toBe(false)
  })
})

describe('calculateSupportRate 陪审团支持率', () => {
  it('defaults to 50/50 with no turns', () => {
    expect(calculateSupportRate([])).toEqual({ plaintiff: 50, defendant: 50 })
  })
  it('all plaintiff turns => 100/0', () => {
    const r = calculateSupportRate([fakeTurn({ speaker: 'plaintiff' }), fakeTurn({ id: 't2', speaker: 'plaintiff' })])
    expect(r.plaintiff).toBe(100)
    expect(r.defendant).toBe(0)
  })
  it('judge turns do not move the needle', () => {
    const r = calculateSupportRate([
      fakeTurn({ speaker: 'judge' }),
      fakeTurn({ id: 't2', speaker: 'judge' }),
      fakeTurn({ id: 't3', speaker: 'judge' }),
    ])
    expect(r).toEqual({ plaintiff: 50, defendant: 50 })
  })
  it('evidence references weight a turn more', () => {
    // plaintiff plain (1) vs defendant with 1 evidence (1.5)
    const r = calculateSupportRate([
      fakeTurn({ speaker: 'plaintiff' }),
      fakeTurn({ id: 't2', speaker: 'defendant', referenced_evidence: ['e1'] }),
    ])
    // p=1, d=1.5 => pct = 1/2.5 = 40
    expect(r.plaintiff).toBe(40)
    expect(r.defendant).toBe(60)
  })
  it('defender turns are attributed by side map', () => {
    const sides = new Map<string, 'plaintiff' | 'defendant'>([['d-left', 'plaintiff'], ['d-right', 'defendant']])
    const r = calculateSupportRate([
      fakeTurn({ speaker: 'defender', speakerId: 'd-left' }),
      fakeTurn({ id: 't2', speaker: 'defender', speakerId: 'd-left' }),
      fakeTurn({ id: 't3', speaker: 'defender', speakerId: 'd-right' }),
    ], sides)
    // p=2, d=1 => 67/33
    expect(r.plaintiff).toBeGreaterThan(r.defendant)
    expect(r.plaintiff + r.defendant).toBe(100)
  })
  it('unknown defender side splits evenly and result always sums to 100', () => {
    const r = calculateSupportRate([fakeTurn({ speaker: 'defender', speakerId: 'unknown' })])
    expect(r.plaintiff + r.defendant).toBe(100)
    expect(r.plaintiff).toBe(50)
  })
})
