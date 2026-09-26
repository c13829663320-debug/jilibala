// ===== talkshow-orchestrator 测试：三维度评分 + callback 回扣 + 话题选择 =====
import { describe, expect, it } from "vitest";
import {
  computeOpenMicTier,
  scorePlayerJoke,
  createOpenMicSession,
  detectCallback,
  extractKeywords,
  upgradeReaction,
  TOPIC_LIBRARY,
  reactionFromScore,
} from "./talkshow-orchestrator.js";
import type { ChatFn } from "./bench-orchestrator.js";

/** 按 system 提示词分发的 mock chat。 */
const makeChat = (handler: (system: string) => string): ChatFn =>
  async (messages) => {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    return handler(sys);
  };

/** 三维度打分的 mock（system 里含「三个维度」关键字）。 */
type DimReply = { punchline: number; pacing: number; resonance: number; reaction: "applaud" | "mixed" | "roast" | "silence"; note: string };
const dimChat = (over: Partial<DimReply> = {}): ChatFn =>
  makeChat((sys) => {
    if (sys.includes("三个维度")) {
      const reply: DimReply = { punchline: 24, pacing: 18, resonance: 20, reaction: "mixed", note: "铺垫再短点", ...over };
      return JSON.stringify(reply);
    }
    // 主持人热身。
    return JSON.stringify({ jokes: ["暖场段子一", "暖场段子二"] });
  });

describe("computeOpenMicTier 段位阈值", () => {
  it("平均分 <30 判冷场", () => {
    expect(computeOpenMicTier(10).tier).toBe("冷场");
    expect(computeOpenMicTier(29).tier).toBe("冷场");
  });
  it("平均分 30-60 判尚可", () => {
    expect(computeOpenMicTier(30).tier).toBe("尚可");
    expect(computeOpenMicTier(45).tier).toBe("尚可");
    expect(computeOpenMicTier(59).tier).toBe("尚可");
  });
  it("平均分 60-85 判炸场", () => {
    expect(computeOpenMicTier(60).tier).toBe("炸场");
    expect(computeOpenMicTier(85).tier).toBe("炸场");
  });
  it("平均分 >85 判今日之星", () => {
    expect(computeOpenMicTier(86).tier).toBe("今日之星");
    expect(computeOpenMicTier(100).tier).toBe("今日之星");
  });
});

describe("scorePlayerJoke 三维度评分", () => {
  it("解析 LLM 返回的 punchline/pacing/resonance/reaction/note", async () => {
    const chat = makeChat(() =>
      JSON.stringify({ punchline: 30, pacing: 20, resonance: 22, reaction: "applaud", note: "包袱脆" }),
    );
    const r = await scorePlayerJoke("今天去面试，HR 问我最大的缺点，我说太诚实。", chat);
    expect(r.scores).toEqual({ punchline: 30, pacing: 20, resonance: 22 });
    expect(r.total).toBe(72); // 30+20+22
    expect(r.reaction).toBe("applaud");
    expect(r.note).toBe("包袱脆");
  });

  it("维度超出上限时 clamp 到 40/30/30", async () => {
    const chat = makeChat(() =>
      JSON.stringify({ punchline: 99, pacing: 99, resonance: 99, reaction: "applaud", note: "x" }),
    );
    const r = await scorePlayerJoke("一个段子", chat);
    expect(r.scores.punchline).toBeLessThanOrEqual(40);
    expect(r.scores.pacing).toBeLessThanOrEqual(30);
    expect(r.scores.resonance).toBeLessThanOrEqual(30);
    expect(r.total).toBe(100);
  });

  it("非法 reaction 时按总分回落档位", async () => {
    const chat = makeChat(() =>
      JSON.stringify({ punchline: 4, pacing: 3, resonance: 2, reaction: "???" }),
    );
    const r = await scorePlayerJoke("太冷了", chat);
    expect(r.reaction).toBe("silence"); // total=9 → <35
  });

  it("LLM 失败时走兜底评分，流程不中断", async () => {
    const chat = async () => { throw new Error("boom"); };
    const r = await scorePlayerJoke("一个普通段子", chat);
    expect(r.scores.punchline).toBeGreaterThanOrEqual(0);
    expect(r.scores.punchline).toBeLessThanOrEqual(40);
    expect(r.scores.pacing).toBeGreaterThanOrEqual(0);
    expect(r.scores.pacing).toBeLessThanOrEqual(30);
    expect(r.scores.resonance).toBeGreaterThanOrEqual(0);
    expect(r.scores.resonance).toBeLessThanOrEqual(30);
    expect(typeof r.note).toBe("string");
  });
});

describe("detectCallback 回扣关键词检测", () => {
  it("真引用前段子关键词 → hit", () => {
    const prev = "我老板凌晨三点在公司群里发消息，问我方案做完没。";
    const cur = "说到我那个老板，凌晨三点还在群里@我，这不就是上次说过的那个老板吗？";
    const r = detectCallback(prev, cur);
    expect(r.hit).toBe(true);
    expect(r.keywords.length).toBeGreaterThan(0);
  });

  it("完全无关的新段子 → miss", () => {
    const prev = "我老板凌晨三点在公司群里发消息，问我方案做完没。";
    const cur = "今天点了个麻辣香锅外卖，结果骑手迟到了四十分钟。";
    const r = detectCallback(prev, cur);
    expect(r.hit).toBe(false);
  });

  it("extractKeywords 能抽出有辨识度的词组", () => {
    const kws = extractKeywords("我老板凌晨三点在公司群里发消息");
    expect(kws).toContain("老板");
    expect(kws).toContain("凌晨");
    expect(kws).toContain("消息");
  });
});

