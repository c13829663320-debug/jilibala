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

  it('builds 5 core seats: judge + plaintiff/defendant + both counsel', () => {
    expect(seats).toHaveLength(5)
    const kinds = seats.map((s) => s.kind)
    for (const k of ['judge', 'plaintiff', 'plaintiff-counsel', 'defendant', 'defendant-counsel']) {
      expect(kinds).toContain(k)
    }
    for (const removed of ['witness', 'juror', 'audience']) {
      expect(kinds).not.toContain(removed)
    }
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

  it('judge faces the courtroom (facing=0); parties/counsel face the judge (facing=PI)', () => {
    const judge = seats.find((s) => s.kind === 'judge')!
    expect(judge.facing).toBe(0)
    for (const s of seats) {
      if (s.kind === 'judge') continue
      expect(Math.abs(s.facing - Math.PI)).toBeLessThan(1e-9)
    }
  })

  it('all 5 seats are speakable (npc=false) after the trim', () => {
    for (const s of seats) expect(s.npc).toBe(false)
  })

  it('plaintiff/defendant sit at x=+-1.6 z=-1.7, counsel flanks at x=+-2.7 z=-1.4', () => {
    expect(seats.find((s) => s.kind === 'plaintiff')!.position).toEqual([-1.6, 0, -1.7])
    expect(seats.find((s) => s.kind === 'plaintiff-counsel')!.position).toEqual([-2.7, 0, -1.4])
    expect(seats.find((s) => s.kind === 'defendant')!.position).toEqual([1.6, 0, -1.7])
    expect(seats.find((s) => s.kind === 'defendant-counsel')!.position).toEqual([2.7, 0, -1.4])
  })

  it('every pair of seats keeps >=0.95 horizontal spacing (no interpenetration)', () => {
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        expect(horizontalDistance(seats[i].position, seats[j].position)).toBeGreaterThanOrEqual(0.95)
      }
    }
  })

  it('only the judge is near x=0; parties stay off the central axis', () => {
    const parties = seats.filter((s) => s.kind === 'plaintiff' || s.kind === 'defendant')
    for (const p of parties) expect(Math.abs(p.position[0])).toBeGreaterThan(1.5)
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
