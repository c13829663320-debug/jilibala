# 叽里呱啦 BalaBala · 技术基线报告

> 建立时间：2026-09-26（Asia/Shanghai）
> 工程根：`/home/user/Doubao/chats/38440437530857986/jilibala`
> 当前分支：`feat/talkshow-bar-player-driven`　HEAD：`1f855e0`
> 基线用途：后续 20 轮开发的起点数据。所有命令均真实运行，输出如实记录。

---

## 0. 关键结论（先读）

1. **生产构建当前是坏的**：`apps/web` 的 `npm run build`（= `tsc -b && vite build`）**退出码 1**，被 2 个 TypeScript 错误阻断，`vite build` 根本没机会跑。根因是本分支「玩家驱动法庭」把 `player` 角色加进了发言方枚举，但类型定义 `CourtRoleType` 与 `CourtTrialPanel` 的角色映射表没同步更新。
2. **测试全绿**：API 217 passed / 0 failed；Web 108 passed / 0 failed。测试不跑 `tsc`，所以掩盖了上面的类型错误。
3. **百位人物视频资产不在当前分支**：当前分支 `apps/web/public/videos/` 只有 **5 个 mp4（4.2MB）**；102 个 mp4（约 170MB）在 `main`（HEAD `1a5a41d`）上，**尚未合并到本分支**。
4. **人物数据模型只有 20 人**（`packages/shared/src/celebrities.ts`），main 上的 102 个 mp4 里约 82 个对应的人物根本不在 CELEBRITIES 名单里（abraham-lincoln、adam-smith、cao-cao 等）。「百位人物」的视频资产与人物数据模型是脱节的。
5. **视频真正在 UI 里可播放的地方只有 1 处**：人物馆详情弹窗。法庭、3D 长廊、脱口秀/狼人杀/酒吧/图书馆/健身房**均无人物视频播放**。
6. **无任何容器化/部署脚本**：没有 Dockerfile、docker-compose、cloudflared 配置；只有一个跑 `npm ci → npm test → npm run build` 的 GitHub Actions（且在本分支会因构建失败而红）。

---

## 1. 代码健康检查

### 1.1 TypeScript 类型检查（`tsc --noEmit`）

| 模块 | 命令 | 退出码 | 错误数 |
|---|---|---|---|
| API | `cd apps/api && npx tsc --noEmit` | 0 | **0** |
| Web | `cd apps/web && npx tsc --noEmit` | 0（但有错误输出） | **2** |

**Web 端 2 个错误详情（均与本分支 player 角色有关）：**

```
src/CourtTrialPanel.tsx(5,7): error TS2741
  Property 'player' is missing in type
  '{ judge: ...; plaintiff: ...; defendant: ...; defender: ...; }'
  but required in type
  'Record<"judge" | "plaintiff" | "defendant" | "defender" | "player", {...}>'.

src/court/http-engine.ts(97,5): error TS2322
  Type '"judge" | "plaintiff" | "defendant" | "defender" | "player"' is not assignable
  to type 'CourtRoleType'.
  Type '"player"' is not assignable to type 'CourtRoleType'.
```

**诊断**：发言方联合类型已经加入 `"player"`，但
- `apps/web/src/CourtTrialPanel.tsx:5` 的角色元信息表只列了 judge/plaintiff/defendant/defender 四键，缺 `player`；
- `apps/web/src/court/http-engine.ts:97` 写入 `CourtRoleType`（定义在 `apps/web/src/court/types.ts`）时，`player` 不在该类型里。

**修法提示（后续轮次）**：在 `CourtRoleType` 联合类型与 `CourtTrialPanel` 角色 Record 中补 `player`，即可同时消除这 2 个错误并解锁构建。

### 1.2 单元测试（`vitest run`）

| 模块 | 命令 | 测试文件 | 通过 | 失败 | 耗时 |
|---|---|---|---|---|---|
| API | `cd apps/api && npx vitest run` | 18 passed | **217 passed** | **0 failed** | 23.03s |
| Web | `cd apps/web && npx vitest run` | 7 passed | **108 passed** | **0 failed** | 8.49s |

