// ===== R5: 邀约名人进入玩法（已结识名人可被拉进法庭/狼人杀等） =====
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CelebrityInvite } from '@balabala/shared'
import type { RelationMap } from './useCelebrityRelation'

const STORAGE_KEY = 'balabala.r5.celebrity-invites'

export type InviteMap = Record<string, CelebrityInvite[]>

function load(): InviteMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as InviteMap
  } catch {
    return {}
  }
}

export interface UseCelebrityInvite {
  invites: InviteMap
  /**
   * 发起邀约。仅已结识（acquainted 以上）可被邀约；
   * 返回 true=已加入待办，false=关系不足。玩法域消费后应调用 respond。
   */
  invite: (celebrityId: string, targetScene: string, relations: RelationMap) => boolean
  respond: (celebrityId: string, accepted: boolean) => void
  /** 某场景下已接受的名人 id 列表（玩法域把他们加进参与者列表）。 */
  acceptedForScene: (scene: string) => string[]
  clear: () => void
}

export function useCelebrityInvite(): UseCelebrityInvite {
  const [invites, setInvites] = useState<InviteMap>(load)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(invites))
    } catch {
      /* ignore */
    }
  }, [invites])

  const invite = useCallback(
    (celebrityId: string, targetScene: string, relations: RelationMap): boolean => {
      const r = relations[celebrityId]
      if (!r || r.acquaintanceLevel === 'stranger') return false
      const entry: CelebrityInvite = {
        celebrityId,
        targetScene,
        status: 'pending',
        invitedAt: new Date().toISOString(),
      }
      setInvites((prev) => ({ ...prev, [celebrityId]: [...(prev[celebrityId] ?? []), entry] }))
      return true
    },
    [],
  )

  const respond = useCallback((celebrityId: string, accepted: boolean) => {
    setInvites((prev) => {
      const list = prev[celebrityId] ?? []
      if (list.length === 0) return prev
      // 回复最近一条 pending。
      const idx = list.map((i) => i.status).lastIndexOf('pending')
      if (idx < 0) return prev
      const copy = list.slice()
      copy[idx] = { ...copy[idx], status: accepted ? 'accepted' : 'declined', respondedAt: new Date().toISOString() }
      return { ...prev, [celebrityId]: copy }
    })
  }, [])

  const acceptedForScene = useCallback(
    (scene: string) =>
      Object.entries(invites)
        .flatMap(([id, list]) => list.filter((i) => i.status === 'accepted' && i.targetScene === scene).map(() => id)),
    [invites],
  )

  const clear = useCallback(() => setInvites({}), [])

  return useMemo(
    () => ({ invites, invite, respond, acceptedForScene, clear }),
    [invites, invite, respond, acceptedForScene, clear],
  )
}
