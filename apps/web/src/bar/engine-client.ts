// 酒吧新引擎 REST 客户端 —— 与 /api/engine/bar/* 路由对齐。
// 纯 fetch 封装，便于单测 mock。
import type { ArgumentAngle, StanceTendency, AngleEffectiveness, ArgumentScore } from './types'

export interface BarTurn {
  round: number
  side: 'player' | 'pro' | 'con'
  speaker: string
  text: string
  angle?: ArgumentAngle
  effectiveness?: AngleEffectiveness
  delta?: number
  score?: ArgumentScore
}

export interface BarSnapshot {
  phase: string
  topic: string
  playerSide: 'pro' | 'con'
  aiSide: 'pro' | 'con'
  round: number
  totalRounds: number
  balance: { player: number; ai: number }
  strength: { pro: number; con: number }
  playerAngle: ArgumentAngle | null
  aiTendency: StanceTendency
  angleEffectiveness: AngleEffectiveness | null
  transcript: BarTurn[]
  scores: { player: number }
  finished: boolean
  result: {
    winner: string
    scores: Record<string, number>
    tier: { level: string; label: string; score: number; percentile: number } | string
    rankPoints: number
    highlights: string[]
  } | null
  humanWon: boolean
}

export interface BarDaily {
  id: string
  title: string
  description: string
  reward: number
}

async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? data.message ?? `请求失败 ${res.status}`)
  return data
}

export const barClient = {
  async newGame(opts: { topic?: string; playerSide: 'pro' | 'con' }): Promise<{ id: string; snapshot: BarSnapshot }> {
    return jsonFetch('/api/engine/bar/new', {
      method: 'POST',
      body: JSON.stringify(opts),
    })
  },

  async act(id: string, action: { kind: 'pick_angle'; angle: ArgumentAngle; text: string } | { kind: 'pass' }): Promise<{ snapshot: BarSnapshot }> {
    return jsonFetch(`/api/engine/bar/${id}/act`, {
      method: 'POST',
      body: JSON.stringify(action),
    })
  },

  async get(id: string): Promise<{ snapshot: BarSnapshot }> {
    return jsonFetch(`/api/engine/bar/${id}`)
  },

  async daily(): Promise<BarDaily> {
    return jsonFetch('/api/engine/bar-daily')
  },
}
