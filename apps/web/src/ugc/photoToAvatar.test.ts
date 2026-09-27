// 照片→头像化身 Canvas 纯函数测试（mock 画布，node 环境）
import { describe, expect, it } from 'vitest'
import {
  AVATAR_CANVAS_SIZE,
  buildCropSpec,
  buildPhotoAvatarConfig,
  computeSquareCrop,
  pickBodyColor,
  renderAvatarOnWhite,
  type PhotoCanvasOps,
} from './photoToAvatar'

/** 记录调用的 mock 画布上下文。 */
class MockCtx implements PhotoCanvasOps {
  fillStyle = ''
  fills: Array<[number, number, number, number]> = []
  draws: Array<Record<string, number>> = []
  fillRect(x: number, y: number, w: number, h: number) {
    this.fills.push([x, y, w, h])
  }
  drawImage(_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
    this.draws.push({ sx, sy, sw, sh, dx, dy, dw, dh })
  }
}

describe('computeSquareCrop', () => {
  it('横图：取高度为边长，水平居中', () => {
    expect(computeSquareCrop(800, 400)).toEqual({ sx: 200, sy: 0, side: 400 })
  })

  it('竖图：取宽度为边长，垂直居中', () => {
    expect(computeSquareCrop(300, 900)).toEqual({ sx: 0, sy: 300, side: 300 })
  })

  it('正方形：全幅', () => {
    expect(computeSquareCrop(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 })
  })
})

describe('buildCropSpec', () => {
  it('输出方形目标尺寸', () => {
    const spec = buildCropSpec(1000, 500, 512)
    expect(spec.sw).toBe(spec.sh)
    expect(spec.dw).toBe(512)
    expect(spec.dh).toBe(512)
  })
})

describe('renderAvatarOnWhite', () => {
  it('先铺白底，再贴居中方形照片', () => {
    const ctx = new MockCtx()
    renderAvatarOnWhite(ctx, {} as CanvasImageSource, 1000, 500, AVATAR_CANVAS_SIZE)
    // 白底
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(ctx.fills[0]).toEqual([0, 0, 512, 512])
    // 贴图：源方形 500 居中（sx=250），贴满目标
    expect(ctx.draws[0].sx).toBe(250)
    expect(ctx.draws[0].sw).toBe(500)
    expect(ctx.draws[0].dw).toBe(512)
    expect(ctx.draws[0].dx).toBe(0)
  })
})

describe('buildPhotoAvatarConfig', () => {
  it('产出 avatarType=photo 且带程序化身体', () => {
    const c = buildPhotoAvatarConfig('data:xxx', '小明')
    expect(c.avatarType).toBe('photo')
    expect(c.bodyShape).toBe('procedural')
    expect(c.bodyColor).toMatch(/hsl/)
    expect(c.label).toBe('小明')
  })

  it('同种子同色，不同种子不同色', () => {
    expect(pickBodyColor('a')).toBe(pickBodyColor('a'))
    expect(pickBodyColor('a')).not.toBe(pickBodyColor('b'))
  })
})
