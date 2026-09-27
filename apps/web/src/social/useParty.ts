// ===== R5: 组队状态管理 hook =====
//
// 职责：
//  - 创建 / 邀请 / 接受邀请 / 准备 / 选场景 / 开始 / 离开 / 解散
//  - 接收服务端 party_* WS 消息并维护本地队伍快照
//  - localStorage 持久化队伍快照与未处理邀请，刷新后恢复 UI（权威状态以服务端 party_updated 为准）
//
// 与 FriendsPanel 一致：sendWs 由外层注入（复用全局 WS 连接）；
// onPartyMessage 由外层在收到 WS 帧时分发进来。

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Party, PartyInvite, PartyWsMessage, SceneId } from '@balabala/shared'

const STORAGE_PREFIX = 'balabala_party_v1'

interface StoredPartyState {
  party: Party | null
  invites: PartyInvite[]
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}_${userId}`
}

function loadStored(userId: string): StoredPartyState {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return { party: null, invites: [] }
    const parsed = JSON.parse(raw) as Partial<StoredPartyState>
    // 旧快照若已解散则不恢复
    if (parsed.party && parsed.party.status === 'disbanded') return { party: null, invites: parsed.invites ?? [] }
    return { party: parsed.party ?? null, invites: parsed.invites ?? [] }
  } catch {
    return { party: null, invites: [] }
  }
}

function persist(userId: string, state: StoredPartyState): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    /* 存储满/隐私模式，忽略 */
  }
}

export interface UsePartyOptions {
  userId: string
  /** 发送 WS 消息（外层注入）。 */
  sendWs: (msg: unknown) => void
  /** 队长开局：全员应导航到 /scene/:sceneId（IA 路由约定）。 */
  onLeaderStart?: (partyId: string, sceneId: SceneId) => void
}

export interface UsePartyResult {
  party: Party | null
  /** 我当前是否为队长。 */
  isLeader: boolean
  /** 我是否已准备。 */
  amReady: boolean
  /** 待处理的组队邀请。 */
  invites: PartyInvite[]
  /** 外层在收到 WS party_* 帧时调用。 */
  onPartyMessage: (msg: PartyWsMessage) => void
  createParty: () => void
  inviteFriend: (toUserId: string, message?: string) => void
  acceptInvite: (invite: PartyInvite) => void
  declineInvite: (inviteId: string) => void
  toggleReady: () => void
  chooseScene: (sceneId: SceneId) => void
  startGame: () => void
  leaveParty: () => void
  disbandParty: () => void
  /** 清空本地快照（例如登出）。 */
  clear: () => void
}

export function useParty({ userId, sendWs, onLeaderStart }: UsePartyOptions): UsePartyResult {
  const [party, setParty] = useState<Party | null>(() => loadStored(userId).party)
  const [invites, setInvites] = useState<PartyInvite[]>(() => loadStored(userId).invites)
  const leaderStartRef = useRef(onLeaderStart)
  leaderStartRef.current = onLeaderStart

  // 变化即持久化
  useEffect(() => {
    persist(userId, { party, invites })
  }, [userId, party, invites])

  const onPartyMessage = useCallback((msg: PartyWsMessage) => {
    switch (msg.type) {
      case 'party_created':
      case 'party_updated':
        setParty(msg.party)
        break
      case 'party_invite':
        setInvites((prev) => (prev.some((i) => i.inviteId === msg.invite.inviteId) ? prev : [...prev, msg.invite]))
        break
      case 'party_member_ready':
        // party_updated 紧随其后携带权威快照，这里不单独维护
        break
      case 'party_join_request':
        // 通知队长「有人加入」，由通知中心聚合，这里不改队伍状态
        break
      case 'party_leader_start':
        setParty((prev) => (prev && prev.partyId === msg.partyId ? { ...prev, status: 'in-game', sceneId: msg.sceneId } : prev))
        leaderStartRef.current?.(msg.partyId, msg.sceneId)
        break
      case 'party_disbanded':
        setParty((prev) => (prev && prev.partyId === msg.partyId ? null : prev))
        break
      default:
        break
    }
  }, [])

  const createParty = useCallback(() => sendWs({ type: 'party_create' }), [sendWs])

  const inviteFriend = useCallback((toUserId: string, message?: string) => {
    sendWs({ type: 'party_invite', toUserId, message })
  }, [sendWs])

  const acceptInvite = useCallback((invite: PartyInvite) => {
    sendWs({ type: 'party_join_request', partyId: invite.partyId })
    // 乐观从邀请列表移除（服务端 party_updated 会纠正）
    setInvites((prev) => prev.filter((i) => i.inviteId !== invite.inviteId))
  }, [sendWs])

  const declineInvite = useCallback((inviteId: string) => {
    setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId))
  }, [])

  const toggleReady = useCallback(() => {
    if (!party) return
    const me = party.members.find((m) => m.userId === userId)
    sendWs({ type: 'party_ready', partyId: party.partyId, ready: me?.status !== 'ready' })
  }, [party, userId, sendWs])

  const chooseScene = useCallback((sceneId: SceneId) => {
    if (!party) return
    sendWs({ type: 'party_choose_scene', partyId: party.partyId, sceneId })
  }, [party, sendWs])

  const startGame = useCallback(() => {
    if (!party) return
    sendWs({ type: 'party_start', partyId: party.partyId })
  }, [party, sendWs])

  const leaveParty = useCallback(() => {
    if (!party) return
    sendWs({ type: 'party_leave', partyId: party.partyId })
    setParty(null)
  }, [party, sendWs])

  const disbandParty = useCallback(() => {
    if (!party) return
    sendWs({ type: 'party_disband', partyId: party.partyId })
    setParty(null)
  }, [party, sendWs])

  const clear = useCallback(() => {
    setParty(null)
    setInvites([])
    try { localStorage.removeItem(storageKey(userId)) } catch { /* noop */ }
  }, [userId])

  const me = party?.members.find((m) => m.userId === userId)
  return {
    party,
    isLeader: party?.leaderId === userId,
    amReady: me?.status === 'ready',
    invites,
    onPartyMessage,
    createParty,
    inviteFriend,
    acceptInvite,
    declineInvite,
    toggleReady,
    chooseScene,
    startGame,
    leaveParty,
    disbandParty,
    clear,
  }
}
