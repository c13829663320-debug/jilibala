/**
 * R4-06 玩家档案本地持久化（localStorage, key=balabala_profile_v1）。
 *
 * 存：昵称、化身配置、换装状态（R4-03 outfit）、设置（音量/画质）、
 * 多人新手引导进度。
 *
 * - 所有读写接受可选 Storage 注入（默认 window.localStorage），
 *   node/vitest 下可传内存 storage 跑纯逻辑单测；
 * - JSON 序列化 + try/catch：隐私模式 / 配额满时静默降级为内存档案，不抛异常；
 * - loadProfile 做字段迁移：老存档缺字段时合并默认值，向前兼容。
 */
import { useEffect, useState } from 'react'
import type { PlayerProfile } from '@balabala/shared'

export const PROFILE_STORAGE_KEY = 'balabala_profile_v1'

export function defaultProfile(): PlayerProfile {
  return {
    nickname: '我',
    avatarType: 'capsule',
    avatarRef: '',
    outfit: {},
    settings: { volume: 0.8, voiceEnabled: true, quality: 'auto', shadows: true },
    multiplayerTour: { done: false, step: 0, skipped: false },
    lastRoomCode: null,
    updatedAt: null,
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** 把任意已解析对象迁移成合法 PlayerProfile（缺字段补默认）。 */
export function migrateProfile(raw: unknown): PlayerProfile {
  const base = defaultProfile()
  if (!raw || typeof raw !== 'object') return base
  const p = raw as Partial<PlayerProfile>
  return {
    nickname: typeof p.nickname === 'string' && p.nickname ? p.nickname : base.nickname,
    avatarType: (['capsule', 'celebrity', 'custom', 'photo'] as const).includes(
      p.avatarType as PlayerProfile['avatarType'],
    )
      ? (p.avatarType as PlayerProfile['avatarType'])
      : base.avatarType,
    avatarRef: typeof p.avatarRef === 'string' ? p.avatarRef : '',
    outfit: p.outfit && typeof p.outfit === 'object' ? (p.outfit as Record<string, unknown>) : {},
    settings: {
      volume:
        typeof p.settings?.volume === 'number'
          ? Math.min(1, Math.max(0, p.settings.volume))
          : base.settings.volume,
      voiceEnabled: p.settings?.voiceEnabled !== false,
      quality:
        p.settings?.quality === 'low' || p.settings?.quality === 'high'
          ? p.settings.quality
          : 'auto',
      shadows: p.settings?.shadows !== false,
    },
    multiplayerTour: {
      done: p.multiplayerTour?.done === true,
      step:
        typeof p.multiplayerTour?.step === 'number'
          ? Math.max(0, Math.min(4, Math.floor(p.multiplayerTour.step)))
          : 0,
      skipped: p.multiplayerTour?.skipped === true,
      completedAt:
        typeof p.multiplayerTour?.completedAt === 'string'
          ? p.multiplayerTour.completedAt
          : undefined,
    },
    lastRoomCode: typeof p.lastRoomCode === 'string' ? p.lastRoomCode : null,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null,
  }
}

/** 读取档案；损坏/缺失/隐私模式均返回默认档案（绝不抛错）。 */
export function loadProfile(storage?: Storage | null): PlayerProfile {
  const store = storage ?? defaultStorage()
  if (!store) return defaultProfile()
  try {
    const raw = store.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return defaultProfile()
    return migrateProfile(JSON.parse(raw))
  } catch {
    return defaultProfile()
  }
}

/** 写档案；序列化失败/存储不可用静默忽略。返回是否成功。 */
export function saveProfile(profile: PlayerProfile, storage?: Storage | null): boolean {
  const store = storage ?? defaultStorage()
  if (!store) return false
  try {
    store.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }),
    )
    return true
  } catch {
    return false
  }
}

/** 局部更新档案（读-改-写），返回最新档案。 */
export function updateProfile(
  patch: Partial<PlayerProfile>,
  storage?: Storage | null,
): PlayerProfile {
  const current = loadProfile(storage)
  const next: PlayerProfile = {
    ...current,
    ...patch,
    outfit: { ...current.outfit, ...(patch.outfit ?? {}) },
    settings: { ...current.settings, ...(patch.settings ?? {}) },
    multiplayerTour: { ...current.multiplayerTour, ...(patch.multiplayerTour ?? {}) },
  }
  saveProfile(next, storage)
  return next
}

/** 清空档案（设置里「重置引导/重置档案」用）。 */
export function resetProfile(storage?: Storage | null): PlayerProfile {
  const store = storage ?? defaultStorage()
  try {
    store?.removeItem(PROFILE_STORAGE_KEY)
  } catch {
    /* noop */
  }
  return defaultProfile()
}

/** 内存 Storage 实现（测试 / SSR 兜底用）。 */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
  }
}

/**
 * 响应式 hook：读取档案并在本地状态中维护；调用返回的 set/update 会同时
 * 写入 localStorage 并触发重渲染。
 */
export function useProfile(storage?: Storage | null): {
  profile: PlayerProfile
  update: (patch: Partial<PlayerProfile>) => PlayerProfile
  reset: () => void
} {
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile(storage))

  useEffect(() => {
    // 跨标签页同步：其它标签改了档案，本页跟着更新
    const onStorage = (e: StorageEvent) => {
      if (e.key === PROFILE_STORAGE_KEY) setProfile(loadProfile(storage))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storage])

  const update = (patch: Partial<PlayerProfile>) => {
    const next = updateProfile(patch, storage)
    setProfile(next)
    return next
  }
  const reset = () => {
    resetProfile(storage)
    setProfile(defaultProfile())
  }
  return { profile, update, reset }
}
