// ===== M8: 图书馆 HTTP 路由 =====
// 注册 /api/library/* 端点。LLM 能力由 server.ts 注入的 chat 函数提供；
// 实时事件通过 WS 广播到 library:lobby 房间；读书记录写入 scene_records。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  type LibraryNoteData,
  type SceneId,
  type QuizDomain,
  QUIZ_DOMAIN_LABEL,
  QUIZ_OPPONENT_IDS,
  QUIZ_QUESTION_COUNT,
  QUIZ_QUESTION_TIME_LIMIT_MS,
  celebBuzzAccuracy,
  isQuizDomain,
} from "@balabala/shared";
import { resolveCharacter } from "./character-resolver.js";
import type { ChatFn } from "./bench-orchestrator.js";
import {
  celebrityDeepChat,
  bookRecommendation,
  bookClubOpening,
  librarianAnswer,
  generateQuizQuestions,
  LIBRARY_TOPICS,
} from "./library-orchestrator.js";
import { broadcastSceneEvent } from "./ws.js";
import * as db from "./db.js";
import type { StoredContent } from "./db.js";

const SCENE: SceneId = "library";
const SESSION_ID = "lobby";

/** 从 userId 取昵称作为作者；取不到则回退。 */
const resolveAuthor = (userId?: string, fallbackName = "我"): string => {
  if (userId) {
    const user = db.getUser(userId);
    if (user) return user.nickname;
  }
  return fallbackName;
};