describe("upgradeReaction 反应升档", () => {
  it("silence → roast → mixed → applaud", () => {
    expect(upgradeReaction("silence")).toBe("roast");
    expect(upgradeReaction("roast")).toBe("mixed");
    expect(upgradeReaction("mixed")).toBe("applaud");
    expect(upgradeReaction("applaud")).toBe("applaud");
  });
});

describe("reactionFromScore 总分映射", () => {
  it("阈值正确", () => {
    expect(reactionFromScore(90)).toBe("applaud");
    expect(reactionFromScore(70)).toBe("mixed");
    expect(reactionFromScore(50)).toBe("roast");
    expect(reactionFromScore(20)).toBe("silence");
  });
});

describe("OpenMicSession 状态流转（R2）", () => {
  it("start → picking_topic；pickTopic 后才能讲段子", async () => {
    const session = createOpenMicSession(dimChat());
    const started = await session.start();
    expect(started.stage).toBe("picking_topic");
    expect(TOPIC_LIBRARY.length).toBe(4);

    // 没选话题就讲 → 抛错
    await expect(session.tellJoke("一个段子")).rejects.toThrow();

    const picked = await session.pickTopic("workplace");
    expect(picked.stage).toBe("performing");
    expect(picked.topic?.label).toBe("职场吐槽");
    expect(picked.jokeTimeLimitMs).toBe(60_000);
  });

  it("讲 3 段：三维度评分累积、callbackOptions 递增、finish 出金句卡", async () => {
    const chat = dimChat({ punchline: 30, pacing: 20, resonance: 20, reaction: "applaud", note: "响了" });
    const session = createOpenMicSession(chat);
    await session.start();
    await session.pickTopic("dating");

    const j1 = await session.tellJoke("相亲对象一上来就问我有没有房。");
    expect(j1.result.scores).toEqual({ punchline: 30, pacing: 20, resonance: 20 });
    expect(j1.result.total).toBe(70);
    expect(j1.state.callbackOptions.length).toBe(1); // 第 1 段后可回调
    expect(j1.state.callbackOptions[0].index).toBe(0);

    const j2 = await session.tellJoke("又是相亲，这次她问我车是什么牌子。");
    expect(j2.state.callbackOptions.length).toBe(2);

    const j3 = await session.tellJoke("最后我发现，她问的这些我一个都答不上来。");
    expect(j3.state.currentJokeIndex).toBe(3);

    const done = await session.finish();
    expect(done.average).toBe(70);
    expect(done.tier).toBe("炸场"); // 70 落 60-85
    expect(done.state.stage).toBe("results");
    expect(done.goldJoke).toBeTruthy();
    expect(done.goldJoke.total).toBe(70);
  });

  it("真 callback → resonance+15、reaction 升档", async () => {
    const chat = dimChat({ punchline: 20, pacing: 15, resonance: 10, reaction: "roast", note: "一般" });
    const session = createOpenMicSession(chat);
    await session.start();
    await session.pickTopic("family");

    await session.tellJoke("我妈又在家庭群里转发说喝热水能治百病。");
    // 第 2 段真的提到「我妈」「家庭群」
    const cb = await session.tellJoke(
      "说到我妈那个家庭群，昨天她又转发了一条，说隔夜水致癌。",
      { callbackTo: 0 },
    );
    expect(cb.result.callbackHit).toBe(true);
    // resonance 10 + 15 = 25（≤30）
    expect(cb.result.scores.resonance).toBe(25);
    // reaction roast → mixed
    expect(cb.result.reaction).toBe("mixed");
  });

  it("假 callback（点了回扣但没引用关键词）→ 吐槽覆盖、不加分", async () => {
    const chat = dimChat({ punchline: 20, pacing: 15, resonance: 20, reaction: "mixed", note: "原本吐槽" });
    const session = createOpenMicSession(chat);
    await session.start();
    await session.pickTopic("life");

    await session.tellJoke("健身房办了年卡，一年就去了三次。");
    const fake = await session.tellJoke(
      "今天外卖凑单凑到起送价，结果汤洒了一半。",
      { callbackTo: 0 },
    );
    expect(fake.result.callbackHit).toBe(false);
    expect(fake.result.scores.resonance).toBe(20); // 没 +15
    expect(fake.result.note).toContain("call back");
  });

  it("switchTopic 换话题：state.topic 跟随更新", async () => {
    const chat = dimChat();
    const session = createOpenMicSession(chat);
    await session.start();
    await session.pickTopic("workplace");

    await session.tellJoke("周一早会老板又画饼。");
    const j2 = await session.tellJoke("我妈又催我相亲了。", { switchTopic: "family" });
    expect(j2.result.topic).toBe("我妈/我爸");
    expect(j2.state.topic?.id).toBe("family");
  });

  it("非法 callbackTo 抛错；讲完再讲抛错", async () => {
    const chat = dimChat();
    const session = createOpenMicSession(chat);
    await session.start();
    await session.pickTopic("workplace");
    await session.tellJoke("a");
    await expect(session.tellJoke("b", { callbackTo: 99 })).rejects.toThrow();
    await session.tellJoke("b");
    await session.tellJoke("c");
    await expect(session.tellJoke("d")).rejects.toThrow();
  });
});
