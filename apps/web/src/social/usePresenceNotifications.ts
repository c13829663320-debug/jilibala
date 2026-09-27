// ===== R5: 好友在线状态 toast 通知 =====
//
// 复用已有 friend_online / friend_offline WS 消息（服务端 R4-07 已广播）。
// 可在设置中关闭；开关持久化 localStorage。
// 云端无浏览器，toast 渲染由外层消费本 hook 返回的 toasts 数组。

import { useCallback, useEffect, useRef, useState } from 'react'

const SETTINGS_KEY = 'balabala_presence_notifications_v1'
const TOAST_TTL_MS = 4000

export interface PresenceToast {
  id: string
  kind: 'online' | 'offline'
  userId: string
  at: number
}

export interface PresenceNotificationOptions {
  /** 保留位：预留给未来扩展（如静音时段）。 */
  _reserved?: never
}

export interface UsePresenceNotificationsResult {
  toasts: PresenceToast[]
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** 外层在收到 WS friend_online / friend_offline 帧时调用。 */
  onPresenceMessage: (msg: { type: string; userId: string; roomCode?: string }) => void
  dismiss: (id: string) => void
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== 'off'
  } catch {
    return true
  }
}

export function usePresenceNotifications(_options: PresenceNotificationOptions = {}): UsePresenceNotificationsResult {
  const [toasts, setToasts] = useState<PresenceToast[]>([])
  const [enabled, setEnabledState] = useState<boolean>(loadEnabled)
  const timers = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const t of timers.current) window.clearTimeout(t)
    }
  }, [])

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on)
    try { localStorage.setItem(SETTINGS_KEY, on ? 'on' : 'off') } catch { /* noop */ }
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const onPresenceMessage = useCallback((msg: { type: string; userId: string }) => {
    if (!enabled) return
    if (msg.type !== 'friend_online' && msg.type !== 'friend_offline') return
    const toast: PresenceToast = {
      id: `${msg.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: msg.type === 'friend_online' ? 'online' : 'offline',
      userId: msg.userId,
      at: Date.now(),
    }
    setToasts((prev) => [...prev.slice(-4), toast]) // 最多保留 5 条
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_TTL_MS)
    timers.current.push(timer)
  }, [enabled, dismiss])

  return {
    toasts,
    enabled,
    setEnabled,
    onPresenceMessage,
    dismiss,
  }
}
