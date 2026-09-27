// ============================================================================
// 健身房 · 90 秒三关电路引擎（GymOrchestrator）
// 继承共享编排基类 BaseOrchestrator：纯 TS，不依赖 React / DOM / 服务端。
// 三关是前端权威 mini-game：组件负责计时与渲染，本类负责全部规则与状态机。
// 计分全部复用 packages/shared/src/gym-circuit.ts 的纯函数，不重写规则。
// ============================================================================

import {
  BaseOrchestrator,
  computeRankPoints,
  getDailyChallenge,
  CIRCUIT_STATIONS,
  CIRCUIT_TIER_META,
  scoreReactionHit,
  judgeRhythm,
  rhythmPoints,
  powerValue,
  scorePower,
  circuitTotalScore,
  getCircuitTier,
  detectHighlight,
  computeAffinityDelta,
  typeFromAffinity,
  buildResultCard,
  resultCardToText,
  updateStreak,
  detectComeback,
  type DailyChallenge,
  type GameResult,
  type MiniGameKind,
  type StationResult,
  type CircuitTier,
  type Tier,
  type TierLevel,
  type TutorialStep,
  type Highlight,
  type SettlementType,
  type RelationshipChange,
  type MatchStats,
  type ResultCardData,
} from '@balabala/shared'

// ===== 状态 =====

export type GymStage = 'intro' | 'reaction' | 'rhythm' | 'power' | 'results'

export interface StationScoreboard {
  hits: number
  misses: number
}

export interface GymCircuitState {
  stage: GymStage
  /** 当前关下标：0=反应 1=节奏 2=力量。 */
  currentStationIndex: number
  /** 剩余生命（三关共用 3 滴）。 */
  lives: number
  stationResults: StationResult[]
  reaction: StationScoreboard & { bestMs?: number; stationScore: number }
  rhythm: {
    perfects: number
    goods: number
    misses: number
    combo: number
    maxCombo: number
    stationScore: number
  }
  power: { attempts: number; powers: number[]; bestPower: number; stationScore: number }
}

// ===== 动作（BaseOrchestrator.act 通道）=====

export type GymAction =
  | { type: 'reaction_hit'; reactionMs: number }
  | { type: 'reaction_miss' }
  | { type: 'rhythm_tap'; offsetMs: number }
  | { type: 'power_release'; releasePct: number }
  /** 当前关时间到 / 次数用完 / 生命耗尽：落盘 StationResult 并流转。 */
  | { type: 'station_done' }

export interface GymCircuitConfig {
  celebrityId: string
  /** R5: 教练名人名字（战果卡展示用）。 */
  coachName?: string
  /** R5: 结算前对教练名人的好感度（宿敌双倍判定用），默认 0。 */
  coachAffinity?: number
  /** R5: 结算前的 gym 战绩快照（连胜计算用），默认空。 */
  currentStats?: MatchStats
}

/** R5: startCircuit 可注入的钩子输入。 */
export interface GymHooksInput {
  coachName?: string
  coachAffinity?: number
  currentStats?: MatchStats
}

export const GYM_MAX_LIVES = 3

/**
 * R5 · 一局满分（与 settle() 的 percentile 分母一致）。
 * 翻盘检测 / 关系好感度分率都用它归一化。
 */
export const GYM_MAX_SCORE = 4500

/**
 * 健身房是「合作训练」场景：完成挑战 = 对教练的一场胜利。
 * 共享 computeAffinityDelta 胜局基础分 +5，这里再补 +3 的合作加成，
 * 使教练基础好感 = +8（任务约定：合作关系胜=+8，高光每个 +3）。
 */
const GYM_COACH_COOP_BONUS = 3

/** R5 · 钩子四件套在结算时聚合出的额外数据。 */
export interface GymHooksData {
  /** 结构化高光（三关各高光，供回放）。 */
  capturedHighlights: Highlight[]
  /** 对教练名人的好感度变化。 */
  relationshipChanges: RelationshipChange[]
  /** 本局后的连胜快照。 */
  streak: { current: number; best: number }
  /** 战果卡数据。 */
  resultCard: ResultCardData
  /** 可复制分享文案。 */
  resultCardText: string
  /** 是否翻盘局（前两关低、力量关爆发）。 */
  comeback: boolean
  /** 结算演出三态。 */
  settlementType: SettlementType
}

export type GymGameResult = GameResult & GymHooksData

