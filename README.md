# 叽里呱啦 · BalaBala 社交世界

把生活里的小小争议，变成一场温柔又好玩的趣味庭审。平台包含趣味法庭、脱口秀剧场、狼人杀馆、酒吧辩论、健身房、图书馆六大互动场景，支持名人合议庭、3D 广场、实时多人联机与数据持久化。

## 场景玩法（M9–M11）

### 🎤 脱口秀剧场
- 上台讲段子（文字输入，可选 TTS 朗读），AI 虚拟观众实时打分（0-100）并给出反应（笑声/鼓掌/起哄/冷场/欢呼）和评论
- 名人 open-mic：选择一位名人，用其 persona 现场讲 2-3 个短段子
- AI 帮写：输入主题和风格，AI 生成可直接讲的脱口秀文本
- 精彩片段一键发布到广场
- 多人房间：其他用户当观众，表演和反应实时同步

### 🍺 酒吧辩论
- 围绕轻松话题（内置 12 个话题库，支持自定义）与名人围坐对辩
- AI 自动推荐正反方辩手（各 1-2 位名人），名人按 persona + 立场发言并产出金句
- 用户可加入正方或反方发言，投票评「更有趣的一方」
- 酒保总结：不站队，提炼双方共识和最有趣的金句
- 金句/共识一键发布到广场

### 📚 图书馆
- 名人读书会：名人按领域推荐著作，开场介绍并抛出讨论问题，可继续追问
- 深度问答：与名人多轮对话（回复 200-400 字，支持展开论述），每条回答可发布金句
- AI 馆员：按主题（15 个知识主题）回答知识性问题，可发布笔记
- 安静氛围，多人一起参加读书会，提问实时同步

### 🐺 狼人杀馆
- 9 人局标准版型：3 狼人 + 1 预言家 + 1 女巫 + 1 猎人 + 3 村民
- 真人不足时由 AI 名人补位（马斯克、诸葛亮、莎士比亚等按 persona 参与）
- 完整回合制状态机：夜晚（狼人刀人 → 预言家查验 → 女巫用药）→ 白天（公布死亡 → 依次发言 → 投票放逐）→ 循环，直到分出胜负
- 猎人死亡可开枪带走一人；女巫拥有解药和毒药各一瓶
- **信息严格保密**：服务端按玩家视角单独下发快照，每人只能看到自己的身份牌和夜晚结果；狼人见队友与刀法，预言家只见查验，女巫只见自己的药水与被刀者；其他玩家身份与夜晚私密行动绝不广播
- AI 玩家夜晚决策（刀/查验/用药）、白天发言（好人找狼、狼人伪装）、投票均由 LLM 生成，输出结构化 JSON，解析失败自动规则兜底
- 每阶段设超时，真人未行动自动随机或弃权推进，游戏不卡死
- 对局结束公布胜负与全员身份，一键发布「狼人杀战报」到广场（版型/身份/存活/胜负/复盘）
- 断线重连后按该玩家视角补发当前局面快照

### 🏋️ 健身房（M11）
- **AI 健身教练**：选择训练目标（增肌/减脂/拉伸/耐力/力量）+ 水平 + 时长，一键生成结构化训练计划（动作、组数、次数、休息、动作要领、安全提示），逐项完成打卡，计划进度实时追踪
- **器械互动**：3D 场景内 6 件可点击器械（跑步机、哑铃架、杠铃卧推凳、瑜伽垫、划船机、动感单车），点击弹出动作要领，开始一组走倒计时/计数小动画，完成自动打卡
- **名人教练/挑战**：选择自律榜样名人（马斯克、乔布斯、图灵等），以其 persona 风格带练打气、产运动金句，支持 TTS 朗读；名人挑战模式设定小目标完成打卡
- **多人云健身**：WebSocket 房间 `gym:lobby` 实时同步在线人数、他人化身位置与活动状态，可互相加油（飘字消息），他人打卡实时通知
- **训练记录与成就**：打卡记录入 SQLite，自动计算连续天数 streak、最长连续、累计次数/分钟；10 枚成就徽章（首次打卡、连续3/7/30天、累计10/50/100次、增肌达人/有氧之王/柔韧大师），达成自动解锁；「我的」页面展示健身统计与徽章
- 打卡与成就可一键发布到广场（`gym_checkin` 内容类型），广场卡片展示动作、组数次数、连续天数与金句

