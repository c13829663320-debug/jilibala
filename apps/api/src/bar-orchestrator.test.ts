// ===== bar-orchestrator 测试：角度克制三角 + 双维度评分 + AI 对称反驳 =====
import { describe, expect, it } from "vitest";
import {
  applyStrengthDelta,
  decideWinner,
  createDebateSession,
  resolveAngleCounter,
  computeTurnDelta,
  tendencyFromAngle,
  angleFromTendency,
  rollStanceTendency,
  rollArgumentAngle,
  isArgumentAngle,
} from "./bar-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

/** 按 system 提示词分发的 mock chat（all 用于在 user 消息里区分立场）。 */
const makeChat = (handler: (system: string, all: Array<{ role: string; content: string }>) => string): ChatFn =>
  async (messages) => {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    return handler(sys, messages);
  };

/** 标准 mock：玩家发言双维度 8/8，AI 反驳 4/4，裁判判平局。 */
const standardChat: ChatFn = makeChat((sys, all) => {
  if (sys.includes("场外技术评委")) {
    const isAiSide = all.some((m) => m.role === "user" && m.content.includes("立场：反方"));
    return isAiSide
      ? JSON.stringify({ content_quality: 4, relevance: 4 })
      : JSON.stringify({ content_quality: 8, relevance: 8 });
  }
  if (sys.includes("苏格拉底")) {
    return JSON.stringify({
      winner: "tie",
      reasoning: "双方势均力敌，论据都很扎实。",
      keyMoments: ["玩家立论切题", "AI 反驳有力"],
    });
  }
  if (sys.includes("主持人")) throw new Error("强制走兜底选辩手");
  return JSON.stringify({ text: "但对方忽略了一个前提……", quote: "前提错了，结论就站不住。" });
});

/** 确定性伪随机（线性同余），便于测试可复现。 */
const seededRand = (seed = 42) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

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

describe("resolveAngleCounter 克制三角（纯函数，规格 4.5）", () => {
  it("data vs rational → same(+2)", () => {
    expect(resolveAngleCounter("data", "rational")).toEqual({ delta: 2, effectiveness: "same" });
  });
  it("data vs emotional → counter(+8)", () => {
    expect(resolveAngleCounter("data", "emotional")).toEqual({ delta: 8, effectiveness: "counter" });
  });
  it("emotion vs rational → counter(+8)", () => {
    expect(resolveAngleCounter("emotion", "rational")).toEqual({ delta: 8, effectiveness: "counter" });
  });
  it("emotion vs emotional → same(+2)", () => {
    expect(resolveAngleCounter("emotion", "emotional")).toEqual({ delta: 2, effectiveness: "same" });
  });
  it("logic vs mixed → counter(+8)", () => {
    expect(resolveAngleCounter("logic", "mixed")).toEqual({ delta: 8, effectiveness: "counter" });
  });
  it("logic vs rational/emotional → neutral(+5)", () => {
    expect(resolveAngleCounter("logic", "rational")).toEqual({ delta: 5, effectiveness: "neutral" });
    expect(resolveAngleCounter("logic", "emotional")).toEqual({ delta: 5, effectiveness: "neutral" });
  });
  it("data/emotion vs mixed → neutral(+5)", () => {
    expect(resolveAngleCounter("data", "mixed").effectiveness).toBe("neutral");
    expect(resolveAngleCounter("emotion", "mixed").delta).toBe(5);
  });
});

describe("computeTurnDelta 双维度合成公式", () => {
  it("delta = angleDelta + (cq-5) + (rel-5)*0.5", () => {
    expect(computeTurnDelta(8, { content_quality: 10, relevance: 10 })).toBeCloseTo(15.5);
    expect(computeTurnDelta(2, { content_quality: 5, relevance: 5 })).toBe(2);
    expect(computeTurnDelta(5, { content_quality: 0, relevance: 0 })).toBeCloseTo(-2.5);
  });
});

