// ===== Round5 R5-UGC: 一句话造场景 / 发布分享闭环 — 共享类型 =====
// 前后端共用。本文件为 additive：不修改 scene-studio.ts / scene-ugc.ts 的既有定义。
// 设计目标：从“能创建”到“能发布分享、他人能进入”，以及照片→头像化身的零门槛入口。
// AI 解析为纯函数关键词匹配 + 模板兜底，不依赖外部 AI API。

// ---------------------------------------------------------------------------
// 1. 一句话造场景：自然语言 → 结构化场景草稿
// ---------------------------------------------------------------------------

/** 玩法类型（一句话解析结果）。 */
export type UGCGameType =
  | "explore"   // 自由探索
  | "debate"    // 名人辩论
  | "collect"   // 收集道具
  | "quiz"      // 问答挑战
  | "reach";    // 竞速到达

/** 草稿中的一个道具（参数化占位，不接真实 GLB）。 */
export interface UGCPropDraft {
  /** 基础形状：box / cylinder / cone / sphere / torus / plane */
  kind: string;
  /** 道具名（用户可读） */
  label: string;
  /** 主色（占位渲染） */
  color?: string;
  /** 世界坐标占位 */
  position?: [number, number, number];
  /** 整体缩放倍数 */
  scale?: number;
}

/**
 * 一句话解析后的结构化场景草稿。
 * 由前端 promptParser 纯函数产出，预览→发布都以它为数据源。
 */
export interface SceneDraft {
  /** 场景标题（可由解析器从描述中提炼） */
  title: string;
  /** 用户原始一句话描述 */
  rawPrompt: string;
  /** 主题标识（如 cyberpunk-teahouse / ancient-study），便于匹配模板 */
  theme: string;
  /** 风格关键词（中文，如“赛博朋克”“古风水墨”） */
  style: string;
  /** 参与名人 id 列表（来自 CELEBRITIES） */
  celebrityIds: string[];
  gameType: UGCGameType;
  /** 预置道具列表 */
  props: UGCPropDraft[];
  /** 光照预设 day/sunset/night/dawn（可空，由兜底决定） */
  lightPreset?: string;
  /** 解析备注（命中了哪些关键词 / 是否走了兜底），仅供 UI 展示 */
  notes?: string;
}

// ---------------------------------------------------------------------------
// 2. 发布状态机 + 分享链接
// ---------------------------------------------------------------------------

/** 发布流程状态机阶段。 */
export type ScenePublishStatus = "draft" | "previewing" | "published" | "failed";

/** 一条可分享链接。 */
export interface SceneShareLink {
  sceneId: string;
  /** 形如 /studio?scene=ugc_<uuid> */
  url: string;
  status: ScenePublishStatus;
  createdAt: string;
}

/** 统一 UGC 错误（可判定是否可重试）。 */
export interface UGCError {
  /** 机器可读错误码：bad_prompt / invalid_draft / network / not_found / forbidden / server 等 */
  code: string;
  /** 面向用户的中文消息 */
  message: string;
  /** 是否可重试（网络抖动=true；校验失败=false） */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// 3. 服务端持久化记录（additive REST 契约）
// ---------------------------------------------------------------------------

/** POST /api/ugc/scenes 请求体。 */
export interface UgcPublishRequest {
  userId: string;
  name: string;
  draft: SceneDraft;
  /** 是否公开（默认 true，发布后他人可经分享链接进入） */
  isPublic?: boolean;
}

/** 我的作品列表项（剔除较大的 draft 内 props 细节可选）。 */
export type UgcSceneMeta = Pick<
  UgcSceneRecord,
  "sceneId" | "userId" | "name" | "status" | "isPublic" | "playCount" | "createdAt" | "updatedAt" | "theme" | "style"
>;

/** 服务端一条 UGC 场景记录（JSON 文件持久化）。 */
export interface UgcSceneRecord {
  sceneId: string;
  userId: string;
  name: string;
  draft: SceneDraft;
  status: ScenePublishStatus;
  isPublic: boolean;
  /** 分享链接 /studio?scene=<sceneId> */
  shareLink: string;
  playCount: number;
  createdAt: string;
  updatedAt: string;
  /** status=failed 时的错误信息 */
  error?: string;
  /** 主题/风格冗余到顶层，便于列表卡片展示 */
  theme: string;
  style: string;
}

/** GET /api/ugc/templates 返回：官方模板 + 热门用户作品。 */
export interface UgcTemplateBundle {
  /** 官方模板（复用 R4 SceneTemplate 结构） */
  official: import("./scene-ugc.js").SceneTemplate[];
  /** 热门用户作品（公开已发布，按 playCount 排序） */
  hot: UgcSceneMeta[];
}

// ---------------------------------------------------------------------------
// 4. 照片→头像化身（前端 Canvas 处理，不做真实 3D 重建）
// ---------------------------------------------------------------------------

/** 照片产出的“头像化身”配置：正面照片贴图 + 程序化身体。 */
export interface PhotoAvatarConfig {
  /** 与既有 avatarType='photo' 兼容 */
  avatarType: "photo";
  /** 正面照片贴图（dataURL，由 Canvas 产出） */
  textureUrl: string;
  /** 程序化身体主色 */
  bodyColor: string;
  /** 身体体型：procedural 占位 */
  bodyShape: "procedural";
  /** 头像展示名 */
  label: string;
}
