# 叽里呱啦 · 多人网络专项 · 交接说明

## 基本信息

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/c13829663320-debug/jilibala |
| 基线提交 | `651ae1a1a11451737e729f882d6eb95972d64889`（main HEAD，完全匹配） |
| 集成分支 | `feat/network-resilience` |
| 最终提交 | `84970bcefbb469b65c73911dbe67800d4908cdfa` |
| 包管理器 | npm workspaces（非 pnpm；仓库无 pnpm-workspace.yaml） |
| 工程结构 | `apps/web`（React+Vite+Three）/ `apps/api`（Node+Fastify）/ `packages/shared` |

> 注：任务原文仓库用户名为 `c1382663320-debug`，实际 GitHub 用户为 `c13829663320-debug`（数字 266→296 错位），已按实际仓库开发。

## 覆盖范围

六个网络专项全部实现并通过测试：

1. **断线重连**：会话/Token 恢复、在途消息补发、重连进度事件
2. **掉线玩家平滑移除与超时判定**：心跳超时、宽限期、席位保留、房主转移兜底
3. **房间权限**：踢人、转移房主、锁房、私密房、人数上限、房间密码
4. **实时状态同步**：插值/外推/裁剪、带宽频率控制、序号去重、乱序/丢包补偿
5. **WebSocket social 中继稳定性**：心跳、指数退避重连、消息不丢不重
6. **WebRTC 信令健壮性**：TURN 中继、ICE 失败重试、语音不可用回落文字

## 改动文件清单（37 文件，+6253 / -434）

### 协议层 `packages/shared/`
| 文件 | 说明 |
|---|---|
| `src/network-protocol.ts` | 新建：统一消息信封、会话 Token、重连请求/响应/进度、房间权限类型、错误码、心跳配置、状态同步配置、WebRTC 状态 |
| `src/index.ts` | WSMessage 联合扩展（welcome 加 heartbeat/sessionToken/stateSync/resumed、player_disconnecting、player_reconnected、reconnect_progress、reconnect_response、room_owner_changed、rtc_config、rtc_error、rtc_retry、rtc_fallback、pong 加 clientSeq/serverTs/playerCount）；SocialRoom 加 locked/hasPassword |

### 服务端 `apps/api/`
| 文件 | 说明 |
|---|---|
| `src/transport.ts` | 新建：TransportEngine 纯状态机（会话签发、心跳超时判定、在途广播环形缓冲、平滑断开窗口、tryResume 恢复、看门狗 tick） |
| `src/ws.ts` | 大幅修改：集成传输引擎、welcome 下发配置/Token、ping→pong、断线进 reconnecting 不删席位、重连复用 x/z、按 ?sessionId= 分支恢复 vs 全新、补发广播路由、safeSend 错误计数、房主转移兜底、看门狗 setInterval、状态同步 seq 校验/限流/10Hz ticker 聚合、rtc_config 下发/信令状态机/断线清理 |
| `src/room-routes.ts` | 创建房间支持 isPrivate/password/maxPlayers；roomSecrets Map 存密码不进 DTO；verify-password/setRoomPassword/setRoomLocked/setRoomMaxPlayers/transferRoomOwner 权威变更函数；transferSocialRoomOwner |
| `src/state-sync-server.ts` | 新建：SeqTracker/SlidingWindowRateLimiter/RoomPresenceAggregator/batchPlayersBySize |
| `src/transport.test.ts` | 新建：11 个纯逻辑单测 |
| `src/room-permissions.test.ts` | 新建：11 个正反用例 |
| `src/state-sync-server.test.ts` | 新建：9 个单测 |
| `src/ws-rtc.test.ts` | 修改：10 个用例（离线改 rtc_error、新增状态机/透传/rtc_config） |
| `tests/e2e/transport-resilience.test.ts` | 新建：真实 Fastify + 裸 ws 客户端 e2e |
| `vitest.config.ts` | include 增加 tests/**/*.test.ts |