> **未来扩展**：基于摄像头的实时姿态识别（如 MediaPipe / BlazePose），用于动作计数与姿态纠正——当前版本暂不实现，列为后续迭代方向。

## 本地启动

在项目根目录复制 `.env.example` 为 `.env`，填入服务端密钥（STEPFUN、EVOMAP、TRIPO）。密钥只给 API 服务使用，不会进入前端 bundle。

```powershell
npm install
npm run dev          # 同时启动 API (8787) + Web (5173)
# 或分别启动：
npm run dev:api      # Fastify API: http://localhost:8787
npm run dev:web      # Vite Web: http://localhost:5173
```

构建：

```powershell
npm run build        # 全量构建（shared + api + web）
```

测试：

```powershell
npm test             # 运行后端 Vitest 测试（狼人杀状态机 / 合议庭编排 / db CRUD / WS 广播过滤）
```

## 自动化测试（M10）

后端核心纯逻辑使用 **Vitest** 覆盖，共 69 个用例，全部 mock 外部服务（LLM / Tripo），零网络依赖、确定性通过：

| 测试文件 | 用例数 | 覆盖范围 |
|---|---|---|
| `werewolf-orchestrator.test.ts` | 20 | 阶段推进、胜负判定、视角过滤、信息隔离、AI 补位、战报 |
| `db.test.ts` | 17 | 案件/内容/评论/反应去重/用户/证书/消息/场景记录 DAO + 重启持久化 |
| `bench-orchestrator.test.ts` | 9 | 合议庭流程事件序列、投票统计、互动消费、非法 JSON 兜底 |
| `ws.test.ts` | 8 | 房间广播隔离、私密单发、场景房间状态、scene_event 广播 |
| `gym-orchestrator.test.ts` | 15 | 训练计划生成、streak 连续天数计算（含跨月/断档）、成就解锁判定（器械分类/累计阈值） |

测试使用临时 SQLite 文件（`process.env.DB_PATH` 覆盖），每个测试文件独立数据库，`afterAll` 清理。GitHub Actions 在 push/PR 时自动运行 `npm test` + `npm run build`。

## 数据持久化（M7）

所有业务数据使用 SQLite（Node 22 内置 `node:sqlite`，零原生依赖）持久化，数据库文件位于 `apps/api/.data/app.db`（已 gitignore）。重启 API 不丢数据。

持久化内容包括：
- 用户身份（昵称、化身）
- 案件与判决书
- 合议庭完整发言记录
- 广场内容、评论、点赞/反对
- 证书、消息
- 场景交互记录（脱口秀表演、酒吧发言、图书馆问答）
- 狼人杀对局记录与战报
- 健身训练计划、打卡记录、连续天数 streak、成就徽章

首次启动自动填充广场演示内容。

## 用户身份（M7）

首次进入应用时，设置昵称并选择化身（胶囊 / 名人 / 自定义），系统颁发稳定 `userId` 存入 localStorage。发布、发言、站队、证书、消息均归属该身份。

- 轻量匿名身份，无需密码
- 跨刷新、跨设备（同一 userId）数据一致
- 「我的」页面展示参与的庭审、发布的内容、证书墙、消息通知

## 实时多人（M7）

基于 `@fastify/websocket` 的房间制实时联机：

### 广场
- 进入广场自动连接 `plaza` 房间
- 实时看到其他在线用户的化身（胶囊 + 名牌），位置 10Hz 节流同步 + 客户端插值
- 左上角显示在线人数
- 点击地面移动，位置实时同步给房间内其他人

### 法庭房间
- 启动合议庭后自动创建 `court:<caseId>` 房间
- 点击「邀请他人」复制房间链接（`/?room=court:<caseId>`）
- 他人通过链接进入后，实时看到合议庭辩论、发言、站队
- 房间内所有用户的发言和投票实时同步
- 断线自动重连，迟到加入者先收到当前状态快照

