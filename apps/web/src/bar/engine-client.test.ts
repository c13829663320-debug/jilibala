// ===== bar engine-client 单测：mock fetch =====
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { barClient } from './engine-client'

beforeEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(payload: unknown, ok = true) {
  const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    json: () => Promise.resolve(payload),
  } as Response)
  return fetchMock
}

describe('barClient', () => {
  it('newGame POSTs to /api/engine/bar/new', async () => {
    const f = mockFetchOnce({ id: 'bar-1', snapshot: { topic: 't', round: 1 } })
    const res = await barClient.newGame({ topic: 't', playerSide: 'pro' })
    expect(f).toHaveBeenCalledWith('/api/engine/bar/new', expect.objectContaining({ method: 'POST' }))
    expect(res.id).toBe('bar-1')
  })

  it('act sends pick_angle payload', async () => {
    const f = mockFetchOnce({ snapshot: { round: 2, finished: false } })
    await barClient.act('bar-1', { kind: 'pick_angle', angle: 'data', text: '测试' })
    const [, init] = f.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ kind: 'pick_angle', angle: 'data', text: '测试' })
  })

  it('throws on !ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'not found' }),
    } as Response)
    await expect(barClient.get('nope')).rejects.toThrow('not found')
  })
})
