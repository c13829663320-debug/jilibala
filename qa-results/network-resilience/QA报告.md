# jilibala 多人网络专项 · QA 测试报告

- **测试对象**：jilibala 多人网络专项（集成分支 `feat/network-resilience`，基线提交 `651ae1a`，集成 head `50ee17d`）
- **测试范围**：①断线重连 ②掉线平滑移除 ③房间权限 ④实时状态同步 ⑤WebSocket 中继 ⑥WebRTC 信令
- **测试方式**：既有自动化执行结果收口（API/Web vitest、独立 tsx E2E、Chromium headless 信令面冒烟），不发起新执行
- **总体结论**：**有条件通过（conditional_go）** —— 信令面与服务端逻辑全部自动化通过，无开放 Bug；真实媒体面/TURN/对称 NAT 与 GPU 渲染插值需真机补齐后方可全量发布。

---

## 一、测试报告

### 1.1 测试范围与环境

本次针对多人在线房间的网络韧性做端到端验证，覆盖服务端权威的心跳/重连/状态机、房间权限校验、状态同步纯逻辑，以及客户端信令面接入。构建与执行环境：

| 维度 | 结果 |
|---|---|
| 构建 | `npm run build` 全绿（shared tsc + api tsc + web vite/PWA） |
| API 单测/集成 | 33 文件 / **405 passed**（transport 11、room-permissions 11、state-sync-server 9、ws-rtc 10 等） |
| Web 单测 | 17 文件 / **229 passed**（state-sync 13、webrtc-manager 10 等） |
| E2E（vitest） | 2 文件 / **10 passed**（state-sync 5 + webrtc-signaling 5） |
| E2E（独立脚本） | room-permissions **17 步全 PASS**（`npx tsx tests/e2e/room-permissions.test.ts`） |
| 浏览器冒烟 | Chromium headless（`/usr/local/bin/chromium`）+ fake media 验证信令面 |

核心被测源码：`apps/api/src/transport.ts`（传输/重连状态机）、`apps/api/src/state-sync-server.ts`（序号去重/限流/presence）、`apps/api/src/ws.ts`（WebSocket 接入与信令中继）、`apps/api/src/room-routes.ts`（房间/权限/房主转移）、`apps/web/src/state-sync.ts`、`apps/web/src/voice/webrtc-manager.ts`、`apps/web/src/useReconnectingWebSocket.ts`。

### 1.2 风险点（RM）

| 编号 | 风险机制 | 优先级 | 验证状态 |
|---|---|---|---|
| RM-RECONNECT-001 | 重连窗口内席位/会话丢失，玩家被误踢 | P0 | 已验证 |
| RM-REMOVE-001 | 掉线幽灵玩家占位 / 误移除在线玩家 | P0 | 已验证 |
| RM-ROOMPERM-001 | 密码/锁定/踢人/房主身份被绕过 | P0 | 已验证 |
| RM-STATESYNC-001 | 序号去重/限流失效导致状态抖动或注入 | P1 | 已验证 |
| RM-WSRELAY-001 | WS 中继丢包/超大包/心跳误判 | P1 | 已验证 |
| RM-WEBRTC-001 | WebRTC 信令失败无回退 | P1 | 信令面已验证，**媒体面阻塞待真机** |

### 1.3 执行结果概览

- 用例总数 **22**：**21 通过 / 1 阻塞**（阻塞项为需 GPU 真机的媒体面用例）。
- 验收检查点 **6/6 通过**（重连核心旅程、掉线移除与房主转移、权限安全、状态一致性、WS 异常、RTC 信令）。
- 需求覆盖 **6/6**，其中 P0 需求 3/3 全部链接到独立用例并通过。
- **正式 Bug：0**。

关键证据（均为真实落盘日志）：

| 证据 | 路径 | 要点 |
|---|---|---|
| 传输韧性 | `apps/api/tests/e2e/logs/transport-resilience.1790467389089.json` | 48 事件：welcome×3、pong、player_disconnecting×3、player_reconnected×2、reconnect_progress×4、room_owner_changed×1、user_left×1 |
| 房间权限 | `tests/e2e/logs/room-permissions-2026-09-27T00-04-05-386Z.ndjson` | 17 步全 ok：密码不泄漏、错密 1006、锁定 1005、踢人 2003、非房主踢 1007、房主转移 |
| 状态同步 | `tests/e2e/logs/state-sync.jsonl` | welcome 配置一致、presence 聚合、seq[1,1,4]→lastKnownSeq=4、限流 sent25/err10、快照 8 玩家 |
| WebRTC 信令 | `tests/e2e/logs/webrtc-signaling-2026-09-27T00-04-11-307Z.jsonl` | STUN 下发、offer/answer 中继、rtc_target_offline、retry attempt2、ice_failed→suggestText |
| 浏览器冒烟 | `tests/e2e/logs/browser-signaling-2026-09-26T23-36-08-081Z.jsonl` | welcome/hasRTC/STUN/offerToB/answerToA 全 true |

### 1.4 已知未覆盖 / 需 GPU 真机项

以下能力本轮**未验证**，发布前须补齐：

1. **WebRTC 真实媒体面**（音频/视频流）——裸 WS E2E 仅覆盖信令面，媒体连通需双浏览器真机。
2. **TURN 中继与对称 NAT 穿越**——本次仅下发 STUN（`stun.l.google.com:19302`），无自建 TURN。
3. **客户端 Three.js 渲染插值**——`ENABLE_INTERPOLATION_RENDER=false` 待开启，插值平滑效果未在真机 GPU 验证。
4. **弱网长时稳定性**（分钟级丢包/抖动/带宽受限）与移动端/低性能设备适配。
5. 浏览器双端真实双向通话仅做 headless + fake media 信令冒烟，未验证真实采集设备与回声消除。

