// ===== Round4 R4-07: 私聊 REST + WS 客户端 =====
import type { PrivateMessage } from '@balabala/shared'

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? ''

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** conversationId 与服务端一致：字典序拼接。 */
export function conversationIdOf(a: string, b: string): string {
  return [a, b].sort().join('_')
}

export const chatApi = {
  history: (userId: string, friendId: string, limit = 50) =>
    json<{ messages: PrivateMessage[] }>(
      `/api/messages/history?userId=${encodeURIComponent(userId)}&friendId=${encodeURIComponent(friendId)}&limit=${limit}`,
    ),
}

/** 构造一条通过 WS 发送的私聊消息（由调用方通过 ws.send 发出）。 */
export function buildPrivateMessageEnvelope(toUserId: string, text: string) {
  return { type: 'private_message', toUserId, text }
}

/** 构造已读回执信封。 */
export function buildReadEnvelope(conversationId: string, lastReadMessageId: string) {
  return { type: 'message_read', conversationId, lastReadMessageId }
}
