// @vitest-environment jsdom
// NewCourtGame 组件测试：mock engine-client，验证渲染与出牌交互。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('./engine-client', () => ({
  createCourtGame: vi.fn(),
  playCourtCard: vi.fn(),
  passCourtTurn: vi.fn(),
  getCourtDailyChallenge: vi.fn(),
}))
vi.mock('../profile', () => ({ submitGameResult: vi.fn().mockResolvedValue(undefined) }))

import { createCourtGame, playCourtCard, getCourtDailyChallenge } from './engine-client'
import NewCourtGame from './NewCourtGame'

const handEvents = [
  { type: 'game_started', timestamp: 1, payload: {} },
  { type: 'court_balance_update', timestamp: 2, payload: { balance: { plaintiff: 50, defendant: 50 }, lastDelta: 0, reason: '开庭，天平居中。' } },
  { type: 'round_started', timestamp: 3, payload: { round: 1, maxRounds: 3 } },
  { type: 'court_player_turn', timestamp: 4, payload: { round: 1, ammo: 2, handCards: [], unresolved: ['凌晨扰民'] } },
]

function playingSnapshot(over: Partial<Record<string, unknown>> = {}) {
  return {
    phase: 'playing',
    currentRound: 1,
    maxRounds: 3,
    state: {
      stage: 'player_turn',
      round: 1,
      balance: { plaintiff: 50, defendant: 50 },
      ammo: { plaintiff: 2, defendant: 2 },
      unresolved: ['凌晨扰民'],
      resolved: [],
      facts: [],
      evidencePool: [{ id: 'ev-1', name: '凌晨录音', content: '凌晨扰民的电钻录音' }],
      playerSide: 'plaintiff',
      opponentSide: 'defendant',
      playerMoves: [],
      lastDelta: 0,
      ...(over.state ?? {}),
    },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(createCourtGame as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'court-1',
    snapshot: playingSnapshot(),
    events: handEvents,
  })
  ;(getCourtDailyChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'd1', title: '正人君子', description: '不嘲讽获胜', modifier: '无嘲讽', reward: 20,
  })
})

describe('<NewCourtGame />', () => {
  it('开局显示天平 50:50、每日挑战横幅和 4 张手牌', async () => {
    render(<NewCourtGame onExit={() => {}} />)
    expect(await screen.findByTestId('court-balance')).toBeInTheDocument()
    expect(await screen.findByTestId('court-hand')).toBeInTheDocument()
    expect(screen.getByTestId('court-daily-banner')).toHaveTextContent('正人君子')
    // 4 张牌
    expect(screen.getByTestId('court-card-attack')).toBeInTheDocument()
    expect(screen.getByTestId('court-card-evidence')).toBeInTheDocument()
    expect(screen.getByTestId('court-card-mock')).toBeInTheDocument()
    expect(screen.getByTestId('court-card-request_record')).toBeInTheDocument()
    expect(screen.getByTestId('court-unresolved')).toHaveTextContent('凌晨扰民')
  })

  it('点证据牌 → 出现证据选择 → 提交后调用 playCourtCard 并显示法官口播', async () => {
    ;(playCourtCard as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshot: playingSnapshot({
        state: {
          stage: 'player_turn', round: 1, balance: { plaintiff: 58, defendant: 42 },
          ammo: { plaintiff: 1, defendant: 2 }, unresolved: [], resolved: ['凌晨扰民'],
        },
      }),
      events: [
        ...handEvents,
        { type: 'court_card_resolved', timestamp: 5, payload: { card: 'evidence', hit: true, delta: 8, judgeComment: '证据「凌晨录音」与「凌晨扰民」直接相关，此点已查明。' } },
        { type: 'court_balance_update', timestamp: 6, payload: { balance: { plaintiff: 58, defendant: 42 }, lastDelta: 8, reason: '证据被采信，天平倾斜。' } },
      ],
    })
    render(<NewCourtGame onExit={() => {}} />)

    fireEvent.click(await screen.findByTestId('court-card-evidence'))
    expect(await screen.findByTestId('court-card-action')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('court-evidence-ev-1'))
    fireEvent.click(screen.getByTestId('court-submit-card'))

    await waitFor(() => expect(playCourtCard).toHaveBeenCalledWith('court-1', {
      card: 'evidence', targetEvidenceId: 'ev-1',
    }))
    // 法官口播流里出现命中提示（初始开庭长 + 本次命中/天平口播）
    await waitFor(() => {
      const lines = screen.getAllByTestId('court-judge-line')
      expect(lines.some((l) => l.textContent?.includes('凌晨录音'))).toBe(true)
    })
  })

  it('结算阶段显示胜负与段位', async () => {
    const resultEvents = [
      ...handEvents,
      { type: 'court_card_resolved', timestamp: 5, payload: { card: 'attack', hit: true, delta: 6, judgeComment: '命中。' } },
      { type: 'game_result', timestamp: 6, payload: {
        result: {
          winner: 'slot-0',
          scores: { 'slot-0': 62, 'slot-1': 38 },
          tier: { level: 'expert', label: '王牌律师', score: 62, percentile: 62 },
          highlights: ['第1轮【攻击论点】命中'],
          durationMs: 1000,
        },
      } },
    ]
    ;(playCourtCard as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshot: {
        phase: 'results', currentRound: 3, maxRounds: 3,
        state: {
          stage: 'verdict', round: 3, balance: { plaintiff: 62, defendant: 38 },
          ammo: { plaintiff: 0, defendant: 0 }, unresolved: [], resolved: ['凌晨扰民'],
          facts: [], evidencePool: [], playerSide: 'plaintiff', opponentSide: 'defendant',
          playerMoves: [], lastDelta: 0,
        },
      },
      events: resultEvents,
    })
    render(<NewCourtGame onExit={() => {}} />)
    fireEvent.click(await screen.findByTestId('court-card-attack'))
    fireEvent.change(screen.getByTestId('court-card-input'), { target: { value: '凌晨扰民必须赔偿' } })
    fireEvent.click(screen.getByTestId('court-submit-card'))

    expect(await screen.findByTestId('court-results')).toHaveTextContent('胜诉')
    expect(screen.getByTestId('court-results')).toHaveTextContent('王牌律师')
  })
})
