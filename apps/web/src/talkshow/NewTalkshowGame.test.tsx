// @vitest-environment jsdom
// NewTalkshowGame 组件测试：mock engine-client，验证选话题→讲段子→评分→结算。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('./engine-client', () => ({
  createTalkshowGame: vi.fn(),
  pickTalkshowTopic: vi.fn(),
  submitJoke: vi.fn(),
  getTalkshowDailyChallenge: vi.fn(),
}))
vi.mock('../profile', () => ({ submitGameResult: vi.fn().mockResolvedValue(undefined) }))

import { createTalkshowGame, pickTalkshowTopic, submitJoke, getTalkshowDailyChallenge } from './engine-client'
import NewTalkshowGame from './NewTalkshowGame'

function pickingSnapshot() {
  return {
    phase: 'playing', currentRound: 1, maxRounds: 3,
    state: {
      stage: 'picking_topic', topic: null, currentJokeIndex: 0, totalJokes: 3,
      jokeTimeLimitMs: 60000, jokes: [], warmupJokes: [], callbackOptions: [], warnedLastTen: false,
    },
  }
}
function performingSnapshot(index: number, jokes: unknown[] = []) {
  return {
    phase: 'playing', currentRound: index + 1, maxRounds: 3,
    state: {
      stage: 'performing',
      topic: { id: 'workplace', label: '职场吐槽', icon: '💼', subtopics: [] },
      currentJokeIndex: index, totalJokes: 3, jokeTimeLimitMs: 60000,
      jokes, warmupJokes: [], callbackOptions: [], warnedLastTen: false,
    },
  }
}

const startEvents = [
  { type: 'game_started', timestamp: 1, payload: {} },
  { type: 'talkshow_warmup', timestamp: 2, payload: { warmupJokes: [] } },
  { type: 'talkshow_topic_options', timestamp: 3, payload: { topics: [
    { id: 'workplace', label: '职场吐槽', icon: '💼' },
    { id: 'dating', label: '恋爱翻车', icon: '💘' },
  ] } },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  ;(createTalkshowGame as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'ts-1', snapshot: pickingSnapshot(), events: startEvents,
  })
  ;(getTalkshowDailyChallenge as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 't1', title: 'callback之王', description: '回扣两次', modifier: 'callback×2', reward: 20,
  })
})

describe('<NewTalkshowGame />', () => {
  it('开局显示每日挑战横幅与话题票', async () => {
    render(<NewTalkshowGame onBack={() => {}} />)
    expect(await screen.findByText('今晚聊点啥？')).toBeInTheDocument()
    expect(screen.getByTestId('talkshow-daily-banner')).toHaveTextContent('callback之王')
    expect(screen.getByText('职场吐槽')).toBeInTheDocument()
    expect(screen.getByText('恋爱翻车')).toBeInTheDocument()
  })

  it('选话题后出现段子输入框，提交后显示三维度评分', async () => {
    ;(pickTalkshowTopic as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshot: performingSnapshot(0), events: [...startEvents,
        { type: 'talkshow_topic_picked', timestamp: 4, payload: { topic: '职场吐槽' } },
        { type: 'talkshow_joke_start', timestamp: 5, payload: { index: 0, timeLimitMs: 60000, callbackOptions: [] } },
      ],
    })
    const joke = {
      text: '老板画的饼比食堂的饼还大', topic: '职场吐槽',
      scores: { punchline: 24, pacing: 22, resonance: 20 }, total: 66,
      reaction: 'applaud', note: '包袱不错！',
    }
    ;(submitJoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      joke,
      snapshot: performingSnapshot(1, [joke]),
      events: [...startEvents,
        { type: 'talkshow_joke_scored', timestamp: 6, payload: { index: 0, scores: joke.scores, total: 66, reaction: 'applaud', note: joke.note } },
      ],
    })

    render(<NewTalkshowGame onBack={() => {}} />)
    fireEvent.click(await screen.findByText('职场吐槽'))
    const input = await screen.findByTestId('talkshow-joke-input')
    fireEvent.change(input, { target: { value: '老板画的饼比食堂的饼还大' } })
    fireEvent.click(screen.getByTestId('talkshow-submit-joke'))

    await waitFor(() => expect(submitJoke).toHaveBeenCalledWith('ts-1', '老板画的饼比食堂的饼还大', {}))
    expect(await screen.findByTestId('talkshow-reaction')).toHaveTextContent('爆笑鼓掌')
    // 三维度雷达：Punchline 维度标签出现
    expect(await screen.findByText('Punchline 包袱')).toBeInTheDocument()
  })

  it('三段讲完后显示段位结算', async () => {
    const joke = {
      text: '金句', topic: '职场吐槽',
      scores: { punchline: 24, pacing: 22, resonance: 20 }, total: 66,
      reaction: 'applaud', note: 'n',
    }
    ;(pickTalkshowTopic as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshot: performingSnapshot(0), events: startEvents,
    })
    ;(submitJoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      joke,
      snapshot: {
        phase: 'results', currentRound: 3, maxRounds: 3,
        state: {
          stage: 'results', topic: { id: 'workplace', label: '职场吐槽', icon: '💼', subtopics: [] },
          currentJokeIndex: 3, totalJokes: 3, jokeTimeLimitMs: 60000,
          jokes: [joke, joke, joke], warmupJokes: [], callbackOptions: [], warnedLastTen: false,
        },
      },
      events: [...startEvents,
        { type: 'game_result', timestamp: 9, payload: { result: {
          winner: null, scores: { 'slot-0': 66 },
          tier: { level: 'expert', label: '炸场', score: 66, percentile: 66 },
          highlights: ['金句卡：「金句」（66 分）'], durationMs: 1000,
        } } },
      ],
    })

    render(<NewTalkshowGame onBack={() => {}} />)
    fireEvent.click(await screen.findByText('职场吐槽'))
    const input = await screen.findByTestId('talkshow-joke-input')
    fireEvent.change(input, { target: { value: '金句' } })
    fireEvent.click(screen.getByTestId('talkshow-submit-joke'))

    expect(await screen.findByTestId('talkshow-results')).toHaveTextContent('炸场')
    expect(screen.getByTestId('talkshow-gold')).toBeInTheDocument()
  })
})
