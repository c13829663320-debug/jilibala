// ============================================================================
// 玩法深化引擎桥接路由（CourtOrchestrator / TalkshowOrchestrator）
// 自包含、确定性、无需 LLM：用于真机走查与前端调试。
// 旧的 court-routes / talkshow-routes 保持不动（不回归）。
// ============================================================================
import type { FastifyInstance } from "fastify";
import type { CourtCardType } from "@balabala/shared";
import { CourtOrchestrator } from "./court-engine.js";
import { TalkshowOrchestrator } from "./talkshow-engine.js";

interface CourtSession {
  engine: CourtOrchestrator;
  events: Array<{ type: string; payload: unknown }>;
}
interface TalkshowSession {
  engine: TalkshowOrchestrator;
  events: Array<{ type: string; payload: unknown }>;
}

const courtSessions = new Map<string, CourtSession>();
const talkshowSessions = new Map<string, TalkshowSession>();

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
}
