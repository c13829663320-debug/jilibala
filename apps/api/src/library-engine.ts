// ============================================================================
// 图书馆 · 知识擂台赛引擎（LibraryOrchestrator）
// 继承共享编排基类 BaseOrchestrator：纯 TS，不依赖 React / DB / LLM。
// 规则全部复用 packages/shared/src/library-quiz.ts 纯函数（planBuzzes /
// playerScoreDelta / nextCombo / rankPlayers / tierForRank）。
// 题目由 config 注入（LLM 生成或 fallback 题库）；rand 可注入便于确定性测试。
// ============================================================================

import {
  BaseOrchestrator,
  planBuzzes,
  playerScoreDelta,
  nextCombo,
  rankPlayers,
  tierForRank,
  QUIZ_STARTING_LIVES,
  QUIZ_QUESTION_TIME_LIMIT_MS,
  QUIZ_QUESTION_COUNT,
  detectHighlight,
  typeFromAffinity,
  buildResultCard,
  resultCardToText,
  updateStreak,
  detectComeback,
  type BuzzOpponent,
  type PlannedBuzz,
  type QuizDomain,
  type QuizPlayer,
  type QuizQuestion,
  type GameResult,
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

export interface EngineOpponent extends BuzzOpponent {
  name: string
}

/** R5 · 一局满分（8 题 × 200 满档）。翻盘/好感度分率归一化用。 */
export const QUIZ_MAX_SCORE = 1600

/** R5 · 钩子四件套在结算时聚合出的额外数据。 */
export interface LibraryHooksData {
  capturedHighlights: Highlight[]
  relationshipChanges: RelationshipChange[]
  streak: { current: number; best: number }
  resultCard: ResultCardData
  resultCardText: string
  comeback: boolean
  settlementType: SettlementType
}

export type LibraryGameResult = GameResult & LibraryHooksData

export interface QuizEngineState {
  domain: QuizDomain
  questions: QuizQuestion[]
  opponents: EngineOpponent[]
  /** 当前题下标 0..7。 */
  currentQuestionIndex: number
  lives: number
  combo: number
  maxCombo: number
  correctCount: number
  /** 当前题是否已结算（玩家已作答或超时）。 */
  answered: boolean
  /** 本题已规划的 AI 抢答（前端据此 setTimeout）。 */
  buzzes: PlannedBuzz[]
  /** lives=0 提前出局。 */
  finishedEarly: boolean
}

// ===== 动作 =====

export type LibraryAction =
  | { type: 'begin_question' }
  | { type: 'answer'; choice: number; answeredWithinMs?: number } // choice=-1 表示超时未答
  | { type: 'celebrity_buzz'; celebId: string; correct: boolean }
  | { type: 'next_question' }

export interface LibraryEngineConfig {
  domain: QuizDomain
  questions: QuizQuestion[]
  opponents: EngineOpponent[]
  /** 可注入随机源（测试用确定性序列）。 */
  rand?: () => number
  /** R5: 结算前的 library 战绩快照（连胜计算用）。 */
  currentStats?: MatchStats
  /** R5: 结算前对各对手名人的好感度（关系档位判定用）。 */
  opponentAffinities?: Record<string, number>
}

/** 首局新手引导四步。 */
export const LIBRARY_TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'lib-domain', title: '选领域', description: '科学 / 文学 / 哲学 / 历史 / 艺术，选一个你最有把握的领域开战。', target: '.domain-grid' },
  { id: 'lib-opponents', title: '看对手', description: '三位 AI 名人已就座，实时分数条会跟你的此消彼长。', target: '.opponent-scoreboard' },
  { id: 'lib-buzz', title: '抢答规则', description: '每题 10 秒限时、4 选 1。答错或超时掉 1 命（共 3 命），AI 会中途抢答抢分。', target: '.quiz-options' },
  { id: 'lib-combo', title: '连击加成', description: '连对 3 题后，下一题得分 ×2。答错立即断连击。', target: '.combo-meter' },
]

function initialState(): QuizEngineState {
  return {
    domain: 'science',
    questions: [],
    opponents: [],
    currentQuestionIndex: 0,
    lives: QUIZ_STARTING_LIVES,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    answered: true,
    buzzes: [],
    finishedEarly: false,
  }
}

export class LibraryOrchestrator extends BaseOrchestrator<QuizEngineState, LibraryAction, LibraryEngineConfig> {
  private rand: () => number = Math.random
  /** R5: 玩家累计得分轨迹（翻盘检测用，含起点 0）。 */
  private scoreHistory: number[] = [0]
  /** R5: 各对手名人本局抢答失误次数（失误=客观上帮了玩家）。 */
  private wrongBuzzes: Record<string, number> = {}
  /** R5: 最快一次答对的耗时（ms），用于闪电抢答高光。 */
  private quickestAnswerMs: number | undefined
  /** R5: 最近一次 settle() 产出（含钩子数据）。 */
  lastResult?: LibraryGameResult

