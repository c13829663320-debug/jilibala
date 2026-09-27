# R5 新手体验专项 · 窗口 1 交接文档

> 分支：`feat/r5-onboarding` · 负责人：R5 新手体验负责人 · 交付日期：2026-09-27

---

## 1. 基线与最终 Commit

| 项 | Commit |
|---|---|
| 基线（origin/main） | `45d3a38` |
| 最终（feat/r5-onboarding） | `cb8fc3e` |
| 远端状态 | 已推送 `origin/feat/r5-onboarding`，与本地一致 |

提交历史（8 commits）：

```
cb8fc3e  feat(r5): E2E走查脚本 + 删除main.tsx旧开屏(回归用户误触发)
ccee1f4  feat(onboarding): 集成修复 — 挂载 FirstWowReward 到 App 根组件
bf5b4d7  Merge branch 'feat/r5-onboarding-c' into feat/r5-onboarding
f94d81a  Merge branch 'feat/r5-onboarding-b' into feat/r5-onboarding
66b1fe7  feat(onboarding-c): 招牌体验快车道 + Plaza3D首启聚焦 + 法庭一键开庭
ef7c1bb  feat(onboarding-a): 接入开屏并重写首启动线路由编排
00f816b  feat(onboarding-b): 渐进式披露/CoachMark/首次奖励/空态加载引导
f09d87d  feat(onboarding): R5 统一状态机基座 — phase/首次标志/奖励/事件总线
```

---

## 2. 改动文件清单（45 文件，+3055 / -49）

### 新增 — onboarding 共享基座（8 文件）
| 文件 | 职责 |
|---|---|
| `apps/web/src/onboarding/onboarding-store.ts` | 统一状态机（phase 七态 / FirstTimeKey 5 个 / rewards / 旧版数据自动迁移 / 纯函数 + 可注入 Storage） |
| `apps/web/src/onboarding/onboarding-store.test.ts` | 20 条单测 |
| `apps/web/src/onboarding/onboarding-events.ts` | 轻量发布订阅总线（phase-change / first-time / reward / flow-skipped / flow-completed） |
| `apps/web/src/onboarding/onboarding-routing.ts` | 路由决策纯函数（shouldShowSplash / resolveOnboardingGate） |
| `apps/web/src/onboarding/onboarding-routing.test.ts` | 20 条路由编排单测 |

### 新增 — 分片A 首启动线（0 独立文件，逻辑在 routing + App.tsx）

### 新增 — 分片B 渐进式披露与引导（8 文件）
| 文件 | 职责 |
|---|---|
| `apps/web/src/onboarding/CoachMark.tsx` | 高亮气泡组件（CSS 选择器/坐标目标 + 箭头 + portal + 下一步/跳过） |
| `apps/web/src/onboarding/coachmark-geo.ts` + `.test.ts` | 气泡定位几何纯函数 + 5 条单测 |
| `apps/web/src/onboarding/FirstWowReward.tsx` | 首次奖励弹窗（订阅 bus reward 事件 + claimFirstWow 幂等） |
| `apps/web/src/onboarding/first-wow.ts` + `.test.ts` | 奖励文案/逻辑 + 2 条单测 |
| `apps/web/src/onboarding/room-entry-layout.ts` + `.test.ts` | RoomEntry 布局纯逻辑 + 单测 |

### 新增 — 分片C 招牌快车道与 Plaza 聚焦（7 文件）
| 文件 | 职责 |
|---|---|
| `apps/web/src/onboarding/CelebrityQuickChat.tsx` | 名人对话一键直达浮层（纯 DOM，默认苏格拉底） |
| `apps/web/src/onboarding/quick-chat.ts` + `.test.ts` | 快车道数据挑选/降级 + 12 条单测 |
| `apps/web/src/onboarding/plaza-focus.ts` + `.test.ts` | Plaza 首启聚焦逻辑 + 9 条单测 |
| `apps/web/src/world/FocusMarker.tsx` | Three 聚焦标记（脉冲光环 + 浮动箭头，纯原生几何体） |

