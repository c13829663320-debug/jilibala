// ===== Round4 R4-03：换装分层系统 =====
// 纯逻辑层，不依赖 three.js / DOM，可在 Node 环境直接单测。
//
// 分层模型：base（基础身体）/ top（上衣）/ bottom（下装）/ accessory（配饰）/ hair（发型）。
// 每层维护一个可选项目录（OutfitOption[]），当前穿戴 = OutfitState（层 → option id）。
// 状态可持久化到 localStorage（key 由调用方传入；浏览器外注入内存存储即可）。
import type { OutfitLayer, OutfitOption, OutfitState } from '@balabala/shared'

/** 全部分层（顺序即渲染叠加顺序） */
export const OUTFIT_LAYERS: readonly OutfitLayer[] = ['base', 'top', 'bottom', 'accessory', 'hair'] as const

/** 分层中文展示名（UI 用） */
export const LAYER_LABELS: Record<OutfitLayer, string> = {
  base: '身体',
  top: '上衣',
  bottom: '下装',
  accessory: '配饰',
  hair: '发型',
}

/**
 * 每层的可选装备目录。
 * 当前为程序化占位资产（云端无 GPU，3D 仅按色板/形状区分），
 * 后续接入 GLB 时只需替换这里的 path 字段即可，分层逻辑不变。
 */
export const OUTFIT_CATALOG: Record<OutfitLayer, OutfitOption[]> = {
  base: [
    { id: 'base-capsule', label: '标准胶囊', swatch: '#4fb3a5' },
    { id: 'base-robot', label: '小机器人', swatch: '#7d8cff' },
    { id: 'base-ghost', label: '小幽灵', swatch: '#dfe6f0' },
  ],
  top: [
    { id: 'top-none', label: '无上衣', swatch: 'transparent' },
    { id: 'top-hoodie', label: '卫衣', swatch: '#e07a5f' },
    { id: 'top-jacket', label: '夹克', swatch: '#3d405b' },
    { id: 'top-tee', label: 'T恤', swatch: '#f2cc8f' },
  ],
  bottom: [
    { id: 'bottom-none', label: '无下装', swatch: 'transparent' },
    { id: 'bottom-jeans', label: '牛仔裤', swatch: '#5c7aad' },
    { id: 'bottom-shorts', label: '短裤', swatch: '#8a5a44' },
  ],
  accessory: [
    { id: 'acc-none', label: '无配饰', swatch: 'transparent' },
    { id: 'acc-glasses', label: '眼镜', swatch: '#222222' },
    { id: 'acc-hat', label: '帽子', swatch: '#b56576' },
    { id: 'acc-backpack', label: '背包', swatch: '#6a994e' },
  ],
  hair: [
    { id: 'hair-buzz', label: '寸头', swatch: '#3a2e2a' },
    { id: 'hair-short', label: '短发', swatch: '#2a2320' },
    { id: 'hair-curly', label: '卷发', swatch: '#5b4636' },
    { id: 'hair-long', label: '长发', swatch: '#1f1a17' },
  ],
}

/** 每层的默认选中 id（保证 OutfitState 永远合法） */
export const DEFAULT_OUTFIT: OutfitState = {
  base: 'base-capsule',
  top: 'top-none',
  bottom: 'bottom-none',
  accessory: 'acc-none',
  hair: 'hair-buzz',
}

/** 浏览器外可注入的存储适配器（localStorage 实现 / 测试用内存实现） */
export interface OutfitStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 默认 localStorage key */
export const OUTFIT_STORAGE_KEY = 'balabala_outfit_state'

/** 取浏览器 localStorage（不可用时返回 null，调用方需自行兜底） */
function browserStorage(): OutfitStorage | null {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined') {
    return (globalThis as { localStorage: Storage }).localStorage
  }
  return null
}

/** 判断某 optionId 在指定层目录中是否存在（合法性校验核心） */
export function isValidOption(layer: OutfitLayer, optionId: string): boolean {
  if (!optionId) return false
  return OUTFIT_CATALOG[layer].some((o) => o.id === optionId)
}

/** 判断整个 OutfitState 是否每层都合法 */
export function validateOutfit(outfit: OutfitState): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  for (const layer of OUTFIT_LAYERS) {
    const id = outfit[layer]
    if (!id) {
      errors.push(`层 ${layer} 缺少选中项`)
    } else if (!isValidOption(layer, id)) {
      errors.push(`层 ${layer} 的选项 ${id} 不在目录中`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 返回一份新的 OutfitState，把某层切换到 optionId。
 * 合法性校验：若 optionId 不在该层目录中，抛出错误（调用方应先用 isValidOption 校验）。
 * 不可变：不修改入参。
 */
export function setLayer(outfit: OutfitState, layer: OutfitLayer, optionId: string): OutfitState {
  if (!isValidOption(layer, optionId)) {
    throw new Error(`[outfit-system] 非法装备：layer=${layer} optionId=${optionId}`)
  }
  return { ...outfit, [layer]: optionId }
}

/** 获取默认穿戴（每层默认项） */
export function createDefaultOutfit(): OutfitState {
  return { ...DEFAULT_OUTFIT }
}

/**
 * 把任意（可能损坏的）JSON 输入规范化成合法 OutfitState：
 * - 缺失的层用默认值补齐
 * - 目录外的非法 id 回退到该层默认值
 * - 非对象输入直接返回默认
 */
export function normalizeOutfit(raw: unknown): OutfitState {
  const result = createDefaultOutfit()
  if (!raw || typeof raw !== 'object') return result
  const rec = raw as Record<string, unknown>
  for (const layer of OUTFIT_LAYERS) {
    const v = rec[layer]
    if (typeof v === 'string' && isValidOption(layer, v)) {
      result[layer] = v
    }
  }
  return result
}

/** 从存储加载穿戴（损坏/缺失 → 默认） */
export function loadOutfit(storage: OutfitStorage | null = browserStorage(), key: string = OUTFIT_STORAGE_KEY): OutfitState {
  if (!storage) return createDefaultOutfit()
  try {
    const text = storage.getItem(key)
    if (!text) return createDefaultOutfit()
    return normalizeOutfit(JSON.parse(text))
  } catch {
    return createDefaultOutfit()
  }
}

/** 保存穿戴到存储（JSON 序列化；存储不可用时静默失败） */
export function saveOutfit(outfit: OutfitState, storage: OutfitStorage | null = browserStorage(), key: string = OUTFIT_STORAGE_KEY): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(outfit))
  } catch {
    // 存储满 / 隐私模式 → 静默失败，不影响体验
  }
}

/** 取某层当前选中项的元数据（找不到返回该层第一个） */
export function getOptionMeta(outfit: OutfitState, layer: OutfitLayer): OutfitOption {
  const id = outfit[layer]
  const found = OUTFIT_CATALOG[layer].find((o) => o.id === id)
  return found ?? OUTFIT_CATALOG[layer][0]
}
