// ===== M13 第五轮：前端音色完整性与朗读门控纯逻辑测试 =====
import { describe, expect, it } from 'vitest'
import {
  CELEBRITIES,
  COURT_ROLE_VOICES,
  VOICE_WHITELIST,
  isValidVoice,
  resolveCharacterVoice,
} from '@balabala/shared'

describe('音色白名单完整性', () => {
  it('所有预置名人的 voice 都在官方白名单内', () => {
    for (const c of CELEBRITIES) {
      if (c.voice) expect(isValidVoice(c.voice)).toBe(true)
    }
  })

  it('所有法庭固定角色音色都在白名单内', () => {
    for (const voice of Object.values(COURT_ROLE_VOICES)) {
      expect(isValidVoice(voice)).toBe(true)
    }
  })

  it('白名单内无重复 id（实测可用 13 个）', () => {
    expect(VOICE_WHITELIST.size).toBe(13)
  })
})

describe('法庭朗读门控：旁听者/NPC 不朗读', () => {
  // 旁听者（audience-08..13）不在 COURT_ROLE_VOICES，resolveCharacterVoice 回退默认——
  // 但前端只对「到达 turns/speeches 流的发言」朗读，旁听者不产生 speech 事件，天然不朗读。
  it('旁听者 id 不命中法庭角色音色映射', () => {
    expect(COURT_ROLE_VOICES['audience-08']).toBeUndefined()
    expect(COURT_ROLE_VOICES['audience-13']).toBeUndefined()
  })

  it('有效法庭角色命中专属音色，而不是默认女声', () => {
    expect(resolveCharacterVoice('judge')).not.toBe('jingdiannvsheng')
    expect(resolveCharacterVoice('defendant')).not.toBe('jingdiannvsheng')
  })
})
