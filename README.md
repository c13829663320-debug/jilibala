# 叽里呱啦 · BalaBala 趣味法庭

把生活里的小小争议，变成一场温柔又好玩的趣味庭审。支持名人合议庭、3D 广场、实时多人联机与数据持久化。

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

## 数据持久化（M7）

所有业务数据使用 SQLite（Node 22 内置 `node:sqlite`，零原生依赖）持久化，数据库文件位于 `apps/api/.data/app.db`（已 gitignore）。重启 API 不丢数据。

持久化内容包括：
- 用户身份（昵称、化身）
- 案件与判决书
- 合议庭完整发言记录
- 广场内容、评论、点赞/反对
- 证书、消息

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

### WebSocket
- `GET /api/ws?userId=<id>&room=plaza|court:<caseId>` — 实时连接

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

平台入口和趣味法庭使用 Three.js + React Three Fiber 实时渲染。广场为 3D 可交互场景（点击地面移动、点击建筑进入），法庭为多席位 3D 场景。

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
      tripo.ts        # Tripo 3D API 封装
  web/          # Vite + React 18 + R3F 前端
    src/
      identity.tsx    # 用户身份 Provider
      App.tsx         # 应用入口与路由
      CourtroomShell.tsx  # 合议庭状态机 + 多人联机
      Plaza3D.tsx     # 3D 广场 + presence
      MyPage.tsx      # 我的页面
packages/
  shared/       # 共享类型与名人数据
```

## 技术栈

- **后端**：Fastify 5 + node:sqlite + @fastify/websocket + undici
- **前端**：Vite 5 + React 18 + React Three Fiber + drei + three
- **共享**：TypeScript 类型 + 名人数据
- **AI**：StepFun / EvoMap（庭审生成、名人对话、润色）、Tripo（3D 模型）、StepFun TTS
