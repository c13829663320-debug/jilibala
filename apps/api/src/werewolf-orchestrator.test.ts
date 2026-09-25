// ===== werewolf-orchestrator 测试：状态机 / 视角过滤 / 信息隔离 / 胜负判定 =====
// 策略：chatProvider 注入一个永不 resolve 的 Promise，让 runNight 在第一个 AI 狼人
// 决策处挂起（不注册任何定时器、不发任何真实网络请求），从而同步观测 startGame 后的
// 权威状态；所有私密信息通过 sendToUser spy 单独断言。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type WerewolfModule = typeof import("./werewolf-orchestrator.js");
type DbModule = typeof import("./db.js");

/** 内部游戏结构（未导出）的最小测试镜像。 */
interface InternalGame {
  phase: string;
  day: number;
  nightStage: string;
  winner: "wolf" | "good" | null;
  players: Array<{
    seat: number; userId: string; nickname: string;
    isAI: boolean; role: string; alive: boolean;
  }>;
  nightState: { wolfVotes: Map<number, number>; killTarget: number | null };
  timers: Set<unknown>;
}

async function loadWerewolf(): Promise<{
  mod: WerewolfModule;
  dbmod: DbModule;
  dir: string;
  broadcast: ReturnType<typeof vi.fn>;
  sendToUser: ReturnType<typeof vi.fn>;
}> {
  const dir = mkdtempSync(join(tmpdir(), "balabwolf-"));
  process.env.DB_PATH = join(dir, "test.db");
  vi.resetModules();
  const mod = await import("./werewolf-orchestrator.js");
  // 与 werewolf 模块共享同一 db 模块实例，便于测试结束后关闭句柄。
  const dbmod = await import("./db.js");
  const broadcast = vi.fn();
  const sendToUser = vi.fn();
  mod.setBroadcastCallbacks(broadcast, sendToUser);
  // 永不 resolve：runNight 在首个 AI 狼人 await 处挂起，无定时器、无网络。
  mod.setChatProvider(() => new Promise<string>(() => {}));
  return { mod, dbmod, dir, broadcast, sendToUser };
}

function getInternal(mod: WerewolfModule, gameId: string): InternalGame {
  return mod.getGame(gameId) as unknown as InternalGame;
}

function startOneHumanGame(mod: WerewolfModule, hostId = "host-1"): string {
  const gameId = mod.createGame(hostId);
  mod.joinGame(gameId, hostId, { nickname: "主人", avatarType: "capsule", avatarRef: "" });
  mod.startGame(gameId, hostId);
  return gameId;
}