vite 已配置 `/api` 的 WebSocket 代理（`ws: true`）。

## 主要 API

### 身份
- `POST /api/users` — 创建或更新用户（`{ nickname, avatarType, avatarRef, userId? }`）
- `GET /api/users/:userId` — 获取用户资料

### 我的
- `GET /api/users/:userId/cases` — 我参与的案件
- `GET /api/users/:userId/contents` — 我发布的内容
- `GET /api/users/:userId/certificates` — 我的证书
- `POST /api/users/:userId/certificates` — 生成证书
- `GET /api/users/:userId/messages` — 消息列表
- `PUT /api/users/:userId/messages/:msgId/read` — 标记已读
- `PUT /api/users/:userId/messages/read-all` — 全部已读

### 案件与庭审
- `POST /api/cases` — 创建案件（可选 `userId`）
- `GET /api/cases/:id` — 获取案件
- `GET /api/archives` — 已判决案件列表
- `POST /api/cases/:id/bench/stream` — 多名人合议庭 SSE 流
- `POST /api/cases/:id/bench/interact` — 用户互动（发言/举证/站队/点名）
- `POST /api/cases/:id/share` — 生成分享链接
- `POST /api/cases/:id/publish` — 发布判决书到广场

### 广场
- `GET /api/contents` — 内容列表（支持 sort/scene/topic 筛选）
- `POST /api/contents` — 发布内容（可选 `userId`）
- `GET /api/contents/:id` — 内容详情
- `POST /api/contents/:id/react` — 点赞/反对（可选 `userId`，去重）
- `POST /api/contents/:id/comments` — 评论

### 脱口秀剧场
- `POST /api/talkshow/perform` — 上台表演，返回观众评分/反应/评论
- `POST /api/talkshow/celebrity` — 名人 open-mic 讲段子
- `POST /api/talkshow/ai-write` — AI 帮写段子
- `POST /api/talkshow/publish` — 发布精彩片段到广场

### 酒吧辩论
- `GET /api/bar/topics` — 话题库
- `POST /api/bar/start` — 开始辩论（AI 推荐正反方辩手）
- `POST /api/bar/speak` — 名人发言
- `POST /api/bar/user-speak` — 用户发言
- `POST /api/bar/summarize` — 酒保总结共识与金句
- `POST /api/bar/vote` — 投票评更有趣的一方
- `POST /api/bar/publish` — 发布金句到广场

### 图书馆
- `GET /api/library/topics` — 知识主题列表
- `POST /api/library/celebrity-chat` — 名人深度问答
- `POST /api/library/recommend` — 名人推荐著作
- `POST /api/library/book-club` — 开始名人读书会
- `POST /api/library/librarian` — AI 馆员答疑
- `POST /api/library/publish` — 发布笔记/金句到广场

### 狼人杀馆
- `POST /api/werewolf/create` — 创建房间（`{ userId }`）
- `POST /api/werewolf/:gameId/join` — 加入房间（`{ userId }`）
- `POST /api/werewolf/:gameId/start` — 房主开始游戏（`{ userId }`）
- `GET /api/werewolf/:gameId/state?userId=` — 获取该玩家视角快照（断线重连用）
- `POST /api/werewolf/:gameId/publish` — 发布战报到广场（游戏结束后）

### 健身房
- `POST /api/gym/plans` — 生成训练计划（`{ goal, level?, durationMinutes?, userId? }`）
- `GET /api/gym/plans?userId=` — 用户最近训练计划
- `POST /api/gym/checkins` — 打卡（自动重算 streak + 解锁成就），返回 `{ checkin, stats, newAchievements }`
- `GET /api/gym/checkins?userId=&limit=` — 打卡记录
- `GET /api/gym/stats/:userId` — 健身统计（连续天数/最长/累计次数/分钟）
- `GET /api/gym/achievements/:userId` — 成就徽章列表（含解锁状态）
- `POST /api/gym/celebrity-coach` — 名人风格健身教练对话（`{ celebrityId, message, goal? }`）
- `POST /api/gym/publish` — 发布打卡到广场（`gym_checkin` 类型）

