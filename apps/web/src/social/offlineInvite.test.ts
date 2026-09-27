// ===== R5: 离线组队邀请过滤/排序纯函数测试 =====
import { describe, expect, it } from 'vitest'
import { filterOfflineInvites } from './offlineInvite'
import type { PartyInvite } from '@balabala/shared'

function makeInvite(id: string, createdAt: string): PartyInvite {
  return {
    inviteId: id,
    partyId: 'party-1',
    fromUserId: 'u1',
    fromNickname: '队长',
    toUserId: 'u2',
    createdAt,
  }
}

const NOW = Date.parse('2026-09-27T12:00:00.000Z')

describe('filterOfflineInvites', () => {
  it('按时间倒序返回', () => {
    const list = [
      makeInvite('a', '2026-09-27T09:00:00.000Z'),
      makeInvite('b', '2026-09-27T11:00:00.000Z'),
      makeInvite('c', '2026-09-27T10:00:00.000Z'),
    ]
    const out = filterOfflineInvites(list, { now: NOW })
    expect(out.map((i) => i.inviteId)).toEqual(['b', 'c', 'a'])
  })

  it('去重（重复 inviteId 只留一条）', () => {
    const dup = makeInvite('a', '2026-09-27T11:00:00.000Z')
    const list = [dup, dup, makeInvite('b', '2026-09-27T10:00:00.000Z')]
    const out = filterOfflineInvites(list, { now: NOW })
    expect(out).toHaveLength(2)
  })

  it('丢弃超过 maxAgeMs 的过期邀请', () => {
    const list = [
      makeInvite('fresh', '2026-09-27T11:30:00.000Z'), // 30 分钟前
      makeInvite('old', '2026-09-26T10:00:00.000Z'), // >24h 前
    ]
    const out = filterOfflineInvites(list, { now: NOW })
    expect(out.map((i) => i.inviteId)).toEqual(['fresh'])
  })

  it('丢弃 createdAt 非法/缺失的条目', () => {
    const bad = { ...makeInvite('bad', 'not-a-date') }
    const list = [bad, makeInvite('good', '2026-09-27T11:00:00.000Z')]
    const out = filterOfflineInvites(list, { now: NOW })
    expect(out.map((i) => i.inviteId)).toEqual(['good'])
  })
})
