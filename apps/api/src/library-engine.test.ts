// LibraryOrchestrator 单测：题目 fallback / AI 抢答概率 / combo 与命计分 / 胜负 / 超时 / AI 填充。
import { describe, it, expect } from 'vitest'
import { LibraryOrchestrator, pickFallbackQuestions, type EngineOpponent, type LibraryGameResult } from './library-engine'
import { QUIZ_FALLBACK_BANK } from './library-quiz-fallback'
import {
  QUIZ_STARTING_LIVES,
  celebBuzzAccuracy,
  validateQuizQuestion,
  type QuizQuestion,
} from '@balabala/shared'

const OPPONENTS: EngineOpponent[] = [
  { id: 'albert-einstein', name: '爱因斯坦', field: '科学' },
  { id: 'lu-xun', name: '鲁迅', field: '文学' },
  { id: 'li-bai', name: '李白', field: '文学' },
]

function makeQuestions(): QuizQuestion[] {
  // 8 道：correctIndex 固定为 0，便于“答对”
  return QUIZ_FALLBACK_BANK.science.slice(0, 8).map((q) => ({ ...q, correctIndex: 0 }))
}

function makeEngine() {
  const orch = new LibraryOrchestrator()
  orch.setupContestant(OPPONENTS.map((o) => o.id), 'u-1', '小明')
  orch.startGame({ domain: 'science', questions: makeQuestions(), opponents: OPPONENTS })
  return orch
}

describe('槽位与 AI 填充', () => {
  it('真人=攻擂方 slot-0，三位 AI 对手填满 slot-1..3', () => {
    const orch = makeEngine()
    expect(orch.slots[0].isHuman).toBe(true)
    expect(orch.slots[0].role).toBe('challenger')
    expect(orch.getAISlots()).toHaveLength(3)
    expect(orch.getAISlots().every((s) => !s.isHuman)).toBe(true)
  })
})

describe('题目 fallback 题库', () => {
  it('每个领域 ≥15 题且全部通过校验', () => {
    for (const [domain, bank] of Object.entries(QUIZ_FALLBACK_BANK)) {
      expect(bank.length, `${domain} 题库不足`).toBeGreaterThanOrEqual(15)
      for (const q of bank) expect(validateQuizQuestion(q), `${domain} 有非法题`).not.toBeNull()
    }
  })

  it('pickFallbackQuestions 抽满 8 题且不重复', () => {
    const picked = pickFallbackQuestions(QUIZ_FALLBACK_BANK.literature, 8, () => 0.5)
    expect(picked).toHaveLength(8)
    expect(new Set(picked.map((q) => q.prompt)).size).toBe(8)
  })
})

describe('玩家计分与 combo', () => {
  it('连对前 3 题每题 100；combo≥3 后下一题 ×2', () => {
    const orch = makeEngine()
    const r1 = orch.applyAnswer(0); expect(r1.correct).toBe(true); expect(r1.delta).toBe(100)
    expect(r1.combo).toBe(1)
    orch.advance()
    const r2 = orch.applyAnswer(0); expect(r2.delta).toBe(100); expect(r2.combo).toBe(2)
    orch.advance()
    const r3 = orch.applyAnswer(0); expect(r3.delta).toBe(100); expect(r3.combo).toBe(3)
    orch.advance()
    const r4 = orch.applyAnswer(0) // comboBefore=3 → ×2
    expect(r4.delta).toBe(200)
    expect(orch.getScore('slot-0')).toBe(500)
  })

  it('答错扣命并断 combo', () => {
    const orch = makeEngine()
    orch.applyAnswer(0); orch.advance() // combo=1
    const wrong = orch.applyAnswer(3)
    expect(wrong.correct).toBe(false)
    expect(wrong.livesLeft).toBe(QUIZ_STARTING_LIVES - 1)
    expect(wrong.combo).toBe(0)
  })

  it('超时（choice=-1）按答错处理', () => {
    const orch = makeEngine()
    orch.applyAnswer(-1)
    expect(orch.state.lives).toBe(QUIZ_STARTING_LIVES - 1)
    expect(orch.state.answered).toBe(true)
  })

  it('命尽提前结束', () => {
    const orch = makeEngine()
    orch.applyAnswer(-1); orch.advance()
    orch.applyAnswer(-1); orch.advance()
    const last = orch.applyAnswer(-1)
    expect(last.livesLeft).toBe(0)
    expect(orch.state.finishedEarly).toBe(true)
    orch.advance()
    expect(orch.phase).toBe('results')
  })
})

describe('AI 抢答', () => {
  it('planBuzzes 每题 1-2 位 AI、atMs 在 2-8s 窗口内', () => {
    const orch = makeEngine()
    for (let i = 0; i < 20; i++) {
      const buzzes = orch.state.buzzes
      expect(buzzes.length).toBeGreaterThanOrEqual(1)
      expect(buzzes.length).toBeLessThanOrEqual(2)
      for (const b of buzzes) {
        expect(b.atMs).toBeGreaterThanOrEqual(2000)
        expect(b.atMs).toBeLessThanOrEqual(8000)
      }
      orch.applyAnswer(0)
      orch.advance()
      if (orch.phase !== 'playing') break
    }
  })

  it('AI 答对 +50 / 答错 -20，主场名人正确率更高', () => {
    expect(celebBuzzAccuracy('科学', 'science')).toBeGreaterThan(celebBuzzAccuracy('文学', 'science'))
    const orch = makeEngine()
    orch.applyCelebrityBuzz('albert-einstein', true)
    expect(orch.getScore('slot-1')).toBe(50)
    orch.applyCelebrityBuzz('lu-xun', false)
    expect(orch.getScore('slot-2')).toBe(-20)
  })
})

