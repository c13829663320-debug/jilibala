// ============================================================================
// R5: 性能 / 稳定性域（r5-perf）
// 以下类型全部为 additive（新增），不修改任何已有定义，供 web/api 与本域
// 纯函数 / hook / 服务端心跳共用。
// ============================================================================

/**
 * 资产加载优先级：名人模型（交互焦点）> 场景模型（建筑）> 装饰（树/石/灯）。
 * 数字越大越优先加载；队列按 (priority desc, distance asc) 出队。
 */
export type AssetPriority = 'celebrity' | 'scene' | 'decoration';

/** 优先级权重常量（纯数据，便于排序比较）。 */
export const ASSET_PRIORITY_WEIGHT: Record<AssetPriority, number> = {
  celebrity: 3,
  scene: 2,
  decoration: 1,
};

/**
 * LOD 模型细节三档：
 * - full    近距离完整模型 + 动画 + 表情
 * - medium  中距离简化几何体（面数约减）
 * - low     远距离占位几何体（胶囊/公告板），不再加载高模
 */
export type LODLevel = 'full' | 'medium' | 'low';

/**
 * 同屏人群渲染档位：超出上限时远处玩家降级为公告牌/胶囊（low），近处保持 full。
 * - full       完整 3D 化身
 * - billboard  公告板（名字 + 代表色）
 * - capsule    胶囊/占位几何体
 */
export type CrowdRenderTier = 'full' | 'billboard' | 'capsule';

/** AI 网关配置（超时 / 并发 / 降级兜底文案）。 */
export interface AIGatewayConfig {
  /** 单次调用超时（ms），默认 30000。 */
  timeoutMs: number;
  /** 最大并行 AI 调用路数，超出排队，默认 3。 */
  maxConcurrency: number;
  /** 超时/失败时返回的兜底文案（不白屏）。 */
  fallbackText: string;
}

/** 默认 AI 网关配置。 */
export const DEFAULT_AI_GATEWAY_CONFIG: AIGatewayConfig = {
  timeoutMs: 30_000,
  maxConcurrency: 3,
  fallbackText: 'AI 助手暂时开小差了，稍后再试一次吧。',
};

/**
 * 崩溃前会话快照：记录崩溃时所在路由与场景，恢复时回到广场而非白屏。
 * 仅存最小可恢复信息，不含敏感/个人数据。
 */
export interface CrashSnapshot {
  /** 崩溃时的路径（window.location.pathname）。 */
  route: string;
  /** 崩溃时的场景 id（court/plaza/...），未知为 null。 */
  scene: string | null;
  /** 崩溃发生时间戳 ms。 */
  at: number;
  /** 最近一次成功浏览的安全落点（默认 '/'），用于兜底恢复。 */
  safeReturn: string;
}
