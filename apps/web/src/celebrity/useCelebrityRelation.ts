// ===== R5: 名人关系 hook（localStorage 持久化） =====
// 记录与每位名人的结识/好感/互动次数；首次互动自动 stranger→acquainted。
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  levelForAffection,
  nextAffection,
  type CelebrityRelation,
} from '@balabala/shared'

const STORAGE_KEY = 'balabala.r5.celebrity-relations'

export type RelationMap = Record<string, CelebrityRelation>

function load(): RelationMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as RelationMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function emptyRelation(celebrityId: string): CelebrityRelation {
  const now = new Date().toISOString()
  return {
    celebrityId,
    acquaintanceLevel: 'stranger',
    affection: 0,
    unlockedTopics: [],
    unlockedLines: [],
    metAt: now,
    lastInteractionAt: now,
    interactionCount: 0,
  }
}

export interface RecordInteractionOptions {
  /** 互动场景：hall / court / talkshow / plaza … */
  scene?: string
  /** 是否首次主动深聊（首次对话即视为结识）。 */
  deep?: boolean
}

export interface UseCelebrityRelation {
  relations: RelationMap
  getRelation: (celebrityId: string) => CelebrityRelation | undefined
  /** 记录一次互动：自动结识、累加好感、升级档位。返回更新后的关系。 */
  recordInteraction: (celebrityId: string, opts?: RecordInteractionOptions) => CelebrityRelation
  /** 仅查询某名人是否已结识。 */
  isMet: (celebrityId: string) => boolean
  reset: () => void
}

export function useCelebrityRelation(): UseCelebrityRelation {
  const [relations, setRelations] = useState<RelationMap>(load)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(relations))
    } catch {
      /* storage unavailable */
    }
  }, [relations])

  const getRelation = useCallback(
    (celebrityId: string) => relations[celebrityId],
    [relations],
  )

  const recordInteraction = useCallback(
    (celebrityId: string, opts: RecordInteractionOptions = {}) => {
      const now = new Date().toISOString()
      let updated!: CelebrityRelation
      setRelations((prev) => {
        const existing = prev[celebrityId]
        const count = (existing?.interactionCount ?? 0) + 1
        // 首次互动：从无到有 → 直接落到 acquainted，基础好感 10。
        const base = existing ? existing.affection : 10
        const affection = existing ? nextAffection(existing.affection, existing.interactionCount) : base
        updated = {
          celebrityId,
          acquaintanceLevel: existing
            ? levelForAffection(affection)
            : 'acquainted',
          affection,
          unlockedTopics: existing?.unlockedTopics ?? [],
          unlockedLines: existing?.unlockedLines ?? [],
          metAt: existing?.metAt ?? now,
          lastInteractionAt: now,
          interactionCount: count,
        }
        return { ...prev, [celebrityId]: updated }
      })
      // setRelations 是异步的，这里立即返回一份同步结果（供调用方当次使用）。
      if (!updated) {
        updated = {
          celebrityId,
          acquaintanceLevel: 'acquainted',
          affection: 10,
          unlockedTopics: [],
          unlockedLines: [],
          metAt: now,
          lastInteractionAt: now,
          interactionCount: 1,
        }
      }
      return updated
    },
    [],
  )

  const isMet = useCallback(
    (celebrityId: string) => {
      const r = relations[celebrityId]
      return !!r && r.acquaintanceLevel !== 'stranger'
    },
    [relations],
  )

  const reset = useCallback(() => setRelations({}), [])

  return useMemo(
    () => ({ relations, getRelation, recordInteraction, isMet, reset }),
    [relations, getRelation, recordInteraction, isMet, reset],
  )
}
