// ===== R5: 语音活动追踪 hook =====
//
// 基于已有 room-wide `talking` WS 消息（{ userId, intensity }）追踪「谁在说话」。
// 本地麦克风电平由外层（useMicrophone）注入；本 hook 负责聚合远端说话人列表。
// 纯展示状态，不碰 WebRTC 核心（性能域已实现）。

import { useCallback, useMemo, useState } from 'react'
import { isSpeaking } from './voiceLevel'

export interface VoiceSpeaker {
  userId: string
  /** 0~1 说话强度。 */
  intensity: number
  speaking: boolean
}

export interface UseVoiceActivityResult {
  /** 当前正在说话（或最近在说话）的远端玩家列表，按强度降序。 */
  speakers: VoiceSpeaker[]
  /** 外层在收到 WS talking 帧时调用。 */
  onTalkingMessage: (msg: { type: string; userId: string; intensity: number }) => void
  /** 本地是否静音（仅 UI 状态；实际静音在 useMicrophone/useSpatialVoice）。 */
  localMuted: boolean
  setLocalMuted: (m: boolean) => void
}

export function useVoiceActivity(): UseVoiceActivityResult {
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [localMuted, setLocalMuted] = useState(false)

  const onTalkingMessage = useCallback((msg: { type: string; userId: string; intensity: number }) => {
    if (msg.type !== 'talking') return
    const intensity = Math.min(1, Math.max(0, msg.intensity))
    setLevels((prev) => {
      const next = { ...prev, [msg.userId]: intensity }
      // 强度回到 0 的说话人保留一小段（由远端节流消息维持），不主动清理
      return next
    })
  }, [])

  const speakers = useMemo<VoiceSpeaker[]>(() => {
    return Object.entries(levels)
      .map(([userId, intensity]) => ({ userId, intensity, speaking: isSpeaking(intensity) }))
      .sort((a, b) => b.intensity - a.intensity)
  }, [levels])

  return { speakers, onTalkingMessage, localMuted, setLocalMuted }
}
