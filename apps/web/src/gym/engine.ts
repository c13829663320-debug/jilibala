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
  type DailyChallenge,
  type GameResult,
  type MiniGameKind,
  type StationResult,
  type CircuitTier,
  type Tier,
  type TierLevel,
  type TutorialStep,
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
}

export const GYM_MAX_LIVES = 3

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

  startCircuit(): void {
    const celebrityId = this.slots.find((s) => s.slotId === 'slot-1')?.aiPersona ?? 'coach'
    this.start({ celebrityId })
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
      percentile: Math.min(99, Math.round((total / 4500) * 100)),
    }
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
    return {
      winner: total >= 3000 ? 'slot-0' : null,
      scores: Object.fromEntries(this.slots.map((s) => [s.slotId, s.score])),
      tier: tierObj,
      rankPoints,
      highlights,
      durationMs: this.elapsedMs,
    }
  }
}