**API 测试文件清单（18）**：db.test(19)、court-orchestrator.test(7)、court-db.test(13)、character-resolver.test(7)、talkshow-orchestrator.test(9)、custom-character-db.test(17)、werewolf-orchestrator.test(20)、bar-orchestrator.test(8)、scene-studio/scene-db.test(8)、ws.test(8)、normalize-character-model.test(5)、court-state.test(16)、scene-studio/scene-asset-builder.test(18)、gym-orchestrator.test(15)、scene-studio/scene-planner.test(16)、character-voices.test(9)、skill.test(13)、bench-orchestrator.test(9)。

**Web 测试文件清单（7）**：character-gallery.test(29)、courtroom-seats.test(17)、courtroom-camera.test(34)、scene-studio/terrain.test(6)、scene-studio/collision.test(5)、scene-studio/gameplay.test(12)、character-voices.web.test(5)。

> 失败测试：**无**。无需记录失败文件。
> 备注：API 测试大量依赖 Node 实验性 `--experimental-sqlite`，运行时有 ExperimentalWarning，属正常。

---

## 2. 百位人物视频接入审计

### 2.1 视频资产盘点

**当前分支（`feat/talkshow-bar-player-driven`，HEAD 1f855e0）：**

| 项目 | 值 |
|---|---|
| 目录 | `apps/web/public/videos/` |
| mp4 数量 | **5** |
| 总大小 | **4.2 MB** |

文件清单（均被 git 跟踪）：

| 文件 | 大小 | 类型 |
|---|---|---|
| `albert-einstein.mp4` | 1.07 MB | 人物 |
| `elon-musk.mp4` | 0.80 MB | 人物 |
| `li-bai.mp4` | 1.78 MB | 人物 |
| `court-opening.mp4` | 0.26 MB | 场景（开庭） |
| `plaza-overview.mp4` | 0.42 MB | 场景（广场） |

**与其他分支对比（重要差异）：**

| 分支 | mp4 数量 | HEAD |
|---|---|---|
| `feat/talkshow-bar-player-driven`（当前） | **5** | 1f855e0 |
| `add-celeb-videos` | 5 | — |
| `main` | **102** | 1a5a41d |

> 即：102 个百位人物 mp4 在 `main` 上，**当前开发分支尚未合入**。后续若要在本分支做视频接入，需先 `git merge main`（或挑选 videos 目录）把 102 个资产拉过来，否则所有人物视频都会 404。

### 2.2 人物数据模型 vs 视频

`packages/shared/src/celebrities.ts` 当前定义 **20 位预置名人**（main 上同样是 20 位）。逐个核对视频是否存在：

| 名人 id | 是否有视频（当前分支） |
|---|---|
| elon-musk | ✅ 有 |
| albert-einstein | ✅ 有 |
| li-bai | ✅ 有 |
| steve-jobs | ❌ 无 |
| alan-turing | ❌ 无 |
| warren-buffett | ❌ 无 |
| isaac-newton | ❌ 无 |
| nikola-tesla | ❌ 无 |
| marie-curie | ❌ 无 |
| su-shi | ❌ 无 |
| lu-xun | ❌ 无 |
| zhuge-liang | ❌ 无 |
| shakespeare | ❌ 无 |
| leonardo | ❌ 无 |
| van-gogh | ❌ 无 |
| confucius | ❌ 无 |
| socrates | ❌ 无 |
| laozi | ❌ 无 |
| nietzsche | ❌ 无 |
| maoxuan-scholar | ❌ 无 |

**结论：20 位名人中仅 3 位（15%）有视频，17 位无视频。**

而 main 上的 102 个 mp4 里包含 abraham-lincoln、adam-smith、alexander-bell、archimedes、aristotle、bai-juyi、cai-yuanpei、cao-cao、charlemagne、charles-darwin、chen-duxiu、copernicus、dante、deng-jiaxian、donatello……等约 82 人，**这些 id 根本不在当前 CELEBRITIES 名单里**。说明「百位人物」的视频资产先行、人物数据模型尚未扩编——这是后续要补的最大缺口。

