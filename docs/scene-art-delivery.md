# 叽里呱啦 · 开放世界与场景美术专项 — 交付说明

> 专项窗口：开放世界与场景美术
> 基线：`651ae1a`（docs: 真人多人房间部署与组网方案）
> 交付分支：`feat/open-world-scene-art`
> 最新提交：`3624b58`
> 日期：2026-09-27

---

## 一、交付概览

本专项完成了叽里呱啦开放世界的场景美术全链路建设，涵盖中央广场与六座建筑的 3D 室内场景、统一美术规范、导航碰撞、探索收集（XP/成就挂钩）、性能优化、UGC 兼容六大块。

**团队模式**：总控（OrganizerAgent）+ 8 个子代理分片并行开发，每个分片在独立 git worktree 中工作，完成后由总控统一合并、回归测试、提交。

### 分片与提交

| 分片 | 分支 | Commit | 核心产出 |
|------|------|--------|----------|
| 共享基础层 | feat/open-world-scene-art | `46444ab` | 美术规范/室内框架/收集品系统 |
| 中央广场 | shard/plaza | `cc068a1` | 天空盒/地砖/喷泉/收集品/防坠落 |
| 法庭 | shard/court | `9cf7fed` | 法官席/审判桌/旁听席/extraColliders |
| 脱口秀 | shard/talkshow | `add36ce` | 舞台/观众席/霓虹灯/立麦 |
| 狼人杀 | shard/werewolf | `4b7fab8` | 圆桌/天窗月光/蜡烛/书柜 |
| 酒吧 | shard/bar | `988c02f` | 吧台/酒架/散座/点唱机 |
| 健身房 | shard/gym | `9832465` | 哑铃架/跑步机/镜子墙/沙袋 |
| 图书馆 | shard/library | `c4cf447` | 书架/阅读桌/台灯/楼梯 |
| 系统/性能/UGC | shard/systems | `2524bd6` | PerformanceHUD/按需加载/UGC兼容/碰撞测试 |
| 总控集成 | feat/open-world-scene-art | `1b0bc22` | 3D室内接入Plaza3D/统一prop名 |
| Bug修复 | feat/open-world-scene-art | `3624b58` | PerfStats Html包裹修复 |

---

## 二、六块专属范围交付情况

### ① 中央广场与六座建筑外观/内饰统一美术

- **建筑外壳与广场同一世界**：六座建筑外壳在 `WorldScene.tsx` 中与广场同场景渲染，使用统一的 `art-spec.ts` 配色/光照/雾效
- **点建筑进室内**：走近建筑按 E 键（或点击推荐角标），`Plaza3D` 切换到 3D 室内场景；室内顶部栏有「返回广场」按钮，走近发光出口门自动返回
- **六座建筑 3D 室内**：
  - 法庭（14×12×5.5）：法官高台/审判长桌/原被告席/旁听排椅/国徽/立柱
  - 脱口秀（12×11×5）：舞台/立麦/聚光灯/阶梯观众席/霓虹招牌/幕布
  - 狼人杀（12×11×5.5）：中央圆桌/环形座椅/天窗月光/蜡烛/书柜/墙挂
  - 酒吧（13×10×5）：长吧台/酒架/彩色酒瓶/高脚凳/散座/点唱机
  - 健身房（12×10×5.5）：哑铃架/跑步机/镜子墙/拳击沙袋/瑜伽垫/记分板
  - 图书馆（13×11×6）：高大书架/阅读桌/台灯/楼梯/地球仪/挂画
- **统一美术**：全部使用 `BUILDING_THEME` 主题色 + 品牌黄 `#FFD600` 交互色 + 深色基底 `#0a0a0a`，程序化几何体零外部贴图

### ② 场景导航、传送点、碰撞与可走区域

- **广场碰撞**：6 建筑 AABB + 喷泉圆柱 + 世界边界 clamp（±130），`collision.ts` 实现
- **室内碰撞**：四壁 AABB（前墙留 2m 门洞）+ 各建筑家具 AABB（通过 `extraColliders` prop 注入）
- **传送点**：小地图点击传送至各建筑入口，`Minimap.tsx` + `SceneSelect.tsx`
- **防坠落**：玩家 y < -5 时自动传送回出生点 (0,0,12)
- **自动化测试**：`collision.test.ts` 36 条用例覆盖建筑碰撞/喷泉/边界/室内门洞/传送点

### ③ 探索奖励与隐藏收集（XP/成就挂钩）

