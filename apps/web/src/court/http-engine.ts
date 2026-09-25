// HttpCourtEngine:Court Engine 的真实后端实现。
// 直连 /api/court/*:create → analyze → confirm → start(SSE) → player-input → verdict。
// 全程不做任何 mock 兜底:AI 不可用 / SSE 中断一律抛错,由 UI 显式报错并允许重试。
import type {
  CourtCase as BackendCourtCase, CourtFact as BackendFact, CourtKnowledgeBase as BackendKb,
  CourtPartyRole, CourtRecord as BackendRecord, CourtTrialEvent, CourtTurn as BackendTurn,
  CourtVerdict as BackendVerdict, EvidenceType,
} from '@balabala/shared'
import type { CourtEngineClient } from './engine'
import type {
  AnalyzeCaseInput, ContinueSignal, CourtCase, CourtRecordSummary, CourtRole, CourtTurn,
  CourtVerdict, EvidenceItem, KnowledgeBase, Perspective, RealVerdictResult, RoundScript,
} from './types'

/** 实时事件类型：court_turn/player_turn 的 turn 已转为 UI 类型，其余事件保持原样。 */
export type LiveCourtEvent =
  | Exclude<CourtTrialEvent, { type: 'court_turn' } | { type: 'player_turn' }>
  | { type: 'court_turn'; turn: CourtTurn }
  | { type: 'player_turn'; turn: CourtTurn }

const nowISO = () => new Date().toISOString()
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)

const VERDICT_OUTCOME_LABEL: Record<NonNullable<CourtVerdict['outcome']>, string> = {
  plaintiff: '原告方主张成立',
  defendant: '被告方抗辩成立',
  mixed: '双方各有道理,折中处理',
  dismissed: '诉求证据不足,予以驳回',
}

// ---------- 后端 → UI 映射 ----------

function toUiEvidence(list: { name: string; type?: string; content?: string }[]): EvidenceItem[] {
  return list.map((e, i) => ({
    id: `ev-${i}-${e.name}`,
    type: (e.type ?? 'TEXT').toUpperCase() === 'IMAGE' ? 'image' : (e.type ?? 'TEXT').toUpperCase() === 'TEXT' ? 'text' : 'document',
    name: e.name,
    content: e.content,
  }))
}

function partyRoleToUi(role: CourtPartyRole | null, side: 'plaintiff' | 'defendant', accent: string): CourtRole {
  return {
    id: role?.id ?? `role-${side}`,
    roleType: side,
    name: role?.name ?? (side === 'plaintiff' ? '原告' : '被告'),
    title: side === 'plaintiff' ? '原告方' : '被告方',
    position: role?.stance ?? (side === 'plaintiff' ? '主张对方承担责任' : '否认责任,请求减轻'),
    description: role?.persona ?? '由案件生成的 AI 角色',
    accent,
    knowledgeBaseId: `kb-${side}`,
  }
}

function kbToUi(kb: BackendKb | null, side: 'plaintiff' | 'defendant'): KnowledgeBase {
  return {
    id: `kb-${side}`,
    roleType: side,
    position: side === 'plaintiff' ? '原告主张' : '被告抗辩',
    facts: kb?.facts ?? [],
    claims: kb?.claims ?? [],
    arguments: kb?.arguments ?? [],
    assumptions: kb?.assumptions ?? [],
    evidence: kb?.evidence ?? [],
    possibleRebuttals: kb?.opponent_arguments ?? [],
    userAdditions: kb?.user_additions ?? [],
  }
}

export function backendCaseToUi(b: BackendCourtCase): CourtCase {
  const judge: CourtRole = {
    id: 'role-judge', roleType: 'judge', name: 'AI 法官', title: '趣味法庭法官',
    position: '公正主持,让事实自己说话', description: '负责主持庭审、归纳记录并作出趣味裁决',
    accent: '#ec9fca', knowledgeBaseId: 'kb-judge',
  }
  return {
    id: b.id,
    title: b.title || '未命名案件',
    description: b.user_input,
    evidence: toUiEvidence(b.evidence),
    facts: b.facts.map((f: BackendFact) => ({ id: f.id, content: f.content, source: f.source, disputed: f.disputed })),
    disputePoints: b.dispute_points,
    plaintiff: partyRoleToUi(b.plaintiff, 'plaintiff', '#4fb3a5'),
    defendant: partyRoleToUi(b.defendant, 'defendant', '#6ed0d8'),
    judge,
    knowledgeBases: {
      plaintiff: kbToUi(b.plaintiff_kb, 'plaintiff'),
      defendant: kbToUi(b.defendant_kb, 'defendant'),
    },
    status: b.status,
    currentRound: b.current_round,
    createdAt: b.createdAt,
    backendCaseId: b.id,
    complaint: (b as unknown as Record<string, unknown>).plaintiff_complaint as string | undefined,
    answer: (b as unknown as Record<string, unknown>).defendant_answer as string | undefined,
    player_side: (b as unknown as Record<string, unknown>).player_side as 'plaintiff' | 'defendant' | undefined,
    momentum: (b as unknown as Record<string, unknown>).momentum as { plaintiff: number; defendant: number } | undefined,
  }
}

