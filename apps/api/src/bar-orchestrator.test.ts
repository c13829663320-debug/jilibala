// ===== bar-orchestrator 测试：玩家主导辩论 + 裁判裁决 =====
import { describe, expect, it } from "vitest";
import {
  applyStrengthDelta,
  decideWinner,
  createDebateSession,
} from "./bar-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

/** 按 system 提示词分发的 mock chat。 */
const makeChat = (handler: (system: string) => string): ChatFn =>
  async (messages) => {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    return handler(sys);
  };

/** 标准 mock：玩家发言质量 8/10，AI 反驳一句，裁判判平局。 */
const standardChat: ChatFn = makeChat((sys) => {
  if (sys.includes("场外技术评委")) return JSON.stringify({ score: 8 });
  if (sys.includes("苏格拉底")) {
    return JSON.stringify({
      winner: "tie",
      reasoning: "双方势均力敌，论据都很扎实。",
      keyMoments: ["玩家立论切题", "AI 反驳有力"],
    });
  }
  if (sys.includes("主持人")) throw new Error("强制走兜底选辩手");
  // debateSpeech：对方 AI 反驳
  return JSON.stringify({ text: "但对方忽略了一个前提……", quote: "前提错了，结论就站不住。" });
});

describe("applyStrengthDelta 双向强度条", () => {
  it("正方 +10 后反方自动补到 40", () => {
    expect(applyStrengthDelta({ pro: 50, con: 50 }, "pro", 10)).toEqual({ pro: 60, con: 40 });
  });
  it("反方 +8 后正方补到 42", () => {
    expect(applyStrengthDelta({ pro: 50, con: 50 }, "con", 8)).toEqual({ pro: 42, con: 58 });
  });
  it("clamp 到 0-100", () => {
    expect(applyStrengthDelta({ pro: 50, con: 50 }, "pro", 200)).toEqual({ pro: 100, con: 0 });
    expect(applyStrengthDelta({ pro: 50, con: 50 }, "con", 200)).toEqual({ pro: 0, con: 100 });
  });
});

describe("decideWinner 胜负判定", () => {
  it("正方领先 ≥3 分判正方胜", () => {
    expect(decideWinner({ pro: 60, con: 40 })).toBe("pro");
  });
  it("反方领先 ≥3 分判反方胜", () => {
    expect(decideWinner({ pro: 45, con: 55 })).toBe("con");
  });
  it("差距 <3 分判平局", () => {
    expect(decideWinner({ pro: 51, con: 49 })).toBe("tie");
    expect(decideWinner({ pro: 50, con: 50 })).toBe("tie");
  });
});

describe("DebateSession 完整 3 回合 + 裁决", () => {
  it("选边开局 → 玩家发言触发 AI 反驳 → 三回合后裁判裁决", async () => {
    const session = createDebateSession(standardChat);
    const started = await session.start("年轻人该先攒钱还是先享受？", "pro");
    expect(started.stage).toBe("debating");
    expect(started.playerSide).toBe("pro");
    expect(started.round).toBe(1);
    expect(started.totalRounds).toBe(3);
    expect(started.argumentStrength).toEqual({ pro: 50, con: 50 });
    expect(started.aiOpponent.name).toBeTruthy();

    // 第 1 回合
    const r1 = await session.playerSpeak(1, "先攒钱才有抗风险能力，享受可以等。");
    expect(r1.playerTurn.side).toBe("player");
    expect(r1.aiTurn.side).toBe("con");
    expect(r1.state.round).toBe(2);
    expect(r1.state.argumentStrength.pro + r1.state.argumentStrength.con).toBe(100);

    // 第 2、3 回合
    await session.playerSpeak(2, "月光族一次意外就崩盘。");
    const r3 = await session.playerSpeak(3, "攒钱不是抠，是给自己留余地。");
    expect(r3.state.round).toBe(4); // 打满 3 回合

    // 裁决
    const { verdict, state } = await session.judgeVerdict();
    expect(state.stage).toBe("verdict");
    expect(["pro", "con", "tie"]).toContain(verdict.winner);
    expect(verdict.reasoning.length).toBeGreaterThan(0);
    expect(verdict.keyMoments.length).toBeGreaterThan(0);
  });

  it("回合序号不匹配时拒绝发言", async () => {
    const session = createDebateSession(standardChat);
    await session.start("辩题", "con");
    await expect(session.playerSpeak(2, "跳回合")).rejects.toThrow();
  });
});
