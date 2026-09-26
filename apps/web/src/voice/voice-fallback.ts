// ===== Round4 R4-04: 语音不可用 → 文字喊话 回落状态机（纯逻辑，可单测）=====
//
// 设计目标：
//  - 不依赖浏览器 / React / WebRTC，全部为纯函数 reducer，Node 环境可直接单测。
//  - 云端无物理声卡，WebRTC 无法真机验证；真机（GPU + 麦克风）确认清单见文件末尾注释。
//
// 触发回落到「文字喊话」的三种入口：
//  1. WebRTC 连接失败（ICE 失败 / 对端无 answer / 候选超时）
//  2. 麦克风权限被拒（getUserMedia NotAllowedError）或无设备
//  3. 用户主动关闭麦克风（mute）后选择文字沟通
//
// 恢复：用户在引导弹窗里点「重试语音」→ 重新请求 getUserMedia → 成功即回到 voice。

export type VoiceMode = 'voice' | 'text'

/** 为什么当前处于文字喊话模式（用于 UI 文案与是否弹出引导） */
export type TextFallbackReason =
  | 'none'
  | 'mic_denied'      // 浏览器权限被拒
  | 'no_mic_device'   // 没有麦克风硬件
  | 'webrtc_failed'   // P2P 连接失败
  | 'user_muted'      // 用户主动关麦
  | 'user_chose_text' // 用户主动选文字

/** 麦克风权限探测结果（来自 Permissions API / getUserMedia 结果） */
export type MicPermission = 'unknown' | 'prompt' | 'granted' | 'denied'

export interface VoiceFallbackState {
  /** 当前沟通模式：voice = 实时语音，text = 头顶文字气泡 */
  mode: VoiceMode
  /** 处于 text 模式的原因（voice 模式下恒为 'none'） */
  reason: TextFallbackReason
  /** 麦克风权限探测结果 */
  micPermission: MicPermission
  /** WebRTC 信令/链路是否健康（收到首个远端流或 ICE connected 后置 true） */
  webrtcHealthy: boolean
  /** 是否需要弹出「麦克风权限引导」弹窗 */
  showMicGuide: boolean
  /** 用户已主动忽略过引导（本次会话不再自动弹） */
  guideDismissed: boolean
}

export const initialVoiceFallbackState: VoiceFallbackState = {
  mode: 'voice',
  reason: 'none',
  micPermission: 'unknown',
  webrtcHealthy: true,
  showMicGuide: false,
  guideDismissed: false,
}

export type VoiceFallbackEvent =
  /** getUserMedia 成功（或权限状态探测为 granted） */
  | { type: 'MIC_GRANTED' }
  /** getUserMedia 抛 NotAllowedError / PermissionDeniedError */
  | { type: 'MIC_DENIED' }
  /** getUserMedia 抛 NotFoundError / DevicesNotFoundError */
  | { type: 'MIC_NO_DEVICE' }
  /** getUserMedia 其它错误（占用/不支持），按无设备处理 */
  | { type: 'MIC_ERROR' }
  /** WebRTC 连接失败（ICE failed / 对端超时无应答） */
  | { type: 'WEBRTC_FAILED' }
  /** WebRTC 链路恢复（拿到首个远端音频流） */
  | { type: 'WEBRTC_RECOVERED' }
  /** 用户主动静音/取消静音麦克风 */
  | { type: 'USER_MUTE_CHANGED'; muted: boolean }
  /** 用户在 UI 上主动选择「用文字喊话」 */
  | { type: 'USER_CHOOSE_TEXT' }
  /** 用户在引导弹窗里点「重试语音」（重新走 getUserMedia） */
  | { type: 'USER_RETRY_VOICE' }
  /** 关闭麦克风引导弹窗（本次会话不再自动弹） */
  | { type: 'DISMISS_GUIDE' }

