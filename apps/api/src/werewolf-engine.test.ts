// ===== WerewolfEngine 单测：昼夜循环 / 胜负 / 动作牌 / 超时fallback / AI填充 / 推理分 / 隐私 =====
import { describe, expect, it } from "vitest";
import { WerewolfEngine, MAX_DAYS, SEAT_COUNT } from "./werewolf-engine.js";
import type { WerewolfRole } from "@balabala/shared";

/** 固定身份：seat0=真人村民，seat1=狼，seat2=预言家，seat3=女巫，seat4=猎人，其余村民。 */
const ROLES: WerewolfRole[] = [
  "villager", "werewolf", "seer", "witch", "hunter",
  "villager", "villager", "villager", "villager",
];

function makeEngine(overrides: Partial<{
  vote: (v: number, c: number[]) => number | null;
  wolfKill: (w: number, c: number[]) => number;
  hunterShot: (h: number, c: number[]) => number | null;
}> = {}) {
  return new WerewolfEngine({
    rand: () => 0.5,
    ai: {
      // 默认狼刀：刀一个非真人的好人，保证真人活到白天
      wolfKill: overrides.wolfKill ?? ((_w, c) => c.find((s) => s !== 0) ?? c[0]),
      seerCheck: (_s, c) => c[0],
      witch: () => ({ heal: false, poison: null }),
      // 默认投票：好人投已知狼 seat1，狼投别人
      vote: overrides.vote ?? ((_v, c) => c.find((s) => s === 1) ?? c[0]),
      hunterShot: overrides.hunterShot ?? ((_h, c) => c[0] ?? null),
    },
  });
}

describe("WerewolfEngine · 槽位与 AI 填充", () => {
  it("9 席，真人恒占 slot-0，其余 AI", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES });
    expect(e.playerSlots).toHaveLength(SEAT_COUNT);
    expect(e.playerSlots[0].isHuman).toBe(true);
    expect(e.playerSlots[0].slotId).toBe("slot-0");
    expect(e.playerSlots.slice(1).every((s) => !s.isHuman)).toBe(true);
  });
});

describe("WerewolfEngine · 昼夜循环", () => {
  it("一个昼夜走完：night → announce → speech → vote", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES });
    expect(e.state.sub).toBe("lobby");
    const over = e.playOneDay();
    // seat1 是唯一狼，AI vote 全投 seat1（c[0] 排除自己后第一个是 seat1），应被放逐 → 好人胜
    expect(over).toBe(true);
    expect(e.state.winner).toBe("good");
    expect(e.state.sub).toBe("ended");
  });

  it("未分胜负则 day 递增，最多 MAX_DAYS 天", () => {
    // 让 AI 永远投自己以外的第一个好人（不投狼），狼杀不完 → 打到上限强制裁定
    const e = makeEngine({
      wolfKill: (_w, c) => c[c.length - 1],
      vote: (v, c) => c.find((s) => s !== 1) ?? null, // 永不投狼 seat1
    });
    e.setup({ forceRoles: ROLES });
    let day = e.state.day;
    let ended = false;
    for (let i = 0; i < MAX_DAYS + 1 && !ended; i += 1) {
      ended = e.playOneDay();
      day = e.state.day;
    }
    expect(ended).toBe(true);
    expect(e.state.day).toBeLessThanOrEqual(MAX_DAYS);
    expect(e.state.winner).not.toBeNull();
  });
});

describe("WerewolfEngine · 胜负判定", () => {
  it("狼=0 → 好人胜", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES });
    // 直接构造：只剩好人
    for (const p of e.state.players) if (p.role === "werewolf") p.alive = false;
    expect(e.checkWin()).toBe(true);
    expect(e.state.winner).toBe("good");
  });

  it("狼 ≥ 存活好人 → 狼胜", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ["villager", "werewolf", "werewolf", "witch", "hunter", "villager", "villager", "villager", "villager"] });
    for (const p of e.state.players) p.alive = false;
    e.state.players[1].alive = true; // 狼
    e.state.players[2].alive = true; // 狼
    e.state.players[0].alive = true; // 1 好人 → 2 狼 ≥ 1 好人
    expect(e.checkWin()).toBe(true);
    expect(e.state.winner).toBe("wolf");
  });
});

