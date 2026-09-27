import { describe, it, expect } from 'vitest'
import { UNIFIED_LIGHTING, getUnifiedLighting } from './unifiedLighting'

describe('unifiedLighting 统一光照配置', () => {
  it('背景/雾保持近黑，不打亮成灰', () => {
    expect(UNIFIED_LIGHTING.background).toBe('#0a0a0a')
    expect(UNIFIED_LIGHTING.fog.color).toBe('#0a0a0a')
    expect(UNIFIED_LIGHTING.fog.far).toBeGreaterThan(UNIFIED_LIGHTING.fog.near)
  })

  it('环境光/半球光强度落在合理暗调区间', () => {
    expect(UNIFIED_LIGHTING.ambient.intensity).toBeGreaterThan(0)
    expect(UNIFIED_LIGHTING.ambient.intensity).toBeLessThanOrEqual(1)
    expect(UNIFIED_LIGHTING.hemisphere.intensity).toBeGreaterThan(0)
  })

  it('主平行光位置非零且带阴影分辨率', () => {
    const d = UNIFIED_LIGHTING.directional
    expect(d.position[1]).toBeGreaterThan(0) // 在斜上方
    expect(d.shadowMapSize[0]).toBeGreaterThanOrEqual(1024)
  })

  it('key light 颜色对齐品牌明黄暖色', () => {
    expect(UNIFIED_LIGHTING.directional.color).toMatch(/#[0-9a-fA-F]{6}/)
    // 暖色应在黄色相（R 高、B 明显低于 R）
    const hex = UNIFIED_LIGHTING.directional.color.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    expect(r).toBeGreaterThan(200)
    expect(b).toBeLessThan(r)
  })

  it('getUnifiedLighting 无参返回同一份配置；override 深合并', () => {
    expect(getUnifiedLighting()).toBe(UNIFIED_LIGHTING)
    const merged = getUnifiedLighting({ ambient: { intensity: 0.8 } })
    expect(merged.ambient.intensity).toBe(0.8)
    // 未覆写字段保持原值
    expect(merged.directional.position).toEqual(UNIFIED_LIGHTING.directional.position)
    expect(merged.fog.near).toBe(UNIFIED_LIGHTING.fog.near)
  })
})
