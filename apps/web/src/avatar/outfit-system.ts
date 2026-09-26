// ===== 换装分层系统（纯逻辑，可单测）=====
// 槽位：head / top / bottom / shoes / accessoryL / accessoryR。
// 每层可独立穿戴 / 卸下 / 换色，支持整套预设换装。
// 不可变更新：所有函数返回新的 OutfitState，不修改入参。无 three.js 依赖。

/** 服装/配饰槽位 */
export type OutfitSlot =
  | 'head'          // 帽子/发饰
  | 'top'           // 上衣
  | 'bottom'        // 下装
  | 'shoes'         // 鞋
  | 'accessoryL'    // 左手持
  | 'accessoryR'    // 右手持

export const OUTFIT_SLOTS: OutfitSlot[] = ['head', 'top', 'bottom', 'shoes', 'accessoryL', 'accessoryR']

export const SLOT_LABELS: Record<OutfitSlot, string> = {
  head: '帽子',
  top: '上衣',
  bottom: '下装',
  shoes: '鞋子',
  accessoryL: '左手饰',
  accessoryR: '右手饰',
}

/** 一件可穿戴物品的静态定义（目录） */
export interface OutfitItem {
  id: string
  name: string
  slot: OutfitSlot
  /** 程序化几何体类别，供 R3F 层组件选择基础形状 */
  kind: 'cap' | 'hat' | 'hair' | 'shirt' | 'jacket' | 'pants' | 'skirt' | 'shoes' | 'glasses' | 'prop'
  defaultColor: string
}

/** 已穿戴的某层：物品 id + 当前颜色 */
export interface EquippedItem {
  itemId: string
  color: string
}

/** 整套换装状态：槽位 → 已穿戴物品 */
export type OutfitState = Partial<Record<OutfitSlot, EquippedItem | undefined>>

/** 一个预设套装：槽位 → 物品 id（颜色可取物品默认或覆盖） */
export interface OutfitSet {
  id: string
  name: string
  slots: Partial<Record<OutfitSlot, { itemId: string; color?: string }>>
}

/** 可穿戴物品目录 */
export const OUTFIT_CATALOG: OutfitItem[] = [
  // head
  { id: 'cap_baseball', name: '棒球帽', slot: 'head', kind: 'cap', defaultColor: '#3b6ea5' },
  { id: 'hat_top', name: '礼帽', slot: 'head', kind: 'hat', defaultColor: '#2b2b2b' },
  { id: 'hair_bun', name: '丸子头', slot: 'head', kind: 'hair', defaultColor: '#4a3527' },
  // top
  { id: 'shirt_tee', name: 'T恤', slot: 'top', kind: 'shirt', defaultColor: '#e8e8e8' },
  { id: 'jacket_suit', name: '西装外套', slot: 'top', kind: 'jacket', defaultColor: '#33415c' },
  { id: 'jacket_hoodie', name: '卫衣', slot: 'top', kind: 'shirt', defaultColor: '#c96f4a' },
  // bottom
  { id: 'pants_jeans', name: '牛仔裤', slot: 'bottom', kind: 'pants', defaultColor: '#4a6fa5' },
  { id: 'pants_formal', name: '西裤', slot: 'bottom', kind: 'pants', defaultColor: '#2b2b2b' },
  { id: 'skirt', name: '短裙', slot: 'bottom', kind: 'skirt', defaultColor: '#7a4a6b' },
  // shoes
  { id: 'shoe_sneaker', name: '运动鞋', slot: 'shoes', kind: 'shoes', defaultColor: '#f0f0f0' },
  { id: 'shoe_leather', name: '皮鞋', slot: 'shoes', kind: 'shoes', defaultColor: '#3a2a1a' },
  // accessory
  { id: 'acc_glasses', name: '眼镜', slot: 'accessoryR', kind: 'glasses', defaultColor: '#222222' },
  { id: 'acc_prop_cup', name: '咖啡杯', slot: 'accessoryR', kind: 'prop', defaultColor: '#b5651d' },
  { id: 'acc_prop_book', name: '书本', slot: 'accessoryL', kind: 'prop', defaultColor: '#3a6b4a' },
]

const CATALOG_MAP: Map<string, OutfitItem> = new Map(OUTFIT_CATALOG.map((i) => [i.id, i]))

export function getItem(id: string): OutfitItem | undefined {
  return CATALOG_MAP.get(id)
}

/** 空换装状态 */
export function createEmptyOutfit(): OutfitState {
  return {}
}

/** 某槽位穿戴一件物品（可覆盖已有），不可变返回新状态 */
export function equip(outfit: OutfitState, slot: OutfitSlot, itemId: string): OutfitState {
  const item = getItem(itemId)
  if (!item) return outfit
  return { ...outfit, [slot]: { itemId, color: item.defaultColor } }
}

/** 卸下某槽位 */
export function unequip(outfit: OutfitState, slot: OutfitSlot): OutfitState {
  if (!outfit[slot]) return outfit
  const next: OutfitState = { ...outfit }
  delete next[slot]
  return next
}

/** 改某槽位颜色（未穿戴则忽略） */
export function setSlotColor(outfit: OutfitState, slot: OutfitSlot, color: string): OutfitState {
  const cur = outfit[slot]
  if (!cur) return outfit
  return { ...outfit, [slot]: { ...cur, color } }
}

/** 应用一整套预设：先清空再按套装穿戴 */
export function applyOutfitSet(outfit: OutfitState, set: OutfitSet): OutfitState {
  void outfit
  let next: OutfitState = {}
  for (const slot of OUTFIT_SLOTS) {
    const entry = set.slots[slot]
    if (!entry) continue
    const item = getItem(entry.itemId)
    if (!item) continue
    next = { ...next, [slot]: { itemId: item.id, color: entry.color ?? item.defaultColor } }
  }
  return next
}

/** 查询某槽位是否已穿戴 */
export function isEquipped(outfit: OutfitState, slot: OutfitSlot): boolean {
  return !!outfit[slot]
}

/** HSL(0~360,0~100,0~100) → #rrggbb，供配色选择器使用 */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360
  const sat = Math.min(100, Math.max(0, s)) / 100
  const lig = Math.min(100, Math.max(0, l)) / 100
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = lig - c / 2
  let r = 0, g = 0, b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}
