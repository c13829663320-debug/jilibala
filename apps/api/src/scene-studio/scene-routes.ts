// ===== 自定义场景工作室 · HTTP 路由 =====
// 前缀 /api/scenes：自然语言生成(SSE)、CRUD、NPC 编辑、发布、播放载荷。
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  CELEBRITIES,
  type SceneBlueprint,
  type SceneNpc,
  type SceneStructure,
  type SceneRecord,
  type SceneGenerateEvent,
  type ScenePlayPayload,
  type CreateSceneRequest,
  type UpdateSceneRequest,
  type TerrainTheme,
  type GameplayTemplate,
} from "@balabala/shared";
import type { ChatFn } from "../bench-orchestrator.js";
import { planScene, fallbackBlueprint, type NpcRecommendation } from "./scene-planner.js";
import {
  createScene,
  getScene,
  listScenes,
  updateScene,
  deleteScene,
  incrementPlayCount,
  addAsset,
  getAssetsByScene,
  deleteAssetsByScene,
  parseBlueprint,
  type CreateSceneInput,
} from "./scene-db.js";
import {
  buildSceneStructureAsset,
  resolveLibraryAsset,
} from "./scene-asset-builder.js";
import { getCustomCharacter } from "../db.js";

/** 列表摘要：剔除 blueprint_json 全文，只返回元信息。 */
type SceneSummary = Omit<SceneRecord, "blueprint_json"> & { hasBlueprint: boolean };
function toSummary(rec: SceneRecord): SceneSummary {
  const { blueprint_json: _omit, ...rest } = rec;
  return { ...rest, hasBlueprint: Boolean(rec.blueprint_json && rec.blueprint_json !== "{}") };
}

