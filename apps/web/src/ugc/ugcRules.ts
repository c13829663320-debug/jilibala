// ============================================================================
// 自定义小游戏规则（表单式配置，纯函数校验/默认值/序列化）
// ============================================================================
import type { UGCError } from '@balabala/shared'

/** 胜利条件。 */
export type WinCondition = 'most-points' | 'first-to-finish' | 'survive'

/** 一局小游戏的规则配置。 */
export interface UgcGameRules {
  /** 回合数（1–20） */
  rounds: number
  /** 胜利条件 */
  winCondition: WinCondition
  /** 最少参与人数（1–8） */
  minPlayers: number
  /** 最多参与人数（1–8） */
  maxPlayers: number
  /** 每回合秒数（10–120） */
  secondsPerRound: number
}

/** 默认规则。 */
export function defaultRules(): UgcGameRules {
  return {
    rounds: 3,
    winCondition: 'most-points',
    minPlayers: 1,
    maxPlayers: 4,
    secondsPerRound: 30,
  }
}

const WIN_CONDITIONS: readonly WinCondition[] = ['most-points', 'first-to-finish', 'survive']

/** 规则校验：返回错误列表（空 = 通过）。 */
export function validateRules(r: Partial<UgcGameRules> | null | undefined): UGCError[] {
  const errors: UGCError[] = []
  if (!r) {
    errors.push({ code: 'invalid_rules', message: '规则配置为空', retryable: false })
    return errors
  }
  if (typeof r.rounds !== 'number' || !Number.isFinite(r.rounds) || r.rounds < 1 || r.rounds > 20) {
    errors.push({ code: 'invalid_rules', message: '回合数需在 1–20 之间', retryable: false })
  }
  if (r.winCondition !== undefined && !WIN_CONDITIONS.includes(r.winCondition)) {
    errors.push({ code: 'invalid_rules', message: '未知的胜利条件', retryable: false })
  }
  const min = r.minPlayers ?? 0
  const max = r.maxPlayers ?? 0
  if (typeof min !== 'number' || min < 1 || min > 8) {
    errors.push({ code: 'invalid_rules', message: '最少人数需在 1–8 之间', retryable: false })
  }
  if (typeof max !== 'number' || max < 1 || max > 8) {
    errors.push({ code: 'invalid_rules', message: '最多人数需在 1–8 之间', retryable: false })
  }
  if (typeof min === 'number' && typeof max === 'number' && max < min) {
    errors.push({ code: 'invalid_rules', message: '最多人数不能少于最少人数', retryable: false })
  }
  if (r.secondsPerRound !== undefined &&
    (typeof r.secondsPerRound !== 'number' || r.secondsPerRound < 10 || r.secondsPerRound > 120)) {
    errors.push({ code: 'invalid_rules', message: '每回合秒数需在 10–120 之间', retryable: false })
  }
  return errors
}

/** 把用户表单部分规则补全为完整规则（越界/缺省用默认值夹紧）。 */
export function normalizeRules(input: Partial<UgcGameRules>): UgcGameRules {
  const d = defaultRules()
  const clamp = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback
  const win: WinCondition = input.winCondition && WIN_CONDITIONS.includes(input.winCondition)
    ? input.winCondition : d.winCondition
  const minPlayers = clamp(input.minPlayers, 1, 8, d.minPlayers)
  let maxPlayers = clamp(input.maxPlayers, 1, 8, d.maxPlayers)
  if (maxPlayers < minPlayers) maxPlayers = minPlayers
  return {
    rounds: clamp(input.rounds, 1, 20, d.rounds),
    winCondition: win,
    minPlayers,
    maxPlayers,
    secondsPerRound: clamp(input.secondsPerRound, 10, 120, d.secondsPerRound),
  }
}

/** 序列化为字符串（存入场景草稿 props 旁的 meta）。 */
export function serializeRules(r: UgcGameRules): string {
  return JSON.stringify(r)
}

/** 反序列化；失败回退默认规则。 */
export function parseRules(s: string | undefined | null): UgcGameRules {
  if (!s) return defaultRules()
  try {
    const obj = JSON.parse(s) as Partial<UgcGameRules>
    return normalizeRules(obj)
  } catch {
    return defaultRules()
  }
}