  constructor() {
    super({
      maxRounds: QUIZ_QUESTION_COUNT,
      initialState: initialState(),
      tutorialSteps: LIBRARY_TUTORIAL_STEPS,
    })
  }

  /** slot-0=攻擂方真人，slot-1..3=三位 AI 名人对手。 */
  setupContestant(opponentIds: string[], userId: string, nickname: string): void {
    this.setupSlots(['challenger', 'opponent-1', 'opponent-2', 'opponent-3'], 1, opponentIds)
    this.assignHuman(userId, nickname, 'slot-0')
  }

  startGame(config: LibraryEngineConfig): void {
    this.rand = config.rand ?? Math.random
    this.state.questions = config.questions
    this.state.opponents = config.opponents
    this.state.domain = config.domain
    this.state.currentQuestionIndex = 0
    this.scoreHistory = [0]
    this.wrongBuzzes = {}
    this.quickestAnswerMs = undefined
    this.start(config)
    this.beginQuestion(0)
  }

  // ---- 题目流转 -------------------------------------------------------------

  /** 开启第 i 题：规划 AI 抢答并起 10s 超时倒计时。 */
  beginQuestion(index: number): void {
    const s = this.state
    s.currentQuestionIndex = index
    s.answered = false
    const question = s.questions[index]
    if (!question) return
    // 本题 1-2 位 AI 抢答计划（2-8s）
    s.buzzes = planBuzzes(s.domain, s.opponents, this.rand)
    this.emit({ type: 'question_show', timestamp: Date.now(), payload: { index, buzzes: s.buzzes } })
    // 超时兜底：10s 未作答按答错处理（lives-1）
    this.startTimer(QUIZ_QUESTION_TIME_LIMIT_MS, () => {
      if (!this.state.answered) this.applyAnswer(-1)
    })
  }

  /**
   * R5: 无头结算用——路由层把客户端跑完的对局轨迹（得分历史/失误/最快抢答）
   * 灌回来，直接复用 settle() 的钩子聚合，避免在路由层重复实现关系/战果卡逻辑。
   */
  restoreSettleContext(trace: {
    scoreHistory: number[]
    wrongBuzzes: Record<string, number>
    quickestAnswerMs?: number
    maxCombo: number
    correctCount: number
    questionCount: number
  }): void {
    this.scoreHistory = trace.scoreHistory
    this.wrongBuzzes = trace.wrongBuzzes
    this.quickestAnswerMs = trace.quickestAnswerMs
    this.state.maxCombo = trace.maxCombo
    this.state.correctCount = trace.correctCount
    if (this.state.questions.length !== trace.questionCount) {
      const q = { prompt: '', options: ['', '', '', ''], correctIndex: 0, explanation: '' }
      this.state.questions = Array.from({ length: trace.questionCount }, () => ({ ...q }))
    }
  }

  /** AI 对手抢答结果落分（由前端 setTimeout 触发或测试直接调用）。 */
  applyCelebrityBuzz(celebId: string, correct: boolean): void {
    const slotIdx = this.state.opponents.findIndex((o) => o.id === celebId)
    if (slotIdx < 0) return
    const slotId = `slot-${slotIdx + 1}`
    const delta = correct ? 50 : -20
    this.addScore(slotId, delta, 'celebrity_buzz')
    // R5: 记录失误次数（失误=客观帮了玩家，关系好感上浮）。
    if (!correct) this.wrongBuzzes[celebId] = (this.wrongBuzzes[celebId] ?? 0) + 1
    this.emit({
      type: 'celebrity_buzzed',
      timestamp: Date.now(),
      payload: { celebId, correct, delta },
    })
  }