describe("角度↔倾向互转与随机", () => {
  it("tendencyFromAngle / angleFromTendency 互为逆映射", () => {
    expect(tendencyFromAngle("data")).toBe("rational");
    expect(tendencyFromAngle("emotion")).toBe("emotional");
    expect(tendencyFromAngle("logic")).toBe("mixed");
    expect(angleFromTendency("rational")).toBe("data");
    expect(angleFromTendency("emotional")).toBe("emotion");
    expect(angleFromTendency("mixed")).toBe("logic");
  });
  it("roll* 只产出合法取值，且可注入 rand", () => {
    const r = seededRand(7);
    for (let i = 0; i < 30; i++) {
      expect(["rational", "emotional", "mixed"]).toContain(rollStanceTendency(r));
      expect(["data", "emotion", "logic"]).toContain(rollArgumentAngle(r));
    }
  });
  it("isArgumentAngle 类型守卫", () => {
    expect(isArgumentAngle("data")).toBe(true);
    expect(isArgumentAngle("logic")).toBe(true);
    expect(isArgumentAngle("magic")).toBe(false);
    expect(isArgumentAngle(undefined)).toBe(false);
  });
});

describe("DebateSession：角度选择 + 对称反驳 + 倾向揭示", () => {
  it("开局即揭示 AI 倾向；选角度发言后返回双维度分与双方 delta", async () => {
    const session = createDebateSession(standardChat, { rand: seededRand(1) });
    const started = await session.start("年轻人该先攒钱还是先享受？", "pro");
    expect(started.aiTendency).toBeTruthy();
    expect(started.argumentStrength).toEqual({ pro: 50, con: 50 });

    const preview = session.previewAngle("data");
    expect([2, 5, 8]).toContain(preview.delta);

    const r1 = await session.playerSpeak(1, "data", "央行数据显示储蓄率连年上升。");
    expect(r1.playerTurn.angle).toBe("data");
    expect(r1.aiTurn.angle).toBeTruthy();
    expect(r1.playerScore.content_quality).toBe(8);
    expect(r1.playerScore.relevance).toBe(8);
    expect(r1.aiScore.content_quality).toBe(4);
    expect(r1.aiDelta).not.toBe(2);
    expect(r1.playerDelta).not.toBe(3);
    expect(["rational", "emotional", "mixed"]).toContain(r1.nextAiTendency);
    expect(r1.state.aiTendency).toBe(r1.nextAiTendency);
    expect(r1.state.argumentStrength.pro + r1.state.argumentStrength.con).toBe(100);
  });

  it("AI 反驳 delta 按角度+双维度分算出，而非固定 +2", async () => {
    const session = createDebateSession(standardChat, { rand: seededRand(2) });
    await session.start("辩题", "pro");
    const r1 = await session.playerSpeak(1, "emotion", "我朋友月光族，一次生病就借了十万。");

    expect(r1.playerDelta).toBeGreaterThan(3);
    const angleDeltaByEffectiveness = { counter: 8, neutral: 5, same: 2 } as const;
    expect(r1.aiDelta).toBeCloseTo(angleDeltaByEffectiveness[r1.aiEffectiveness] - 1.5);
    expect(r1.aiDelta).not.toBe(2);
    expect(r1.state.argumentStrength.pro + r1.state.argumentStrength.con).toBe(100);
  });

  it("不选角度直接发言会被拒绝", async () => {
    const session = createDebateSession(standardChat, { rand: seededRand(3) });
    await session.start("辩题", "con");
    // @ts-expect-error 故意传非法角度
    await expect(session.playerSpeak(1, "bad-angle", "随便说")).rejects.toThrow();
  });

  it("完整 3 回合 + 裁决", async () => {
    const session = createDebateSession(standardChat, { rand: seededRand(4) });
    await session.start("年轻人该先攒钱还是先享受？", "pro");
    await session.playerSpeak(1, "data", "数据显示储蓄率上升。");
    await session.playerSpeak(2, "emotion", "月光族一次意外就崩盘。");
    const r3 = await session.playerSpeak(3, "logic", "攒钱不是抠，是留余地。");
    expect(r3.state.round).toBe(4);

    const { verdict, state } = await session.judgeVerdict();
    expect(state.stage).toBe("verdict");
    expect(["pro", "con", "tie"]).toContain(verdict.winner);
    expect(verdict.reasoning.length).toBeGreaterThan(0);
  });

  it("回合序号不匹配时拒绝发言", async () => {
    const session = createDebateSession(standardChat, { rand: seededRand(5) });
    await session.start("辩题", "con");
    await expect(session.playerSpeak(2, "data", "跳回合")).rejects.toThrow();
  });
});
