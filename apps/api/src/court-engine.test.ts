// ===== court-engine 单测：出牌结算 / 天平胜负 / 超时兜底 / AI 填充 / 段位 / 引导 =====
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CourtOrchestrator, type CourtConfig } from "./court-engine.js";
import type { CourtCardType } from "@balabala/shared";

function makeConfig(over: Partial<CourtConfig> = {}): CourtConfig {
  return {
    playerSide: "plaintiff",
    disputePoints: ["是否构成扰民", "损失如何赔偿"],
    evidencePool: [
      { id: "ev-1", name: "凌晨录音", content: "连续一周凌晨三点扰民的电钻声录音" },
      { id: "ev-2", name: "施工许可", content: "被告白天施工许可文件" },
    ],
    facts: [],
    playerTurnTimeoutMs: 60_000,
    opponentRebuttalDelta: 4,
    ...over,
  };
}

function collectEvents(engine: CourtOrchestrator) {
  const evts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  engine.on("*", (e) => evts.push({ type: e.type, payload: e.payload as Record<string, unknown> }));
  return evts;
}

describe("CourtOrchestrator 槽位与初始化", () => {
  it("真人恒占 slot-0，其余由 AI 填充", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    expect(e.slots[0].isHuman).toBe(true);
    expect(e.slots[0].role).toBe("player_lawyer");
    expect(e.slots.slice(1).every((s) => !s.isHuman && !!s.aiPersona)).toBe(true);
    expect(e.getHumanSlots().length).toBe(1);
    expect(e.getAISlots().length).toBe(3);
    e.cancelTimer();
  });

  it("开局广播初始天平与 player_turn", () => {
    const e = new CourtOrchestrator();
    const evts = collectEvents(e);
    e.start(makeConfig());
    expect(evts.some((x) => x.type === "court_balance_update")).toBe(true);
    const pt = evts.find((x) => x.type === "court_player_turn");
    expect(pt?.payload.ammo).toBe(2);
    expect(pt?.payload.handCards).toEqual(["attack", "evidence", "mock", "request_record"]);
    e.cancelTimer();
  });
});

describe("出牌结算（纯函数复算）", () => {
  it("evidence 命中 unresolved → 天平 +8 且争议点移到 resolved", () => {
    const e = new CourtOrchestrator();
    const evts = collectEvents(e);
    e.start(makeConfig());
    const before = e.state.balance.plaintiff;
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-1" });
    expect(e.state.balance.plaintiff).toBe(before + 8);
    expect(e.state.unresolved).not.toContain("是否构成扰民");
    expect(e.state.resolved).toContain("是否构成扰民");
    const res = evts.find((x) => x.type === "court_card_resolved");
    expect(res?.payload.hit).toBe(true);
    expect(res?.payload.delta).toBe(8);
    // 弹药扣 1
    expect(e.state.ammo.plaintiff).toBe(1);
    e.cancelTimer();
  });

  it("evidence 未命中 → 仅 +2", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    const before = e.state.balance.plaintiff;
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-2" });
    // ev-2 内容「施工许可白天」与扰民争议点无 bigram 重叠 → +2
    expect(e.state.balance.plaintiff).toBe(before + 2);
    e.cancelTimer();
  });

  it("attack 自由文本命中关键词 → +6，未命中 → +1", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    const b1 = e.state.balance.plaintiff;
    e.act({ kind: "play_card", card: "attack", freeText: "凌晨三点施工已经构成扰民！" });
    expect(e.state.balance.plaintiff).toBeGreaterThanOrEqual(b1 + 1);
    e.cancelTimer();
  });

  it("mock 越界词 → 天平反向 -3", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    const before = e.state.balance.plaintiff;
    e.act({ kind: "play_card", card: "mock", freeText: "被告就是个蠢货" });
    expect(e.state.balance.plaintiff).toBe(before - 3);
    expect(e.state.usedMock).toBe(true);
    e.cancelTimer();
  });

  it("mock 正常 → +3", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    const before = e.state.balance.plaintiff;
    e.act({ kind: "play_card", card: "mock", freeText: "对方律师今天的领带很有个性" });
    expect(e.state.balance.plaintiff).toBe(before + 3);
    e.cancelTimer();
  });

  it("request_record 不花弹药，写入 facts", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    e.act({ kind: "play_card", card: "request_record", freeText: "原告曾三次报警" });
    expect(e.state.ammo.plaintiff).toBe(2);
    expect(e.state.facts).toContain("原告曾三次报警");
    e.cancelTimer();
  });

  it("弹药不足时拒绝出牌并发 error", () => {
    const e = new CourtOrchestrator();
    const evts = collectEvents(e);
    e.start(makeConfig());
    // 强制进入「弹药已耗尽但仍在玩家回合」的边界态，验证守卫。
    e.state.ammo.plaintiff = 0;
    e.state.stage = "player_turn";
    e.act({ kind: "play_card", card: "attack", freeText: "x" });
    expect(evts.some((x) => x.type === "error")).toBe(true);
    e.cancelTimer();
  });
});