export function registerSceneStudioRoutes(
  app: FastifyInstance,
  deps: { chat: ChatFn },
): void {
  const { chat } = deps;

  // ----- POST /api/scenes/generate — SSE 流式生成 -----
  app.post("/api/scenes/generate", async (req, reply) => {
    const body = (req.body ?? {}) as CreateSceneRequest;
    if (!body.description || !body.description.trim()) {
      return reply.code(400).send({ message: "description 为必填" });
    }

    const theme: TerrainTheme = body.theme ?? "forest";
    const name = body.name?.trim() || body.description.slice(0, 20);

    // 1) 创建 scene 记录（status=generating）
    const scene = createScene({
      name,
      description: body.description.trim(),
      theme,
      owner_id: body.ownerId ?? "",
      status: "generating",
    } as CreateSceneInput);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const send = (event: SceneGenerateEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      // 2) LLM 规划
      // 首个 stage 事件即下发 sceneId，前端据此在生成完成后加载记录、保存/发布。
      send({ type: "stage", stage: "planning", message: "AI 正在规划场景蓝图…", sceneId: scene.id });
      let plan: { blueprint: SceneBlueprint; npcRecommendations: NpcRecommendation[] };
      try {
        plan = await planScene(
          { description: body.description.trim(), theme: body.theme, gameplay: body.gameplay },
          chat,
        );
      } catch {
        plan = { blueprint: fallbackBlueprint(body.description.trim()), npcRecommendations: [] };
      }
      let blueprint = plan.blueprint;

      // 3) terrain 阶段
      send({ type: "stage", stage: "terrain", message: `地形主题：${blueprint.terrain.theme}` });

      // 4) scatter 阶段
      send({ type: "stage", stage: "scatter", message: `撒点 ${blueprint.scatter.length} 类地表物` });

      // 5) structures 阶段：解析资产
      send({ type: "stage", stage: "structures", message: `处理 ${blueprint.structures.length} 个结构…` });
      for (const structure of blueprint.structures) {
        send({ type: "asset", structureId: structure.id, status: "queued" });
        const lib = resolveLibraryAsset(structure.kind);
        if (lib) {
          structure.assetUrl = lib.path;
          structure.source = "library";
          send({ type: "asset", structureId: structure.id, status: "ready", url: lib.path });
        } else {
          send({ type: "asset", structureId: structure.id, status: "generating" });
          try {
            const result = await buildSceneStructureAsset({
              prompt: structure.label,
              kind: structure.kind,
              sceneId: scene.id,
              onProgress: (msg) => send({ type: "progress", percent: 50, message: msg }),
            });
            structure.assetUrl = result.url;
            structure.source = result.source;
            if (result.tripoTaskId) structure.tripoTaskId = result.tripoTaskId;
            // 记录到 scene_assets 表
            addAsset({
              scene_id: scene.id,
              type: "structure",
              source: result.source,
              url: result.url,
              tripo_task_id: result.tripoTaskId,
              meta: JSON.stringify({ structureId: structure.id, kind: structure.kind }),
            });
            send({ type: "asset", structureId: structure.id, status: "ready", url: result.url, tripoTaskId: result.tripoTaskId });
          } catch (err) {
            app.log.warn({ err, structure: structure.kind }, "buildSceneStructureAsset failed");
            send({ type: "asset", structureId: structure.id, status: "failed" });
          }
        }
      }

      // 6) npcs 阶段：若蓝图无 NPC，用推荐补齐
      send({ type: "stage", stage: "npcs", message: `配置 ${blueprint.npcs.length} 个 NPC…` });
      if (blueprint.npcs.length === 0 && plan.npcRecommendations.length > 0) {
        const half = blueprint.terrain.size / 2;
        plan.npcRecommendations.slice(0, 3).forEach((rec, i) => {
          const angle = (Math.PI * 2 * i) / Math.max(1, plan.npcRecommendations.length);
          blueprint.npcs.push({
            id: randomUUID(),
            characterId: rec.characterId,
            label: rec.label,
            position: [Math.cos(angle) * half * 0.4, 0, Math.sin(angle) * half * 0.4],
            rotation: [0, -angle + Math.PI / 2, 0],
            role: rec.role,
            defaultPrompt: rec.defaultPrompt,
          });
        });
      }

      // 7) 持久化蓝图 + status=ready
      updateScene(scene.id, { blueprint, status: "ready" });
      send({ type: "blueprint", blueprint });
      send({ type: "stage", stage: "done", message: "场景生成完成", sceneId: scene.id });
    } catch (err) {
      app.log.error({ err }, "scene generate failed");
      updateScene(scene.id, { status: "draft" });
      send({ type: "error", message: "场景生成失败，请重试。" });
    }
    res.end();
  });

  // ----- GET /api/scenes/list — 场景列表（摘要） -----
  app.get("/api/scenes/list", async (req) => {
    const query = req.query as { ownerId?: string };
    const scenes = listScenes(query.ownerId ? { ownerId: query.ownerId } : undefined);
    return scenes.map(toSummary);
  });

  // ----- GET /api/scenes/:id — 完整场景（含解析后的 blueprint 对象） -----
  app.get("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    return { ...scene, blueprint: parseBlueprint(scene) };
  });

  // ----- PUT /api/scenes/:id — 更新（完整替换或增量操作） -----
  app.put("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    const body = (req.body ?? {}) as UpdateSceneRequest;

    const patch: Parameters<typeof updateScene>[1] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;

    let blueprint = parseBlueprint(scene);

    if (body.blueprint) {
      // 完整蓝图替换
      blueprint = body.blueprint;
    } else {
      // 增量操作
      if (body.addNpc) {
        const npc: SceneNpc = {
          id: randomUUID(),
          characterId: body.addNpc.characterId,
          label: body.addNpc.label,
          position: body.addNpc.position,
          rotation: body.addNpc.rotation ?? [0, Math.PI, 0],
          role: body.addNpc.role ?? "spectator",
          defaultPrompt: body.addNpc.defaultPrompt ?? "",
          ...(body.addNpc.skillId ? { skillId: body.addNpc.skillId } : {}),
        };
        blueprint.npcs.push(npc);
      }
      if (body.removeNpcId) {
        blueprint.npcs = blueprint.npcs.filter((n) => n.id !== body.removeNpcId);
      }
      if (body.moveNpc) {
        const npc = blueprint.npcs.find((n) => n.id === body.moveNpc!.id);
        if (npc) {
          npc.position = body.moveNpc.position;
          if (body.moveNpc.rotation) npc.rotation = body.moveNpc.rotation;
        }
      }
      if (body.addStructure) {
        const struct: SceneStructure = {
          id: randomUUID(),
          kind: body.addStructure.kind,
          label: body.addStructure.label,
          position: body.addStructure.position,
          rotation: body.addStructure.rotation ?? [0, 0, 0],
          scale: body.addStructure.scale ?? [1, 1, 1],
          assetUrl: body.addStructure.assetUrl ?? "",
          source: body.addStructure.source ?? "parametric",
        };
        blueprint.structures.push(struct);
      }
      if (body.removeStructureId) {
        blueprint.structures = blueprint.structures.filter((s) => s.id !== body.removeStructureId);
      }
      if (body.moveStructure) {
        const struct = blueprint.structures.find((s) => s.id === body.moveStructure!.id);
        if (struct) {
          struct.position = body.moveStructure.position;
          if (body.moveStructure.rotation) struct.rotation = body.moveStructure.rotation;
          if (body.moveStructure.scale) struct.scale = body.moveStructure.scale;
        }
      }
    }

    patch.blueprint = blueprint;
    const updated = updateScene(id, patch);
    return { ...updated, blueprint: parseBlueprint(updated!) };
  });

  // ----- POST /api/scenes/:id/npc — 添加 NPC -----
  app.post("/api/scenes/:id/npc", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    const body = (req.body ?? {}) as {
      characterId: string; label: string; position: [number, number, number];
      rotation?: [number, number, number]; role?: string; defaultPrompt?: string; skillId?: string;
    };
    if (!body.characterId || !body.label) {
      return reply.code(400).send({ message: "characterId, label 为必填" });
    }
    const blueprint = parseBlueprint(scene);
    const npc: SceneNpc = {
      id: randomUUID(),
      characterId: body.characterId,
      label: body.label,
      position: body.position,
      rotation: body.rotation ?? [0, Math.PI, 0],
      role: body.role ?? "spectator",
      defaultPrompt: body.defaultPrompt ?? "",
      ...(body.skillId ? { skillId: body.skillId } : {}),
    };
    blueprint.npcs.push(npc);
    const updated = updateScene(id, { blueprint });
    return { ...updated, blueprint: parseBlueprint(updated!), npc };
  });

  // ----- POST /api/scenes/:id/publish — 发布 -----
  app.post("/api/scenes/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    const updated = updateScene(id, { status: "published" });
    return updated;
  });

  // ----- DELETE /api/scenes/:id — 删除场景及资产 -----
  app.delete("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    deleteAssetsByScene(id);
    deleteScene(id);
    return { ok: true };
  });

  // ----- GET /api/scenes/:id/play — 运行时播放载荷 -----
  app.get("/api/scenes/:id/play", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = getScene(id);
    if (!scene) return reply.code(404).send({ message: "场景不存在" });
    if (scene.status !== "ready" && scene.status !== "published") {
      return reply.code(409).send({ message: `场景尚未就绪（当前状态：${scene.status}）` });
    }

    const blueprint = parseBlueprint(scene);

    // 解析 NPC 资源
    const npcResources: ScenePlayPayload["npcResources"] = {};
    for (const npc of blueprint.npcs) {
      if (npcResources[npc.characterId]) continue;
      if (npc.characterId.startsWith("custom-")) {
        const custom = getCustomCharacter(npc.characterId);
        if (custom) {
          npcResources[npc.characterId] = {
            name: custom.name,
            modelUrl: custom.modelPath || "",
            voice: custom.voice || "",
            portrait: custom.portraitPath || "",
          };
        }
      } else {
        const celeb = CELEBRITIES.find((c) => c.id === npc.characterId);
        if (celeb) {
          npcResources[npc.characterId] = {
            name: celeb.name,
            modelUrl: celeb.model ?? "",
            voice: celeb.voice ?? "",
            portrait: celeb.portrait ?? "",
          };
        }
      }
    }

    // 解析结构资产 URL
    const assetUrls: ScenePlayPayload["assetUrls"] = {};
    const dbAssets = getAssetsByScene(id);
    for (const structure of blueprint.structures) {
      if (structure.assetUrl) {
        assetUrls[structure.id] = structure.assetUrl;
        continue;
      }
      // 从 scene_assets 表查
      const metaMatch = dbAssets.find((a) => {
        try {
          const meta = JSON.parse(a.meta) as { structureId?: string };
          return meta.structureId === structure.id;
        } catch { return false; }
      });
      if (metaMatch) {
        assetUrls[structure.id] = metaMatch.url;
        continue;
      }
      // 内置库
      const lib = resolveLibraryAsset(structure.kind);
      if (lib) assetUrls[structure.id] = lib.path;
    }

    incrementPlayCount(id);

    const payload: ScenePlayPayload = {
      scene: { id: scene.id, name: scene.name, description: scene.description, theme: scene.theme },
      blueprint,
      npcResources,
      assetUrls,
    };
    return payload;
  });
}