/** 段位 → 统一四档 TierLevel 映射。 */
const TIER_LEVEL_MAP: Record<CircuitTier, TierLevel> = {
  bronze: 'novice',
  silver: 'adept',
  gold: 'expert',
  explosive: 'master',
}

/** 段位映射统一 RankPoints 的假想对手分。 */
const REFERENCE_RANK = 1500

/** 新手引导四步（可跳过，不阻断复玩）。 */
export const GYM_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'gym-intro',
    title: '今日电路',
    description: '三关连闯：反应关 30s → 节奏关 45s → 力量关 20s。总分 ≥4000 爆杆，3 滴血贯穿全程。',
    target: '.cc-station-cards',
  },
  {
    id: 'gym-reaction',
    title: '反应关演示',
    description: '绿圈出现后 1.5 秒内点中，越快分越高；漏点或点空扣 1 滴血。',
    target: '.react-arena',
  },
  {
    id: 'gym-rhythm',
    title: '节奏关判定',
    description: '音符滚到中线时按空格或点击。Perfect ±50ms，连续 Perfect 有连击加成，Good/Miss 断连击。',
    target: '.rhythm-track',
  },
  {
    id: 'gym-power',
    title: '力量关蓄力',
    description: '按住蓄力，条进入绿色区 80-90% 时松开，越靠近 85 越高，3 次取最好。',
    target: '.power-bar',
  },
]

function initialState(): GymCircuitState {
  return {
    stage: 'intro',
    currentStationIndex: 0,
    lives: GYM_MAX_LIVES,
    stationResults: [],
    reaction: { hits: 0, misses: 0, bestMs: undefined, stationScore: 0 },
    rhythm: { perfects: 0, goods: 0, misses: 0, combo: 0, maxCombo: 0, stationScore: 0 },
    power: { attempts: 0, powers: [], bestPower: 0, stationScore: 0 },
  }
}

export class GymOrchestrator extends BaseOrchestrator<GymCircuitState, GymAction, GymCircuitConfig> {
  readonly dailyChallenge: DailyChallenge
  /** R5: 每关完成后的累计总分快照（翻盘检测用，含起点 0）。 */
  private scoreHistory: number[] = [0]
  /** R5: 最近一次 settle() 产出（含钩子数据），供前端结算页读取。 */
  lastResult?: GymGameResult

  constructor(options: { tutorialEnabled?: boolean; date?: Date } = {}) {
    // 引导只在首局触发；localStorage 标记后不再出现（可跳过）。
    const tutorialDone =
      typeof window !== 'undefined' &&
      window.localStorage.getItem('gym-tutorial-done') === '1'
    super({
      maxRounds: CIRCUIT_STATIONS.length,
      initialState: initialState(),
      tutorialSteps: options.tutorialEnabled === false || tutorialDone ? [] : GYM_TUTORIAL_STEPS,
    })
    this.dailyChallenge = getDailyChallenge('gym', options.date ?? new Date())
  }

