// ===== R5: WebRTC 健壮性（纯函数，无 RTCPeerConnection 实例，可在 Node 单测）=====
//
// 策略：
//   - ICE 连接失败/长时间断开 → 自动回落到文字喊话（text_shout，WS 已有该消息）；
//   - 麦克风权限/设备失败 → MicPermissionGuide（voice/ 下已有组件）引导；
//   - 网络抖动（高 RTT / 高丢包）→ 给出音频码率自适应档位提示，压低码率保通话。
//
// 本模块只做决策；真正的 RTCPeerConnection / getUserMedia 在浏览器端。

/** ICE 状态归并后的简化结论。 */
export type IceVerdict = 'connected' | 'checking' | 'reconnecting' | 'failed'

/**
 * 把 RTCIceConnectionState 归并为业务可处理的结论。
 * 云端无 WebRTC，真机验证实际语音效果。
 */
export function classifyIceState(state: string): IceVerdict {
  switch (state) {
    case 'connected':
    case 'completed':
      return 'connected'
    case 'checking':
      return 'checking'
    case 'disconnected':
      return 'reconnecting'
    case 'failed':
      return 'failed'
    case 'closed':
      return 'failed'
    default:
      return 'checking'
  }
}

/**
 * ICE 失败后是否应回落到文字喊话。
 * @param verdict        当前 ICE 结论
 * @param failedMs       已处于 failed/disconnected 的时长（ms）
 * @param fallbackAfterMs 失败多久后回落（默认 8s，给 STUN/TURN 候选重试时间）
 */
export function shouldFallbackToText(
  verdict: IceVerdict,
  failedMs: number,
  fallbackAfterMs = 8000,
): boolean {
  if (verdict === 'failed') return failedMs >= fallbackAfterMs
  if (verdict === 'reconnecting') return failedMs >= fallbackAfterMs * 2
  return false
}

/** 音频码率自适应档位。 */
export type AudioBitrateHint = 'high' | 'medium' | 'low'

/**
 * 根据网络质量建议音频码率档位：
 *   - 丢包 > 8% 或 RTT > 600ms → low（压码率保通话）
 *   - 丢包 > 3% 或 RTT > 300ms → medium
 *   - 否则 high
 */
export function adaptiveAudioBitrate(rttMs: number, packetLossPct: number): AudioBitrateHint {
  const rtt = Number.isFinite(rttMs) ? rttMs : 0
  const loss = Number.isFinite(packetLossPct) ? packetLossPct : 0
  if (loss > 8 || rtt > 600) return 'low'
  if (loss > 3 || rtt > 300) return 'medium'
  return 'high'
}