describe("werewolf 大厅与开局", () => {
  let ctx: { mod: WerewolfModule; dbmod: DbModule; dir: string; broadcast: ReturnType<typeof vi.fn>; sendToUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ctx = await loadWerewolf();
  });

  afterAll(() => {
    try {
      ctx.dbmod.db.close();
    } catch {
      // ignore
    }
    delete process.env.DB_PATH;
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄可能延迟释放
    }
  });

  it("createGame：初始阶段 lobby、空玩家", () => {
    const gameId = ctx.mod.createGame("h");
    const g = getInternal(ctx.mod, gameId);
    expect(g.phase).toBe("lobby");
    expect(g.players.length).toBe(0);
  });

  it("joinGame：真人玩家入座 0 号座位", () => {
    const gameId = ctx.mod.createGame("h");
    const seat = ctx.mod.joinGame(gameId, "h", { nickname: "我", avatarType: "capsule", avatarRef: "" });
    expect(seat).toEqual({ seat: 0 });
  });

  it("joinGame：同一用户重复加入返回原座位，不重复占座", () => {
    const gameId = ctx.mod.createGame("h");
    ctx.mod.joinGame(gameId, "h", { nickname: "我", avatarType: "capsule", avatarRef: "" });
    const again = ctx.mod.joinGame(gameId, "h", { nickname: "我", avatarType: "capsule", avatarRef: "" });
    expect(again).toEqual({ seat: 0 });
    const g = getInternal(ctx.mod, gameId);
    expect(g.players.length).toBe(1);
  });

  it("joinGame：游戏开始后（非 lobby）拒绝新人加入", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const late = ctx.mod.joinGame(gameId, "late-joiner", { nickname: "迟到", avatarType: "capsule", avatarRef: "" });
    expect(late).toBeNull();
  });

  it("startGame：非房主调用被拒绝", () => {
    const gameId = ctx.mod.createGame("host-real");
    ctx.mod.joinGame(gameId, "host-real", { nickname: "房主", avatarType: "capsule", avatarRef: "" });
    ctx.mod.startGame(gameId, "someone-else");
    const g = getInternal(ctx.mod, gameId);
    expect(g.phase).toBe("lobby");
  });

  it("startGame：lobby -> night 同步推进，并广播 phase_change", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    expect(g.phase).toBe("night");
    expect(g.nightStage).toBe("wolf");
    const sawNight = ctx.broadcast.mock.calls.some(
      ([, ev]) => ev.type === "phase_change" && ev.phase === "night",
    );
    expect(sawNight).toBe(true);
  });

  it("startGame：空位自动补 AI 名人（共 9 席，8 个 AI）", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    expect(g.players.length).toBe(9);
    const ai = g.players.filter((p) => p.isAI);
    expect(ai.length).toBe(8);
    expect(g.players.find((p) => p.userId === "host-1")!.isAI).toBe(false);
    // AI 玩家使用 ai:<seat> 作为占位 userId。
    expect(ai.every((p) => p.userId.startsWith("ai:"))).toBe(true);
  });

  it("startGame：身份分配符合 3狼/1预言家/1女巫/1猎人/3村民", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const byRole = (r: string) => g.players.filter((p) => p.role === r).length;
    expect(byRole("werewolf")).toBe(3);
    expect(byRole("seer")).toBe(1);
    expect(byRole("witch")).toBe(1);
    expect(byRole("hunter")).toBe(1);
    expect(byRole("villager")).toBe(3);
  });
});