  /**
   * 玩家作答（choice=-1 超时）。返回本回合裁决摘要。
   * @param opts.answeredWithinMs 本题从亮出到作答的耗时（ms）；≤1000 且答对 → 闪电抢答高光。
   */
  applyAnswer(choice: number, opts: { answeredWithinMs?: number } = {}): { correct: boolean; delta: number; livesLeft: number; combo: number } {
    const s = this.state
    if (s.answered) return { correct: false, delta: 0, livesLeft: s.lives, combo: s.combo }
    s.answered = true
    const question = s.questions[s.currentQuestionIndex]
    const correct = question != null && choice === question.correctIndex

    let delta = 0
    if (correct) {
      delta = playerScoreDelta(s.combo)
      s.combo = nextCombo(s.combo, true)
      s.maxCombo = Math.max(s.maxCombo, s.combo)
      s.correctCount += 1
      this.addScore('slot-0', delta, 'player_answer')
      if (s.combo >= 3) this.emitFeedback('combo', { combo: s.combo })
      this.captureAnswerHighlights(s.combo, opts.answeredWithinMs)
    } else {
      s.lives -= 1
      s.combo = 0
      this.emit({
        type: 'life_lost',
        timestamp: Date.now(),
        payload: { lives: s.lives },
      })
      if (s.lives <= 0) s.finishedEarly = true
    }
    // R5: 记录玩家累计得分轨迹（翻盘检测用）。
    this.scoreHistory.push(this.getScore('slot-0'))
    this.emit({
      type: 'player_answered',
      timestamp: Date.now(),
      payload: { choice, correct, delta, lives: s.lives, combo: s.combo },
    })
    return { correct, delta, livesLeft: s.lives, combo: s.combo }
  }

  /**
   * R5: 作答高光。
   *  - combo ≥5 → 走共享 detectHighlight → high_combo。
   *  - 1s 内抢答且正确 → extreme_performance（闪电抢答）。
   */
  private captureAnswerHighlights(combo: number, answeredWithinMs?: number): void {
    const now = Date.now()
    const hl = detectHighlight('library', {
      type: 'answered',
      payload: { combo, round: this.state.currentQuestionIndex, timestamp: now },
    })
    if (hl) this.captureHighlight(hl)
    if (answeredWithinMs !== undefined && answeredWithinMs <= 1000) {
      if (this.quickestAnswerMs === undefined || answeredWithinMs < this.quickestAnswerMs) {
        this.quickestAnswerMs = answeredWithinMs
      }
      this.captureHighlight({
        id: this.nextHighlightId(),
        scene: 'library',
        type: 'extreme_performance',
        timestamp: now,
        round: this.state.currentQuestionIndex,
        description: `闪电抢答 ${answeredWithinMs}ms 命中`,
        data: { answeredWithinMs },
      })
    }
  }

  /** 揭示结束后推进：题尽 / 命尽 → finish，否则下一题。 */
  advance(): void {
    const s = this.state
    this.cancelTimer()
    if (s.finishedEarly || s.currentQuestionIndex >= s.questions.length - 1) {
      this.finish()
      return
    }
    this.nextRound()
    this.beginQuestion(s.currentQuestionIndex + 1)
  }

  // ---- BaseOrchestrator 抽象 ----------------------------------------------

  protected applyAction(action: LibraryAction): void {
    switch (action.type) {
      case 'answer':
        this.applyAnswer(action.choice, { answeredWithinMs: action.answeredWithinMs })
        break
      case 'celebrity_buzz':
        this.applyCelebrityBuzz(action.celebId, action.correct)
        break
      case 'begin_question':
        this.beginQuestion(this.state.currentQuestionIndex)
        break
      case 'next_question':
        this.advance()
        break
    }
  }

  settle(): GameResult {
    const s = this.state
    const players: QuizPlayer[] = [
      { id: 'you', name: '你', score: this.getScore('slot-0'), isCeleb: false },
      ...s.opponents.map((o, i) => ({
        id: o.id,
        name: o.name,
        score: this.getScore(`slot-${i + 1}`),
        isCeleb: true,
      })),
    ]
    const ranked = rankPlayers(players)
    const me = ranked.find((p) => p.id === 'you') ?? ranked[ranked.length - 1]
    const win = me.rank <= 2 // 压过 3 位 AI 中的至少 1 位（即排名前 2）即赢
    const quizTier = tierForRank(me.rank)
    const tierLevel: TierLevel = quizTier === '宗师' ? 'master' : quizTier === '学霸' ? 'expert' : 'novice'
    const tier: Tier = {
      level: tierLevel,
      label: quizTier,
      score: me.score,
      percentile: Math.min(99, Math.round((me.score / QUIZ_MAX_SCORE) * 100)),
    }
    const highlights: string[] = []
    highlights.push(`答对 ${s.correctCount}/${s.questions.length}`)
    if (s.maxCombo >= 2) highlights.push(`最高连击 ×${s.maxCombo}`)
    if (this.quickestAnswerMs !== undefined) highlights.push(`最快抢答 ${this.quickestAnswerMs}ms`)
    if (s.finishedEarly) highlights.push('命耗尽提前出局')
    const base: GameResult = {
      winner: win ? 'slot-0' : null,
      scores: {
        you: me.score,
        ...Object.fromEntries(ranked.filter((p) => p.id !== 'you').map((p) => [p.id, p.score])),
      },
      tier,
      rankPoints: win ? 25 : -15,
      highlights,
      durationMs: this.elapsedMs,
    }

    // ---- R5: 钩子四件套聚合 ----
    const hooks = this.buildLibraryHooks(base, me.rank, win)
    const result: LibraryGameResult = { ...base, ...hooks }
    this.lastResult = result
    return result
  }