function backendTurnToUi(t: BackendTurn): CourtTurn {
  return {
    id: t.id,
    round: t.round,
    speaker: t.speaker,
    speakerId: t.speakerId,
    speakerName: t.speakerName,
    content: t.content,
    referencedEvidence: t.referenced_evidence,
    responseTo: t.response_to_turn_id,
    isRecord: t.speaker === 'judge',
    createdAt: t.createdAt,
  }
}

export function backendVerdictToUi(v: BackendVerdict): CourtVerdict {
  const outcome = v.verdict
  return {
    caseNo: `(2026) 巴拉民初字 ${v.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || '0000'} 号`,
    title: v.case_summary || '趣味法庭判决',
    charge: VERDICT_OUTCOME_LABEL[outcome] ?? outcome,
    sentence: v.conclusion,
    facts: v.key_facts.join('；') || v.case_summary,
    plaintiffClaim: v.plaintiff_arguments.join('；'),
    defense: v.defendant_arguments.join('；'),
    judgeNote: v.judge_analysis,
    quote: v.reasoning,
    focusPoints: v.key_facts,
    plaintiffArguments: v.plaintiff_arguments.join('；'),
    defendantArguments: v.defendant_arguments.join('；'),
    judgeAnalysis: [v.judge_analysis, v.reasoning].filter(Boolean).join('\n'),
    outcome,
  }
}

function recordToUi(r: BackendRecord | null, round: number): CourtRecordSummary {
  return {
    round,
    plaintiffPoint: r?.arguments?.[0] ?? '',
    defendantPoint: r?.counter_arguments?.[0] ?? '',
    judgeNote: `第 ${round} 庭辩论记录已更新`,
    unresolvedPoints: r?.unresolved ?? [],
  }
}

interface EngineConfig {
  userId: string
  perspective: Perspective
  defenderAssignments?: { plaintiff?: string[]; defendant?: string[] }
}

export class HttpCourtEngine implements CourtEngineClient {
  private cfg: EngineConfig = { userId: '', perspective: 'audience' }
  private caseId = ''
  private backendCase: BackendCourtCase | null = null

  // ---- SSE 缓冲状态 ----
  private streamStarted = false
  private streamDone = false
  private streamError: Error | null = null
  private abort: AbortController | null = null
  /** 流被中止/失败(React StrictMode 双挂载或离开页面)后,允许 startTrial 重启。 */
  private dead = false
  private aborted = false

  private byRound = new Map<number, BackendTurn[]>()
  private completedRounds = new Set<number>()
  private roundWaiters = new Map<number, (t: BackendTurn[]) => void>()
  private errorWaiters: ((e: Error) => void)[] = []

  private lastRecord: BackendRecord | null = null
  private continueInfo: ContinueSignal | null = null
  private continueWaiters: ((c: ContinueSignal) => void)[] = []
  /** 按轮次缓存 should_continue 信号，避免快进播放时串到后续轮次。 */
  private continueByRound = new Map<number, ContinueSignal>()
  private continueWaitersByRound = new Map<number, (c: ContinueSignal) => void>()
  private waitingContinueRound = 1

  private verdict: BackendVerdict | null = null
  private verdictWaiters: ((v: BackendVerdict) => void)[] = []

