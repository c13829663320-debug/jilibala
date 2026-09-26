import { describe, it, expect } from 'vitest'
import {
  createEmptyOutfit,
  equip,
  unequip,
  setSlotColor,
  applyOutfitSet,
  isEquipped,
  getItem,
  OUTFIT_SLOTS,
  hslToHex,
  type OutfitState,
} from './outfit-system'
import { AVATAR_PRESETS } from './avatar-presets'

describe('换装系统：基础穿戴', () => {
  it('初始为空', () => {
    const o = createEmptyOutfit()
    for (const s of OUTFIT_SLOTS) expect(isEquipped(o, s)).toBe(false)
  })

  it('equip 后该槽位穿戴且颜色取物品默认', () => {
    const o = equip(createEmptyOutfit(), 'top', 'shirt_tee')
    expect(isEquipped(o, 'top')).toBe(true)
    expect(o.top?.itemId).toBe('shirt_tee')
    expect(o.top?.color).toBe('#e8e8e8')
  })

  it('equip 未知物品 id 原样返回不报错', () => {
    const o0 = createEmptyOutfit()
    expect(equip(o0, 'top', 'nope')).toBe(o0)
  })

  it('equip 覆盖同槽位', () => {
    let o = equip(createEmptyOutfit(), 'top', 'shirt_tee')
    o = equip(o, 'top', 'jacket_suit')
    expect(o.top?.itemId).toBe('jacket_suit')
  })

  it('不可变：不修改入参', () => {
    const o0 = createEmptyOutfit()
    const o1 = equip(o0, 'top', 'shirt_tee')
    expect(o0).not.toBe(o1)
    expect(isEquipped(o0, 'top')).toBe(false)
  })

  it('unequip 卸下', () => {
    let o: OutfitState = equip(createEmptyOutfit(), 'head', 'cap_baseball')
    o = unequip(o, 'head')
    expect(isEquipped(o, 'head')).toBe(false)
  })

  it('unequip 未穿戴槽位原样返回', () => {
    const o0 = createEmptyOutfit()
    expect(unequip(o0, 'head')).toBe(o0)
  })
})

describe('换装系统：换色', () => {
  it('setSlotColor 修改已穿戴槽位颜色', () => {
    let o = equip(createEmptyOutfit(), 'top', 'shirt_tee')
    o = setSlotColor(o, 'top', '#ff0000')
    expect(o.top?.color).toBe('#ff0000')
  })

  it('未穿戴槽位换色被忽略', () => {
    const o0 = createEmptyOutfit()
    expect(setSlotColor(o0, 'top', '#ff0000')).toBe(o0)
  })
})

describe('换装系统：套装', () => {
  it('applyOutfitSet 穿戴全部槽位并支持颜色覆盖', () => {
    const preset = AVATAR_PRESETS[2] // formal
    const o = applyOutfitSet(createEmptyOutfit(), preset.outfit)
    expect(isEquipped(o, 'top')).toBe(true)
    expect(isEquipped(o, 'bottom')).toBe(true)
    expect(isEquipped(o, 'shoes')).toBe(true)
  })

  it('6 套预设都引用存在的物品 id', () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const preset of AVATAR_PRESETS) {
      for (const [slot, entry] of Object.entries(preset.outfit.slots)) {
        expect(getItem(entry.itemId), `${preset.id}.${slot} 引用 ${entry.itemId}`).toBeTruthy()
      }
    }
  })
})

describe('换装系统：颜色工具 hslToHex', () => {
  it('纯红', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000')
  })
  it('纯绿', () => {
    expect(hslToHex(120, 100, 50)).toBe('#00ff00')
  })
  it('纯蓝', () => {
    expect(hslToHex(240, 100, 50)).toBe('#0000ff')
  })
  it('灰度不受色相影响', () => {
    expect(hslToHex(0, 0, 50)).toBe(hslToHex(180, 0, 50))
  })
  it('越界色相被折叠', () => {
    expect(hslToHex(360, 100, 50)).toBe('#ff0000')
  })
})