describe("werewolf 视角过滤与信息隔离", () => {
  let ctx: { mod: WerewolfModule; dbmod: DbModule; dir: string; broadcast: ReturnType<typeof vi.fn>; sendToUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ctx = await loadWerewolf();
  });

  afterAll(() => {
    try {
      ctx.dbmod.db.close();
    } catch {
      // ignore
    }
    delete process.env.DB_PATH;
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄可能延迟释放
    }
  });

  it("公开快照：players 数组绝不携带 role 字段", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const snap = ctx.mod.getSnapshotForPlayer(gameId, "host-1");
    expect(snap.players.length).toBe(9);
    for (const p of snap.players) {
      expect((p as unknown as Record<string, unknown>).role).toBeUndefined();
    }
  });

  it("狼人视角：狼人快照含 wolfTeammates，村民快照不含", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const wolfSeat = g.players.find((p) => p.role === "werewolf")!;
    const villagerSeat = g.players.find((p) => p.role === "villager")!;

    const wolfSnap = ctx.mod.getSnapshotForPlayer(gameId, wolfSeat.userId);
    const villagerSnap = ctx.mod.getSnapshotForPlayer(gameId, villagerSeat.userId);

    expect(wolfSnap.myRole).toBe("werewolf");
    expect(Array.isArray(wolfSnap.wolfTeammates)).toBe(true);
    expect(wolfSnap.wolfTeammates!.length).toBe(2); // 另外两只狼
    expect(villagerSnap.myRole).toBe("villager");
    expect(villagerSnap.wolfTeammates).toBeUndefined();
  });

  it("角色私密信息：预言家有 seerResults、女巫有 witchPotions，互相看不到", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const seer = g.players.find((p) => p.role === "seer")!;
    const witch = g.players.find((p) => p.role === "witch")!;
    const villager = g.players.find((p) => p.role === "villager")!;

    const seerSnap = ctx.mod.getSnapshotForPlayer(gameId, seer.userId);
    const witchSnap = ctx.mod.getSnapshotForPlayer(gameId, witch.userId);
    const villagerSnap = ctx.mod.getSnapshotForPlayer(gameId, villager.userId);

    expect(Array.isArray(seerSnap.seerResults)).toBe(true);
    expect(witchSnap.witchPotions).toEqual({ heal: true, poison: true });
    // 女巫看不到预言家的查验结果，村民两边都没有。
    expect(witchSnap.seerResults).toBeUndefined();
    expect(villagerSnap.seerResults).toBeUndefined();
    expect(villagerSnap.witchPotions).toBeUndefined();
  });

  it("旁观者视角：从未加入的用户拿不到任何私密字段", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const snap = ctx.mod.getSnapshotForPlayer(gameId, "totally-audience");
    expect(snap.myRole).toBeUndefined();
    expect(snap.mySeat).toBeUndefined();
    expect(snap.wolfTeammates).toBeUndefined();
    expect(snap.seerResults).toBeUndefined();
    expect(snap.witchPotions).toBeUndefined();
    // 但公开玩家列表仍在。
    expect(snap.players.length).toBe(9);
  });

  it("广播通道：所有 broadcast 事件不包含角色/狼人队友等私密字段", () => {
    const gameId = startOneHumanGame(ctx.mod);
    void gameId;
    for (const [, ev] of ctx.broadcast.mock.calls) {
      const rec = ev as unknown as Record<string, unknown>;
      expect(rec.role).toBeUndefined();
      expect(rec.wolfTeammates).toBeUndefined();
      expect(rec.myRole).toBeUndefined();
      // 公开玩家对象（player_joined）也不应带 role。
      if (rec.player && typeof rec.player === "object") {
        expect((rec.player as Record<string, unknown>).role).toBeUndefined();
      }
    }
  });

  it("sendToUser：每个真人只收到自己视角的快照，host 的 myRole 与真实身份一致", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const host = g.players.find((p) => p.userId === "host-1")!;

    const hostCalls = ctx.sendToUser.mock.calls.filter(([, uid]) => uid === "host-1");
    expect(hostCalls.length).toBeGreaterThan(0);
    const lastMsg = hostCalls[hostCalls.length - 1][2] as { snapshot: { myRole?: string } };
    expect(lastMsg.snapshot.myRole).toBe(host.role);
  });
});

