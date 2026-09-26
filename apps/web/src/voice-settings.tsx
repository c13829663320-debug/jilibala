// ===== M13 第五轮：全局语音朗读开关 =====
// 偏好持久化到 localStorage；法庭等场景的「自动朗读」只在开关打开时触发。
// 手动点击的 TtsPlayButton 不受此开关影响（用户明确点击即视为授权）。
//
// 浏览器自动播放限制：首次需用户交互，开关由用户点击产生，故点击后即可发声。
import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'

const STORAGE_KEY = 'balabala.voice-enabled'

type Listener = (enabled: boolean) => void
const listeners = new Set<Listener>()

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function getVoiceEnabled(): boolean {
  return readStored()
}

export function setVoiceEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch { /* storage may be unavailable */ }
  listeners.forEach((fn) => fn(enabled))
}

/** 订阅开关变化（返回取消订阅函数）。 */
export function subscribeVoiceEnabled(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** React hook：订阅全局语音开关。 */
export function useVoiceEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readStored())
  useEffect(() => subscribeVoiceEnabled(setEnabled), [])
  const update = (v: boolean) => setVoiceEnabled(v)
  return [enabled, update]
}

/**
 * 全局语音开关按钮（喇叭图标）。可放进 TopNav 或法庭 topbar，
 * 多处实例共享同一份 localStorage 偏好，状态自动同步。
 */
export function VoiceToggleButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [enabled, update] = useVoiceEnabled()
  return (
    <button
      type="button"
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0, ...style }}
      onClick={() => update(!enabled)}
      title={enabled ? '语音朗读：开（点击静音）' : '语音朗读：关（点击开启）'}
      aria-pressed={enabled}
    >
      {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
      <span style={{ whiteSpace: 'nowrap' }}>{enabled ? '语音开' : '静音'}</span>
    </button>
  )
}
