// ===== R5: 代码分包契约测试 =====
//
// R5-IA 重构后：五个通用场景 Shell（脱口秀/狼人杀/酒吧/图书馆/健身房）的
// React.lazy(() => import(...)) 收敛到 ia/SceneRouter.tsx；App.tsx 只直接 lazy
// 顶层重视图（广场/人物馆/自定义/多人大厅/场景工作室）。分包目标不变：
// 首屏（entry）不把任何 3D 重场景代码打进主 chunk。静态源码校验，不加载 three.js。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(here, '../App.tsx'), 'utf8')
const sceneRouterSource = readFileSync(resolve(here, '../ia/SceneRouter.tsx'), 'utf8')

/** App.tsx 直接 lazy 的顶层重视图（首屏不得静态 import）。 */
const APP_LAZY_SCENES = [
  'Plaza3D',
  'CharacterHall',
  'CustomCharacterStudio',
  'MultiplayerLobby',
  'SceneStudio',
  'MyScenes',
  'ScenePlay',
] as const

/** 五个通用场景 Shell：由 SceneRouter 统一 lazy（import 路径带 ../ 前缀）。 */
const ROUTER_LAZY_SCENES = [
  'TalkshowShell',
  'WerewolfShell',
  'BarShell',
  'LibraryShell',
  'GymShell',
] as const

/** lazy(() => import('<prefix>/<Scene>'))；prefix 可为空（./Scene）或多级目录。 */
function lazyImportRegex(scene: string, requireSlash: boolean) {
  const slash = requireSlash ? '/' : '/?'
  return new RegExp(
    `lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"][^'"]*?${slash}${scene}['"]\\s*\\)\\s*\\)`
  )
}

describe('场景代码分包', () => {
  it('App.tsx 顶层重视图用 lazy(() => import(...)) 动态导入', () => {
    for (const scene of APP_LAZY_SCENES) {
      expect(appSource, `${scene} 应在 App.tsx 通过 lazy 动态导入`).toMatch(
        lazyImportRegex(scene, false)
      )
    }
  })

  it('五个通用场景 Shell 由 SceneRouter 统一 lazy 动态导入', () => {
    for (const scene of ROUTER_LAZY_SCENES) {
      expect(sceneRouterSource, `${scene} 应在 SceneRouter 通过 lazy 动态导入`).toMatch(
        lazyImportRegex(scene, true)
      )
    }
  })

  it('五个通用场景 Shell 不再在 App.tsx 直接 import（已收敛到 SceneRouter）', () => {
    for (const scene of ROUTER_LAZY_SCENES) {
      expect(appSource, `${scene} 已收敛到 SceneRouter，App.tsx 不应直接 import`).not.toMatch(
        new RegExp(`import\\(\\s*['"][^'"]*?/${scene}['"]\\s*\\)`)
      )
    }
  })
})
