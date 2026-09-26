/**
 * R4-06 场景工作室草稿自动保存。
 *
 * 未发布的场景草稿存 localStorage，编辑后 debounce 3s 自动落盘；
 * 再次打开工作室时自动恢复。
 *
 * 定时器可注入（测试用假时钟），存储可注入。
 */

import { createMemoryStorage } from './profile-store'

export const DEFAULT_DRAFT_KEY = 'balabala.scene-draft.v1'

export interface DraftSaverOptions {
  storage?: Storage | null
  key?: string
  /** debounce 间隔，默认 3000ms */
  debounceMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

export interface DraftSaver<T> {
  /** 标记有新草稿待保存（高频调用，内部 debounce） */
  schedule: (draft: T) => void
  /** 立即保存（发布前/卸载时） */
  flush: () => void
  /** 读取已存草稿 */
  load: () => T | null
  /** 清空草稿（发布成功后） */
  clear: () => void
  /** 距离上次 flush 后是否还有未保存的修改 */
  isDirty: () => boolean
}

/**
 * 创建一个 debounce 草稿保存器。
 *
 *   const saver = createDraftSaver<SceneDraft>({ key: DEFAULT_DRAFT_KEY })
 *   onChange={(d) => saver.schedule(d)}
 */
export function createDraftSaver<T>(opts: DraftSaverOptions = {}): DraftSaver<T> {
  const store = opts.storage ?? (typeof window !== 'undefined' ? window.localStorage : createMemoryStorage())
  const key = opts.key ?? DEFAULT_DRAFT_KEY
  const debounceMs = opts.debounceMs ?? 3000
  const setT = opts.setTimeoutImpl ?? setTimeout
  const clearT = opts.clearTimeoutImpl ?? clearTimeout

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null
  let dirty = false

  const write = () => {
    timer = null
    if (pending == null) return
    try {
      store.setItem(key, JSON.stringify(pending))
    } catch { /* 隐私模式/配额满 */ }
    pending = null
    dirty = false
  }

  const schedule = (draft: T) => {
    pending = draft
    dirty = true
    if (timer) clearT(timer)
    timer = setT(write, debounceMs)
  }

  const flush = () => {
    if (timer) clearT(timer)
    write()
  }

  const load = (): T | null => {
    try {
      const raw = store.getItem(key)
      if (!raw) return null
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  const clear = () => {
    if (timer) clearT(timer)
    timer = null
    pending = null
    dirty = false
    try { store.removeItem(key) } catch { /* noop */ }
  }

  return { schedule, flush, load, clear, isDirty: () => dirty }
}
