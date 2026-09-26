// ===== Round4 R4-03：useSafety —— React 绑定 =====
// 把 safety-manager 的不可变状态桥接到 React：每次 action 后刷新快照触发重渲染。
// 同时把举报动作接到 WebSocket（通过传入的 send 回调发送 report_user）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReportCategory } from '@balabala/shared'
import { createSafetyManager, type SafetyManager, type SafetyState } from './safety-manager'

export interface UseSafetyOptions {
  /** 本地用户 id（举报人） */
  userId?: string
  /** 当前房间 id（举报记录里的 room 字段） */
  roomId?: string
  /** 发送 WS 消息的回调（默认 Plaza3D 的 wsRef.send）；不传则举报只记本地 */
  send?: (msg: { type: string; [k: string]: unknown }) => void
}

export interface UseSafetyResult {
  /** 当前安全状态快照（muted/blocked/reports） */
  state: SafetyState
  /** 原始 manager（高级用法） */
  manager: SafetyManager
  mute: (userId: string) => void
  unmute: (userId: string) => void
  toggleMute: (userId: string) => void
  block: (userId: string) => void
  unblock: (userId: string) => void
  toggleBlock: (userId: string) => void
  isMuted: (userId: string) => boolean
  isBlocked: (userId: string) => boolean
  canSeeAvatar: (userId: string) => boolean
  canHearVoice: (userId: string) => boolean
  canReceiveText: (userId: string) => boolean
  /** 举报：本地记录 + 经 send 发送 report_user */
  report: (targetUserId: string, reason: string, category: ReportCategory, targetNickname?: string) => void
}

export function useSafety({ userId, roomId, send }: UseSafetyOptions = {}): UseSafetyResult {
  // manager 实例在 mount 时创建一次（内部持有 localStorage）
  const managerRef = useRef<SafetyManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = createSafetyManager({ reporterUserId: userId, room: roomId })
  }
  const manager = managerRef.current

  const [snapshot, setSnapshot] = useState<SafetyState>(() => manager.getState())

  // roomId / userId 变化时重建 manager（切房间后举报记录归属新房间）
  useEffect(() => {
    const m = createSafetyManager({ reporterUserId: userId, room: roomId })
    managerRef.current = m
    setSnapshot(m.getState())
  }, [userId, roomId])

  // send 回调最新化（避免闭包过期）
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])

  const refresh = useCallback(() => setSnapshot(managerRef.current!.getState()), [])

  const mute = useCallback((id: string) => { managerRef.current!.mute(id); refresh() }, [refresh])
  const unmute = useCallback((id: string) => { managerRef.current!.unmute(id); refresh() }, [refresh])
  const toggleMute = useCallback((id: string) => { managerRef.current!.toggleMute(id); refresh() }, [refresh])
  const block = useCallback((id: string) => { managerRef.current!.block(id); refresh() }, [refresh])
  const unblock = useCallback((id: string) => { managerRef.current!.unblock(id); refresh() }, [refresh])
  const toggleBlock = useCallback((id: string) => { managerRef.current!.toggleBlock(id); refresh() }, [refresh])

  const report = useCallback((targetUserId: string, reason: string, category: ReportCategory, targetNickname?: string) => {
    const payload = managerRef.current!.report(targetUserId, reason, category, targetNickname)
    refresh()
    sendRef.current?.({ type: 'report_user', ...payload })
  }, [refresh])

  // 判定函数直接读 manager 内部（高频，不依赖 snapshot）
  const isMuted = useCallback((id: string) => managerRef.current!.isMuted(id), [])
  const isBlocked = useCallback((id: string) => managerRef.current!.isBlocked(id), [])
  const canSeeAvatar = useCallback((id: string) => managerRef.current!.canSeeAvatar(id), [])
  const canHearVoice = useCallback((id: string) => managerRef.current!.canHearVoice(id), [])
  const canReceiveText = useCallback((id: string) => managerRef.current!.canReceiveText(id), [])

  return useMemo(() => ({
    state: snapshot,
    manager,
    mute, unmute, toggleMute,
    block, unblock, toggleBlock,
    isMuted, isBlocked,
    canSeeAvatar, canHearVoice, canReceiveText,
    report,
  }), [snapshot, manager, mute, unmute, toggleMute, block, unblock, toggleBlock, isMuted, isBlocked, canSeeAvatar, canHearVoice, canReceiveText, report])
}
