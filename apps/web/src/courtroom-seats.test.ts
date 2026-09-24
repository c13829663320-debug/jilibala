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

  it('builds 8 seats: 6 core speakers + 2 audience', () => {
    expect(seats).toHaveLength(8)
    const kinds = seats.map((s) => s.kind)
    for (const k of ['judge', 'plaintiff', 'plaintiff-counsel', 'defendant', 'defendant-counsel', 'witness']) {
      expect(kinds).toContain(k)
    }
    expect(kinds.filter((k) => k === 'audience')).toHaveLength(2)
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

  it('witness sits off to the right at [2.3,-0.4,-2.4] angled toward the judge (facing≈-1.9, NOT on the central axis)', () => {
    const w = seats.find((s) => s.kind === 'witness')!
    expect(w.position).toEqual([2.3, -0.4, -2.4])
    expect(w.position[0]).toBeGreaterThanOrEqual(1.6) // 不占中轴、不挡看法官视轴
    expect(w.facing).not.toBe(0) // 必须转向法官，不再面向相机
    expect(Math.abs(w.facing - (-1.9))).toBeLessThan(0.1)
  })

  it('audience NPCs flank the rear side aisles (2 NPCs, off the central axis)', () => {
    const audience = seats.filter((s) => s.kind === 'audience')
    expect(audience).toHaveLength(2)
    for (const a of audience) {
      expect(a.position[2]).toBeCloseTo(0.7) // 后排两侧过道
      expect(Math.abs(a.position[0])).toBeGreaterThan(1.6) // 不占中轴
    }
    // 左右对称
    expect(audience[0].position[0]).toBeCloseTo(-audience[1].position[0])
    expect(audience[0].position[2]).toBeCloseTo(audience[1].position[2])
    expect(audience[0].position[1]).toBeCloseTo(audience[1].position[1])
    // 旁听者之间不重叠
    expect(horizontalDistance(audience[0].position, audience[1].position)).toBeGreaterThanOrEqual(0.8)
  })

  it('witness / juror / audience are flagged NPC; core speakers are not', () => {
    for (const s of seats) {
      if (['witness', 'juror', 'audience'].includes(s.kind)) expect(s.npc).toBe(true)
      else expect(s.npc).toBe(false)
    }
  })

  it('plaintiff/defendant sit at x=±1.6 z=-1.7, counsel flanks outside at x=±2.7 z=-1.4', () => {
    const p = seats.find((s) => s.kind === 'plaintiff')!
    const pc = seats.find((s) => s.kind === 'plaintiff-counsel')!
    const d = seats.find((s) => s.kind === 'defendant')!
    const dc = seats.find((s) => s.kind === 'defendant-counsel')!
    expect(p.position).toEqual([-1.6, 0, -1.7])
    expect(pc.position).toEqual([-2.7, 0, -1.4])
    expect(d.position).toEqual([1.6, 0, -1.7])
    expect(dc.position).toEqual([2.7, 0, -1.4])
    expect(p.position[0]).toBeLessThan(0)
    expect(d.position[0]).toBeGreaterThan(0)
  })

  it('every pair of non-NPC seats keeps >=0.95 horizontal spacing (no interpenetration; party↔counsel row = 1.0 by design)', () => {
    const speakers = seats.filter((s) => !s.npc)
    for (let i = 0; i < speakers.length; i++) {
      for (let j = i + 1; j < speakers.length; j++) {
        const d = horizontalDistance(speakers[i].position, speakers[j].position)
        expect(d).toBeGreaterThanOrEqual(0.95)
      }
    }
  })

  it('no character sits on the central red carpet axis blocking the view to the judge (only judge/juror near x=0)', () => {
    const witness = seats.find((s) => s.kind === 'witness')!
    expect(Math.abs(witness.position[0])).toBeGreaterThan(1.6)
    const parties = seats.filter((s) => s.kind === 'plaintiff' || s.kind === 'defendant')
    for (const p of parties) expect(Math.abs(p.position[0])).toBeGreaterThan(1.5)
  })

  it('exact recalibrated seat positions', () => {
    expect(seats.find((s) => s.kind === 'judge')!.position).toEqual([0, 0.25, -3.9])
    expect(seats.find((s) => s.kind === 'plaintiff')!.position).toEqual([-1.6, 0, -1.7])
    expect(seats.find((s) => s.kind === 'plaintiff-counsel')!.position).toEqual([-2.7, 0, -1.4])
    expect(seats.find((s) => s.kind === 'defendant')!.position).toEqual([1.6, 0, -1.7])
    expect(seats.find((s) => s.kind === 'defendant-counsel')!.position).toEqual([2.7, 0, -1.4])
    expect(seats.find((s) => s.kind === 'witness')!.position).toEqual([2.3, -0.4, -2.4])
    const aud = seats.filter((s) => s.kind === 'audience')
    expect(aud).toHaveLength(2)
    expect(aud[0].position).toEqual([-3.0, 0, 0.7])
    expect(aud[1].position).toEqual([3.0, 0, 0.7])
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
