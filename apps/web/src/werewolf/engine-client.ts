// 狼人杀新引擎 REST 客户端 —— 与 /api/engine/werewolf/* 路由对齐。
import type { WerewolfDayAction, WerewolfRole, WerewolfWinner } from '@balabala/shared'

export interface WwPublicPlayer {
  seat: number
  nickname: string
  alive: boolean
  isAI: boolean
}

export interface WwSnapshot {
  phase: string
  sub: string
  day: number
  players: WwPublicPlayer[]
  winner: WerewolfWinner
  lastNightDeaths: number[]
  dayActions: Array<{ day: number; seat: number; nickname: string; action: WerewolfDayAction }>
  lastVoteResult: { lynchedSeat: number | null; votes: Record<string, number> } | null
  log: string[]
  mySeat?: number
  myRole?: WerewolfRole
  wolfTeammates?: number[]
  seerResults?: Array<{ seat: number; isWolf: boolean; day: number }>
  witchPotions?: { heal: boolean; poison: boolean }
  spectator?: boolean
  pendingAction: string | null
  result: {
    winner: WerewolfWinner
    scores: Record<string, number>
    tier: { level: string; label: string; score: number; percentile: number } | string
    rankPoints: number
    highlights: string[]
  } | null
  /** R5：结算演出包。 */
  r5?: import('../lib/r5').R5Bundle | null
  shareText?: string
}

export type WwActBody =
  | { kind: 'night_kill'; target: number }
  | { kind: 'night_check'; target: number }
  | { kind: 'night_witch'; heal: boolean; poison: number | null }
  | { kind: 'day_action'; action: WerewolfDayAction }
  | { kind: 'day_vote'; target: number | null }
  | { kind: 'hunter_shot'; target: number | null }
  | { kind: 'pass' }

async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? data.message ?? `请求失败 ${res.status}`)
  return data
}

export const wwClient = {
  async newGame(opts: { forceHumanRole?: WerewolfRole; humanThinkMs?: number } = {}): Promise<{ id: string; snapshot: WwSnapshot }> {
    return jsonFetch('/api/engine/werewolf/new', {
      method: 'POST',
      body: JSON.stringify(opts),
    })
  },

  async act(id: string, body: WwActBody): Promise<{ snapshot: WwSnapshot; ended: boolean }> {
    return jsonFetch(`/api/engine/werewolf/${id}/act`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  async get(id: string): Promise<{ snapshot: WwSnapshot }> {
    return jsonFetch(`/api/engine/werewolf/${id}`)
  },

  async daily(): Promise<{ id: string; title: string; description: string; reward: number }> {
    return jsonFetch('/api/engine/werewolf-daily')
  },
}
