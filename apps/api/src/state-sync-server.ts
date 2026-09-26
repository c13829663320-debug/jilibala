// ===== 实时状态同步 · 服务端纯逻辑 =====
// 序号去重/乱序检测、发送频率限流、presence 聚合与按消息大小分批。
// 本模块【不依赖 ws / fastify / DOM】，全部为纯类与纯函数，便于 vitest(node) 单测。
// ws.ts 负责把这些组件接到真实 socket 上。
import type { PlayerState, StateSyncConfig } from "@balabala/shared";

/** 与 network-protocol.ts StateSyncConfig 对齐的默认值。 */
export const DEFAULT_STATE_SYNC_CONFIG: StateSyncConfig = {
  serverTickHz: 10,
  clientSendMaxHz: 15,
  interpolationDelayMs: 100,
  maxExtrapolationMs: 250,
  positionClipThreshold: 50,
  maxMessageBytes: 4096,
};

/** SeqTracker.observe 返回值。 */
export interface SeqObservation {
  /** true = 重复/乱序旧包，应丢弃。 */
  dropped: boolean;
  /** 检测到的丢包数（seq 跳跃量 - 1）；0 表示连续。 */
  gap: number;
}

/**
 * 每客户端序号跟踪。
 * 向后兼容：客户端不带 seq（undefined）时不去重、不报错，直接放行。
 */
export class SeqTracker {
  lastSeq?: number;

  observe(seq?: number): SeqObservation {
    if (seq === undefined || !Number.isFinite(seq)) {
      // 旧客户端：无 seq，视为 0，不去重。
      return { dropped: false, gap: 0 };
    }
    if (this.lastSeq !== undefined && seq <= this.lastSeq) {
      // 重复或乱序旧包。
      return { dropped: true, gap: 0 };
    }
    let gap = 0;
    if (this.lastSeq !== undefined && seq > this.lastSeq + 1) {
      gap = seq - this.lastSeq - 1;
    }
    this.lastSeq = seq;
    return { dropped: false, gap };
  }
}

/**
 * 滑动窗口频率限流（服务端权威执行）。
 * windowMs=1000ms 内最多 maxHz 条；超限拒绝。
 */
export class SlidingWindowRateLimiter {
  private readonly times: number[] = [];
  constructor(
    private readonly maxHz: number,
    private readonly windowMs = 1000,
  ) {}

  /** 记录一次发送。返回 true=放行，false=超限应丢弃并回 RATE_LIMITED。 */
  allow(now: number): boolean {
    while (this.times.length > 0 && now - this.times[0] > this.windowMs) {
      this.times.shift();
    }
    if (this.times.length >= this.maxHz) {
      return false;
    }
    this.times.push(now);
    return true;
  }
}

/**
 * 房间 presence 聚合器。
 * 收到 move/talking/emote 只更新内存并 markDirty()，由固定 tick 统一 flush，
 * 把同一 tick 内的多次更新聚合成一条广播，减少重复广播。
 */
export class RoomPresenceAggregator {
  private dirtyFlag = false;

  markDirty(): void {
    this.dirtyFlag = true;
  }

  /** 若有变化则取出并清除脏标记；无变化返回 null（本 tick 不广播）。 */
  takeDirty(): boolean {
    const d = this.dirtyFlag;
    this.dirtyFlag = false;
    return d;
  }
}

/**
 * 把玩家状态数组按单条消息字节上限分批（presence 超员时分多条广播）。
 * 以 JSON.stringify 后的字节长度度量，预留外层信封开销。
 */
export function batchPlayersBySize<T extends { userId: string }>(
  players: T[],
  maxBytes: number,
): T[][] {
  const safe = Math.max(256, maxBytes - 256); // 预留 type/serverTs 等信封开销
  const batches: T[][] = [];
  let cur: T[] = [];
  for (const p of players) {
    const trialSize = JSON.stringify([...cur, p]).length;
    if (cur.length > 0 && trialSize > safe) {
      batches.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** 携带服务端序号的玩家状态（presence 广播用，扩展 shared PlayerState）。 */
export type BroadcastPlayerState = PlayerState & { lastKnownSeq?: number };
