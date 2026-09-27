// ===== R5: 名人记忆 hook（localStorage 持久化「我们的回忆」） =====
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CelebrityMemory, CelebrityMemoryItem, MemoryImportance } from '@balabala/shared'
import { scoreMemoryImportance, type MemorySignals } from './memoryImportance'

const STORAGE_KEY = 'balabala.r5.celebrity-memories'

export type MemoryMap = Record<string, CelebrityMemory>

function load(): MemoryMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as MemoryMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export interface AddMemoryInput extends MemorySignals {
  /** 记忆正文（一句话摘要）。 */
  text: string
}

export interface UseCelebrityMemory {
  memories: MemoryMap
  /** 取某名人的全部记忆（按时间新→旧）。 */
  getMemories: (celebrityId: string) => CelebrityMemoryItem[]
  /** 记录一条记忆；importance 缺省时按信号自动评分。 */
  addMemory: (celebrityId: string, input: AddMemoryInput) => CelebrityMemoryItem
  clear: (celebrityId: string) => void
}

export function useCelebrityMemory(): UseCelebrityMemory {
  const [memories, setMemories] = useState<MemoryMap>(load)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memories))
    } catch {
      /* ignore */
    }
  }, [memories])

  const getMemories = useCallback(
    (celebrityId: string) =>
      (memories[celebrityId]?.memories ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [memories],
  )

  const addMemory = useCallback((celebrityId: string, input: AddMemoryInput) => {
    const importance: MemoryImportance = scoreMemoryImportance(input)
    const item: CelebrityMemoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: input.text,
      context: input.scene ?? 'hall',
      createdAt: new Date().toISOString(),
      importance,
    }
    setMemories((prev) => {
      const existing = prev[celebrityId]?.memories ?? []
      // 最多保留 50 条，5 星重要性优先保留：超出时丢弃最低重要性中最早的一条。
      const merged = [...existing, item]
      merged.sort((a, b) => a.importance - b.importance || a.createdAt.localeCompare(b.createdAt))
      const trimmed = merged.length > 50 ? merged.slice(merged.length - 50) : merged
      return { ...prev, [celebrityId]: { celebrityId, memories: trimmed } }
    })
    return item
  }, [])

  const clear = useCallback((celebrityId: string) => {
    setMemories((prev) => {
      const next = { ...prev }
      delete next[celebrityId]
      return next
    })
  }, [])

  return useMemo(
    () => ({ memories, getMemories, addMemory, clear }),
    [memories, getMemories, addMemory, clear],
  )
}