describe("WerewolfEngine · 白天动作牌", () => {
  it("suspect 记录公开动作牌", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES });
    e.runNight(); e.runDayAnnounce(); e.beginSpeech();
    const r = e.submitDayAction({ kind: "suspect", seat: 3 });
    expect(r.ok).toBe(true);
    expect(e.state.dayActions).toHaveLength(1);
    expect(e.state.dayActions[0].action).toMatchObject({ kind: "suspect", seat: 3 });
  });

  it("非预言家 report_check 被拒", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES }); // 真人 seat0 = villager
    e.beginSpeech();
    const r = e.submitDayAction({ kind: "report_check", seat: 1, isWolf: false });
    expect(r.ok).toBe(false);
  });

  it("预言家 report_check 只能报真实验人结果", () => {
    const e = makeEngine({ seerCheck: (_s, c) => c[0] });
    // 真人 seat0 = seer
    const roles: WerewolfRole[] = ["seer", "werewolf", "villager", "witch", "hunter", "villager", "villager", "villager", "villager"];
    e.setup({ forceRoles: roles });
    e.runNight(); // seerCheck → c[0] = seat1 (狼)
    e.runDayAnnounce(); e.beginSpeech();
    const r = e.submitDayAction({ kind: "report_check", seat: 1, isWolf: false });
    expect(r.ok).toBe(true);
    // 实际 seat1 是狼，被纠正为 true
    const rec = e.state.dayActions[0].action;
    expect(rec.kind === "report_check" && rec.isWolf).toBe(true);
  });
});

describe("WerewolfEngine · 超时 fallback（AI 代打）", () => {
  it("真人狼未提交刀人 → AI 钩子代打，仍产出 killTarget", () => {
    const e = makeEngine();
    const roles: WerewolfRole[] = ["werewolf", "villager", "villager", "witch", "hunter", "villager", "villager", "villager", "villager"];
    e.setup({ forceRoles: roles });
    // 真人是狼，但不预提交 night_kill
    e.runNight();
    expect(e.state.killTarget).not.toBeNull();
    // 刀的应是 AI 钩子返回的好人候选
    expect(e.state.killTarget).toBe(1); // c[0] of aliveGood
  });

  it("真人未投票 → AI 钩子代打", () => {
    const e = makeEngine();
    e.setup({ forceRoles: ROLES });
    e.runNight(); e.runDayAnnounce(); e.beginSpeech(); e.endSpeech();
    e.runVote();
    // 真人未设 humanVote，应落进 votes
    expect(e.state.votes[0]).not.toBeUndefined();
  });
});

describe("WerewolfEngine · 推理分", () => {
  it("投对狼 +10", () => {
    const e = makeEngine({ vote: (_v, c) => c.find((s) => s === 1) ?? c[0] });
    e.setup({ forceRoles: ROLES }); // seat1 狼
    e.state.humanVote = 1; // 真人投狼
    e.runNight(); e.runDayAnnounce(); e.beginSpeech(); e.endSpeech();
    e.runVote();
    expect(e.getScore("slot-0")).toBe(10);
  });

  it("真人是狼被放逐 -5", () => {
    const e = makeEngine({ vote: (_v, c) => c.find((s) => s === 0) ?? c[0] });
    const roles: WerewolfRole[] = ["werewolf", "villager", "villager", "witch", "hunter", "villager", "villager", "villager", "villager"];
    e.setup({ forceRoles: roles });
    e.runNight(); e.runDayAnnounce(); e.beginSpeech(); e.endSpeech();
    e.state.humanVote = 1; // 真人狼投别人
    e.runVote(); // AI 全投 seat0 → 真人狼被放逐
    expect(e.getScore("slot-0")).toBe(-5);
  });

  it("存活到终局 +20", () => {
    const e = makeEngine({ vote: (_v, c) => c.find((s) => s === 1) ?? c[0] });
    e.setup({ forceRoles: ROLES });
    e.state.humanVote = 1;
    const over = e.playOneDay(); // 放逐 seat1 狼 → 好人胜，真人存活
    expect(over).toBe(true);
    // +10（投对狼） +20（存活）
    expect(e.getScore("slot-0")).toBe(30);
  });
});

describe("WerewolfEngine · 私密信息不泄露", () => {
  it("真人(预言家)视角有 seerResults，AI 视角无任何私密字段", () => {
    const e = makeEngine();
    const roles: WerewolfRole[] = ["seer", "werewolf", "villager", "witch", "hunter", "villager", "villager", "villager", "villager"];
    e.setup({ forceRoles: roles });
    e.runNight(); // seer 查 seat1
    const mine = e.getPrivateSnapshot(0);
    expect(mine.myRole).toBe("seer");
    expect(mine.seerResults?.length).toBe(1);
    expect(mine.wolfTeammates).toBeUndefined();

    const other = e.getPrivateSnapshot(1);
    expect(other.myRole).toBeUndefined();
    expect(other.mySeat).toBeUndefined();
    expect(other.seerResults).toBeUndefined();
    expect(other.wolfTeammates).toBeUndefined();
    // 公开视图里所有玩家都不带 role
    for (const p of other.players) expect("role" in p).toBe(false);
  });

  it("狼人视角可见狼队友，外人不可见", () => {
    const e = makeEngine();
    const roles: WerewolfRole[] = ["werewolf", "werewolf", "villager", "witch", "hunter", "villager", "villager", "villager", "villager"];
    e.setup({ forceRoles: roles });
    const mine = e.getPrivateSnapshot(0);
    expect(mine.wolfTeammates).toEqual([1]);
    const other = e.getPrivateSnapshot(2);
    expect(other.wolfTeammates).toBeUndefined();
  });
});