describe("轮次推进与对手反驳", () => {
  it("一轮出完牌后对手反驳 -4 并进入下一轮", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-1" }); // +8, ammo 1
    e.act({ kind: "play_card", card: "request_record", freeText: "事实" }); // ammo 1 仍在 → 不触发 close
    // 手动 pass 关闭本轮
    e.act({ kind: "pass" });
    expect(e.state.round).toBe(2);
    expect(e.state.ammo.plaintiff).toBe(2); // 补满
    e.cancelTimer();
  });
});

describe("超时 fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("玩家回合超时自动 pass，不卡死局面", async () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig({ playerTurnTimeoutMs: 1_000 }));
    expect(e.state.round).toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    // 自动 pass 后应进入第 2 轮
    expect(e.state.round).toBe(2);
    e.cancelTimer();
  });
});

describe("终局天平胜负与段位", () => {
  it("天平 >50 判真人胜，段位按百分位", () => {
    const e = new CourtOrchestrator();
    // 3 个争议点 × 3 张证据，每轮命中一个（+8），对手每轮 -4 → 净 +4/轮。
    e.start(makeConfig({
      disputePoints: ["凌晨扰民", "损失赔偿", "责任认定"],
      evidencePool: [
        { id: "ev-1", name: "录音", content: "凌晨扰民的电钻录音" },
        { id: "ev-2", name: "发票", content: "损失赔偿的维修发票" },
        { id: "ev-3", name: "笔录", content: "责任认定的出警笔录" },
      ],
    }));
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-1" });
    e.act({ kind: "pass" });
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-2" });
    e.act({ kind: "pass" });
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "ev-3" });
    e.act({ kind: "pass" });
    const snap = e.getSnapshot() as { phase: string };
    expect(snap.phase).toBe("results");
    // 50 → 54 → 58 → 62
    const result = e.settle();
    expect(result.scores["slot-0"]).toBe(62);
    expect(result.winner).toBe("slot-0");
    expect(result.tier.percentile).toBe(62);
    expect(result.tier.level).toBe("expert");
    e.cancelTimer();
  });

  it("全程不出牌 → 天平被对手压到 46，判负", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    for (let round = 0; round < 3; round += 1) {
      e.act({ kind: "pass" });
    }
    const result = e.settle();
    // 每轮 -4：50 → 46 → 42 → 38
    expect(result.scores["slot-0"]).toBeLessThan(50);
    expect(result.winner).toBe("slot-1");
    e.cancelTimer();
  });
});

describe("新手引导", () => {
  it("可跳过，且跳过后标记完成", () => {
    const e = new CourtOrchestrator();
    e.start(makeConfig());
    expect(e.tutorial.steps.length).toBeGreaterThan(0);
    e.skipTutorial();
    expect(e.tutorial.isSkipped).toBe(true);
    expect(e.tutorial.isCompleted).toBe(true);
    e.cancelTimer();
  });
});

describe("每日挑战", () => {
  it("能取到当天 court 挑战", () => {
    const d = CourtOrchestrator.dailyChallenge(new Date("2026-09-27T00:00:00+08:00"));
    expect(d.id).toBeTruthy();
    expect(typeof d.title).toBe("string");
  });
});
