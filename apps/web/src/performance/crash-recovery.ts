// ===== R5: 崩溃会话恢复（纯逻辑，存储可注入，可在 Node 单测）=====
//
// 崩溃前记录「当前路由 + 场景」快照；恢复时不白屏，而是引导用户回到
// 安全落点（广场 '/'）。仅存最小可恢复信息，不含敏感/个人数据。
//
// storage 默认 window.localStorage；测试时传入内存实现。

import type { CrashSnapshot } from '@balabala/shared'

const STORAGE_KEY = 'balabala.crash-snapshot-v1'

/** 极简存储接口（localStorage 兼容）。 */
export interface KVStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 构造崩溃快照。 */
export function buildCrashSnapshot(route: string, scene: string | null): CrashSnapshot {
  return {
    route,
    scene,
    at: Date.now(),
    safeReturn: '/',
  }
}

/** 持久化崩溃快照。 */
export function recordCrashSnapshot(snapshot: CrashSnapshot, storage: KVStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* 存储不可用（隐私模式）不影响崩溃页渲染 */
  }
}

/** 读取崩溃快照；损坏/过期返回 null。 */
export function loadCrashSnapshot(storage: KVStorage): CrashSnapshot | null {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CrashSnapshot>
    if (typeof parsed.route !== 'string') return null
    // 超过 10 分钟的快照视为过期，不再自动恢复
    if (typeof parsed.at === 'number' && Date.now() - parsed.at > 10 * 60 * 1000) return null
    return {
      route: parsed.route,
      scene: typeof parsed.scene === 'string' ? parsed.scene : null,
      at: parsed.at ?? Date.now(),
      safeReturn: typeof parsed.safeReturn === 'string' ? parsed.safeReturn : '/',
    }
  } catch {
    return null
  }
}

/** 清除快照（恢复完成后调用）。 */
export function clearCrashSnapshot(storage: KVStorage): void {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch { /* noop */ }
}

/**
 * 决定崩溃后应跳转到哪里：优先回到安全落点（广场），而不是停在崩溃的路由。
 */
export function resolveSafeReturn(snapshot: CrashSnapshot | null): string {
  return snapshot?.safeReturn ?? '/'
}

/** 内存存储（测试用）。 */
export function memoryStorage(seed: Record<string, string> = {}): KVStorage {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}
