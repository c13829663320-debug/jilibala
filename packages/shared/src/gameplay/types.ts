// ============================================================================
// 叽里呱啦 · 共享玩法基础层 —— 核心类型
// 六场景（court/talkshow/werewolf/bar/gym/library）共用的最小契约。
// 本文件只放类型，不放运行时逻辑。
// ============================================================================

/** 六场景 id，每日挑战 / 路由 / 埋点统一用它。 */
export type SceneId =
  | 'court'
  | 'talkshow'
  | 'werewolf'
  | 'bar'
  | 'gym'
  | 'library';

/**
 * 通用游戏阶段。六场景在自己的 orchestrator 里可以有更细的子 stage，
 * 但主阶段流转必须落在这 6 档上，方便断线重连 / 前端统一渲染壳。
 */
export type GamePhase =
  | 'lobby'
  | 'setup'
  | 'playing'
  | 'round'
  | 'feedback'
  | 'results';

/**
 * 玩家槽位：真人占关键位（slot index 0），AI 填充其余。
 * 一个槽位要么是真人（isHuman=true, userId 有值），要么是 AI（aiPersona 有值）。
 */
export interface PlayerSlot {
  slotId: string;
  /** 场景内角色名，如 'defendant' / 'performer' / 'werewolf' / 'opponent'。 */
  role: string;
  isHuman: boolean;
  /** 真人时填。 */
  userId?: string;
  /** AI 时填名人 id 或 persona 标识。 */
  aiPersona?: string;
  nickname: string;
  score: number;
  /** 是否仍在局内（出局=false 但保留观战）。 */
  active: boolean;
}

/**
 * 通用游戏事件。场景可扩展 type 字符串与 payload 形状，
 * 编排器统一通过它推 WS / 前端订阅。
 */
export interface GameEvent {
  /** 如 'balance_update' / 'joke_scored' / 'day_action' / 'score_added'。 */
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

/** 统一段位（四档，文案按场景换壳）。 */
export type TierLevel = 'novice' | 'adept' | 'expert' | 'master';

export interface Tier {
  level: TierLevel;
  /** 场景化文案，如 '菜鸟律师' / '金牌大状'。 */
  label: string;
  /** 本局得分。 */
  score: number;
  /** 0-100，本局得分占满分的百分比。 */
  percentile: number;
}

/** 一局结算结果。 */
export interface GameResult {
  /** slotId 或阵营名（如 'wolf' / 'good'）；平局为 null。 */
  winner: string | null;
  /** slotId -> 本局得分。 */
  scores: Record<string, number>;
  tier: Tier;
  rankPoints: number;
  /** 高光时刻文案，用于复盘回放。 */
  highlights: string[];
  durationMs: number;
}

/** 回合 / 行动计时。 */
export interface TimerState {
  durationMs: number;
  /** epoch ms，倒计时截止时刻。 */
  endsAt: number;
  /** 剩余 ms（读取时快照）。 */
  remainingMs: number;
}

/** 新手引导单步。 */
export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  /** UI 元素选择器或标识，前端据此高亮。 */
  target?: string;
  /** 是否自动前进（无需玩家点下一步）。 */
  autoAdvance?: boolean;
}
