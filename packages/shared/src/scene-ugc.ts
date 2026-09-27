// ===== Round4 R4-09: 场景 UGC 增强 — 共享类型 =====
// 场景模板市场 / 场景保存分享 / CC0 道具库 / 可拾取交互。
// 前后端共用；道具几何为纯数据（three.js 基础形状组合），不依赖外部 GLB。

// ---------------------------------------------------------------------------
// 1. 场景模板市场
// ---------------------------------------------------------------------------

/** 模板预置物体（kind 对应道具/结构 id，位置为世界坐标） */
export interface SceneTemplateObject {
  kind: string;
  position: [number, number, number];
  rotation?: [number, number, number];
}

/** 模板场景参数：光照 / 雾 / 地面颜色 / 物体列表 */
export interface SceneTemplateParams {
  /** 光照预设 day/sunset/night/dawn */
  lightPreset: string;
  /** 雾颜色 */
  fogColor: string;
  /** 雾起止距离 */
  fogNear: number;
  fogFar: number;
  /** 地面颜色 */
  groundColor: string;
  /** 环境光颜色（可选） */
  ambientColor?: string;
  /** 场景尺寸（米），默认 60 */
  size: number;
  /** 模板预置物体 */
  objects: SceneTemplateObject[];
  /** 背景音乐标识（可选） */
  music?: string;
}

/** 一个内置场景模板 */
export interface SceneTemplate {
  id: string;
  /** 中文名 */
  name: string;
  description: string;
  /** emoji 缩略图占位 */
  thumbnail: string;
  /** 卡片主色占位（品牌黑底 + 明黄/青绿体系） */
  color: string;
  category: string;
  params: SceneTemplateParams;
}

// ---------------------------------------------------------------------------
// 2. 场景保存 / 分享链接（JSON 文件持久化）
// ---------------------------------------------------------------------------

/** POST /api/scenes 请求体 */
export interface SaveSceneRequest {
  userId: string;
  name: string;
  /** 场景数据（蓝图/参数，不透明 JSON） */
  sceneData: unknown;
  isPublic?: boolean;
}

/** PATCH /api/scenes/:sceneId 请求体（修改可见性） */
export interface UpdateSceneVisibilityRequest {
  /** 操作者，必须为创建者 */
  userId: string;
  isPublic: boolean;
}

/** R5: UGC 内容审核状态（additive，老场景缺省视为已通过）。 */
export type SceneModerationStatus = "approved" | "pending_review";

/** 一条已保存场景（含完整数据） */
export interface SavedScene {
  sceneId: string;
  userId: string;
  name: string;
  sceneData: unknown;
  isPublic: boolean;
  /** 分享链接 /studio?scene=<sceneId> */
  shareLink: string;
  createdAt: string;
  updatedAt: string;
  /** R5: 内容审核状态。命中敏感词时置 pending_review 且不公开。 */
  moderationStatus?: SceneModerationStatus;
}

/** 列表项：剔除较大的 sceneData */
export type SavedSceneMeta = Omit<SavedScene, "sceneData">;

// ---------------------------------------------------------------------------
// 3. CC0 道具库 + 可拾取交互
// ---------------------------------------------------------------------------

/** 道具分类：家具 / 装饰 / 互动 */
export type PropCategory = "furniture" | "decor" | "interactive";

/** 程序化几何体部件（three.js 基础形状组合，无外部 GLB） */
export interface PropGeometryPart {
  /** three.js 基础几何体类型 */
  shape: "box" | "cylinder" | "cone" | "sphere" | "torus" | "plane";
  /** 几何体 args（与 three 构造参数顺序一致） */
  args: number[];
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
}

/** CC0 道具定义（纯数据） */
export interface PropDefinition {
  id: string;
  name: string;
  category: PropCategory;
  /** 主色（卡片/占位） */
  color: string;
  /** 整体包围尺寸 [宽, 高, 深]（米） */
  size: [number, number, number];
  /** 是否可被玩家拾取 */
  pickable: boolean;
  /** 交互动作描述（坐下/阅读/举重 等） */
  interactAction: string;
  /** 卡片 emoji */
  emoji: string;
  /** 程序化几何体部件列表 */
  parts: PropGeometryPart[];
}

/** 拾取状态机阶段 */
export type PickupPhase = "idle" | "nearby" | "holding";

/** 拾取交互运行时状态（纯逻辑，可单测） */
export interface PickupState {
  phase: PickupPhase;
  /** 玩家附近（可拾取、距离 < pickRange）的道具 id */
  nearPropId: string | null;
  /** 当前手持的道具 id */
  heldPropId: string | null;
}

/** 场景中一个已放置道具（随场景保存/加载） */
export interface PlacedProp {
  /** 实例 id（每次放置生成） */
  instanceId: string;
  /** 对应 PropDefinition.id */
  propId: string;
  position: [number, number, number];
  rotation: [number, number, number];
}
