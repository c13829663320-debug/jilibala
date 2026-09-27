// ===== Round5 R5-UGC: 一句话造场景 · 发布/分享闭环（服务端） =====
// 纯 JSON 文件持久化（沿用 R4 scene-store 的 .data/ 模式）：
//   apps/api/.data/ugc/scenes/<sceneId>.json —— 单条 UGC 场景完整记录
//   apps/api/.data/ugc/index.json           —— 元数据索引（列表/权限/热门查询）
// additive：不改动 scene-store.ts / scene-routes.ts 的既有逻辑。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SceneDraft,
  SceneTemplate,
  UgcPublishRequest,
  UgcSceneMeta,
  UgcSceneRecord,
  UGCError,
} from "@balabala/shared";
import { SCENE_TEMPLATES } from "../scene-templates.js";

const DATA_DIR = process.env.BALABALA_TEST_DATA_DIR
  ? resolve(process.env.BALABALA_TEST_DATA_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const UGC_DIR = resolve(DATA_DIR, "ugc");
const SCENES_DIR = resolve(UGC_DIR, "scenes");
const INDEX_FILE = resolve(UGC_DIR, "index.json");

/** 业务错误：REST 层据 statusCode 返回对应 HTTP 状态。 */
export class UgcStoreError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface IndexShape {
  scenes: UgcSceneMeta[];
}

const EMPTY_INDEX: IndexShape = { scenes: [] };

let index: IndexShape = loadIndex();

function ensureDir(): void {
  mkdirSync(SCENES_DIR, { recursive: true });
}

function loadIndex(): IndexShape {
  try {
    if (!existsSync(INDEX_FILE)) return structuredClone(EMPTY_INDEX);
    const raw = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as Partial<IndexShape>;
    return { scenes: Array.isArray(raw.scenes) ? raw.scenes : [] };
  } catch (e) {
    console.warn("[ugc-store] 读取 index.json 失败，使用空索引:", e);
    return structuredClone(EMPTY_INDEX);
  }
}

function persistIndex(): void {
  ensureDir();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

function sceneFile(sceneId: string): string {
  return resolve(SCENES_DIR, `${sceneId}.json`);
}

/** 测试用：清空内存索引。 */
export function _resetUgcStoreForTest(): void {
  index = structuredClone(EMPTY_INDEX);
}

/** 构造分享链接（前端路由 /studio?scene=<sceneId>）。 */
export function buildUgcShareLink(sceneId: string): string {
  return `/studio?scene=${encodeURIComponent(sceneId)}`;
}

/** 生成可与内置场景名区分的 UGC 场景 id（ugc_ 前缀）。 */
export function newUgcSceneId(): string {
  return `ugc_${randomUUID()}`;
}

/** 是否为 UGC 场景 id（前端路由分流用）。 */
export function isUgcSceneId(id: string): boolean {
  return id.startsWith("ugc_");
}

// ===== 校验 =====

/** 服务端草稿校验：返回错误列表（空 = 通过）。 */
export function validateDraft(draft: SceneDraft | undefined): UGCError[] {
  const errors: UGCError[] = [];
  if (!draft || typeof draft !== "object") {
    return [{ code: "invalid_draft", message: "场景草稿不能为空", retryable: false }];
  }
  if (!draft.theme || typeof draft.theme !== "string") {
    errors.push({ code: "bad_prompt", message: "缺少场景主题", retryable: false });
  }
  if (!draft.gameType) {
    errors.push({ code: "bad_prompt", message: "缺少玩法类型", retryable: false });
  }
  if (!Array.isArray(draft.celebrityIds)) {
    errors.push({ code: "bad_prompt", message: "参与名人列表格式错误", retryable: false });
  }
  return errors;
}

function stripMeta(r: UgcSceneRecord): UgcSceneMeta {
  const { draft: _omit, shareLink: _s, error: _e, ...meta } = r;
  return meta;
}

// ===== 核心操作 =====

/** 发布（新建）一条 UGC 场景。校验失败抛 400。 */
export function publishUgcScene(body: UgcPublishRequest): UgcSceneRecord {
  const userId = (body.userId ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!userId) throw new UgcStoreError(400, "bad_request", "userId 不能为空");
  if (!name) throw new UgcStoreError(400, "bad_request", "场景名称不能为空");

  const draftErrors = validateDraft(body.draft);
  if (draftErrors.length > 0) {
    throw new UgcStoreError(400, "invalid_draft", draftErrors[0].message);
  }

  const now = new Date().toISOString();
  const sceneId = newUgcSceneId();
  const record: UgcSceneRecord = {
    sceneId,
    userId,
    name,
    draft: body.draft,
    status: "published",
    isPublic: body.isPublic ?? true,
    shareLink: buildUgcShareLink(sceneId),
    playCount: 0,
    createdAt: now,
    updatedAt: now,
    theme: body.draft.theme,
    style: body.draft.style,
  };

  ensureDir();
  writeFileSync(sceneFile(sceneId), JSON.stringify(record, null, 2), "utf-8");
  index.scenes.unshift(stripMeta(record));
  persistIndex();
  return record;
}

export interface UgcAccessResult {
  found: boolean;
  allowed: boolean;
  record: UgcSceneRecord | null;
}

/**
 * 读取一条 UGC 场景并做权限判定。
 * 公开已发布场景任何人可进入；草稿/失败/私有仅创建者可访问。
 */
export function getUgcScene(sceneId: string, viewerUserId?: string): UgcAccessResult {
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) return { found: false, allowed: false, record: null };

  const owner = meta.userId === (viewerUserId ?? "");
  const publiclyViewable = meta.status === "published" && meta.isPublic;
  if (!publiclyViewable && !owner) {
    return { found: true, allowed: false, record: null };
  }

  try {
    const file = sceneFile(sceneId);
    if (!existsSync(file)) return { found: true, allowed: false, record: null };
    const record = JSON.parse(readFileSync(file, "utf-8")) as UgcSceneRecord;
    // 每次他人进入 playCount+1（仅公开已发布）
    if (publiclyViewable && !owner) {
      record.playCount += 1;
      meta.playCount = record.playCount;
      record.updatedAt = new Date().toISOString();
      writeFileSync(file, JSON.stringify(record, null, 2), "utf-8");
      persistIndex();
    }
    return { found: true, allowed: true, record };
  } catch (e) {
    console.warn("[ugc-store] 读取场景文件失败:", e);
    return { found: true, allowed: false, record: null };
  }
}

/** 我的作品：返回某用户全部状态（草稿/已发布/失败）。 */
export function listMine(userId: string): UgcSceneMeta[] {
  if (!userId) return [];
  return index.scenes
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 热门用户作品：公开已发布，按 playCount 降序，取前 limit 条。 */
export function listHot(limit = 6): UgcSceneMeta[] {
  return index.scenes
    .filter((s) => s.status === "published" && s.isPublic)
    .sort((a, b) => b.playCount - a.playCount || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** 更新（重新发布 / 改名 / 改可见性），仅创建者。 */
export function updateUgcScene(
  sceneId: string,
  userId: string,
  patch: { name?: string; draft?: SceneDraft; isPublic?: boolean; status?: UgcSceneRecord["status"] },
): UgcSceneRecord {
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) throw new UgcStoreError(404, "not_found", "场景不存在");
  if (meta.userId !== userId) throw new UgcStoreError(403, "forbidden", "只能修改自己的作品");

  let record: UgcSceneRecord;
  try {
    record = JSON.parse(readFileSync(sceneFile(sceneId), "utf-8")) as UgcSceneRecord;
  } catch {
    throw new UgcStoreError(404, "not_found", "场景数据文件缺失");
  }

  if (patch.name !== undefined) record.name = patch.name.trim() || record.name;
  if (patch.draft !== undefined) {
    const errs = validateDraft(patch.draft);
    if (errs.length > 0) throw new UgcStoreError(400, "invalid_draft", errs[0].message);
    record.draft = patch.draft;
    record.theme = patch.draft.theme;
    record.style = patch.draft.style;
  }
  if (patch.isPublic !== undefined) record.isPublic = patch.isPublic;
  if (patch.status !== undefined) {
    record.status = patch.status;
    if (patch.status !== "failed") delete record.error;
  }
  record.updatedAt = new Date().toISOString();

  writeFileSync(sceneFile(sceneId), JSON.stringify(record, null, 2), "utf-8");
  const idx = index.scenes.findIndex((s) => s.sceneId === sceneId);
  index.scenes[idx] = stripMeta(record);
  persistIndex();
  return record;
}

/** 删除我的作品，仅创建者。 */
export function removeUgcScene(sceneId: string, userId: string): void {
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) throw new UgcStoreError(404, "not_found", "场景不存在");
  if (meta.userId !== userId) throw new UgcStoreError(403, "forbidden", "只能删除自己的作品");
  index.scenes = index.scenes.filter((s) => s.sceneId !== sceneId);
  persistIndex();
  try { rmSync(sceneFile(sceneId), { force: true }); } catch { /* noop */ }
}

/** 模板市场数据：官方模板 + 热门用户作品。 */
export function getTemplateBundle(): { official: SceneTemplate[]; hot: UgcSceneMeta[] } {
  return { official: SCENE_TEMPLATES, hot: listHot(6) };
}

// ===== REST 路由注册 =====
export function registerUgcRoutes(app: FastifyInstance): void {
  // POST /api/ugc/scenes —— 发布一句话场景，返回记录 + 分享链接
  app.post("/api/ugc/scenes", async (req, reply) => {
    const body = (req.body ?? {}) as UgcPublishRequest;
    try {
      const record = publishUgcScene(body);
      return reply.code(201).send({
        sceneId: record.sceneId,
        shareLink: record.shareLink,
        status: record.status,
        isPublic: record.isPublic,
      });
    } catch (e) {
      if (e instanceof UgcStoreError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  // GET /api/ugc/scenes/:id —— 他人进入（公开已发布任何人；否则需 viewer=创建者）
  app.get("/api/ugc/scenes/:sceneId", async (req, reply) => {
    const { sceneId } = req.params as { sceneId: string };
    const query = (req.query ?? {}) as { viewer?: string };
    const result = getUgcScene(sceneId, query.viewer);
    if (!result.found) return reply.code(404).send({ error: "场景不存在", code: "not_found" });
    if (!result.allowed) return reply.code(403).send({ error: "这是私有的，仅创建者可进入", code: "forbidden" });
    return result.record;
  });

  // PATCH /api/ugc/scenes/:id —— 编辑 / 重新发布 / 改可见性（仅创建者）
  app.patch("/api/ugc/scenes/:sceneId", async (req, reply) => {
    const { sceneId } = req.params as { sceneId: string };
    const body = (req.body ?? {}) as {
      userId: string; name?: string; draft?: SceneDraft; isPublic?: boolean; status?: UgcSceneRecord["status"];
    };
    try {
      const record = updateUgcScene(sceneId, body.userId, body);
      return { sceneId: record.sceneId, status: record.status, shareLink: record.shareLink };
    } catch (e) {
      if (e instanceof UgcStoreError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  // DELETE /api/ugc/scenes/:id?userId= —— 删除我的作品
  app.delete("/api/ugc/scenes/:sceneId", async (req, reply) => {
    const { sceneId } = req.params as { sceneId: string };
    const query = (req.query ?? {}) as { userId?: string };
    try {
      removeUgcScene(sceneId, query.userId ?? "");
      return reply.code(204).send();
    } catch (e) {
      if (e instanceof UgcStoreError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  // GET /api/ugc/templates —— 官方模板 + 热门用户作品
  app.get("/api/ugc/templates", async () => {
    return getTemplateBundle();
  });

  // GET /api/ugc/mine?userId= —— 我的作品（全部状态）
  app.get("/api/ugc/mine", async (req) => {
    const query = (req.query ?? {}) as { userId?: string };
    return { scenes: listMine(query.userId?.trim() ?? "") };
  });
}
