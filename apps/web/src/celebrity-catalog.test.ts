// ===== 人物馆视频接入验收：名人目录 / 音色 / 视频文件三者一致 =====
// 运行在 apps/web（vitest root），cwd = apps/web，public/videos 即人物视频目录。
import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  CELEBRITIES,
  getCelebrity,
  isValidVoice,
  resolveCharacterVoice,
} from '@balabala/shared'

/** 非人物视频（场景过场），不计入名人。 */
const NON_PERSON_VIDEOS = new Set(['court-opening', 'plaza-overview'])

function videosDir(): string {
  const candidates = [
    path.join(process.cwd(), 'public/videos'),
    path.join(process.cwd(), 'apps/web/public/videos'),
  ]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('找不到 public/videos 目录：' + candidates.join(' | '))
  return hit
}

function listPersonVideoIds(): string[] {
  return readdirSync(videosDir())
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => f.replace(/\.mp4$/, ''))
    .filter((id) => !NON_PERSON_VIDEOS.has(id))
}

describe('名人目录规模', () => {
  it('CELEBRITIES 达到约 100 人（≥95）', () => {
    expect(CELEBRITIES.length).toBeGreaterThanOrEqual(95)
  })

  it('每人都有完整 persona / greeting / voice / portrait 字段', () => {
    for (const c of CELEBRITIES) {
      expect(c.id, `名人缺 id`).toBeTruthy()
      expect(c.name, `${c.id} 缺 name`).toBeTruthy()
      expect(c.title, `${c.id} 缺 title`).toBeTruthy()
      expect(c.era, `${c.id} 缺 era`).toBeTruthy()
      expect(c.intro, `${c.id} 缺 intro`).toBeTruthy()
      expect(c.tags.length, `${c.id} 缺 tags`).toBeGreaterThan(0)
      expect(c.persona.length, `${c.id} persona 过短`).toBeGreaterThanOrEqual(40)
      expect(c.greeting, `${c.id} 缺 greeting`).toBeTruthy()
      expect(c.portrait, `${c.id} 缺 portrait`).toBe(`/portraits/${c.id}.png`)
    }
  })
})

describe('音色字段完整性', () => {
  it('每个名人都有 voice，且落在官方白名单内', () => {
    for (const c of CELEBRITIES) {
      expect(c.voice, `${c.id} 缺 voice`).toBeTruthy()
      expect(isValidVoice(c.voice), `${c.id} 的 voice=${c.voice} 非法`).toBe(true)
    }
  })

  it('resolveCharacterVoice(名人id) 返回该名人的合法音色', () => {
    for (const c of CELEBRITIES) {
      const v = resolveCharacterVoice(c.id)
      expect(isValidVoice(v), `${c.id} resolve 出非法音色 ${v}`).toBe(true)
      expect(v, `${c.id} 未命中其专属音色`).toBe(c.voice)
    }
  })
})

describe('视频文件与名人 id 一一对应', () => {
  it('每个 /videos/<id>.mp4 都对应一个已注册名人', () => {
    const ids = listPersonVideoIds()
    expect(ids.length).toBeGreaterThanOrEqual(95)
    const missing: string[] = []
    for (const id of ids) {
      if (!getCelebrity(id)) missing.push(id)
    }
    expect(missing, `以下视频没有对应名人条目：${missing.join(', ')}`).toEqual([])
  })

  it('每个有视频的名人，其 voice 经 resolveCharacterVoice 合法可用', () => {
    const ids = listPersonVideoIds()
    for (const id of ids) {
      const c = getCelebrity(id)
      expect(c, `${id} 无名人条目`).toBeTruthy()
      const v = resolveCharacterVoice(id, c!.voice)
      expect(isValidVoice(v)).toBe(true)
    }
  })

  it('名人数量与人物视频数量基本对齐（差值 ≤ 2）', () => {
    const ids = listPersonVideoIds()
    expect(Math.abs(ids.length - CELEBRITIES.length)).toBeLessThanOrEqual(2)
  })
})
