// ===== M13: 趣味法庭 HTTP 路由 =====
// 注册 /api/court/* 端点。LLM 能力由 server.ts 注入的 chat 函数提供。
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import type {
  CourtCase,
  CourtTrialEvent,
  EvidenceType,
  Perspective,
  PlazaContent,
} from "@balabala/shared";
import type { ChatFn } from "./bench-orchestrator.js";
import { analyzeCase, runCourtTrial } from "./court-orchestrator.js";
import { filterCaseForPerspective, transitionStatus } from "./court-state.js";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";
import { broadcastToRoom, sendToUserInRoom } from "./ws.js";

/** 从 userId 取昵称作为作者；取不到则回退。 */
const resolveAuthor = (userId?: string, fallbackName = "我"): string => {
  if (userId) {
    const user = db.getUser(userId);
    if (user) return user.nickname;
  }
  return fallbackName;
};

/** 鉴权：case.userId === userId */
function assertOwner(c: CourtCase | undefined, userId: string): c is CourtCase {
  return Boolean(c && c.userId === userId);
}

/** 解析 perspective query/body 参数。 */
function parsePerspective(p: unknown): Perspective {
  return p === "plaintiff" || p === "defendant" || p === "audience" ? p : "audience";
}

/** 进行中的庭审会话（用于 player-input 入队）。 */
const courtSessions = new Map<string, { inputs: import("@balabala/shared").CourtPlayerInput[] }>();

