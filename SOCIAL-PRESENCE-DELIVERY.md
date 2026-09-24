# 社交临场感 (social-presence) 交付说明

> 分支：`feat/social-presence`，基于 main (4bdf3cf)。对比 VRChat，补齐四大缺失模块。

## 一、补齐了什么（对比 VRChat）

| VRChat 能力 | 之前 | 现在 |
|---|---|---|
| 玩家间实时语音 | ❌ 仅文字聊天 | ✅ WebRTC mesh P2P，信令走现有 WS |
| 3D 空间音频 | ❌ TTS 用 HTMLAudio 非空间 | ✅ PannerNode 距离衰减+方位，AudioListener 绑定相机 |
| 距离语音(proximity) | ❌ | ✅ 超出 maxDistance 静音，按距离订阅裁剪 ≤8 人 |
| 说话口型 lip sync | ❌ | ✅ 麦克风电平→口型，远端按 talkingIntensity 驱动 |
| 表情/手势/动作 | ❌ | ✅ 7 种 emote（挥手/点头/摇头/指向/鼓掌/笑/惊讶）+ 动画状态机 |
| 头部注视 | ❌ | ✅ 说话时头部转向最近玩家 |
| 麦克风静音/按键说 | ❌ | ✅ 顶栏麦克风按钮，支持 push-to-talk |
| NPC TTS 空间化 | ❌ | ✅ usePositionalTts 可复用（广场已就绪，法庭待接入） |

## 二、Commits

1. `dbbc986` — 协议地基：共享类型扩展 + WS 信令/emote/talking handler
2. `a948d1c` — 语音空间音频：WebRTC mesh + PannerNode + 麦克风 hook + 信令测试
3. `a964cc2` — 口型表情手势：lip-sync + 动画状态机 + 程序化 rig + EmoteWheel + Plaza3D 集成

## 三、改动文件清单（16 文件，+2532 行）

### 共享层
- `packages/shared/src/index.ts` — 新增 EmoteType/AvatarExpression/RtcSdpJson/RtcIceJson/PresenceUser；WSMessage 新增 rtc_sdp/rtc_ice/rtc_bye/emote/talking；presence.users 改为 PresenceUser[]（全可选，向后兼容）

### 服务端
- `apps/api/src/ws.ts` — RoomUser 扩展临场感字段；rtc_sdp/rtc_ice/rtc_bye 目标用户单发转发；emote 校验+300ms 节流+广播；talking 更新+120ms 节流广播；move presence 携带扩展字段
- `apps/api/src/ws-rtc.test.ts` — 5 个端到端信令测试

### 语音模块（apps/web/src/voice/）
- `spatial-audio.ts` — computeDistanceGain / pickSubscribers / computeStereoPan（纯逻辑，可单测）
- `spatial-audio.test.ts` — 19 个单测
- `useMicrophone.ts` — getUserMedia + AnalyserNode 电平 + track.enabled 静音
- `useSpatialVoice.ts` — 核心 hook：WebRTC mesh + 距离订阅裁剪 + PannerNode 空间音频 + 信令
- `PositionalTts.ts` — 空间化 TTS（MediaElementSource→PannerNode），未改 tts.ts

### Avatar 模块（apps/web/src/avatar/）
- `lip-sync.ts` — 电平→口型非线性映射 + 指数平滑 + AnalyserNode RMS
- `lip-sync.test.ts` — 10 个单测
- `animation-state-machine.ts` — idle/talking/7 emote 状态机 + getPose 姿势曲线
- `animation-state-machine.test.ts` — 15 个单测
- `avatar-rig.ts` — 自动探测 blendshape/skeleton，无模型时程序化头/下颌/手臂节点
- `useAvatarLipSync.ts` — mic/remote/tts 三源口型 hook
- `RemoteAvatar.tsx` — 升级版远端 avatar（口型+动画+表情+头部注视+音量条）
- `EmoteWheel.tsx` — 7 动作圆形轮盘 UI
- `useEmote.ts` — emote 发送/接收 + 超时自动清除

