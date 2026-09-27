// ===== R5: 多人合影布局计算（纯函数） =====
//
// 对局结束时生成「多人合影」可分享图片：
//  - 顶部标题
//  - 中间头像墙（成员头像网格居中排列）
//  - 底部战果摘要文字
//
// 本函数只算坐标（头像槽位 + 文字位置），不碰 DOM/Canvas，便于单测。
// 画布为横版 1200x630（社交媒体分享图常用比例）。

export interface GroupPhotoAvatarSlot {
  index: number
  x: number
  y: number
  size: number
}

/** 一名合影参与者（头像墙用）。 */
export interface GroupPhotoParticipant {
  userId: string
  nickname: string
  avatarRef: string
}

export interface GroupPhotoLayout {
  width: number
  height: number
  /** 标题位置（画布居中，顶部）。 */
  title: { x: number; y: number }
  /** 头像墙槽位（按成员顺序，居中网格）。 */
  avatars: GroupPhotoAvatarSlot[]
  /** 战果摘要文字位置（画布居中，底部）。 */
  resultText: { x: number; y: number }
}

export interface GroupPhotoLayoutOptions {
  width?: number
  height?: number
  /** 单行最多几个头像（默认 4）。 */
  maxPerRow?: number
}

const DEFAULT_W = 1200
const DEFAULT_H = 630
const DEFAULT_MAX_PER_ROW = 4

/**
 * 计算合影布局。
 * @param memberCount 参与合影的成员人数（0~数十）
 */
export function computeGroupPhotoLayout(
  memberCount: number,
  options: GroupPhotoLayoutOptions = {},
): GroupPhotoLayout {
  const width = options.width ?? DEFAULT_W
  const height = options.height ?? DEFAULT_H
  const maxPerRow = Math.max(1, options.maxPerRow ?? DEFAULT_MAX_PER_ROW)
  const count = Math.max(0, memberCount)

  const title = { x: width / 2, y: 90 }
  const resultText = { x: width / 2, y: height - 90 }

  if (count === 0) {
    return { width, height, title, avatars: [], resultText }
  }

  const cols = Math.min(count, maxPerRow)
  const rows = Math.ceil(count / cols)

  // 头像尺寸：根据行列数自适应，保证塞得下且不贴边
  const gap = 28
  const usableW = width - 160
  const usableH = height - 260
  const size = Math.min(160, Math.floor((usableW - gap * (cols - 1)) / cols), Math.floor((usableH - gap * (rows - 1)) / rows))
  const avatarSize = Math.max(72, size)

  const gridW = cols * avatarSize + (cols - 1) * gap
  const gridH = rows * avatarSize + (rows - 1) * gap
  const startX = (width - gridW) / 2
  const startY = (height - gridH) / 2

  const avatars: GroupPhotoAvatarSlot[] = []
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    avatars.push({
      index: i,
      x: startX + c * (avatarSize + gap),
      y: startY + r * (avatarSize + gap),
      size: avatarSize,
    })
  }

  return { width, height, title, avatars, resultText }
}
