// ===== 自定义场景工作室 · LLM 蓝图规划器 =====
// 自然语言描述 -> SceneBlueprint + NPC 推荐。
// ChatFn 由 server.ts 的 chatWithProviders 注入（双 provider 兜底）。
import { randomUUID } from "node:crypto";
import {
  CELEBRITIES,
  type TerrainTheme,
  type WeatherKind,
  type LightPreset,
  type ScatterKind,
  type GameplayTemplate,
  type SceneBlueprint,
  type SceneTerrain,
  type SceneScatter,
  type SceneStructure,
  type SceneNpc,
  type SceneGameplay,
} from "@balabala/shared";
import type { ChatFn } from "../bench-orchestrator.js";

export type { ChatFn };

// ===== extractJson（与 server.ts / bench-orchestrator 同模式）=====
export function extractJson(text: string): unknown {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

// ===== 类型安全的强制转换辅助 =====
function asNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v != null ? String(v) : fallback;
}

function asVec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(v) && v.length >= 3) {
    const [x, y, z] = v.map((n) => asNum(n, 0));
    return [x, y, z];
  }
  return [...fallback] as [number, number, number];
}

const VALID_THEMES: TerrainTheme[] = ["forest", "desert", "snow", "beach", "mountain", "plains", "cave", "city"];
function asTheme(v: unknown, fallback: TerrainTheme = "forest"): TerrainTheme {
  const s = asStr(v);
  return (VALID_THEMES as string[]).includes(s) ? (s as TerrainTheme) : fallback;
}

const VALID_WEATHER: WeatherKind[] = ["clear", "cloudy", "rain", "snow", "fog"];
function asWeather(v: unknown): WeatherKind {
  const s = asStr(v);
  return (VALID_WEATHER as string[]).includes(s) ? (s as WeatherKind) : "clear";
}

const VALID_LIGHT: LightPreset[] = ["day", "sunset", "night", "dawn"];
function asLight(v: unknown): LightPreset {
  const s = asStr(v);
  return (VALID_LIGHT as string[]).includes(s) ? (s as LightPreset) : "day";
}

const VALID_SCATTER: ScatterKind[] = ["tree", "rock", "grass", "flower", "bush", "cactus", "mushroom", "crystal"];
function asScatterKind(v: unknown): ScatterKind | null {
  const s = asStr(v);
  return (VALID_SCATTER as string[]).includes(s) ? (s as ScatterKind) : null;
}

const VALID_GAMEPLAY: GameplayTemplate[] = ["explore", "collect", "reach", "quest"];
function asGameplayTemplate(v: unknown): GameplayTemplate {
  const s = asStr(v);
  return (VALID_GAMEPLAY as string[]).includes(s) ? (s as GameplayTemplate) : "explore";
}

function asParams(v: unknown): Record<string, number> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = asNum(val, NaN);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  }
  return {};
}

function asZones(v: unknown): Array<[number, number, number, number]> {
  if (!Array.isArray(v)) return [];
  const out: Array<[number, number, number, number]> = [];
  for (const z of v) {
    if (Array.isArray(z) && z.length >= 4) {
      out.push([asNum(z[0], 0), asNum(z[1], 0), asNum(z[2], 0), asNum(z[3], 0)]);
    }
  }
  return out;
}

// ===== parseAndValidateBlueprint：纯函数，便于单测 =====
/**
 * 把 LLM 返回的任意 JSON 校验/补全为合法 SceneBlueprint。
 * 缺失字段用合理默认值填充，不抛错。
 */