### 2.3 视频播放逻辑逐处核查（具体到文件:行号）

#### (a) 人物馆详情弹窗 —— **唯一真正可播人物视频的地方**
`apps/web/src/CharacterHall.tsx`：
- `:251-252` 注释与状态：`// ===== 人物视频（/videos/<id>.mp4 不存在时静默隐藏） =====`，`const [videoMissing, setVideoMissing] = useState(false)`
- `:416` 切换人物时重置：`useEffect(() => { setVideoMissing(false) }, [selected?.id])`
- `:734-753` 实际渲染：
  - `:734` `{!videoMissing && (`
  - `:736-751` `<video key={selected.id} src={\`/videos/${selected.id}.mp4\`} poster={selected.portrait} playsInline controls muted autoPlay loop onError={...} />`
  - `:745-750` `onError`：先 `load()` 重试一次，仍失败则 `setVideoMissing(true)` 静默隐藏。

**行为**：点击任意人物 → 详情弹窗左栏自动循环播放该人物视频；视频不存在则整段 video 静默隐藏（不报错、不占位）。**所以当前分支上，只有点 elon-musk / albert-einstein / li-bai 三人才看得到视频，其余 17 人弹窗里没有视频区。**

#### (b) 3D 人物长廊 CharacterGallery3D —— **无视频**
`apps/web/src/CharacterGallery3D.tsx`：grep `video` / `.mp4` **零命中**。3D 长廊里人物是 3D 模型，不播视频；视频只在点进去后的 2D 详情弹窗里出现。

#### (c) 法庭 UI —— **完全无人物视频**
- `apps/web/src/CourtroomShell.tsx`：grep `video` / `.mp4` **零命中**
- `apps/web/src/CourtroomView.tsx`：**零命中**
- `apps/web/src/court/` 整个目录（CourtFlow / CourtroomBackdrop / http-engine / screens/ 等）：**零命中**

**结论**：法庭里原告/被告/辩护人即便由名人扮演，也只跑文字 + TTS 语音，**没有任何人物视频画面**。

#### (d) 入口大厅 RoomEntry —— 仅场景缩略预览，非人物视频
`apps/web/src/RoomEntry.tsx:389-390`：
```tsx
{['/videos/court-opening.mp4', '/videos/plaza-overview.mp4'].map((src) => (
  <video key={src} src={src} autoPlay muted loop playsInline
    style={{ width: 150, height: 84, objectFit: 'cover', ... }} />
))}
```
这两个是入口大厅里的小缩略图（150×84），不是人物视频，也不在法庭/广场场景内播放。

#### (e) 视频工坊 VideoStudio —— 业务后台，非人物馆
`apps/web/src/VideoStudio.tsx:156,169` 播放 `activeVideo.videoUrl` / `item.videoUrl`，是用户上传内容的管理界面，与百位名人自动绑定无关。

### 2.4 TTS 音色映射与人物视频的关联（气质音色联动）

- `apps/web/src/tts.ts`：通用播放函数 `playTts(text, voice?)`，POST `/api/tts`，单例 Audio。**本身不含任何人物→视频的耦合**。
- 音色解析集中在 `packages/shared/src/character-voices.ts`：
  - `:20-29` `COURT_ROLE_VOICES`：法庭固定角色（judge/plaintiff/defendant/defender/witness/juror…）→ 预置音色。
  - `:107-123` `resolveCharacterVoice(ref, explicitVoice?)`：解析顺序 = 显式合法音色 → custom- 兜底 → 法庭角色表 → **预置名人 `getCelebrity(ref).voice`** → 默认 `jingdiannvsheng`。
  - 每位名人在 `celebrities.ts` 里都有 `voice` 字段（如 elon-musk→`zixinnansheng`、li-bai→`yuanqinansheng`、marie-curie→`zhixingjiejie`），这就是「气质音色联动」。
