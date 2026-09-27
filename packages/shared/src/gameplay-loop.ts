// ============================================================================
// R5 招牌玩法 / 核心循环 —— 统一长期目标线与结算契约
//
// 设计原则（严格 additive，不改他人已有定义）：
//   - 长期目标线收敛为「名人关系网收集 + 段位成长」；段位成长已由 web 侧
//     playerProfile.ts 承担（XP/等级/成就/每日挑战），本文件只补关系网与
//     跨玩法统一结算战果结构，供名人域 / 广场域 / 统一结算面板消费。
//   - 各玩法结算时统一产出 R5PlaySessionResult，不再各自为政。
//   - 所有类型以 R5 前缀命名，避免与既有导出名冲突。
// ============================================================================

/** 六大玩法场景 id（与 web SceneId 对齐；shared 侧独立 union，避免反向改 web）。 */
export type R5SceneId =
  | 'court'
  | 'talkshow'
  | 'werewolf'
  | 'bar'
  | 'gym'
  | 'library'

/** 与某位名人的关系进展（好感 +N）。一局可与多位名人产生关系变化。 */
export interface R5RelationGain {
  /** 名人 id（对应 celebrities.ts 的 id；纯展示场景可传空串）。 */
  celebrityId: string
  celebrityName: string
  /** 本局好感增量：通常 +1；负数=关系紧张/结梁子。 */
  delta: number
  /** 一句话原因，如「当庭击败李白」「脱口秀把纪晓岚逗笑了」。 */
  reason: string
}

/** 单局高光：即时高光一句话回顾；带「逆转时刻」标签，可逐步回放。 */
export interface R5Highlight {
  /** 高光短文案。 */
  text: string
  /** 是否为「逆转时刻」（劣势翻盘 / 天平瞬间反转）。 */
  isReverse: boolean
  /** 关联轮次（法庭 round / 狼人 day 等，可选）。 */
  round?: number
  /** 名场面引用：玩家打出的关键牌/金句原文。 */
  quote?: string
}

/** 单场景连胜状态（跨局持久化）。 */
export interface R5StreakState {
  /** 当前连胜（失败清零）。 */
  current: number
  /** 历史最佳连胜。 */
  best: number
  /** 最近一次结算时间 ISO 字符串；从未玩过为 null。 */
  lastPlayedAt: string | null
}

/** 可分享战果卡（纯文本，便于复制 / 后续生成战绩图）。 */
export interface R5ShareCard {
  /** 卡片标题，如「我的法庭判决书」。 */
  title: string
  /** 正文每行一条。 */
  lines: string[]
  /** 主 emoji，用于卡片视觉。 */
  emoji: string
}

/**
 * 一局结算后统一产出的战果结构。
 * 各玩法（法庭/狼人/酒吧/脱口秀/健身房/图书馆）在结算点构造此对象，
 * 喂给：名人关系域（relations）、广场域（shareCard）、统一结算面板（全字段）。
 */
export interface R5PlaySessionResult {
  scene: R5SceneId
  /** 本局是否获胜（冷场/平局/失败一律 false）。 */
  won: boolean
  /** 该场景代表性分数（可选）。 */
  score?: number
  /** 本局与哪些名人产生了关系进展。 */
  relations: R5RelationGain[]
  /** 本局高光（含逆转标签）。 */
  highlights: R5Highlight[]
  /** 本局结算后的连胜快照。 */
  streak: R5StreakState
  /** 可分享战果卡。 */
  shareCard: R5ShareCard
  /** 本局结束时间 ISO。 */
  finishedAt: string
}

/**
 * 长期目标线聚合进度：名人关系网收集 + 连胜网络。
 * 名人关系域可在此基础上叠加好友度明细 / 羁绊等级。
 */
export interface R5LongTermGoal {
  /** 已「结识」（好感累计 > 0）的名人 id 集合。 */
  metCelebrityIds: string[]
  /** 关系网总好感值（所有名人好感累加，可为负）。 */
  totalAffinity: number
  /** 各场景当前/最佳连胜。 */
  streaks: Record<R5SceneId, R5StreakState>
  /** 累计完成局数。 */
  totalSessions: number
}

/** 把一条 R5ShareCard 序列化成可直接复制/粘贴的纯文本。 */
export function r5ShareCardToText(card: R5ShareCard): string {
  const head = `${card.emoji} ${card.title}`
  return [head, ...card.lines].join('\n')
}