describe("werewolf 行动与胜负", () => {
  let ctx: { mod: WerewolfModule; dbmod: DbModule; dir: string; broadcast: ReturnType<typeof vi.fn>; sendToUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ctx = await loadWerewolf();
  });

  afterAll(() => {
    try {
      ctx.dbmod.db.close();
    } catch {
      // ignore
    }
    delete process.env.DB_PATH;
    try {
      rmSync(ctx.dir, { recursive: true, force: true });
    } catch {
      // Windows 句柄可能延迟释放
    }
  });

  it("night_kill：狼人投票记入 nightState.wolfVotes", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const host = g.players.find((p) => p.userId === "host-1")!;
    // 强制 host 为狼人，便于 deterministic 测试。
    host.role = "werewolf";
    const target = g.players.find((p) => p.role !== "werewolf" && p.alive)!;

    ctx.mod.handleAction(gameId, "host-1", { type: "night_kill", targetSeat: target.seat });

    expect(g.nightState.wolfVotes.get(host.seat)).toBe(target.seat);
  });

  it("night_kill：非狼人 / 刀狼人 / 刀死人 一律被忽略", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const host = g.players.find((p) => p.userId === "host-1")!;
    host.role = "villager"; // 好人

    ctx.mod.handleAction(gameId, "host-1", { type: "night_kill", targetSeat: 1 });
    expect(g.nightState.wolfVotes.size).toBe(0);

    // 强制 host 变狼，但目标也设成狼。
    host.role = "werewolf";
    const anotherWolf = g.players.find((p) => p.role === "werewolf" && p.seat !== host.seat)!;
    ctx.mod.handleAction(gameId, "host-1", { type: "night_kill", targetSeat: anotherWolf.seat });
    expect(g.nightState.wolfVotes.size).toBe(0);

    // 目标已死。
    const good = g.players.find((p) => p.role !== "werewolf")!;
    good.alive = false;
    ctx.mod.handleAction(gameId, "host-1", { type: "night_kill", targetSeat: good.seat });
    expect(g.nightState.wolfVotes.size).toBe(0);
  });

  it("checkWin：狼人全灭 -> 好人胜", () => {
    const game = {
      players: [
        { alive: true, role: "villager" },
        { alive: true, role: "seer" },
        { alive: false, role: "werewolf" },
      ],
      winner: null,
    };
    const ended = ctx.mod.checkWin(game as never);
    expect(ended).toBe(true);
    expect(game.winner).toBe("good");
  });

  it("checkWin：狼人数量 >= 好人 -> 狼人胜", () => {
    const game = {
      players: [
        { alive: true, role: "werewolf" },
        { alive: true, role: "werewolf" },
        { alive: true, role: "villager" },
      ],
      winner: null,
    };
    const ended = ctx.mod.checkWin(game as never);
    expect(ended).toBe(true);
    expect(game.winner).toBe("wolf");
  });

  it("checkWin：存活人数势均力敌时未分胜负", () => {
    const game = {
      players: [
        { alive: true, role: "werewolf" },
        { alive: true, role: "villager" },
        { alive: true, role: "seer" },
      ],
      winner: null,
    };
    const ended = ctx.mod.checkWin(game as never);
    expect(ended).toBe(false);
    expect(game.winner).toBeNull();
  });

  it("generateReport：未结束的对局 winner 为 null，setup 文案正确", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const report = ctx.mod.generateReport(gameId);
    expect(report.winner).toBeNull();
    expect(report.setup).toContain("9人局");
    expect(report.players.length).toBe(9);
  });
});

