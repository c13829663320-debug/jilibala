// ============================================================================
// 玩法深化引擎桥接路由（CourtOrchestrator / TalkshowOrchestrator）
// 自包含、确定性、无需 LLM：用于真机走查与前端调试。
// 旧的 court-routes / talkshow-routes 保持不动（不回归）。
// ============================================================================
import type { FastifyInstance } from "fastify";
import type { CourtCardType, WerewolfRole } from "@balabala/shared";
import { CourtOrchestrator } from "./court-engine.js";
import { TalkshowOrchestrator } from "./talkshow-engine.js";
import { WerewolfEngine, type WwAction, type WwPrivateSnapshot } from "./werewolf-engine.js";
import { BarEngine } from "./bar-engine.js";
import type { ArgumentAngle } from "./bar-orchestrator.js";

interface CourtSession {
  engine: CourtOrchestrator;
  events: Array<{ type: string; payload: unknown }>;
}
interface TalkshowSession {
  engine: TalkshowOrchestrator;
  events: Array<{ type: string; payload: unknown }>;
}
interface WwSession {
  engine: WerewolfEngine;
  events: Array<{ type: string; payload: unknown }>;
}
interface BarSession {
  engine: BarEngine;
  events: Array<{ type: string; payload: unknown }>;
}

const courtSessions = new Map<string, CourtSession>();
const talkshowSessions = new Map<string, TalkshowSession>();
const wwSessions = new Map<string, WwSession>();
const barSessions = new Map<string, BarSession>();

const DEMO_DISPUTE_POINTS = ["凌晨扰民", "损失赔偿", "责任认定"];
const DEMO_EVIDENCE = [
  { id: "ev-1", name: "凌晨录音", content: "凌晨扰民的电钻录音" },
  { id: "ev-2", name: "维修发票", content: "损失赔偿的维修发票" },
  { id: "ev-3", name: "出警笔录", content: "责任认定的出警笔录" },
];

