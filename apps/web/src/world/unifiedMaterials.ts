/**
 * R5 视觉品牌域 · 统一 3D 材质预设（纯数据，不直接 new THREE.Material）。
 *
 * 对齐品牌色：地面/建筑保持低饱和深灰，只在"品牌点缀件"（地台环线、
 * 名人化身立牌边框）上使用明黄/青绿，避免整个 3D 场景变成高饱和花屏。
 */

export interface UnifiedMaterialPreset {
  color: string
  metalness: number
  roughness: number
  /** 可选：品牌色点缀（用于自发光/环线） */
  emissive?: string
  emissiveIntensity?: number
}

export interface UnifiedMaterials {
  ground: UnifiedMaterialPreset
  plazaPlate: UnifiedMaterialPreset
  ringRoad: UnifiedMaterialPreset
  building: UnifiedMaterialPreset
  /** 名人化身底座立牌：明黄描边 */
  avatarPedestal: UnifiedMaterialPreset
  /** 品牌点缀环线（青绿自发光） */
  brandRing: UnifiedMaterialPreset
}

export const UNIFIED_MATERIALS: UnifiedMaterials = {
  ground: { color: '#14161a', metalness: 0.1, roughness: 1 },
  plazaPlate: { color: '#1e2126', metalness: 0.15, roughness: 0.9 },
  ringRoad: { color: '#23262c', metalness: 0.1, roughness: 0.95 },
  building: { color: '#2a2d33', metalness: 0.2, roughness: 0.85 },
  avatarPedestal: {
    color: '#141414',
    metalness: 0.3,
    roughness: 0.6,
    // 明黄描边自发光（品牌主色）
    emissive: '#FFD600',
    emissiveIntensity: 0.35,
  },
  brandRing: {
    color: '#4fb3a5',
    metalness: 0.2,
    roughness: 0.5,
    // 青绿点缀（品牌辅助色）
    emissive: '#4fb3a5',
    emissiveIntensity: 0.5,
  },
}

export function getUnifiedMaterials(): UnifiedMaterials {
  return UNIFIED_MATERIALS
}
