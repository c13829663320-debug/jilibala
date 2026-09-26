// ===== outfit-system 纯逻辑单测（Node 环境，内存存储） =====
import { describe, expect, it } from 'vitest'
import {
  OUTFIT_CATALOG,
  OUTFIT_LAYERS,
  DEFAULT_OUTFIT,
  createDefaultOutfit,
  getOptionMeta,
  isValidOption,
  loadOutfit,
  normalizeOutfit,
  saveOutfit,
  setLayer,
  validateOutfit,
  type OutfitStorage,
} from './outfit-system'

/** 内存存储（模拟 localStorage） */
function memStorage(): OutfitStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  }
}

describe('换装分层：目录与默认值', () => {
  it('包含全部 5 个分层：base/top/bottom/accessory/hair', () => {
    expect([...OUTFIT_LAYERS]).toEqual(['base', 'top', 'bottom', 'accessory', 'hair'])
  })

  it('每层目录至少有 1 个可选项', () => {
    for (const layer of OUTFIT_LAYERS) {
      expect(OUTFIT_CATALOG[layer].length).toBeGreaterThan(0)
    }
  })

  it('默认穿戴每层都指向一个合法选项', () => {
    const v = validateOutfit(DEFAULT_OUTFIT)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
  })
})

describe('换装分层：合法性校验 isValidOption', () => {
  it('目录内的 id 返回 true', () => {
    expect(isValidOption('top', 'top-hoodie')).toBe(true)
    expect(isValidOption('hair', 'hair-curly')).toBe(true)
  })

  it('其他层的 id / 不存在的 id 返回 false', () => {
    // top 的 id 放到 hair 层应非法
    expect(isValidOption('hair', 'top-hoodie')).toBe(false)
    expect(isValidOption('base', 'no-such-thing')).toBe(false)
    expect(isValidOption('top', '')).toBe(false)
  })
})

describe('换装分层：setLayer 切换', () => {
  it('合法切换返回新状态且不修改原对象', () => {
    const before = createDefaultOutfit()
    const after = setLayer(before, 'top', 'top-hoodie')
    expect(after.top).toBe('top-hoodie')
    expect(before.top).toBe('top-none') // 不可变
    // 其它层保持不变
    expect(after.hair).toBe(before.hair)
    expect(after.base).toBe(before.base)
  })

  it('非法 optionId 抛错（合法性校验）', () => {
    const o = createDefaultOutfit()
    expect(() => setLayer(o, 'bottom', 'top-hoodie')).toThrow()
    expect(() => setLayer(o, 'accessory', 'nope')).toThrow()
  })

  it('连续切换多层后仍整体合法', () => {
    let o = createDefaultOutfit()
    o = setLayer(o, 'top', 'top-jacket')
    o = setLayer(o, 'bottom', 'bottom-jeans')
    o = setLayer(o, 'accessory', 'acc-glasses')
    o = setLayer(o, 'hair', 'hair-long')
    expect(validateOutfit(o).ok).toBe(true)
    expect(o.top).toBe('top-jacket')
    expect(o.bottom).toBe('bottom-jeans')
  })
})

describe('换装分层：normalizeOutfit 容错', () => {
  it('非对象输入返回默认穿戴', () => {
    expect(normalizeOutfit(null)).toEqual(DEFAULT_OUTFIT)
    expect(normalizeOutfit(undefined)).toEqual(DEFAULT_OUTFIT)
    expect(normalizeOutfit('garbage')).toEqual(DEFAULT_OUTFIT)
  })

  it('缺失的层用默认补齐，非法 id 回退默认', () => {
    const o = normalizeOutfit({ top: 'top-hoodie', hair: 'hacker-hair', bottom: 123 })
    expect(o.top).toBe('top-hoodie') // 合法保留
    expect(o.hair).toBe(DEFAULT_OUTFIT.hair) // 非法回退
    expect(o.bottom).toBe(DEFAULT_OUTFIT.bottom) // 非字符串回退
    expect(o.base).toBe(DEFAULT_OUTFIT.base) // 缺失补齐
  })
})

describe('换装分层：保存 / 加载', () => {
  it('saveOutfit 写入后 loadOutfit 读回一致', () => {
    const s = memStorage()
    let o = createDefaultOutfit()
    o = setLayer(o, 'top', 'top-tee')
    o = setLayer(o, 'hair', 'hair-curly')
    saveOutfit(o, s, 'k')
    const back = loadOutfit(s, 'k')
    expect(back).toEqual(o)
    expect(s.dump()['k']).toBe(JSON.stringify(o))
  })

  it('损坏的 JSON 加载时回退默认，不抛错', () => {
    const s = memStorage()
    s.setItem('k', '{{{not json')
    expect(loadOutfit(s, 'k')).toEqual(DEFAULT_OUTFIT)
  })

  it('无存储适配器时安全降级', () => {
    expect(loadOutfit(null, 'k')).toEqual(DEFAULT_OUTFIT)
    saveOutfit(createDefaultOutfit(), null, 'k') // 不抛错
  })
})

describe('换装分层：getOptionMeta', () => {
  it('返回当前选中项的元数据', () => {
    const o = createDefaultOutfit()
    expect(getOptionMeta(o, 'base').id).toBe('base-capsule')
    const o2 = setLayer(o, 'top', 'top-jacket')
    expect(getOptionMeta(o2, 'top').label).toBe('夹克')
  })
})