export function parseAndValidateBlueprint(raw: unknown): SceneBlueprint {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // --- terrain ---
  const terrainRaw = (obj.terrain && typeof obj.terrain === "object" ? obj.terrain : {}) as Record<string, unknown>;
  const size = Math.max(20, asNum(terrainRaw.size, 60));
  const terrain: SceneTerrain = {
    theme: asTheme(terrainRaw.theme),
    size,
    heightSeed: asNum(terrainRaw.heightSeed, Math.floor(Math.random() * 1_000_000)),
    waterLevel: asNum(terrainRaw.waterLevel, -1),
    weather: asWeather(terrainRaw.weather),
    light: asLight(terrainRaw.light),
    params: asParams(terrainRaw.params),
  };

  // --- scatter ---
  const scatter: SceneScatter[] = [];
  if (Array.isArray(obj.scatter)) {
    for (const s of obj.scatter) {
      const sObj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const kind = asScatterKind(sObj.kind);
      if (!kind) continue;
      scatter.push({
        kind,
        variant: asNum(sObj.variant, 0),
        count: Math.max(0, asNum(sObj.count, 5)),
        zones: asZones(sObj.zones),
      });
    }
  }

  // --- structures ---
  const structures: SceneStructure[] = [];
  if (Array.isArray(obj.structures)) {
    for (const s of obj.structures) {
      const sObj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const kind = asStr(sObj.kind, "");
      if (!kind) continue;
      structures.push({
        id: randomUUID(),
        kind,
        label: asStr(sObj.label, kind),
        position: asVec3(sObj.position, [0, 0, 0]),
        rotation: asVec3(sObj.rotation, [0, 0, 0]),
        scale: asVec3(sObj.scale, [1, 1, 1]),
        assetUrl: asStr(sObj.assetUrl, ""),
        source: sObj.source === "tripo" || sObj.source === "parametric" ? sObj.source : "parametric",
        ...(sObj.tripoTaskId ? { tripoTaskId: asStr(sObj.tripoTaskId) } : {}),
      });
    }
  }

  // --- npcs ---
  const npcs: SceneNpc[] = [];
  if (Array.isArray(obj.npcs)) {
    for (const n of obj.npcs) {
      const nObj = (n && typeof n === "object" ? n : {}) as Record<string, unknown>;
      const characterId = asStr(nObj.characterId, "");
      if (!characterId) continue;
      npcs.push({
        id: randomUUID(),
        characterId,
        label: asStr(nObj.label, characterId),
        position: asVec3(nObj.position, [0, 0, 0]),
        rotation: asVec3(nObj.rotation, [0, Math.PI, 0]),
        role: asStr(nObj.role, "spectator"),
        ...(nObj.skillId ? { skillId: asStr(nObj.skillId) } : {}),
        defaultPrompt: asStr(nObj.defaultPrompt, ""),
      });
    }
  }

  // --- gameplay ---
  const gameplayRaw = (obj.gameplay && typeof obj.gameplay === "object" ? obj.gameplay : {}) as Record<string, unknown>;
  const gameplayConfig = (gameplayRaw.config && typeof gameplayRaw.config === "object" ? gameplayRaw.config : {}) as Record<string, unknown>;
  const gameplay: SceneGameplay = {
    template: asGameplayTemplate(gameplayRaw.template),
    config: {
      objective: asStr(gameplayConfig.objective, ""),
      ...(Array.isArray(gameplayConfig.collectTargets) ? { collectTargets: gameplayConfig.collectTargets.map(String) } : {}),
      ...(Array.isArray(gameplayConfig.goalPosition) ? { goalPosition: asVec3(gameplayConfig.goalPosition, [0, 0, 0]) } : {}),
      ...(Array.isArray(gameplayConfig.questSteps) ? { questSteps: gameplayConfig.questSteps.map((q, i) => {
        const qObj = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
        return { id: asStr(qObj.id, `step-${i + 1}`), text: asStr(qObj.text, "") };
      }) } : {}),
    },
  };

  // --- spawnPoint / bounds ---
  const half = size / 2;
  const spawnPoint = asVec3(obj.spawnPoint, [0, 0, 0]);
  const bounds = asVec4(obj.bounds, [-half, -half, half, half]);

  return {
    terrain,
    scatter,
    structures,
    npcs,
    gameplay,
    spawnPoint,
    bounds,
    version: 1,
  };
}

function asVec4(v: unknown, fallback: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(v) && v.length >= 4) {
    return [asNum(v[0], fallback[0]), asNum(v[1], fallback[1]), asNum(v[2], fallback[2]), asNum(v[3], fallback[3])];
  }
  return [...fallback] as [number, number, number, number];
}

// ===== fallbackBlueprint：LLM 全失败时的兜底 =====
/** 森林主题 + 基础 scatter + 2 个结构 + explore 玩法。 */
export function fallbackBlueprint(description: string): SceneBlueprint {
  const half = 30;
  return {
    terrain: {
      theme: "forest",
      size: 60,
      heightSeed: Math.floor(Math.random() * 1_000_000),
      waterLevel: -1,
      weather: "clear",
      light: "day",
      params: { amplitude: 1.0, roughness: 0.5 },
    },
    scatter: [
      { kind: "tree", variant: 0, count: 25, zones: [] },
      { kind: "rock", variant: 0, count: 8, zones: [] },
      { kind: "grass", variant: 0, count: 30, zones: [] },
      { kind: "flower", variant: 0, count: 12, zones: [] },
    ],
    structures: [
      {
        id: randomUUID(), kind: "tent", label: "营地帐篷",
        position: [0, 0, 5], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5],
        assetUrl: "", source: "parametric",
      },
      {
        id: randomUUID(), kind: "campfire", label: "篝火",
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
        assetUrl: "", source: "parametric",
      },
    ],
    npcs: [],
    gameplay: {
      template: "explore",
      config: { objective: description ? `自由探索：${description}` : "自由探索这片森林" },
    },
    spawnPoint: [0, 0, 8],
    bounds: [-half, -half, half, half],
    version: 1,
  };
}

// ===== NPC 推荐 =====
export interface NpcRecommendation {
  characterId: string;
  label: string;
  role: string;
  defaultPrompt: string;
}

