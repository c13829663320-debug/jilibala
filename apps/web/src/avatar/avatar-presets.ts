// ===== 预设化身配置（纯数据）=====
// 至少 6 套：日常 / 运动 / 正装 / 古装 / 科幻 / 休闲。
// 每套含一套换装槽位组合（OutfitSet）+ 肤色/身体色。
// 纯数据，无 three.js / DOM 依赖，可直接被 R3F 组件消费。

import type { OutfitSet } from './outfit-system'

export interface AvatarPreset {
  id: string
  name: string
  emoji: string
  /** 皮肤/头身主体颜色 */
  skinColor: string
  /** 换装套装（槽位 → 物品 + 可选覆盖色） */
  outfit: OutfitSet
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'daily',
    name: '日常',
    emoji: '👕',
    skinColor: '#e8b98a',
    outfit: {
      id: 'daily',
      name: '日常',
      slots: {
        top: { itemId: 'jacket_hoodie', color: '#c96f4a' },
        bottom: { itemId: 'pants_jeans' },
        shoes: { itemId: 'shoe_sneaker' },
        head: { itemId: 'hair_bun' },
      },
    },
  },
  {
    id: 'sports',
    name: '运动',
    emoji: '🏃',
    skinColor: '#d9a06b',
    outfit: {
      id: 'sports',
      name: '运动',
      slots: {
        top: { itemId: 'shirt_tee', color: '#4fb3a5' },
        bottom: { itemId: 'pants_jeans', color: '#5a7a9a' },
        shoes: { itemId: 'shoe_sneaker', color: '#f0f0f0' },
        head: { itemId: 'cap_baseball', color: '#4fb3a5' },
      },
    },
  },
  {
    id: 'formal',
    name: '正装',
    emoji: '🤵',
    skinColor: '#e8b98a',
    outfit: {
      id: 'formal',
      name: '正装',
      slots: {
        top: { itemId: 'jacket_suit', color: '#33415c' },
        bottom: { itemId: 'pants_formal' },
        shoes: { itemId: 'shoe_leather' },
        accessoryR: { itemId: 'acc_glasses' },
      },
    },
  },
  {
    id: 'traditional',
    name: '古装',
    emoji: '🏮',
    skinColor: '#f0c8a0',
    outfit: {
      id: 'traditional',
      name: '古装',
      slots: {
        top: { itemId: 'jacket_hoodie', color: '#8c2f39' },
        bottom: { itemId: 'skirt', color: '#5a1f2a' },
        shoes: { itemId: 'shoe_leather', color: '#5a3a2a' },
        head: { itemId: 'hair_bun', color: '#2a1a12' },
        accessoryL: { itemId: 'acc_prop_book', color: '#6b3a2a' },
      },
    },
  },
  {
    id: 'scifi',
    name: '科幻',
    emoji: '🚀',
    skinColor: '#c9d6e8',
    outfit: {
      id: 'scifi',
      name: '科幻',
      slots: {
        top: { itemId: 'jacket_suit', color: '#2a3a5a' },
        bottom: { itemId: 'pants_formal', color: '#1a2438' },
        shoes: { itemId: 'shoe_sneaker', color: '#9fd8e8' },
        head: { itemId: 'cap_baseball', color: '#2a3a5a' },
        accessoryR: { itemId: 'acc_prop_cup', color: '#9fd8e8' },
      },
    },
  },
  {
    id: 'casual',
    name: '休闲',
    emoji: '🛋️',
    skinColor: '#e8b98a',
    outfit: {
      id: 'casual',
      name: '休闲',
      slots: {
        top: { itemId: 'shirt_tee', color: '#e8dcc0' },
        bottom: { itemId: 'pants_jeans', color: '#6a8ab0' },
        shoes: { itemId: 'shoe_sneaker', color: '#d8d8d8' },
        accessoryR: { itemId: 'acc_prop_cup' },
      },
    },
  },
]

export function getPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((p) => p.id === id)
}
