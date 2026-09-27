import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'
import type { ResumedSessionState, ReplayedMessage } from '@balabala/shared'
import { nextBackoffDelay } from './performance/reconnect-strategy'
import { handleIncomingModerationFrame } from './safety/moderation-bus'

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

type Options = {
  /** 返回完整 wss/ws URL；返回 null/空则不连接。 */
  url: () => string | null | undefined
  /** 消息处理。 */
  onMessage: (data: string) => void
  /** 连接成功后回调（用于重新加入房间/恢复订阅）。 */
  onOpen?: (ws: WebSocket) => void
  /** 初始延迟 1s，每次翻倍，最大 30s。 */
  initialDelayMs?: number
  maxDelayMs?: number
  /** 是否启用（默认 true）。可用于依赖就绪前暂停。 */
  enabled?: boolean
  // ===== R4-01: 断线重连与会话恢复 =====
  /** 重连时携带的 sessionToken（由 reconnection-manager 持久化）；返回 null/空则全新入场。 */
  sessionToken?: () => string | null | undefined
  /** 服务端下发新 session_token 时回调，供持久化。 */
  onSessionToken?: (token: string) => void
  /** 重连成功且服务端恢复了旧会话时回调（位置/化身已由服务端恢复，无需随机入场）。 */
  onSessionResumed?: (state: ResumedSessionState, replayed: ReplayedMessage[]) => void
}

/**
 * 通用指数退避 WebSocket 封装。
 * - 断线后自动重连：1s -> 2s -> 4s -> ... -> 30s（封顶）。
 * - 连接成功后重置退避时间。
 * - 暴露 status 与 retryCount，供 UI 展示「连接中断，正在重连…（第 N 次）」。
 * - unmount 时彻底关闭，不再重连。
 *
 * R4-01：可选携带 sessionToken 重连，服务端据此恢复位置；
 * 收到 session_token / session_resumed 时通过回调上抛。
 */
export function useReconnectingWebSocket({
  url,
  onMessage,
  onOpen,
  initialDelayMs = 1000,
  maxDelayMs = 30000,
  enabled = true,
  sessionToken,
  onSessionToken,
  onSessionResumed,
}: Options) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<number | null>(null)
  const shouldRunRef = useRef(true)
  const delayRef = useRef(initialDelayMs)
  // R5: 连续重连次数（onclose 自增，onopen 归零）；退避由 nextBackoffDelay 纯函数计算
  const attemptRef = useRef(0)
  const [status, setStatus] = useState<WsStatus>('closed')
  const [retryCount, setRetryCount] = useState(0)

  // 用 ref 持有最新的 url / 回调，避免 effect 因内联函数引用变化而重跑。
  const urlRef = useRef(url)
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const sessionTokenRef = useRef(sessionToken)
  const onSessionTokenRef = useRef(onSessionToken)
  const onSessionResumedRef = useRef(onSessionResumed)
  urlRef.current = url
  onMessageRef.current = onMessage
  onOpenRef.current = onOpen
  sessionTokenRef.current = sessionToken
  onSessionTokenRef.current = onSessionToken
  onSessionResumedRef.current = onSessionResumed

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (!shouldRunRef.current) return
    const base = urlRef.current()
    if (!base) return
    // R4-01: 携带已持久化的 sessionToken 重连，服务端据此恢复位置/化身
    const token = sessionTokenRef.current?.()
    const target = token ? `${base}${base.includes('?') ? '&' : '?'}sessionToken=${encodeURIComponent(token)}` : base

    setStatus('connecting')
    // 防护：若上一个连接仍停留在 CONNECTING/OPEN（尚未触发 onclose），先关闭，
    // 避免握手挂起时连接对象被覆盖而泄漏、累积耗尽浏览器 socket 资源。
    const prev = wsRef.current
    if (prev && (prev.readyState === WebSocket.CONNECTING || prev.readyState === WebSocket.OPEN)) {
      try { prev.onclose = null; prev.close() } catch { /* noop */ }
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(target)
    } catch (err) {
      console.error('[WS] construct failed', err)
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      attemptRef.current = 0
      delayRef.current = initialDelayMs
      setStatus('open')
      setRetryCount(0)
      onOpenRef.current?.(ws)
    }

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data)
      // R4-01: 旁路解析控制消息（session_token / session_resumed），不影响业务 onMessage
      try {
        const parsed = JSON.parse(raw) as { type?: string; token?: string; state?: ResumedSessionState; replayed?: ReplayedMessage[] }
        if (parsed?.type === 'session_token' && typeof parsed.token === 'string') {
          onSessionTokenRef.current?.(parsed.token)
        } else if (parsed?.type === 'session_resumed' && parsed.state) {
          onSessionResumedRef.current?.(parsed.state, parsed.replayed ?? [])
        }
        // R5: 旁路解析禁言状态帧，喂给审核提示总线（不影响业务 onMessage）
        if (parsed?.type === 'mute_status') {
          handleIncomingModerationFrame(parsed as { type?: string; muted?: boolean; mutedUntil?: number; reason?: string })
        }
      } catch { /* 非 JSON 业务帧，忽略 */ }
      try { onMessageRef.current(raw) }
      catch (err) { console.error('[WS] onMessage handler error', err) }
    }

    ws.onerror = () => {
      // error 后浏览器通常会紧跟 close；这里只关，重连逻辑放 onclose。
      try { ws.close() } catch { /* noop */ }
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!shouldRunRef.current) return
      attemptRef.current += 1
      setStatus('reconnecting')
      setRetryCount((n) => n + 1)
      scheduleReconnect()
    }
  }, [initialDelayMs])

  const scheduleReconnect = useCallback(() => {
    clearTimer()
    // R5: 退避由纯函数统一计算（1s/2s/4s/8s 上限 30s）
    const delay = nextBackoffDelay(attemptRef.current, initialDelayMs, maxDelayMs)
    timerRef.current = window.setTimeout(() => {
      connect()
    }, delay)
  }, [connect, clearTimer, initialDelayMs, maxDelayMs])

  useEffect(() => {
    if (!enabled) return
    shouldRunRef.current = true
    delayRef.current = initialDelayMs
    setRetryCount(0)
    connect()
    return () => {
      shouldRunRef.current = false
      clearTimer()
      if (wsRef.current) {
        try { wsRef.current.onclose = null; wsRef.current.close() } catch { /* noop */ }
        wsRef.current = null
      }
    }
  }, [enabled, connect, clearTimer, initialDelayMs])

  const send = useCallback((data: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
      return true
    }
    return false
  }, [])

  return { wsRef: wsRef as RefObject<WebSocket | null>, status, retryCount, send }
}

/**
 * 顶部/底部固定的连接状态 banner 文案。
 * 明黄色，与 ApiHealthBanner 视觉一致。
 */
export function wsStatusLabel(status: WsStatus, retryCount: number): string | null {
  if (status === 'reconnecting') return `连接中断，正在重连…（第 ${retryCount} 次）`
  if (status === 'connecting') return '正在连接…'
  return null
}