/** 按主题从 CELEBRITIES 中选 2-3 个作为 NPC 推荐。 */
function recommendNpcsByTheme(theme: TerrainTheme, description: string): NpcRecommendation[] {
  // 简单关键词匹配：从名人标签/简介中挑与主题相关的；不足时按 field 补齐。
  const pool = CELEBRITIES;
  const themeKw: Record<TerrainTheme, string[]> = {
    forest: ["自然", "探险", "科学", "博物"],
    desert: ["商业", "冒险", "生存", "工程"],
    snow: ["科学", "极地", "探险", "坚韧"],
    beach: ["文学", "艺术", "自由", "哲学"],
    mountain: ["探险", "工程", "科学", "哲学"],
    plains: ["农业", "哲学", "历史", "文学"],
    cave: ["科学", "考古", "哲学", "艺术"],
    city: ["科技", "商业", "设计", "社会"],
  };
  const kws = themeKw[theme] ?? [];
  const scored = pool.map((c) => {
    let score = 0;
    const hay = [c.name, c.title, c.intro, ...c.tags].join(" ");
    for (const kw of kws) if (hay.includes(kw)) score += 2;
    for (const ch of description) if (hay.includes(ch)) score += 0.01;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 3).map(({ c }) => ({
    characterId: c.id,
    label: c.name,
    role: "guide" as string,
    defaultPrompt: c.greeting || c.persona.slice(0, 80),
  }));
  return picked;
}

// ===== System Prompt =====
const PLANNER_SYSTEM = `你是一个 3D 场景关卡设计师。根据用户的自然语言描述，设计一个可交互的虚拟场景蓝图。
只返回合法 JSON，不要 Markdown 代码块，不要解释。

JSON 结构如下：
{
  "terrain": {
    "theme": "forest|desert|snow|beach|mountain|plains|cave|city",
    "size": 60,
    "heightSeed": 12345,
    "waterLevel": -1,
    "weather": "clear|cloudy|rain|snow|fog",
    "light": "day|sunset|night|dawn",
    "params": { "amplitude": 1.0, "roughness": 0.5 }
  },
  "scatter": [
    { "kind": "tree|rock|grass|flower|bush|cactus|mushroom|crystal", "variant": 0, "count": 20, "zones": [] }
  ],
  "structures": [
    { "kind": "house|tent|tower|fountain|signpost|campfire|...", "label": "显示名称", "position": [x,y,z], "rotation": [0,0,0], "scale": [1,1,1] }
  ],
  "npcs": [
    { "characterId": "名人id", "label": "称呼", "role": "guide|merchant|questgiver|enemy|companion|spectator", "defaultPrompt": "开场白" }
  ],
  "gameplay": {
    "template": "explore|collect|reach|quest",
    "config": { "objective": "目标描述" }
  },
  "spawnPoint": [0, 0, 5],
  "bounds": [-30, -30, 30, 30]
}

要求：
- theme 必须是 8 选 1，与描述氛围匹配。
- scatter 撒点 3-6 类，count 合理（5-40），根据主题选合适的种类（森林多树/草/花，沙漠多仙人掌，雪地多树/岩石，洞穴多水晶/蘑菇）。
- structures 3-6 个，position 范围在 bounds 内，y 约为 0，scale 合理。
- npcs 选 2-3 个名人，characterId 必须是真实存在的名人 id。role 根据场景定位分配。
- gameplay template 选 explore 最稳妥；collect 需给 collectTargets；reach 需给 goalPosition。
- spawnPoint 放在场景中心偏边缘，bounds 为 [minX, minZ, maxX, maxZ]。`;

// ===== planScene 主入口 =====
export interface PlanSceneInput {
  description: string;
  theme?: TerrainTheme;
  gameplay?: GameplayTemplate;
}

export interface PlanSceneResult {
  blueprint: SceneBlueprint;
  npcRecommendations: NpcRecommendation[];
}

export async function planScene(input: PlanSceneInput, chat: ChatFn): Promise<PlanSceneResult> {
  const themeHint = input.theme ? `\n偏好地形主题：${input.theme}` : "";
  const gameplayHint = input.gameplay ? `\n偏好玩法模板：${input.gameplay}` : "";
  const userMsg = `请为以下描述设计场景蓝图：\n${input.description}${themeHint}${gameplayHint}`;

  let raw: unknown;
  try {
    const text = await chat(
      [
        { role: "system", content: PLANNER_SYSTEM },
        { role: "user", content: userMsg },
      ],
      2000,
    );
    raw = extractJson(text);
  } catch (err) {
    // LLM 全失败：兜底蓝图 + 按主题推荐 NPC。
    const theme = input.theme ?? "forest";
    return {
      blueprint: fallbackBlueprint(input.description),
      npcRecommendations: recommendNpcsByTheme(theme, input.description),
    };
  }

  const blueprint = parseAndValidateBlueprint(raw);

  // 若用户指定了 theme/gameplay，覆盖 LLM 结果。
  if (input.theme) blueprint.terrain.theme = input.theme;
  if (input.gameplay) blueprint.gameplay.template = input.gameplay;

  // NPC 推荐：优先用 LLM 返回的 npcs；为空则按主题补推荐。
  let npcRecommendations: NpcRecommendation[] = blueprint.npcs.map((n) => ({
    characterId: n.characterId,
    label: n.label,
    role: n.role,
    defaultPrompt: n.defaultPrompt,
  }));
  if (npcRecommendations.length === 0) {
    npcRecommendations = recommendNpcsByTheme(blueprint.terrain.theme, input.description);
  }

  return { blueprint, npcRecommendations };
}
