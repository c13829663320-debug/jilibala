// ===== talkshow-engine 单测：三维度评分 / callback 加成 / 超时提交 / 段位 / AI 观众 =====
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TalkshowOrchestrator } from "./talkshow-engine.js";
import type { JokeDimensionScores, OpenMicReaction } from "./talkshow-orchestrator.js";

/** 确定性评分器：固定返回三维度。 */
const fixedScorer = (over: Partial<JokeDimensionScores> = {}) => async (_text: string) => {
  const scores: JokeDimensionScores = { punchline: 28, pacing: 20, resonance: 22, ...over };
  const total = scores.punchline + scores.pacing + scores.resonance;
  const reaction: OpenMicReaction = total >= 80 ? "applaud" : total >= 60 ? "mixed" : total >= 35 ? "roast" : "silence";
  return { scores, total, reaction, note: "测试吐槽" };
};

function startEngine(scorer = fixedScorer()) {
  const e = new TalkshowOrchestrator();
  e.start({ scorer, jokeTimeLimitMs: 60_000 });
  return e;
}

describe("TalkshowOrchestrator 槽位", () => {
  it("真人=演员 slot-0，AI=主持人+3观众", () => {
    const e = startEngine();
    expect(e.slots[0].isHuman).toBe(true);
    expect(e.slots[0].role).toBe("performer");
    expect(e.slots.slice(1).map((s) => s.role)).toEqual(["host", "audience-1", "audience-2", "audience-3"]);
    expect(e.getHumanSlots().length).toBe(1);
    expect(e.getAISlots().length).toBe(4);
    e.cancelTimer();
  });

  it("开局发热身与话题选项事件", () => {
    const e = new TalkshowOrchestrator();
    const evts: string[] = [];
    e.on("*", (ev) => evts.push(ev.type));
    e.start({ scorer: fixedScorer() });
    expect(evts).toContain("talkshow_warmup");
    expect(evts).toContain("talkshow_topic_options");
    e.cancelTimer();
  });
});

describe("选话题 → 讲段子", () => {
  it("选话题后进入 performing 并发 joke_start", async () => {
    const e = startEngine();
    e.act({ kind: "pick_topic", topicId: "workplace" });
    expect(e.state.topic?.label).toBe("职场吐槽");
    expect(e.state.stage).toBe("performing");
    e.cancelTimer();
  });

  it("讲一段段子 → 三维度评分事件", async () => {
    const e = startEngine();
    e.act({ kind: "pick_topic", topicId: "workplace" });
    const evts: Array<{ type: string; payload: Record<string, unknown> }> = [];
    e.on("*", (ev) => evts.push({ type: ev.type, payload: ev.payload as Record<string, unknown> }));
    await e.performJoke("老板凌晨三点在群里发「在吗」，我当场就把遗嘱写好了。");
    const scored = evts.find((x) => x.type === "talkshow_joke_scored");
    expect(scored).toBeTruthy();
    expect((scored!.payload.scores as JokeDimensionScores).punchline).toBe(28);
    expect(e.state.jokes.length).toBe(1);
    expect(e.state.currentJokeIndex).toBe(1);
    e.cancelTimer();
  });
});

describe("callback 回扣加成", () => {
  it("真引用前段关键词 → resonance +15 且反应升一档", async () => {
    const e = startEngine(fixedScorer({ resonance: 10 })); // total=58 → roast
    e.act({ kind: "pick_topic", topicId: "workplace" });
    const j1 = await e.performJoke("老板凌晨三点在群里发「在吗」，我当场就写好了遗嘱。");
    expect(j1.callbackHit).toBeUndefined();
    // 第二段真回扣「老板凌晨」关键词
    const j2 = await e.performJoke(
      "后来老板凌晨三点又发「在吗」，我把遗嘱改成了他的。",
      { callbackTo: 0 },
    );
    expect(j2.callbackTo).toBe(0);
    expect(j2.callbackHit).toBe(true);
    // resonance 10 +15 = 25
    expect(j2.scores.resonance).toBe(25);
    expect(j2.total).toBe(28 + 20 + 25);
    e.cancelTimer();
  });

  it("假引用（点了回扣但没关键词）→ 不加成并给提示", async () => {
    const e = startEngine();
    e.act({ kind: "pick_topic", topicId: "workplace" });
    await e.performJoke("今天天气真好，适合上班摸鱼。");
    const j2 = await e.performJoke("我家猫又把杯子打碎了，喵的。", { callbackTo: 0 });
    expect(j2.callbackHit).toBe(false);
    expect(j2.note).toContain("call back");
    e.cancelTimer();
  });
});

describe("超时兜底", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("60s 超时自动提交空段子记冷场，不卡死", async () => {
    const e = startEngine();
    e.act({ kind: "pick_topic", topicId: "life" });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(e.state.jokes.length).toBe(1);
    expect(e.state.jokes[0].reaction).toBe("silence");
    expect(e.state.currentJokeIndex).toBe(1);
    e.cancelTimer();
  });
});

describe("结算与段位", () => {
  it("3 段讲完自动结算，平均分化段位", async () => {
    // 每段 total = 28+20+22 = 70 → average 70 → expert(炸场)
    const e = startEngine();
    e.act({ kind: "pick_topic", topicId: "family" });
    await e.performJoke("段子一");
    await e.performJoke("段子二");
    await e.performJoke("段子三");
    expect(e.state.stage).toBe("results");
    const result = e.settle();
    expect(result.scores["slot-0"]).toBe(70);
    expect(result.tier.level).toBe("expert");
    expect(result.tier.label).toBe("炸场");
    expect(result.highlights.length).toBeGreaterThan(0);
    e.cancelTimer();
  });
});

describe("每日挑战", () => {
  it("能取到当天 talkshow 挑战", () => {
    const d = TalkshowOrchestrator.dailyChallenge(new Date("2026-09-27T00:00:00+08:00"));
    expect(d.id).toBeTruthy();
  });
});
