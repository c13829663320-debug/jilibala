// ===== 名人招牌引擎：完整一局 / 陪审团情绪 / 结案陈词 / 名场面 / 翻盘 =====
import { describe, expect, it } from "vitest";
import { CourtSignatureEngine, evaluateClosingStatement } from "./court-signature-engine.js";

function startWinningGame() {
  const e = new CourtSignatureEngine();
  e.start({ caseId: "newton-vs-leibniz", playerSide: "plaintiff", playerTurnTimeoutMs: 60_000, opponentRebuttalDelta: 4 });
  return e;
}

describe("招牌引擎 · 初始化", () => {
  it("按案件设定初始天平与陪审团情绪", () => {
    const e = startWinningGame();
    // plaintiff 玩家，juryBias=-10（偏被告）→ 情绪 50-10=40
    expect(e.state.juryMood).toBe(40);
    expect(e.state.balance).toEqual({ plaintiff: 50, defendant: 50 });
    expect(e.state.disputePoints?.length ?? e.state.unresolved.length).toBe(3);
    expect(e.state.evidencePool.length).toBeGreaterThanOrEqual(2);
    e.cancelTimer();
  });
});

describe("招牌引擎 · 完整一局（举证→结案→裁决）", () => {
  it("关键证据命中 → 天平涨 + 陪审团情绪升 + 名场面捕捉", () => {
    const e = startWinningGame();
    const moodBefore = e.state.juryMood;
    // nl-p1 命中「微分符号之争」+8
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "nl-p1" });
    expect(e.state.balance.plaintiff).toBe(58);
    expect(e.state.juryMood).toBeGreaterThan(moodBefore);
    expect(e.getHighlights().some((h) => h.type === "key_evidence")).toBe(true);
    expect(e.state.shownMoments.length).toBeGreaterThan(0);
    e.cancelTimer();
  });

  it("打完 3 轮进入 closing，提交结案陈词后裁决", () => {
    const e = startWinningGame();
    // R1
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "nl-p1" });
    e.act({ kind: "pass" });
    expect(e.state.round).toBe(2);
    // R2
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "nl-p3" });
    e.act({ kind: "pass" });
    expect(e.state.round).toBe(3);
    // R3：attack 命中「微积分发明优先权」
    e.act({ kind: "play_card", card: "attack", freeText: "微积分发明优先权不容抹杀" });
    e.act({ kind: "pass" });
    // 进入结案陈词
    expect(e.state.stage).toBe("closing");
    expect(e.phase).toBe("playing");

    // 提交慷慨陈词
    e.act({ kind: "submit_closing", text: "陪审团的各位，微积分发明的真相不容抹杀！这份手稿与 dx 符号是铁证，恳请各位给出公正的判决，历史会铭记此刻。" });
    expect(e.phase).toBe("results");
    const result = e.settle();
    expect(result.winner).toBe("slot-0");
    expect(result.closingScore).toBeGreaterThan(0);
    expect(result.juryMood).toBeGreaterThan(0);
    expect(result.verdictScore).toBeGreaterThan(52);
    expect(result.dramaticMoments.length).toBeGreaterThanOrEqual(1);
    expect(result.case.id).toBe("newton-vs-leibniz");
    e.cancelTimer();
  });

  it("全程不举证 → 对方胜", () => {
    const e = startWinningGame();
    for (let i = 0; i < 3; i += 1) e.act({ kind: "pass" });
    e.act({ kind: "submit_closing", text: "简短。" });
    const result = e.settle();
    expect(result.winner).toBe("slot-1");
    e.cancelTimer();
  });
});

describe("evaluateClosingStatement 纯函数", () => {
  const base = { balance: { plaintiff: 50, defendant: 50 } as const, juryMood: 50, disputePoints: ["微积分发明优先权"] };

  it("空文本 0 分", () => {
    expect(evaluateClosingStatement({ ...base, text: "" })).toBe(0);
  });

  it("短文本得基础长度分", () => {
    const s = evaluateClosingStatement({ ...base, text: "这是一段八个字以上的陈词" });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(15);
  });

  it("长 + 关键词 + 争议点呼应 → 接近满分", () => {
    const s = evaluateClosingStatement({
      ...base,
      text: "陪审团各位，微积分发明优先权的真相不容抹杀，恳请诸位相信正义与历史，给出公正的判决！",
    });
    expect(s).toBeGreaterThanOrEqual(10);
    expect(s).toBeLessThanOrEqual(15);
  });
});

describe("招牌引擎 · 陪审团情绪", () => {
  it("命中 +6，被反驳 -4，情绪被夹到 [0,100]", () => {
    const e = startWinningGame();
    const startMood = e.state.juryMood;
    e.act({ kind: "play_card", card: "evidence", targetEvidenceId: "nl-p1" }); // hit +6
    expect(e.state.juryMood).toBe(startMood + 6);
    e.act({ kind: "pass" }); // 反驳 -4
    expect(e.state.juryMood).toBe(startMood + 2);
    e.cancelTimer();
  });
});