- 前端调用点：`CharacterHall.tsx:463 / :613 / :920` 都用 `resolveCharacterVoice(character.id, character.voice)` 拿音色再 `playTts`。

**关键判断**：音色和视频**都以人物 `id` 为 key**（音色走 `celebrity.voice`，视频走 `/videos/<id>.mp4`），但**代码层面没有任何「有视频就播视频、同时用对应音色」的联动逻辑**——两者是平行的，谁也不触发谁。法庭里即便给原告配了 `zixinnansheng` 音色，也不会去加载 `/videos/elon-musk.mp4`。

### 2.5 视频接入现状矩阵

| 场景 / UI | 文件 | 是否播人物视频 | 现状 |
|---|---|---|---|
| 人物馆详情弹窗 | `CharacterHall.tsx:736` | ✅ **是** | 按 `/videos/<id>.mp4` 自动播放，缺失静默隐藏；当前仅 3/20 人物有片 |
| 人物馆 3D 长廊 | `CharacterGallery3D.tsx` | ❌ 否 | 纯 3D 模型，无 `<video>` |
| 法庭 Shell | `CourtroomShell.tsx` | ❌ 否 | 零视频引用 |
| 法庭视图 | `CourtroomView.tsx` / `court/` | ❌ 否 | 零视频引用 |
| 脱口秀剧场 | `TalkshowShell.tsx` / `TalkshowView.tsx` | ❌ 否 | 无人物视频 |
| 狼人杀馆 | `WerewolfShell.tsx` / `WerewolfView.tsx` | ❌ 否 | 无人物视频 |
| 酒吧辩论 | `BarShell.tsx` / `BarView.tsx` | ❌ 否 | 无人物视频 |
| 图书馆 | `LibraryShell.tsx` / `LibraryView.tsx` | ❌ 否 | 无人物视频 |
| 健身房 | `GymShell.tsx` / `GymView.tsx` | ❌ 否 | 无人物视频 |
| 广场 3D | `Plaza3D.tsx` | ❌ 否 | 仅 3D 建筑，无视频 |
| 入口大厅 | `RoomEntry.tsx:389` | ⚠️ 仅场景缩略 | court-opening / plaza-overview 作 150×84 预览图 |
| 视频工坊 | `VideoStudio.tsx:156,169` | ⚠️ 用户内容 | 管理用户上传视频，非名人绑定 |

### 2.6 视频接入缺口（后续开发清单）

1. **资产缺口**：当前分支缺 main 上的 97 个 mp4；且 main 的 102 个里约 82 人不在 CELEBRITIES 名单——需要先扩编 `celebrities.ts` 到百位，或明确只做这 20 人。
2. **人物馆覆盖缺口**：20 人中 17 人点进去无视频（静默隐藏），体验上是「人物卡存在但没片」。
3. **法庭缺口（最大产品缺口）**：法庭里名人当原告/被告/辩护人时，只有文字气泡 + TTS 音色，**没有人物视频口型/画面**。`court/` 目录需新增视频层。
4. **3D 长廊缺口**：`CharacterGallery3D` 走过人物时无视频，视频只在弹窗里。
5. **音色↔视频无联动**：`resolveCharacterVoice` 与 `/videos/<id>.mp4` 平行，没有统一的「人物媒体包（voice + video）」解析层。
6. **场景视频闲置**：`court-opening.mp4` / `plaza-overview.mp4` 只在入口当缩略图，未在法庭/广场场景内播放。

---

## 3. 构建与部署现状

### 3.1 Web 构建结果

命令：`cd apps/web && npm run build`（脚本 = `tsc -b && vite build`）

**结果：❌ 失败，退出码 1。** 输出尾部：
```
src/CourtTrialPanel.tsx(5,7): error TS2741 ...
src/court/http-engine.ts(97,5): error TS2322 ...
npm error Lifecycle script `build` failed with error:
npm error command sh -c tsc -b && vite build
```
`tsc -b` 在第一步就挂了，`vite build` 未执行。**即当前分支打不出生产包。** 修复见 §1.1。