export function registerEngineRoutes(app: FastifyInstance): void {
  // ===== 趣味法庭 =====
  app.post("/api/engine/court/new", async (req, reply) => {
    const body = (req.body ?? {}) as { playerSide?: "plaintiff" | "defendant" };
    const id = `court-${courtSessions.size + 1}-${Date.now()}`;
    const engine = new CourtOrchestrator();
    const events: Array<{ type: string; payload: unknown }> = [];
    engine.on("*", (e) => events.push({ type: e.type, payload: e.payload }));
    engine.start({
      playerSide: body.playerSide === "defendant" ? "defendant" : "plaintiff",
      disputePoints: DEMO_DISPUTE_POINTS,
      evidencePool: DEMO_EVIDENCE,
      playerTurnTimeoutMs: 120_000, // 真机走查窗口放宽
      opponentRebuttalDelta: 4,
    });
    courtSessions.set(id, { engine, events });
    return reply.send({ id, snapshot: engine.getSnapshot(), events });
  });

  app.post<{ Params: { id: string } }>("/api/engine/court/:id/act", async (req, reply) => {
    const sess = courtSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    const body = (req.body ?? {}) as {
      kind: "play_card" | "pass";
      card?: CourtCardType;
      targetEvidenceId?: string;
      freeText?: string;
    };
    if (body.kind === "pass") {
      sess.engine.act({ kind: "pass" });
    } else {
      sess.engine.act({
        kind: "play_card",
        card: body.card ?? "attack",
        targetEvidenceId: body.targetEvidenceId,
        freeText: body.freeText,
      });
    }
    return reply.send({ snapshot: sess.engine.getSnapshot(), events: sess.events });
  });

  app.get<{ Params: { id: string } }>("/api/engine/court/:id", async (req, reply) => {
    const sess = courtSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    return reply.send({ snapshot: sess.engine.getSnapshot(), events: sess.events });
  });

  app.get("/api/engine/court-daily", async (_req, reply) => {
    return reply.send(CourtOrchestrator.dailyChallenge(new Date()));
  });

  // ===== 脱口秀 =====
  app.post("/api/engine/talkshow/new", async (_req, reply) => {
    const id = `ts-${talkshowSessions.size + 1}-${Date.now()}`;
    const engine = new TalkshowOrchestrator();
    const events: Array<{ type: string; payload: unknown }> = [];
    engine.on("*", (e) => events.push({ type: e.type, payload: e.payload }));
    engine.start({ jokeTimeLimitMs: 120_000 });
    talkshowSessions.set(id, { engine, events });
    return reply.send({ id, snapshot: engine.getSnapshot(), events });
  });

  app.post<{ Params: { id: string } }>("/api/engine/talkshow/:id/topic", async (req, reply) => {
    const sess = talkshowSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    const body = (req.body ?? {}) as { topicId?: string };
    sess.engine.act({ kind: "pick_topic", topicId: body.topicId ?? "workplace" });
    return reply.send({ snapshot: sess.engine.getSnapshot(), events: sess.events });
  });

  app.post<{ Params: { id: string } }>("/api/engine/talkshow/:id/joke", async (req, reply) => {
    const sess = talkshowSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    const body = (req.body ?? {}) as { text?: string; callbackTo?: number };
    const joke = await sess.engine.performJoke(body.text ?? "", {
      callbackTo: typeof body.callbackTo === "number" ? body.callbackTo : undefined,
    });
    return reply.send({ joke, snapshot: sess.engine.getSnapshot(), events: sess.events });
  });

  app.get("/api/engine/talkshow-daily", async (_req, reply) => {
    return reply.send(TalkshowOrchestrator.dailyChallenge(new Date()));
  });

  // ===== 狼人杀（新引擎 WerewolfEngine）=====
  // 确定性 AI：从候选里随机挑一个，不调 LLM。
  const wwAi = {
    wolfKill: (_w: number, c: number[]) => c[Math.floor(Math.random() * c.length)] ?? 0,
    seerCheck: (_s: number, c: number[]) => c[Math.floor(Math.random() * c.length)] ?? 0,
    witch: () => ({ heal: false, poison: null as number | null }),
    vote: (_v: number, c: number[]) => (c.length ? c[Math.floor(Math.random() * c.length)] : null),
    hunterShot: (_h: number, c: number[]) => (c.length ? c[Math.floor(Math.random() * c.length)] : null),
  };

  /** 根据当前子阶段 + 身份推导前端该展示的行动面板。 */
  function wwPendingAction(engine: WerewolfEngine): string | null {
    const s = engine.state;
    const me = s.players[engine.humanSeat];
    if (!me) return null;
    switch (s.sub) {
      case "night_wolf": return me.role === "werewolf" && me.alive ? "night_kill" : null;
      case "night_seer": return me.role === "seer" && me.alive ? "night_check" : null;
      case "night_witch": return me.role === "witch" && me.alive ? "night_witch" : null;
      case "speech": return me.alive ? "day_action" : null;
      case "vote": return me.alive ? "day_vote" : null;
      case "day_announce":
        return s.hunterPending === engine.humanSeat ? "hunter_shot" : null;
      default: return null;
    }
  }

  /** 组装给前端的视角快照（私密字段仅真人可见）。 */
  function wwViewSnapshot(engine: WerewolfEngine) {
    const priv: WwPrivateSnapshot = engine.getPrivateSnapshot(engine.humanSeat);
    return {
      phase: engine.phase,
      sub: priv.sub,
      day: priv.day,
      players: priv.players,
      winner: priv.winner,
      lastNightDeaths: priv.lastNightDeaths,
      dayActions: priv.dayActions,
      lastVoteResult: priv.lastVoteResult,
      log: priv.log,
      mySeat: priv.mySeat,
      myRole: priv.myRole,
      wolfTeammates: priv.wolfTeammates,
      seerResults: priv.seerResults,
      witchPotions: priv.witchPotions,
      spectator: priv.spectator,
      pendingAction: wwPendingAction(engine),
      result: engine.phase === "results" ? engine.settle() : null,
    };
  }

  /** 夜晚结束后推进到白天公布 → 发言/胜负判定。返回是否已结束。 */
  function wwAfterNight(engine: WerewolfEngine): boolean {
    engine.runDayAnnounce();
    if (engine.checkWin()) { engine.endGame(); return true; }
    engine.beginSpeech();
    return false;
  }

  /** 投票结束后推进到下一夜/终局。返回是否已结束。 */
  function wwAfterVote(engine: WerewolfEngine): boolean {
    if (engine.checkWin()) { engine.endGame(); return true; }
    if (engine.state.day >= 4) { engine.deadlineWin(); engine.endGame(); return true; }
    engine.state.day += 1;
    return false;
  }

  app.post("/api/engine/werewolf/new", async (req, reply) => {
    const body = (req.body ?? {}) as { forceHumanRole?: WerewolfRole; humanThinkMs?: number };
    const id = `ww-${wwSessions.size + 1}-${Date.now()}`;
    const engine = new WerewolfEngine({ ai: wwAi });
    const events: Array<{ type: string; payload: unknown }> = [];
    engine.on("*", (e) => events.push({ type: e.type, payload: e.payload }));
    engine.setup({
      forceHumanRole: body.forceHumanRole,
      humanThinkMs: body.humanThinkMs ?? 90_000,
    });
    wwSessions.set(id, { engine, events });

    // 打开夜晚，并根据真人身份把 sub 调到对应夜间子阶段（让 act() 接受输入）。
    engine.openNight();
    const me = engine.state.players[engine.humanSeat];
    let ended = false;
    if (!me.alive) {
      ended = wwAfterNight(engine);
    } else if (me.role === "seer") {
      engine.state.sub = "night_seer";
    } else if (me.role === "witch") {
      engine.state.sub = "night_witch";
    } else if (me.role === "werewolf") {
      engine.state.sub = "night_wolf";
    } else {
      // 村民/猎人夜间无行动，直接结算夜晚
      engine.settleNight();
      ended = wwAfterNight(engine);
    }
    return reply.send({ id, snapshot: wwViewSnapshot(engine), events, ended });
  });

  app.post<{ Params: { id: string } }>("/api/engine/werewolf/:id/act", async (req, reply) => {
    const sess = wwSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    const engine = sess.engine;
    const body = (req.body ?? {}) as {
      kind: "night_kill" | "night_check" | "night_witch" | "day_action" | "day_vote" | "hunter_shot" | "pass";
      target?: number | null;
      heal?: boolean;
      poison?: number | null;
      action?: WwAction;
    };

    let ended = false;
    const sub = engine.state.sub;

    if (sub === "night_wolf" || sub === "night_seer" || sub === "night_witch") {
      // 真人提交夜间行动 → 结算夜晚 → 白天
      const action: WwAction | null =
        body.kind === "night_kill" ? { kind: "night_kill", target: body.target ?? 0 }
        : body.kind === "night_check" ? { kind: "night_check", target: body.target ?? 0 }
        : body.kind === "night_witch" ? { kind: "night_witch", heal: !!body.heal, poison: body.poison ?? null }
        : null;
      if (action) engine.act(action);
      engine.settleNight();
      ended = wwAfterNight(engine);
    } else if (sub === "day_announce") {
      // 猎人开枪窗口
      if (body.kind === "hunter_shot") {
        engine.act({ kind: "hunter_shot", target: body.target ?? null });
      }
      ended = wwAfterVote(engine);
    } else if (sub === "speech") {
      if (body.kind === "day_action" && body.action) {
        engine.act(body.action);
      } else if (body.kind === "pass" || body.kind === "day_vote") {
        // 结束发言 → 打开投票窗口
        engine.endSpeech();
        engine.openVote();
      }
    } else if (sub === "vote") {
      if (body.kind === "day_vote") {
        engine.act({ kind: "day_vote", target: body.target ?? null });
      }
      engine.settleVote();
      ended = wwAfterVote(engine);
    }

    return reply.send({ snapshot: wwViewSnapshot(engine), events: sess.events, ended });
  });

  app.get<{ Params: { id: string }; Querystring: { seat?: string } }>(
    "/api/engine/werewolf/:id",
    async (req, reply) => {
      const sess = wwSessions.get(req.params.id);
      if (!sess) return reply.code(404).send({ error: "session not found" });
      const seat = Number(req.query.seat ?? 0);
      const engine = sess.engine;
      const priv = engine.getPrivateSnapshot(Number.isFinite(seat) ? seat : 0);
      return reply.send({ snapshot: priv, events: sess.events });
    },
  );

  app.get("/api/engine/werewolf-daily", async (_req, reply) => {
    return reply.send(WerewolfEngine.dailyChallenge(new Date()));
  });

  // ===== 酒吧辩论（新引擎 BarEngine）=====
  const BAR_TOPICS = [
    "外卖迟到，该不该给差评？",
    "AI 会不会取代人类的工作？",
    "恋爱里，该不该看对方手机？",
    "年轻人该先攒钱还是先享受？",
    "加班到底是奋斗还是摸鱼？",
  ];

  /** 组装酒吧视角快照。 */
  function barViewSnapshot(engine: BarEngine) {
    const s = engine.state;
    const humanWon = s.strength[s.playerSide] >= 55;
    return {
      phase: engine.phase,
      topic: s.topic,
      playerSide: s.playerSide,
      aiSide: s.aiSide,
      round: s.round,
      totalRounds: 3,
      balance: { player: s.strength[s.playerSide], ai: s.strength[s.aiSide] },
      strength: { ...s.strength },
      playerAngle: s.transcript.length ? s.transcript[s.transcript.length - 2]?.angle ?? null : null,
      aiTendency: s.aiTendency,
      angleEffectiveness: s.lastEffectiveness ?? null,
      transcript: s.transcript,
      scores: { player: engine.getScore("slot-0") },
      finished: s.finished,
      result: engine.phase === "results" ? engine.settle() : null,
      humanWon,
    };
  }

  app.post("/api/engine/bar/new", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; playerSide?: "pro" | "con" };
    const id = `bar-${barSessions.size + 1}-${Date.now()}`;
    const engine = new BarEngine();
    const events: Array<{ type: string; payload: unknown }> = [];
    engine.on("*", (e) => events.push({ type: e.type, payload: e.payload }));
    const topic = body.topic?.trim() || BAR_TOPICS[Math.floor(Math.random() * BAR_TOPICS.length)];
    engine.setup({ topic, playerSide: body.playerSide === "con" ? "con" : "pro" });
    barSessions.set(id, { engine, events });
    return reply.send({ id, snapshot: barViewSnapshot(engine), events });
  });

  app.post<{ Params: { id: string } }>("/api/engine/bar/:id/act", async (req, reply) => {
    const sess = barSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    const engine = sess.engine;
    const body = (req.body ?? {}) as {
      kind: "pick_angle" | "pass";
      angle?: ArgumentAngle;
      text?: string;
    };

    if (engine.state.finished) {
      return reply.code(400).send({ error: "辩论已结束" });
    }
    if (body.kind === "pick_angle") {
      const angle: ArgumentAngle = body.angle === "emotion" || body.angle === "logic" ? body.angle : "data";
      engine.act({ kind: "speak", angle, content: body.text ?? "" });
    } else {
      // pass = 超时兜底，用默认角度自动结算
      engine.timeoutFallback();
    }

    // 打满 3 回合 → 自动终局裁决
    if (engine.state.finished && engine.phase !== "results") {
      engine.judge();
    }
    return reply.send({ snapshot: barViewSnapshot(engine), events: sess.events });
  });

  app.get<{ Params: { id: string } }>("/api/engine/bar/:id", async (req, reply) => {
    const sess = barSessions.get(req.params.id);
    if (!sess) return reply.code(404).send({ error: "session not found" });
    return reply.send({ snapshot: barViewSnapshot(sess.engine), events: sess.events });
  });

  app.get("/api/engine/bar-daily", async (_req, reply) => {
    return reply.send(BarEngine.dailyChallenge(new Date()));
  });
}
