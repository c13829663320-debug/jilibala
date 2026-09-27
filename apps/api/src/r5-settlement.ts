// ============================================================================
// R5 · 结算演出落库桥（talkshow / werewolf / bar 三场景共用）
//
// 引擎层只产出「结算元数据」（谁是对手、胜/平/负、得分、高光、翻盘），
// 本模块负责：
//   1) 对每个对手名人调用 computeAffinityDelta + applyRelationshipChange 落库；
//   2) 用 updateStreak 更新 ServerProfile.stats[scene] 的连胜/连败；
//   3) 用 buildResultCard 拼出战果卡。
//
// 纯同步（文件 IO），路由在一局结束后调用一次，结果缓存进 session。
// ============================================================================
import {
  buildResultCard,
  computeAffinityDelta,
  updateStreak,
  type GameResult,
  type Highlight,
  type RelationshipChange,
  type ResultCardData,
  type SceneStatsKey,
  type SettlementType,
} from "@balabala/shared";
import { applyRelationshipChange, getRelationship } from "./relationship.js";
import { loadServerProfile, saveServerProfile } from "./db.js";

/** 引擎上报的单个对手名人。 */
export interface R5Opponent {
  celebrityId: string;
  name: string;
  reason: string;
}

/** 引擎 collectR5Meta 的形状（三场景引擎各自实现，结构一致）。 */
export interface R5Meta {
  outcome: "win" | "draw" | "loss";
  score: number;
  maxScore: number;
  highlights: Highlight[];
  comeback: boolean;
  settlementType: SettlementType;
  opponents: R5Opponent[];
  primaryOpponent: { id: string; name: string; type: "celebrity" | "human" | "ai" };
}

/** 返回给前端的结算演出包。 */
export interface R5Bundle {
  relationshipChanges: RelationshipChange[];
  highlights: Highlight[];
  streak: { current: number; best: number; isNewBest: boolean };
  resultCard: ResultCardData;
  comeback: boolean;
  settlementType: SettlementType;
}

/**
 * 把一局结算落库：关系变化 + 连胜 + 战果卡。
 * @param userId    真人 id（空字符串时跳过持久化，只算战果卡，便于测试/演示）。
 * @param scene     六场景 id。
 * @param gameResult 引擎 settle() 返回的 GameResult。
 * @param meta      引擎 collectR5Meta() 返回的元数据。
 */
export function applyR5Settlement(
  userId: string,
  scene: SceneStatsKey,
  gameResult: GameResult,
  meta: R5Meta,
): R5Bundle {
  // 1) 关系变化：读当前好感度 → 算 delta → 落库。
  const relationshipChanges: RelationshipChange[] = [];
  if (userId) {
    for (const opp of meta.opponents) {
      const existing = getRelationship(userId, opp.celebrityId);
      const delta = computeAffinityDelta({
        scene,
        result: meta.outcome,
        score: meta.score,
        maxScore: meta.maxScore,
        highlights: meta.highlights,
        comeback: meta.comeback,
        opponentAffinity: existing?.affinity ?? 0,
      });
      const change = applyRelationshipChange(userId, opp.celebrityId, {
        delta,
        reason: opp.reason,
        result: meta.outcome,
      });
      relationshipChanges.push(change);
    }
  }

  // 2) 连胜：读 ServerProfile.stats[scene] → updateStreak → 写回。
  let streak: R5Bundle["streak"] = { current: 0, best: 0, isNewBest: false };
  if (userId) {
    const profile = loadServerProfile(userId);
    const prev = profile.stats?.[scene];
    const nextStats = updateStreak(prev, meta.outcome);
    profile.stats = { ...(profile.stats ?? {}), [scene]: nextStats };
    saveServerProfile(profile);
    streak = {
      current: nextStats.currentStreak,
      best: nextStats.bestStreak,
      // 新纪录：本连胜超过历史最佳。
      isNewBest: meta.outcome === "win" && nextStats.currentStreak > (prev?.bestStreak ?? 0),
    };
  } else {
    // 无用户：按 outcome 推算一个示意值（不写库）。
    streak = {
      current: meta.outcome === "win" ? 1 : meta.outcome === "loss" ? -1 : 0,
      best: meta.outcome === "win" ? 1 : 0,
      isNewBest: false,
    };
  }

  // 3) 战果卡。
  const resultCard = buildResultCard({
    scene,
    result: gameResult,
    highlights: meta.highlights,
    relationshipChanges,
    streak: { current: streak.current, best: streak.best },
    opponent: meta.primaryOpponent,
    outcome: meta.outcome,
    settlementType: meta.settlementType,
    score: meta.score,
    maxScore: meta.maxScore,
  });

  return {
    relationshipChanges,
    highlights: meta.highlights,
    streak,
    resultCard,
    comeback: meta.comeback,
    settlementType: meta.settlementType,
  };
}
