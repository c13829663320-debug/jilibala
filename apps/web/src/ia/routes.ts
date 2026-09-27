/**
 * R5-IA 路由映射（纯逻辑，无 DOM，可在 node/vitest 下单测）。
 *
 * 历史背景：App.tsx 原本是纯内存视图机（view: View 状态），无 URL。
 * R5-IA 在此之上叠加一层轻量 history 同步：
 *  - 顶层可路由视图 ↔ URL path 双向映射；
 *  - 深流程（onboarding / archive / multiplayer-lobby / scene-studio / scene-play）
 *    仍保留为内存叠加态，不占用 URL（它们从三主页面进入、可返回）。
 *
 * 三主页面：/plaza(广场) /celebrities(人物) /scenes(场景)
 * 六大场景：/scene/:sceneId
 */
import { SCENE_META, type SceneId } from '@balabala/shared'

/** 六大场景 id（与 shared SCENE_META 对齐）。 */
export const SCENE_IDS: SceneId[] = SCENE_META.map((s) => s.id)

/**
 * 可路由视图 → URL path。
 * key 与 App.tsx 内部 View 联合中的可路由项保持一致。
 */
export const VIEW_PATHS: Record<string, string> = {
  plaza: '/plaza',
  celebrities: '/celebrities',
  scenes: '/scenes',
  entry: '/entry',
  mypage: '/mypage',
  avatar: '/studio/avatar',
  'custom-studio': '/studio/custom',
  video: '/studio/video',
  // 六大场景统一走 /scene/:sceneId
  court: '/scene/court',
  talkshow: '/scene/talkshow',
  werewolf: '/scene/werewolf',
  bar: '/scene/bar',
  gym: '/scene/gym',
  library: '/scene/library',
}

/** 六大场景视图集合（SceneRouter 据此分发）。 */
export const SCENE_VIEW_SET: ReadonlySet<string> = new Set(SCENE_IDS)

/** path 是否为合法 /scene/:sceneId，返回解析出的 sceneId（否则 null）。 */
export function matchScenePath(pathname: string): SceneId | null {
  const m = pathname.match(/^\/scene\/([a-z]+)\/?$/)
  if (!m) return null
  const id = m[1]
  return (SCENE_IDS as string[]).includes(id) ? (id as SceneId) : null
}

/** 把任意 URL pathname 解析成可路由视图名；无法识别时回退 null（由调用方决定兜底）。 */
export function pathToView(pathname: string): string | null {
  const sceneId = matchScenePath(pathname)
  if (sceneId) return sceneId
  // 反向查 VIEW_PATHS
  for (const [view, path] of Object.entries(VIEW_PATHS)) {
    if (path === pathname.replace(/\/$/, '') || path === pathname) return view
  }
  // 根路径默认落广场
  if (pathname === '/' || pathname === '') return 'plaza'
  return null
}

/**
 * 取一个视图对应的 URL path；不可路由视图（onboarding/archive/multiplayer-lobby 等
 * 内存叠加态）返回 null——此时不改地址栏，避免污染 history。
 */
export function viewToPath(view: string): string | null {
  if (SCENE_VIEW_SET.has(view)) return `/scene/${view}`
  return VIEW_PATHS[view] ?? null
}