  // ---- 实时事件订阅（玩家驱动庭审：court_turn / player_turn_request / momentum_update 等）----
  private liveListeners = new Set<(ev: LiveCourtEvent) => void>()
  /** 订阅 SSE 实时事件（不等待轮次缓冲）。返回取消订阅函数。 */
  subscribe(listener: (ev: LiveCourtEvent) => void): () => void {
    this.liveListeners.add(listener)
    return () => { this.liveListeners.delete(listener) }
  }
  private emitLive(ev: CourtTrialEvent): void {
    // court_turn/player_turn 的 turn 先转成 UI 字段再下发（见 LiveCourtEvent）。
    const live: LiveCourtEvent =
      ev.type === 'court_turn' || ev.type === 'player_turn'
        ? { type: ev.type, turn: backendTurnToUi(ev.turn) }
        : (ev as LiveCourtEvent)
    this.liveListeners.forEach((fn) => { try { fn(live) } catch { /* 忽略订阅者异常 */ } })
  }

  /** 最新局势优势条（原告:被告），初始 50:50。 */
  private latestMomentum = { plaintiff: 50, defendant: 50 }
  getMomentum(): { plaintiff: number; defendant: number } { return { ...this.latestMomentum } }

  /**
   * 订阅前已缓冲状态快照：返回【已转 UI】的全部 turns、法官记录、优势条。
   * UI 订阅时调用，补齐在监听空窗（如 StrictMode remount）内已到达、engine
   * 已缓冲但当时无监听者的首批事件，避免法官开场等被永久丢失。
   */
  getBufferedState(): {
    turns: CourtTurn[]
    record: BackendRecord | null
    momentum: { plaintiff: number; defendant: number }
  } {
    const turns = [...this.byRound.keys()]
      .sort((a, b) => a - b)
      .flatMap((r) => this.byRound.get(r) ?? [])
      .map((t) => backendTurnToUi(t))
    return { turns, record: this.lastRecord, momentum: { ...this.latestMomentum } }
  }

  configure(patch: Partial<EngineConfig>): void {
    this.cfg = { ...this.cfg, ...patch }
  }

  getCaseId(): string { return this.caseId }

  async analyzeCase(input: AnalyzeCaseInput): Promise<CourtCase> {
    if (!this.cfg.userId) throw new Error('身份未就绪,请先完成登录')
    const userInput = input.description.trim()
    if (!userInput) throw new Error('案件描述不能为空')

    // 1. 建案(DRAFT)
    const evidence = (input.evidence ?? []).map((e) => ({
      name: e.name,
      type: (e.type === 'image' ? 'IMAGE' : e.type === 'document' ? 'DOCUMENT' : 'TEXT') as EvidenceType,
      content: e.content || e.name,
    }))
    const createdRes = await fetch('/api/court/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.cfg.userId, userInput, evidence }),
    })
    const created = await createdRes.json().catch(() => ({})) as { case?: BackendCourtCase; message?: string }
    if (!createdRes.ok || !created.case) throw new Error(created.message ?? '建案失败')
    this.caseId = created.case.id

