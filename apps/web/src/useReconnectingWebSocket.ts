import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

/** 重连进度阶段（与服务端 ReconnectProgress.stage 对齐）。 */
export type ReconnectStage = 'resuming' | 'replaying' | 'syncing_state' | 'done' | null

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
}

/**
 * 通用指数退避 WebSocket 封装（传输层增强版）。
 * - 断线后自动重连：1s -> 2s -> 4s -> ... -> 30s（封顶），退避间隔叠加 ±20% 抖动。
 * - 连接成功后重置退避时间。
 * - 自动从 welcome 抓取 sessionToken；重连时在 URL 上携带 sessionId/lastServerSeq，
 *   由服务端决定是恢复会话（补发在途消息）还是全新连接。
 * - 暴露 reconnectStage / reconnectProgress，供 UI 展示「正在恢复会话…」。
 * - unmount 时彻底关闭，不再重连。
 */
export function useReconnectingWebSocket({
  url,
  onMessage,
  onOpen,
  initialDelayMs = 1000,
  maxDelayMs = 30000,
  enabled = true,
}: Options) {
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<number | null>(null)
  const shouldRunRef = useRef(true)
  const delayRef = useRef(initialDelayMs)
  const [status, setStatus] = useState<WsStatus>('closed')
  const [retryCount, setRetryCount] = useState(0)
  // —— 传输层：会话与重连进度 ——
  const [reconnectStage, setReconnectStage] = useState<ReconnectStage>(null)
  const [reconnectProgress, setReconnectProgress] = useState(0)
  const sessionRef = useRef<{ sessionId: string; lastServerSeq: number } | null>(null)

  // 用 ref 持有最新的 url / 回调，避免 effect 因内联函数引用变化而重跑。
  const urlRef = useRef(url)
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  urlRef.current = url
  onMessageRef.current = onMessage
  onOpenRef.current = onOpen

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 构造带重连参数的 URL：有保存的会话则携带 sessionId/lastServerSeq。 */
  const buildUrl = useCallback((): string | null => {
    const base = urlRef.current()
    if (!base) return null
    const sess = sessionRef.current
    if (!sess) return base
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}sessionId=${encodeURIComponent(sess.sessionId)}&lastServerSeq=${sess.lastServerSeq}`
  }, [])

  const connect = useCallback(() => {
    if (!shouldRunRef.current) return
    const target = buildUrl()
    if (!target) return

    setStatus('connecting')
    // 防护：若上一个连接仍停留在 CONNECTING/OPEN（尚未触发 onclose），先关闭。
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
      delayRef.current = initialDelayMs
      setStatus('open')
      setRetryCount(0)
      onOpenRef.current?.(ws)
    }

    ws.onmessage = (ev) => {
      // —— 传输层：先拦截控制帧（welcome 抓 token / reconnect_progress / reconnect_response） ——
      try {
        const text = typeof ev.data === 'string' ? ev.data : String(ev.data)
        let parsed: { type?: string; sessionToken?: { sessionId: string }; stage?: ReconnectStage; progress?: number } | null = null
        try { parsed = JSON.parse(text) } catch { /* ignore non-json */ }
        if (parsed?.type === 'welcome' && parsed.sessionToken?.sessionId) {
          sessionRef.current = { sessionId: parsed.sessionToken.sessionId, lastServerSeq: 0 }
        } else if (parsed?.type === 'reconnect_progress' && parsed.stage) {
          setReconnectStage(parsed.stage)
          if (typeof parsed.progress === 'number') setReconnectProgress(parsed.progress)
          if (parsed.stage === 'done') {
            // 恢复完成后短暂展示再清空
            window.setTimeout(() => setReconnectStage(null), 800)
          }
        } else if (parsed?.type === 'reconnect_response') {
          const r = parsed as unknown as { accepted: boolean; sessionId: string }
          if (r.accepted) {
            sessionRef.current = { sessionId: r.sessionId, lastServerSeq: sessionRef.current?.lastServerSeq ?? 0 }
          } else {
            // 服务端判定会话过期：丢弃 token，后续按全新连接。
            sessionRef.current = null
          }
        }
      } catch { /* noop */ }

      try { onMessageRef.current(typeof ev.data === 'string' ? ev.data : String(ev.data)) }
      catch (err) { console.error('[WS] onMessage handler error', err) }
    }

    ws.onerror = () => {
      try { ws.close() } catch { /* noop */ }
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!shouldRunRef.current) return
      setStatus('reconnecting')
      setRetryCount((n) => n + 1)
      scheduleReconnect()
    }
  }, [buildUrl, initialDelayMs])

  const scheduleReconnect = useCallback(() => {
    clearTimer()
    // 指数退避 + ±20% 抖动：避免大量客户端同时重连形成惊群。
    const base = delayRef.current
    const jitter = base * 0.2
    const delay = Math.max(0, base + (Math.random() * 2 - 1) * jitter)
    timerRef.current = window.setTimeout(() => {
      delayRef.current = Math.min(base * 2, maxDelayMs)
      connect()
    }, delay)
  }, [connect, clearTimer, maxDelayMs])

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

  return {
    wsRef: wsRef as RefObject<WebSocket | null>,
    status,
    retryCount,
    send,
    reconnectStage,
    reconnectProgress,
  }
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
