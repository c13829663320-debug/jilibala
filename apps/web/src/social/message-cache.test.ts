// ===== R4-07: message-cache 纯逻辑测试 =====
import { describe, it, expect } from 'vitest'
import {
  mergeMessages,
  pushCachedMessage,
  unreadKey,
  createMemoryStorage,
  MessageCache,
  type CachedMessage,
  MAX_CACHED_PER_CONVERSATION,
} from './message-cache'

function msg(id: string, ts: number, from = 'u1', text?: string): CachedMessage {
  return { id, conversationId: 'u1_u2', fromUserId: from, text: text ?? id, timestamp: ts }
}

describe('mergeMessages 去重与排序', () => {
  it('按 timestamp 升序合并', () => {
    const a = [msg('1', 100), msg('2', 200)]
    const b = [msg('3', 150)]
    const out = mergeMessages(a, b)
    expect(out.map((m) => m.id)).toEqual(['1', '3', '2'])
  })

  it('同 id 去重，incoming 覆盖 existing', () => {
    const a = [msg('1', 100, 'u1', '旧')]
    const b = [msg('1', 100, 'u1', '新')]
    const out = mergeMessages(a, b)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('新')
  })

  it('超过 max 条时保留最新', () => {
    const a = Array.from({ length: 10 }, (_, i) => msg(`a${i}`, i))
    const out = mergeMessages(a, [], 5)
    expect(out).toHaveLength(5)
    expect(out[0].id).toBe('a5')
    expect(out[4].id).toBe('a9')
  })
})

describe('pushCachedMessage', () => {
  it('追加新消息并截断', () => {
    const list = [msg('1', 100)]
    const out = pushCachedMessage(list, msg('2', 200))
    expect(out.map((m) => m.id)).toEqual(['1', '2'])
  })
})

describe('unreadKey', () => {
  it('生成带前缀的 key', () => {
    expect(unreadKey('u1_u2')).toBe('balabala:unread:u1_u2')
  })
})

describe('MessageCache 持久化', () => {
  it('append → openConversation 往返一致', async () => {
    const cache = new MessageCache(createMemoryStorage())
    await cache.append('u1_u2', msg('1', 100))
    await cache.append('u1_u2', msg('2', 200))
    const loaded = await cache.openConversation('u1_u2')
    expect(loaded.map((m) => m.id)).toEqual(['1', '2'])
  })

  it('refresh 合并服务端新消息', async () => {
    const cache = new MessageCache(createMemoryStorage())
    await cache.append('u1_u2', msg('1', 100))
    const merged = await cache.refresh('u1_u2', [msg('1', 100, 'u1', '新'), msg('2', 300)])
    expect(merged).toHaveLength(2)
    expect(merged[0].text).toBe('新')
  })

  it('每个会话最多保留 500 条', async () => {
    const cache = new MessageCache(createMemoryStorage())
    for (let i = 0; i < 600; i += 1) {
      await cache.append('u1_u2', msg(`m${i}`, i))
    }
    const loaded = await cache.openConversation('u1_u2')
    expect(loaded.length).toBe(MAX_CACHED_PER_CONVERSATION)
    expect(loaded[0].id).toBe('m100')
  })

  it('未读计数递增/清零', async () => {
    const cache = new MessageCache(createMemoryStorage())
    await cache.incrementUnread('u1_u2')
    await cache.incrementUnread('u1_u2')
    expect(await cache.getUnread('u1_u2')).toBe(2)
    await cache.setUnread('u1_u2', 0)
    expect(await cache.getUnread('u1_u2')).toBe(0)
  })
})