/** 纯 reducer：根据当前状态与事件，返回下一个状态（不修改入参）。 */
export function reduceVoiceFallback(
  state: VoiceFallbackState,
  event: VoiceFallbackEvent,
): VoiceFallbackState {
  switch (event.type) {
    case 'MIC_GRANTED':
      // 拿到麦克风 → 回到语音模式；引导不再需要
      return {
        ...state,
        mode: 'voice',
        reason: 'none',
        micPermission: 'granted',
        showMicGuide: false,
      }

    case 'MIC_DENIED':
      // 权限被拒：回落文字喊话，并弹出引导（除非用户已主动忽略）
      return {
        ...state,
        mode: 'text',
        reason: 'mic_denied',
        micPermission: 'denied',
        showMicGuide: !state.guideDismissed,
      }

    case 'MIC_NO_DEVICE':
    case 'MIC_ERROR':
      // 无设备/被占用：回落文字喊话，但不弹权限引导（引导是给权限问题用的）
      return {
        ...state,
        mode: 'text',
        reason: event.type === 'MIC_NO_DEVICE' ? 'no_mic_device' : 'no_mic_device',
        micPermission: 'prompt',
        showMicGuide: false,
      }

    case 'WEBRTC_FAILED':
      // 已有麦克风但 P2P 打不通：回落文字；不弹麦克风引导（权限没问题）
      return {
        ...state,
        mode: 'text',
        reason: state.reason === 'mic_denied' ? 'mic_denied' : 'webrtc_failed',
        webrtcHealthy: false,
        showMicGuide: false,
      }

    case 'WEBRTC_RECOVERED':
      // 链路恢复：若之前是因为 webrtc_failed 回落的，自动回到语音；
      // 若是权限/用户主动选择导致的回落，不自动切回（尊重用户选择）。
      if (state.reason === 'webrtc_failed') {
        return { ...state, mode: 'voice', reason: 'none', webrtcHealthy: true }
      }
      return { ...state, webrtcHealthy: true }

    case 'USER_MUTE_CHANGED':
      // 用户主动关麦 → 文字喊话；取消静音且当前因 user_muted 而在文字模式 → 回语音
      if (event.muted) {
        return { ...state, mode: 'text', reason: 'user_muted' }
      }
      if (state.reason === 'user_muted') {
        return { ...state, mode: 'voice', reason: 'none' }
      }
      return state

    case 'USER_CHOOSE_TEXT':
      return { ...state, mode: 'text', reason: 'user_chose_text', showMicGuide: false }

    case 'USER_RETRY_VOICE':
      // 用户点「重试语音」：清除引导，回到 voice 模式等待 getUserMedia 结果。
      // 若之后 MIC_GRANTED → 真的进入 voice；若 MIC_DENIED → 再次回落 text。
      return { ...state, showMicGuide: false, mode: 'voice', reason: 'none' }

    case 'DISMISS_GUIDE':
      return { ...state, showMicGuide: false, guideDismissed: true }

    default:
      return state
  }
}

/** 便捷工厂：初始状态上依次派发事件，便于 UI 层一行式更新。 */
export class VoiceFallbackMachine {
  private state: VoiceFallbackState = { ...initialVoiceFallbackState }

  send(event: VoiceFallbackEvent): VoiceFallbackState {
    this.state = reduceVoiceFallback(this.state, event)
    return this.state
  }

  getState(): VoiceFallbackState {
    return this.state
  }

  /** 当前是否处于文字喊话模式 */
  isTextMode(): boolean {
    return this.state.mode === 'text'
  }

  /** 当前是否允许发送语音（voice 模式且 WebRTC 健康） */
  canSendVoice(): boolean {
    return this.state.mode === 'voice' && this.state.webrtcHealthy
  }
}

/**
 * 把 getUserMedia 抛上来的 DOMException.name 映射成对应事件。
 * 真机浏览器里调用方拿到异常后直接用这个函数派发，避免散落字符串判断。
 */
export function micErrorToEvent(errName?: string): VoiceFallbackEvent {
  switch (errName) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { type: 'MIC_DENIED' }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { type: 'MIC_NO_DEVICE' }
    default:
      return { type: 'MIC_ERROR' }
  }
}

/*
 * ============================================================================
 * 需 GPU + 物理声卡真机确认的事项（本云环境无声卡，无法自动化验证）：
 *  - [ ] getUserMedia 在 HTTPS 真机浏览器中弹出权限框、拒绝/允许两条路径
 *  - [ ] WebRTC mesh 在 NAT 后（手机 4G ↔ 家庭 WiFi）能否通过公网 STUN 打通
 *  - [ ] TURN 中继在对称 NAT 下是否兜底（见 docs/WEBRTC-TURN-GUIDE.md）
 *  - [ ] 文字喊话气泡在 3D 世界空间中随玩家移动、3s 淡出的视觉效果
 * ============================================================================
 */
