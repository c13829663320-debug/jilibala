// ===== R5: 代码分包契约测试 =====
//
// 目标：保证 App.tsx 中各场景 Shell 都通过 React.lazy(() => import(...)) 动态导入，
// 首屏（entry/room）不把法庭/狼人杀/酒吧/健身房/图书馆/脱口秀/广场等 3D 场景代码
// 打进主 chunk。这是静态源码契约校验，不真正加载 three.js（node 环境无 WebGL）。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(resolve(here, '../App.tsx'), 'utf8')

/** 必须按需动态导入的场景 Shell（首屏不得静态 import）。 */
const LAZY_SCENES = [
  'Plaza3D',
  'TalkshowShell',
  'WerewolfShell',
  'BarShell',
  'LibraryShell',
  'GymShell',
  'CharacterHall',
  'CustomCharacterStudio',
  'MultiplayerLobby',
  'SceneStudio',
  'MyScenes',
  'ScenePlay',
] as const

describe('App.tsx 场景代码分包', () => {
  it('每个重场景都用 lazy(() => import(...)) 动态导入', () => {
    for (const scene of LAZY_SCENES) {
      // 形如：const X = lazy(() => import('./X')) 或 lazy(() => import('./scene-studio/X'))
      const re = new RegExp(`lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"][^'"]*/${scene}['"]\\s*\\)\\s*\\)`)
      expect(appSource, `${scene} 应通过 lazy(() => import(...)) 动态导入`).toMatch(re)
    }
  })

  it('重场景不得被顶层静态 import（会打进首屏 chunk）', () => {
    // 静态 import 形如：import X from './X'（不带 lazy）。逐行排除 lazy 行。
    const lines = appSource.split('\n')
    for (const scene of LAZY_SCENES) {
      for (const line of lines) {
        if (line.includes(`'./`) && line.includes(`/${scene}'`)) {
          expect(line, `${scene} 不应被静态 import（应走 lazy）`).toContain('lazy(')
        }
      }
    }
  })
})
