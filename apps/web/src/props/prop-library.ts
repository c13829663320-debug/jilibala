// ============================================================================
// CC0 道具库 —— 纯数据目录 + 程序化几何体参数（无外部 GLB，无 three 运行时依赖）
// ----------------------------------------------------------------------------
// PropItem.tsx（浏览器）按 parts 组合 three.js 基础形状；
// 本文件保持零运行时依赖，可在 node 环境直接单测。
// ============================================================================
import type { PropDefinition, PropGeometryPart } from '@balabala/shared'

/** 拾取触发距离（米）：玩家距道具 < 此值时显示交互提示。 */
export const PICKUP_RANGE = 2.0

/** 玩家手持时道具相对玩家的偏移距离（米，身前）。 */
export const HOLD_DISTANCE = 0.6

/** 手持道具距地面高度（胸口/腰前，米）。 */
export const HOLD_HEIGHT = 1.2

function p(
  shape: PropGeometryPart['shape'],
  args: number[],
  position: [number, number, number],
  color: string,
  extra?: Partial<PropGeometryPart>,
): PropGeometryPart {
  return { shape, args, position, color, ...extra }
}

/** CC0 内置道具目录（12+）。品牌色：黑底 + 明黄 #FFD600 + 青绿 #4fb3a5。 */
export const PROP_LIBRARY: PropDefinition[] = [
  {
    id: 'bench',
    name: '长椅',
    category: 'furniture',
    color: '#8a6a45',
    size: [1.8, 1.0, 0.6],
    pickable: true,
    interactAction: '坐下休息',
    emoji: '🪑',
    parts: [
      p('box', [1.8, 0.12, 0.5], [0, 0.45, 0], '#8a6a45'),
      p('box', [0.12, 0.45, 0.5], [-0.8, 0.22, 0], '#6b4f30'),
      p('box', [0.12, 0.45, 0.5], [0.8, 0.22, 0], '#6b4f30'),
      p('box', [1.8, 0.5, 0.1], [0, 0.8, -0.22], '#8a6a45'),
    ],
  },
  {
    id: 'table',
    name: '桌子',
    category: 'furniture',
    color: '#a9825a',
    size: [1.2, 0.8, 0.8],
    pickable: false,
    interactAction: '摆放物品',
    emoji: '🪵',
    parts: [
      p('box', [1.2, 0.08, 0.8], [0, 0.75, 0], '#a9825a'),
      p('box', [0.06, 0.75, 0.06], [-0.55, 0.37, -0.35], '#7a5c3a'),
      p('box', [0.06, 0.75, 0.06], [0.55, 0.37, -0.35], '#7a5c3a'),
      p('box', [0.06, 0.75, 0.06], [-0.55, 0.37, 0.35], '#7a5c3a'),
      p('box', [0.06, 0.75, 0.06], [0.55, 0.37, 0.35], '#7a5c3a'),
    ],
  },
  {
    id: 'lamp',
    name: '台灯',
    category: 'decor',
    color: '#FFD600',
    size: [0.3, 0.55, 0.3],
    pickable: true,
    interactAction: '开关灯',
    emoji: '🛋️',
    parts: [
      p('cylinder', [0.15, 0.18, 0.03, 12], [0, 0.015, 0], '#2a2d33'),
      p('cylinder', [0.02, 0.02, 0.4, 8], [0, 0.23, 0], '#3a3d42'),
      p('cone', [0.12, 0.16, 12], [0, 0.46, 0], '#FFD600', { emissive: '#FFD600', emissiveIntensity: 0.8 }),
    ],
  },
  {
    id: 'bookshelf',
    name: '书架',
    category: 'furniture',
    color: '#6b4f30',
    size: [0.9, 1.8, 0.35],
    pickable: false,
    interactAction: '取阅藏书',
    emoji: '📚',
    parts: [
      p('box', [0.05, 1.8, 0.32], [-0.42, 0.9, 0], '#6b4f30'),
      p('box', [0.05, 1.8, 0.32], [0.42, 0.9, 0], '#6b4f30'),
      p('box', [0.85, 0.04, 0.3], [0, 0.3, 0], '#7a5c3a'),
      p('box', [0.85, 0.04, 0.3], [0, 0.7, 0], '#7a5c3a'),
      p('box', [0.85, 0.04, 0.3], [0, 1.1, 0], '#7a5c3a'),
      p('box', [0.85, 0.04, 0.3], [0, 1.5, 0], '#7a5c3a'),
    ],
  },
  {
    id: 'plant',
    name: '植物',
    category: 'decor',
    color: '#4fb3a5',
    size: [0.5, 0.9, 0.5],
    pickable: true,
    interactAction: '浇水',
    emoji: '🪴',
    parts: [
      p('cylinder', [0.16, 0.2, 0.25, 12], [0, 0.125, 0], '#c96f4a'),
      p('cone', [0.26, 0.6, 8], [0, 0.55, 0], '#3f7a5a'),
    ],
  },
  {
    id: 'picture',
    name: '画框',
    category: 'decor',
    color: '#4fb3a5',
    size: [0.7, 0.9, 0.08],
    pickable: false,
    interactAction: '欣赏画作',
    emoji: '🖼️',
    parts: [
      p('box', [0.66, 0.86, 0.05], [0, 1.2, 0], '#5a4632'),
      p('box', [0.54, 0.74, 0.03], [0, 1.2, 0.02], '#4fb3a5'),
    ],
  },
  {
    id: 'fountain',
    name: '喷泉',
    category: 'decor',
    color: '#4fb3a5',
    size: [1.8, 1.2, 1.8],
    pickable: false,
    interactAction: '许愿',
    emoji: '⛲',
    parts: [
      p('cylinder', [0.9, 1.0, 0.3, 24], [0, 0.15, 0], '#2a2d33'),
      p('cylinder', [0.78, 0.78, 0.06, 24], [0, 0.33, 0], '#4fb3a5', { emissive: '#4fb3a5', emissiveIntensity: 0.15 }),
      p('cylinder', [0.18, 0.24, 0.8, 12], [0, 0.7, 0], '#c9c4b8'),
      p('sphere', [0.22, 12, 12], [0, 1.2, 0], '#FFD600'),
    ],
  },
  {
    id: 'statue',
    name: '雕像',
    category: 'decor',
    color: '#c9c4b8',
    size: [0.6, 1.6, 0.6],
    pickable: false,
    interactAction: '瞻仰',
    emoji: '🗿',
    parts: [
      p('box', [0.5, 0.4, 0.5], [0, 0.2, 0], '#9a958a'),
      p('cylinder', [0.14, 0.2, 0.9, 10], [0, 0.85, 0], '#c9c4b8'),
      p('sphere', [0.13, 12, 12], [0, 1.42, 0], '#d8d3c8'),
    ],
  },
  {
    id: 'chessboard',
    name: '棋盘',
    category: 'interactive',
    color: '#FFD600',
    size: [0.7, 0.55, 0.7],
    pickable: true,
    interactAction: '对弈一局',
    emoji: '♟️',
    parts: [
      p('box', [0.6, 0.5, 0.6], [0, 0.25, 0], '#6b4f30'),
      p('box', [0.64, 0.04, 0.64], [0, 0.52, 0], '#e8dcc0'),
      p('box', [0.2, 0.06, 0.2], [-0.15, 0.58, -0.15], '#2a2d33'),
      p('box', [0.2, 0.06, 0.2], [0.15, 0.58, 0.15], '#FFD600'),
    ],
  },
  {
    id: 'microphone',
    name: '麦克风',
    category: 'interactive',
    color: '#FFD600',
    size: [0.2, 0.6, 0.2],
    pickable: true,
    interactAction: '拿起发言',
    emoji: '🎤',
    parts: [
      p('cylinder', [0.09, 0.11, 0.02, 12], [0, 0.01, 0], '#2a2d33'),
      p('cylinder', [0.015, 0.015, 0.5, 8], [0, 0.27, 0], '#3a3d42'),
      p('sphere', [0.05, 12, 12], [0, 0.56, 0], '#FFD600'),
    ],
  },
  {
    id: 'dumbbell',
    name: '哑铃',
    category: 'interactive',
    color: '#4fb3a5',
    size: [0.4, 0.18, 0.18],
    pickable: true,
    interactAction: '举起重物',
    emoji: '🏋️',
    parts: [
      p('cylinder', [0.03, 0.03, 0.3, 8], [0, 0.1, 0], '#2a2d33', { rotation: [0, 0, Math.PI / 2] }),
      p('cylinder', [0.08, 0.08, 0.09, 12], [-0.16, 0.1, 0], '#4fb3a5'),
      p('cylinder', [0.08, 0.08, 0.09, 12], [0.16, 0.1, 0], '#4fb3a5'),
    ],
  },
  {
    id: 'book',
    name: '书本',
    category: 'interactive',
    color: '#FFD600',
    size: [0.28, 0.08, 0.2],
    pickable: true,
    interactAction: '翻开阅读',
    emoji: '📖',
    parts: [
      p('box', [0.26, 0.04, 0.19], [0, 0.02, 0], '#8a2f3a'),
      p('box', [0.23, 0.03, 0.16], [0, 0.045, 0], '#f0e6d2'),
    ],
  },
  {
    id: 'cushion',
    name: '坐垫',
    category: 'furniture',
    color: '#4fb3a5',
    size: [0.5, 0.15, 0.5],
    pickable: true,
    interactAction: '坐下放松',
    emoji: '🧸',
    parts: [
      p('box', [0.5, 0.14, 0.5], [0, 0.07, 0], '#4fb3a5'),
    ],
  },
]

/** 按 id 取道具定义。 */
export function getPropById(id: string): PropDefinition | undefined {
  return PROP_LIBRARY.find((p) => p.id === id)
}

/** 所有可拾取道具 id。 */
export function listPickablePropIds(): string[] {
  return PROP_LIBRARY.filter((p) => p.pickable).map((p) => p.id)
}

/** 道具定义完整性校验（用于单测/加载时自检）。 */
export function isPropValid(prop: PropDefinition): boolean {
  if (!prop.id || !prop.name) return false
  if (!['furniture', 'decor', 'interactive'].includes(prop.category)) return false
  if (!Array.isArray(prop.size) || prop.size.length !== 3) return false
  if (typeof prop.pickable !== 'boolean') return false
  if (!prop.emoji) return false
  if (!Array.isArray(prop.parts) || prop.parts.length === 0) return false
  for (const part of prop.parts) {
    if (!part.shape) return false
    if (!Array.isArray(part.args) || part.args.length === 0) return false
    if (!Array.isArray(part.position) || part.position.length !== 3) return false
    if (!part.color) return false
  }
  return true
}
