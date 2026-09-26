// ===== R4-05: 通用 AI 填充管理器 AiFillManager =====
// 所有玩法（法庭 / 酒吧 / 狼人杀…）共用一套「真人混入 AI」的角色位管理逻辑：
//   - 每个角色位（slot）默认由 AI NPC 担任；
//   - 真人加入时认领某个 slot，替换对应 AI；
//   - 真人离开 / 超时未行动时，AI 重新接管该 slot；
//   - 统一维护 playerType: "human" | "ai"，供 WS 消息与前端真人徽章使用。
// 本模块不依赖网络 / DB / LLM，纯内存状态，便于单测。

export type ParticipantType = "human" | "ai";

/** 一个角色位的当前状态。 */
export interface FillSlot {
  /** 角色位 id，如 "plaintiff" / "defendant" / "witness" / "pro-1"。 */
  slotId: string;
  /** 展示名，如「原告」「反方二辩」。 */
  label: string;
  /** 当前由真人还是 AI 担任。 */
  playerType: ParticipantType;
  /** 真人担任时的 userId（AI slot 无此字段）。 */
  userId?: string;
  /** 当前发言人显示名（真人=昵称，AI=AI 兜底名）。 */
  nickname: string;
  /** AI 兜底用的默认昵称（真人离开后恢复）。 */
  aiNickname: string;
  /** 真人最近一次活动（发言/投票/心跳）时间戳 ms。 */
  lastActiveAt: number;
}

export interface AiFillManagerOptions {
  /** 可注入时钟（测试用假时钟）。 */
  now?: () => number;
}

export class AiFillManager {
  private slots = new Map<string, FillSlot>();
  private order: string[] = [];
  private readonly now: () => number;

  constructor(opts: AiFillManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  /** 注册一个默认由 AI 担任的角色位。重复注册会忽略（保持首设）。 */
  registerSlot(slotId: string, label: string, aiNickname: string): FillSlot {
    const existing = this.slots.get(slotId);
    if (existing) return existing;
    const slot: FillSlot = {
      slotId,
      label,
      playerType: "ai",
      nickname: aiNickname,
      aiNickname,
      lastActiveAt: 0,
    };
    this.slots.set(slotId, slot);
    this.order.push(slotId);
    return { ...slot };
  }

  /**
   * 真人认领某个角色位（替换 AI）。
   * 若该 slot 已被其他真人占用，先让原真人下桌（AI 接管）再让新真人坐下。
   * 返回更新后的 slot；slotId 未注册时返回 undefined。
   */
  humanJoin(slotId: string, userId: string, nickname: string): FillSlot | undefined {
    const slot = this.slots.get(slotId);
    if (!slot || !userId) return undefined;
    // 同一个 userId 已经坐在别的位子上？先清掉旧位子（AI 接管）。
    for (const other of this.slots.values()) {
      if (other.userId === userId && other.slotId !== slotId) {
        this.humanLeave(other.slotId);
      }
    }
    slot.playerType = "human";
    slot.userId = userId;
    slot.nickname = nickname || slot.nickname;
    slot.lastActiveAt = this.now();
    return { ...slot };
  }

  /** 真人离开某个角色位，AI 重新接管。返回更新后的 slot。 */
  humanLeave(slotId: string): FillSlot | undefined {
    const slot = this.slots.get(slotId);
    if (!slot) return undefined;
    slot.playerType = "ai";
    slot.userId = undefined;
    slot.nickname = slot.aiNickname;
    slot.lastActiveAt = 0;
    return { ...slot };
  }

  /** 真人活动（发言 / 投票 / 心跳），刷新活跃时间。 */
  markActive(userId: string): void {
    const slot = this.slotOfUser(userId);
    if (slot) {
      const s = this.slots.get(slot.slotId)!;
      s.lastActiveAt = this.now();
    }
  }

  /**
   * 判断某个真人 slot 是否超时未活动（需要 AI 接管）。
   * AI slot 永远返回 false；尚未活动过（lastActiveAt=0）也按未超时处理。
   */
  isHumanTimedOut(userId: string, timeoutMs: number): boolean {
    const slot = this.slotOfUser(userId);
    if (!slot || slot.playerType !== "human") return false;
    return this.now() - slot.lastActiveAt >= timeoutMs;
  }

  get(slotId: string): FillSlot | undefined {
    const s = this.slots.get(slotId);
    return s ? { ...s } : undefined;
  }

  /** 按真人 userId 反查 slot。 */
  slotOfUser(userId: string): FillSlot | undefined {
    for (const s of this.slots.values()) {
      if (s.userId === userId) return { ...s };
    }
    return undefined;
  }

  /** 全部 slot（按注册顺序），返回拷贝。 */
  list(): FillSlot[] {
    return this.order.map((id) => ({ ...this.slots.get(id)! }));
  }

  humanCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.playerType === "human") n += 1;
    return n;
  }

  aiCount(): number {
    let n = 0;
    for (const s of this.slots.values()) if (s.playerType === "ai") n += 1;
    return n;
  }

  isHuman(slotId: string): boolean {
    return this.slots.get(slotId)?.playerType === "human";
  }

  /** 导出为 GameParticipant[]（供 WS / 前端真人徽章）。 */
  toParticipants(): Array<{ slotId: string; label: string; playerType: ParticipantType; userId?: string; nickname: string }> {
    return this.list().map((s) => ({
      slotId: s.slotId,
      label: s.label,
      playerType: s.playerType,
      ...(s.userId ? { userId: s.userId } : {}),
      nickname: s.nickname,
    }));
  }
}
