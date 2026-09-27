// ============================================================================
// 脱口秀 · 新引擎 HTTP 客户端（玩法深化专项）
// 直连 /api/engine/talkshow/*（TalkshowOrchestrator 服务端权威）。
// performJoke 是异步 LLM 评分路由，返回 { joke, snapshot, events }。
// ============================================================================

import type {
  JokeDimensionScores, Reaction as OpenMicReaction, TopicOption,
} from '../talkshow/types'

/** 已讲过的一段段子（与 talkshow-orchestrator PerformedJoke 对齐）。 */
export interface PerformedJoke {
  text: string
  topic: string
  callbackTo?: number
  callbackHit?: boolean
  scores: JokeDimensionScores
  total: number
  reaction: OpenMicReaction
  note: string
}

/** TalkshowOrchestrator.state（见 talkshow-engine.ts TalkshowState）。 */
export interface TalkshowEngineState {
  stage: 'warmup' | 'picking_topic' | 'performing' | 'results'
  topic: TopicOption | null
  currentJokeIndex: number
  totalJokes: number
  jokeTimeLimitMs: number
  jokes: PerformedJoke[]
  warmupJokes: string[]
  callbackOptions: Array<{ index: number; preview: string }>
  warnedLastTen: boolean
}

export interface TalkshowSnapshot {
  phase: 'setup' | 'playing' | 'round' | 'results'
  currentRound: number
  maxRounds: number
  state: TalkshowEngineState
  tutorialCompleted?: boolean
  tutorialSkipped?: boolean
}

export interface EngineEvent {
  type: string
  timestamp?: number
  payload?: Record<string, unknown>
}

export interface TalkshowNewResponse {
  id: string
  snapshot: TalkshowSnapshot
  events: EngineEvent[]
}

export interface TalkshowJokeResponse {
  joke: PerformedJoke
  snapshot: TalkshowSnapshot
  events: EngineEvent[]
  /** R5：结算演出包（讲完最后一段后返回）。 */
  r5?: import('../lib/r5').R5Bundle | null
  shareText?: string
}

export type TalkshowSimpleResponse = {
  snapshot: TalkshowSnapshot
  events: EngineEvent[]
}

export interface DailyChallengeInfo {
  id: string
  title: string
  description: string
  modifier: string
  reward: number
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string }
    throw new Error(body.error ?? body.message ?? `请求失败（${res.status}）`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  }).then(parseJson)
}

/** 开一局：POST /api/engine/talkshow/new。 */
export function createTalkshowGame(): Promise<TalkshowNewResponse> {
  return jsonFetch('/api/engine/talkshow/new', {
    method: 'POST',
    body: JSON.stringify({}),
  }) as Promise<TalkshowNewResponse>
}

/** 选话题：POST /api/engine/talkshow/:id/topic。 */
export function pickTalkshowTopic(id: string, topicId: string): Promise<TalkshowSimpleResponse> {
  return jsonFetch(`/api/engine/talkshow/${encodeURIComponent(id)}/topic`, {
    method: 'POST',
    body: JSON.stringify({ topicId }),
  }) as Promise<TalkshowSimpleResponse>
}

/** 讲一段段子（异步三维度评分）：POST /api/engine/talkshow/:id/joke。 */
export function submitJoke(
  id: string,
  text: string,
  opts: { callbackTo?: number } = {},
): Promise<TalkshowJokeResponse> {
  return jsonFetch(`/api/engine/talkshow/${encodeURIComponent(id)}/joke`, {
    method: 'POST',
    body: JSON.stringify({ text, ...(opts.callbackTo !== undefined ? { callbackTo: opts.callbackTo } : {}) }),
  }) as Promise<TalkshowJokeResponse>
}

/** 每日挑战横幅：GET /api/engine/talkshow-daily。 */
export function getTalkshowDailyChallenge(): Promise<DailyChallengeInfo> {
  return jsonFetch('/api/engine/talkshow-daily', { method: 'GET' }) as Promise<DailyChallengeInfo>
}
