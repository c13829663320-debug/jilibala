// ===== R5 信息架构 (Information Architecture) =====
// 本文件为 R5-IA 域 additive 新增：全局导航骨架 / 三主页面 / 场景路由 / Shell 契约。
// 严格遵守共享契约：只新增，绝不修改本文件之外的任何已有类型。
//
// 设计原则：
// - 三个主导航页 = 广场(plaza) / 人物馆(celebrities) / 场景选择(scenes)；
// - 六大场景统一路由 /scene/:sceneId（sceneId ∈ SceneId）；
// - 场景内对局 = 全屏(fullscreen)：隐藏底部 TabBar、显示返回；
// - 卡片列表页(广场/人物馆/场景选择) = cards：显示底部 TabBar。

import type { SceneId } from "./index.js";

/** 底部主 Tab 导航的三项（与 TopNav 的「人物/场景/广场」对齐）。 */
export type MainTab = "plaza" | "celebrities" | "scenes";

/** 场景路由：由 /scene/:sceneId 解析得到。 */
export interface SceneRoute {
  sceneId: SceneId;
}

/**
 * Shell 布局模式：
 * - fullscreen：场景内对局/3D 画布——隐藏 MainTabBar，显示返回按钮与面包屑；
 * - cards：卡片列表页（广场/人物馆/场景选择）——显示 MainTabBar。
 */
export type ShellLayoutMode = "fullscreen" | "cards";

/** 面包屑单节：如「广场 > 趣味法庭 > 开庭」。 */
export interface BreadcrumbItem {
  label: string;
  /** 点击跳转的目标路径（可选；末节通常不可点）。 */
  to?: string;
}

/**
 * 统一场景壳（SceneShell）对外契约——纯数据 + 回调，便于跨域校验与单测。
 * View（场景内 3D 内容与交互）以 children 形式由 web 层注入，不进入本类型。
 */
export interface SceneShellProps {
  /** 当前场景 id（六大场景之一）。 */
  sceneId: SceneId;
  /** 场景展示名（面包屑/头部信息栏用）。 */
  title: string;
  /** 全屏对局 or 卡片列表。 */
  mode: ShellLayoutMode;
  /** 面包屑路径，至少 1 节。 */
  breadcrumb: BreadcrumbItem[];
  /** 返回上一级（全屏场景 = 回到场景选择/广场）。 */
  onBack: () => void;
  /** 3D 画布是否加载失败（由 Shell 渲染错误占位）。 */
  error?: string;
  /** 是否正在加载 3D 资源（由 Shell 渲染加载占位）。 */
  loading?: boolean;
}

/** 三大主 Tab 的稳定有序列表（供 MainTabBar 渲染与测试断言）。 */
export const MAIN_TABS: ReadonlyArray<{ tab: MainTab; label: string; path: string }> = [
  { tab: "plaza", label: "广场", path: "/plaza" },
  { tab: "celebrities", label: "人物", path: "/celebrities" },
  { tab: "scenes", label: "场景", path: "/scenes" },
] as const;

/** 场景路由前缀：/scene/:sceneId。 */
export const SCENE_ROUTE_PREFIX = "/scene/";

/** 判断某 path 是否为全屏场景路由（用于自动隐藏 MainTabBar）。 */
export function isFullscreenScenePath(pathname: string): boolean {
  return pathname.startsWith(SCENE_ROUTE_PREFIX);
}
