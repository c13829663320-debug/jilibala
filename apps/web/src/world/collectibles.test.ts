/**
 * 收集品系统单元测试（纯逻辑，无 WebGL 依赖）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  COLLECTIBLES, collectiblesForScene, RARITY_XP,
  checkProximity, COLLECT_DISTANCE, loadCollected, saveCollected,
} from './collectibles'

// mock localStorage
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    },
    dispatchEvent: () => {},
  } as unknown as Window & typeof globalThis
})

describe('收集品清单', () => {
  it('总共 24 个收集品', () => {
    expect(COLLECTIBLES.length).toBe(24)
  })

  it('每个建筑恰好 3 个收集品', () => {
    for (const b of ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']) {
      expect(collectiblesForScene(b).length).toBe(3)
    }
  })

  it('广场有 6 个收集品', () => {
    expect(collectiblesForScene('plaza').length).toBe(6)
  })

  it('每个 hidden 收集品都有 achievementId', () => {
    const hidden = COLLECTIBLES.filter((c) => c.rarity === 'hidden')
    expect(hidden.length).toBe(7) // 6建筑 + 广场边界
    for (const h of hidden) {
      expect(h.achievementId).toBeTruthy()
    }
  })

  it('id 全局唯一', () => {
    const ids = COLLECTIBLES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('稀有度 XP', () => {
  it('common=10, rare=30, hidden=50', () => {
    expect(RARITY_XP.common).toBe(10)
    expect(RARITY_XP.rare).toBe(30)
    expect(RARITY_XP.hidden).toBe(50)
  })
})

describe('近距离检测', () => {
  const items = [{ id: 't1', scene: 'test', x: 0, y: 1, z: 0, rarity: 'common' as const, name: 'test' }]

  it('距离内返回收集品', () => {
    const result = checkProximity(0, 1, 0, items, new Set())
    expect(result).not.toBeNull()
    expect(result!.id).toBe('t1')
  })

  it('距离外返回 null', () => {
    const result = checkProximity(10, 1, 10, items, new Set())
    expect(result).toBeNull()
  })

  it('已收集的跳过', () => {
    const result = checkProximity(0, 1, 0, items, new Set(['t1']))
    expect(result).toBeNull()
  })

  it('拾取距离常量为 2.0', () => {
    expect(COLLECT_DISTANCE).toBe(2.0)
  })
})

describe('持久化', () => {
  it('loadCollected 初始为空集合', () => {
    const s = loadCollected()
    expect(s.size).toBe(0)
  })

  it('saveCollected 后可读回', () => {
    const s = new Set(['a', 'b'])
    saveCollected(s)
    const loaded = loadCollected()
    expect(loaded.has('a')).toBe(true)
    expect(loaded.has('b')).toBe(true)
    expect(loaded.size).toBe(2)
  })
})
