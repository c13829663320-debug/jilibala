// ============================================================================
// 照片 → 头像化身（前端 Canvas 处理，纯几何/绘制编排）
// 不做真实 3D 重建：照片做正面方形裁剪 + 白底贴图 + 程序化身体。
// 绘制操作抽象到最小接口 PhotoCanvasOps，真机传 CanvasRenderingContext2D，
// 单测传 mock 对象——函数本身不依赖 DOM/window。
// ============================================================================
import type { PhotoAvatarConfig } from '@balabala/shared'

export const AVATAR_CANVAS_SIZE = 512

/** 裁剪+绘制规格（源矩形 → 目标方形）。 */
export interface CropSpec {
  sx: number
  sy: number
  sw: number
  sh: number
  dw: number
  dh: number
}

/**
 * 中心方形裁剪：取 min(宽,高) 作为边长，居中切出正方形。
 * 纯几何，可单测。
 */
export function computeSquareCrop(srcW: number, srcH: number): { sx: number; sy: number; side: number } {
  const side = Math.max(1, Math.min(srcW, srcH))
  const sx = Math.round((srcW - side) / 2)
  const sy = Math.round((srcH - side) / 2)
  return { sx, sy, side }
}

/** 生成完整裁剪+缩放规格：正方形源 → targetSize 方形目标。 */
export function buildCropSpec(srcW: number, srcH: number, targetSize: number = AVATAR_CANVAS_SIZE): CropSpec {
  const { sx, sy, side } = computeSquareCrop(srcW, srcH)
  return { sx, sy, sw: side, sh: side, dw: targetSize, dh: targetSize }
}

/**
 * 最小绘制上下文接口：真机直接传 CanvasRenderingContext2D（结构兼容）。
 */
export interface PhotoCanvasOps {
  /** 真实 Canvas 的 fillStyle 允许渐变/图案，这里放宽以结构兼容。 */
  fillStyle: string | CanvasGradient | CanvasPattern
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}

/**
 * 在指定尺寸的白底画布上绘制居中方形裁剪后的照片。
 * 先铺白底（保证边缘不透明），再贴照片。
 */
export function renderAvatarOnWhite(
  ctx: PhotoCanvasOps,
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetSize: number = AVATAR_CANVAS_SIZE,
): void {
  // 1) 白底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetSize, targetSize)
  // 2) 居中方形裁剪贴图
  const spec = buildCropSpec(srcW, srcH, targetSize)
  ctx.drawImage(img, spec.sx, spec.sy, spec.sw, spec.sh, 0, 0, spec.dw, spec.dh)
}

/** 由种子字符串确定性取一个身体主色（HSL）。 */
export function pickBodyColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 55%, 45%)`
}

/**
 * 由处理后的贴图 dataURL 生成“头像化身”配置（与 avatarType='photo' 兼容）。
 */
export function buildPhotoAvatarConfig(textureUrl: string, label: string): PhotoAvatarConfig {
  return {
    avatarType: 'photo',
    textureUrl,
    bodyColor: pickBodyColor(label || textureUrl),
    bodyShape: 'procedural',
    label: label || '我的头像化身',
  }
}
