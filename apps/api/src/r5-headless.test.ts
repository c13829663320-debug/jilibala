// ============================================================================
// R5 · 三场景无头验证：用引擎层跑完一整局，校验
//   高光捕捉 / 关系变化非空且数值正确 / 连胜更新 / 战果卡字段完整 / 翻盘检测。
// beforeAll 里先把 DB / profiles / relationships 指到独立临时目录，再动态 import。
// ============================================================================
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = mkdtempSync(join(tmpdir(), "r5-headless-"));
process.env.DB_PATH = join(ROOT, "db", "app.db");
process.env.PROFILES_DIR = join(ROOT, "profiles");
process.env.RELATIONSHIPS_DIR = join(ROOT, "relationships");

type TalkshowMod = typeof import("./talkshow-engine.js");
type WerewolfMod = typeof import("./werewolf-engine.js");
type BarMod = typeof import("./bar-engine.js");
type R5Mod = typeof import("./r5-settlement.js");

let TalkshowOrchestrator: TalkshowMod["TalkshowOrchestrator"];
let WerewolfEngine: WerewolfMod["WerewolfEngine"];
let MAX_DAYS: WerewolfMod["MAX_DAYS"];
let BarEngine: BarMod["BarEngine"];
let applyR5Settlement: R5Mod["applyR5Settlement"];
type R5Meta = R5Mod["R5Meta"];
let getRelationship: typeof import("./relationship.js")["getRelationship"];
let loadServerProfile: typeof import("./db.js")["loadServerProfile"];
type JokeScores = import("./talkshow-orchestrator.js").JokeDimensionScores;
type OpenMic = import("./talkshow-orchestrator.js").OpenMicReaction;
type WWRole = import("@balabala/shared").WerewolfRole;
type ArgAngle = import("./bar-orchestrator.js").ArgumentAngle;
type ArgScore = import("./bar-orchestrator.js").ArgumentScore;

const WW_ROLES: WWRole[] = [
  "villager", "werewolf", "seer", "witch", "hunter",
  "villager", "villager", "villager", "villager",
];

beforeAll(async () => {
  const rel = await import("./relationship.js");
  // 专门的测试钩子：mkdir + 生效 __REL_DIR（DEFAULT_DIR 路径不会自动建目录）。
  rel.configureRelationshipsForTest(join(ROOT, "relationships"));
  getRelationship = rel.getRelationship;

  const ts = await import("./talkshow-engine.js");
  TalkshowOrchestrator = ts.TalkshowOrchestrator;
  const ww = await import("./werewolf-engine.js");
  WerewolfEngine = ww.WerewolfEngine;
  MAX_DAYS = ww.MAX_DAYS;
  const bar = await import("./bar-engine.js");
  BarEngine = bar.BarEngine;
  const r5 = await import("./r5-settlement.js");
  applyR5Settlement = r5.applyR5Settlement;
  const db = await import("./db.js");
  loadServerProfile = db.loadServerProfile;
});

function queueScorer(queue: JokeScores[]) {
  let i = 0;
  return async () => {
    const scores = queue[Math.min(i, queue.length - 1)];
    i += 1;
    const total = scores.punchline + scores.pacing + scores.resonance;
    const reaction: OpenMic = total >= 80 ? "applaud" : total >= 60 ? "mixed" : total >= 35 ? "roast" : "silence";
    return { scores, total, reaction, note: "无头验证" };
  };
}

async function runTalkshow(queue: JokeScores[], userId: string) {
  const e = new TalkshowOrchestrator();
  e.start({ totalJokes: 3, jokeTimeLimitMs: 60_000, scorer: queueScorer(queue) });
  e.act({ kind: "pick_topic", topicId: "workplace" });
  for (let k = 0; k < 3; k += 1) await e.performJoke(`段子${k + 1}`);
  expect(e.phase).toBe("results");
  const result = e.settle();
  const meta = e.collectR5Meta();
  const bundle = applyR5Settlement(userId, "talkshow", result, meta);
  return { meta, bundle };
}

