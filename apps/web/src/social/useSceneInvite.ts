// ===== R5: 邀请进场景 / 一起开局 =====
//
// 队长选定场景并开局后，全员收到 party_leader_start 消息。
// 本 hook 把它变成一个「加入场景」待处理邀请卡片：
//  - 点击「加入」统一导航到 /scene/:sceneId（IA 域路由约定）
//  - 导航函数可注入（App 内部是状态切换而非 react-router），默认 window.location.assign
//
// 最小接线：本 hook 不关心 3D 场景主体，只负责弹出邀请卡片 + 导航。

import { useCallback, useState } from 'react'
import type { PartyWsMessage, SceneId } from '@balabala/shared'

export interface SceneInvite {
  partyId: string
  sceneId: SceneId
}

export interface UseSceneInviteOptions {
  /** 自定义导航（App 内部状态切换）；默认 window.location.assign。 */
  onNavigate?: (path: string) => void
}

export interface UseSceneInviteResult {
  /** 待处理的「加入场景」邀请（null 表示无）。 */
  pending: SceneInvite | null
  /** 外层在收到 WS party_* 帧时调用。 */
  handleMessage: (msg: PartyWsMessage) => void
  accept: () => void
  decline: () => void
}

export function useSceneInvite({ onNavigate }: UseSceneInviteOptions = {}): UseSceneInviteResult {
  const [pending, setPending] = useState<SceneInvite | null>(null)

  const handleMessage = useCallback((msg: PartyWsMessage) => {
    if (msg.type === 'party_leader_start') {
      setPending({ partyId: msg.partyId, sceneId: msg.sceneId })
    }
  }, [])

  const accept = useCallback(() => {
    if (!pending) return
    const path = `/scene/${pending.sceneId}`
    if (onNavigate) onNavigate(path)
    else if (typeof window !== 'undefined') window.location.assign(path)
    setPending(null)
  }, [pending, onNavigate])

  const decline = useCallback(() => setPending(null), [])

  return { pending, handleMessage, accept, decline }
}
