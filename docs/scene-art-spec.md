# 叽里呱啦 · 场景美术与技术规范（开放世界专项）

> 版本：1.0 · 基线：651ae1a · 适用：中央广场 / 六座建筑 / UGC 自定义场景

## 1. 设计基调

**霓虹夜市（Neon Night Bazaar）**：深色基底 + 暖黄品牌色（#FFD600）点缀 + 各建筑主题色。
所有场景必须明显属于同一世界：统一的暗色调、统一的发光材质风格、统一的雾效衰减。

## 2. 配色规范

| 角色 | 色值 | 用途 |
|------|------|------|
| 品牌黄 | `#FFD600` | 交互提示、出口门、收集品 hidden、名牌 |
| 背景深 | `#0a0a0a` | 天空盒底部、雾色、远景 |
| 次级深 | `#14161a` | 墙体、天花板 |
| 面板色 | `#1e2126` | 广场地台、UI 面板 |
| 道路色 | `#23262c` | 环形道路 |

### 建筑主题色

| 建筑 | primary | secondary | accent |
|------|---------|-----------|--------|
| 法庭 court | `#c9a227` | `#8b2500` | `#f5e6c8` |
| 脱口秀 talkshow | `#e07a5f` | `#2d1b2e` | `#ffb4a2` |
| 狼人杀 werewolf | `#7d5ba6` | `#1a1025` | `#c9b8e8` |
| 酒吧 bar | `#a34a4a` | `#1c1210` | `#e8a0a0` |
| 健身房 gym | `#4fb3a5` | `#0f1f1d` | `#a8e6de` |
| 图书馆 library | `#5b8db8` | `#0e1820` | `#b8d4e8` |

## 3. 光照规范

### 广场（室外）
- 环境光：intensity 0.45
- 半球光：sky `#3a3f4a` / ground `#0a0a0a` / intensity 0.45
- 平行光：position [40,60,30] / intensity 1.4 / 阴影贴图 1024
- 阴影相机范围：±80

### 室内
- 环境光：intensity 0.35
- 半球光：sky `#4a4035` / ground `#1a1612` / intensity 0.3
- 主顶灯（pointLight）：color `#fff4e0` / intensity 0.8 / distance = 宽×1.5
- 氛围灯（pointLight）：品牌黄 / intensity 0.5 / distance 8
- **同屏光源 ≤ 4 盏**

## 4. 雾效与天空盒

### 雾效
- 广场：near 40 / far 180 / color `#0a0a0a`
- 室内：near 8 / far 40 / color `#0a0a0a`

### 天空盒（程序化渐变，零贴图）
- 顶部 `#0d1117` → 中部 `#1a1f2e` → 地平线 `#2d2438` → 底部 `#0a0a0a`

## 5. 材质规范

- 默认 `meshStandardMaterial`：roughness 0.85 / metalness 0.05
- 发光材质：emissiveIntensity ≤ 0.6（收集品可到 0.6，门 0.3）
- 贴图最大尺寸：1024×1024（超过需在加载时降级）
- 单张贴图压缩后 ≤ 256KB
- 优先使用程序化几何体 + 纯色材质，减少贴图依赖
- 重复物体必须使用 `instancedMesh`（树/石/灯/座椅）

## 6. 性能预算

| 指标 | 广场 | 单建筑室内 |
|------|------|-----------|
| draw call | ≤ 60 | ≤ 30 |
| 同屏光源 | ≤ 4 | ≤ 4 |
| 贴图总显存 | ≤ 16MB | ≤ 8MB |
| dpr 上限 | 1.5 | 1.5 |
| instancedMesh 实例 | ≤ 200 | ≤ 100 |

### 按需加载策略
- 建筑室内场景仅在进入时加载（React.lazy + Suspense）
- 退出室内时卸载 GLTF 资源（useGLTF.preload / dispose）
- 广场建筑外壳使用 LOD：远距离降级为占位几何体

## 7. 碰撞与可走区域

- 广场：建筑 footprint AABB + 喷泉圆柱 + 世界边界 clamp（±130）
- 室内：四壁 AABB（前墙留 2m 门洞）+ 家具 AABB
- 玩家碰撞半径：0.4（室内）/ 0.5（广场）
- 禁止穿墙、卡死、掉出世界（y < -10 时传送回出生点）

## 8. 收集品系统

- 全局 24 个收集品：广场 6 + 每建筑 3
- 稀有度：common(10XP) / rare(30XP) / hidden(50XP + 成就)
- 拾取距离：2.0 单位
- 持久化：localStorage `balabala.collectibles.v1`
- XP 挂钩：`addXp()` from `profile/playerProfile.ts`
- 成就挂钩：`unlockAchievement()` + 8 个探索成就
- 事件：`CustomEvent('balabala:collectible')`

## 9. UGC 场景兼容接口

UGC 自定义场景通过 `scene-studio/SceneRunner.tsx` 渲染。兼容要求：

1. **材质命名**：UGC 场景导出的 GLTF 中，材质名以 `ugc_` 前缀开头时，运行时自动映射到规范材质参数（roughness 0.85 / metalness 0.05）
2. **光照注入**：SceneRunner 必须引用 `art-spec.ts` 的 `PLAZA_LIGHTING` 或 `INTERIOR_LIGHTING`
3. **雾效统一**：UGC 场景加载时自动应用 `FOG` 规范
4. **碰撞格式**：UGC 场景的碰撞体使用与 `world/collision.ts` 相同的 AABB/Circle 联合类型
5. **收集品槽位**：UGC 场景可声明 `collectibleSlots: {x,y,z}[]`，运行时自动生成 common 收集品
6. **最小兼容样例**：`scene-studio/` 下提供 `ugc-sample-scene.json`，验证上述接口

## 10. 室内场景组件规范

每座建筑室内必须：
1. 创建 `apps/web/src/world/interior/<BuildingId>Interior.tsx`
2. 使用 `<InteriorScene buildingId width depth onExit buildingName>` 包裹
3. 在 children 中放置专属家具（使用建筑主题色）
4. 导出默认组件
5. 在 `App.tsx` 或 `Plaza3D.tsx` 的 enterHandlers 中接入

## 11. 文件结构

```
apps/web/src/world/
├── art-spec.ts              # 统一美术/光照/雾/性能规范
├── collectibles.ts          # 收集品定义 + XP/成就挂钩
├── collectibles.test.ts     # 收集品单测
├── CollectibleMesh.tsx      # 收集品 3D 渲染
├── interior/
│   ├── InteriorShell.tsx    # 室内外壳（墙/地板/光照/出口/收集品层）
│   ├── InteriorPlayer.tsx   # 室内玩家控制器
│   └── InteriorScene.tsx    # 室内场景容器（Canvas + UI）
├── config.ts                # 世界/建筑布局配置
├── types.ts                 # 类型定义
├── collision.ts             # 碰撞检测
├── WorldScene.tsx           # 广场 3D 场景
└── ...
```
