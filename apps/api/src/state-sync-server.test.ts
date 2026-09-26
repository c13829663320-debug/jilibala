// 服务端状态同步纯逻辑单测：序号去重 / 乱序丢弃 / gap 检测 / 频率限流 / 消息大小分批。
import { describe, it, expect } from "vitest";
import {
  SeqTracker,
  SlidingWindowRateLimiter,
  RoomPresenceAggregator,
  batchPlayersBySize,
  DEFAULT_STATE_SYNC_CONFIG,
} from "./state-sync-server.js";

describe("SeqTracker 序号去重与乱序检测", () => {
  it("连续递增 seq 全部放行，gap=0", () => {
    const t = new SeqTracker();
    expect(t.observe(1)).toEqual({ dropped: false, gap: 0 });
    expect(t.observe(2)).toEqual({ dropped: false, gap: 0 });
    expect(t.observe(3)).toEqual({ dropped: false, gap: 0 });
  });

  it("重复 seq（<=lastSeq）被丢弃", () => {
    const t = new SeqTracker();
    t.observe(1);
    t.observe(2);
    const r = t.observe(2); // 重复
    expect(r.dropped).toBe(true);
    const r0 = t.observe(1); // 旧乱序
    expect(r0.dropped).toBe(true);
  });

  it("跳跃 seq 检测出 gap（丢包数）", () => {
    const t = new SeqTracker();
    t.observe(1);
    // 1 -> 5，中间丢了 2,3,4 => gap=3
    expect(t.observe(5)).toEqual({ dropped: false, gap: 3 });
    expect(t.lastSeq).toBe(5);
  });

  it("向后兼容：不带 seq（旧客户端）不去重、不报错", () => {
    const t = new SeqTracker();
    expect(t.observe(undefined)).toEqual({ dropped: false, gap: 0 });
    t.observe(10);
    expect(t.observe(undefined).dropped).toBe(false);
    expect(t.observe(NaN).dropped).toBe(false);
  });
});

describe("SlidingWindowRateLimiter 频率限流", () => {
  it("窗口内最多放行 maxHz 条，超限拒绝", () => {
    const lim = new SlidingWindowRateLimiter(15, 1000);
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      if (lim.allow(1000 + i)) allowed++;
    }
    expect(allowed).toBe(15);
  });

  it("窗口滑出后恢复额度", () => {
    const lim = new SlidingWindowRateLimiter(2, 1000);
    expect(lim.allow(0)).toBe(true);
    expect(lim.allow(100)).toBe(true);
    expect(lim.allow(200)).toBe(false); // 窗口内满
    // 1100ms 后旧样本滑出窗口
    expect(lim.allow(1100)).toBe(true);
  });
});

describe("RoomPresenceAggregator 聚合脏标记", () => {
  it("markDirty 后 takeDirty 一次为 true，随后为 false", () => {
    const agg = new RoomPresenceAggregator();
    expect(agg.takeDirty()).toBe(false);
    agg.markDirty();
    expect(agg.takeDirty()).toBe(true);
    expect(agg.takeDirty()).toBe(false);
  });
});

describe("batchPlayersBySize 消息大小分批", () => {
  it("单条不超限时不分批", () => {
    const players = [
      { userId: "a", x: 0, z: 0 },
      { userId: "b", x: 1, z: 1 },
    ];
    const batches = batchPlayersBySize(players, 4096);
    expect(batches.length).toBe(1);
  });

  it("超限时按字节上限拆成多条", () => {
    const players = Array.from({ length: 50 }, (_, i) => ({
      userId: `user-${i}-with-a-somewhat-long-id-to-increase-byte-size`,
      x: i,
      z: i,
      talkingIntensity: 0.5,
    }));
    const batches = batchPlayersBySize(players, DEFAULT_STATE_SYNC_CONFIG.maxMessageBytes);
    expect(batches.length).toBeGreaterThan(1);
    // 所有批次拼起来应无遗漏
    const total = batches.reduce((n, b) => n + b.length, 0);
    expect(total).toBe(players.length);
    // 每批序列化后不超过上限（预留信封）
    for (const b of batches) {
      expect(JSON.stringify(b).length).toBeLessThanOrEqual(DEFAULT_STATE_SYNC_CONFIG.maxMessageBytes - 100);
    }
  });
});
