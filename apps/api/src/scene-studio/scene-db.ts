// ===== 自定义场景工作室 · SQLite DAO (node:sqlite, Node 22 内置) =====
// 与 db.ts 同模式：createRequire 动态加载 node:sqlite（避免 vite/vitest 静态分析剥掉 node: 前缀）。
// DB_PATH 可环境变量覆盖（测试指向临时文件），默认 .data/app.db。
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  SceneRecord,
  SceneAssetRecord,
  SceneStatus,
  TerrainTheme,
  SceneBlueprint,
} from "@balabala/shared";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), ".data", "app.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const sceneDb = new DatabaseSync(DB_PATH);

// ===== 建表（CREATE TABLE IF NOT EXISTS + PRAGMA table_info 幂等迁移）=====
function tableHasColumn(table: string, column: string): boolean {
  const rows = sceneDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function ensureColumn(table: string, column: string, def: string): void {
  if (!tableHasColumn(table, column)) {
    sceneDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

function createTables(): void {
  sceneDb.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      theme TEXT NOT NULL DEFAULT 'forest',
      status TEXT NOT NULL DEFAULT 'draft',
      blueprint_json TEXT NOT NULL DEFAULT '{}',
      cover TEXT NOT NULL DEFAULT '',
      play_count INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  sceneDb.exec(`
    CREATE TABLE IF NOT EXISTS scene_assets (
      id TEXT PRIMARY KEY,
      scene_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'structure',
      source TEXT NOT NULL DEFAULT 'library',
      url TEXT NOT NULL DEFAULT '',
      tripo_task_id TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )
  `);
  // 幂等迁移：补列（列已存在则跳过）。
  ensureColumn("scenes", "name", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scenes", "description", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scenes", "theme", "TEXT NOT NULL DEFAULT 'forest'");
  ensureColumn("scenes", "status", "TEXT NOT NULL DEFAULT 'draft'");
  ensureColumn("scenes", "blueprint_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn("scenes", "cover", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scenes", "play_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("scenes", "owner_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scene_assets", "scene_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scene_assets", "type", "TEXT NOT NULL DEFAULT 'structure'");
  ensureColumn("scene_assets", "source", "TEXT NOT NULL DEFAULT 'library'");
  ensureColumn("scene_assets", "url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scene_assets", "tripo_task_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scene_assets", "meta", "TEXT NOT NULL DEFAULT '{}'");
}

createTables();

// ===== JSON 辅助 =====
function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "{}"; }
}

// ===== 行 → 领域对象 =====
type SceneRow = {
  id: string; name: string; description: string; theme: string;
  status: string; blueprint_json: string; cover: string;
  play_count: number; owner_id: string; created_at: string; updated_at: string;
};

function rowToScene(row: SceneRow): SceneRecord {
  return {
    id: row.id,
    name: row.name ?? "",
    description: row.description ?? "",
    theme: (row.theme || "forest") as TerrainTheme,
    status: (row.status || "draft") as SceneStatus,
    blueprint_json: row.blueprint_json || "{}",
    cover: row.cover ?? "",
    play_count: row.play_count ?? 0,
    owner_id: row.owner_id ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type SceneAssetRow = {
  id: string; scene_id: string; type: string; source: string;
  url: string; tripo_task_id: string; meta: string; created_at: string;
};

function rowToAsset(row: SceneAssetRow): SceneAssetRecord {
  return {
    id: row.id,
    scene_id: row.scene_id ?? "",
    type: (row.type || "structure") as SceneAssetRecord["type"],
    source: (row.source || "library") as SceneAssetRecord["source"],
    url: row.url ?? "",
    tripo_task_id: row.tripo_task_id ?? "",
    meta: row.meta || "{}",
    created_at: row.created_at,
  };
}

// ===== 蓝图存取辅助（blueprint_json <-> SceneBlueprint）=====
export function parseBlueprint(record: SceneRecord): SceneBlueprint {
  return safeParse<SceneBlueprint>(record.blueprint_json, {} as SceneBlueprint);
}

// ===== 场景 DAO =====

export type CreateSceneInput = {
  name: string;
  description: string;
  theme: TerrainTheme;
  owner_id?: string;
  status?: SceneStatus;
  blueprint?: SceneBlueprint;
  cover?: string;
};

/** 创建场景记录。blueprint 不传时存 '{}'。返回完整记录。 */
export function createScene(input: CreateSceneInput): SceneRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  const blueprintJson = input.blueprint ? safeStringify(input.blueprint) : "{}";
  sceneDb.prepare(`
    INSERT INTO scenes (id, name, description, theme, status, blueprint_json, cover, play_count, owner_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description,
    input.theme,
    input.status ?? "draft",
    blueprintJson,
    input.cover ?? "",
    0,
    input.owner_id ?? "",
    now,
    now,
  );
  return getScene(id)!;
}

export function getScene(id: string): SceneRecord | undefined {
  const row = sceneDb.prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
  return row ? rowToScene(row) : undefined;
}

export type SceneListFilters = {
  ownerId?: string;
  status?: SceneStatus;
};

/** 列表查询：按 owner_id / status 过滤，按更新时间倒序。 */
export function listScenes(filters?: SceneListFilters): SceneRecord[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filters?.ownerId) { where.push("owner_id = ?"); params.push(filters.ownerId); }
  if (filters?.status) { where.push("status = ?"); params.push(filters.status); }
  const sql = `SELECT * FROM scenes${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`;
  const rows = sceneDb.prepare(sql).all(...params) as SceneRow[];
  return rows.map(rowToScene);
}

export type ScenePatch = Partial<
  Pick<SceneRecord, "name" | "description" | "theme" | "status" | "cover" | "owner_id">
> & { blueprint?: SceneBlueprint };

/** 局部更新场景。blueprint 传入对象时自动 stringify 到 blueprint_json。返回更新后记录。 */
export function updateScene(id: string, patch: ScenePatch): SceneRecord | undefined {
  const existing = getScene(id);
  if (!existing) return undefined;
  const sets: string[] = [];
  const params: string[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); params.push(patch.name); }
  if (patch.description !== undefined) { sets.push("description = ?"); params.push(patch.description); }
  if (patch.theme !== undefined) { sets.push("theme = ?"); params.push(patch.theme); }
  if (patch.status !== undefined) { sets.push("status = ?"); params.push(patch.status); }
  if (patch.cover !== undefined) { sets.push("cover = ?"); params.push(patch.cover); }
  if (patch.owner_id !== undefined) { sets.push("owner_id = ?"); params.push(patch.owner_id); }
  if (patch.blueprint !== undefined) { sets.push("blueprint_json = ?"); params.push(safeStringify(patch.blueprint)); }
  if (sets.length === 0) return existing;
  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);
  sceneDb.prepare(`UPDATE scenes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getScene(id);
}

export function deleteScene(id: string): boolean {
  const res = sceneDb.prepare("DELETE FROM scenes WHERE id = ?").run(id);
  return Number(res.changes ?? 0) > 0;
}

export function incrementPlayCount(id: string): number {
  sceneDb.prepare("UPDATE scenes SET play_count = play_count + 1, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  const row = sceneDb.prepare("SELECT play_count FROM scenes WHERE id = ?").get(id) as { play_count: number } | undefined;
  return row?.play_count ?? 0;
}

// ===== 资产 DAO =====

export type CreateAssetInput = Omit<SceneAssetRecord, "id" | "created_at"> & { id?: string };

export function addAsset(asset: CreateAssetInput): SceneAssetRecord {
  const id = asset.id ?? randomUUID();
  const now = new Date().toISOString();
  sceneDb.prepare(`
    INSERT INTO scene_assets (id, scene_id, type, source, url, tripo_task_id, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    asset.scene_id,
    asset.type,
    asset.source,
    asset.url,
    asset.tripo_task_id ?? "",
    typeof asset.meta === "string" ? asset.meta : safeStringify(asset.meta ?? {}),
    now,
  );
  const row = sceneDb.prepare("SELECT * FROM scene_assets WHERE id = ?").get(id) as SceneAssetRow | undefined;
  return rowToAsset(row!);
}

export function getAssetsByScene(sceneId: string): SceneAssetRecord[] {
  const rows = sceneDb.prepare("SELECT * FROM scene_assets WHERE scene_id = ? ORDER BY created_at ASC")
    .all(sceneId) as SceneAssetRow[];
  return rows.map(rowToAsset);
}

export function deleteAssetsByScene(sceneId: string): void {
  sceneDb.prepare("DELETE FROM scene_assets WHERE scene_id = ?").run(sceneId);
}
