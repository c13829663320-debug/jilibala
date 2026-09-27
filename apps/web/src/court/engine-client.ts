// ============================================================================
// 趣味法庭 · 新引擎 HTTP 客户端（玩法深化专项）
// 直连 /api/engine/court/*（CourtOrchestrator 服务端权威），不再走旧 SSE。
// 每个响应都带回累计 events 数组，客户端按游标切出新增事件（法官口播/命中提示）。
// 纯 fetch 封装，不依赖 React，便于单元测试（mock global fetch）。
// ============================================================================

export type CourtSide = 'plaintiff' | 'defendant'

/** 与 court-state.ts HAND_CARDS 对齐。 */
export type CourtCardKind = 'attack' | 'evidence' | 'mock' | 'request_record'

export interface CourtEvidence {
  id: string
  name: string
  content: string
}

export interface CourtPlayerMove {
  round: number
  card: CourtCardKind
  targetEvidenceId?: string
  freeText?: string
  delta: number
  hit: boolean
  judgeComment?: string
}

/** CourtOrchestrator.state（见 court-engine.ts CourtEngineState）。 */
export interface CourtEngineState {
  stage: 'judge_open' | 'player_turn' | 'opponent_rebuttal' | 'round_recap' | 'verdict'
  round: number
  balance: { plaintiff: number; defendant: number }
  ammo: Record<CourtSide, number>
  unresolved: string[]
  resolved: string[]
  facts: string[]
  evidencePool: CourtEvidence[]
  playerSide: CourtSide
  opponentSide: CourtSide
  playerMoves: CourtPlayerMove[]
  lastDelta: number
}

/** BaseOrchestrator.getSnapshot() 的前端视图。 */
export interface CourtSnapshot {
  phase: 'setup' | 'playing' | 'round' | 'results'
  currentRound: number
  maxRounds: number
  state: CourtEngineState
  tutorialCompleted?: boolean
  tutorialSkipped?: boolean
}

export interface EngineEvent {
  type: string
  timestamp?: number
  payload?: Record<string, unknown>
}

export interface CourtNewResponse {
  id: string
  snapshot: CourtSnapshot
  events: EngineEvent[]
}

export interface CourtActResponse {
  snapshot: CourtSnapshot
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

/** 开一局：POST /api/engine/court/new。 */
export function createCourtGame(playerSide: CourtSide = 'plaintiff'): Promise<CourtNewResponse> {
  return jsonFetch('/api/engine/court/new', {
    method: 'POST',
    body: JSON.stringify({ playerSide }),
  }) as Promise<CourtNewResponse>
}

export interface CourtCardAct {
  card: CourtCardKind
  targetEvidenceId?: string
  freeText?: string
}

/** 出一张牌：POST /api/engine/court/:id/act。 */
export function playCourtCard(id: string, act: CourtCardAct): Promise<CourtActResponse> {
  return jsonFetch(`/api/engine/court/${encodeURIComponent(id)}/act`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'play_card', ...act }),
  }) as Promise<CourtActResponse>
}

/** 放弃本回合：POST /api/engine/court/:id/act { kind: 'pass' }。 */
export function passCourtTurn(id: string): Promise<CourtActResponse> {
  return jsonFetch(`/api/engine/court/${encodeURIComponent(id)}/act`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'pass' }),
  }) as Promise<CourtActResponse>
}

/** 拉取当前会话快照（断线重连用）。 */
export function getCourtSnapshot(id: string): Promise<CourtActResponse> {
  return jsonFetch(`/api/engine/court/${encodeURIComponent(id)}`, { method: 'GET' }) as Promise<CourtActResponse>
}

/** 每日挑战横幅：GET /api/engine/court-daily。 */
export function getCourtDailyChallenge(): Promise<DailyChallengeInfo> {
  return jsonFetch('/api/engine/court-daily', { method: 'GET' }) as Promise<DailyChallengeInfo>
}
