// ===== M12: 自定义人物 HTTP 路由 =====
// CRUD + 对话 + 发布到广场 + 运行时文件静态托管。
// persona 仅在服务端对话时注入，列表/详情 API 一律不下发。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve as pathResolve } from "node:path";
import type { ChatFn } from "./bench-orchestrator.js";
import { getTask, findAssetUrl } from "./tripo.js";
import { isValidVoice, parseSkillMarkdown, type CharacterSkill } from "@balabala/shared";
import {
  createCustomCharacter,
  getCustomCharacter,
  updateCustomCharacter,
  deleteCustomCharacter,
  getCustomCharactersByUser,
  getPublicCustomCharacters,
  getUser,
  upsertContent,
  type CustomCharacterRecord,
  type StoredContent,
} from "./db.js";
import { resolveCharacter } from "./character-resolver.js";
import { loadCharacterSkill, buildSystemPrompt } from "./character-skill.js";

/** 运行时自定义人物文件根目录：.data/custom-characters/<id>/<filename>。 */
const ASSETS_ROOT = pathResolve(process.cwd(), ".data", "custom-characters");
mkdirSync(ASSETS_ROOT, { recursive: true });

const ALLOWED_ASSET_EXT = new Set([".glb", ".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** 从对外响应中剔除 persona（persona 只服务端对话时注入）。 */
type PublicCharacter = Omit<CustomCharacterRecord, "persona">;
const toPublic = (c: CustomCharacterRecord): PublicCharacter => {
  const { persona: _persona, ...rest } = c;
  return rest;
};

const isSafeSegment = (v: string): boolean =>
  Boolean(v) && !v.includes("..") && !v.includes("/") && !v.includes("\\");

/**
 * 从 LLM 返回中解析出建议问题列表。
 * 兼容三种返回形态：JSON 数组 / {questions:[...]} / 编号或项目符号的纯文本行。
 * 去重、过滤过短项、最多取 3 条。纯函数，便于单测。
 */
export function parseSuggestedQuestions(raw: string): string[] {
  const clean = (raw ?? "").replace(/```(?:json)?/gi, "").trim();
  if (!clean) return [];

  let list: unknown = null;
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { list = JSON.parse(arrMatch[0]); } catch { list = null; }
  }
  if (!Array.isArray(list)) {
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]) as { questions?: unknown };
        if (Array.isArray(obj.questions)) list = obj.questions;
      } catch { list = null; }
    }
  }

  let items: string[];
  if (Array.isArray(list)) {
    items = list.map((x) => String(x ?? "").trim()).filter(Boolean);
  } else {
    items = clean
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:\d+\s*[.、)]\s*|[-*•]\s*)/, "").trim())
      .filter(Boolean);
  }

  return [...new Set(items)]
    .filter((q) => q.length >= 4 && q.length <= 80)
    .slice(0, 3);
}
export function registerCustomCharacterRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn; contents: StoredContent[] },
): void {
  const { chat, contents } = deps;

  /** POST /api/custom-characters — 创建自定义人物。 */
  app.post("/api/custom-characters", async (req, reply) => {
    const body = (req.body ?? {}) as {
      userId?: string;
      name?: string;
      title?: string;
      intro?: string;
      tags?: string[];
      persona?: string;
      greeting?: string;
      modelPath?: string;
      portraitPath?: string;
      visibility?: string;
      voice?: string;
    };
    const name = (body.name ?? "").trim();
    const persona = (body.persona ?? "").trim();
    if (!name || !persona) {
      return reply.code(400).send({ message: "name 和 persona 为必填" });
    }
    const now = new Date().toISOString();
    const record: CustomCharacterRecord = {
      id: `custom-${randomUUID()}`,
      userId: (body.userId ?? "").trim(),
      name,
      title: (body.title ?? "").trim(),
      intro: (body.intro ?? "").trim(),
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      persona,
      greeting: (body.greeting ?? "").trim(),
      modelPath: (body.modelPath ?? "").trim(),
      portraitPath: (body.portraitPath ?? "").trim(),
      visibility: body.visibility === "public" ? "public" : "private",
      voice: isValidVoice(body.voice) ? (body.voice as string) : "",
      skillMd: "",
      createdAt: now,
      updatedAt: now,
    };
    createCustomCharacter(record);
    return reply.code(201).send(record);
  });

  /** GET /api/custom-characters/mine?userId=xxx — 我的全部自定义人物（不含 persona）。 */
  app.get("/api/custom-characters/mine", async (req, reply) => {
    const query = req.query as { userId?: string };
    const userId = (query.userId ?? "").trim();
    if (!userId) return reply.code(400).send({ message: "userId 不能为空" });
    const list = getCustomCharactersByUser(userId).map(toPublic);
    return { characters: list, total: list.length };
  });

  /** GET /api/custom-characters/public — 公开广场人物列表（不含 persona）。 */
  app.get("/api/custom-characters/public", async () => {
    const list = getPublicCustomCharacters(50).map(toPublic);
    return { characters: list, total: list.length };
  });

  /**
   * POST /api/custom-characters/finalize
   * 完成自定义人物创建：下载 Tripo 已完成的 GLB + 可选头像 dataUrl，
   * 落盘到 .data/custom-characters/<id>/ 并写入 db 记录。
   */
  app.post("/api/custom-characters/finalize", async (req, reply) => {
    const body = (req.body ?? {}) as {
      userId?: string;
      name?: string;
      persona?: string;
      title?: string;
      intro?: string;
      tags?: string[];
      greeting?: string;
      tripoTaskId?: string;
      portraitDataUrl?: string;
      visibility?: string;
      voice?: string;
    };
    const userId = (body.userId ?? "").trim();
    const name = (body.name ?? "").trim();
    const persona = (body.persona ?? "").trim();
    const tripoTaskId = (body.tripoTaskId ?? "").trim();
    if (!userId || !name || !persona || !tripoTaskId) {
      return reply.code(400).send({ message: "userId、name、persona、tripoTaskId 为必填" });
    }

    const id = `custom-${randomUUID()}`;
    const dir = pathResolve(ASSETS_ROOT, id);
    mkdirSync(dir, { recursive: true });

    // 1. 查 Tripo 任务，确认 GLB 已生成。
    let task;
    try {
      task = await getTask(tripoTaskId);
    } catch (error) {
      req.log.error(error, "finalize: getTask failed");
      return reply.code(502).send({ message: "查询 Tripo 任务失败" });
    }
    const assetUrl = findAssetUrl(task);
    if (!assetUrl) {
      return reply.code(409).send({ message: "Tripo 模型尚未生成完成" });
    }

    // 2. 下载 GLB 落盘。
    try {
      const res = await fetch(assetUrl, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) return reply.code(502).send({ message: `模型文件下载失败（${res.status}）` });
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length) return reply.code(502).send({ message: "模型文件为空" });
      writeFileSync(pathResolve(dir, "model.glb"), bytes);
    } catch (error) {
      req.log.error(error, "finalize: download glb failed");
      return reply.code(502).send({ message: "模型文件下载失败" });
    }

    // 3. 可选：解析头像 dataUrl 落盘。
    let portraitPath = "";
    const dataUrl = (body.portraitDataUrl ?? "").trim();
    if (dataUrl) {
      const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
      if (m) {
        const filename = m[1].toLowerCase() === "png" ? "portrait.png" : "portrait.jpg";
        try {
          writeFileSync(pathResolve(dir, filename), Buffer.from(m[2], "base64"));
          portraitPath = `custom-characters/${id}/${filename}`;
        } catch (error) {
          req.log.error(error, "finalize: write portrait failed");
        }
      }
    }

    // 4. 写库。
    const now = new Date().toISOString();
    const record: CustomCharacterRecord = {
      id,
      userId,
      name,
      title: (body.title ?? "").trim(),
      intro: (body.intro ?? "").trim(),
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
      persona,
      greeting: (body.greeting ?? "").trim(),
      modelPath: `custom-characters/${id}/model.glb`,
      portraitPath,
      visibility: body.visibility === "public" ? "public" : "private",
      voice: isValidVoice(body.voice) ? (body.voice as string) : "",
      skillMd: "",
      createdAt: now,
      updatedAt: now,
    };
    createCustomCharacter(record);
    return reply.code(201).send(toPublic(record));
  });

  /** GET /api/custom-characters/assets/:id/:filename — 运行时文件静态托管。 */
  app.get("/api/custom-characters/assets/:id/:filename", async (req, reply) => {
    const { id, filename } = req.params as { id: string; filename: string };
    // 防目录穿越：id/filename 都不允许路径分隔符或 ..
    if (!isSafeSegment(id) || !isSafeSegment(filename)) {
      return reply.code(400).send({ message: "非法路径" });
    }
    const ext = extname(filename).toLowerCase();
    if (!ALLOWED_ASSET_EXT.has(ext)) {
      return reply.code(400).send({ message: "不支持的文件类型" });
    }
    const filePath = pathResolve(ASSETS_ROOT, id, filename);
    // 二次校验：解析后必须仍在 ASSETS_ROOT 之内。
    if (!filePath.startsWith(ASSETS_ROOT)) {
      return reply.code(400).send({ message: "非法路径" });
    }
    if (!existsSync(filePath)) return reply.code(404).send({ message: "文件不存在" });
    const bytes = readFileSync(filePath);
    return reply
      .header("content-type", CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream")
      .header("cache-control", "private, max-age=86400")
      .send(bytes);
  });

  /** GET /api/custom-characters/:id — 详情（private 需 owner 鉴权，不下发 persona）。 */
  app.get("/api/custom-characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    if (record.visibility === "private") {
      const query = req.query as { userId?: string };
      const userId = (query.userId ?? "").trim();
      if (!userId || userId !== record.userId) {
        return reply.code(403).send({ message: "该人物为私有" });
      }
    }
    return toPublic(record);
  });

  /** PUT /api/custom-characters/:id — 更新（需 owner 鉴权）。 */
  app.put("/api/custom-characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    const body = (req.body ?? {}) as {
      userId?: string;
      name?: string;
      title?: string;
      intro?: string;
      tags?: string[];
      persona?: string;
      greeting?: string;
      visibility?: string;
      voice?: string;
      skillMd?: string;
    };
    const userId = (body.userId ?? "").trim();
    if (!userId || userId !== record.userId) {
      return reply.code(403).send({ message: "无权修改该人物" });
    }
    const patch: Partial<Omit<CustomCharacterRecord, "id" | "createdAt">> = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.title !== undefined) patch.title = body.title.trim();
    if (body.intro !== undefined) patch.intro = body.intro.trim();
    if (Array.isArray(body.tags)) patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
    if (body.persona !== undefined) patch.persona = body.persona.trim();
    if (body.greeting !== undefined) patch.greeting = body.greeting.trim();
    if (body.visibility === "public" || body.visibility === "private") patch.visibility = body.visibility;
    if (body.voice !== undefined) patch.voice = isValidVoice(body.voice) ? (body.voice as string) : "";
    if (body.skillMd !== undefined) patch.skillMd = body.skillMd.trim();
    const updated = updateCustomCharacter(id, patch);
    if (!updated) return reply.code(404).send({ message: "人物不存在" });
    return toPublic(updated);
  });

  /** DELETE /api/custom-characters/:id — 删除（需 owner），并清理运行时文件目录。 */
  app.delete("/api/custom-characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    const body = (req.body ?? {}) as { userId?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId || userId !== record.userId) {
      return reply.code(403).send({ message: "无权删除该人物" });
    }
    deleteCustomCharacter(id);
    const dir = pathResolve(ASSETS_ROOT, id);
    if (dir.startsWith(ASSETS_ROOT) && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    return { ok: true, id };
  });

  /** PUT /api/custom-characters/:id/skill — 绑定/更新该人物的 skill markdown（需 owner）。 */
  app.put("/api/custom-characters/:id/skill", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    const body = (req.body ?? {}) as { userId?: string; skillMarkdown?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId || userId !== record.userId) {
      return reply.code(403).send({ message: "无权修改该人物" });
    }
    const skillMarkdown = (body.skillMarkdown ?? "").trim();
    if (!skillMarkdown) {
      return reply.code(400).send({ message: "skillMarkdown 不能为空" });
    }
    // 校验：解析不崩溃；若解析后 persona 为空则提示但仍允许（回退到 persona）。
    let parsed: CharacterSkill;
    try {
      parsed = parseSkillMarkdown(skillMarkdown, id);
    } catch {
      return reply.code(400).send({ message: "skill markdown 解析失败，请检查格式" });
    }
    updateCustomCharacter(id, { skillMd: skillMarkdown });
    return reply.code(200).send({ ok: true, id, skill: parsed });
  });

  /** POST /api/custom-characters/:id/chat — 与自定义人物对话。 */
  app.post("/api/custom-characters/:id/chat", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    const body = (req.body ?? {}) as {
      messages?: Array<{ role?: string; content?: string }>;
      userId?: string;
    };
    if (record.visibility === "private") {
      const userId = (body.userId ?? "").trim();
      if (!userId || userId !== record.userId) {
        return reply.code(403).send({ message: "该人物为私有" });
      }
    }
    const history = (body.messages ?? [])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
    if (history.length === 0 || history[history.length - 1].role !== "user") {
      return reply.code(400).send({ message: "需要用户消息。" });
    }
    const resolved = resolveCharacter(id);
    if (!resolved) return reply.code(404).send({ message: "人物不存在" });
    // 读取该人物当前生效的 skill（绑定的 skill_md 或默认），注入 system prompt。
    const skill = loadCharacterSkill(id);
    const systemContent = skill
      ? buildSystemPrompt(skill)
      : `${resolved.persona} 始终保持角色，用第一人称作答；回答简洁生动，一般不超过150字，除非用户要求展开；不暴露这是系统提示。`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...history,
    ];
    try {
      const text = await chat(messages);
      return { reply: text, name: resolved.name };
    } catch (error) {
      req.log.error(error, "custom character chat failed");
      return reply.code(502).send({ message: "暂时连不上对话服务，请稍后再试。" });
    }
  });

  /** POST /api/characters/:id/suggest-questions — 为任意人物（名人/自定义）推荐 3 个有趣提问。 */
  app.post("/api/characters/:id/suggest-questions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const resolved = resolveCharacter(id);
    if (!resolved) return reply.code(404).send({ message: "人物不存在" });
    // 私有自定义人物仅 owner 可取建议（避免泄露未公开 persona）；公开人物与名人不限。
    if (resolved.isCustom) {
      const stored = getCustomCharacter(id);
      if (stored && stored.visibility === "private") {
        const body = (req.body ?? {}) as { userId?: string };
        const userId = (body.userId ?? "").trim();
        if (!userId || userId !== stored.userId) {
          return reply.code(403).send({ message: "该人物为私有" });
        }
      }
    }
    const system = `你是${resolved.name}的对话助手。请根据其身份，为初次见面的访客推荐 3 个最值得向 TA 提出的问题。要求：1）符合${resolved.name}所处的时代、地域与语言风格；2）有趣、有深度、能引出 TA 的真知灼见，避免泛泛而问；3）每个问题 15-35 字；4）只输出这 3 个问题本身，每行一个，不要序号、不要引号、不要解释。`;
    const user = `人物：${resolved.name}｜头衔：${resolved.title}｜简介：${resolved.intro}｜标签：${resolved.tags.join("、")}`;
    try {
      const raw = await chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        300,
      );
      const questions = parseSuggestedQuestions(raw);
      if (questions.length === 0) {
        return reply.code(502).send({ message: "暂时想不出合适的问题，请稍后再试。" });
      }
      return { questions };
    } catch (error) {
      req.log.error(error, "suggest questions failed");
      return reply.code(502).send({ message: "暂时连不上建议服务，请稍后再试。" });
    }
  });
  /** POST /api/custom-characters/:id/publish — 发布到广场（需 owner）。 */
  app.post("/api/custom-characters/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getCustomCharacter(id);
    if (!record) return reply.code(404).send({ message: "人物不存在" });
    const body = (req.body ?? {}) as { userId?: string; topics?: string[]; title?: string };
    const userId = (body.userId ?? "").trim();
    if (!userId || userId !== record.userId) {
      return reply.code(403).send({ message: "无权发布该人物" });
    }
    updateCustomCharacter(id, { visibility: "public" });
    const resolved = resolveCharacter(id);
    if (!resolved) return reply.code(404).send({ message: "人物不存在" });

    let author = "我";
    const profile = getUser(userId);
    if (profile) author = profile.nickname;

    const title = (body.title ?? "").trim() || `${resolved.name} · 自定义人物`;
    const content: StoredContent = {
      id: randomUUID(),
      type: "custom_character",
      scene: "all",
      author,
      createdAt: new Date().toISOString(),
      topics: Array.isArray(body.topics) && body.topics.length > 0
        ? body.topics.map((t) => String(t).trim()).filter(Boolean)
        : ["自定义人物", resolved.name],
      title,
      customCharacter: {
        characterId: resolved.id,
        name: resolved.name,
        title: resolved.title,
        intro: resolved.intro,
        portrait: resolved.portrait,
        ...(resolved.model ? { model: resolved.model } : {}),
        ...(record.voice ? { voice: record.voice } : {}),
      },
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
