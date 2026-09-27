// ============================================================================
// R5 连胜纯逻辑：按场景分别计算连胜，失败清零、最佳保留。
// 纯函数只操作 R5StreakState，localStorage 读写集中在底部（可注入 storage），
// node/vitest 下用内存 storage 跑单测，无 jsdom 依赖。
// ============================================================================
import type { R5SceneId, R5StreakState } from '@balabala/shared'

export const STREAK_STORAGE_KEY = 'balabala.r5.streaks.v1'

export function emptyStreak(): R5StreakState {
  return { current: 0, best: 0, lastPlayedAt: null }
}

const SCENE_IDS: R5SceneId[] = ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']

export function defaultStreaks(): Record<R5SceneId, R5StreakState> {
  const out = {} as Record<R5SceneId, R5StreakState>
  for (const s of SCENE_IDS) out[s] = emptyStreak()
  return out
}

export interface ApplyStreakOutcome {
  streak: R5StreakState
  /** 本局后是否刷新了历史最佳连胜。 */
  tiedBest: boolean
}

/**
 * 把一局结果应用到连胜状态：
 *  - 胜利：current+1，同步刷新 best；
 *  - 失败：current 归零（best 保留）。
 * 不原地修改入参。
 */
export function applyResult(
  streak: R5StreakState,
  won: boolean,
  nowIso: string = new Date().toISOString(),
): ApplyStreakOutcome {
  const current = won ? streak.current + 1 : 0
  const tiedBest = won && current > streak.best
  const best = Math.max(streak.best, current)
  return {
    streak: { current, best, lastPlayedAt: nowIso },
    tiedBest,
  }
}

/**
 * 「再来一局」连胜钩子文案（基于本局结算后的 streak 推导）。
 *  - 连胜中（current≥1）：当前 N 连胜，再来一局冲击 N+1；
 *  - 刚断连胜（current=0 但有最佳纪录）：下一局重回胜轨；
 *  - 从未取胜：首局开张。
 */
export function streakHint(streak: R5StreakState): string {
  if (streak.current >= 1)
    return `当前 ${streak.current} 连胜，再来一局冲击 ${streak.current + 1} 连胜！`
  if (streak.best > 0) return `连胜中断（最佳 ${streak.best}），下一局重回胜轨。`
  return '首局开张，赢下这局开启连胜。'
}

/** 战绩卡里用的连胜一行文案。 */
export function streakLine(streak: R5StreakState): string {
  if (streak.best === 0) return '暂无连胜记录'
  return `当前 ${streak.current} 连胜 · 最佳 ${streak.best} 连胜`
}

// ---------------------------------------------------------------------------
// 持久层（localStorage，node 测试环境安全降级）
// ---------------------------------------------------------------------------
function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 读取全部场景连胜；损坏/缺失时返回默认值。可注入 storage。 */
export function loadStreaks(storage?: Storage | null): Record<R5SceneId, R5StreakState> {
  const s = resolveStorage(storage)
  if (!s) return defaultStreaks()
  try {
    const raw = s.getItem(STREAK_STORAGE_KEY)
    if (!raw) return defaultStreaks()
    const parsed = JSON.parse(raw) as Partial<Record<R5SceneId, R5StreakState>>
    const out = defaultStreaks()
    for (const k of SCENE_IDS) {
      const v = parsed[k]
      if (v && typeof v.current === 'number' && typeof v.best === 'number') {
        out[k] = { current: v.current, best: v.best, lastPlayedAt: v.lastPlayedAt ?? null }
      }
    }
    return out
  } catch {
    return defaultStreaks()
  }
}

/** 写入全部场景连胜。可注入 storage；隐私模式静默忽略。 */
export function saveStreaks(
  state: Record<R5SceneId, R5StreakState>,
  storage?: Storage | null,
): void {
  const s = resolveStorage(storage)
  if (!s) return
  try {
    s.setItem(STREAK_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/**
 * 结算点入口：读档 → 应用一局 → 写档，返回新状态与是否破纪录。
 */
export function recordResult(
  scene: R5SceneId,
  won: boolean,
  storage?: Storage | null,
  nowIso?: string,
): { state: Record<R5SceneId, R5StreakState>; outcome: ApplyStreakOutcome } {
  const state = loadStreaks(storage)
  const outcome = applyResult(state[scene], won, nowIso)
  state[scene] = outcome.streak
  saveStreaks(state, storage)
  return { state, outcome }
}