### 修改 — 现有文件（10 文件）
| 文件 | 改动要点 |
|---|---|
| `apps/web/src/App.tsx` | 路由编排重写：SplashGate（z-index 110000）、phase 状态机驱动、identity→interest 自动推进、跳过→entry、FirstWowReward 挂载、进度指示 |
| `apps/web/src/main.tsx` | **删除旧开屏**（原无条件渲染 SplashScreen，与 SplashGate 重复导致回归用户误触发 + 新用户点两次） |
| `apps/web/src/CourtroomShell.tsx` | 新增可选 `onVerdictReady` 回调（纯 UI effect，判决出炉触发 firstWow 奖励） |
| `apps/web/src/RoomEntry.tsx` | 首启用户收敛布局（招牌法庭大卡片 + 「全部体验」折叠），回归用户完整展示 |
| `apps/web/src/Plaza3D.tsx` | 首启玩家传送推荐建筑前 + 相机对准 + FocusMarker + 浮卡，进入/跳过后 markFirstTime('plaza') |
| `apps/web/src/court/CourtFlow.tsx` | 首启「⚡ 一键开庭」卡片（预置示例案直接开庭） |
| `apps/web/src/world/SceneSelect.tsx` | 新增 collapsed 模式（首启只露推荐项 + 展开全部） |
| `apps/web/src/MultiplayerLobby.tsx` | 接入 5 步 MULTIPLAYER_TOUR_STEPS（CoachMark 序列） |
| `apps/web/src/scene-studio/SceneStudio.tsx` | 首次创作 3 步浮层引导 |
| `apps/web/src/LoadingFallback.tsx` | 趣味文案轮换（8 句，每 1.5s） |
| `apps/web/src/ArchivePage.tsx` | 空状态 CTA 改为「去法庭审一场 →」 |
| `apps/web/src/onboarding/InterestPicker.tsx` | 接 onboardingActions + stepLabel |
| `apps/web/src/onboarding/QuickStartCard.tsx` | 接 onboardingActions + stepLabel |
| `apps/web/src/onboarding/onboarding.css` | 三分片样式合并 |
| `apps/web/src/court/court.css` | 一键开庭卡片样式 |

### 新增 — E2E 走查（11 文件）
| 文件 | 说明 |
|---|---|
| `e2e/r5-onboarding-walkthrough.mjs` | 5 场景 23 断言无头 Chromium 走查脚本（swiftshader） |
| `e2e/screenshots-r5/01-09.png` | 走查截图证据 |

---

## 3. 首启动线图

```
全新用户（localStorage 空）
│
├─ ① 开屏 SplashScreen（SplashGate, z-index 110000）
│     下层 IdentityProvider 并行加载身份
│     点击/键盘 → advance('identity') → 消散
│
├─ ② 建身份 SetupModal（IdentityProvider phase=setup）
│     填写昵称 + 选化身 → 提交 → phase=ready
│     effect 自动 advance('interest')
│
├─ ③ 选兴趣 InterestPicker（4 选项 + 跳过）
│     选兴趣 → selectInterest + advance('quickstart')
│     跳过 → skip() → flowSkipped=true → 直接进 RoomEntry
│
├─ ④ 推荐卡片 QuickStartCard（一个大按钮直达招牌体验）
│     「立即开始」→ advance('signature') + complete() → 进法庭
│     跳过 → skip() → RoomEntry
│
└─ ⑤ 招牌体验：法庭 CourtroomShell
      首次进法庭 markFirstTime('court')
      判决出炉 → onVerdictReady → claimFirstWow()（幂等）
      → bus.publish({type:'reward'}) → FirstWowReward 弹窗
      → 「🎉 首次庭审完成！获得「初出茅庐」徽章」

全程 3–5 步，约 3 分钟内出现首个哇时刻（判决 + 奖励弹窗）。
每步右上角显示进度（如 2/5）。
```