### 1.5 发布结论

**conditional_go（有条件通过）**。信令面与服务端逻辑已被自动化证据充分覆盖且全部通过，无开放 S1/S2；但媒体面/TURN/真机渲染插值缺失决定性证据。发布条件：

- 发布前在真实双浏览器 + TURN 环境验证 WebRTC 媒体面与对称 NAT 穿越（CASE-022）；
- 开启插值渲染后真机验证 Three.js 位置插值平滑效果；
- 灰度期监控房间掉线率、重连成功率与 `ice_failed` 回退触发量；
- 回滚：`feat/network-resilience` 可整体回退至上一稳定集成分支，服务端信令/权限可独立降级。

---

## 二、详细用例

> 状态：✅ 通过 / ⛔ 阻塞（待真机）。证据编号对应 §1.3 证据表。

### 范围① 断线重连

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-001 窗口内重连恢复席位并补发广播 | P0 | 正 | 断线后凭 sessionToken 在窗口内重连 | reconnect_accepted + 最新快照，在途事件按 seq 补发 | ✅ | EV-005 |
| CASE-002 超窗重连被拒 | P0 | 反 | 断开后等过 reconnectWindow 再重连 | session 过期，不复活旧席位 | ✅ | EV-001 |
| CASE-003 伪造/过期 token 被拒 | P1 | 反 | 携带伪造/过期 sessionToken 重连 | 校验失败拒绝，不发 welcome | ✅ | EV-001 |

### 范围② 掉线平滑移除

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-004 心跳超时先保留窗口不误踢 | P0 | 正 | 停 ping 后窗口内复连 | player_disconnecting 保留席位，复连成功 | ✅ | EV-005 |
| CASE-005 到期平滑移除无幽灵 | P0 | 正 | 掉线不重连等到期 | user_left 广播，成员移除，不占 maxPlayers | ✅ | EV-005 |
| CASE-006 房主离开触发转移 | P0 | 正 | 房主掉线/离开 | room_owner_changed 给最早存活成员 | ✅ | EV-005, EV-004 |

### 范围③ 房间权限

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-007 正确密码进私有房 | P0 | 正 | 凭正确密码加入 | 进入并收到 welcome | ✅ | EV-004 |
| CASE-008 错密拒绝且私有房不列 | P0 | 反 | 错密加入 + 查公开列表 | 错密 1006，listed=0 | ✅ | EV-004 |
| CASE-009 密码不泄漏 DTO / 锁定拒新人 | P0 | 反 | 读 DTO、锁房后新人加入 | DTO 无密码，锁定 1005 | ✅ | EV-004 |
| CASE-010 非房主踢人被拒 / 被踢不可重连 | P0 | 反 | 普通成员踢人、被踢者重连 | 非房主 1007，被踢 2003 | ✅ | EV-004 |
| CASE-011 转移后新房主可锁房 | P1 | 正 | 转移给 bob 后 bob 锁房 | 转移成功，bob 可锁房 | ✅ | EV-004 |

### 范围④ 实时状态同步

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-012 welcome 下发一致配置 | P1 | 正 | 读 welcome.stateSync | 六字段一致 | ✅ | EV-006 |
| CASE-013 重复/乱序 seq 去重 | P1 | 反 | 发送 seq[1,1,4] | 重复丢弃，lastKnownSeq=4 | ✅ | EV-006 |
| CASE-014 高频上报被限流 | P1 | 反 | 1s 发 25 条 | sent=25, rateLimitedErrors=10 | ✅ | EV-006 |
| CASE-015 presence 聚合与全量快照 | P1 | 正 | 多人上报 + 新成员加入 | 快照含全部在场玩家 | ✅ | EV-006 |

### 范围⑤ WebSocket 中继

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-016 ping/pong 与广播中继 | P1 | 正 | ping + 同房广播 | pong 回 serverTs，事件中继 | ✅ | EV-005 |
| CASE-017 超限消息被拒 | P2 | 反 | 发 >16KB 消息 | 该帧被拒，连接正常 | ✅ | EV-001 |
| CASE-018 单连接异常隔离 | P2 | 反 | 异常断开房 A 一连接 | 其他房间不受影响 | ✅ | EV-001, EV-005 |

### 范围⑥ WebRTC 信令

| 用例 | 优先级 | 类型 | 步骤摘要 | 预期 | 结果 | 证据 |
|---|---|---|---|---|---|---|
| CASE-019 rtc_config 与 SDP 中继 | P1 | 正 | A offer、B answer | STUN 下发，offer/answer 正确中继 | ✅ | EV-007, EV-008 |
| CASE-020 对端离线回错误码 | P1 | 反 | 向不在线目标发起 RTC | rtc_target_offline | ✅ | EV-007 |
| CASE-021 ICE 失败重试与文本回退 | P1 | 反 | 模拟 ice_failed | retry attempt2 → suggestText | ✅ | EV-007 |
| CASE-022 真机媒体面/TURN/对称 NAT | P2 | 正 | 双浏览器经 TURN 建媒体 | 媒体面连通（未执行） | ⛔ | EV-008 |

---

## 三、Bug 单

本轮自动化执行**未发现正式 Bug**（0 个 open / 0 个 deferred）。

- 所有 P0 用例均通过，无 `S1/S2` 开放缺陷。
- CASE-022 为**环境/能力缺口**（需 GPU 真机 + TURN 才能执行），按规范记为「未覆盖」而非缺陷，已列入 §1.4 与发布条件。
- 首败保留：本轮无失败用例，无需归因。

---

*报告生成于多人网络专项收口；证据日志均位于仓库 `tests/e2e/logs/` 与 `apps/api/tests/e2e/logs/` 下，可逐条复核。*