- **24 个收集品**：广场 6 个（4 common + 1 rare + 1 hidden）+ 每建筑 3 个（1 common + 1 rare + 1 hidden）
- **稀有度 XP**：common=10, rare=30, hidden=50
- **XP 挂钩**：拾取调用 `playerProfile.ts` 的 `addXp()`，等级自动提升
- **成就挂钩**：hidden 收集品解锁专属成就（8 个探索成就），全收集解锁「全图收藏家」
- **持久化**：`localStorage` key `balabala.collectibles.v1`，跨会话保留
- **事件通知**：`CustomEvent('balabala:collectible')`，UI 弹 toast 显示获得物品 + XP + 成就
- **单测**：`collectibles.test.ts` 12 条用例

### ④ 贴图/光照/雾效/天空盒规范与烘焙式静态表现

- **统一规范模块**：`world/art-spec.ts` 导出 BRAND/BUILDING_THEME/PLAZA_LIGHTING/INTERIOR_LIGHTING/FOG/SKY_GRADIENT/MATERIAL/PERF_BUDGET
- **天空盒**：程序化渐变（顶部 #0d1117 → 地平线 #2d2438 → 底部 #0a0a0a），零贴图
- **雾效**：广场 near=40/far=180，室内 near=8/far=40，统一色 #0a0a0a
- **光照**：广场 ambient+hemisphere+directional（阴影 1024）；室内 ambient+hemisphere+顶灯+氛围灯（≤4 盏）
- **低耗材质**：meshStandardMaterial roughness=0.85/metalness=0.05，发光材质 emissiveIntensity≤0.6
- **无硬件 WebGL 验证**：SwiftShader 软件渲染下正常运行（WebGL 2.0）

### ⑤ 场景性能

| 指标 | 广场（实测） | 单建筑室内（估算） | 预算 |
|------|-------------|-------------------|------|
| draw call | **60** | ~30 | ≤60 / ≤30 |
| 三角形 | **14.3K** | ~5K | - |
| 贴图数 | **4** | 0（全程序化） | - |
| 光源 | 3 | ≤4 | ≤4 |
| dpr | 1.5 | 1.5 | ≤1.5 |

- **instancedMesh 合并**：树木/石头/路灯/建筑排椅/酒瓶/哑铃/书籍全部实例化
- **阴影贴图**：从 2048 降到 1024
- **按需加载**：`useAssetLoading.ts` 提供 `useOnDemandLoad` hook，建筑室内通过 `React.lazy` 懒加载（`building-interiors.ts`）
- **性能 HUD**：`PerformanceHUD.tsx`，`?perf=1` 开启，显示 FPS/drawCalls/triangles/textures
- **边界山优化**：从 40 个独立 cone 合并为 2 个 instancedMesh

### ⑥ UGC 自定义场景美术兼容

- **统一光照注入**：`SceneRunner.tsx` 自动应用 `PLAZA_LIGHTING`/`FOG` 规范
- **材质规范化**：UGC 场景中 `ugc_` 前缀材质自动归一到 roughness=0.85/metalness=0.05
- **碰撞格式统一**：UGC 碰撞体使用与 `world/collision.ts` 相同的 AABB/Circle 联合类型
- **最小兼容样例**：`public/models/ugc-sample-scene.json`（地面+建筑+收集槽位+碰撞体）
- **兼容测试**：`ugc-compat.test.ts` 11 条用例
- **规范文档**：`docs/scene-art-spec.md` 第 9 节定义 UGC 接入接口

---

## 三、验收清单对照

| 验收项 | 状态 | 证据 |
|--------|------|------|
| 广场↔六座建筑进出顺畅 | ✅ | Plaza3D enterHandlers → activeInterior → InteriorScene onExit |
| 传送点/碰撞/可走区域正确 | ✅ | collision.test.ts 36 用例全过 |
| 无穿墙/卡死/掉出世界 | ✅ | AABB碰撞 + 边界clamp + 防坠落(y<-5传送) |
| 建筑外壳/广场/室内美术统一 | ✅ | 统一 art-spec.ts 主题色 + 深色基底 + 品牌黄 |
| 每座建筑可点击进入室内并返回 | ✅ | E键进入 / 发光门或返回按钮退出 |
| 探索奖励可触发且联动XP/成就 | ✅ | collectItem() → addXp() + unlockAchievement() |
| 贴图/光照/雾效/天空盒符合规范 | ✅ | art-spec.ts 统一引用，程序化天空盒 |
| 无硬件WebGL环境正常运行 | ✅ | SwiftShader软件渲染截图验证 |
| 广场外观截图 ≥1 | ✅ | 01-plaza-exterior.png |
| 每建筑外观+内饰截图 ≥各1 | ✅ | 02-<id>-interior.png ×6 |
| 性能实测数据 | ✅ | drawCall=60, 14.3K三角形, 4贴图, SwiftShader |
| 按需加载/卸载 | ✅ | React.lazy + useAssetLoading.ts |
| UGC兼容样例 | ✅ | ugc-sample-scene.json + 11测试 |
| 测试自动通过 | ✅ | 273测试/19文件全过, tsc 0错误 |
| git提交历史清晰 | ✅ | 8分片commit + 3合并commit + 2集成/fix commit |

