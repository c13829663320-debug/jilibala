// ===== Round4 R4-07: 私聊窗口 =====
// 功能：历史消息加载 / 发送 / 已读回执 / 进入会话先读缓存再拉服务端。
// 品牌色：纯黑底 + 明黄 #FFD600 + 青绿 #4fb3a5。
// 注：云端无 GPU，UI 仅做组件实现，需真机确认。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PrivateMessage } from '@balabala/shared'
import { chatApi, conversationIdOf, buildPrivateMessageEnvelope, buildReadEnvelope } from './chat-store'
import { MessageCache, type CachedMessage } from './message-cache'

export interface PrivateChatProps {
  userId: string
  friend: { userId: string; nickname: string }
  /** 发送 WS 消息的函数（由外层注入，复用全局 WS 连接）。 */
  sendWs: (msg: unknown) => void
  /** 收到 WS private_message / message_read 事件时触发。 */
  wsEvent?: { type: string; message?: PrivateMessage; at: number } | null
  onClose?: () => void
}

export function PrivateChat({ userId, friend, sendWs, wsEvent, onClose }: PrivateChatProps) {
  const convId = conversationIdOf(userId, friend.userId)
  const [messages, setMessages] = useState<PrivateMessage[]>([])
  const [draft, setDraft] = useState('')
  const cacheRef = useRef<MessageCache>()
  if (!cacheRef.current) cacheRef.current = new MessageCache()

  // 进入会话：先显示缓存，再拉服务端合并
  const load = useCallback(async () => {
    const cache = cacheRef.current!
    const cached = await cache.openConversation(convId)
    setMessages(cached.map((c) => ({
      messageId: c.id,
      conversationId: convId,
      fromUserId: c.fromUserId,
      toUserId: c.fromUserId === userId ? friend.userId : userId,
      text: c.text,
      timestamp: new Date(c.timestamp).toISOString(),
    })))
    try {
      const { messages: fresh } = await chatApi.history(userId, friend.userId, 50)
      setMessages(fresh)
      await cache.refresh(convId, fresh.map((m) => ({
        id: m.messageId,
        conversationId: convId,
        fromUserId: m.fromUserId,
        text: m.text,
        timestamp: new Date(m.timestamp).getTime(),
      })))
      // 打开会话即标记已读
      const last = fresh[fresh.length - 1]
      if (last) sendWs(buildReadEnvelope(convId, last.messageId))
      await cache.setUnread(convId, 0)
    } catch {
      /* 服务端不可用时保持缓存 */
    }
  }, [convId, userId, friend.userId])

  useEffect(() => { load() }, [load])

  // 收到新消息（WS）
  useEffect(() => {
    if (!wsEvent) return
    if (wsEvent.type === 'private_message' && wsEvent.message) {
      const m = wsEvent.message
      if (m.conversationId !== convId) return
      setMessages((prev) => [...prev, m])
      void cacheRef.current!.append(convId, {
        id: m.messageId, conversationId: convId, fromUserId: m.fromUserId, text: m.text,
        timestamp: new Date(m.timestamp).getTime(),
      })
      sendWs(buildReadEnvelope(convId, m.messageId))
    }
  }, [wsEvent, convId, sendWs])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    sendWs(buildPrivateMessageEnvelope(friend.userId, text))
    setDraft('')
  }

  return (
    <div style={styles.window}>
      <header style={styles.header}>
        <span style={styles.headerTitle}>与 {friend.nickname} 的私聊</span>
        <button style={styles.closeBtn} onClick={onClose}>×</button>
      </header>
      <div style={styles.msgList}>
        {messages.map((m) => (
          <div key={m.messageId} style={{ ...styles.msgRow, ...(m.fromUserId === userId ? styles.mine : styles.theirs) }}>
            <span style={styles.bubble}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
          placeholder="发消息…"
        />
        <button style={styles.sendBtn} onClick={send}>发送</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  window: {
    background: '#000',
    color: '#EDEDF0',
    border: '1px solid #FFD600',
    borderRadius: 12,
    width: 320,
    height: 420,
    display: 'flex',
    flexDirection: 'column',
    fontSize: 13,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.1)' },
  headerTitle: { color: '#FFD600', fontWeight: 600 },
  closeBtn: { background: 'transparent', border: 'none', color: '#EDEDF0', fontSize: 18, cursor: 'pointer' },
  msgList: { flex: 1, overflowY: 'auto', padding: 8 },
  msgRow: { display: 'flex', marginBottom: 4 },
  mine: { justifyContent: 'flex-end' },
  theirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', padding: '6px 10px', borderRadius: 10, background: '#1a1a1a' },
  inputRow: { display: 'flex', gap: 6, padding: 8, borderTop: '1px solid rgba(255,255,255,.1)' },
  input: { flex: 1, background: '#141414', border: '1px solid rgba(255,255,255,.15)', color: '#EDEDF0', borderRadius: 8, padding: '6px 10px', outline: 'none' },
  sendBtn: { background: '#FFD600', border: 'none', color: '#000', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600 },
}