### 集成
- `apps/web/src/Plaza3D.tsx` — 替换内联 RemoteAvatar；扩展 RemotePlayer；集成 useSpatialVoice/useAvatarLipSync/EmoteWheel；WS talking/emote 处理；localPosRef；顶栏麦克风按钮

## 四、测试结果

- **API**：`npm run test --workspace apps/api` → **205 passed**（17 文件，含新增 ws-rtc 5 用例）
- **Web**：`npm run test --workspace apps/web` → **152 passed**（10 文件，含新增 spatial-audio 19 + lip-sync 10 + animation 15）
- **Build**：`npm run build` → ✅ 通过（tsc -b + vite build，0 error）
- **零回归**：现有测试全部通过

## 五、关键设计决策

1. **WebRTC 协商防 glare**：userId 字典序较小方主动发 offer，同一对 peer 永远单侧发起。
2. **衰减模型可测**：PannerNode 只做方位（rolloffFactor=0），距离衰减统一用 computeDistanceGain（与单测同公式）。
3. **订阅裁剪**：每 300ms 重算应连接集合，越界 PC 关闭并发 rtc_bye，回范围自动重建，mesh ≤8 人。
4. **静音用 track.enabled**：不 removeTrack，避免重协商；enabled=false 时远端 Gain 全 0。
5. **与 GLB 解耦**：avatar-rig 自动探测 morphTargetDictionary/skeleton，没有就用程序化子节点，禁止硬编码模型文件名。
6. **向后兼容**：所有 WS 新字段可选，旧客户端忽略未知字段不崩溃；无麦克风降级为纯文字+位置。

## 六、麦克风授权流程（真机）

1. 用户进入广场，顶栏右侧显示麦克风按钮（默认静音/灰色）。
2. 首次点击 → 浏览器弹出麦克风授权 → 允许后 useSpatialVoice 建立 MediaStream + PeerConnection，Plaza3D 自建 AnalyserNode 用于电平上报。
3. 再次点击 → 静音（track.enabled=false，不发音频，但仍可收听他人）。
4. 全局语音开关（TopNav 喇叭）关闭时 → useSpatialVoice enabled=false，不发不收。

## 七、已知限制

1. **双 getUserMedia**：Plaza3D 的本地口型电平分析器是独立于 useSpatialVoice 的第二次 getUserMedia（useSpatialVoice 未暴露 analyser）。真机上可共享设备但存在轻微重复采集。后续可让 useSpatialVoice 暴露 analyser/stream 合并。
2. **法庭 NPC 未接入**：usePositionalTts / useAvatarLipSync / avatar-rig 已就绪，可直接复用于 CourtroomM13 的名人 NPC（TTS 空间化+口型+说话手势），本次未接线。
3. **本地 avatar 不渲染**：广场不显示自己的 avatar，useAvatarLipSync 用 dummy rig 仅触发 onIntensity 回调。
4. **回声消除**：依赖浏览器默认 AEC，未手动配置 echoCancellation 约束（可后续加）。

## 八、待 Windows/本地真机核对项（云端无 WebGL/音频/麦克风）

1. WebRTC 真实建连：STUN 穿越、offer/answer 握手、两台浏览器对测语音通话。
2. 空间音频听感：PannerNode HRTF 方位、距离衰减、AudioListener 朝向与 Plaza 相机一致性。
3. 口型视觉：下颌张合与语音同步度、emote 姿势曲线（wave 摆臂/nod 点头/clap 鼓掌）。
4. 头部注视：说话时转向最近玩家是否自然。
5. 麦克风授权：弹窗流程、拒绝授权降级、双 getUserMedia 是否冲突。
6. 按键说 push-to-talk：setPushing 与 keydown/keyup 接线（当前按钮是切换静音模式）。
7. 多人性能：房间 >8 人时订阅裁剪是否平滑、mesh 连接重建瞬断。
