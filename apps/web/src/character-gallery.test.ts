// ===== M13 第五轮：3D 人物长廊纯逻辑测试 =====
import { describe, expect, it } from 'vitest'
import {
  buildGalleryEntries,
  clampGalleryIndex,
  fieldColorFor,
  galleryLayout,
  greetingFor,
  snapToNearestIndex,
  BOOTH_SPACING,
  CUSTOM_FIELD_COLOR,
  FIELD_COLORS,
} from './character-gallery'
import type { UiCharacter } from './custom-characters'

function makeUi(over: Partial<UiCharacter> = {}): UiCharacter {
  return {
    id: 'x', name: '甲', title: '头衔', intro: '', tags: [], greeting: '你好',
    portrait: '', isCustom: false, ...over,
  }
}

describe('长廊布局 galleryLayout', () => {
  it('0 或负数返回空数组', () => {
    expect(galleryLayout(0)).toEqual([])
    expect(galleryLayout(-3)).toEqual([])
  })

  it('单个角色居中在 x=0', () => {
    const [b] = galleryLayout(1)
    expect(b.x).toBeCloseTo(0)
    expect(b.z).toBeCloseTo(0)
  })

  it('多个角色等距排列，间距 = BOOTH_SPACING', () => {
    const lay = galleryLayout(5)
    for (let i = 1; i < lay.length; i++) {
      expect(lay[i].x - lay[i - 1].x).toBeCloseTo(BOOTH_SPACING)
    }
    // 居中：最中间那个 x=0
    expect(lay[2].x).toBeCloseTo(0)
  })

  it('两端角色向后弯（z 为负），中间 z=0', () => {
    const lay = galleryLayout(5)
    expect(lay[0].z).toBeLessThan(0)
    expect(lay[4].z).toBeLessThan(0)
    expect(lay[2].z).toBeCloseTo(0)
  })
})

describe('吸附 snapToNearestIndex', () => {
  it('向右拖过半个展台吸附到下一位', () => {
    // 向右拖（dx>0）→ booths=-dx/spacing <0 → continuous=current - booths > current → 下一位
    expect(snapToNearestIndex(2, -0.6, 10)).toBe(3)
  })
  it('向左拖过半个展台吸附到上一位', () => {
    expect(snapToNearestIndex(2, 0.6, 10)).toBe(1)
  })
  it('不足半展台不切', () => {
    expect(snapToNearestIndex(2, 0.3, 10)).toBe(2)
  })
  it('越界夹到首尾', () => {
    expect(snapToNearestIndex(0, 5, 10)).toBe(0)
    expect(snapToNearestIndex(9, -5, 10)).toBe(9)
  })
  it('clamp 到整数并夹范围', () => {
    expect(clampGalleryIndex(-2, 10)).toBe(0)
    expect(clampGalleryIndex(99, 10)).toBe(9)
    expect(clampGalleryIndex(2.4, 10)).toBe(2)
  })
})

describe('领域色与问候语', () => {
  it('自定义人物用品牌黄', () => {
    expect(fieldColorFor(makeUi({ isCustom: true }))).toBe(CUSTOM_FIELD_COLOR)
  })
  it('预置名人按 field 查表', () => {
    expect(fieldColorFor(makeUi({ field: '科技' }))).toBe(FIELD_COLORS['科技'])
  })
  it('未知领域回退灰', () => {
    expect(fieldColorFor(makeUi({ field: '不存在' }))).toBe('#8a8a8a')
  })
  it('有问候语直接用', () => {
    expect(greetingFor(makeUi({ greeting: '你好呀' }))).toBe('你好呀')
  })
  it('自定义缺省给友好兜底', () => {
    expect(greetingFor(makeUi({ isCustom: true, greeting: '' }))).toContain('你好')
  })
})

describe('buildGalleryEntries 映射', () => {
  it('每个角色带展台位置、领域色、问候语', () => {
    const list = [makeUi({ id: 'a', field: '科学' }), makeUi({ id: 'b', isCustom: true })]
    const entries = buildGalleryEntries(list)
    expect(entries).toHaveLength(2)
    expect(entries[0].character.id).toBe('a')
    expect(entries[0].booth.x).toBeCloseTo(galleryLayout(2)[0].x)
    expect(entries[0].color).toBe(FIELD_COLORS['科学'])
    expect(entries[1].color).toBe(CUSTOM_FIELD_COLOR)
  })
})