### WebSocket
- `GET /api/ws?userId=<id>&room=plaza|court:<caseId>|talkshow:<id>|bar:<id>|library:<id>|werewolf:<gameId>|gym:lobby` — 实时连接
- 场景房间：脱口秀/酒吧/图书馆/健身房各使用 `talkshow:lobby` / `bar:lobby` / `library:lobby` / `gym:lobby`，通过场景专属事件广播（表演、发言、问答、打卡、加油等）
- 狼人杀房间：`werewolf:<gameId>`，客户端发送 `werewolf_action`（夜晚行动/发言/投票），服务端对每个玩家单独下发 `werewolf_snapshot`（含私密信息），对全员广播 `werewolf_event`（公开阶段/死亡/发言/投票/胜负）

### 其他
- `GET /health` — 服务健康与配置状态
- `POST /api/tripo/tasks` — Tripo 3D 模型生成
- `POST /api/tts` — StepFun TTS 语音合成
- `POST /api/ai/polish` — AI 帮写润色

## 模型路由

庭审生成使用统一的结构化 JSON 协议，按以下顺序调用：

1. StepFun：`https://api.stepfun.com/v1`
2. EvoMap：`https://api.evomap.ai/v1`
3. 本地兜底：外部模型不可用时仍能完成演示

切换模型只需修改 `.env`，不需要改庭审流程。

## 3D 场景

平台使用 Three.js + React Three Fiber 实时渲染。广场为 3D 可交互场景（点击地面移动、点击建筑进入），六个建筑环绕广场：趣味法庭、脱口秀剧场、狼人杀馆、酒吧辩论、健身房、图书馆。

室内场景均为程序化 3D 建模（三面布景 + 主题道具），延续 Q 版圆润 + 纯黑明黄视觉语言：
- 趣味法庭：写实法庭 + 多席位合议庭
- 脱口秀剧场：舞台 + 麦克风 + 观众席 + 聚光灯
- 狼人杀馆：夜晚圆桌 + 9 号码位 + 昼夜光照切换 + 死亡标记 + 发言者高亮
- 酒吧辩论：吧台 + 酒瓶 + 圆桌 + 暖光氛围
- 健身房：明亮运动风 + 6 件可交互器械（跑步机/哑铃架/杠铃卧推凳/瑜伽垫/划船机/动感单车）+ 镜子墙 + 分区地面
- 图书馆：三面书架 + 阅览桌 + 台灯 + 安静氛围

## 移动端适配与 PWA（M10）

### 响应式设计
- 主断点 `768px`，超小屏补充 `380px`
- **顶部导航**：小屏改为底部固定 Tab 栏（56px），3 个主项等宽分布，当前页明黄高亮，适配 iPhone 底部安全区
- **场景控制面板**：小屏改为底部抽屉 / 全屏面板，可展开收起
- **入口大厅 / 广场卡片 / 案卷库 / 我的页**：小屏网格降列（4→2→1），搜索框全宽
- 全局触控热区 ≥44×44px

### 3D 触屏操作
- 广场支持**点地面移动**、**点建筑/名人进入**
- tap / drag 智能区分（位移 <10px 且时长 <400ms 才算 tap），避免旋转视角时误触发点击
- 桌面端鼠标操作不受影响

### PWA（vite-plugin-pwa）
- 可安装到桌面 / 主屏幕，独立窗口运行（`display: standalone`）
- 离线壳：HTML / JS / CSS / 图片缓存，断网仍可打开应用
- 3D 大模型（`.glb`）使用 NetworkOnly，不进强缓存，避免占用存储
- 主题色纯黑 `#000000` + 明黄 `#FFD600`，图标使用产品 logo
- Service Worker 自动更新（`autoUpdate`）

## 健壮性（M10）

### Error Boundary
- 根级 + 每个懒加载场景 + 3D 场景内部三层 ErrorBoundary
- 3D / GPU 崩溃时显示友好回退 + 「重新加载」按钮
- 懒加载 chunk 失败可点击重试
- Suspense fallback 统一为明黄 spinner + 「加载中…」

