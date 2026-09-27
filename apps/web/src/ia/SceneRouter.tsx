/**
 * R5-IA 统一场景路由：由 /scene/:sceneId 的 sceneId 分发到对应场景 Shell。
 *
 * 取代 App.tsx 中散落的 talkshow/werewolf/bar/library/gym 独立分支。
 * court（趣味法庭）因携带复杂案件状态机，仍由 App 单独接线（共享契约：不改玩法域逻辑），
 * 其余五个场景在这里统一渲染，并套上 SceneShell 的返回 + 面包屑骨架。
 */
import { lazy, Suspense, useState, type ComponentType } from 'react'
import { SCENE_META, type SceneId } from '@balabala/shared'
import SceneShell from './SceneShell'
import ErrorBoundary from '../ErrorBoundary'
import LoadingFallback from '../LoadingFallback'

const TalkshowShell = lazy(() => import('../TalkshowShell'))
const WerewolfShell = lazy(() => import('../WerewolfShell'))
const BarShell = lazy(() => import('../BarShell'))
const LibraryShell = lazy(() => import('../LibraryShell'))
const GymShell = lazy(() => import('../GymShell'))

type SimpleShellProps = { onBack: () => void; onPlaza: () => void }

/** 五个「通用外壳」场景 → 组件映射。court 不在此处（App 单独处理）。 */
const SHELLS: Partial<Record<Exclude<SceneId, 'court'>, ComponentType<SimpleShellProps>>> = {
  talkshow: TalkshowShell,
  werewolf: WerewolfShell,
  bar: BarShell,
  library: LibraryShell,
  gym: GymShell,
}

export type SceneRouterProps = SimpleShellProps & {
  sceneId: Exclude<SceneId, 'court'>
}

export default function SceneRouter({ sceneId, onBack, onPlaza }: SceneRouterProps) {
  const [resetKey, setResetKey] = useState(0)
  const retry = () => setResetKey((n) => n + 1)
  const Shell = SHELLS[sceneId]
  const meta = SCENE_META.find((m) => m.id === sceneId)
  const title = meta?.label ?? sceneId
  if (!Shell) return null
  return (
    <SceneShell
      sceneId={sceneId}
      title={title}
      mode="fullscreen"
      breadcrumb={[{ label: '广场', to: '/plaza' }, { label: '场景', to: '/scenes' }, { label: title }]}
      onBack={onBack}
    >
      <ErrorBoundary onRetry={retry} title={`「${title}」加载失败`}>
        <Suspense fallback={<LoadingFallback label={`正在加载${title}…`} />}>
          <ErrorBoundary is3D title="3D 场景渲染失败">
            <Shell key={resetKey} onBack={onBack} onPlaza={onPlaza} />
          </ErrorBoundary>
        </Suspense>
      </ErrorBoundary>
    </SceneShell>
  )
}