**回归用户**（flowCompleted=true）：SplashGate dismissed=true，直接进 RoomEntry，无引导打断。

**跳过用户**（flowSkipped=true）：同上，直接进 RoomEntry。

---

## 4. 测试与证据路径

### 单元测试（425 passed / 33 files）
```bash
cd apps/web && npx vitest run
```
新增测试文件 7 个，共 ~85 条用例：
- `onboarding-store.test.ts`（20）：状态机推进/跳过/完成/首次标志幂等/奖励幂等/旧版迁移
- `onboarding-routing.test.ts`（20）：动线推进/跳过/回归不触发/刷新断点恢复/哇时刻幂等
- `coachmark-geo.test.ts`（5）：气泡定位/翻转/夹取/极小屏退化
- `first-wow.test.ts`（2）：奖励弹窗触发条件
- `room-entry-layout.test.ts`（~6）：收敛布局/展开后全可达/回归用户不受影响
- `quick-chat.test.ts`（12）：名人挑选/降级/开场白兜底
- `plaza-focus.test.ts`（9）：首启聚焦触发/回归不聚焦/markFirstTime 幂等/6 建筑 yaw 有限

### 类型检查
```bash
cd apps/web && npx tsc --noEmit   # 无错误
```

### 构建
```bash
cd apps/web && npx vite build   # 成功，PWA 生成
```

### E2E 走查（23/23 通过）
```bash
node e2e/r5-onboarding-walkthrough.mjs
```
环境：无头 Chromium + swiftshader（软件渲染），内置静态服务器（端口 5199）+ API 代理（端口 8787）。

| 场景 | 断言数 | 覆盖 |
|---|---|---|
| 1 新用户主线 | 8 | 开屏→身份→兴趣→推荐→法庭=4步，flowCompleted=true，court firstTime=true |
| 2 刷新不重复 | 2 | 刷新后 flowCompleted 仍 true，直接进入口不重弹引导 |
| 3 跳过路径 | 3 | flowSkipped=true + flowCompleted=true，刷新后持久化 |
| 4 老用户入口 | 8 | 不显示开屏，直达 RoomEntry，6 建筑入口全可达 |
| 5 跳过用户布局 | 2 | 进入口大厅，可见法庭 + 全部场景 |

截图证据：`e2e/screenshots-r5/01-splash.png` … `09-progressive-disclosure.png`

---

## 5. 可跳过 / 不重复触发实现说明

### 可跳过
- **InterestPicker** 和 **QuickStartCard** 均有「跳过」按钮 → `onboardingActions.skip()` → `skipFlow()` 设置 `phase='skipped'`, `flowSkipped=true`, `flowCompleted=true` → `setView('entry')`
- 跳过后与自然走完用户待遇相同：直接进 RoomEntry，不再被引导打断

### 不重复触发
- 所有状态持久化到 `localStorage` key `balabala.onboarding.v1`
- `SplashGate` 的 `dismissed` 初始值 = `!shouldShowSplash(loadOnboardingState())`：仅 `phase==='splash' && !flowCompleted && !flowSkipped` 才显示开屏
- `resolveOnboardingGate`：`flowCompleted || flowSkipped` → 返回 `'none'`，不渲染任何引导层
- `FirstTimeKey`（plaza/multiplayer/creation/celebrity_chat/court）：`markFirstTime()` 幂等，已标记则不再触发对应引导
- `claimFirstWow()`：已领取（`firstWowClaimed=true`）则返回 false，不弹窗
- 刷新/重开：从 localStorage 恢复状态，已完成/跳过用户直接进主界面

### 关键 Bug 修复
- **main.tsx 旧开屏未删除**：原 `main.tsx` 对所有非分享页用户无条件渲染 `<SplashScreen>`，与 App.tsx 新增的 SplashGate 重复。导致：①回归用户也看到开屏；②新用户需点击两次（先关旧开屏，再关新开屏）。已删除旧开屏，开屏逻辑统一由 SplashGate 管理。

