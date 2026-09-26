// ===== M14: 健身房 90 秒三关电路（Circuit）纯逻辑 =====
// 三关迷你游戏是前端权威（纯前端计时/计分），本模块只放**无副作用的计分/判定纯函数**，
// 前后端与单测共用。不依赖 DOM / DB / LLM。

export type MiniGameKind = "reaction" | "rhythm" | "power";

export type CircuitTier = "bronze" | "silver" | "gold" | "explosive";

/** 单关结束后回传给编排器 / 教练点评的结果摘要。 */
export interface StationResult {
  kind: MiniGameKind;
  hits: number;
  misses: number;
  /** reaction：最快反应毫秒 */
  bestMs?: number;
  /** rhythm：最高连击 */
  maxCombo?: number;
  /** power：三次尝试中最好的力量值（0-100） */
  bestPower?: number;
  score: number;
  /** 名人教练异步点评（LLM，可空） */
  coachNote?: string;
}

/** 三关总分。 */
export function circuitTotalScore(results: Array<Pick<StationResult, "score">>): number {
  return results.reduce((sum, r) => sum + r.score, 0);
}

// ===== 关 1：反应 ReactionTap =====

/**
 * 命中计分：反应越快分越高，慢于 150ms 后线性衰减，保底 50 分。
 * score = max(50, 200 - reactionMs)。
 */
export function scoreReactionHit(reactionMs: number): number {
  const ms = Math.max(0, Math.round(reactionMs));
  return Math.max(50, 200 - ms);
}

// ===== 关 2：节奏 RhythmTap =====

export type RhythmGrade = "perfect" | "good" | "miss";

/** 按击键与中线的时间偏移（毫秒，可正可负）判定档位。 */
export function judgeRhythm(offsetMs: number): RhythmGrade {
  const abs = Math.abs(offsetMs);
  if (abs <= 50) return "perfect";
  if (abs <= 150) return "good";
  return "miss";
}

/**
 * 单次节奏点击得分。
 * - Perfect 30 分，且连击（连续 Perfect）越高加成越多：base × (1 + comboBefore*0.1)
 * - Good 15 分，Miss 0 分。comboBefore = 本次命中前已连续 Perfect 的个数。
 */
export function rhythmPoints(grade: RhythmGrade, comboBefore: number): number {
  if (grade === "perfect") {
    return Math.round(30 * (1 + Math.max(0, comboBefore) * 0.1));
  }
  if (grade === "good") return 15;
  return 0;
}

// ===== 关 3：力量 PowerHold =====

/** 蓄力条松开时落在 [0,100]，绿色目标区中心 85（区间 80-90）。 */
export const POWER_TARGET_CENTER = 85;

/** 松开位置 pct → 力量值（0-100）。越靠近 85 越高。 */
export function powerValue(releasePct: number): number {
  const p = Math.min(100, Math.max(0, releasePct));
  return Math.max(0, Math.round(100 - Math.abs(p - POWER_TARGET_CENTER)));
}

/** 三次取最好，bestPower × 10 为本关得分。 */
export function scorePower(bestPower: number): number {
  return Math.round(Math.max(0, Math.min(100, bestPower)) * 10);
}

// ===== 段位 =====

/** 青铜(<2000) / 白银(2000-3000) / 黄金(3000-4000) / 爆杆(>=4000)。 */
export function getCircuitTier(totalScore: number): CircuitTier {
  if (totalScore < 2000) return "bronze";
  if (totalScore < 3000) return "silver";
  if (totalScore < 4000) return "gold";
  return "explosive";
}

export const CIRCUIT_TIER_META: Record<CircuitTier, { label: string; emoji: string }> = {
  bronze: { label: "青铜", emoji: "🥉" },
  silver: { label: "白银", emoji: "🥈" },
  gold: { label: "黄金", emoji: "🥇" },
  explosive: { label: "爆杆", emoji: "💥" },
};

/** 今日三关的静态展示元数据（前端 CircuitSelector 用）。 */
export const CIRCUIT_STATIONS: Array<{
  kind: MiniGameKind;
  title: string;
  durationSec: number;
  goal: string;
  tips: string;
}> = [
  { kind: "reaction", title: "反应关", durationSec: 30, goal: "手眼反应", tips: "绿圈出现 1.5 秒内点中，越快分越高，漏点掉血" },
  { kind: "rhythm", title: "节奏关", durationSec: 45, goal: "节拍稳定", tips: "音符滚到中线时按空格，连续 Perfect 有连击加成" },
  { kind: "power", title: "力量关", durationSec: 20, goal: "爆发时机", tips: "蓄力条进入绿色 80-90% 时松开，3 次取最好" },
];
