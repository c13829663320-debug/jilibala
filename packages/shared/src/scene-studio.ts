// ===== 自定义场景工作室 · 共享类型 =====
// 蓝图与运行时解耦：SceneBlueprint 是结构化 JSON，运行时按蓝图渲染。
// 前后端共用，确保数据驱动。

/** 场景状态 */
export type SceneStatus = 'draft' | 'generating' | 'ready' | 'published';

/** 地形主题 */
export type TerrainTheme = 'forest' | 'desert' | 'snow' | 'beach' | 'mountain' | 'plains' | 'cave' | 'city';

/** 天气 */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';

/** 光照预设 */
export type LightPreset = 'day' | 'sunset' | 'night' | 'dawn';

/** 地表物种类（InstancedMesh 撒点） */
export type ScatterKind = 'tree' | 'rock' | 'grass' | 'flower' | 'bush' | 'cactus' | 'mushroom' | 'crystal';

/** 玩法模板 */
export type GameplayTemplate = 'explore' | 'collect' | 'reach' | 'quest';

/** 地形配置 */
export interface SceneTerrain {
  theme: TerrainTheme;
  /** 边长（米），默认 60 */
  size: number;
  /** 高度图种子，决定地形起伏 */
  heightSeed: number;
  /** 水面高度（y），-1 表示无水 */
  waterLevel: number;
  weather: WeatherKind;
  light: LightPreset;
  /** 额外参数（粗糙度、振幅等），运行时可扩展 */
  params: Record<string, number>;
}

/** 地表物撒点配置 */
export interface SceneScatter {
  kind: ScatterKind;
  /** 变体编号，用于同种类不同外观 */
  variant: number;
  /** 实例数量 */
  count: number;
  /** 分布区域：[[xMin,zMin,xMax,zMax], ...]，空数组表示全图 */
  zones: Array<[number, number, number, number]>;
}

/** 结构/道具（放置物） */
export interface SceneStructure {
  id: string;
  kind: string;
  label: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** 模型 URL（相对 /models/ 或绝对），空表示参数化生成 */
  assetUrl: string;
  source: 'library' | 'tripo' | 'parametric';
  tripoTaskId?: string;
}

/** NPC 配置 */
export interface SceneNpc {
  id: string;
  /** 人物 ID：名人 id 或 custom-xxx */
  characterId: string;
  label: string;
  position: [number, number, number];
  rotation: [number, number, number];
  /** 角色定位：guide / merchant / questgiver / enemy / companion / spectator */
  role: string;
  /** 关联 skill id，可选 */
  skillId?: string;
  /** 默认对话开场白 / system prompt 补充 */
  defaultPrompt: string;
}

/** 玩法配置 */
export interface SceneGameplay {
  template: GameplayTemplate;
  config: {
    /** collect: 需收集的物品 id 列表 */
    collectTargets?: string[];
    /** reach: 目标点坐标 */
    goalPosition?: [number, number, number];
    /** quest: 任务步骤 */
    questSteps?: Array<{ id: string; text: string; npcId?: string; itemId?: string }>;
    /** 通用：目标描述 */
    objective?: string;
    [key: string]: unknown;
  };
}

/** 场景蓝图——运行时渲染的唯一数据源 */
export interface SceneBlueprint {
  terrain: SceneTerrain;
  scatter: SceneScatter[];
  structures: SceneStructure[];
  npcs: SceneNpc[];
  gameplay: SceneGameplay;
  /** 玩家出生点 */
  spawnPoint: [number, number, number];
  /** 场景边界 [minX,minZ,maxX,maxZ] */
  bounds: [number, number, number, number];
  /** 蓝图版本，便于未来迁移 */
  version: number;
}

/** 场景记录（DB 行） */
export interface SceneRecord {
  id: string;
  name: string;
  description: string;
  theme: TerrainTheme;
  status: SceneStatus;
  blueprint_json: string;
  cover: string;
  play_count: number;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

/** 场景资产记录 */
export interface SceneAssetRecord {
  id: string;
  scene_id: string;
  type: 'structure' | 'terrain' | 'npc' | 'cover';
  source: 'library' | 'tripo' | 'parametric';
  url: string;
  tripo_task_id: string;
  meta: string;
  created_at: string;
}

/** 生成进度 SSE 事件 */
export type SceneGenerateEvent =
  | { type: 'stage'; stage: 'planning' | 'terrain' | 'scatter' | 'structures' | 'npcs' | 'done'; message?: string; /** 场景记录 id，首个 stage 事件即下发，供前端持久化/保存/发布 */ sceneId?: string }
  | { type: 'progress'; percent: number; message: string }
  | { type: 'blueprint'; blueprint: SceneBlueprint }
  | { type: 'asset'; structureId: string; status: 'queued' | 'generating' | 'ready' | 'failed'; url?: string; tripoTaskId?: string }
  | { type: 'error'; message: string };

/** 运行时播放载荷（GET /:id/play 返回） */
export interface ScenePlayPayload {
  scene: { id: string; name: string; description: string; theme: TerrainTheme };
  blueprint: SceneBlueprint;
  /** NPC 人物资源：characterId -> { name, modelUrl, voice, portrait } */
  npcResources: Record<string, { name: string; modelUrl: string; voice: string; portrait: string }>;
  /** 结构资产 URL 映射：structureId -> 可直接加载的 URL */
  assetUrls: Record<string, string>;
}

/** 创建场景请求 */
export interface CreateSceneRequest {
  name?: string;
  description: string;
  theme?: TerrainTheme;
  gameplay?: GameplayTemplate;
  ownerId?: string;
}

/** 更新场景请求（增删挪 NPC/结构） */
export interface UpdateSceneRequest {
  name?: string;
  description?: string;
  /** 完整蓝图替换（编辑后保存） */
  blueprint?: SceneBlueprint;
  /** 增量操作：添加 NPC */
  addNpc?: Omit<SceneNpc, 'id'>;
  /** 增量操作：删除 NPC */
  removeNpcId?: string;
  /** 增量操作：移动 NPC */
  moveNpc?: { id: string; position: [number, number, number]; rotation?: [number, number, number] };
  /** 增量操作：添加结构 */
  addStructure?: Omit<SceneStructure, 'id'>;
  /** 增量操作：删除结构 */
  removeStructureId?: string;
  /** 增量操作：移动结构 */
  moveStructure?: { id: string; position: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] };
}

/** 资产库条目（内置可用模型映射） */
export interface SceneAssetLibraryItem {
  kind: string;
  label: string;
  /** 相对 /models/ 的路径 */
  path: string;
  /** 建议缩放 */
  defaultScale: [number, number, number];
  /** 是否适合作为地标/大结构 */
  landmark: boolean;
}