    // 2. AI 分析(→GENERATED)
    const anRes = await fetch(`/api/court/cases/${encodeURIComponent(this.caseId)}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.cfg.userId }),
    })
    const an = await anRes.json().catch(() => ({})) as { case?: BackendCourtCase; message?: string }
    if (!anRes.ok || !an.case) throw new Error(an.message ?? 'AI 分析失败,请重试')
    this.backendCase = an.case
    return backendCaseToUi(an.case)
  }

  /** 快速开庭：用预置故事 + 玩家身份，本地分析跳过 38 秒等待。 */
  async quickStart(storyIndex: number, playerSide: 'plaintiff' | 'defendant'): Promise<CourtCase> {
    if (!this.cfg.userId) throw new Error('身份未就绪,请先完成登录')
    const res = await fetch('/api/court/cases/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.cfg.userId, storyIndex, playerSide }),
    })
    const data = await res.json().catch(() => ({})) as { case?: BackendCourtCase; message?: string }
    if (!res.ok || !data.case) throw new Error(data.message ?? '快速开庭失败')
    this.caseId = data.case.id
    this.backendCase = data.case
    return backendCaseToUi(data.case)
  }

  async confirmCase(docs?: { plaintiffComplaint?: string; defendantAnswer?: string; playerSide?: 'plaintiff' | 'defendant' }): Promise<void> {
    if (!this.caseId) throw new Error('案件尚未创建')
    const res = await fetch(`/api/court/cases/${encodeURIComponent(this.caseId)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.cfg.userId, ...(docs ?? {}) }),
    })
    const data = await res.json().catch(() => ({})) as { message?: string }
    if (!res.ok) throw new Error(data.message ?? '确认开庭失败')
  }

  async startTrial(): Promise<void> {
    // 已启动且流仍健康 → 幂等直接返回。若之前被中止(StrictMode 双挂载/断流)且未产出任何轮次,重置后重启。
    if (this.streamStarted && !this.dead) return
    if (!this.caseId) throw new Error('案件尚未确认')
    if (this.dead) this.resetStreamState()
    this.streamStarted = true
    this.dead = false
    this.aborted = false
    this.abort = new AbortController()
    const res = await fetch(`/api/court/cases/${encodeURIComponent(this.caseId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: this.cfg.userId,
        perspective: this.cfg.perspective,
        defenderAssignments: this.cfg.defenderAssignments ?? { plaintiff: [], defendant: [] },
      }),
      signal: this.abort.signal,
    })
    if (!res.ok || !res.body) {
      const e = await res.json().catch(() => ({})) as { message?: string }
      this.dead = true
      throw new Error(e.message ?? '庭审启动失败')
    }
    // 后台读取 SSE 流(不 await 完整流,边收边缓冲)
    void this.readStream(res)
  }

  /** 出错后强制重启 SSE（中止旧流 → 重置缓冲 → 重新 start）；实时订阅者保留。 */
  async restartTrial(): Promise<void> {
    try { this.abort?.abort() } catch { /* noop */ }
    this.resetStreamState()
    this.streamStarted = false
    this.dead = true
    this.aborted = false
    this.streamError = null
    await this.startTrial()
  }

  private resetStreamState(): void {
    this.byRound = new Map()
    this.completedRounds = new Set()
    this.roundWaiters = new Map()
    this.errorWaiters = []
    this.lastRecord = null
    this.continueInfo = null
    this.continueWaiters = []
    this.continueByRound = new Map()
    this.continueWaitersByRound = new Map()
    this.verdict = null
    this.verdictWaiters = []
    this.streamDone = false
    this.streamError = null
  }

  private async readStream(res: Response): Promise<void> {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (!raw) continue
          try { this.dispatch(JSON.parse(raw) as CourtTrialEvent) } catch { /* 忽略坏行 */ }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // 主动中止(StrictMode 卸载/离开页面):不视为用户错误,标记 dead 以便重启。
        this.aborted = true
        this.dead = true
      } else {
        this.failStream(e instanceof Error ? e : new Error('庭审流中断'))
      }
    } finally {
      this.streamDone = true
      // 仅在流正常结束且确实没收到判决时,才兜底 hang 住的 waiter;被中止时不动 waiter(留给重启)。
      if (!this.verdict && !this.aborted) {
        this.verdictWaiters.forEach((w) => w(null as unknown as BackendVerdict))
        this.verdictWaiters = []
      }
    }
  }

  private failStream(err: Error): void {
    if (this.streamError) return
    this.streamError = err
    // 通过实时通道下发合成 error 事件，让 UI 统一感知网络/解码错误。
    this.emitLive({ type: 'error', message: err.message } as CourtTrialEvent)
    this.errorWaiters.forEach((w) => w(err))
    this.errorWaiters = []
    this.continueWaiters.forEach((w) => w({ shouldContinue: false, unresolvedPoints: [], reason: err.message }))
    this.continueWaiters = []
  }

  private dispatch(ev: CourtTrialEvent): void {
    // 所有事件先转发给实时订阅者（玩家驱动庭审 UI 靠 player_turn_request / momentum_update 驱动）。
    this.emitLive(ev)
    switch (ev.type) {
      case 'court_turn': {
        const arr = this.byRound.get(ev.turn.round) ?? []
        arr.push(ev.turn)
        this.byRound.set(ev.turn.round, arr)
        break
      }
      case 'court_record':
        this.lastRecord = ev.record
        break
      case 'should_continue': {
        const round = this.latestRound()
        this.completedRounds.add(round)
        const waiter = this.roundWaiters.get(round)
        if (waiter) { waiter(this.byRound.get(round) ?? []); this.roundWaiters.delete(round) }
        const info: ContinueSignal = { shouldContinue: ev.shouldContinue, unresolvedPoints: ev.unresolvedPoints, reason: ev.reason }
        this.continueInfo = info
        this.continueByRound.set(round, info)
        const cw = this.continueWaitersByRound.get(round)
        if (cw) { cw(info); this.continueWaitersByRound.delete(round) }
        const cbs = this.continueWaiters; this.continueWaiters = []
        cbs.forEach((w) => w(info))
        break
      }
      case 'court_verdict':
        this.verdict = ev.verdict
        this.backendCase = this.backendCase ? { ...this.backendCase, final_verdict: ev.verdict, status: 'COMPLETED' } : this.backendCase
        {
          const cbs = this.verdictWaiters; this.verdictWaiters = []
          cbs.forEach((w) => w(ev.verdict))
        }
        break
      case 'momentum_update':
        this.latestMomentum = { ...ev.momentum }
        break
      case 'player_turn_request':
      case 'player_turn':
      case 'player_input_ack':
        // 实时事件：已通过 emitLive 转发给 UI，无需缓冲。
        break
      case 'error':
        this.failStream(new Error(ev.message))
        break
      case 'court_status':
      default:
        break
    }
  }

  private latestRound(): number {
    let max = 0
    for (const r of this.byRound.keys()) max = Math.max(max, r)
    return max || 1
  }

  private async waitForRound(round: number): Promise<BackendTurn[]> {
    if (this.completedRounds.has(round)) return this.byRound.get(round) ?? []
    if (this.streamError) throw this.streamError
    if (this.streamDone) throw new Error(`第 ${round} 轮未到达,庭审已结束`)
    return new Promise<BackendTurn[]>((resolve, reject) => {
      this.roundWaiters.set(round, resolve)
      this.errorWaiters.push((e) => { this.roundWaiters.delete(round); reject(e) })
    })
  }

  async buildRound(
    _courtCase: CourtCase,
    round: number,
    _playerInputs: unknown[],
    _previousRecord?: CourtRecordSummary,
  ): Promise<RoundScript> {
    await this.startTrial()
    this.waitingContinueRound = round
    const turns = await this.waitForRound(round)
    return {
      turns: turns.map(backendTurnToUi),
      record: recordToUi(this.lastRecord, round),
    }
  }

  async waitForContinue(): Promise<ContinueSignal> {
    const round = this.waitingContinueRound
    const cached = this.continueByRound.get(round)
    if (cached) return cached
    if (this.continueInfo) return this.continueInfo
    if (this.streamError) return { shouldContinue: false, unresolvedPoints: [], reason: this.streamError.message }
    if (this.streamDone) return this.continueByRound.get(round) ?? { shouldContinue: false, unresolvedPoints: [], reason: '庭审结束' }
    return new Promise<ContinueSignal>((resolve) => { this.continueWaitersByRound.set(round, resolve) })
  }

  async buildFinalStatements(): Promise<{ turns: CourtTurn[] }> {
    // 后端无独立最后陈述流:等待判决流收尾(court_verdict)。
    await this.waitForVerdict().catch(() => null)
    return { turns: [] }
  }

  private async waitForVerdict(): Promise<BackendVerdict> {
    if (this.verdict) return this.verdict
    if (this.streamError) throw this.streamError
    if (this.streamDone) throw new Error('庭审流结束,未收到判决')
    return new Promise<BackendVerdict>((resolve, reject) => {
      this.verdictWaiters.push(resolve)
      this.errorWaiters.push(reject)
    })
  }

  async requestRealVerdict(): Promise<RealVerdictResult | null> {
    try {
      const v = await this.waitForVerdict()
      if (!v) throw new Error('未收到判决')
      return { backendCaseId: this.caseId, verdict: backendVerdictToUi(v) }
    } catch (e) {
      // 兜底再拉一次 GET /verdict(流异常时仍可能已落库)
      try {
        const res = await fetch(`/api/court/cases/${encodeURIComponent(this.caseId)}/verdict`)
        const data = await res.json() as { verdict: BackendVerdict | null }
        if (data.verdict) return { backendCaseId: this.caseId, verdict: backendVerdictToUi(data.verdict) }
      } catch { /* ignore */ }
      throw e instanceof Error ? e : new Error('真实 AI 判决不可用,请重试')
    }
  }

  async submitPlayerInput(input: { playerRole: 'plaintiff' | 'defendant'; type: 'argument' | 'evidence' | 'question'; content: string; evidenceName?: string }): Promise<void> {
    if (!this.caseId) return
    await fetch(`/api/court/cases/${encodeURIComponent(this.caseId)}/player-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.cfg.userId, ...input }),
    }).catch(() => { /* fire-and-forget */ })
  }

  dispose(): void {
    this.aborted = true
    this.dead = true
    this.abort?.abort()
  }
}