  /** R5: 由已捕获高光 + 名次 + 对手轨迹聚合关系/连胜/战果卡/翻盘/演出三态。 */
  private buildLibraryHooks(base: GameResult, myRank: number, win: boolean): LibraryHooksData {
    const meScore = base.tier.score
    const outcome: 'win' | 'draw' | 'loss' = win ? 'win' : 'loss'
    const captured = this.getHighlights()

    // 终局名次高光：击败全部 3 位 → perfect_round；压过 2 位 → extreme_performance。
    if (myRank === 1) {
      captured.push({
        id: this.nextHighlightId(),
        scene: 'library',
        type: 'perfect_round',
        timestamp: Date.now(),
        description: '横扫三位名人，守擂成功！',
        data: { rank: myRank },
      })
    } else if (myRank === 2) {
      captured.push({
        id: this.nextHighlightId(),
        scene: 'library',
        type: 'extreme_performance',
        timestamp: Date.now(),
        description: '力压两位名人，攻擂得手',
        data: { rank: myRank },
      })
    }

    // 翻盘：前期落后（分率曾 <30%）后期反超（终局 >50%）。
    const comeback = detectComeback(this.scoreHistory, meScore, QUIZ_MAX_SCORE)

    const ratio = meScore / QUIZ_MAX_SCORE
    let settlementType: SettlementType
    if (outcome === 'win') {
      if (comeback) settlementType = 'comeback_win'
      else if (ratio > 0.85) settlementType = 'big_win'
      else settlementType = 'narrow_win'
    } else {
      settlementType = ratio >= 0.45 && ratio < 0.5 ? 'narrow_loss' : 'big_loss'
    }

    // 对 3 位对手名人的关系变化：
    //   击败的名人（我分更高）= 败军之将，好感下调（宿敌倾向）；
    //   抢答失误帮到我的名人 = 学友，好感上浮；
    //   高光越多，这局越让人印象深刻，对所有在场名人 +1/个。
    const affinities = this.config?.opponentAffinities ?? {}
    const relationshipChanges: RelationshipChange[] = this.state.opponents.map((opp, i) => {
      const celebScore = this.getScore(`slot-${i + 1}`)
      const iBeat = meScore > celebScore
      const helped = (this.wrongBuzzes[opp.id] ?? 0) > 0
      // 竞技场景关系：击败的名人 = 败军之将，好感下调（宿敌倾向）；
      // 抢答失误客观帮到你的名人 = 学友，好感上浮；其余略胜/略负微正。
      let delta = iBeat ? -4 : helped ? 4 : 1
      if (comeback) delta += 2
      delta = Math.round(delta)
      const prevAffinity = affinities[opp.id] ?? 0
      const fromType = typeFromAffinity(prevAffinity)
      const toType = typeFromAffinity(prevAffinity + delta)
      return {
        celebrityId: opp.id,
        delta,
        fromType,
        toType,
        reason: iBeat
          ? `攻擂击败了${opp.name}，TA 视你为劲敌（${delta >= 0 ? '+' : ''}${delta}）`
          : helped
            ? `${opp.name}抢答失误帮了你一把，好感升温（+${delta}）`
            : `${opp.name}略胜一筹，互有敬意（${delta >= 0 ? '+' : ''}${delta}）`,
      }
    })

    const newStats = updateStreak(this.config?.currentStats, outcome)
    const streak = { current: newStats.currentStreak, best: newStats.bestStreak }

    const primary = this.state.opponents[0]
    const resultCard = buildResultCard({
      scene: 'library',
      result: base,
      highlights: captured,
      relationshipChanges,
      streak,
      opponent: { id: primary?.id ?? 'opponent', name: primary?.name ?? '对手', type: 'celebrity' },
      outcome,
      settlementType,
      score: meScore,
      maxScore: QUIZ_MAX_SCORE,
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

/** 从 fallback 题库抽 n 题（确定性可选）。 */
export function pickFallbackQuestions(
  bank: QuizQuestion[],
  count: number,
  rand: () => number = Math.random,
): QuizQuestion[] {
  const pool = [...bank]
  const out: QuizQuestion[] = []
  while (out.length < count && pool.length > 0) {
    const idx = Math.floor(rand() * pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}
