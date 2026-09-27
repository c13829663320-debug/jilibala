/**
 * R5 分片C · 招牌体验快车道（名人对话）纯逻辑
 * ------------------------------------------------------------------
 * 与 React / three 解耦：纯函数 + 可注入数据，便于 node 环境 vitest 单测。
 *
 * 职责：
 *  - 从本地 CELEBRITIES 里挑一位「快车道推荐名人」（默认苏格拉底/爱因斯坦…）
 *  - 归一化出一张快车道卡片所需的数据（id/name/title/greeting/portrait）
 *  - API 不可用时的降级：greeting 缺失则用默认文案，portrait 缺失由组件层兜底
 */
import { CELEBRITIES, type Celebrity } from '@balabala/shared'

/** 快车道优先推荐的名人 id 顺序（找到第一个存在的即用）。 */
export const RECOMMENDED_QUICK_CHAT_IDS: string[] = [
  'socrates',
  'albert-einstein',
  'confucius',
]

/** 本地数据里实在拿不到开场白时的兜底文案（降级展示用）。 */
export const FALLBACK_GREETING =
  '你好呀，我在这里。随便聊聊吧——没有蠢问题，只有还没想清楚的问题。'

/** 归一化后的快车道卡片数据（保证字段非空，UI 层无需再判空）。 */
export interface QuickChatCard {
  celebrityId: string
  name: string
  title: string
  /** 开场白（一定非空：缺了用 FALLBACK_GREETING）。 */
  greeting: string
  portrait: string
  field: string
}

/**
 * 挑选快车道推荐名人。
 * @param preferredIds 自定义优先顺序；默认 RECOMMENDED_QUICK_CHAT_IDS
 * @param pool 名人池；默认本地 CELEBRITIES（测试可注入空/子集）
 * @returns 一定返回一位名人；池为空时返回 undefined（由组件层决定是否渲染）
 */
export function pickQuickChatCelebrity(
  preferredIds: string[] = RECOMMENDED_QUICK_CHAT_IDS,
  pool: Celebrity[] = CELEBRITIES,
): Celebrity | undefined {
  for (const id of preferredIds) {
    const hit = pool.find((c) => c.id === id)
    if (hit) return hit
  }
  return pool[0]
}

/** 取开场白：非空去空白；否则降级为默认文案。 */
export function resolveGreeting(c: Celebrity): string {
  const g = (c.greeting ?? '').trim()
  return g.length > 0 ? g : FALLBACK_GREETING
}

/** 归一化为 UI 卡片数据（降级安全：portrait 可能为空字符串，由 <img onError> 兜底）。 */
export function buildQuickChatCard(c: Celebrity): QuickChatCard {
  return {
    celebrityId: c.id,
    name: c.name,
    title: c.title,
    greeting: resolveGreeting(c),
    portrait: c.portrait ?? '',
    field: c.field,
  }
}

/**
 * 快车道一键直达：挑名人 + 归一化卡片。
 * 任何一步失败（池为空）都不抛错，返回 null，由组件层隐藏入口。
 */
export function prepareQuickChatCard(
  preferredIds?: string[],
  pool?: Celebrity[],
): QuickChatCard | null {
  try {
    const celeb = pickQuickChatCelebrity(preferredIds, pool)
    if (!celeb) return null
    return buildQuickChatCard(celeb)
  } catch {
    return null
  }
}
