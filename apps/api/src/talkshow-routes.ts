// ===== 脱口秀剧场路由 Talkshow Routes (M8) =====
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { TalkshowClipData } from "@balabala/shared";
import { broadcastSceneEvent } from "./ws.js";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";
import type { ChatFn } from "./bench-orchestrator.js";
import {
  audienceReaction,
  celebrityOpenMic,
  aiWriteJoke,
} from "./talkshow-orchestrator.js";

/** 剧场固定使用 lobby 会话（单房间开放剧场）。 */
const SESSION = "lobby";

export function registerTalkshowRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn; contents: StoredContent[] },
): void {
  const { chat } = deps;

  // ===== 上台讲一段：AI 观众实时评分 + 广播 + 持久化 =====
  app.post("/api/talkshow/perform", async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; userId?: string; nickname?: string };
    const text = (body.text ?? "").trim();
    if (!text) return reply.code(400).send({ message: "请先写一段要讲的段子。" });
    if (text.length > 500) return reply.code(400).send({ message: "一段表演请控制在 500 字以内。" });

    // 表演者昵称：优先 body.nickname，其次按 userId 查用户资料。
    let performer = body.nickname?.trim() || "我";
    if (body.userId) {
      const user = db.getUser(body.userId);
      if (user) performer = user.nickname;
    }

    try {
      const result = await audienceReaction(text, chat);
      // 广播给剧场所有人。
      broadcastSceneEvent("talkshow", SESSION, {
        type: "performance",
        performer,
        text,
        score: result.score,
        reactions: result.reactions,
      });
      // 持久化到 scene_records。
      db.addSceneRecord({
        scene: "talkshow",
        sessionId: SESSION,
        title: `${performer} 的开放麦`,
        payload: { performer, text, score: result.score, reactions: result.reactions },
        userId: body.userId,
      });
      return { score: result.score, reactions: result.reactions, comment: result.comment };
    } catch (error) {
      req.log.error(error, "talkshow perform failed");
      return reply.code(502).send({ message: "观众系统暂时开小差，请稍后再试。" });
    }
  });

  // ===== 名人 open-mic：名人用 persona 讲段子 =====
  app.post("/api/talkshow/celebrity", async (req, reply) => {
    const body = (req.body ?? {}) as { celebrityId?: string };
    const celebrityId = (body.celebrityId ?? "").trim();
    if (!celebrityId) return reply.code(400).send({ message: "请选择一位名人。" });
    try {
      const result = await celebrityOpenMic(celebrityId, chat);
      broadcastSceneEvent("talkshow", SESSION, {
        type: "celebrity_set",
        celebrityId: result.celebrityId,
        name: result.name,
        jokes: result.jokes,
        score: result.score,
      });
      return result;
    } catch (error) {
      req.log.error(error, "talkshow celebrity open-mic failed");
      return reply.code(502).send({ message: "名人今天嗓子哑了，请稍后再试。" });
    }
  });

  // ===== AI 帮写段子 =====
  app.post("/api/talkshow/ai-write", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; style?: string };
    const topic = (body.topic ?? "").trim();
    if (!topic) return reply.code(400).send({ message: "请先给一个主题。" });
    try {
      const joke = await aiWriteJoke(topic, body.style ?? "", chat);
      return { joke };
    } catch (error) {
      req.log.error(error, "talkshow ai-write failed");
      return reply.code(502).send({ message: "编剧下班了，请稍后再试。" });
    }
  });

  // ===== 发布精彩片段到广场 =====
  app.post("/api/talkshow/publish", async (req, reply) => {
    const body = (req.body ?? {}) as {
      title?: string; text?: string; performer?: string;
      score?: number; reactions?: string[]; celebrityGuest?: string;
      topics?: string[]; userId?: string;
    };
    const title = (body.title ?? "").trim();
    const text = (body.text ?? "").trim();
    if (!title || !text) return reply.code(400).send({ message: "标题和段子内容不能为空。" });

    let author = body.performer?.trim() || "我";
    if (body.userId) {
      const user = db.getUser(body.userId);
      if (user) author = user.nickname;
    }

    const clip: TalkshowClipData = {
      performer: author,
      text,
      audienceScore: Math.max(0, Math.min(100, Math.round(Number(body.score) || 0))),
      reactions: Array.isArray(body.reactions) ? body.reactions.map((r) => String(r)).slice(0, 6) : [],
      celebrityGuest: body.celebrityGuest?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    const content: StoredContent = {
      id: randomUUID(),
      type: "talkshow_clip",
      scene: "talkshow",
      author,
      createdAt: new Date().toISOString(),
      topics: (body.topics ?? []).map((t) => String(t).trim()).filter(Boolean),
      title,
      body: text,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId: body.userId ?? "",
      talkshow: clip,
    };
    db.upsertContent(content);
    deps.contents.unshift(content);
    return reply.code(201).send({ content });
  });
}