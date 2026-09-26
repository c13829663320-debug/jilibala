// ===== 分片6: 统一人物列表 / 搜索 / 详情 / 关注 前端 hook =====
import { useCallback, useEffect, useState } from 'react'
import type { CharacterProfile, PlayerPublicProfile } from '@balabala/shared'

export interface UnifiedListResult {
  items: CharacterProfile[]
  total: number
  page: number
  limit: number
  tags: Array<{ tag: string; count: number }>
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

async function sendJson(url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`请求失败 ${res.status}`)
  return res.json()
}

/**
 * 拉取统一人物列表（名人 + 公开自定义人物），支持关键词 / 标签 / 来源 / 分页。
 */
export function useUnifiedCharacters(params: {
  q?: string
  tag?: string
  source?: string
  page?: number
  limit?: number
} = {}) {
  const [data, setData] = useState<UnifiedListResult>({ items: [], total: 0, page: 1, limit: 20, tags: [] })
  const [loading, setLoading] = useState(false)

  const { q, tag, source, page, limit } = params

  const reload = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (q) qs.set('q', q)
    if (tag) qs.set('tag', tag)
    if (source) qs.set('source', source)
    qs.set('page', String(page ?? 1))
    qs.set('limit', String(limit ?? 20))
    getJson(`/api/characters/unified?${qs.toString()}`)
      .then((d: UnifiedListResult) => setData(d))
      .catch(() => setData((prev) => ({ ...prev, items: [], total: 0 })))
      .finally(() => setLoading(false))
  }, [q, tag, source, page, limit])

  useEffect(() => { reload() }, [reload])

  return { ...data, loading, reload }
}

/** 拉取单个人物详情（含当前用户是否已关注）。 */
export async function fetchCharacterProfile(id: string, userId?: string): Promise<{ profile: CharacterProfile; followed: boolean } | null> {
  try {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : ''
    const d = await getJson(`/api/characters/${encodeURIComponent(id)}/profile${qs}`)
    return d as { profile: CharacterProfile; followed: boolean }
  } catch {
    return null
  }
}

/** 关注 / 取消关注人物。 */
export async function toggleFollow(characterId: string, userId: string, follow: boolean): Promise<number> {
  const method = follow ? 'POST' : 'DELETE'
  const d = await sendJson(`/api/characters/${encodeURIComponent(characterId)}/follow`, method, { userId })
  return d.followers as number
}

/** 拉取我关注的人物列表。 */
export async function fetchFollowing(userId: string): Promise<CharacterProfile[]> {
  try {
    const d = await getJson(`/api/characters/following?userId=${encodeURIComponent(userId)}`)
    return (d.characters ?? []) as CharacterProfile[]
  } catch {
    return []
  }
}

/** 拉取玩家公开档案。 */
export async function fetchPlayerProfile(userId: string): Promise<PlayerPublicProfile | null> {
  try {
    const d = await getJson(`/api/players/${encodeURIComponent(userId)}/profile`)
    return d.profile as PlayerPublicProfile
  } catch {
    return null
  }
}