describe('胜负判定与结算', () => {
  it('真人压过 2 位 AI（rank≤2）即赢，tier=学霸/expert', () => {
    const orch = makeEngine()
    // 真人 600；AI 分别 100 / 300 / 900 → 真人 rank=2
    orch.addScore('slot-0', 600, 'test')
    orch.addScore('slot-1', 100, 'test')
    orch.addScore('slot-2', 300, 'test')
    orch.addScore('slot-3', 900, 'test')
    orch.cancelTimer()
    const result = orch.settle()
    expect(result.winner).toBe('slot-0')
    expect(result.tier.label).toBe('学霸')
    expect(result.tier.level).toBe('expert')
  })

  it('真人垫底（rank4）不赢，tier=门外汉/novice', () => {
    const orch = makeEngine()
    orch.addScore('slot-0', 50, 'test')
    orch.addScore('slot-1', 100, 'test')
    orch.addScore('slot-2', 300, 'test')
    orch.addScore('slot-3', 900, 'test')
    orch.cancelTimer()
    const result = orch.settle()
    expect(result.winner).toBeNull()
    expect(result.tier.level).toBe('novice')
  })

  it('压过全部 3 位 AI 即宗师/master', () => {
    const orch = makeEngine()
    orch.addScore('slot-0', 1200, 'test')
    orch.addScore('slot-1', 100, 'test')
    orch.addScore('slot-2', 300, 'test')
    orch.addScore('slot-3', 900, 'test')
    orch.cancelTimer()
    const result = orch.settle()
    expect(result.winner).toBe('slot-0')
    expect(result.tier.label).toBe('宗师')
    expect(result.tier.level).toBe('master')
  })
})

// ===== R5 · 钩子四件套 =====

describe('R5 · 高光捕获', () => {
  it('连对 ≥5 → high_combo', () => {
    const orch = makeEngine()
    for (let i = 0; i < 5; i++) {
      orch.applyAnswer(0)
      if (i < 4) orch.advance()
    }
    const types = orch.getHighlights().map((h) => h.type)
    expect(types).toContain('high_combo')
  })

  it('1s 内抢答正确 → extreme_performance（闪电抢答）', () => {
    const orch = makeEngine()
    orch.applyAnswer(0, { answeredWithinMs: 600 })
    const types = orch.getHighlights().map((h) => h.type)
    expect(types).toContain('extreme_performance')
  })

  it('击败全部 3 位 AI → perfect_round', () => {
    const orch = makeEngine()
    orch.addScore('slot-0', 1200, 't')
    orch.addScore('slot-1', 100, 't'); orch.addScore('slot-2', 300, 't'); orch.addScore('slot-3', 900, 't')
    orch.cancelTimer()
    const res = orch.settle() as LibraryGameResult
    expect(res.capturedHighlights.map((h) => h.type)).toContain('perfect_round')
  })

  it('压过 2 位 AI → extreme_performance', () => {
    const orch = makeEngine()
    orch.addScore('slot-0', 600, 't')
    orch.addScore('slot-1', 100, 't'); orch.addScore('slot-2', 300, 't'); orch.addScore('slot-3', 900, 't')
    orch.cancelTimer()
    const res = orch.settle() as LibraryGameResult
    expect(res.capturedHighlights.map((h) => h.type)).toContain('extreme_performance')
  })
})

describe('R5 · 关系变化 / 连胜 / 翻盘 / 战果卡', () => {
  it('对 3 位名人各产生一条关系变化；被击败的名人负向、被失误帮到的正向', () => {
    const orch = makeEngine()
    // 爱因斯坦抢答失误（帮了玩家）
    orch.applyCelebrityBuzz('albert-einstein', false)
    // 终局：玩家 600；einstein 900（赢我），luxun 300 / libai 100（被我压过）
    orch.addScore('slot-0', 600, 't')
    orch.addScore('slot-1', 900, 't'); orch.addScore('slot-2', 300, 't'); orch.addScore('slot-3', 100, 't')
    orch.cancelTimer()
    const res = orch.settle() as LibraryGameResult
    expect(res.relationshipChanges).toHaveLength(3)
    const byId = Object.fromEntries(res.relationshipChanges.map((c) => [c.celebrityId, c]))
    // einstein 赢我 + 失误帮我 → 正向
    expect(byId['albert-einstein'].delta).toBeGreaterThan(0)
    // luxun / libai 被我压过 → 负向
    expect(byId['lu-xun'].delta).toBeLessThan(0)
    expect(byId['li-bai'].delta).toBeLessThan(0)
    expect(res.resultCardText).toContain('图书馆')
  })

  it('连胜：注入 currentStats，胜利后 currentStreak 累加', () => {
    const orch = new LibraryOrchestrator()
    orch.setupContestant(OPPONENTS.map((o) => o.id), 'u-1', '小明')
    orch.startGame({
      domain: 'science',
      questions: makeQuestions(),
      opponents: OPPONENTS,
      currentStats: { played: 2, wins: 1, bestStreak: 2, currentStreak: 2 },
    })
    orch.addScore('slot-0', 1200, 't')
    orch.addScore('slot-1', 100, 't'); orch.addScore('slot-2', 300, 't'); orch.addScore('slot-3', 900, 't')
    orch.cancelTimer()
    const res = orch.settle() as LibraryGameResult
    expect(res.streak.current).toBe(3)
    expect(res.streak.best).toBe(3)
  })

  it('翻盘：先答错（0 分）后连对追分 → comeback=true', () => {
    const orch = makeEngine()
    orch.applyAnswer(-1) // 0 分起步
    for (let i = 0; i < 6; i++) {
      orch.advance()
      orch.applyAnswer(0)
    }
    orch.cancelTimer()
    const res = orch.settle() as LibraryGameResult
    expect(res.comeback).toBe(true)
  })
})
