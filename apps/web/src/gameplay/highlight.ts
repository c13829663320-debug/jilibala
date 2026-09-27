// ============================================================================
// R5 高光提取纯逻辑：从一局原始动作中挑出「即时高光」与「逆转时刻」，
// 并构造可逐步回放的法庭高光序列。纯函数，无副作用，可单测。
// ============================================================================
import type {
  CourtCardType,
  CourtPlayerMove,
  R5Highlight,
  R5PlaySessionResult,
  R5RelationGain,
  R5SceneId,
  R5ShareCard,
  R5StreakState,
} from '@balabala/shared'
import { streakLine } from './streak'

export const CARD_LABEL: Record<CourtCardType, string> = {
  attack: '反击进攻',
  evidence: '出示证据',
  mock: '嘲讽对方',
  request_record: '请求记入笔录',
}

export const SCENE_EMOJI: Record<R5SceneId, string> = {
  court: '⚖️',
  talkshow: '🎤',
  werewolf: '🐺',
  bar: '🍸',
  gym: '💪',
  library: '📚',
}

export const SCENE_TITLE: Record<R5SceneId, string> = {
  court: '我的法庭判决书',
  talkshow: '我的开放麦战报',
  werewolf: '我的狼人杀复盘',
  bar: '我的酒吧辩论战绩',
  gym: '我的云健身打卡',
  library: '我的图书馆擂台赛报',
}

/** 法庭高光回放的一步（纯前端状态机数据，组件据此逐步播放）。 */
export interface CourtReplayStep {
  index: number
  round: number
  card: CourtCardType
  delta: number
  hit: boolean
  freeText?: string
  judgeComment?: string
  /** 打完这张牌后玩家方累计优势（正=占优，负=落后）。 */
  cumAfter: number
  /** 是否为「逆转时刻」：此前落后、本步翻盘。 */
  isReverse: boolean
  /** 这一步的口播文案。 */
  text: string
}

/**
 * 由玩家出牌序列构造可逐步回放的高光序列。
 *
 * 规则（纯前端状态机，不依赖 AI）：
 *  - 以玩家视角累计天平（delta 正=玩家方占优），起点 0；
 *  - 某步之前累计为负（落后）、该步打完累计转正 → 标记「逆转时刻」；
 *  - 单步最大正向 delta 的牌即使未逆转，也作为高光口播；
 *  - hit=true（命中 unresolved 争议点）额外强调。
 */
export function buildCourtReplay(moves: CourtPlayerMove[]): CourtReplayStep[] {
  let cum = 0
  const steps: CourtReplayStep[] = moves.map((m, i) => {
    const wasTrailing = cum < 0
    cum += m.delta
    const isReverse = wasTrailing && cum >= 0
    const bits: string[] = [`第${m.round}轮 · 打出「${CARD_LABEL[m.card]}」`]
    if (m.hit) bits.push('命中争议点')
    bits.push(m.delta >= 0 ? `天平 +${m.delta}` : `天平 ${m.delta}`)
    if (isReverse) bits.push('⚡ 逆转时刻')
    return {
      index: i,
      round: m.round,
      card: m.card,
      delta: m.delta,
      hit: m.hit,
      freeText: m.freeText,
      judgeComment: m.judgeComment,
      cumAfter: cum,
      isReverse,
      text: bits.join('，'),
    }
  })
  return steps
}

/** 从法庭出牌 + LLM 高光文案生成统一 R5Highlight 列表（含逆转标签）。 */
export function courtHighlights(
  moves: CourtPlayerMove[] | undefined,
  keyMoments?: string[],
): R5Highlight[] {
  const out: R5Highlight[] = []
  const replay = buildCourtReplay(moves ?? [])
  // 逆转时刻优先，最多取 2 个
  const reverses = replay.filter((s) => s.isReverse).slice(0, 2)
  for (const r of reverses) {
    out.push({
      text: `第${r.round}轮「${CARD_LABEL[r.card]}」翻盘，天平扭转！`,
      isReverse: true,
      round: r.round,
      quote: r.freeText,
    })
  }
  // 单步最大正向 delta 作为高光
  if (replay.length > 0) {
    const best = replay.reduce((a, b) => (b.delta > a.delta ? b : a))
    if (best.delta > 0 && !out.some((h) => h.round === best.round)) {
      out.push({
        text: `第${best.round}轮「${CARD_LABEL[best.card]}」一击定音（+${best.delta}）`,
        isReverse: false,
        round: best.round,
        quote: best.freeText,
      })
    }
  }
  // LLM 写的关键 moments 补充
  for (const km of keyMoments ?? []) {
    if (out.length >= 3) break
    out.push({ text: km, isReverse: false })
  }
  return out
}

/** 取一句「即时高光」：优先逆转时刻，否则第一条高光，否则兜底。 */
export function oneLineHighlight(highlights: R5Highlight[]): string {
  const reverse = highlights.find((h) => h.isReverse)
  if (reverse) return `⚡ 逆转：${reverse.text}`
  if (highlights.length > 0) return highlights[0].text
  return '本局已结案，再来一局冲击连胜。'
}

/**
 * 构造可分享战果卡文本。relations 非空时追加「名人关系」一行。
 */
export function buildShareCard(args: {
  scene: R5SceneId
  won: boolean
  title?: string
  score?: number
  extraLines?: string[]
  relations?: R5RelationGain[]
  streak: R5StreakState
  highlights?: R5Highlight[]
}): R5ShareCard {
  const emoji = SCENE_EMOJI[args.scene]
  const title = args.title ?? SCENE_TITLE[args.scene]
  const lines: string[] = []
  lines.push(args.won ? '🏆 本局获胜！' : '本局惜败，再接再厉。')
  if (typeof args.score === 'number') lines.push(`得分：${args.score}`)
  lines.push(streakLine(args.streak))
  const reverse = (args.highlights ?? []).find((h) => h.isReverse)
  if (reverse) lines.push(`逆转时刻：${reverse.text}`)
  for (const r of args.relations ?? []) {
    lines.push(`与${r.celebrityName}好感${r.delta > 0 ? '+' : ''}${r.delta}（${r.reason}）`)
  }
  if (args.extraLines) lines.push(...args.extraLines)
  lines.push('—— 来自「叽里呱啦 BalaBala」')
  return { title, lines, emoji }
}

/** 汇总一局为统一 PlaySessionResult 的辅助关系映射（场景→名人名）。 */
export function toSessionResult(input: {
  scene: R5SceneId
  won: boolean
  score?: number
  relations: R5RelationGain[]
  highlights: R5Highlight[]
  streak: R5StreakState
  shareExtra?: string[]
  finishedAt?: string
}): R5PlaySessionResult {
  return {
    scene: input.scene,
    won: input.won,
    score: input.score,
    relations: input.relations,
    highlights: input.highlights,
    streak: input.streak,
    shareCard: buildShareCard({
      scene: input.scene,
      won: input.won,
      score: input.score,
      relations: input.relations,
      streak: input.streak,
      highlights: input.highlights,
      extraLines: input.shareExtra,
    }),
    finishedAt: input.finishedAt ?? new Date().toISOString(),
  }
}