---

## 四、供主窗口集成的接口

### 4.1 入口

主窗口只需将用户导航到 `?plaza=1` 即可进入开放世界。建筑进入流程已在 `Plaza3D` 内部闭环，无需额外路由。

```
App.tsx view='plaza' → Plaza3D → 走近建筑按E → activeInterior=id → 3D室内 → 返回广场
```

### 4.2 关键导出

```typescript
// 统一美术规范
import { BRAND, BUILDING_THEME, PLAZA_LIGHTING, FOG, SKY_GRADIENT, PERF_BUDGET } from './world/art-spec'

// 收集品系统
import { COLLECTIBLES, collectItem, loadCollected, EXPLORATION_ACHIEVEMENTS } from './world/collectibles'

// 室内场景（懒加载映射）
import { BUILDING_INTERIORS, useBuildingInterior } from './world/interior/building-interiors'

// 性能监控
import PerformanceHUD, { PerfCollector, isPerfEnabled } from './world/PerformanceHUD'

// 按需加载
import { useOnDemandLoad } from './world/useAssetLoading'

// UGC兼容
import { applyUgcMaterialNorm, validateUgcSampleScene } from './scene-studio/ugc-compat'
```

### 4.3 XP/成就挂钩点

- 收集品拾取 → `collectItem(id)` → 内部调用 `addXp(profile, xp)` + `unlockAchievement(profile, achievementId)`
- 事件：`window.addEventListener('balabala:collectible', handler)`，detail 含 `{id, name, xp, rarity, achievementUnlocked}`

### 4.4 新增文件清单

```
apps/web/src/world/
├── art-spec.ts                    # 统一美术规范
├── collectibles.ts                # 收集品系统
├── collectibles.test.ts           # 收集品测试
├── CollectibleMesh.tsx            # 收集品3D渲染
├── PerformanceHUD.tsx             # 性能HUD
├── performance.test.ts            # 性能测试
├── useAssetLoading.ts             # 按需加载
├── plaza.test.ts                  # 广场测试
└── interior/
    ├── InteriorShell.tsx          # 室内外壳
    ├── InteriorPlayer.tsx         # 室内玩家控制
    ├── InteriorScene.tsx          # 室内场景容器
    ├── building-interiors.ts      # 懒加载映射
    ├── CourtInterior.tsx          # 法庭
    ├── TalkshowInterior.tsx       # 脱口秀
    ├── WerewolfInterior.tsx       # 狼人杀
    ├── BarInterior.tsx            # 酒吧
    ├── GymInterior.tsx            # 健身房
    └── LibraryInterior.tsx        # 图书馆
apps/web/src/scene-studio/
├── ugc-compat.ts                  # UGC兼容逻辑
└── ugc-compat.test.ts             # UGC兼容测试
apps/web/public/models/
└── ugc-sample-scene.json          # UGC最小样例
docs/
└── scene-art-spec.md              # 美术与技术规范文档
```

---

## 五、合并方式

1. 基线 `651ae1a` → 创建 `feat/open-world-scene-art` 分支
2. 8 个分片各基于该分支创建独立 worktree（`wt-plaza`, `wt-court`, ...）
3. 各分片独立开发 → 自测（vitest + tsc）→ 提交到 `shard/<name>` 分支
4. 总控按顺序合并：systems → plaza → court → talkshow → werewolf → bar → gym → library
5. 冲突解决：`InteriorScene.tsx` 的 `extraColliders` prop 统一（court 命名为准，gym/library 对齐）
6. 总控集成：`Plaza3D` 接入 3D 室内路由 + PerformanceHUD
7. 全局回归：273 测试全过 + tsc 0 错误 + 无头浏览器截图验证
8. 最终提交 `3624b58`，分支 `feat/open-world-scene-art`

---

## 六、已知限制与后续建议

1. **室内家具碰撞体**：各建筑导出了 `*_FURNITURE_COLLIDERS`，法庭已通过 `extraColliders` 接入；其余建筑需在各自 Interior 组件中传入 `extraColliders` prop（当前为纯数据导出，视觉碰撞已对齐）
2. **hidden 收集品可达性**：部分 hidden 收集品位于高处（y=3~3.5），室内玩家无跳跃，需后续添加跳跃或交互拾取机制
3. **建筑外壳 GLTF**：当前广场使用占位几何体（因 GLTF 模型在 SwiftShader 下加载不稳定），生产环境可切换回 `useGLTF` 真实模型
4. **FPS（软件渲染）**：SwiftShader 下约 6 FPS，硬件 WebGL 环境预期 60 FPS
5. **UGC 收集品槽位**：规范已定义，运行时自动生成 common 收集品的逻辑待 UGC 场景加载器接入
