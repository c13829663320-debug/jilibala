// R4-06 玩家档案 / 会话 / 草稿持久化单测（node 环境，注入内存 storage）。
import { describe, it, expect, vi } from 'vitest'
import {
  PROFILE_STORAGE_KEY,
  defaultProfile,
  loadProfile,
  saveProfile,
  updateProfile,
  resetProfile,
  migrateProfile,
  createMemoryStorage,
} from './profile-store'
import {
  saveRoomCode, loadRoomCode, clearRoomCode,
  savePosition, loadPosition, saveSessionToken, loadSessionToken,
} from './session-store'
import { createDraftSaver } from './draft-store'

describe('profile-store 默认值', () => {
  it('空 storage 返回默认档案', () => {
    const p = loadProfile(createMemoryStorage())
    expect(p.nickname).toBe('我')
    expect(p.settings.volume).toBe(0.8)
    expect(p.settings.quality).toBe('auto')
    expect(p.multiplayerTour.done).toBe(false)
  })

  it('null storage（隐私模式）不抛错', () => {
    expect(() => loadProfile(null)).not.toThrow()
    expect(loadProfile(null).nickname).toBe('我')
  })
})

describe('profile-store 保存/加载', () => {
  it('save → load 往返一致', () => {
    const s = createMemoryStorage()
    const p = defaultProfile()
    p.nickname = '小明'
    p.outfit = { top: 'jacket-red' }
    p.settings.volume = 0.5
    saveProfile(p, s)
    const back = loadProfile(s)
    expect(back.nickname).toBe('小明')
    expect(back.outfit.top).toBe('jacket-red')
    expect(back.settings.volume).toBe(0.5)
  })

  it('损坏 JSON 回退默认档案', () => {
    const s = createMemoryStorage()
    s.setItem(PROFILE_STORAGE_KEY, '{{{not json')
    expect(loadProfile(s).nickname).toBe('我')
  })

  it('写满/不可写时 save 返回 false 不抛错', () => {
    const broken = {
      setItem: () => { throw new Error('quota') },
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage
    expect(() => saveProfile(defaultProfile(), broken)).not.toThrow()
    expect(saveProfile(defaultProfile(), broken)).toBe(false)
  })
})

describe('profile-store 迁移', () => {
  it('老存档缺字段 → 合并默认值', () => {
    const legacy = { nickname: '老玩家', settings: { volume: 2 } } // volume 越界、缺 outfit
    const p = migrateProfile(legacy)
    expect(p.nickname).toBe('老玩家')
    expect(p.settings.volume).toBe(1) // 截断到 1
    expect(p.outfit).toEqual({})
    expect(p.settings.voiceEnabled).toBe(true)
    expect(p.multiplayerTour.step).toBe(0)
  })

  it('updateProfile 局部合并（outfit/settings 深合并）', () => {
    const s = createMemoryStorage()
    const base = defaultProfile()
    saveProfile({ ...base, outfit: { accessory: 'cap' }, settings: { ...base.settings, volume: 0.3 } }, s)
    const next = updateProfile({ outfit: { top: 'red' } }, s)
    expect(next.outfit.accessory).toBe('cap')
    expect(next.outfit.top).toBe('red')
    expect(next.settings.volume).toBe(0.3) // 未动
  })

  it('resetProfile 清空并返回默认', () => {
    const s = createMemoryStorage()
    saveProfile({ ...defaultProfile(), nickname: 'x' }, s)
    const p = resetProfile(s)
    expect(p.nickname).toBe('我')
    expect(s.getItem(PROFILE_STORAGE_KEY)).toBeNull()
  })
})

describe('session-store 会话恢复', () => {
  it('房间码存/读/清', () => {
    const s = createMemoryStorage()
    expect(loadRoomCode(s)).toBeNull()
    saveRoomCode('ABC123', s)
    expect(loadRoomCode(s)).toBe('ABC123')
    clearRoomCode(s)
    expect(loadRoomCode(s)).toBeNull()
  })

  it('位置持久化与校验', () => {
    const s = createMemoryStorage()
    expect(loadPosition(s)).toBeNull()
    savePosition({ x: 10, z: -5, rotation: 1.5, at: 'now' }, s)
    const pos = loadPosition(s)
    expect(pos?.x).toBe(10)
    expect(pos?.z).toBe(-5)
    // 损坏数据
    s.setItem('balabala.session.lastPos', '{"x":"bad"}')
    expect(loadPosition(s)).toBeNull()
  })

  it('sessionToken 持久化（R4-01 重连恢复）', () => {
    const s = createMemoryStorage()
    expect(loadSessionToken(s)).toBeNull()
    saveSessionToken('tok-xyz', s)
    expect(loadSessionToken(s)).toBe('tok-xyz')
  })
})

describe('draft-store 草稿自动保存', () => {
  it('debounce 3s 后落盘；flush 立即写', async () => {
    const s = createMemoryStorage()
    // 用假定时器：手动触发回调
    const timers: Array<() => void> = []
    const saver = createDraftSaver<{ desc: string }>({
      storage: s,
      debounceMs: 3000,
      setTimeoutImpl: ((fn: () => void) => { timers.push(fn); return 1 }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
    })
    saver.schedule({ desc: 'hello' })
    expect(saver.isDirty()).toBe(true)
    expect(s.getItem('balabala.scene-draft.v1')).toBeNull() // debounce 未触发
    // 手动触发 debounce 回调
    timers.forEach((t) => t())
    expect(saver.load()).toEqual({ desc: 'hello' })
  })

  it('publish 后 clear 草稿', () => {
    const s = createMemoryStorage()
    const saver = createDraftSaver<{ a: number }>({
      storage: s, debounceMs: 0,
      setTimeoutImpl: ((fn: () => void) => { fn(); return 1 }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => {}) as unknown as typeof clearTimeout,
    })
    saver.schedule({ a: 1 })
    expect(saver.load()).toEqual({ a: 1 })
    saver.clear()
    expect(saver.load()).toBeNull()
  })
})
