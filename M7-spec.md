# M7 技术规格：持久化身份 + 实时多人

## 一、数据库（SQLite，node:sqlite）

文件：`apps/api/src/db.ts`，数据库文件 `apps/api/.data/app.db`（gitignore）。

使用 `import { DatabaseSync } from 'node:sqlite'`（Node 22.23 内置，实验性警告可忽略）。
若类型缺失，用 `declare module 'node:sqlite'` 兜底；若运行受阻，回退 better-sqlite3（v22 有 prebuilt）。

### 表结构

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '我',
  avatar_type TEXT NOT NULL DEFAULT 'capsule',  -- capsule | celebrity | custom
  avatar_ref TEXT DEFAULT '',                    -- celebrity id 或 model url
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT '',
  input TEXT NOT NULL,
  verdict TEXT DEFAULT '',          -- JSON
  share_token TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT DEFAULT '',
  bench_members TEXT DEFAULT '',    -- JSON
  bench_transcript TEXT DEFAULT '', -- JSON
  bench_votes TEXT DEFAULT '',      -- JSON
  perspective TEXT DEFAULT 'audience'
);

CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT '',
  type TEXT NOT NULL,               -- text | closed_court
  scene TEXT NOT NULL DEFAULT 'all',
  author TEXT NOT NULL DEFAULT '我',
  created_at TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '[]',-- JSON
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  case_id TEXT DEFAULT '',
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  court TEXT DEFAULT ''             -- JSON
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  user_id TEXT DEFAULT '',
  author TEXT NOT NULL DEFAULT '我',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  reaction TEXT NOT NULL,           -- like | dislike
  created_at TEXT NOT NULL,
  UNIQUE(content_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_title TEXT NOT NULL,
  verdict TEXT NOT NULL,
  charge TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- court | comment | cert | system
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id);
CREATE INDEX IF NOT EXISTS idx_contents_user ON contents(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
CREATE INDEX IF NOT EXISTS idx_certs_user ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
```

### 种子数据
首次启动（contents 表为空）时，将 content-storage.ts 的 makeSeedContents() 写入数据库。
种子内容的 user_id 设为空字符串（匿名），author 字段保留原值。

### db.ts 导出
```ts
export const db: DatabaseSync;
export function initDb(): void;          // 建表 + 种子
// 案件 DAO
export function getAllCases(): StoredCase[];
export function getCase(id: string): StoredCase | undefined;
export function upsertCase(c: StoredCase & { userId?: string }): void;
export function deleteCase(id: string): void;
export function getCasesByUser(userId: string): StoredCase[];
// 内容 DAO
export function getAllContents(): PlazaContent[];
export function getContent(id: string): PlazaContent | undefined;
export function upsertContent(c: PlazaContent & { userId?: string }): void;
export function getContentsByUser(userId: string): PlazaContent[];
// 评论
export function getComments(contentId: string): ContentComment[];
export function addComment(contentId: string, comment: ContentComment & { userId?: string }): void;
// 反应
export function addReaction(contentId: string, userId: string, reaction: 'like'|'dislike'): { likes: number; dislikes: number };
// 用户
export function getUser(id: string): User | undefined;
export function upsertUser(u: User): void;
// 证书
export function getCertificates(userId: string): CertRecord[];
export function addCertificate(cert: CertRecord): void;
// 消息
export function getMessages(userId: string): MsgRecord[];
export function addMessage(msg: MsgRecord): void;
export function markMessageRead(userId: string, msgId: string): void;
export function markAllMessagesRead(userId: string): void;
```

JSON 字段（verdict, bench_members, bench_transcript, bench_votes, topics, court）读写时用 JSON.stringify / JSON.parse。

## 二、REST API 变更

### 新增：身份
- `POST /api/users` — body: `{ nickname?, avatarType?, avatarRef? }`。若不传 id 则创建新用户（randomUUID），返回 `{ userId, nickname, avatarType, avatarRef, createdAt }`。若 body 含 userId 则更新该用户资料。
- `GET /api/users/:userId` — 返回用户资料，不存在返回 404。

### 新增：我的页面数据
- `GET /api/users/:userId/cases` — 返回该用户创建的案件列表（含 verdict）。
- `GET /api/users/:userId/contents` — 返回该用户发布的广场内容。
- `GET /api/users/:userId/certificates` — 返回证书列表。
- `POST /api/users/:userId/certificates` — body: `{ caseId, caseTitle, verdict, charge? }`，创建证书并返回。
- `GET /api/users/:userId/messages` — 返回消息列表（按时间倒序）。
- `PUT /api/users/:userId/messages/:msgId/read` — 标记已读。
- `PUT /api/users/:userId/messages/read-all` — 全部已读。
- `POST /api/users/:userId/messages` — body: `{ kind, title, summary }`，添加消息（前端也可调用，主要供内部使用）。

### 修改：现有端点增加 userId（向后兼容，不传则匿名）
- `POST /api/cases` — body 增加 `userId?`，案件归属该用户。
- `POST /api/contents` — body 增加 `userId?`，同时 author 从用户资料取（若有 userId）。
- `POST /api/cases/:id/publish` — body 增加 `userId?`，发布内容归属该用户。
- `POST /api/contents/:id/react` — body 增加 `userId?`，用 reactions 表去重（同一用户对同一内容只能 like 一次、dislike 一次）。
- `POST /api/contents/:id/comments` — body 增加 `userId?`，评论归属该用户。

### 不变的端点
- `/api/archives`、`/api/cases/:id`、`/api/cases/:id/share`、`/api/shares/:shareId`、`/api/cases/:id/bench/stream`、`/api/cases/:id/bench/interact`、`/api/contents`（列表）、`/api/contents/:id`、`/api/topics`、Tripo/TTS/AI 相关端点均保持现有契约。

### storage.ts / content-storage.ts
保留文件但内部改为调用 db.ts 的 DAO（loadCases/saveCases/loadContents/saveContents 签名不变），使 server.ts 改动最小化。saveCases 遍历 upsertCase，saveContents 遍历 upsertContent（先清空再插入，或按 id upsert）。

## 三、WebSocket 实时多人

文件：`apps/api/src/ws.ts`，在 server.ts 中 `await app.register(import('@fastify/websocket'))`。
安装依赖：`@fastify/websocket`。

### 连接
路径：`/api/ws`，query 参数：`userId`（必填）、`room`（必填，格式 `plaza` 或 `court:<caseId>`）。
vite 代理需配置 `ws: true`。

### 房间管理（内存）
```ts
type RoomUser = {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  x: number; z: number; rotation: number;
  lastMove: number;  // timestamp
  socket: WebSocket;
};
type Room = {
  id: string;
  users: Map<string, RoomUser>;
  courtState?: {     // 仅 court 房间
    caseId: string;
    phase: 'config' | 'streaming' | 'verdict';
    members: BenchMember[];
    speeches: BenchSpeech[];
    currentStage: BenchStage;
    votes: { plaintiff: number; defendant: number };
    verdict?: Verdict;
  };
};
const rooms = new Map<string, Room>();
```

### 服务端 → 客户端消息
```ts
// 连接成功，发送当前房间快照
{ type: 'welcome', roomId: string, users: Array<{userId,nickname,avatarType,avatarRef,x,z,rotation}>, courtState? }

// 有人加入
{ type: 'user_joined', user: {userId,nickname,avatarType,avatarRef,x,z,rotation} }

// 有人离开
{ type: 'user_left', userId: string }

// 位置同步（节流 10Hz，服务端收到 move 后广播给房间内其他人）
{ type: 'presence', users: Array<{userId,x,z,rotation}> }

// 广场聊天
{ type: 'chat', userId: string, nickname: string, text: string }

// 法庭：用户发言
{ type: 'user_speech', userId: string, nickname: string, text: string }

// 法庭：用户站队投票
{ type: 'user_vote', userId: string, vote: 'plaintiff'|'defendant' }

// 法庭：合议庭事件广播（bench-orchestrator 的 onEvent 同时调用 ws 广播）
{ type: 'bench_event', event: BenchEvent }

// 法庭：房间状态快照（迟到者加入时发送）
{ type: 'court_snapshot', state: CourtRoomState }

// 错误
{ type: 'error', message: string }
```

### 客户端 → 服务端消息
```ts
{ type: 'move', x: number, z: number, rotation: number }
{ type: 'chat', text: string }
{ type: 'user_speech', text: string }
{ type: 'user_vote', vote: 'plaintiff'|'defendant' }
{ type: 'ping' }  // 服务端回 { type: 'pong' }
```

### 广场房间
- 全局单房间 `plaza`。
- 用户进入时随机初始位置（x: -10~10, z: -10~10）。
- 位置更新节流：服务端记录 lastMove，距上次 < 100ms 则丢弃。
- 广播 presence 给房间内其他用户。

### 法庭房间
- 房间 id：`court:<caseId>`。
- 启动合议庭（POST /api/cases/:id/bench/stream）时，若该 caseId 对应房间存在，将 bench 事件通过 `broadcastToRoom('court:'+caseId, {type:'bench_event', event})` 广播。
- 用户发言/投票通过 WS 广播给房间内所有人。
- 迟到者加入时收到 `court_snapshot`（当前 phase、members、speeches、votes、verdict）。
- 断线重连：客户端断开后自动重连，重新加入房间，服务端发送最新快照。

### ws.ts 导出
```ts
export function registerWebSocket(app: FastifyInstance): void;
export function broadcastToRoom(roomId: string, message: unknown): void;
export function updateCourtState(caseId: string, patch: Partial<CourtRoomState>): void;
export function getCourtState(caseId: string): CourtRoomState | undefined;
```

### server.ts 集成
- 在路由注册前 `await app.register(import('@fastify/websocket'))`。
- 调用 `registerWebSocket(app)`。
- 在 bench/stream 的 onEvent 回调中，除了 SSE send，还调用 `broadcastToRoom('court:'+id, { type: 'bench_event', event })`，并用 `updateCourtState` 维护房间状态。
- 在 bench 结束时更新 courtState.phase = 'verdict'。

## 四、共享类型新增（packages/shared/src/index.ts）

```ts
// 用户身份
export interface User {
  userId: string;
  nickname: string;
  avatarType: 'capsule' | 'celebrity' | 'custom';
  avatarRef: string;
  createdAt: string;
}

// 证书
export interface CertRecord {
  id: string;
  userId: string;
  caseId: string;
  caseTitle: string;
  verdict: string;
  charge?: string;
  createdAt: string;
}

// 消息
export interface MsgRecord {
  id: string;
  userId: string;
  kind: 'court' | 'comment' | 'cert' | 'system';
  title: string;
  summary: string;
  read: boolean;
  createdAt: string;
}

// WebSocket 消息
export type WSMessage =
  | { type: 'welcome'; roomId: string; users: WSUser[]; courtState?: CourtRoomState }
  | { type: 'user_joined'; user: WSUser }
  | { type: 'user_left'; userId: string }
  | { type: 'presence'; users: Array<{ userId: string; x: number; z: number; rotation: number }> }
  | { type: 'chat'; userId: string; nickname: string; text: string }
  | { type: 'user_speech'; userId: string; nickname: string; text: string }
  | { type: 'user_vote'; userId: string; vote: 'plaintiff' | 'defendant' }
  | { type: 'bench_event'; event: BenchEvent }
  | { type: 'court_snapshot'; state: CourtRoomState }
  | { type: 'pong' }
  | { type: 'error'; message: string };

export interface WSUser {
  userId: string;
  nickname: string;
  avatarType: string;
  avatarRef: string;
  x: number;
  z: number;
  rotation: number;
}

export interface CourtRoomState {
  caseId: string;
  phase: 'config' | 'streaming' | 'verdict';
  members: BenchMember[];
  speeches: BenchSpeech[];
  currentStage: BenchStage;
  votes: { plaintiff: number; defendant: number };
  verdict?: Verdict;
}
```

## 五、前端变更概要

### 身份管理（新建 apps/web/src/identity.ts）
- localStorage 存 `balabala.userId`。
- 首次进入：若无 userId，调用 POST /api/users 创建（弹窗让用户输入昵称 + 选化身）。
- 提供 `useIdentity()` hook：`{ user, isNew, updateProfile, ensureIdentity }`。
- 化身选择：胶囊（默认）、名人（从 CELEBRITIES 选）、自定义（输入 prompt 生成，可选）。

### App.tsx
- 挂载 IdentityProvider，首次进入显示身份设置弹窗。
- 解析 URL `?room=court:<caseId>`，自动进入法庭并加入对应房间。

### MyPage.tsx
- 证书、消息改为从 API 读取（/api/users/:userId/certificates 等）。
- 「我参与的」改为 /api/users/:userId/cases。
- 「我发布的」改为 /api/users/:userId/contents。
- 设置中的用户名修改调用 PUT /api/users/:userId。
- 保留 localStorage 作为音效等纯前端偏好。

### Plaza3D.tsx
- 连接 WS plaza 房间。
- 渲染其他用户化身（简单胶囊几何体 + 名牌，名人化身用对应颜色/模型）。
- 位置插值（useFrame 中 lerp）。
- 显示在线人数列表。
- 点击地面移动时发送 move 消息。

### CourtroomShell.tsx
- 支持房间模式：URL 带 `?room=court:<caseId>` 时，以观察者身份加入，通过 WS 接收 bench_event 同步状态。
- 房主（启动庭审者）保持现有 SSE 流程，同时事件广播给房间。
- 房间内用户发言/投票通过 WS 发送，所有人可见。
- 显示房间链接（复制按钮）和在线人数。
- 断线自动重连。

### vite.config.ts
- `/api` 代理增加 `ws: true`。

### 房间链接
- 格式：`http://localhost:5173/?room=court:<caseId>`
- 法庭页面有「分享房间」按钮，复制链接。

## 六、验收标准
1. `npm run build` 全绿。
2. API 重启后数据不丢（SQLite 持久化）。
3. 两个浏览器窗口：广场看到对方化身移动 + 在线人数；法庭 A 开庭 B 经链接加入实时同步。
4. M1-M6 不回归。
5. *.db / .data gitignore，密钥不进 git。
