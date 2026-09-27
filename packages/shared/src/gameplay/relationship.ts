// ============================================================================
// R5 · 名人关系系统（类型 + 纯函数）
//
// 前后端共用：前端渲染关系进度条/解锁奖励，后端在结算后调用纯函数算出
// 好感度变化，再落盘到 .data/relationships/<userId>.json。
//
// 好感度 affinity ∈ [-100, 100]：正向为好感，负向为宿敌。
// 真人好友关系走 apps/api/src/friends.ts，本模块只处理「玩家 ↔ 名人」。
// ============================================================================

/** 关系档位：正向五档 + 负向宿敌档。 */
export type RelationshipType =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close'
  | 'soulmate'
  | 'rival';

/** 玩家 ↔ 单个名人的关系档案（持久化单元）。 */
export interface CelebrityRelationship {
  celebrityId: string;
  celebrityName: string;
  /** -100 ~ 100，正向好感 / 负向宿敌。 */
  affinity: number;
  type: RelationshipType;
  gamesPlayed: number;
  /** 玩家战胜该名人次数。 */
  winsAgainst: number;
  lossesAgainst: number;
  /** 对该名人的连胜（正）/连败（负）。 */
  currentStreak: number;
  bestStreak: number;
  lastPlayedAt: string | null;
  /** 已解锁的专属称号 / 开场白 / 案件等（奖励 id）。 */
  unlockedRewards: string[];
  createdAt: string;
  updatedAt: string;
}

/** 一局结算产生的关系变化（战果卡 / 飘字用）。 */
export interface RelationshipChange {
  celebrityId: string;
  /** 本局好感度变化（可正可负）。 */
  delta: number;
  fromType: RelationshipType;
  toType: RelationshipType;
  /** 人话原因，如 "关键证据命中+8" / "惜败-3" / "翻盘胜利+15"。 */
  reason: string;
  /** 本局新解锁的奖励 id（跨档时）。 */
  newUnlock?: string;
}

/** computeAffinityDelta 入参。 */
export interface AffinityDeltaInput {
  scene: string;
  result: 'win' | 'draw' | 'loss';
  /** 本局得分。 */
  score: number;
  /** 本局满分。 */
  maxScore: number;
  /** 本局高光列表（每个高光 +3）。 */
  highlights: Array<{ type: string }>;
  /** 是否翻盘局。 */
  comeback: boolean;
  /** 结算前对该名人的好感度（用于宿敌双倍判定）。 */
  opponentAffinity: number;
}

/** 把好感度夹到 [-100, 100]。 */
export function clampAffinity(affinity: number): number {
  if (Number.isNaN(affinity)) return 0;
  return Math.min(100, Math.max(-100, Math.round(affinity)));
}

/**
 * 计算一局的好感度变化（纯函数）。
 *
 * 基础：胜 +5 / 平 +2 / 负 -2；
 * 高光：每个 +3；
 * 翻盘：额外 +10；
 * 大胜：胜率 > 85% 再 +5；
 * 宿敌：当前 affinity < -30 时，胜/负的基础分翻倍（赢仇人加倍爽，输仇人加倍气）。
 */
export function computeAffinityDelta(input: AffinityDeltaInput): number {
  const { result, score, maxScore, highlights, comeback, opponentAffinity } = input;

  let base = result === 'win' ? 5 : result === 'draw' ? 2 : -2;

  // 宿敌双倍：只翻倍「胜负基础分」，高光/翻盘保持原样（避免叠加爆炸）。
  const isRival = opponentAffinity < -30;
  if (isRival && result !== 'draw') base *= 2;

  let delta = base;

  const highlightBonus = highlights.length * 3;
  delta += highlightBonus;

  if (comeback) delta += 10;

  // 大胜：得分率 > 85%（且为胜局）再补 +5。
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (result === 'win' && ratio > 0.85) delta += 5;

  return delta;
}

/**
 * 由好感度推出关系档位。
 *   affinity <= -30            → rival（宿敌，负向特殊档）
 *   affinity <  0 （且 > -30） → stranger
 *   0   <= affinity < 20       → acquaintance
 *   20  <= affinity < 40       → friend
 *   40  <= affinity < 60       → close
 *   affinity >= 60             → soulmate
 */
export function typeFromAffinity(affinity: number): RelationshipType {
  const a = clampAffinity(affinity);
  if (a <= -30) return 'rival';
  if (a < 0) return 'stranger';
  if (a < 20) return 'acquaintance';
  if (a < 40) return 'friend';
  if (a < 60) return 'close';
  return 'soulmate';
}

/**
 * 每个关系档位解锁的奖励 id（用于 RelationshipChange.newUnlock 与档案解锁列表）。
 *   acquaintance → 专属开场白（greeting）
 *   friend       → 专属称号（title）
 *   close        → 专属案件 / 话题（case）
 *   soulmate     → 搭档模式（partner_mode）
 *   stranger / rival → 无奖励
 */
export function getUnlockForType(type: RelationshipType, celebrityId: string): string | null {
  switch (type) {
    case 'acquaintance':
      return `greeting:${celebrityId}`;
    case 'friend':
      return `title:${celebrityId}`;
    case 'close':
      return `case:${celebrityId}`;
    case 'soulmate':
      return `partner_mode:${celebrityId}`;
    default:
      return null;
  }
}

/** 关系档位的展示顺序（从低到高），UI 进度条用。 */
export const RELATIONSHIP_TYPE_ORDER: RelationshipType[] = [
  'stranger',
  'acquaintance',
  'friend',
  'close',
  'soulmate',
];

/** 关系档位中文名（前端 tooltip / 战果卡用）。 */
export const RELATIONSHIP_TYPE_LABEL: Record<RelationshipType, string> = {
  stranger: '陌路',
  acquaintance: '点头之交',
  friend: '好友',
  close: '知己',
  soulmate: '灵魂搭档',
  rival: '宿敌',
};