export function registerCourtRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn; contents: StoredContent[]; saveContents: (c: StoredContent[]) => Promise<void> },
): void {
  const { chat, contents, saveContents } = deps;

  // ---- 创建案件（DRAFT）----
  app.post("/api/court/cases", async (req, reply) => {
    const body = (req.body ?? {}) as {
      userId?: string;
      userInput?: string;
      evidence?: Array<{ name: string; type: string; content: string }>;
    };
    const userId = body.userId ?? "";
    const userInput = (body.userInput ?? "").trim();
    if (!userId || !userInput) {
      return reply.code(400).send({ message: "userId 和 userInput 为必填" });
    }
    const evidence = (body.evidence ?? []).map((e) => ({
      name: e.name,
      type: (e.type || "TEXT") as EvidenceType,
      content: e.content,
      submittedBy: "user" as const,
    }));
    const c = db.createCourtCase(userId, userInput, evidence);
    return reply.code(201).send({ case: c });
  });

  // ---- 分析案件（DRAFT -> ANALYZING -> GENERATED）----
  app.post("/api/court/cases/:id/analyze", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!assertOwner(c, body.userId ?? "")) return reply.code(403).send({ message: "无权访问此案件" });

    try {
      const updated = await analyzeCase(id, chat);
      return { case: updated };
    } catch (err) {
      req.log.error(err, "analyzeCase failed");
      return reply.code(500).send({ message: "案件分析失败" });
    }
  });

  // ---- 重新分析（GENERATED -> ANALYZING -> GENERATED）----
  app.post("/api/court/cases/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!assertOwner(c, body.userId ?? "")) return reply.code(403).send({ message: "无权访问此案件" });

    try {
      // 重置状态为 ANALYZING
      db.updateCourtCaseStatus(id, "ANALYZING");
      const updated = await analyzeCase(id, chat);
      return { case: updated };
    } catch (err) {
      req.log.error(err, "regenerate failed");
      return reply.code(500).send({ message: "重新分析失败" });
    }
  });

  // ---- 确认案件（GENERATED -> CONFIRMED）----
  app.post("/api/court/cases/:id/confirm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!assertOwner(c, body.userId ?? "")) return reply.code(403).send({ message: "无权访问此案件" });
    if (c.status !== "GENERATED") return reply.code(409).send({ message: `案件状态非 GENERATED，当前: ${c.status}` });

    db.updateCourtCaseStatus(id, transitionStatus(c.status, "confirm"));
    return { case: db.getCourtCase(id) };
  });

  // ---- 开庭审理（CONFIRMED -> IN_PROGRESS -> ... -> COMPLETED，SSE 流）----
  app.post("/api/court/cases/:id/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      userId?: string;
      perspective?: string;
      defenderAssignments?: { plaintiff?: string[]; defendant?: string[] };
    };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!assertOwner(c, body.userId ?? "")) return reply.code(403).send({ message: "无权访问此案件" });
    if (c.status !== "CONFIRMED") return reply.code(409).send({ message: `案件状态非 CONFIRMED，当前: ${c.status}` });

    const perspective = parsePerspective(body.perspective);
    const defenderAssignments = body.defenderAssignments;

    // 初始化会话
    courtSessions.delete(id);
    courtSessions.set(id, { inputs: [] });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (event: unknown): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 同时广播给 WS 法庭房间
    const broadcast = (event: CourtTrialEvent): void => {
      broadcastToRoom(`court:${id}`, { type: "court_event", event });
    };

    try {
      await runCourtTrial({
        caseId: id,
        chat,
        perspective,
        defenderAssignments,
        onEvent: (event) => {
          send(event);
          broadcast(event);
        },
        getPendingPlayerInputs: () => courtSessions.get(id)?.inputs ?? [],
        markPlayerInputHandled: (inputId) => {
          const session = courtSessions.get(id);
          if (session) session.inputs = session.inputs.filter((i) => i.id !== inputId);
        },
      });
    } catch (err) {
      req.log.error(err, "runCourtTrial failed");
      send({ type: "error", message: "庭审中断，请稍后重试。" } satisfies CourtTrialEvent);
    }

    courtSessions.delete(id);
    res.end();
  });

  // ---- 玩家输入（非阻塞入队）----
  app.post("/api/court/cases/:id/player-input", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      userId?: string;
      playerRole?: "plaintiff" | "defendant";
      type?: "argument" | "evidence" | "question";
      content?: string;
      evidenceName?: string;
    };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!body.userId || !body.playerRole || !body.type || !body.content) {
      return reply.code(400).send({ message: "userId, playerRole, type, content 为必填" });
    }

    const input = db.addCourtPlayerInput({
      caseId: id,
      userId: body.userId,
      player_role: body.playerRole,
      type: body.type,
      content: body.content,
      evidenceName: body.evidenceName,
    });

    // 入队到进行中的会话
    const session = courtSessions.get(id);
    if (session) session.inputs.push(input);

    return { ok: true, inputId: input.id };
  });

  // ---- 查询案件（视角过滤）----
  app.get("/api/court/cases/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { userId?: string; perspective?: string };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });

    // 只有 owner 或已完结案件可查；未完结案件需 userId 匹配
    if (c.status !== "COMPLETED" && query.userId && c.userId !== query.userId) {
      return reply.code(403).send({ message: "无权访问此案件" });
    }

    const perspective = parsePerspective(query.perspective);
    const filtered = filterCaseForPerspective(c, perspective);
    return { case: filtered };
  });

  // ---- 查询庭审发言（公开）----
  app.get("/api/court/cases/:id/turns", async (req) => {
    const { id } = req.params as { id: string };
    return { turns: db.getCourtTurns(id) };
  });

  // ---- 查询判决（公开）----
  app.get("/api/court/cases/:id/verdict", async (req) => {
    const { id } = req.params as { id: string };
    return { verdict: db.getCourtVerdict(id) ?? null };
  });

  // ---- 发布判决到广场 ----
  app.post("/api/court/cases/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { userId?: string; topics?: string[] };
    const c = db.getCourtCase(id);
    if (!c) return reply.code(404).send({ message: "案件不存在" });
    if (!assertOwner(c, body.userId ?? "")) return reply.code(403).send({ message: "无权访问此案件" });
    if (!c.final_verdict) return reply.code(409).send({ message: "判决尚未生成" });

    // 检查是否已发布
    const existing = contents.find(
      (x) => x.type === "court_verdict" && x.caseId === id,
    );
    if (existing) return { content: existing };

    const author = resolveAuthor(body.userId);
    const content: StoredContent = {
      id: randomUUID(),
      type: "court_verdict",
      scene: "court",
      author,
      createdAt: new Date().toISOString(),
      topics: body.topics ?? [],
      title: c.title || "趣味法庭判决",
      caseId: id,
      courtVerdict: c.final_verdict,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId: body.userId ?? "",
    };
    contents.unshift(content);
    await saveContents(contents);
    broadcastToRoom("plaza", { type: "plaza_event", event: { kind: "content_created", content } });
    return reply.code(201).send({ content });
  });
}
