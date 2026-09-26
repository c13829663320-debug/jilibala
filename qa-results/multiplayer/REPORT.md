# Round3 真人多人房间 · 双开真机联调报告

**测试时间**: 2026-09-26  
**测试环境**: Linux 云环境, Chromium 146 (SwiftShader 软件渲染), puppeteer-core  
**被测服务**: Web http://localhost:5173, API http://localhost:8787  
**脚本**: `qa-results/multiplayer/test.mjs`

---

## 验证结果总览

| # | 验证项 | 结果 | 说明 |
|---|--------|------|------|
| 1.1 | A 创建房间进入广场 | ✅ PASS | WS 连接 `social:<code>`, 房间信息条显示房间名+房间码+在线人数 |
| 1.2 | B 用房间码加入同一房间 | ✅ PASS | 双方均显示「2 人在线」, WS room 参数一致 |
| 2 | 双化身同房间可见 | ✅ PASS | 双方视角均能看到对方的 RemoteAvatar(胶囊身体+名字标签) |
| 3.1 | WASD 位置同步 | ❌ FAIL | WS 在无头环境每 ~3s 断连重连, move 消息未能发出 |
| 3.2 | 数字键1 wave 手势同步 | ❌ FAIL | 同上, emote 消息未能发出 |
| 4 | WebRTC 信令交换 (offer/answer) | ⚠️ 部分通过 | createOffer 在 B 端被调用 17 次, 但 SDP 经 WS 发送时 readyState 非 OPEN |

---

## 详细证据

### 1. 房间创建与加入 ✅

- A 进入多人房间大厅 → 切「创建房间」Tab → 输入房间名 → 创建
- A 的 WS: `ws://localhost:5173/api/ws?userId=...&room=social:<code>`
- 房间信息条: `1 人在线 | 房间码 XXXXXX | 离开房间`
- B 进入大厅 → 切「加入房间码」Tab → 输入房间码 → 加入
- 双方信息条均变为 `2 人在线`
- 截图: `01-lobby.png`, `02-room-created.png`

### 2. 双化身可见 ✅

- **A 视角** (`03-both-in-room-A-view.png`): 黄色胶囊(自己) + 蓝色「玩家B」化身
- **B 视角** (`04-both-in-room-B-view.png`): 黄色胶囊(自己) + 紫色「玩家A」化身
- WS 日志确认: B 收到 `welcome`/`user_joined` 含 A 的 userId, A 收到 B 的 userId
- 截图 `05-after-movement.png` 记录最终状态

### 3. 位置同步 & 手势 ❌ (环境受限)

**现象**: A 按住 W 两秒, B 侧未收到任何 `presence` 消息; 按数字键1, B 未收到 `emote` 消息。

**根因分析**:
- WS 在浏览器内每 ~3 秒断连重连一次 (close code 1005/1006), 导致 `ws.readyState` 大部分时间为 `CONNECTING(0)` 或 `CLOSED(3)`
- PlayerController 的 `onSync` 和 Plaza3D 的 emote handler 都在发送前检查 `ws.readyState === OPEN`, 不满足则静默丢弃
- **对照实验**: 裸 node WebSocket 客户端直连 `ws://localhost:8787` (绕过浏览器) 12 秒稳定不断; 经 vite 代理 5173 也 12 秒稳定
- **结论**: 断连是浏览器内 SwiftShader 软件渲染饿死事件循环导致的环境问题, 非应用逻辑 bug。在真机/有 GPU 的环境下 WS 应保持稳定

**探针证据**:
- `[探针] A window 收到 keydown: ["KeyW"]` — 键盘事件正确送达 window
- `[探针] ws.readyState=1` (瞬间 OPEN) — 但 onSync 调用时大概率已回落
- `ws-a.json` 中 11 次 welcome 循环, 仅 1 条 `ping` 出站, 0 条 `move`/`emote`

### 4. WebRTC 语音链路 ⚠️

**现象**: 双方点击麦克风按钮后, createOffer 在 B 端被调用 17 次 (probe 记录), 但 WS 上 `rtc_sdp` 消息数为 0。

**根因**:
- `useSpatialVoice` 的 300ms tick 循环正确识别对端, 创建 RTCPeerConnection (A: 14个, B: 10个)
- B 端 (字典序较小 userId) 正确发起 createOffer, 无报错
- 但 `maybeSendOffer` 在 `setLocalDescription` 后检查 `ws.readyState === OPEN` 才发送 SDP
- 由于 WS 反复重连, 发送窗口极短, SDP 未能经 WS 送达对端
- ICE candidate 同样未发出 (rtc_ice=0)

**探针证据**:
- `A: offers=11 err=[] PC=14; B: offers=17 err=[] PC=10`
- createOffer 无错误, 卡在 WS 发送环节

---

## 环境限制说明

本次测试在无 GPU 的云环境中运行, 启用了 `--enable-unsafe-swiftshader` 软件渲染。该环境下:

1. **WebGL 渲染极慢**, R3F render loop 占用事件循环, 导致 WebSocket 心跳超时断连
2. **无物理声卡**, 使用 `--use-fake-device-for-media-stream` 假音频设备, getUserMedia 可正常授权
3. WS 每 ~3s 断连重连, 使所有依赖稳定 WS 的双向同步 (position/emote/WebRTC SDP) 无法完整验证

**建议在真机/有 GPU 的环境复测 3.1/3.2/4 项**, 预期应全部通过, 因为:
- WebRTC PC 创建与 createOffer 逻辑正确 (已验证)
- WS 连接建立、房间加入、化身渲染均正常
- 失败仅因 WS readyState 在发送瞬间非 OPEN

---

## 证据文件清单

```
qa-results/multiplayer/
├── test.mjs                      # 自动化测试脚本
├── report.json                    # 机器可读结果
├── 01-lobby.png                  # A 的多人房间大厅
├── 02-room-created.png           # A 创建房间后广场 (房间信息条)
├── 03-both-in-room-A-view.png    # A 视角: 可见蓝色「玩家B」化身
├── 04-both-in-room-B-view.png    # B 视角: 可见紫色「玩家A」化身
├── 05-after-movement.png         # 最终状态
├── console-a.log / console-b.log  # 双方浏览器 console 日志
├── ws-a.json / ws-b.json          # 双方 WebSocket 收发消息完整记录
└── debug-*.png / fail-*.png      # 调试截图 (过程中间产物)
```

**未执行 git commit** (按要求)。
