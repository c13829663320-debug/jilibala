// talkshow engine-client 单元测试：mock global fetch。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createTalkshowGame, pickTalkshowTopic, submitJoke, getTalkshowDailyChallenge,
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

beforeEach(() => { vi.unstubAllGlobals() })

const SAMPLE_SNAPSHOT = {
  phase: 'playing',
  currentRound: 1,
  maxRounds: 3,
  state: {
    stage: 'picking_topic',
    topic: null,
    currentJokeIndex: 0,
    totalJokes: 3,
    jokeTimeLimitMs: 60000,
    jokes: [],
    warmupJokes: [],
    callbackOptions: [],
    warnedLastTen: false,
  },
}

describe('talkshow engine-client', () => {
  it('createTalkshowGame POSTs and parses {id,snapshot,events}', async () => {
    const fetchImpl = mockFetchOnce({ id: 'ts-1', snapshot: SAMPLE_SNAPSHOT, events: [] })
    const res = await createTalkshowGame()
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/engine/talkshow/new')
    expect(res.id).toBe('ts-1')
    expect(res.snapshot.state.stage).toBe('picking_topic')
  })

  it('pickTalkshowTopic posts topicId', async () => {
    const fetchImpl = mockFetchOnce({ snapshot: SAMPLE_SNAPSHOT, events: [] })
    await pickTalkshowTopic('ts-1', 'workplace')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/talkshow/ts-1/topic')
    expect(JSON.parse(String(init?.body))).toEqual({ topicId: 'workplace' })
  })

  it('submitJoke posts text and callbackTo only when provided', async () => {
    const joke = {
      text: 'hi', topic: 't', scores: { punchline: 20, pacing: 20, resonance: 20 },
      total: 60, reaction: 'mixed', note: 'n',
    }
    const fetchImpl = mockFetchOnce({ joke, snapshot: SAMPLE_SNAPSHOT, events: [] })
    const res = await submitJoke('ts-1', '我的段子', { callbackTo: 0 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/engine/talkshow/ts-1/joke')
    expect(JSON.parse(String(init?.body))).toEqual({ text: '我的段子', callbackTo: 0 })
    expect(res.joke.total).toBe(60)
  })

  it('submitJoke omits callbackTo when undefined', async () => {
    const joke = {
      text: 'hi', topic: 't', scores: { punchline: 20, pacing: 20, resonance: 20 },
      total: 60, reaction: 'mixed', note: 'n',
    }
    const fetchImpl = mockFetchOnce({ joke, snapshot: SAMPLE_SNAPSHOT, events: [] })
    await submitJoke('ts-1', '段子')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body as string))).toEqual({ text: '段子' })
  })

  it('getTalkshowDailyChallenge returns challenge', async () => {
    const fetchImpl = mockFetchOnce({ id: 't1', title: 'callback之王', description: 'd', modifier: 'm', reward: 10 })
    const d = await getTalkshowDailyChallenge()
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/engine/talkshow-daily')
    expect(d.title).toBe('callback之王')
  })

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'session not found' }), { status: 404 })))
    await expect(pickTalkshowTopic('nope', 'x')).rejects.toThrow('session not found')
  })
})
