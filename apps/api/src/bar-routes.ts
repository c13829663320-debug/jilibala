// ===== M8: 酒吧辩论 HTTP 路由 =====
// 负责端点、房间状态、WebSocket 广播与持久化。纯 AI 逻辑在 bar-orchestrator.ts。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { type BarQuoteData, type SceneId } from "@balabala/shared";
import { resolveCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";
import {
  TOPIC_LIBRARY,
  selectDebaters,
  debateSpeech,
  bartenderSummary,
  createDebateSession,
  isArgumentAngle,
  type Debater,
  type DebateSide,
  type DebateSession,
  type ArgumentAngle,
} from "./bar-orchestrator.js";
import { broadcastSceneEvent, updateSceneState } from "./ws.js";
import { addSceneRecord, upsertContent, getUser, type StoredContent } from "./db.js";

const SCENE: SceneId = "bar";
const SESSION = "lobby";

/** 玩家主导的 3 回合辩论会话（单房间 lobby，重启即重置）。 */
let debate: DebateSession | null = null;

/** 酒吧房间的内存态（单房间 lobby，重启即重置）。 */
interface BarRoomState {
  topic: string;
  debaters: Debater[];
  votes: { pro: number; con: number };
  voters: Set<string>;
  proPoints: string[];
  conPoints: string[];
}

const room: BarRoomState = {
  topic: "",
  debaters: [],
  votes: { pro: 0, con: 0 },
  voters: new Set<string>(),
  proPoints: [],
  conPoints: [],
};

const isValidSide = (v: unknown): v is DebateSide => v === "pro" || v === "con";

export function registerBarRoutes(app: FastifyInstance, deps: { chat: ChatFn; contents: StoredContent[] }): void {
  const { chat, contents } = deps;

  // ===== 玩家主导辩论：开局（选辩题 + 选边） =====
  app.post("/api/bar/debate/start", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; playerSide?: DebateSide };
    const topic = (body.topic ?? "").trim();
    const playerSide: DebateSide = body.playerSide === "con" ? "con" : "pro";
    if (!topic) return reply.code(400).send({ message: "topic 不能为空" });
    try {
      debate = createDebateSession(chat);
      const state = await debate.start(topic, playerSide);
      broadcastSceneEvent(SCENE, SESSION, {
        type: "debate_session_start",
        topic,
        playerSide,
        aiOpponent: { id: state.aiOpponent.id, name: state.aiOpponent.name },
        round: state.round,
        totalRounds: state.totalRounds,
        argumentStrength: state.argumentStrength,
        aiTendency: state.aiTendency,
      });
      return { state };
    } catch (error) {
      req.log.error(error, "bar debate start failed");
      return reply.code(502).send({ message: "酒保还在擦杯子，开桌失败。" });
    }
  });

  // ===== 玩家点选攻击角度卡：预览克制关系（纯查询，不改状态）=====
  app.post("/api/bar/debate/pick-angle", async (req, reply) => {
    if (!debate) return reply.code(409).send({ message: "请先开一桌辩论。" });
    const body = (req.body ?? {}) as { angle?: ArgumentAngle };
    if (!isArgumentAngle(body.angle)) return reply.code(400).send({ message: "angle 必须是 data/emotion/logic" });
    try {
      const result = debate.previewAngle(body.angle);
      broadcastSceneEvent(SCENE, SESSION, {
        type: "bar_angle_picked",
        angle: body.angle,
        aiTendency: debate.getState().aiTendency,
        effectiveness: result.effectiveness,
        angleDelta: result.delta,
      });
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "选角度失败";
      return reply.code(400).send({ message: msg });
    }
  });

  // ===== 玩家发言：选角度 → 立论 → AI 对称反驳 → 双向强度更新 =====
  app.post("/api/bar/debate/speak", async (req, reply) => {
    const body = (req.body ?? {}) as { round?: number; angle?: ArgumentAngle; content?: string };
    if (!debate) return reply.code(409).send({ message: "请先开一桌辩论。" });
    const round = Math.round(Number(body.round) || 0);
    const content = (body.content ?? "").trim();
    if (!isArgumentAngle(body.angle)) return reply.code(400).send({ message: "请先选一个攻击角度（data/emotion/logic）" });
    if (!content) return reply.code(400).send({ message: "发言内容不能为空" });
    try {
      const result = await debate.playerSpeak(round, body.angle, content);
      broadcastSceneEvent(SCENE, SESSION, {
        type: "bar_turn_resolved",
        round,
        playerAngle: result.playerTurn.angle,
        aiAngle: result.aiTurn.angle,
        playerEffectiveness: result.playerEffectiveness,
        aiEffectiveness: result.aiEffectiveness,
        playerDelta: result.playerDelta,
        aiDelta: result.aiDelta,
        playerScore: result.playerScore,
        aiScore: result.aiScore,
        nextAiTendency: result.nextAiTendency,
        playerText: result.playerTurn.text,
        aiText: result.aiTurn.text,
        aiSpeaker: result.aiTurn.speaker,
        argumentStrength: result.state.argumentStrength,
      });
      return result;
    } catch (error) {
      req.log.error(error, "bar debate speak failed");
      const msg = error instanceof Error ? error.message : "发言失败";
      return reply.code(400).send({ message: msg });
    }
  });

  // ===== 裁判裁决 =====
  app.post("/api/bar/debate/verdict", async (req, reply) => {
    if (!debate) return reply.code(409).send({ message: "请先开一桌辩论。" });
    try {
      const result = await debate.judgeVerdict();
      broadcastSceneEvent(SCENE, SESSION, {
        type: "debate_verdict",
        winner: result.verdict.winner,
        reasoning: result.verdict.reasoning,
        keyMoments: result.verdict.keyMoments,
        argumentStrength: result.state.argumentStrength,
      });
      return result;
    } catch (error) {
      req.log.error(error, "bar debate verdict failed");
      const msg = error instanceof Error ? error.message : "裁决失败";
      return reply.code(400).send({ message: msg });
    }
  });

  /** GET /api/bar/topics — 话题库。 */
  app.get("/api/bar/topics", async () => ({ topics: TOPIC_LIBRARY }));

  /**
   * POST /api/bar/start
   * body { topic, celebrityIds?, userId? }
   * 选辩手（未传则 AI 推荐），初始化辩论状态，广播 debate_start。
   */
  app.post("/api/bar/start", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; celebrityIds?: string[]; userId?: string };
    const topic = (body.topic ?? "").trim();
    if (!topic) return reply.code(400).send({ message: "topic 不能为空" });

    room.topic = topic;
    room.votes = { pro: 0, con: 0 };
    room.voters = new Set<string>();
    room.proPoints = [];
    room.conPoints = [];

    // 用户指定了辩手：过滤有效 id（支持自定义人物），按顺序轮流分配正反方。
    const provided = Array.isArray(body.celebrityIds)
      ? body.celebrityIds.filter((id) => resolveCharacter(id))
      : [];
    if (provided.length > 0) {
      room.debaters = provided.slice(0, 4).map((id, i) => ({
        ...resolveCharacter(id)!,
        side: (i % 2 === 0 ? "pro" : "con") as DebateSide,
      }));
    } else {
      room.debaters = await selectDebaters(topic, 4, chat);
    }

    const debaters = room.debaters.map((d) => ({
      celebrityId: d.id,
      name: d.name,
      title: d.title,
      portrait: d.portrait,
      side: d.side,
    }));

    updateSceneState(SCENE, SESSION, {
      phase: "debating",
      participants: 0,
      payload: { topic, debaters },
    });
    broadcastSceneEvent(SCENE, SESSION, { type: "debate_start", topic, debaters });

    app.log.info({ topic, debaters: debaters.map((d) => d.celebrityId) }, "bar debate started");
    return { topic, debaters };
  });

  /**
   * POST /api/bar/speak
   * body { celebrityId, topic, side, context? }
   * 名人发言，广播 speech，并写 scene_records 持久化。
   */
  app.post("/api/bar/speak", async (req, reply) => {
    const body = (req.body ?? {}) as {
      celebrityId?: string;
      topic?: string;
      side?: DebateSide;
      context?: string[];
    };
    const celebrityId = (body.celebrityId ?? "").trim();
    const celebrity = resolveCharacter(celebrityId);
    if (!celebrity) return reply.code(404).send({ message: "角色不存在" });
    const side = isValidSide(body.side) ? body.side : "pro";
    const topic = (body.topic ?? room.topic).trim() || "酒吧闲谈";
    const context = Array.isArray(body.context)
      ? body.context.filter((x): x is string => typeof x === "string")
      : [...room.proPoints, ...room.conPoints];

    const result = await debateSpeech(celebrity, topic, side, context, chat);

    // 累积观点，供酒保总结。
    if (side === "pro") room.proPoints.push(result.text);
    else room.conPoints.push(result.text);

    broadcastSceneEvent(SCENE, SESSION, {
      type: "speech",
      speakerId: celebrity.id,
      speakerName: celebrity.name,
      side,
      text: result.text,
      quote: result.quote,
    });

    addSceneRecord({
      userId: "",
      scene: SCENE,
      sessionId: SESSION,
      title: `${celebrity.name} · 发言`,
      payload: { kind: "speech", celebrityId: celebrity.id, side, text: result.text, quote: result.quote ?? "" },
    });

    return { text: result.text, quote: result.quote };
  });

  /**
   * POST /api/bar/user-speak
   * body { text, side, userId?, nickname? }
   * 用户发言，广播 user_speech。
   */
  app.post("/api/bar/user-speak", async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; side?: DebateSide; userId?: string; nickname?: string };
    const text = (body.text ?? "").trim().slice(0, 300);
    if (!text) return reply.code(400).send({ message: "text 不能为空" });
    const side = isValidSide(body.side) ? body.side : "pro";
    const userId = (body.userId ?? "").trim();
    let nickname = (body.nickname ?? "").trim() || "匿名客人";
    if (userId) {
      const profile = getUser(userId);
      if (profile) nickname = profile.nickname;
    }

    broadcastSceneEvent(SCENE, SESSION, {
      type: "user_speech",
      userId,
      nickname,
      side,
      text,
    });

    addSceneRecord({
      userId,
      scene: SCENE,
      sessionId: SESSION,
      title: `${nickname} · 客人发言`,
      payload: { kind: "user_speech", side, text },
    });

    return { ok: true };
  });

  /**
   * POST /api/bar/summarize
   * body { topic, proPoints, conPoints }
   * 酒保总结，广播 summary。
   */
  app.post("/api/bar/summarize", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; proPoints?: string[]; conPoints?: string[] };
    const topic = (body.topic ?? room.topic).trim() || "酒吧闲谈";
    const proPoints = Array.isArray(body.proPoints)
      ? body.proPoints.filter((x): x is string => typeof x === "string")
      : room.proPoints;
    const conPoints = Array.isArray(body.conPoints)
      ? body.conPoints.filter((x): x is string => typeof x === "string")
      : room.conPoints;

    const result = await bartenderSummary(topic, proPoints, conPoints, chat);

    broadcastSceneEvent(SCENE, SESSION, {
      type: "summary",
      consensus: result.consensus,
      quotes: result.quotes,
    });

    addSceneRecord({
      userId: "",
      scene: SCENE,
      sessionId: SESSION,
      title: "酒保总结",
      payload: { kind: "summary", topic, consensus: result.consensus, quotes: result.quotes },
    });

    return { consensus: result.consensus, quotes: result.quotes };
  });

  /**
   * POST /api/bar/vote
   * body { side, userId? }
   * 投「更有趣的一方」，同一用户只计一次，广播 vote_update。
   */
  app.post("/api/bar/vote", async (req, reply) => {
    const body = (req.body ?? {}) as { side?: DebateSide; userId?: string };
    const side = isValidSide(body.side) ? body.side : null;
    if (!side) return reply.code(400).send({ message: "side 必须是 pro 或 con" });
    const userId = (body.userId ?? "").trim() || randomUUID();

    // 一人一票；重复投票视为刷新立场（先减后加）。
    room.voters.add(userId);
    if (side === "pro") room.votes.pro += 1;
    else room.votes.con += 1;

    broadcastSceneEvent(SCENE, SESSION, {
      type: "vote_update",
      pro: room.votes.pro,
      con: room.votes.con,
    });

    return { pro: room.votes.pro, con: room.votes.con };
  });

  /**
   * POST /api/bar/publish
   * body { title, topic, quote, speaker, side, consensus?, topics?, userId? }
   * 写入 contents（type='bar_quote', scene='bar', bar=BarQuoteData）。
   */
  app.post("/api/bar/publish", async (req, reply) => {
    const body = (req.body ?? {}) as {
      title?: string;
      topic?: string;
      quote?: string;
      speaker?: string;
      side?: "pro" | "con" | "bartender";
      consensus?: string;
      topics?: string[];
      userId?: string;
    };
    const quote = (body.quote ?? "").trim();
    if (!quote) return reply.code(400).send({ message: "quote 不能为空" });
    const topic = (body.topic ?? room.topic).trim();
    const side = body.side === "con" || body.side === "bartender" ? body.side : "pro";
    const title = (body.title ?? `${topic} · 酒吧金句`).trim().slice(0, 40);
    const speaker = (body.speaker ?? "某位客人").trim();

    const userId = (body.userId ?? "").trim();
    let author = "酒吧客人";
    if (userId) {
      const profile = getUser(userId);
      if (profile) author = profile.nickname;
    }

    const bar: BarQuoteData = {
      topic,
      quote,
      speaker,
      side,
      consensus: body.consensus?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const content: StoredContent = {
      id: randomUUID(),
      type: "bar_quote",
      scene: "bar",
      author,
      createdAt: new Date().toISOString(),
      topics: Array.isArray(body.topics) && body.topics.length > 0 ? body.topics.map((t) => t.trim()).filter(Boolean) : [topic],
      title,
      bar,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId,
    };
    upsertContent(content);
    contents.unshift(content);

    return reply.code(201).send({ content });
  });
}