  /** 引导结束（完成或跳过）后持久化，复玩不再触发。 */
  markTutorialDone(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('gym-tutorial-done', '1')
    }
  }

  // ---- 开局 ----------------------------------------------------------------

  /** 真人=挑战者 slot-0，AI=名人教练 slot-1（旁观者 + 点评）。 */
  setupChallenger(celebrityId: string, userId: string, nickname: string): void {
    this.setupSlots(['challenger', 'coach'], 1, [celebrityId])
    this.assignHuman(userId, nickname, 'slot-0')
  }

  startCircuit(opts: GymHooksInput = {}): void {
    const celebrityId = this.slots.find((s) => s.slotId === 'slot-1')?.aiPersona ?? 'coach'
    this.scoreHistory = [0]
    this.start({ celebrityId, coachName: opts.coachName, coachAffinity: opts.coachAffinity, currentStats: opts.currentStats })
    this.state.stage = 'reaction'
    this.nextRound()
    this.emit({ type: 'station_started', timestamp: Date.now(), payload: { kind: 'reaction', index: 0 } })
  }

  // ---- 关 1：反应关 ---------------------------------------------------------

  /** 命中绿圈，返回本击得分。 */
  reactionHit(reactionMs: number): number {
    const pts = scoreReactionHit(reactionMs)
    const r = this.state.reaction
    r.stationScore += pts
    r.hits += 1
    if (r.bestMs === undefined || reactionMs < r.bestMs) r.bestMs = reactionMs
    this.addScore('slot-0', pts, 'reaction_hit')
    this.emitFeedback('reaction_hit', { reactionMs, points: pts })
    return pts
  }

  /** 漏点 / 点空扣血；返回 true 表示本关因生命耗尽应立即结束。 */
  reactionMiss(): boolean {
    this.state.reaction.misses += 1
    this.state.lives -= 1
    this.emit({
      type: 'reaction_missed',
      timestamp: Date.now(),
      payload: { lives: this.state.lives },
    })
    return this.state.lives <= 0
  }

  // ---- 关 2：节奏关 ---------------------------------------------------------

  /** 一次按键判定，返回档位 / 得分 / 当前连击。 */
  rhythmTap(offsetMs: number): { grade: ReturnType<typeof judgeRhythm>; points: number; combo: number } {
    const grade = judgeRhythm(offsetMs)
    const comboBefore = this.state.rhythm.combo
    const points = rhythmPoints(grade, comboBefore)
    const r = this.state.rhythm
    r.stationScore += points
    if (grade === 'perfect') {
      r.perfects += 1
      r.combo += 1
      r.maxCombo = Math.max(r.maxCombo, r.combo)
    } else {
      if (grade === 'good') r.goods += 1
      else r.misses += 1
      r.combo = 0
    }
    if (points > 0) this.addScore('slot-0', points, `rhythm_${grade}`)
    if (r.combo >= 3) this.emitFeedback('combo', { combo: r.combo })
    return { grade, points, combo: r.combo }
  }

  // ---- 关 3：力量关 ---------------------------------------------------------

  /** 一次蓄力释放，返回力量值（0-100）。 */
  powerRelease(releasePct: number): { power: number; isBest: boolean } {
    const power = powerValue(releasePct)
    const p = this.state.power
    p.attempts += 1
    p.powers.push(power)
    const isBest = power > p.bestPower
    if (isBest) p.bestPower = power
    this.emit({
      type: 'power_released',
      timestamp: Date.now(),
      payload: { power, attempts: p.attempts, bestPower: p.bestPower },
    })
    return { power, isBest }
  }

  /** 力量关 3 次尝试用完后落盘本关得分（bestPower × 10）。 */
  finalizePowerStation(): void {
    this.state.power.stationScore = scorePower(this.state.power.bestPower)
  }

  // ---- 关间流转 -------------------------------------------------------------

  /**
   * 落盘当前关结果并推进：最后一关则 finish() 进入 results。
   * 返回刚落盘的 StationResult（供 UI 立即展示）。
   */
  completeStation(): StationResult {
    const idx = this.state.currentStationIndex
    const kind: MiniGameKind = CIRCUIT_STATIONS[idx].kind
    // 力量关落盘时把 bestPower×10 定为本关分
    if (kind === 'power' && this.state.power.stationScore === 0) {
      this.state.power.stationScore = scorePower(this.state.power.bestPower)
    }

    let result: StationResult
    if (kind === 'reaction') {
      result = {
        kind,
        hits: this.state.reaction.hits,
        misses: this.state.reaction.misses,
        bestMs: this.state.reaction.bestMs,
        score: this.state.reaction.stationScore,
      }
    } else if (kind === 'rhythm') {
      result = {
        kind,
        hits: this.state.rhythm.perfects + this.state.rhythm.goods,
        misses: this.state.rhythm.misses,
        maxCombo: this.state.rhythm.maxCombo,
        score: this.state.rhythm.stationScore,
      }
    } else {
      result = {
        kind,
        hits: this.state.power.attempts,
        misses: 0,
        bestPower: this.state.power.bestPower,
        score: this.state.power.stationScore,
      }
    }
    this.state.stationResults.push(result)
    this.emit({ type: 'station_completed', timestamp: Date.now(), payload: { result } })

    // R5: 关落盘后捕获高光（三关各自的高光规则）。
    this.captureStationHighlights(kind, result)
    // R5: 力量关分数此前未走 addScore，这里补到 slot-0（结算演出/翻盘用）。
    if (kind === 'power') {
      this.addScore('slot-0', result.score, 'power_station')
    }
    // R5: 记录累计总分快照（翻盘检测：前两关低、力量关爆发）。
    this.scoreHistory.push(circuitTotalScore(this.state.stationResults))

    if (idx >= CIRCUIT_STATIONS.length - 1) {
      this.state.stage = 'results'
      this.finish()
      return result
    }

    const next = idx + 1
    this.state.currentStationIndex = next
    this.state.stage = CIRCUIT_STATIONS[next].kind as GymStage
    this.nextRound()
    this.emit({
      type: 'station_started',
      timestamp: Date.now(),
      payload: { kind: CIRCUIT_STATIONS[next].kind, index: next },
    })
    return result
  }

  /**
   * R5: 单关高光捕获。
   *  - reaction：命中率 ≥90% → extreme_performance；0ms 完美命中 → perfect_round。
   *  - rhythm：maxCombo ≥10 → high_combo；全连击（无 Good/Miss）→ perfect_round。
   *  - power：最佳成绩 ≥90%（bestPower≥90）→ extreme_performance。
   * 共享 detectHighlight 只覆盖 gym:station_completed 的 perfectRate≥0.9，
   * 其余规则这里手工构造 Highlight 后走 captureHighlight 收集。
   */
  private captureStationHighlights(kind: MiniGameKind, result: StationResult): void {
    const now = Date.now()
    if (kind === 'reaction') {
      const total = this.state.reaction.hits + this.state.reaction.misses
      const hitRate = total > 0 ? this.state.reaction.hits / total : 0
      // 命中率≥90%：走共享 detectHighlight → extreme_performance
      const hl = detectHighlight('gym', {
        type: 'station_completed',
        payload: { perfectRate: hitRate, round: 0, timestamp: now },
      })
      if (hl) this.captureHighlight(hl)
      // 0ms 完美命中 → perfect_round
      if (this.state.reaction.bestMs !== undefined && this.state.reaction.bestMs <= 0) {
        this.captureHighlight({
          id: this.nextHighlightId(),
          scene: 'gym',
          type: 'perfect_round',
          timestamp: now,
          round: 0,
          description: '反应关 0ms 完美命中！',
          data: { kind: 'reaction', bestMs: this.state.reaction.bestMs },
        })
      }
    } else if (kind === 'rhythm') {
      const totalTaps = this.state.rhythm.perfects + this.state.rhythm.goods + this.state.rhythm.misses
      if (this.state.rhythm.maxCombo >= 10) {
        this.captureHighlight({
          id: this.nextHighlightId(),
          scene: 'gym',
          type: 'high_combo',
          timestamp: now,
          round: 1,
          description: `节奏最高连击 ×${this.state.rhythm.maxCombo}`,
          data: { kind: 'rhythm', maxCombo: this.state.rhythm.maxCombo },
        })
      }
      if (totalTaps > 0 && this.state.rhythm.goods === 0 && this.state.rhythm.misses === 0) {
        this.captureHighlight({
          id: this.nextHighlightId(),
          scene: 'gym',
          type: 'perfect_round',
          timestamp: now,
          round: 1,
          description: `节奏全连击 Perfect！${this.state.rhythm.perfects} 拍全 Perfect`,
          data: { kind: 'rhythm', perfects: this.state.rhythm.perfects },
        })
      }
    } else {
      // power：最佳成绩 ≥90% → extreme_performance（perfectRate = bestPower/100）
      const perfectRate = (this.state.power.bestPower ?? 0) / 100
      const hl = detectHighlight('gym', {
        type: 'station_completed',
        payload: { perfectRate, round: 2, timestamp: now },
      })
      if (hl) this.captureHighlight(hl)
    }
  }

  /** 当前实时总分（已完成关 + 进行中关）。 */
  currentTotal(): number {
    const done = circuitTotalScore(this.state.stationResults)
    const kind = CIRCUIT_STATIONS[this.state.currentStationIndex].kind
    const inFlight =
      kind === 'reaction'
        ? this.state.reaction.stationScore
        : kind === 'rhythm'
          ? this.state.rhythm.stationScore
          : this.state.power.stationScore
    return done + inFlight
  }

  // ---- BaseOrchestrator 抽象实现 -------------------------------------------

  protected applyAction(action: GymAction): void {
    switch (action.type) {
      case 'reaction_hit':
        this.reactionHit(action.reactionMs)
        break
      case 'reaction_miss':
        this.reactionMiss()
        break
      case 'rhythm_tap':
        this.rhythmTap(action.offsetMs)
        break
      case 'power_release':
        this.powerRelease(action.releasePct)
        break
      case 'station_done':
        this.completeStation()
        break
    }
  }

  settle(): GameResult {
    const total = circuitTotalScore(this.state.stationResults)
    const tier = getCircuitTier(total)
    const meta = CIRCUIT_TIER_META[tier]
    const tierObj: Tier = {
      level: TIER_LEVEL_MAP[tier],
      label: `${meta.emoji} ${meta.label}`,
      score: total,
      percentile: Math.min(99, Math.round((total / GYM_MAX_SCORE) * 100)),
    }
    const outcome: 'win' | 'loss' = total >= 3000 ? 'win' : 'loss'
    const rankPoints = computeRankPoints(
      tier === 'gold' || tier === 'explosive' ? 'win' : tier === 'silver' ? 'draw' : 'loss',
      REFERENCE_RANK,
    )
    const highlights: string[] = []
    if (this.state.reaction.bestMs !== undefined) {
      highlights.push(`最快反应 ${Math.round(this.state.reaction.bestMs)}ms`)
    }
    if (this.state.rhythm.maxCombo >= 2) {
      highlights.push(`节奏最高连击 ×${this.state.rhythm.maxCombo}`)
    }
    if (this.state.power.bestPower > 0) {
      highlights.push(`力量最好 ${this.state.power.bestPower}`)
    }
    const base: GameResult = {
      winner: total >= 3000 ? 'slot-0' : null,
      scores: Object.fromEntries(this.slots.map((s) => [s.slotId, s.score])),
      tier: tierObj,
      rankPoints,
      highlights,
      durationMs: this.elapsedMs,
    }

    // ---- R5: 钩子四件套聚合 ----
    const hooks = this.buildHooks(base, outcome)
    const result: GymGameResult = { ...base, ...hooks }
    this.lastResult = result
    return result
  }

  /** R5: 由已捕获高光 + 分数轨迹聚合关系/连胜/战果卡/翻盘/演出三态。 */
  private buildHooks(base: GameResult, outcome: 'win' | 'loss'): GymHooksData {
    const total = base.tier.score
    const captured = this.getHighlights()

    // 翻盘：前两关累计分率曾 <30%，最终 >50%。
    const comeback = detectComeback(this.scoreHistory, total, GYM_MAX_SCORE)

    // 结算演出三态。
    const ratio = total / GYM_MAX_SCORE
    let settlementType: SettlementType
    if (outcome === 'win') {
      if (comeback) settlementType = 'comeback_win'
      else if (ratio > 0.85) settlementType = 'big_win'
      else settlementType = 'narrow_win'
    } else {
      settlementType = ratio >= 0.45 && ratio < 0.5 ? 'narrow_loss' : 'big_loss'
    }

    // 教练名人关系变化（合作训练：完成=胜利，基础+8）。
    const coachSlot = this.slots.find((s) => s.slotId === 'slot-1')
    const coachId = coachSlot?.aiPersona ?? this.config?.celebrityId ?? 'coach'
    const coachAffinity = this.config?.coachAffinity ?? 0
    let delta = computeAffinityDelta({
      scene: 'gym',
      result: outcome,
      score: total,
      maxScore: GYM_MAX_SCORE,
      highlights: captured,
      comeback,
      opponentAffinity: coachAffinity,
    })
    if (outcome === 'win') delta += GYM_COACH_COOP_BONUS
    delta = Math.round(delta)
    const fromType = typeFromAffinity(coachAffinity)
    const toType = typeFromAffinity(coachAffinity + delta)
    const relationshipChanges: RelationshipChange[] = [
      {
        celebrityId: coachId,
        delta,
        fromType,
        toType,
        reason:
          outcome === 'win'
            ? `完成电路挑战，教练对你刮目相看 +${delta}`
            : `挑战未达标，教练仍期待你再来一组（${delta >= 0 ? '+' : ''}${delta}）`,
      },
    ]

    // 连胜（场景级）。
    const newStats = updateStreak(this.config?.currentStats, outcome)
    const streak = { current: newStats.currentStreak, best: newStats.bestStreak }

    const resultCard = buildResultCard({
      scene: 'gym',
      result: base,
      highlights: captured,
      relationshipChanges,
      streak,
      opponent: { id: coachId, name: this.config?.coachName ?? coachSlot?.nickname ?? coachId, type: 'celebrity' },
      outcome,
      settlementType,
      score: total,
      maxScore: GYM_MAX_SCORE,
    })

    return {
      capturedHighlights: captured,
      relationshipChanges,
      streak,
      resultCard,
      resultCardText: resultCardToText(resultCard),
      comeback,
      settlementType,
    }
  }
}
