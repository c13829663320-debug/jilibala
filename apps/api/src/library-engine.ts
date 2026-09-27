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
  type BuzzOpponent,
  type PlannedBuzz,
  type QuizDomain,
  type QuizPlayer,
  type QuizQuestion,
  type GameResult,
  type Tier,
  type TierLevel,
  type TutorialStep,
} from '@balabala/shared'

// ===== 状态 =====

export interface EngineOpponent extends BuzzOpponent {
  name: string
}

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
  | { type: 'answer'; choice: number } // choice=-1 表示超时未答
  | { type: 'celebrity_buzz'; celebId: string; correct: boolean }
  | { type: 'next_question' }

export interface LibraryEngineConfig {
  domain: QuizDomain
  questions: QuizQuestion[]
  opponents: EngineOpponent[]
  /** 可注入随机源（测试用确定性序列）。 */
  rand?: () => number
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

  /** AI 对手抢答结果落分（由前端 setTimeout 触发或测试直接调用）。 */
  applyCelebrityBuzz(celebId: string, correct: boolean): void {
    const slotIdx = this.state.opponents.findIndex((o) => o.id === celebId)
    if (slotIdx < 0) return
    const slotId = `slot-${slotIdx + 1}`
    const delta = correct ? 50 : -20
    this.addScore(slotId, delta, 'celebrity_buzz')
    this.emit({
      type: 'celebrity_buzzed',
      timestamp: Date.now(),
      payload: { celebId, correct, delta },
    })
  }

  /** 玩家作答（choice=-1 超时）。返回本回合裁决摘要。 */
  applyAnswer(choice: number): { correct: boolean; delta: number; livesLeft: number; combo: number } {
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
    this.emit({
      type: 'player_answered',
      timestamp: Date.now(),
      payload: { choice, correct, delta, lives: s.lives, combo: s.combo },
    })
    return { correct, delta, livesLeft: s.lives, combo: s.combo }
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
        this.applyAnswer(action.choice)
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
      percentile: Math.min(99, Math.round((me.score / 1600) * 100)),
    }
    const highlights: string[] = []
    highlights.push(`答对 ${s.correctCount}/${s.questions.length}`)
    if (s.maxCombo >= 2) highlights.push(`最高连击 ×${s.maxCombo}`)
    if (s.finishedEarly) highlights.push('命耗尽提前出局')
    return {
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