### 前端 `apps/web/`
| 文件 | 说明 |
|---|---|
| `src/useReconnectingWebSocket.ts` | sessionToken 跟踪、重连 URL 携带 sessionId+lastServerSeq、退避 ±20% 抖动、暴露 reconnectStage/reconnectProgress |
| `src/state-sync.ts` | 新建：RemotePlayerBuffer 纯类（插值/外推/裁剪 snap/lerpAngle，无 Three/DOM 依赖） |
| `src/state-sync.test.ts` | 新建：13 个单测 |
| `src/voice/webrtc-manager.ts` | 新建：RtcPeerManager（PC 生命周期/iceConnectionState 监控/failed 自动重试 3 次 2s/5s/10s/强制 relay/offer 10s 超时/ICE 15s 超时/rtc_fallback 降级） |
| `src/voice/webrtc-manager.test.ts` | 新建：10 个单测（MockPc + 手动时钟） |
| `src/voice/useSpatialVoice.ts` | PC 生命周期委托 manager，保留空间音频图与 300ms 订阅节拍，新增 fallbackActive/fallbackNotice/retryVoice |
| `src/Plaza3D.tsx` | WS 携带密码、房主控制面板、权限事件 toast、被踢自动离开、rtc_config 接收、降级横幅、stateSync 集成（opt-in poseSampler） |
| `src/MultiplayerLobby.tsx` | 创建房间密码框、私密房加入密码输入 |
| `src/world/WorldScene.tsx` | poseSampler 透传 |
| `src/avatar/RemoteAvatar.tsx` | 消费 poseSampler，每帧可调 buffer.sample() |
| `src/plaza-3d.css` | 房主面板 + voice-fallback 横幅样式 |

### E2E 与基建
| 文件 | 说明 |
|---|---|
| `tests/e2e/state-sync.test.ts` + `vitest.config.ts` | 裸 node 客户端多客户端高频发送 E2E（5 例） |
| `tests/e2e/webrtc-signaling.test.ts` | 裸 node 客户端信令 E2E（5 例） |
| `tests/e2e/room-permissions.test.ts` | 独立脚本：17 步权限链路（npx tsx 运行） |
| `tests/e2e/browser-signaling.smoke.mjs` | Chromium headless + fake media 浏览器冒烟 |
| `tests/e2e/logs/` | 结构化证据日志（JSONL/NDJSON） |
| `vitest.e2e.config.ts` | 根级 e2e vitest 配置 |
| `package.json` | test:e2e / test:browser-smoke 脚本 |
| `.env.example` | TURN 配置说明 |

## 测试结果（全绿）

| 套件 | 结果 |
|---|---|
| API 单元 + e2e | **33 文件 / 405 passed** |
| Web 单元 | **17 文件 / 229 passed** |
| E2E vitest（state-sync + webrtc） | **2 文件 / 10 passed** |
| E2E 独立脚本（room-permissions） | **17 步全 PASS** |
| 浏览器冒烟（Chromium + fake media） | 信令面通过 |
| 全量构建 `npm run build` | shared tsc + api tsc + web vite/PWA 全绿 |

复跑命令：
```bash
# API 全量
cd apps/api && npx vitest run
# Web 全量
cd apps/web && npx vitest run
# E2E vitest
npx vitest run --config tests/e2e/vitest.config.ts
# 房间权限 E2E（独立脚本）
npx tsx tests/e2e/room-permissions.test.ts
# 浏览器冒烟
npm run test:browser-smoke
# 全量构建
npm run build
```

## 证据日志路径

| 范围 | 路径 |
|---|---|
| 传输/重连 | `apps/api/tests/e2e/logs/transport-resilience.1790467389089.json` |
| 房间权限 | `tests/e2e/logs/room-permissions-2026-09-27T00-04-05-386Z.ndjson` |
| 状态同步 | `tests/e2e/logs/state-sync.jsonl` |
| WebRTC 信令 | `tests/e2e/logs/webrtc-signaling-2026-09-27T00-04-11-307Z.jsonl` |
| 浏览器冒烟 | `tests/e2e/logs/browser-signaling-2026-09-26T23-36-08-081Z.jsonl` |

## 已验证项

- ✅ 断线后会话/Token 恢复、在途消息补发、重连进度事件
- ✅ 掉线超时判定与玩家平滑移除（含房主席位兜底转移）
- ✅ 踢人、转移房主、锁房、私密房、密码错误/正确、人数上限（正反用例）
- ✅ 状态同步：序号去重、乱序/丢包补偿、插值/外推/裁剪、发送频率与带宽上限
- ✅ 心跳超时、指数退避重连、中继消息不丢不重
- ✅ WebRTC 信令失败重试、TURN 配置下发、ICE 失败后语音转文字 fallback
- ✅ 向后兼容：旧客户端不带 sessionId/seq 走原路径，welcome 新增字段全部可选

## 需 GPU 真机/浏览器复测项

云端无 GPU，以下项目已用裸 node 客户端验证协议与逻辑，需真机联调：

