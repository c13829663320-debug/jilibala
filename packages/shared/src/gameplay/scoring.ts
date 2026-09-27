// ============================================================================
// 计分与段位 —— 纯函数，无副作用，前后端共用。
// 段位四档阈值（统一，文案按场景换壳）：
//   novice  <30%   adept 30-60%   expert 60-85%   master >85%
// ============================================================================

import type { Tier, TierLevel } from './types.js';

/** 把数值夹到 [min, max]。 */
export function clampScore(score: number, min: number, max: number): number {
  if (Number.isNaN(score)) return min;
  return Math.min(max, Math.max(min, score));
}

/**
 * 根据本局得分 / 满分计算段位。
 * 边界：ratio === 0.30 归入 adept；=== 0.60 归入 expert；=== 0.85 归入 master。
 */
export function computeTier(
  score: number,
  maxScore: number,
  tierLabels: Record<TierLevel, string>,
): Tier {
  const ratio = maxScore <= 0 ? 0 : clampScore(score / maxScore, 0, 1);

  let level: TierLevel;
  if (ratio < 0.3) level = 'novice';
  else if (ratio < 0.6) level = 'adept';
  else if (ratio < 0.85) level = 'expert';
  else level = 'master';

  return {
    level,
    label: tierLabels[level],
    score,
    percentile: Math.round(ratio * 100),
  };
}

/**
 * 排位分变动。
 * 基础：win +25 / draw +10 / loss -15。
 * 对手分差修正：5 分内不修正；超出 5 分的部分每 100 分 ±2。
 *   - 赢比自己强的对手 → 加分；赢比自己弱的对手 → 减分。
 *   - 输给比自己弱的对手 → 多扣；输给比自己强的对手 → 少扣。
 */
export function computeRankPoints(
  result: 'win' | 'draw' | 'loss',
  currentRank: number,
  opponentRank?: number,
): number {
  const base = result === 'win' ? 25 : result === 'draw' ? 10 : -15;
  if (opponentRank === undefined || result === 'draw') return base;

  const diff = opponentRank - currentRank; // >0 表示对手更强
  const excess = Math.max(0, Math.abs(diff) - 5);
  const magnitude = Math.floor(excess / 100) * 2;
  const sign = Math.sign(diff);

  // 与 Elo 同构：赢强者加分多 / 赢弱者加分少；
  // 输强者扣分少 / 输弱者扣分多 —— 均由 sign(diff) 决定方向。
  const modifier = sign * magnitude;

  return base + modifier;
}

/** 连胜加成。3 连胜 +5，5 连胜 +10，7 连胜 +20。 */
export function computeStreak(
  consecutiveWins: number,
): { bonus: number; label: string } {
  const n = Math.max(0, consecutiveWins);
  if (n >= 7) return { bonus: 20, label: '七连胜' };
  if (n >= 5) return { bonus: 10, label: '五连胜' };
  if (n >= 3) return { bonus: 5, label: '三连胜' };
  return { bonus: 0, label: '' };
}
