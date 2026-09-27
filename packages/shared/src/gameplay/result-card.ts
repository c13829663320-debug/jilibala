// ============================================================================
// R5 · 战果卡（Result Card）
//
// 一局结束后的「分享卡片」数据模型：纯数据拼装，渲染留给前端。
// buildResultCard 从 GameResult + 高光 + 关系变化 + 连胜汇总出一张卡；
// resultCardToText 生成可复制分享文案；resultCardToSharePrompt 生成配图 prompt。
// ============================================================================

import type { GameResult, Tier } from './types.js';
import type { Highlight, SettlementType } from './base-orchestrator.js';
import type { RelationshipChange } from './relationship.js';
import { formatHighlightDescription } from './highlights.js';
import { RELATIONSHIP_TYPE_LABEL } from './relationship.js';

/** 战果卡聚合数据（前端一张卡渲染全部内容）。 */
export interface ResultCardData {
  scene: string;
  sceneLabel: string;
  result: 'win' | 'draw' | 'loss';
  settlementType: SettlementType;
  score: number;
  maxScore: number;
  tier: { level: string; label: string };
  rankPoints: number;
  streak: { current: number; best: number; isNewBest: boolean };
  highlights: Highlight[];
  relationshipChanges: RelationshipChange[];
  opponent: { id: string; name: string; type: 'celebrity' | 'human' | 'ai' };
  durationMs: number;
  playedAt: string;
}

/** buildResultCard 入参。 */
export interface ResultCardInput {
  scene: string;
  result: GameResult;
  highlights: Highlight[];
  relationshipChanges: RelationshipChange[];
  streak: { current: number; best: number };
  opponent: { id: string; name: string; type: string };
  /** 可选：玩家视角胜/平/负（不传则由 winner 推断）。 */
  outcome?: 'win' | 'draw' | 'loss';
  /** 可选：结算演出类型（不传则由分率推断）。 */
  settlementType?: SettlementType;
  /** 可选：玩家得分（不传用 tier.score）。 */
  score?: number;
  /** 可选：满分（不传由 tier.percentile 反推）。 */
  maxScore?: number;
}

/** 六场景中文标签（避免与 index.ts 产生循环依赖）。 */
const SCENE_LABELS: Record<string, string> = {
  court: '趣味法庭',
  talkshow: '脱口秀剧场',
  werewolf: '狼人杀馆',
  bar: '酒吧辩论',
  gym: '健身房',
  library: '图书馆',
};

/** 结算演出类型 → 文案。 */
const SETTLEMENT_LABEL: Record<SettlementType, string> = {
  big_win: '大胜！',
  narrow_win: '小胜',
  comeback_win: '逆风翻盘！',
  draw: '平局',
  narrow_loss: '惜败',
  big_loss: '惨败',
};

function resolveOutcome(gameResult: GameResult, outcome?: 'win' | 'draw' | 'loss'): 'win' | 'draw' | 'loss' {
  if (outcome) return outcome;
  if (gameResult.winner === null || gameResult.winner === undefined) return 'draw';
  // 无显式 outcome 时，有胜方即按胜处理（具体阵营胜负由调用方覆盖）。
  return 'win';
}

function inferSettlementType(
  outcome: 'win' | 'draw' | 'loss',
  ratio: number,
): SettlementType {
  if (outcome === 'draw') return 'draw';
  if (outcome === 'win') {
    if (ratio > 0.85) return 'big_win';
    return 'narrow_win';
  }
  return ratio >= 0.45 && ratio < 0.5 ? 'narrow_loss' : 'big_loss';
}

/** 拼装战果卡。 */
export function buildResultCard(input: ResultCardInput): ResultCardData {
  const { result: gameResult, highlights, relationshipChanges, streak } = input;

  const tier: Tier = gameResult.tier;
  const score = input.score ?? tier.score;
  const percentile = tier.percentile / 100;
  const maxScore =
    input.maxScore ?? (percentile > 0 ? Math.round(score / percentile) : Math.max(score, 100));
  const ratio = maxScore > 0 ? score / maxScore : 0;

  const outcome = resolveOutcome(gameResult, input.outcome);
  const settlementType = input.settlementType ?? inferSettlementType(outcome, ratio);

  const isNewBest = streak.current > 0 && streak.current >= streak.best;

  return {
    scene: input.scene,
    sceneLabel: SCENE_LABELS[input.scene] ?? input.scene,
    result: outcome,
    settlementType,
    score,
    maxScore,
    tier: { level: tier.level, label: tier.label },
    rankPoints: gameResult.rankPoints,
    streak: { current: streak.current, best: streak.best, isNewBest },
    highlights,
    relationshipChanges,
    opponent: {
      id: input.opponent.id,
      name: input.opponent.name,
      type:
        input.opponent.type === 'celebrity' || input.opponent.type === 'human'
          ? input.opponent.type
          : 'ai',
    },
    durationMs: gameResult.durationMs,
    playedAt: new Date().toISOString(),
  };
}

/** 战果卡 → 可复制分享文案（纯文本）。 */
export function resultCardToText(card: ResultCardData): string {
  const lines: string[] = [];
  lines.push(`【叽里呱啦 · ${card.sceneLabel}】`);
  lines.push(`${SETTLEMENT_LABEL[card.settlementType]}（${card.tier.label}）`);
  lines.push(`得分 ${card.score}/${card.maxScore} · 排位分 ${card.rankPoints >= 0 ? '+' : ''}${card.rankPoints}`);
  if (card.streak.current > 0) {
    lines.push(`当前 ${card.streak.current} 连胜${card.streak.isNewBest ? '（新纪录！）' : ''}`);
  } else if (card.streak.current < 0) {
    lines.push(`当前 ${Math.abs(card.streak.current)} 连败`);
  }
  if (card.highlights.length > 0) {
    lines.push('高光：');
    for (const h of card.highlights) lines.push(`  · ${formatHighlightDescription(h)}`);
  }
  for (const c of card.relationshipChanges) {
    lines.push(
      `与「${card.opponent.name}」关系：${RELATIONSHIP_TYPE_LABEL[c.toType]}（${c.delta >= 0 ? '+' : ''}${c.delta}）`,
    );
  }
  return lines.join('\n');
}

/** 战果卡 → 生成分享配图的 prompt（交给文生图模型）。 */
export function resultCardToSharePrompt(card: ResultCardData): string {
  const mood =
    card.result === 'win'
      ? 'victorious, celebratory, golden light'
      : card.result === 'draw'
        ? 'neutral, balanced'
        : 'reflective, cool blue tones';
  const hl = card.highlights.map((h) => h.description).join('、') || '精彩对局';
  return `A stylized mobile game result card illustration for a Chinese social party game, scene=${card.sceneLabel}, outcome=${SETTLEMENT_LABEL[card.settlementType]}, score ${card.score}/${card.maxScore}, tier ${card.tier.label}. Mood: ${mood}. Highlight moments: ${hl}. Opponent: ${card.opponent.name}. Clean flat illustration, vibrant colors, celebratory confetti for wins, no text, 3:4 portrait.`;
}