export function registerLibraryRoutes(app: FastifyInstance, deps: { chat: ChatFn; contents: StoredContent[] }): void {
  const { chat, contents } = deps;

  // ---- 知识主题列表 ----
  app.get("/api/library/topics", async () => {
    return { topics: LIBRARY_TOPICS };
  });

  // ---- 知识擂台：开局一次出题 ----
  // POST /api/library/quiz/start { domain, count?, userId? }
  // 一次 LLM 调用生成题目，失败走本地兜底；返回题目 + 3 位 AI 对手信息。
  app.post("/api/library/quiz/start", async (req, reply) => {
    const body = (req.body ?? {}) as { domain?: string; count?: number; userId?: string };
    const rawDomain = body.domain ?? "";
    if (!isQuizDomain(rawDomain)) {
      return reply.code(400).send({ message: "领域无效，可选：科学/文学/哲学/历史/艺术。" });
    }
    const domain: QuizDomain = rawDomain;
    const count = Math.min(Math.max(1, Math.floor(body.count ?? QUIZ_QUESTION_COUNT)), QUIZ_QUESTION_COUNT);

    try {
      const { questions, source } = await generateQuizQuestions(domain, count, chat);
      const opponents = QUIZ_OPPONENT_IDS[domain].map((id) => {
        const c = resolveCharacter(id);
        return {
          id,
          name: c?.name ?? id,
          title: c?.title ?? "",
          portrait: c?.portrait ?? "",
          field: c?.field ?? "",
          accuracy: celebBuzzAccuracy(c?.field, domain),
        };
      });
      db.addSceneRecord({
        userId: body.userId,
        scene: SCENE,
        sessionId: SESSION_ID,
        title: `知识擂台 · ${QUIZ_DOMAIN_LABEL[domain]}`,
        payload: { domain, questionCount: questions.length, source },
      });
      broadcastSceneEvent(SCENE, SESSION_ID, {
        type: "quiz_started",
        domain,
        questionCount: questions.length,
        source,
      });
      return {
        domain,
        domainLabel: QUIZ_DOMAIN_LABEL[domain],
        questions,
        source,
        opponents,
        questionTimeLimitMs: QUIZ_QUESTION_TIME_LIMIT_MS,
      };
    } catch (error) {
      req.log.error(error, "library quiz start failed");
      return reply.code(502).send({ message: "出题失败，请稍后再试。" });
    }
  });

  // ---- 名人深度问答 ----
  app.post("/api/library/celebrity-chat", async (req, reply) => {
    const body = (req.body ?? {}) as {
      celebrityId?: string;
      messages?: Array<{ role?: string; content?: string }>;
      userId?: string;
    };
    const celebrity = resolveCharacter(body.celebrityId ?? "");
    if (!celebrity) return reply.code(404).send({ message: "角色不存在" });

    const history = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return reply.code(400).send({ message: "需要用户消息。" });
    }
    const question = history[history.length - 1].content;

    try {
      const answer = await celebrityDeepChat(celebrity, history, chat);
      // 实时同步给同房间其他读者。
      broadcastSceneEvent(SCENE, SESSION_ID, {
        type: "celebrity_chat",
        celebrityId: celebrity.id,
        name: celebrity.name,
        question,
        answer,
      });
      db.addSceneRecord({
        userId: body.userId,
        scene: SCENE,
        sessionId: SESSION_ID,
        title: `深度问答 · ${celebrity.name}`,
        payload: { celebrityId: celebrity.id, question, answer },
      });
      return { reply: answer, name: celebrity.name };
    } catch (error) {
      req.log.error(error, "library celebrity chat failed");
      return reply.code(502).send({ message: "暂时连不上对话服务，请稍后再试。" });
    }
  });

  // ---- 名人推荐著作 ----
  app.post("/api/library/recommend", async (req, reply) => {
    const body = (req.body ?? {}) as { celebrityId?: string };
    const celebrity = resolveCharacter(body.celebrityId ?? "");
    if (!celebrity) return reply.code(404).send({ message: "角色不存在" });
    try {
      const rec = await bookRecommendation(celebrity, chat);
      return { book: rec.book, author: rec.author, reason: rec.reason };
    } catch (error) {
      req.log.error(error, "library recommend failed");
      return reply.code(502).send({ message: "推荐服务暂时不可用。" });
    }
  });

  // ---- 读书会开场 ----
  app.post("/api/library/book-club", async (req, reply) => {
    const body = (req.body ?? {}) as { celebrityId?: string; book?: string; userId?: string };
    const celebrity = resolveCharacter(body.celebrityId ?? "");
    if (!celebrity) return reply.code(404).send({ message: "角色不存在" });

    try {
      let book = (body.book ?? "").trim();
      let author = "";
      let reason = "";
      if (!book) {
        const rec = await bookRecommendation(celebrity, chat);
        book = rec.book;
        author = rec.author;
        reason = rec.reason;
      }
      const opening = await bookClubOpening(celebrity, book, chat);
      broadcastSceneEvent(SCENE, SESSION_ID, {
        type: "book_club",
        celebrityId: celebrity.id,
        name: celebrity.name,
        book,
        opening,
      });
      db.addSceneRecord({
        userId: body.userId,
        scene: SCENE,
        sessionId: SESSION_ID,
        title: `读书会 · ${celebrity.name} 读 ${book}`,
        payload: { celebrityId: celebrity.id, book, opening },
      });
      return { book, author, reason, opening };
    } catch (error) {
      req.log.error(error, "library book club failed");
      return reply.code(502).send({ message: "读书会开场暂时不可用。" });
    }
  });

  // ---- AI 馆员答疑 ----
  app.post("/api/library/librarian", async (req, reply) => {
    const body = (req.body ?? {}) as { topic?: string; question?: string; userId?: string };
    const topic = (body.topic ?? "").trim();
    const question = (body.question ?? "").trim();
    if (!topic || !question) return reply.code(400).send({ message: "主题和问题不能为空。" });

    try {
      const answer = await librarianAnswer(topic, question, chat);
      broadcastSceneEvent(SCENE, SESSION_ID, {
        type: "librarian",
        topic,
        question,
        answer,
      });
      db.addSceneRecord({
        userId: body.userId,
        scene: SCENE,
        sessionId: SESSION_ID,
        title: `馆员答疑 · ${topic}`,
        payload: { topic, question, answer },
      });
      return { answer };
    } catch (error) {
      req.log.error(error, "library librarian failed");
      return reply.code(502).send({ message: "馆员暂时不在，请稍后再试。" });
    }
  });

  // ---- 发布读书笔记/金句到广场 ----
  app.post("/api/library/publish", async (req, reply) => {
    const body = (req.body ?? {}) as {
      title?: string;
      celebrityId?: string;
      celebrityName?: string;
      book?: string;
      question?: string;
      answer?: string;
      topics?: string[];
      userId?: string;
    };
    const title = (body.title ?? "").trim();
    const answer = (body.answer ?? "").trim();
    if (!title || !answer) return reply.code(400).send({ message: "标题和正文不能为空。" });

    const library: LibraryNoteData = {
      celebrityId: body.celebrityId || undefined,
      celebrityName: body.celebrityName || undefined,
      book: body.book || undefined,
      question: body.question || undefined,
      answer,
      createdAt: new Date().toISOString(),
    };
    const content: StoredContent = {
      id: randomUUID(),
      type: "library_note",
      scene: "library",
      author: resolveAuthor(body.userId),
      createdAt: new Date().toISOString(),
      topics: (body.topics ?? []).map((t) => t.trim()).filter(Boolean),
      title,
      likes: 0,
      dislikes: 0,
      views: 0,
      comments: [],
      userId: body.userId ?? "",
      library,
    };
    db.upsertContent(content);
    contents.unshift(content);
    broadcastSceneEvent(SCENE, SESSION_ID, { type: "note_published", title, author: content.author });
    return reply.code(201).send({ content });
  });
}
