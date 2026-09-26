// ===== 分片5: 屏蔽 / 静音 / 举报 前端 hook =====
// 封装 REST 调用 + 本地状态缓存。进入广场时按当前 userId 拉取一次
// 「我屏蔽的」「我静音的」id 集合，供化身隐藏 / 语音静音 / 消息过滤使用。
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BlockRelation, MuteRelation, Report } from '@balabala/shared'

async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

export interface ModerationState {
  blockedIds: Set<string>
  mutedIds: Set<string>
  reload: () => void
  block: (targetUserId: string, reason?: string) => Promise<void>
  unblock: (targetUserId: string) => Promise<void>
  mute: (targetUserId: string, reason?: string) => Promise<void>
  unmute: (targetUserId: string) => Promise<void>
  report: (input: { targetType: 'user' | 'content' | 'avatar'; targetId: string; reason: string; detail?: string }) => Promise<Report>
  isBlocked: (targetUserId: string) => boolean
  isMuted: (targetUserId: string) => boolean
}

/**
 * 订阅当前用户的屏蔽/静音列表，并提供操作函数。
 * @param userId 当前玩家 userId（未登录为空时返回空集合）。
 */
export function useModeration(userId: string): ModerationState {
  const [blocked, setBlocked] = useState<BlockRelation[]>([])
  const [muted, setMuted] = useState<MuteRelation[]>([])

  const reload = useCallback(() => {
    if (!userId) return
    jsonFetch(`/api/moderation/blocked?userId=${encodeURIComponent(userId)}`)
      .then((d) => setBlocked(d.blocked ?? []))
      .catch(() => {})
    jsonFetch(`/api/moderation/muted?userId=${encodeURIComponent(userId)}`)
      .then((d) => setMuted(d.muted ?? []))
      .catch(() => {})
  }, [userId])

  useEffect(() => {
    reload()
  }, [reload])

  const block = useCallback(async (targetUserId: string, reason?: string) => {
    if (!userId) return
    await jsonFetch('/api/moderation/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, targetUserId, reason }),
    })
    reload()
  }, [userId, reload])

  const unblock = useCallback(async (targetUserId: string) => {
    if (!userId) return
    await jsonFetch('/api/moderation/block', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, targetUserId }),
    })
    reload()
  }, [userId, reload])

  const mute = useCallback(async (targetUserId: string, reason?: string) => {
    if (!userId) return
    await jsonFetch('/api/moderation/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, targetUserId, reason }),
    })
    reload()
  }, [userId, reload])

  const unmute = useCallback(async (targetUserId: string) => {
    if (!userId) return
    await jsonFetch('/api/moderation/mute', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, targetUserId }),
    })
    reload()
  }, [userId, reload])

  const report = useCallback(async (input: { targetType: 'user' | 'content' | 'avatar'; targetId: string; reason: string; detail?: string }) => {
    if (!userId) throw new Error('未登录')
    const d = await jsonFetch('/api/moderation/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporterId: userId, ...input }),
    })
    return d.report as Report
  }, [userId])

  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.targetId)), [blocked])
  const mutedIds = useMemo(() => new Set(muted.map((m) => m.targetId)), [muted])
  const isBlocked = useCallback((id: string) => blockedIds.has(id), [blockedIds])
  const isMuted = useCallback((id: string) => mutedIds.has(id), [mutedIds])

  return { blockedIds, mutedIds, reload, block, unblock, mute, unmute, report, isBlocked, isMuted }
}
