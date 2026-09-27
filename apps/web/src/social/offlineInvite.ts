// ===== R5: 离线组队邀请过滤 / 排序（纯函数） =====
//
// 用户上线时，服务端把离线期间未处理的 party_invite 补发下来（offline 通道）。
// 本函数在前端做最后一道清洗：去重、丢弃过期邀请、按时间倒序（最新在前）。

import type { PartyInvite } from '@balabala/shared'

export interface FilterOfflineInvitesOptions {
  /** 超过该时长（ms）的邀请视为过期，默认 24h。 */
  maxAgeMs?: number
  /** 当前时间（注入便于测试），默认 Date.now()。 */
  now?: number
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * 清洗离线邀请：
 *  1. 按 inviteId 去重（重连/补发可能重复）
 *  2. 丢弃 createdAt 早于 now - maxAgeMs 的过期邀请
 *  3. 按 createdAt 倒序（最新的在前）
 */
export function filterOfflineInvites(
  invites: PartyInvite[],
  options: FilterOfflineInvitesOptions = {},
): PartyInvite[] {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const now = options.now ?? Date.now()

  const seen = new Set<string>()
  return invites
    .filter((inv) => {
      if (!inv?.inviteId || !inv?.createdAt) return false
      if (seen.has(inv.inviteId)) return false
      seen.add(inv.inviteId)
      const created = Date.parse(inv.createdAt)
      if (Number.isNaN(created)) return false
      return now - created <= maxAgeMs
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
