// ===== Round4 R4-09: 场景保存 / 分享链接（UGC） =====
// 纯 JSON 文件持久化，不引入数据库：
//   apps/api/.data/scenes/<sceneId>.json  —— 单场景完整数据
//   apps/api/.data/scenes/index.json      —— 元数据索引（列表/权限查询）
// 公开场景任何人可访问；私有场景仅创建者可访问。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SavedScene,
  SavedSceneMeta,
  SaveSceneRequest,
  UpdateSceneVisibilityRequest,
} from "@balabala/shared";

const DATA_DIR = process.env.BALABALA_TEST_DATA_DIR
  ? resolve(process.env.BALABALA_TEST_DATA_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data");
const SCENES_DIR = resolve(DATA_DIR, "scenes");
const INDEX_FILE = resolve(SCENES_DIR, "index.json");

/** 业务错误：REST 层据 statusCode 返回对应 HTTP 状态。 */
export class SceneStoreError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface IndexShape {
  scenes: SavedSceneMeta[];
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
    console.warn("[scene-store] 读取 index.json 失败，使用空索引:", e);
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

/** 测试用：清空内存索引并指向空目录。 */
export function _resetSceneStoreForTest(): void {
  index = structuredClone(EMPTY_INDEX);
}

/** 构造分享链接（前端路由 /studio?scene=<sceneId>）。 */
export function buildShareLink(sceneId: string): string {
  return `/studio?scene=${encodeURIComponent(sceneId)}`;
}

// ===== 核心操作 =====

/** 保存场景（新建或覆盖更新）。body.sceneId 存在时为更新同一场景。 */
export function saveScene(body: SaveSceneRequest & { sceneId?: string }): SavedScene {
  const userId = (body.userId ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!userId) throw new SceneStoreError(400, "bad_request", "userId 不能为空");
  if (!name) throw new SceneStoreError(400, "bad_request", "场景名称不能为空");
  if (body.sceneData === undefined || body.sceneData === null) {
    throw new SceneStoreError(400, "bad_request", "sceneData 不能为空");
  }

  const now = new Date().toISOString();
  const existing = body.sceneId ? index.scenes.find((s) => s.sceneId === body.sceneId) : undefined;

  let scene: SavedScene;
  if (existing) {
    // 更新：仅创建者可覆盖自己的场景
    if (existing.userId !== userId) {
      throw new SceneStoreError(403, "forbidden", "只能保存/更新自己的场景");
    }
    scene = {
      ...existing,
      name,
      sceneData: body.sceneData,
      isPublic: body.isPublic ?? existing.isPublic,
      updatedAt: now,
    };
  } else {
    const sceneId = randomUUID();
    scene = {
      sceneId,
      userId,
      name,
      sceneData: body.sceneData,
      isPublic: body.isPublic ?? false,
      shareLink: buildShareLink(sceneId),
      createdAt: now,
      updatedAt: now,
    };
    index.scenes.unshift({ ...stripData(scene) });
  }

  // 写单场景文件 + 更新索引
  ensureDir();
  writeFileSync(sceneFile(scene.sceneId), JSON.stringify(scene, null, 2), "utf-8");
  const metaIdx = index.scenes.findIndex((s) => s.sceneId === scene.sceneId);
  if (metaIdx >= 0) index.scenes[metaIdx] = stripData(scene);
  persistIndex();
  return scene;
}

function stripData(s: SavedScene): SavedSceneMeta {
  const { sceneData: _omit, ...meta } = s;
  return meta;
}

export interface AccessResult {
  /** 场景是否存在 */
  found: boolean;
  /** viewer 是否有权访问（公开或本人） */
  allowed: boolean;
  scene: SavedScene | null;
}

/**
 * 读取场景详情并做权限判定。
 * 公开场景任何人可访问；私有场景仅创建者（viewerUserId 匹配）可访问。
 */
export function getSharedScene(sceneId: string, viewerUserId?: string): AccessResult {
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) return { found: false, allowed: false, scene: null };

  // 私有场景仅创建者可访问
  if (!meta.isPublic && meta.userId !== (viewerUserId ?? "")) {
    return { found: true, allowed: false, scene: null };
  }

  // 从单文件读完整数据
  try {
    const file = sceneFile(sceneId);
    if (!existsSync(file)) return { found: true, allowed: false, scene: null };
    const scene = JSON.parse(readFileSync(file, "utf-8")) as SavedScene;
    return { found: true, allowed: true, scene };
  } catch (e) {
    console.warn("[scene-store] 读取场景文件失败:", e);
    return { found: true, allowed: false, scene: null };
  }
}

/** 列表：不传 userId 返回全部公开场景；传 userId 返回该用户公开场景。 */
export function listScenes(opts: { userId?: string; publicOnly?: boolean } = {}): SavedSceneMeta[] {
  let list = [...index.scenes];
  if (opts.publicOnly) list = list.filter((s) => s.isPublic);
  if (opts.userId) list = list.filter((s) => s.userId === opts.userId);
  // 最新更新在前
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 修改可见性（仅创建者）。 */
export function setVisibility(sceneId: string, body: UpdateSceneVisibilityRequest): SavedScene {
  const userId = (body.userId ?? "").trim();
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) throw new SceneStoreError(404, "not_found", "场景不存在");
  if (meta.userId !== userId) throw new SceneStoreError(403, "forbidden", "只能修改自己的场景");

  // 更新索引 + 单文件
  meta.isPublic = body.isPublic;
  meta.updatedAt = new Date().toISOString();
  persistIndex();

  let scene: SavedScene;
  try {
    scene = JSON.parse(readFileSync(sceneFile(sceneId), "utf-8")) as SavedScene;
  } catch {
    throw new SceneStoreError(404, "not_found", "场景数据文件缺失");
  }
  scene.isPublic = body.isPublic;
  scene.updatedAt = meta.updatedAt;
  writeFileSync(sceneFile(sceneId), JSON.stringify(scene, null, 2), "utf-8");
  return scene;
}

/** 删除场景（仅创建者）。 */
export function deleteSharedScene(sceneId: string, userId: string): void {
  const meta = index.scenes.find((s) => s.sceneId === sceneId);
  if (!meta) throw new SceneStoreError(404, "not_found", "场景不存在");
  if (meta.userId !== userId) throw new SceneStoreError(403, "forbidden", "只能删除自己的场景");
  index.scenes = index.scenes.filter((s) => s.sceneId !== sceneId);
  persistIndex();
  try { rmSync(sceneFile(sceneId), { force: true }); } catch { /* noop */ }
}

/**
 * 供 scene-routes 委托：若 id 属于 UGC 存储则返回元信息（用于 GET/DELETE /:id 分流）。
 * 返回 null 表示该 id 不在 UGC 存储，应回退到 SQLite 场景库。
 */
export function inspectSharedScene(sceneId: string): SavedSceneMeta | null {
  return index.scenes.find((s) => s.sceneId === sceneId) ?? null;
}

// ===== REST 路由注册 =====
export function registerSceneStoreRoutes(app: FastifyInstance): void {
  // POST /api/scenes —— 保存场景（新建/更新），返回 sceneId + 分享链接
  app.post("/api/scenes", async (req, reply) => {
    const body = (req.body ?? {}) as SaveSceneRequest & { sceneId?: string };
    try {
      const scene = saveScene(body);
      return reply.code(201).send({
        sceneId: scene.sceneId,
        shareLink: scene.shareLink,
        isPublic: scene.isPublic,
      });
    } catch (e) {
      if (e instanceof SceneStoreError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  // GET /api/scenes?userId=X&public=true —— 场景列表
  app.get("/api/scenes", async (req) => {
    const query = (req.query ?? {}) as { userId?: string; public?: string };
    const publicOnly = query.public === "true";
    const userId = query.userId?.trim() || undefined;
    return { scenes: listScenes({ userId, publicOnly }) };
  });

  // PATCH /api/scenes/:sceneId —— 修改可见性
  app.patch("/api/scenes/:sceneId", async (req, reply) => {
    const { sceneId } = req.params as { sceneId: string };
    const body = (req.body ?? {}) as UpdateSceneVisibilityRequest;
    try {
      const scene = setVisibility(sceneId, body);
      return { sceneId: scene.sceneId, isPublic: scene.isPublic, shareLink: scene.shareLink };
    } catch (e) {
      if (e instanceof SceneStoreError) return reply.code(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  // GET /api/scenes/:sceneId/data?viewer=X —— UGC 详情（带权限）
  // 注意：GET /api/scenes/:id 已由 scene-routes 注册，其内部会先委托本存储。
  app.get("/api/scenes/:sceneId/data", async (req, reply) => {
    const { sceneId } = req.params as { sceneId: string };
    const query = (req.query ?? {}) as { viewer?: string };
    const result = getSharedScene(sceneId, query.viewer);
    if (!result.found) return reply.code(404).send({ message: "场景不存在" });
    if (!result.allowed) return reply.code(403).send({ message: "这是私有场景，仅创建者可查看" });
    return result.scene;
  });
}