describe("R5 无头验证 · 脱口秀", () => {
  it("翻盘局：低开高走 → comeback=true，普通局 comeback=false", async () => {
    const { meta: comebackMeta } = await runTalkshow(
      [
        { punchline: 5, pacing: 3, resonance: 2 },
        { punchline: 20, pacing: 15, resonance: 15 },
        { punchline: 40, pacing: 30, resonance: 30 },
      ],
      "r5-ts-comeback",
    );
    expect(comebackMeta.comeback).toBe(true);

    const { meta: normalMeta } = await runTalkshow(
      [
        { punchline: 28, pacing: 22, resonance: 20 },
        { punchline: 30, pacing: 23, resonance: 22 },
        { punchline: 28, pacing: 22, resonance: 20 },
      ],
      "r5-ts-normal",
    );
    expect(normalMeta.comeback).toBe(false);
  });

  it("高光 golden_quote + 关系变化非空 + 战果卡完整 + 连胜更新", async () => {
    const { meta, bundle } = await runTalkshow(
      [
        { punchline: 30, pacing: 25, resonance: 25 },
        { punchline: 45, pacing: 30, resonance: 25 },
        { punchline: 40, pacing: 35, resonance: 30 },
      ],
      "r5-ts-user1",
    );
    expect(meta.highlights.some((h) => h.type === "golden_quote")).toBe(true);
    expect(bundle.relationshipChanges.length).toBe(4);
    for (const c of bundle.relationshipChanges) {
      expect(typeof c.delta).toBe("number");
      expect(c.fromType).toBeTruthy();
    }
    expect(bundle.resultCard.scene).toBe("talkshow");
    expect(bundle.resultCard.score).toBeGreaterThan(0);
    expect(bundle.resultCard.opponent.id).toBeTruthy();
    expect(bundle.streak.current).toBeGreaterThanOrEqual(1);
    expect(getRelationship("r5-ts-user1", bundle.relationshipChanges[0].celebrityId)).toBeTruthy();
    const prof = loadServerProfile("r5-ts-user1");
    expect(prof.stats?.talkshow?.played).toBeGreaterThan(0);
  });
});

describe("R5 无头验证 · 狼人杀", () => {
  it("跑完整局：高光 + 关系变化 + 战果卡 + 阵营胜负映射", () => {
    const e = new WerewolfEngine({
      rand: () => 0.5,
      ai: {
        wolfKill: (_w, c) => c.find((s) => s !== 0) ?? c[0],
        seerCheck: (_s, c) => c[0],
        witch: () => ({ heal: false, poison: null }),
        vote: (_v, c) => c.find((s) => s === 1) ?? c[0],
        hunterShot: (_h, c) => c[0] ?? null,
      },
    });
    e.setup({ forceRoles: WW_ROLES });
    let over = false;
    for (let i = 0; i < MAX_DAYS + 1 && !over; i += 1) over = e.playOneDay();
    expect(over).toBe(true);
    expect(e.phase).toBe("results");

    const result = e.settle();
    const meta: R5Meta = e.collectR5Meta();
    expect(meta.outcome).toBe("win");
    expect(meta.highlights.some((h) => h.type === "prophet_vote")).toBe(true);

    const bundle = applyR5Settlement("r5-ww-user1", "werewolf", result, meta);
    expect(bundle.relationshipChanges.length).toBeGreaterThan(0);
    expect(bundle.resultCard.scene).toBe("werewolf");
    expect(bundle.streak.current).toBeGreaterThanOrEqual(1);
    expect(getRelationship("r5-ww-user1", bundle.relationshipChanges[0].celebrityId)).toBeTruthy();
  });
});

describe("R5 无头验证 · 酒吧", () => {
  it("三回合全克制：epic_rebuttal + perfect_debate + 关系变化", () => {
    const scoreHook = (
      _t: string, side: "player" | "pro" | "con", _a: ArgAngle, _c: string,
    ): ArgScore => (side === "player" ? { content_quality: 10, relevance: 10 } : { content_quality: 0, relevance: 0 });
    let i = 0;
    const randSeq = [0.5, 0, 0.5, 0, 0.5, 0];
    const e = new BarEngine({ score: scoreHook, rand: () => randSeq[i++ % randSeq.length] });
    e.setup({ topic: "AI 会不会取代人类的工作？", playerSide: "pro" });
    for (let r = 0; r < 3; r += 1) e.resolveTurn("data", "发言");
    e.judge();
    expect(e.phase).toBe("results");

    const result = e.settle();
    const meta = e.collectR5Meta();
    expect(meta.highlights.some((h) => h.type === "epic_rebuttal")).toBe(true);
    expect(meta.highlights.some((h) => h.type === "perfect_round")).toBe(true);
    expect(meta.outcome).toBe("win");

    const bundle = applyR5Settlement("r5-bar-user1", "bar", result, meta);
    expect(bundle.relationshipChanges.length).toBe(1);
    expect(bundle.resultCard.opponent.id).toBe("warren-buffett");
    expect(bundle.streak.current).toBeGreaterThanOrEqual(1);
  });
});
