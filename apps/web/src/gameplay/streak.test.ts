import { describe, it, expect } from 'vitest'
import {
  applyResult,
  streakHint,
  streakLine,
  emptyStreak,
  defaultStreaks,
  loadStreaks,
  saveStreaks,
  recordResult,
  STREAK_STORAGE_KEY,
} from './streak'
import type { R5StreakState } from '@balabala/shared'

function memStorage(): Storage {
  let data: Record<string, string> = {}
  return {
    get length() { return Object.keys(data).length },
    clear() { data = {} },
    getItem: (k: string) => (k in data ? data[k] : null),
    key: (i: number) => Object.keys(data)[i] ?? null,
    removeItem: (k: string) => { delete data[k] },
    setItem: (k: string, v: string) => { data[k] = String(v) },
  }
}

describe('applyResult 连胜计算', () => {
  it('首胜 current=1 best=1', () => {
    const { streak } = applyResult(emptyStreak(), true, '2026-09-27T00:00:00Z')
    expect(streak.current).toBe(1)
    expect(streak.best).toBe(1)
    expect(streak.lastPlayedAt).toBe('2026-09-27T00:00:00Z')
  })

  it('连胜累加，best 同步刷新', () => {
    let s = emptyStreak()
    for (let i = 0; i < 3; i++) s = applyResult(s, true).streak
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })

  it('失败 current 归零但保留 best', () => {
    let s = emptyStreak()
    s = applyResult(s, true).streak
    s = applyResult(s, true).streak
    expect(s.current).toBe(2)
    s = applyResult(s, false).streak
    expect(s.current).toBe(0)
    expect(s.best).toBe(2)
  })

  it('失败后再胜从 1 重新计', () => {
    let s = emptyStreak()
    s = applyResult(s, true).streak
    s = applyResult(s, false).streak
    s = applyResult(s, true).streak
    expect(s.current).toBe(1)
    expect(s.best).toBe(1)
  })

  it('不原地修改入参', () => {
    const s: R5StreakState = { current: 2, best: 2, lastPlayedAt: null }
    applyResult(s, false)
    expect(s.current).toBe(2)
  })
})

describe('streakHint 再来一局文案', () => {
  it('连胜中提示冲击 N+1', () => {
    const s: R5StreakState = { current: 3, best: 5, lastPlayedAt: null }
    expect(streakHint(s)).toContain('3 连胜')
    expect(streakHint(s)).toContain('4 连胜')
  })
  it('首局兜底文案', () => {
    expect(streakHint(emptyStreak())).toContain('首局')
  })
  it('断连胜提示重回胜轨', () => {
    const s: R5StreakState = { current: 0, best: 4, lastPlayedAt: null }
    expect(streakHint(s)).toContain('最佳 4')
  })
})

describe('streakLine 战绩卡一行', () => {
  it('无记录', () => expect(streakLine(emptyStreak())).toContain('暂无'))
  it('有连胜', () => {
    expect(streakLine({ current: 2, best: 6, lastPlayedAt: null })).toContain('当前 2')
    expect(streakLine({ current: 2, best: 6, lastPlayedAt: null })).toContain('最佳 6')
  })
})

describe('持久化 load/save/recordResult', () => {
  it('save → load 往返一致', () => {
    const st = memStorage()
    const all = defaultStreaks()
    all.court = { current: 3, best: 7, lastPlayedAt: '2026-09-27T00:00:00Z' }
    saveStreaks(all, st)
    const back = loadStreaks(st)
    expect(back.court.current).toBe(3)
    expect(back.court.best).toBe(7)
    expect(back.werewolf.current).toBe(0)
  })

  it('损坏数据回退默认值', () => {
    const st = memStorage()
    st.setItem(STREAK_STORAGE_KEY, '{{{not json')
    expect(loadStreaks(st).court.current).toBe(0)
  })

  it('recordResult 端到端：胜→写档→再读', () => {
    const st = memStorage()
    recordResult('court', true, st, '2026-09-27T00:00:00Z')
    recordResult('court', true, st, '2026-09-27T00:01:00Z')
    const { outcome } = recordResult('court', false, st, '2026-09-27T00:02:00Z')
    expect(outcome.streak.current).toBe(0)
    expect(outcome.streak.best).toBe(2)
    expect(loadStreaks(st).court.current).toBe(0)
  })

  it('node 环境无 window 时安全降级不抛错', () => {
    expect(() => loadStreaks(undefined)).not.toThrow()
    expect(loadStreaks(undefined).court.current).toBe(0)
  })
})
