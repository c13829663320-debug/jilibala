// ===== Round4 R4-09: 场景模板市场 =====
// 内置 6+ 场景模板：纯数据注册表 + GET /api/scene-templates。
// 每个模板含名称/描述/缩略图(emoji)/占位色/场景参数(光照/雾/地面/物体列表)。
import type { FastifyInstance } from "fastify";
import type { SceneTemplate } from "@balabala/shared";

/** 内置场景模板注册表（顺序即卡片网格顺序）。 */
export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: "starlight-court",
    name: "星空法庭",
    description: "穹顶洒满银河与星轨，深色审判席在微光下庄严开庭。",
    thumbnail: "⚖️",
    color: "#4fb3a5",
    category: "法庭",
    params: {
      lightPreset: "night",
      fogColor: "#0b1026",
      fogNear: 18,
      fogFar: 70,
      groundColor: "#141a2e",
      ambientColor: "#223055",
      size: 60,
      music: "court-ambient",
      objects: [
        { kind: "bench", position: [0, 0, -6] },
        { kind: "statue", position: [-8, 0, -4] },
        { kind: "statue", position: [8, 0, -4] },
      ],
    },
  },
  {
    id: "cyber-bar",
    name: "赛博酒吧",
    description: "霓虹灯牌与酸橙气泡，雨夜霓虹下的微醺酒吧。",
    thumbnail: "🍸",
    color: "#FFD600",
    category: "酒吧",
    params: {
      lightPreset: "night",
      fogColor: "#1a0f2e",
      fogNear: 12,
      fogFar: 55,
      groundColor: "#1c1424",
      ambientColor: "#3a1f55",
      size: 50,
      music: "bar-lofi",
      objects: [
        { kind: "table", position: [0, 0, 2] },
        { kind: "table", position: [-4, 0, 2] },
        { kind: "table", position: [4, 0, 2] },
        { kind: "lamp", position: [0, 0, -3] },
      ],
    },
  },
  {
    id: "ancient-study",
    name: "古风书院",
    description: "木格窗透进晨光，竹简与墨香萦绕的东方书院。",
    thumbnail: "📜",
    color: "#4fb3a5",
    category: "书院",
    params: {
      lightPreset: "day",
      fogColor: "#e8e0cc",
      fogNear: 25,
      fogFar: 90,
      groundColor: "#6b5a3e",
      ambientColor: "#d8cba8",
      size: 55,
      music: "guzheng",
      objects: [
        { kind: "bookshelf", position: [-5, 0, -5] },
        { kind: "bookshelf", position: [5, 0, -5] },
        { kind: "table", position: [0, 0, 0] },
        { kind: "plant", position: [6, 0, 4] },
      ],
    },
  },
  {
    id: "future-gym",
    name: "未来健身房",
    description: "镜面墙与发光器械，科技感拉满的零重力训练馆。",
    thumbnail: "🏋️",
    color: "#FFD600",
    category: "健身",
    params: {
      lightPreset: "day",
      fogColor: "#0e1420",
      fogNear: 20,
      fogFar: 80,
      groundColor: "#10161f",
      ambientColor: "#1f3a55",
      size: 60,
      music: "workout-beat",
      objects: [
        { kind: "dumbbell", position: [-3, 0, 0] },
        { kind: "dumbbell", position: [3, 0, 0] },
        { kind: "bench", position: [0, 0, 4] },
      ],
    },
  },
  {
    id: "fairy-plaza",
    name: "童话广场",
    description: "糖果色喷泉与旋转木马般的圆广场，适合合影与闲逛。",
    thumbnail: "⛲",
    color: "#4fb3a5",
    category: "广场",
    params: {
      lightPreset: "sunset",
      fogColor: "#f7d9c4",
      fogNear: 30,
      fogFar: 110,
      groundColor: "#e8c9a8",
      ambientColor: "#ffd9a0",
      size: 65,
      music: "fairy-waltz",
      objects: [
        { kind: "fountain", position: [0, 0, 0] },
        { kind: "bench", position: [-6, 0, 4] },
        { kind: "bench", position: [6, 0, 4] },
        { kind: "plant", position: [-8, 0, -3] },
        { kind: "plant", position: [8, 0, -3] },
      ],
    },
  },
  {
    id: "deepsea-library",
    name: "深海图书馆",
    description: "幽蓝海水环绕书架，鱼群游过头顶的静谧阅读馆。",
    thumbnail: "📚",
    color: "#4fb3a5",
    category: "图书馆",
    params: {
      lightPreset: "night",
      fogColor: "#06283d",
      fogNear: 15,
      fogFar: 65,
      groundColor: "#0a2a3d",
      ambientColor: "#0e4a66",
      size: 55,
      music: "underwater-drone",
      objects: [
        { kind: "bookshelf", position: [-4, 0, -4] },
        { kind: "bookshelf", position: [4, 0, -4] },
        { kind: "bookshelf", position: [-4, 0, 4] },
        { kind: "bookshelf", position: [4, 0, 4] },
        { kind: "table", position: [0, 0, 0] },
        { kind: "book", position: [0.3, 0.8, 0] },
      ],
    },
  },
];

/** 按 id 取模板（未找到返回 undefined）。 */
export function getTemplateById(id: string): SceneTemplate | undefined {
  return SCENE_TEMPLATES.find((t) => t.id === id);
}

/** 模板参数完整性校验：必填字段齐全、物体位置为三元组。 */
export function isTemplateValid(t: SceneTemplate): boolean {
  if (!t.id || !t.name || !t.description) return false;
  if (!t.thumbnail || !t.color) return false;
  const p = t.params;
  if (!p) return false;
  if (typeof p.lightPreset !== "string" || !p.lightPreset) return false;
  if (typeof p.fogColor !== "string" || !p.fogColor) return false;
  if (typeof p.fogNear !== "number" || typeof p.fogFar !== "number") return false;
  if (p.fogNear < 0 || p.fogFar <= p.fogNear) return false;
  if (typeof p.groundColor !== "string" || !p.groundColor) return false;
  if (typeof p.size !== "number" || p.size <= 0) return false;
  if (!Array.isArray(p.objects)) return false;
  for (const o of p.objects) {
    if (!o.kind) return false;
    if (!Array.isArray(o.position) || o.position.length !== 3) return false;
    if (o.rotation !== undefined && (!Array.isArray(o.rotation) || o.rotation.length !== 3)) return false;
  }
  return true;
}

/** 注册 REST 路由：GET /api/scene-templates。 */
export function registerSceneTemplateRoutes(app: FastifyInstance): void {
  app.get("/api/scene-templates", async () => {
    return { templates: SCENE_TEMPLATES };
  });

  app.get("/api/scene-templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getTemplateById(id);
    if (!t) return reply.code(404).send({ message: "模板不存在" });
    return t;
  });
}
