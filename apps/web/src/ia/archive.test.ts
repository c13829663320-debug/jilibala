/**
 * R5-IA 架构测试：归档卫生。
 * 读取 App.tsx / CourtroomShell.tsx 源码做 grep 式断言：
 *  - 已归档的 CourtroomM13 不再被路由/外壳引用；
 *  - 主路径统一走 Plaza3D（旧 2D Plaza 仅作 Plaza3D 内嵌面板，不进路由）；
 *  - 新导航骨架（MainTabBar / SceneRouter / SceneSelectView）已接线。
 * 纯 node 环境读文件，不渲染组件。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '..')
const read = (rel: string) => readFileSync(resolve(srcRoot, rel), 'utf8')

const appTsx = read('App.tsx')
const courtroomShell = read('CourtroomShell.tsx')

describe('归档卫生', () => {
  it('archive/CourtroomM13.tsx 文件存在', () => {
    expect(existsSync(resolve(srcRoot, 'archive/CourtroomM13.tsx'))).toBe(true)
  })

  it('App.tsx 不再引用归档的 CourtroomM13', () => {
    expect(appTsx).not.toMatch(/CourtroomM13/)
  })

  it('CourtroomShell 不再 import CourtroomM13（已是死导入）', () => {
    expect(courtroomShell).not.toMatch(/import\s+CourtroomM13\b/)
  })

  it('App.tsx 不从 archive/ 目录 import 任何东西', () => {
    expect(appTsx).not.toMatch(/from ['"]\.\/archive\//)
  })
})

describe('主路径统一', () => {
  it('广场主路径走 Plaza3D（App 引用 Plaza3D）', () => {
    expect(appTsx).toMatch(/Plaza3D/)
  })

  it('新导航骨架已接入：MainTabBar / SceneRouter / SceneSelectView', () => {
    expect(appTsx).toMatch(/MainTabBar/)
    expect(appTsx).toMatch(/SceneRouter/)
    expect(appTsx).toMatch(/SceneSelectView/)
  })

  it('六大场景中五个通用场景由 SceneRouter 统一分发（App 不再散落各自分支）', () => {
    // App 中不应再出现对 TalkshowShell/WerewolfShell/BarShell/LibraryShell/GymShell 的直接 lazy import
    expect(appTsx).not.toMatch(/import\('\.\/TalkshowShell'\)/)
    expect(appTsx).not.toMatch(/import\('\.\/WerewolfShell'\)/)
    expect(appTsx).not.toMatch(/import\('\.\/BarShell'\)/)
    expect(appTsx).not.toMatch(/import\('\.\/LibraryShell'\)/)
    expect(appTsx).not.toMatch(/import\('\.\/GymShell'\)/)
  })
})