---

## 6. 与网络分支 feat/network-resilience 的潜在集成点

网络专项分支尚未合入 main，本分支从 main 切出，**未触碰**网络专项域（WS/WebRTC/断线重连/房间权限/状态同步）。以下为后续合入时需注意的集成点：

1. **MultiplayerLobby 5 步引导**：本分支在 MultiplayerLobby 接入了 CoachMark 序列（锚点 `data-tour="lobby-create"` / `data-tour="room-code"`）。若网络分支重构了多人大厅 DOM 结构或入口，需同步更新锚点选择器。
2. **首次多人引导触发**：`firstTimes.multiplayer` 在进入大厅时标记。若网络分支改变了进入大厅的路由或权限逻辑，需确认标记时机仍正确。
3. **CourtroomShell onVerdictReady**：本分支新增的回调是纯 UI effect（判决状态变化时触发），不碰网络。若网络分支重构了判决数据流向，需确认 `verdict` 状态仍在 CourtroomShell 内可观测。
4. **Plaza3D 首启聚焦**：本分支修改了玩家初始位置和相机 yaw，不碰 WS 同步。若网络分支添加了位置同步逻辑，需确认首启传送不会被同步覆盖。

---

## 7. 需 GPU 真机复测项

云端无头环境使用 swiftshader 软件渲染，以下 Three.js 相关观感无法验证，需 GPU 真机复测：

1. **Plaza3D 首启聚焦镜头**：玩家传送到推荐建筑正前方 + 相机 yaw 对准建筑的实际视觉效果（swiftshader 下场景可加载但帧率/画质不代表真机）。
2. **FocusMarker 脉冲光环 + 浮动箭头**：Three 原生几何体（ring/cone）的动画效果，需确认在真机 WebGL 下渲染正常、不闪烁、不与建筑模型穿模。
3. **CelebrityQuickChat 浮层**：纯 DOM 组件，软件渲染下已验证，真机仅需确认 z-index 层级不被 Three canvas 遮挡。
4. **SceneSelect collapsed 模式**：小地图渲染不受影响（已确认），但 3D 场景内的建筑高亮/角标需真机确认。
5. **整体帧率**：首启聚焦时的相机移动 + FocusMarker 动画对低端设备的性能影响。

---

## 8. 回滚方式

### 方式 A：删除分支（推荐，干净回滚）
```bash
git push origin --delete feat/r5-onboarding
```
main 不受影响，所有改动仅在 feat/r5-onboarding 分支。

### 方式 B：revert 合入后的 commit
若已合入 main，按合入顺序 revert：
```bash
git revert -m 1 <merge-commit-sha>  # revert 分片合并
git revert cb8fc3e ccee1f4          # revert 集成修复
```

### 方式 C：功能开关级回滚
若需保留代码但关闭新手引导：
- 设置 localStorage `balabala.onboarding.v1` 的 `flowCompleted=true` 可对单个用户跳过引导
- 全局关闭：在 App.tsx 的 SplashGate 中将 `dismissed` 初始值强制设为 `true`

---

## 9. 未做 / 后置项

- **名人对话快车道的实际 API 联调**：CelebrityQuickChat 调用 `/api/library/celebrity-chat`，失败时自动占位回复。API 端是否已就绪需窗口 2 确认。
- **首次奖励的后端记录**：当前 firstWow 奖励仅前端 localStorage 记录，未同步到用户档案。若需后端持久化，窗口 2 接入。
- **A/B 实验指标**：首启完成率、哇时刻到达率、跳过率等埋点未接入，窗口 2 视需要添加。
- **广场 100 名人的渐进式披露**：当前 Plaza3D 首启聚焦推荐建筑，但 100 名人列表仍全量展示。窗口 2 可考虑名人列表的搜索/筛选/分页优化。
