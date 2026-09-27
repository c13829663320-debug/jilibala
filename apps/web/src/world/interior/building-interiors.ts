/**
 * 开放世界 · 建筑室内集成映射（总控合并用，本分片不创建具体室内组件）
 * ------------------------------------------------------------------
 * 六座建筑的 <XxxInterior> 由「建筑分片」各自实现于本目录：
 *   court     → ./CourtInterior
 *   talkshow  → ./TalkshowInterior
 *   werewolf  → ./WerewolfInterior
 *   bar       → ./BarInterior
 *   gym       → ./GymInterior
 *   library   → ./LibraryInterior
 *
 * 这里只做两件事：
 *   1. 用 React.lazy 给出每座建筑的懒加载组件（按需分包，进入才下载）
 *   2. 提供 useBuildingInterior(buildingId) 取值
 *
 * 总控合并时，在 Plaza3D 的 enterHandlers 里：
 *   const Interior = useBuildingInterior(id)
 *   setRender(<Suspense fallback={<Loading/>}><Interior onExit={...}/></Suspense>)
 * 即可，无需再写 import。
 *
 * 注意：路径用变量拼接 + @vite-ignore，避免在本分支（室内组件尚未落地）就被
 * tsc / 打包器静态解析报错；运行时浏览器按相对路径动态 import，建筑分片落地后即可用。
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { BuildingId } from '../types'

/** 各建筑室内组件的相对导入路径（与建筑分片实际创建文件一致） */
export const INTERIOR_PATHS: Record<BuildingId, string> = {
  court: './CourtInterior',
  talkshow: './TalkshowInterior',
  werewolf: './WerewolfInterior',
  bar: './BarInterior',
  gym: './GymInterior',
  library: './LibraryInterior',
}

type InteriorProps = { onExit: () => void }
type LazyInterior = LazyExoticComponent<ComponentType<InteriorProps>>

/** 兜底占位：对应建筑分片尚未落地时渲染 null（不阻塞广场） */
const PendingInterior: ComponentType<InteriorProps> = () => null

/** 运行时动态加载某建筑室内模块（变量路径 → TS 视为 Promise<any>，不做静态解析） */
function loadInteriorModule(id: BuildingId): Promise<{ default: ComponentType<InteriorProps> }> {
  // @vite-ignore：交给浏览器运行时按 INTERIOR_PATHS[id] 动态 import
  return import(/* @vite-ignore */ INTERIOR_PATHS[id]) as Promise<{
    default: ComponentType<InteriorProps>
  }>
}

/** 六座建筑 → 懒加载室内组件映射表 */
export const BUILDING_INTERIORS: Record<BuildingId, LazyInterior> = {
  court: lazy(() => loadInteriorModule('court')),
  talkshow: lazy(() => loadInteriorModule('talkshow')),
  werewolf: lazy(() => loadInteriorModule('werewolf')),
  bar: lazy(() => loadInteriorModule('bar')),
  gym: lazy(() => loadInteriorModule('gym')),
  library: lazy(() => loadInteriorModule('library')),
}

/**
 * 取某建筑的懒加载室内组件。
 * 总控在 Plaza3D.enterHandlers 里调用，包一层 <Suspense> 即可渲染。
 */
export function useBuildingInterior(buildingId: BuildingId): LazyInterior {
  return BUILDING_INTERIORS[buildingId] ?? lazy(() => Promise.resolve({ default: PendingInterior }))
}

export default BUILDING_INTERIORS