API 构建（`npm run build` = `tsc`）未单独跑，但 `tsc --noEmit` 0 错误，预期可过。

### 3.2 部署工具可用性

| 工具/配置 | 是否存在 | 说明 |
|---|---|---|
| Dockerfile | ❌ 无 | 全仓库 find 无任何 Dockerfile |
| docker-compose | ❌ 无 | — |
| cloudflared 配置 | ❌ 无 | 无 `.cloudflared*` / config.yml |
| 部署脚本（scripts/deploy*） | ❌ 无 | `scripts/` 下只有 `celebrities-3d.mts`、`gen-default-skills.ts`（工具脚本，非部署） |
| CI（GitHub Actions） | ✅ 有 | `.github/workflows/ci.yml` |

**CI 内容（`ci.yml`）**：push/PR 到 `main` 时，Ubuntu + Node 22 → `npm ci` → `npm test` → `npm run build`。**注意**：在当前分支上 `npm run build` 会失败（§3.1），所以一旦本分支合入 main，CI 会变红，需先修 tsc 错误。

### 3.3 包管理器与 scripts

> ⚠️ 与任务提示「包管理 pnpm」**不符**：仓库实际用的是 **npm workspaces + package-lock.json**（仓库根无 `pnpm-lock.yaml`）。环境里虽装了 pnpm v11.7.0，但仓库锁定文件是 npm 的。**后续统一用 `npm`/`npx`，不要用 pnpm install，否则会与 lockfile 冲突。**

**根 `package.json`**（workspaces: `apps/*`, `packages/*`）：
```jsonc
"dev":  "concurrently -k -n api,web ... \"npm:dev:api\" \"npm:dev:web\"",
"dev:web": "npm --workspace apps/web run dev",
"dev:api": "npm --workspace apps/api run dev",
"build": "npm run build --workspaces",
"test": "npm run test --workspace apps/api && npm run test --workspace apps/web"
```

**`apps/web/package.json` scripts**：`dev`(vite --host) / `build`(tsc -b && vite build) / `test`(vitest run)
**`apps/api/package.json` scripts**：`dev`(tsx watch src/server.ts) / `build`(tsc) / `test`(vitest run)

服务端口（与提示一致）：Web 5173，API 8787（`/api/health`）。

---

## 4. 场景路由与入口

### 4.1 路由结构

路由是**状态驱动**（`useState<View>`），仅 `/share/:id` 和 `?room=court:<caseId>`、`?plaza=1` 走 URL。定义在 `apps/web/src/App.tsx`：
- `View` 联合类型：`entry | court | characters | custom-studio | plaza | talkshow | werewolf | bar | library | gym | scene-studio | my-scenes | scene-play | mypage | video | avatar | archive`（`:29`）。
- 默认视图 `:59-63`：`?room=court:` → court；`?plaza=1` → plaza；否则 **entry（RoomEntry 入口大厅）**。

### 4.2 开屏 → 广场 → 场景完整路径

1. **开屏** `apps/web/src/main.tsx`：
   - `:86` `<App />` 下层常驻，上层叠 `<SplashScreen onDone={...} />`。
   - `SplashScreen.tsx`：点击任意处 / 空格回车 → 逐字淡出 → `onDone` 卸载开屏（`:33-50`）。
   - `/share/` 路径跳过开屏（`main.tsx:14 SKIP_SPLASH`）。
2. **开屏露出的是 RoomEntry（入口大厅），不是广场本身**。`App.tsx:125-142`：`view==='entry'` 渲染 `<RoomEntry onPlaza={...} onEnterCourt/onEnterTalkshow/... />`。
3. **入口大厅 → 广场**：`RoomEntry.tsx:329` `case 'plaza': onPlaza?.()` → `App.tsx:132` `setView('plaza')`。
4. **广场 → 6 场景**：`Plaza3D.tsx:13-18` 定义 6 栋建筑（court/talkshow/werewolf/bar/gym/library），`:173-178` 点击分发到对应 `onEnter*`；`App.tsx:194-203` 给 Plaza3D 传入了全部 6 个真实回调。

