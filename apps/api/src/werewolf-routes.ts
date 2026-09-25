// ===== 狼人杀馆路由 Werewolf Routes (M9) =====
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { WerewolfPublicPlayer, WerewolfReportData } from "@balabala/shared";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";
import type { ChatFn } from "./bench-orchestrator.js";
import {
  createGame,
  joinGame,
  startGame,
  getSnapshotForPlayer,
  generateReport,
  playerAction,
  nightGoodAction,
  drainPrivateNotes,
  calculatePerformance,
  setFastMode,
} from "./werewolf-orchestrator.js";

export function registerWerewolfRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn; contents: StoredContent[] },
): void {
  // ===== 创建房间（自动把房主入座）=====
  app.post("/api/werewolf/create", async (req, reply) => {
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const gameId = createGame(userId);
    const user = db.getUser(userId);
    joinGame(gameId, userId, {
      nickname: user?.nickname ?? "我",
      avatarType: user?.avatarType ?? "capsule",
      avatarRef: user?.avatarRef ?? "",
    });
    return { gameId };
  });

  // ===== 加入房间 =====
  app.post("/api/werewolf/:gameId/join", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const user = db.getUser(userId);
    const result = joinGame(gameId, userId, {
      nickname: user?.nickname ?? "我",
      avatarType: user?.avatarType ?? "capsule",
      avatarRef: user?.avatarRef ?? "",
    });
    if (!result) return reply.code(409).send({ message: "房间不存在、已满或已开始。" });
    const snap = getSnapshotForPlayer(gameId, userId);
    const player: WerewolfPublicPlayer | undefined = snap.players.find((p) => p.seat === result.seat);
    return { seat: result.seat, player };
  });

  // ===== 房主开始游戏 =====
  app.post("/api/werewolf/:gameId/start", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    startGame(gameId, userId);
    return { ok: true };
  });

  // ===== 拉取当前视角快照（断线重连 / 初始加载）=====
  app.get("/api/werewolf/:gameId/state", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const snap = getSnapshotForPlayer(gameId, userId);
    if (snap.players.length === 0) return reply.code(404).send({ message: "房间不存在。" });
    return snap;
  });

  // ===== P0：白天发言快捷动作牌 =====
  app.post("/api/werewolf/:gameId/quick-action", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = (req.body ?? {}) as { userId?: string; actionType?: string; targetSeat?: number };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const result = playerAction(
      gameId,
      userId,
      (body.actionType ?? "") as "claim_seer" | "accuse" | "rally" | "defend",
      body.targetSeat == null ? undefined : Number(body.targetSeat),
    );
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });

  // ===== P0：夜晚好人微操作（偷听 / 观察）=====
  app.post("/api/werewolf/:gameId/night-micro", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = (req.body ?? {}) as { userId?: string; action?: string; targetSeat?: number };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const result = nightGoodAction(
      gameId,
      userId,
      (body.action ?? "") as "eavesdrop" | "observe",
      body.targetSeat == null ? undefined : Number(body.targetSeat),
    );
    if (!result.ok) return reply.code(400).send(result);
    return result;
  });

  // ===== P0：拉取私密便签（偷听结果 / 观察线索）=====
  app.get("/api/werewolf/:gameId/notes", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    return { notes: drainPrivateNotes(gameId, userId) };
  });

  // ===== P0：本局表现评分 =====
  app.get("/api/werewolf/:gameId/performance", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });
    const perf = calculatePerformance(gameId, userId);
    if (!perf) return reply.code(404).send({ message: "对局不存在。" });
    return perf;
  });

  // ===== P0：加速模式（2x AI 发言）=====
  app.post("/api/werewolf/:gameId/fast-mode", async (req) => {
    const body = (req.body ?? {}) as { on?: boolean };
    setFastMode(body.on === true);
    return { ok: true, fast: body.on === true };
  });

  // ===== 游戏结束后发布战报到广场 =====
  app.post("/api/werewolf/:gameId/publish", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    const body = (req.body ?? {}) as { userId?: string; title?: string; topics?: string[] };
    const userId = (body.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "缺少 userId。" });

    const report: WerewolfReportData = generateReport(gameId);
    if (!report.winner) return reply.code(409).send({ message: "对局尚未结束，暂不能发布战报。" });

    const existing = deps.contents.find((c) => c.type === "werewolf_report" && c.werewolf?.gameId === gameId);
    if (existing) return { content: existing };

    const user = db.getUser(userId);
    const author = user?.nickname ?? "我";
    const title = (body.title ?? "").trim() || `狼人杀战报 · ${report.winner === "wolf" ? "狼人胜" : "好人胜"}`;

    const content: StoredContent = {
      id: randomUUID(),
      type: "werewolf_report",
      scene: "werewolf",
      author,
      createdAt: new Date().toISOString(),
      topics: (body.topics ?? []).map((t) => String(t).trim()).filter(Boolean),
      title,
      body: report.summary,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId,
      werewolf: report,
    };
    db.upsertContent(content);
    deps.contents.unshift(content);
    return reply.code(201).send({ content });
  });
}
