// ===== useEmote：emote 发送与接收 =====
// - sendEmote：通过 WS 发送 emote 消息（客户端节流由服务端 300ms 兜底）
// - handleEmoteMessage：收到他人 emote 后更新 playersRef 中对应用户的 animation 状态，
//   并在 durationMs 后自动清除。
// - 本地自己也维护一份 emote 状态（广场不渲染本地 avatar，但状态留作扩展）。
import { useCallback, useRef, type MutableRefObject } from 'react'
import type { EmoteType } from '@balabala/shared'
import { EMOTE_DEFAULT_DURATION } from './animation-state-machine'
import type { PresencePlayer } from './RemoteAvatar'

export interface UseEmoteOptions {
  wsRef: MutableRefObject<WebSocket | null>
  playersRef: MutableRefObject<Map<string, PresencePlayer>>
  localUserId: string
  /** 本地触发 emote 时的回调（播放本地动画/音效预留） */
  onLocalEmote?: (emote: EmoteType) => void
}

export interface UseEmoteResult {
  sendEmote: (emote: EmoteType, durationMs?: number) => void
  /** 在 WS onmessage 中调用，处理收到的 emote 消息 */
  handleEmoteMessage: (msg: { userId: string; emote: EmoteType; durationMs?: number }) => void
  /** 最近一次本地 emote 的冷却结束时间戳 */
  cooldownUntil: () => number
}

const CLIENT_COOLDOWN_MS = 300 // 与服务端节流一致

export function useEmote(opts: UseEmoteOptions): UseEmoteResult {
  const { wsRef, playersRef, onLocalEmote } = opts
  const lastSentRef = useRef(0)

  const sendEmote = useCallback((emote: EmoteType, durationMs?: number) => {
    const now = performance.now()
    if (now - lastSentRef.current < CLIENT_COOLDOWN_MS) return // 客户端再兜一层
    lastSentRef.current = now
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'emote', emote, durationMs }))
    onLocalEmote?.(emote)
  }, [wsRef, onLocalEmote])

  const handleEmoteMessage = useCallback((msg: { userId: string; emote: EmoteType; durationMs?: number }) => {
    const p = playersRef.current.get(msg.userId)
    if (!p) return
    const dur = msg.durationMs ?? EMOTE_DEFAULT_DURATION[msg.emote]
    p.emote = msg.emote
    p.emoteUntil = performance.now() + dur
    // 超时后清除 emote（若期间被新 emote 覆盖则不清除）
    window.setTimeout(() => {
      const cur = playersRef.current.get(msg.userId)
      if (cur && cur.emote === msg.emote) {
        cur.emote = undefined
        cur.emoteUntil = undefined
      }
    }, dur)
  }, [playersRef])

  return {
    sendEmote,
    handleEmoteMessage,
    cooldownUntil: () => lastSentRef.current + CLIENT_COOLDOWN_MS,
  }
}
