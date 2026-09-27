// ===== R5 发布域：前端审核提示总线（轻量可观察存储） =====
// 解耦：WS 层收到 mute_status 帧 / 发送入口本地命中敏感词时调用 push*，
// ModerationToast / MuteIndicator 订阅渲染。不依赖 React 上下文，便于在任意入口接入。

export interface MuteState {
  muted: boolean
  mutedUntil?: number
  reason?: string
}

interface ModerationBusState {
  /** 最近一次「内容含敏感词已替换」事件 id（用于 toast 触发动画） */
  lastHitAt: number
  /** 禁言状态 */
  mute: MuteState
}

type Listener = (state: ModerationBusState) => void

const state: ModerationBusState = { lastHitAt: 0, mute: { muted: false } }
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l({ ...state, mute: { ...state.mute } })
}

export function subscribeModeration(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getModerationState(): ModerationBusState {
  return { ...state, mute: { ...state.mute } }
}

/** 本地发送入口命中敏感词（前端预览命中）时调用 → 弹出「已替换」toast。 */
export function pushModerationHit(): void {
  state.lastHitAt = Date.now()
  emit()
}

/** 服务端下发 mute_status 帧时调用。 */
export function setMuteStatus(mute: MuteState): void {
  state.mute = { ...mute }
  emit()
}

/** 把一帧 WS 消息喂给总线（仅识别 mute_status）。非该类型则忽略。 */
export function handleIncomingModerationFrame(msg: { type?: string; muted?: boolean; mutedUntil?: number; reason?: string }): void {
  if (msg?.type === 'mute_status') {
    setMuteStatus({
      muted: msg.muted === true,
      ...(typeof msg.mutedUntil === 'number' ? { mutedUntil: msg.mutedUntil } : {}),
      ...(msg.reason ? { reason: msg.reason } : {}),
    })
  }
}