### 全局错误兜底
- `window.onerror` + `unhandledrejection` 捕获未捕获异常，显示用户友好提示（不暴露技术栈），原始错误仍输出 console

### WebSocket 断线重连
- 合议庭 / 狼人杀房间使用指数退避重连（1s → 2s → 4s → … → 30s 封顶）
- 重连期间明黄顶栏提示「连接中断，正在重连…（第 N 次）」，重连成功自动拉取当前状态快照

### 内存管理
- 每个 3D 场景 unmount 时 dispose 几何体 / 材质 / 纹理，并清除 drei `useGLTF` 模型缓存
- 共享环境资源（Environment / Lightformer 贴图）不受影响
- 多场景切换无明显内存累积

### 首屏性能
- 入口页（RoomEntry）不含 3D 代码，three / r3f 拆为独立 chunk（分别 ~688KB / ~552KB），进入 3D 场景才按需加载
- 入口 chunk 仅 ~122KB（gzip ~45KB）

## 项目结构

```
apps/
  api/          # Fastify 后端（SQLite + WebSocket + LLM 编排）
    src/
      db.ts           # SQLite 持久化层
      ws.ts           # WebSocket 房间管理
      server.ts       # 路由与服务入口
      storage.ts      # 案件存储（委托 db.ts）
      content-storage.ts  # 广场内容存储（委托 db.ts）
      bench-orchestrator.ts  # 多名人合议庭编排
      talkshow-orchestrator.ts  # 脱口秀 AI 编排
      talkshow-routes.ts  # 脱口秀路由
      bar-orchestrator.ts  # 酒吧辩论 AI 编排
      bar-routes.ts   # 酒吧辩论路由
      library-orchestrator.ts  # 图书馆 AI 编排
      library-routes.ts  # 图书馆路由
      werewolf-orchestrator.ts  # 狼人杀状态机 + AI 玩家 + 视角过滤
      werewolf-routes.ts  # 狼人杀路由
      gym-orchestrator.ts  # 健身房纯逻辑（计划生成/streak计算/成就判定）
      gym-routes.ts  # 健身房路由
      tripo.ts        # Tripo 3D API 封装
  web/          # Vite + React 18 + R3F 前端
    src/
      identity.tsx    # 用户身份 Provider
      App.tsx         # 应用入口与路由
      CourtroomShell.tsx  # 合议庭状态机 + 多人联机
      CourtroomView.tsx   # 法庭 3D 场景
      TalkshowShell.tsx   # 脱口秀 UI 壳 + 多人
      TalkshowView.tsx    # 脱口秀 3D 场景
      BarShell.tsx        # 酒吧辩论 UI 壳 + 多人
      BarView.tsx         # 酒吧 3D 场景
      LibraryShell.tsx    # 图书馆 UI 壳 + 多人
      LibraryView.tsx     # 图书馆 3D 场景
      WerewolfShell.tsx   # 狼人杀 UI 壳 + 游戏状态 + 多人
      WerewolfView.tsx    # 狼人杀 3D 圆桌场景
      GymShell.tsx        # 健身房 UI 壳 + AI教练/器械/名人/多人/记录 + WS
      GymView.tsx         # 健身房 3D 场景（6 件可交互器械）
      Plaza3D.tsx     # 3D 广场 + presence
      RoomEntry.tsx   # 场景入口大厅
      MyPage.tsx      # 我的页面
packages/
  shared/       # 共享类型与名人数据
```

## 技术栈

- **后端**：Fastify 5 + node:sqlite + @fastify/websocket + undici
- **前端**：Vite 5 + React 18 + React Three Fiber + drei + three + vite-plugin-pwa
- **测试**：Vitest（后端核心逻辑，69 用例）
- **共享**：TypeScript 类型 + 名人数据
- **CI**：GitHub Actions（push/PR 自动跑 test + build）
- **AI**：StepFun / EvoMap（庭审生成、名人对话、润色）、Tripo（3D 模型）、StepFun TTS
