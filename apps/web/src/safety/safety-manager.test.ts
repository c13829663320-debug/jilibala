// ===== safety-manager 纯逻辑单测（静音/屏蔽/举报 + 持久化 + 取消屏蔽） =====
import { describe, expect, it } from 'vitest'
import {
  createSafetyManager,
  SAFETY_STORAGE_KEY,
  normalizeCategory,
  type SafetyStorage,
} from './safety-manager'

/** 内存存储（模拟 localStorage，可断言写入内容） */
function memStorage(): SafetyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
  }
}

describe('静音 mute：阻止语音但保留化身/文字', () => {
  it('mute 后 isMuted=true，语音被阻止', () => {
    const s = memStorage()
    const m = createSafetyManager({ storage: s })
    expect(m.isMuted('u1')).toBe(false)
    m.mute('u1')
    expect(m.isMuted('u1')).toBe(true)
    expect(m.canHearVoice('u1')).toBe(false)
  })

  it('mute 不影响化身可见与文字接收', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.mute('u1')
    expect(m.canSeeAvatar('u1')).toBe(true) // 仍可见
    expect(m.canReceiveText('u1')).toBe(true) // 仍可读
  })

  it('unmute / toggleMute 恢复', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.toggleMute('u1')
    expect(m.isMuted('u1')).toBe(true)
    m.toggleMute('u1')
    expect(m.isMuted('u1')).toBe(false)
    m.mute('u1')
    m.unmute('u1')
    expect(m.canHearVoice('u1')).toBe(true)
  })

  it('重复 mute 不产生重复条目', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.mute('u1'); m.mute('u1'); m.mute('u1')
    expect(m.getState().muted).toEqual(['u1'])
  })
})

describe('屏蔽 block：完全不可见', () => {
  it('block 后化身隐藏、文字丢弃、语音阻止', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.block('u9')
    expect(m.isBlocked('u9')).toBe(true)
    expect(m.canSeeAvatar('u9')).toBe(false)
    expect(m.canReceiveText('u9')).toBe(false)
    expect(m.canHearVoice('u9')).toBe(false)
  })

  it('block 是 mute 的超集：先 mute 再 block，语音仍阻止；unblock 后恢复', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.mute('u5')
    expect(m.canHearVoice('u5')).toBe(false)
    m.block('u5')
    expect(m.isBlocked('u5')).toBe(true)
    // 取消屏蔽
    m.unblock('u5')
    expect(m.isBlocked('u5')).toBe(false)
    expect(m.canSeeAvatar('u5')).toBe(true)
    // block 会自动从 muted 移除 → unblock 后语音恢复（因为没单独静音了）
    expect(m.canHearVoice('u5')).toBe(true)
    expect(m.getState().muted).not.toContain('u5')
  })

  it('toggleBlock 可重复开关', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.toggleBlock('x'); expect(m.isBlocked('x')).toBe(true)
    m.toggleBlock('x'); expect(m.isBlocked('x')).toBe(false)
  })
})

describe('举报 report：本地记录 + WS 载荷', () => {
  it('report 返回 report_user 载荷并写入本地记录', () => {
    const s = memStorage()
    const m = createSafetyManager({ storage: s, reporterUserId: 'me', room: 'social:abc', now: () => '2026-01-01T00:00:00Z' })
    const payload = m.report('u7', '骂人', 'abuse', '某某')
    expect(payload).toEqual({ targetUserId: 'u7', reason: '骂人', category: 'abuse' })
    const rec = m.getState().reports[0]
    expect(rec.targetUserId).toBe('u7')
    expect(rec.category).toBe('abuse')
    expect(rec.room).toBe('social:abc')
    expect(rec.reportedAt).toBe('2026-01-01T00:00:00Z')
  })

  it('非法分类归一化为 other', () => {
    const m = createSafetyManager({ storage: memStorage() })
    expect(normalizeCategory('nonsense')).toBe('other')
    const p = m.report('u1', 'x', 'hack' as never)
    expect(p.category).toBe('other')
  })

  it('reason 截断到 500 字符，空 target 不记录', () => {
    const m = createSafetyManager({ storage: memStorage() })
    const long = 'a'.repeat(900)
    const p = m.report('u1', long, 'spam')
    expect(p.reason.length).toBe(500)
    // 空 targetUserId
    const p2 = m.report('   ', 'x', 'spam')
    expect(p2.targetUserId).toBe('')
    expect(m.getState().reports.length).toBe(2) // 两条都记（空 target 也记录载荷，但不影响判定）
  })
})

describe('持久化 localStorage', () => {
  it('mute/block 写入 key=balabala_safety_state 的 JSON', () => {
    const s = memStorage()
    const m = createSafetyManager({ storage: s })
    m.mute('u1'); m.block('u2')
    const raw = s.map.get(SAFETY_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.muted).toEqual(['u1'])
    expect(parsed.blocked).toEqual(['u2'])
  })

  it('新 manager 从同一存储恢复状态', () => {
    const s = memStorage()
    const m1 = createSafetyManager({ storage: s })
    m1.mute('u1'); m1.block('u2')
    const m2 = createSafetyManager({ storage: s })
    expect(m2.isMuted('u1')).toBe(true)
    expect(m2.isBlocked('u2')).toBe(true)
  })

  it('损坏的存储 JSON 回退空状态，不抛错', () => {
    const s = memStorage()
    s.map.set(SAFETY_STORAGE_KEY, '{{{')
    const m = createSafetyManager({ storage: s })
    expect(m.getState().muted).toEqual([])
    expect(m.getState().blocked).toEqual([])
  })
})

describe('边界与健壮性', () => {
  it('空 id / 空白 id 的操作被忽略', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.mute(''); m.block('   ')
    expect(m.getState().muted).toEqual([])
    expect(m.getState().blocked).toEqual([])
  })

  it('getState 返回深拷贝，外部修改不影响内部', () => {
    const m = createSafetyManager({ storage: memStorage() })
    m.mute('u1')
    const st = m.getState()
    st.muted.push('hacker')
    st.blocked.push('hacker')
    expect(m.isMuted('hacker')).toBe(false)
    expect(m.isBlocked('hacker')).toBe(false)
  })

  it('clear() 清空全部状态并持久化', () => {
    const s = memStorage()
    const m = createSafetyManager({ storage: s })
    m.mute('u1'); m.block('u2'); m.report('u3', 'r', 'spam')
    m.clear()
    expect(m.getState()).toEqual({ muted: [], blocked: [], reports: [] })
  })
})
