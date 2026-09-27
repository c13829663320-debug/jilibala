import { describe, it, expect } from 'vitest'
import { UNIFIED_MATERIALS, getUnifiedMaterials } from './unifiedMaterials'

describe('unifiedMaterials 统一材质预设', () => {
  it('地面/地台/道路/建筑均为低饱和深灰（暗调）', () => {
    for (const key of ['ground', 'plazaPlate', 'ringRoad', 'building'] as const) {
      const m = UNIFIED_MATERIALS[key]
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(m.roughness).toBeGreaterThanOrEqual(0.5)
      expect(m.metalness).toBeGreaterThanOrEqual(0)
      expect(m.metalness).toBeLessThanOrEqual(1)
    }
  })

  it('名人底座自发光对齐品牌明黄 #FFD600', () => {
    const p = UNIFIED_MATERIALS.avatarPedestal
    expect(p.emissive?.toUpperCase()).toBe('#FFD600')
    expect(p.emissiveIntensity ?? 0).toBeGreaterThan(0)
  })

  it('品牌环线自发光对齐品牌青绿 #4fb3a5', () => {
    const ring = UNIFIED_MATERIALS.brandRing
    expect(ring.emissive?.toUpperCase()).toBe('#4FB3A5')
    expect(ring.color.toUpperCase()).toBe('#4FB3A5')
  })

  it('getUnifiedMaterials 返回同一份预设', () => {
    expect(getUnifiedMaterials()).toBe(UNIFIED_MATERIALS)
  })
})
