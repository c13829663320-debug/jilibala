// ===== BarEngine 单测：克制表全组合 / 双维评分 / AI倾向轮换 / 胜负 / 超时fallback =====
import { describe, expect, it } from "vitest";
import { BarEngine, BAR_TOTAL_ROUNDS, PLAYER_WIN_THRESHOLD } from "./bar-engine.js";
import {
  resolveAngleCounter,
  type ArgumentAngle,
  type ArgumentScore,
  type StanceTendency,
} from "./bar-orchestrator.js";

/** 玩家拿满分、AI 拿 0 分 → 玩家必赢。 */
const playerDominantScore = (
  _t: string,
  side: "player" | "pro" | "con",
  _a: ArgumentAngle,
  _c: string,
): ArgumentScore => (side === "player" ? { content_quality: 10, relevance: 10 } : { content_quality: 0, relevance: 0 });

describe("BarEngine · 角度克制表全组合", () => {
  const cases: Array<[ArgumentAngle, StanceTendency, number, string]> = [
    ["data", "rational", 2, "same"],
    ["data", "emotional", 8, "counter"],
    ["data", "mixed", 5, "neutral"],
    ["emotion", "rational", 8, "counter"],
    ["emotion", "emotional", 2, "same"],
    ["emotion", "mixed", 5, "neutral"],
    ["logic", "rational", 5, "neutral"],
    ["logic", "emotional", 5, "neutral"],
    ["logic", "mixed", 8, "counter"],
  ];
  for (const [angle, tendency, delta, eff] of cases) {
    it(`${angle} vs ${tendency} → ${eff}(+${delta})`, () => {
      const r = resolveAngleCounter(angle, tendency);
      expect(r.delta).toBe(delta);
      expect(r.effectiveness).toBe(eff);
    });
  }
});

describe("BarEngine · 基础流程", () => {
  it("3 回合循环 + transcript 成对", () => {
    // rand 必须返回 [0,1)：轮换 rational/emotional/mixed
    let i = 0;
    const frac = [0.1, 0.5, 0.8];
    const e = new BarEngine({ score: playerDominantScore, rand: () => frac[i++ % frac.length] });
    e.setup({ topic: "年轻人该先攒钱还是先享受？", playerSide: "pro" });
    for (let r = 1; r <= BAR_TOTAL_ROUNDS; r += 1) {
      e.resolveTurn("data", "根据统计，80% 的年轻人存款不足 5 万");
    }
    expect(e.state.transcript).toHaveLength(BAR_TOTAL_ROUNDS * 2);
    expect(e.state.finished).toBe(true);
    expect(e.state.round).toBe(BAR_TOTAL_ROUNDS + 1);
  });

  it("AI 倾向每回合轮换", () => {
    const seen = new Set<StanceTendency>();
    let i = 0;
    const e = new BarEngine({ score: playerDominantScore, rand: () => (i++ % 3) / 3 });
    e.setup({ topic: "t", playerSide: "con" });
    seen.add(e.currentTendency);
    for (let r = 1; r <= BAR_TOTAL_ROUNDS; r += 1) {
      e.resolveTurn("logic", "你这个前提自相矛盾");
      seen.add(e.currentTendency);
    }
    // 至少出现过 ≥2 种倾向
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("BarEngine · 双维评分结算", () => {
  it("playerDelta 计入角度分 + 双维分，强度条滑动", () => {
    // 玩家高分、AI 零分 → 玩家方强度必然上涨
    const e = new BarEngine({ score: playerDominantScore, rand: () => 0.1 });
    e.setup({ topic: "t", playerSide: "pro" });
    const before = e.state.strength.pro;
    const turn = e.resolveTurn("data", "大量数据与案例支撑我的论点");
    expect(turn.score).toEqual({ content_quality: 10, relevance: 10 });
    expect(typeof turn.delta).toBe("number");
    expect(e.state.strength.pro).toBeGreaterThan(before);
  });
});

describe("BarEngine · 胜负判定", () => {
  it("玩家方强度 ≥55 判玩家胜", () => {
    const e = new BarEngine({ score: playerDominantScore, rand: () => 0.5 });
    e.setup({ topic: "t", playerSide: "pro" });
    for (let r = 1; r <= BAR_TOTAL_ROUNDS; r += 1) e.resolveTurn("data", "大量数据与案例支撑我的论点");
    const result = e.judge();
    expect(e.state.strength.pro).toBeGreaterThanOrEqual(PLAYER_WIN_THRESHOLD);
    expect(result.winner).toBe("slot-0");
  });

  it("玩家全 0 分则对手胜", () => {
    // 玩家 0 分、AI 10 分 → 玩家方强度下滑
    const reverse = (() => {
      let i = 0;
      return (_t: string, side: "player" | "pro" | "con"): ArgumentScore =>
        (side === "player" ? { content_quality: 0, relevance: 0 } : { content_quality: 10, relevance: 10 });
    })();
    const e = new BarEngine({ score: reverse, rand: () => 0.5 });
    e.setup({ topic: "t", playerSide: "pro" });
    for (let r = 1; r <= BAR_TOTAL_ROUNDS; r += 1) e.resolveTurn("logic", "");
    const result = e.judge();
    expect(e.state.strength.pro).toBeLessThan(PLAYER_WIN_THRESHOLD);
    expect(result.winner).toBe("opponent");
  });
});

describe("BarEngine · 超时 fallback", () => {
  it("整回合不操作 → timeoutFallback 自动用默认角度结算", () => {
    const e = new BarEngine({ score: playerDominantScore, rand: () => 0.5 });
    e.setup({ topic: "t", playerSide: "pro" });
    const turn = e.timeoutFallback();
    expect(turn.angle).toBe("data"); // 默认兜底角度
    expect(e.state.transcript).toHaveLength(2);
    expect(e.state.round).toBe(2);
  });
});
