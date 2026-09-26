// ============================================================================
// ScenePlay —— 场景运行时播放页（全屏，无 TopNav）
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Send, X } from 'lucide-react'
import type { SceneNpc, ScenePlayPayload } from '@balabala/shared'
import SceneRunner from './SceneRunner'
import { chatWithNpc, getPlayPayload, synthesizeSpeech, type ChatMessage } from './api-client'
import { useIdentity } from '../identity'
import './scene-studio.css'

export type ScenePlayProps = {
  sceneId: string
  onBack: () => void
}

type PlayChat = {
  npc: SceneNpc
  history: ChatMessage[]
  draft: string
  sending: boolean
}

export default function ScenePlay({ sceneId, onBack }: ScenePlayProps) {
  const { user } = useIdentity()
  const [payload, setPayload] = useState<ScenePlayPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chat, setChat] = useState<PlayChat | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const chatOpenRef = useRef(false)
  chatOpenRef.current = Boolean(chat)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await getPlayPayload(sceneId)
        if (alive) setPayload(data)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '加载场景失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [sceneId])

  const handleNpcInteract = useCallback((npc: SceneNpc) => {
    setChat({ npc, history: [], draft: '', sending: false })
  }, [])

  const handleGameplayEvent = useCallback((event: { type: string; payload?: unknown }) => {
    if (event.type === 'reach' || event.type === 'complete' || event.type === 'win') {
      setCelebrating(true)
      window.setTimeout(() => setCelebrating(false), 3200)
    }
  }, [])

  const handleSend = async () => {
    if (!chat) return
    const text = chat.draft.trim()
    if (!text || chat.sending) return
    const history: ChatMessage[] = [...chat.history, { role: 'user', content: text }]
    setChat({ ...chat, history, draft: '', sending: true })
    try {
      const reply = await chatWithNpc(chat.npc.characterId, history, user?.userId)
      const next: ChatMessage[] = [...history, { role: 'assistant', content: reply }]
      setChat((prev) => (prev ? { ...prev, history: next, sending: false } : prev))
      // 自动朗读
      try {
        const url = await synthesizeSpeech(reply)
        const audio = new Audio(url)
        audio.onended = () => URL.revokeObjectURL(url)
        await audio.play()
      } catch { /* 静默 */ }
    } catch (e) {
      setChat((prev) => (prev
        ? { ...prev, sending: false, history: [...history, { role: 'assistant', content: e instanceof Error ? e.message : '对话失败' }] }
        : prev))
    }
  }

  if (loading) {
    return (
      <div className="ss__play">
        <div className="ss__center"><Loader2 className="ss__spin" size={22} /> 正在进入世界…</div>
      </div>
    )
  }
  if (error || !payload) {
    return (
      <div className="ss__play">
        <div className="ss__center ss__error">
          <p>{error || '场景不存在'}</p>
          <button type="button" className="ss__btn" onClick={onBack}>返回</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ss__play">
      <SceneRunner
        blueprint={payload.blueprint}
        npcResources={payload.npcResources}
        assetUrls={payload.assetUrls}
        editable={false}
        onNpcInteract={handleNpcInteract}
        onGameplayEvent={handleGameplayEvent}
      />

      {/* 顶部返回 */}
      <button type="button" className="ss__play-back" onClick={onBack} title="返回我的场景">
        <ArrowLeft size={18} />
      </button>
      <div className="ss__play-title">
        <b>{payload.scene.name}</b>
        <small>{payload.scene.description}</small>
      </div>

      {/* 庆祝弹窗 */}
      {celebrating && (
        <div className="ss__celebrate">
          <div className="ss__celebrate-emoji">🎉</div>
          <div className="ss__celebrate-title">目标达成！</div>
        </div>
      )}

      {/* NPC 对话框 */}
      {chat && (
        <div className="ss__chatbox">
          <div className="ss__chatbox-head">
            <b>💬 {chat.npc.label}</b>
            <button type="button" className="ss__iconbtn ss__iconbtn-sm" onClick={() => setChat(null)}><X size={14} /></button>
          </div>
          <div className="ss__chat-log">
            {chat.history.map((m, i) => (
              <div key={i} className={`ss__chat-msg ${m.role === 'user' ? 'is-user' : ''}`}>{m.content}</div>
            ))}
            {chat.sending && <div className="ss__chat-msg">正在输入…</div>}
          </div>
          <div className="ss__chat-input">
            <input
              value={chat.draft}
              onChange={(e) => setChat({ ...chat, draft: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSend() }}
              placeholder={`对 ${chat.npc.label} 说点什么…`}
            />
            <button type="button" className="ss__btn ss__btn-primary" onClick={() => void handleSend()} disabled={chat.sending}>
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
