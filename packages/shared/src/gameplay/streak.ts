// ============================================================================
// R5 · 连胜 / 翻盘追踪（纯函数）
//
// currentStreak 可正可负：正=连胜，负=连败。bestStreak 只记录连胜峰值。
// 翻盘在结算时由整局得分轨迹判定：过程中曾跌入 30% 以下，最终反超到 50% 以上。
// ============================================================================

import type { MatchStats } from '../index.js';

/** 一局后更新战绩快照（played/wins/currentStreak/bestStreak）。 */
export function updateStreak(
  stats: MatchStats | undefined,
  result: 'win' | 'draw' | 'loss',
): MatchStats {
  const base: MatchStats = stats ?? { played: 0, wins: 0, bestStreak: 0, currentStreak: 0 };

  let currentStreak: number;
  if (result === 'win') {
    currentStreak = Math.max(0, base.currentStreak) + 1;
  } else if (result === 'loss') {
    currentStreak = Math.min(0, base.currentStreak) - 1;
  } else {
    currentStreak = 0;
  }

  // bestStreak 只追踪连胜峰值（连败不计入 best）。
  const bestStreak =
    result === 'win' ? Math.max(base.bestStreak, currentStreak) : base.bestStreak;

  return {
    played: base.played + 1,
    wins: base.wins + (result === 'win' ? 1 : 0),
    bestStreak,
    currentStreak,
  };
}

/**
 * 连胜加成：3 连胜 +5，5 连胜 +10，7 连胜 +20；连败无惩罚。
 * currentStreak <= 0 一律返回 0。
 */
export function getStreakBonus(currentStreak: number): number {
  const n = Math.max(0, currentStreak);
  if (n >= 7) return 20;
  if (n >= 5) return 10;
  if (n >= 3) return 5;
  return 0;
}

/**
 * 翻盘检测：对局得分轨迹中，任何一刻 score/maxScore < 0.30，
 * 且最终 finalScore/maxScore > 0.50，即判定为翻盘。
 *
 * @param scoreHistory 对局中每个记录点的绝对得分（含起点）。
 * @param finalScore    终局得分。
 * @param maxScore      满分。
 */
export function detectComeback(
  scoreHistory: number[],
  finalScore: number,
  maxScore: number,
): boolean {
  if (maxScore <= 0) return false;
  const finalRatio = finalScore / maxScore;
  if (finalRatio <= 0.5) return false;
  return scoreHistory.some((s) => s / maxScore < 0.3);
}