describe("werewolf P0：快捷动作 / 夜晚微操作 / 表现评分", () => {
  let ctx: { mod: WerewolfModule; dbmod: DbModule; dir: string; broadcast: ReturnType<typeof vi.fn>; sendToUser: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ctx = await loadWerewolf();
  });

  afterAll(() => {
    try { ctx.dbmod.db.close(); } catch { /* ignore */ }
    delete process.env.DB_PATH;
    try { rmSync(ctx.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function forceSpeech(gameId: string) {
    const g = getInternal(ctx.mod, gameId) as unknown as { phase: string };
    g.phase = "speech";
  }

  it("playerAction claim_seer：记录跳身份并返回话术模板", () => {
    const gameId = startOneHumanGame(ctx.mod);
    forceSpeech(gameId);
    const res = ctx.mod.playerAction(gameId, "host-1", "claim_seer");
    expect(res.ok).toBe(true);
    expect(res.text).toContain("预言家");
    // 公开日志应记录跳身份。
    const sawLog = ctx.broadcast.mock.calls.some(
      ([, ev]) => ev.type === "log" && (ev as { entry: { text: string } }).entry.text.includes("跳预言家"),
    );
    expect(sawLog).toBe(true);
  });

  it("playerAction accuse / rally：需要存活目标，否则被拒", () => {
    const gameId = startOneHumanGame(ctx.mod);
    forceSpeech(gameId);
    // 无目标 -> 拒绝
    expect(ctx.mod.playerAction(gameId, "host-1", "accuse").ok).toBe(false);
    expect(ctx.mod.playerAction(gameId, "host-1", "rally").ok).toBe(false);
    // 带一个存活目标 -> 成功
    const g = getInternal(ctx.mod, gameId);
    const other = g.players.find((p) => p.userId !== "host-1")!;
    const res = ctx.mod.playerAction(gameId, "host-1", "accuse", other.seat);
    expect(res.ok).toBe(true);
    expect(res.text).toContain(other.nickname);
  });

  it("playerAction：非发言阶段调用被拒", () => {
    const gameId = startOneHumanGame(ctx.mod);
    // 此时 phase=night
    expect(ctx.mod.playerAction(gameId, "host-1", "defend").ok).toBe(false);
  });

  it("nightGoodAction eavesdrop：好人夜晚可偷听一次，结果进私密便签", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const host = g.players.find((p) => p.userId === "host-1")!;
    host.role = "villager";
    const res = ctx.mod.nightGoodAction(gameId, "host-1", "eavesdrop");
    expect(res.ok).toBe(true);
    expect(res.result).toBeTruthy();
    // 结果可被 drainPrivateNotes 取走
    const notes = ctx.mod.drainPrivateNotes(gameId, "host-1");
    expect(notes.length).toBe(1);
    expect(notes[0]).toBe(res.result);
    // 同夜第二次被拒
    expect(ctx.mod.nightGoodAction(gameId, "host-1", "eavesdrop").ok).toBe(false);
  });

  it("nightGoodAction observe：记录待观察对象，天亮后生成线索", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId);
    const host = g.players.find((p) => p.userId === "host-1")!;
    host.role = "villager";
    const target = g.players.find((p) => p.userId !== "host-1")!;
    const res = ctx.mod.nightGoodAction(gameId, "host-1", "observe", target.seat);
    expect(res.ok).toBe(true);
    expect(res.result).toContain(target.nickname);
    // 狼人不能用微操作
    host.role = "werewolf";
    host.nightMicroUsed = false;
    expect(ctx.mod.nightGoodAction(gameId, "host-1", "observe", target.seat).ok).toBe(false);
  });

  it("calculatePerformance：生存天数×10 + 投中狼×15 + 阵营加成", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId) as unknown as {
      winner: "wolf" | "good" | null;
      players: Array<{
        userId: string; role: string; alive: boolean;
        deathDay?: number; correctVotes: number; totalVotes: number;
      }>;
    };
    const host = g.players.find((p) => p.userId === "host-1")!;
    host.role = "seer";      // 好人阵营
    host.alive = false;
    host.deathDay = 3;       // 存活 3 天
    host.correctVotes = 2;   // 投中 2 狼
    host.totalVotes = 4;
    g.winner = "good";       // 好人赢 -> +15
    const perf = ctx.mod.calculatePerformance(gameId, "host-1")!;
    // 3*10 + 2*15 + 15 = 75
    expect(perf.score).toBe(3 * 10 + 2 * 15 + 15);
    expect(perf.survivedDays).toBe(3);
    expect(perf.correctVotes).toBe(2);
    expect(perf.voteAccuracy).toBe(0.5);
    expect(perf.won).toBe(true);
    expect(perf.side).toBe("good");
  });

  it("calculatePerformance：狼人胜阵营加成 +20，无投票记正确率 0", () => {
    const gameId = startOneHumanGame(ctx.mod);
    const g = getInternal(ctx.mod, gameId) as unknown as {
      winner: "wolf" | "good" | null;
      players: Array<{ userId: string; role: string; alive: boolean; correctVotes: number; totalVotes: number }>;
    };
    const host = g.players.find((p) => p.userId === "host-1")!;
    host.role = "werewolf";
    host.alive = true;
    host.correctVotes = 0;
    host.totalVotes = 0;
    g.winner = "wolf";
    const perf = ctx.mod.calculatePerformance(gameId, "host-1")!;
    // day=1, alive => survivedDays=1 -> 10 + 0 + 20 = 30
    expect(perf.score).toBe(10 + 20);
    expect(perf.won).toBe(true);
    expect(perf.side).toBe("wolf");
    expect(perf.voteAccuracy).toBe(0);
  });
});
