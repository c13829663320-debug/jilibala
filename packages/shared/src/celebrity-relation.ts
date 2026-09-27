// ===== R5: 名人关系 / 记忆 / 解锁 / 邀约 / 广场偶遇 =====
// 全部为 additive 类型：不改动其他域已有定义。
// 核心策略：名人是「可收集资产」——从静态卡片升级为有记忆、有关系、可收集、可邀约的活资产。
//
// 持久化：纯前端 localStorage（见 apps/web/src/celebrity/useCelebrityRelation.ts），
// 服务端不存关系数据；玩法域（法庭/狼人杀/脱口秀）消费 CelebrityInvite 即可把名人拉进参与者列表。

/** 结识档位：从未谋面 → 相识 → 朋友 → 知己。 */
export type AcquaintanceLevel = "stranger" | "acquainted" | "friend" | "confidant";

/** 关系档位的中文展示名。 */
export const ACQUAINTANCE_LEVEL_LABEL: Record<AcquaintanceLevel, string> = {
  stranger: "陌生人",
  acquainted: "已结识",
  friend: "朋友",
  confidant: "知己",
};

/**
 * 与某位名人的关系档案。
 * - stranger：从未互动（一般不落地，查询时缺省即 stranger）；
 * - acquainted：完成首次对话/同台后自动升级；
 * - friend / confidant：随好感度（affection）累积解锁。
 */
export interface CelebrityRelation {
  celebrityId: string;
  acquaintanceLevel: AcquaintanceLevel;
  /** 好感度 0–100。 */
  affection: number;
  /** 已解锁话题 id（随好感度逐步开放）。 */
  unlockedTopics: string[];
  /** 已解锁专属台词/彩蛋 id。 */
  unlockedLines: string[];
  /** 首次结识时间（ISO 字符串）。 */
  metAt?: string;
  /** 最近一次互动时间（ISO 字符串）。 */
  lastInteractionAt?: string;
  /** 累计互动次数（对话/同台/邀约等）。 */
  interactionCount: number;
}

/** 记忆重要性 1–5，5 为最刻骨铭心。 */
export type MemoryImportance = 1 | 2 | 3 | 4 | 5;

/** 单条记忆：一段与名人的关键互动摘要。 */
export interface CelebrityMemoryItem {
  id: string;
  /** 记忆正文（一句话摘要）。 */
  text: string;
  /** 发生场景：court / talkshow / werewolf / bar / library / plaza / hall … */
  context: string;
  /** 创建时间（ISO）。 */
  createdAt: string;
  importance: MemoryImportance;
}

/** 某位名人的全部记忆（「我们的回忆」）。 */
export interface CelebrityMemory {
  celebrityId: string;
  memories: CelebrityMemoryItem[];
}

/** 解锁物类型：话题 / 专属台词 / 收藏卡 / 音色。 */
export type CelebrityUnlockType = "topic" | "line" | "card" | "voice";

/** 一项好感度解锁物。 */
export interface CelebrityUnlock {
  type: CelebrityUnlockType;
  /** 解锁物 id（topic/line 为主题串，card/voice 为资源 id）。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** 达到该好感度（含）时解锁。 */
  requiresAffection: number;
}

/** 邀约状态：已结识名人可被拉进某个玩法场景。 */
export type CelebrityInviteStatus = "pending" | "accepted" | "declined" | "cancelled";

/** 一次「邀约名人进入玩法」的请求与回执。 */
export interface CelebrityInvite {
  celebrityId: string;
  /** 目标玩法场景：court / werewolf / talkshow / bar …（玩法域消费后把名人加入参与者列表）。 */
  targetScene: string;
  status: CelebrityInviteStatus;
  invitedAt: string;
  respondedAt?: string;
  /** 玩法域实际接纳后，分配给名人的参与者席位/角色（可选）。 */
  seatLabel?: string;
}

/** 广场偶遇的状态机。 */
export type PlazaEncounterState = "available" | "accompanying" | "finished";

/**
 * 广场随机出现的名人偶遇事件。
 * position 为最小接线：3D 渲染层（Plaza3D）据此摆放名人化身，本类型不依赖 three。
 */
export interface PlazaEncounter {
  encounterId: string;
  celebrityId: string;
  /** 出现时间（ISO）。 */
  spawnedAt: string;
  /** 世界坐标（最小接线，3D 层消费）。 */
  position: { x: number; y: number; z: number };
  state: PlazaEncounterState;
  /** 偶遇时名人主动招呼的一句话（缺省用 greeting）。 */
  greeting?: string;
}

// ===== 纯函数：关系档位推导（shared 内置，便于前后端与测试共用） =====

/** 好感度 → 关系档位。stranger 由调用方用「无关系记录」表达，不在这里返回。 */
export function levelForAffection(affection: number): Exclude<AcquaintanceLevel, "stranger"> {
  const a = Math.max(0, Math.min(100, Math.round(affection)));
  if (a >= 70) return "confidant";
  if (a >= 30) return "friend";
  return "acquainted";
}

/** 判断是否已「结识」（至少见过面）。无记录视为陌生人。 */
export function isAcquainted(r: CelebrityRelation | undefined | null): boolean {
  return !!r && r.acquaintanceLevel !== "stranger";
}

/** 计算一次互动后新的好感度：基础 +5，随互动次数边际递减，封顶 100。 */
export function nextAffection(current: number, interactionCount: number): number {
  const base = Math.max(0, Math.min(100, current));
  // 边际递减：第 n 次互动增量约 5 / (1 + 0.1 * n)，至少 +1。
  const gain = Math.max(1, Math.round(5 / (1 + 0.1 * Math.max(0, interactionCount))));
  return Math.min(100, base + gain);
}