1. **Three.js 渲染插值**：`Plaza3D.tsx` 中 `ENABLE_INTERPOLATION_RENDER` 当前为 `false`。真机多人联调时置 `true`，验证：
   - 100ms 插值延迟下远端移动平滑无抖动
   - 丢包/断流 250ms 内的外推观感、超时冻结是否突兀
   - 传送/瞬移时 `positionClipThreshold=50` 的 snap 是否避免长距离插值
   - `RemoteAvatar.useFrame` 直采 `sample()` 后口型/表情/头部注视与既有 lerp 路径一致
2. **时钟偏移校准**：`clockOffsetRef` 一阶低通在高 RTT/弱网下的稳定性
3. **WebRTC 真实媒体面**：双向语音流、TURN relay 实际打洞（本机 Chromium 仅 SwiftShader，已用 fake media 验证信令面与 RTCPeerConnection API 可用）
4. **真实对称 NAT 下**：配置真实 `WEBRTC_TURN_*` 后跨网两端的中继连通性
5. **降级横幅/文字切换**的视觉联调与麦克权限拒绝的真机交互

## 关键设计决策

1. **服务端权威、纯函数判定**：传输层 `findTimedOutSessions`/`findExpiredGraceSessions` 是纯函数，由 `tick(now)` 周期驱动；副作用走 hooks，单测用假时钟确定性覆盖。
2. **席位保留**：断线只把 RoomUser 置 `reconnecting`、detach socket，**不删 Map**；重连时原地复用 x/z/joinedAt。`activePlayerCount` 只数 active，reconnecting 席位仍占房。
3. **补发边界**：只缓冲离散事件（chat/user_joined/user_left/room_player_update/emote/talking 等），**不缓冲高频 presence/move**（状态同步归同步分片，不插值重发）。
4. **房主转移时机**：在平滑窗口到期真正移除时才转移给最早 joinedAt 的 active 成员；房间空则保留 creatorId 等待重连/惰性解散。
5. **密码隔离**：`SocialRoom` DTO 永不携带密码，服务端单独 `roomSecrets` Map 存储；对外只暴露 `hasPassword`。
6. **状态同步频率**：服务端 10Hz ticker 聚合广播 presence，客户端 15Hz 发送上限，超 4KB 分批。
7. **WebRTC 降级**：iceConnectionState failed 自动重试 3 次（2s/5s/10s 递增，每次强制 relay），耗尽发 `rtc_fallback`，前端展示"语音不可用，已切换文字聊天"横幅。
8. **可运维调参**：`TRANSPORT_HEARTBEAT_TIMEOUT_MS`/`TRANSPORT_RECONNECT_WINDOW_MS`/`TRANSPORT_PING_INTERVAL_MS`/`TRANSPORT_WATCHDOG_MS`/`WEBRTC_TURN_URL/USERNAME/CREDENTIAL` 环境变量覆盖默认值。

## 集成注意事项

1. **环境变量**：生产部署需配置 `WEBRTC_TURN_URL`/`WEBRTC_TURN_USERNAME`/`WEBRTC_TURN_CREDENTIAL` 以启用 TURN 中继；未配置时仅使用公共 STUN。
2. **看门狗**：服务端启动后 `setInterval` 每 5s 运行一次 `transport.tick()`（可由 `TRANSPORT_WATCHDOG_MS` 调整），无需额外调度。
3. **前端 opt-in**：状态同步的插值渲染当前为 `ENABLE_INTERPOLATION_RENDER=false`，默认走原 lerp 路径，不影响现有行为；验证通过后可置 `true`。
4. **向后兼容**：旧客户端忽略未知 message type，新增字段全部可选，可灰度发布。
5. **测试隔离**：`room-permissions.test.ts` 中不缩短 `heartbeatTimeoutMs`（测试客户端不发 ping，手动 tick 会误关活跃会话），仅缩短 `reconnectWindowMs`。

## 回滚方式

```bash
# 回滚到基线
git checkout main
git reset --hard 651ae1a

# 或仅 revert 集成分支的 merge commits
git revert -m 1 <merge-commit-hash>
```

集成分支 `feat/network-resilience` 独立于 main，不影响主线；如需部分回滚，可按分片 revert（各分片有独立 merge commit：`11a7b98` roomperm、`6ccd260` statesync、`2bdd4e1` webrtc）。

## 分片分支（保留备查）

- `feat/net-transport` — 传输与重连
- `feat/net-roomperm` — 房间权限
- `feat/net-statesync` — 状态同步
- `feat/net-webrtc` — WebRTC