### 4.3 6 场景可进入性核对

| 场景 | Plaza3D 建筑 id | App 传入回调 | 入口大厅直达 | 状态 |
|---|---|---|---|---|
| 法庭 court | `court` (`:13`) | ✅ `onEnterCourt` | ✅ `RoomEntry.onEnter` | 可进 |
| 脱口秀 talkshow | `talkshow` (`:14`) | ✅ `onEnterTalkshow` | ✅ | 可进 |
| 狼人杀 werewolf | `werewolf` (`:15`) | ✅ `onEnterWerewolf` | ✅ | 可进 |
| 酒吧 bar | `bar` (`:16`) | ✅ `onEnterBar` | ✅ | 可进 |
| 健身房 gym | `gym` (`:17`) | ✅ `onEnterGym` | ✅ | 可进 |
| 图书馆 library | `library` (`:18`) | ✅ `onEnterLibrary` | ✅ | 可进 |

**结论：6 个场景都能从广场进入，也都能从入口大厅直达，路由完整闭环。**
> 备注：`Plaza3D.tsx:373-375` 对 talkshow/werewolf/bar 等留了 `?? (() => toast('即将开放'))` 的兜底，但 `App.tsx` 实际都传了真回调，故线上不会出现「即将开放」toast。

---

## 5. 基线一览（后续 20 轮起点）

| 维度 | 状态 | 数值 / 位置 |
|---|---|---|
| 分支 / HEAD | `feat/talkshow-bar-player-driven` / `1f855e0` | — |
| API tsc 错误 | 🟢 0 | — |
| Web tsc 错误 | 🔴 **2** | `CourtTrialPanel.tsx:5`、`court/http-engine.ts:97` |
| API 测试 | 🟢 217 passed / 0 failed | 18 文件 |
| Web 测试 | 🟢 108 passed / 0 failed | 7 文件 |
| Web 生产构建 | 🔴 **失败** | `tsc -b` 被 2 个错误阻断，vite build 未跑 |
| 人物视频（当前分支） | 🟡 5 个 / 4.2MB | 人物仅 einstein/musk/li-bai 3 人 |
| 人物视频（main 可合并） | 🟡 102 个 | main@1a5a41d，约 82 人不在 CELEBRITIES |
| 预置名人数据 | 🟡 20 人 | `packages/shared/src/celebrities.ts` |
| 人物馆视频播放 | 🟢 可播（详情弹窗） | `CharacterHall.tsx:736`，缺失静默降级 |
| 法庭视频播放 | 🔴 无 | CourtroomShell/View/court 零引用 |
| 3D 长廊视频 | 🔴 无 | CharacterGallery3D |
| TTS 音色联动 | 🟢 有（按 id） | `shared/character-voices.ts:resolveCharacterVoice`；与视频无代码耦合 |
| Dockerfile / cloudflared / 部署脚本 | 🔴 无 | 仅 `.github/workflows/ci.yml` |
| CI | 🟡 存在 | main 上跑 test+build；本分支 build 会红 |
| 包管理器 | ⚠️ npm（非 pnpm） | lockfile = package-lock.json |
| 开屏→广场→6 场景路由 | 🟢 完整 | Splash→RoomEntry→Plaza3D→6 场景全通 |

### 建议的下一步优先级
1. **先修 2 个 tsc 错误**（补 `player` 到 `CourtRoleType` 与 `CourtTrialPanel` 角色表），解锁 `npm run build` 与 CI——这是阻断一切部署的硬前置。
2. **把 main 的 102 个视频资产合并进分支**，并决策：是把 CELEBRITIES 扩编到百位，还是只做精选 20 人。
3. **法庭接入人物视频层**（最大产品缺口），并在 shared 层做统一的「人物媒体包（voice+video by id）」解析。
