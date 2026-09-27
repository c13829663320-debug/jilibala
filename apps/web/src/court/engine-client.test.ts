// engine-client 单元测试：mock global fetch，验证请求构造与响应处理。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createCourtGame, playCourtCard, passCourtTurn, getCourtSnapshot, getCourtDailyChallenge,
} from './engine-client'

function mockFetchOnce(payload: unknown, status = 200) {
  const impl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(payload), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', impl)
  return impl
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_SNAPSHOT = {
  phase: 'playing',
  currentRound: 1,
  maxRounds: 3,
  state: {
    stage: 'player_turn',
    round: 1,
    balance: { plaintiff: 50, defendant: 50 },
    ammo: { plaintiff: 2, defendant: 2 },
    unresolved: ['凌晨扰民'],
    resolved: [],
    facts: [],
    evidencePool: [{ id: 'ev-1', name: '凌晨录音', content: 'x' }],
    playerSide: 'plaintiff',
    opponentSide: 'defendant',
    playerMoves: [],
    lastDelta: 0,
  },
}

describe('court engine-client', () => {
  it('createCourtGame POSTs playerSide and parses {id,snapshot,events}', async () => {
    const fetchImpl = mockFetchOnce({ id: 'court-1', snapshot: SAMPLE_SNAPSHOT, events: [] })
    const res = await createCourtGame('plaintiff')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/court/new')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ playerSide: 'plaintiff' })
    expect(res.id).toBe('court-1')
    expect(res.snapshot.state.balance.plaintiff).toBe(50)
  })

  it('playCourtCard posts kind=play_card with card/targetEvidenceId/freeText', async () => {
    const fetchImpl = mockFetchOnce({ snapshot: SAMPLE_SNAPSHOT, events: [] })
    await playCourtCard('court-1', { card: 'evidence', targetEvidenceId: 'ev-1', freeText: '' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/court/court-1/act')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({ kind: 'play_card', card: 'evidence', targetEvidenceId: 'ev-1', freeText: '' })
  })

  it('playCourtCard URL-encodes session id', async () => {
    const fetchImpl = mockFetchOnce({ snapshot: SAMPLE_SNAPSHOT, events: [] })
    await playCourtCard('a b', { card: 'attack' })
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/engine/court/a%20b/act')
  })

  it('passCourtTurn posts kind=pass', async () => {
    const fetchImpl = mockFetchOnce({ snapshot: SAMPLE_SNAPSHOT, events: [] })
    await passCourtTurn('court-1')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/court/court-1/act')
    expect(JSON.parse(String(init?.body))).toEqual({ kind: 'pass' })
  })

  it('getCourtSnapshot issues GET', async () => {
    const fetchImpl = mockFetchOnce({ snapshot: SAMPLE_SNAPSHOT, events: [] })
    await getCourtSnapshot('court-1')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/court/court-1')
    expect(init?.method).toBe('GET')
  })

  it('getCourtDailyChallenge returns challenge object', async () => {
    const fetchImpl = mockFetchOnce({ id: 'c1', title: '绝地反击', description: 'desc', modifier: 'mod', reward: 10 })
    const d = await getCourtDailyChallenge()
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/engine/court-daily')
    expect(d.title).toBe('绝地反击')
  })

  it('throws with server error message on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'session not found' }), { status: 404 })))
    await expect(getCourtSnapshot('nope')).rejects.toThrow('session not found')
  })
})
