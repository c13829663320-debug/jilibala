// ===== R5: 记忆重要性评分（纯函数，无 React / 无 IO，便于单测） =====
// 给一段「与名人的互动摘要」打 1–5 星重要性。规则确定性、可解释，不依赖随机。
import type { MemoryImportance } from '@balabala/shared'

/** 评分输入：描述一次互动的关键信号。 */
export interface MemorySignals {
  /** 发生场景：court / talkshow / werewolf / bar / library / plaza / hall。 */
  scene?: string
  /** 是否引用/复述了名人的原话、名言或 offlineFact。 */
  containsQuote?: boolean
  /** 是否由用户主动发起的深度提问（而非路过打招呼）。 */
  userInitiatedDeep?: boolean
  /** 该话题的连续对话轮数。 */
  turnCount?: number
  /** 用户情绪强度：0 平淡 · 1 普通 · 2 强烈（激动/感动/长时停留）。 */
  emotionalIntensity?: 0 | 1 | 2
}

/**
 * 计算记忆重要性（1–5）。
 * 基础分 2，逐信号叠加，最后夹到 [1,5]：
 * - 深度场景（法庭辩论/脱口秀）+1；
 * - 引用名言 +1；
 * - 主动深问 +1；
 * - 连续 ≥6 轮 +1；
 * - 情绪强烈 +1；情绪平淡 -1。
 */
export function scoreMemoryImportance(input: MemorySignals): MemoryImportance {
  let score = 2
  const scene = (input.scene ?? '').trim()
  if (scene === 'court' || scene === 'talkshow' || scene === 'werewolf') score += 1
  if (input.containsQuote) score += 1
  if (input.userInitiatedDeep) score += 1
  if ((input.turnCount ?? 0) >= 6) score += 1
  if (input.emotionalIntensity === 2) score += 1
  else if (input.emotionalIntensity === 0) score -= 1
  const clamped = Math.max(1, Math.min(5, Math.round(score)))
  return clamped as MemoryImportance
}

/** 取重要性的中文描述。 */
export const MEMORY_IMPORTANCE_LABEL: Record<MemoryImportance, string> = {
  1: '萍水相逢',
  2: '一面之缘',
  3: '值得记住',
  4: '印象深刻',
  5: '刻骨铭心',
}
