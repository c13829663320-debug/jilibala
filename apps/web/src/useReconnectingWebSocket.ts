import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'

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
}

/**
 * 通用指数退避 WebSocket 封装。
 * - 断线后自动重连：1s -> 2s -> 4s -> ... -> 30s（封顶）。
 * - 连接成功后重置退避时间。
 * - 暴露 status 与 retryCount，供 UI 展示「连接中断，正在重连…（第 N 次）」。
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

  const connect = useCallback(() => {
    if (!shouldRunRef.current) return
    const target = urlRef.current()
    if (!target) return

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
      delayRef.current = initialDelayMs
      setStatus('open')
      setRetryCount(0)
      onOpenRef.current?.(ws)
    }

    ws.onmessage = (ev) => {
      try { onMessageRef.current(typeof ev.data === 'string' ? ev.data : String(ev.data)) }
      catch (err) { console.error('[WS] onMessage handler error', err) }
    }

    ws.onerror = () => {
      // error 后浏览器通常会紧跟 close；这里只关，重连逻辑放 onclose。
      try { ws.close() } catch { /* noop */ }
    }

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null
      if (!shouldRunRef.current) return
      setStatus('reconnecting')
      setRetryCount((n) => n + 1)
      scheduleReconnect()
    }
  }, [initialDelayMs])

  const scheduleReconnect = useCallback(() => {
    clearTimer()
    const delay = delayRef.current
    timerRef.current = window.setTimeout(() => {
      delayRef.current = Math.min(delay * 2, maxDelayMs)
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
