/**
 * R5 分片C · 招牌体验快车道：名人对话一键直达
 * ------------------------------------------------------------------
 * 一个纯 DOM 浮层卡片（不依赖 WebGL/Canvas，swiftshader 下也能渲染）：
 *  - 展示推荐名人的头像 / 名字 / 头衔 / 开场白
 *  - 「开始对话」：
 *      · 若父级传入 onStartChat(celebrityId) → 交给路由进入 LibraryShell/CharacterHall
 *      · 否则就地展开一个极简对话窗，调用 /api/library/celebrity-chat；
 *        API 不可用时降级为本地开场白 + 一句占位回复，不阻塞用户。
 *  - 首次展示时 markFirstTime('celebrity_chat')（幂等，store 已保证）。
 *
 * 数据：默认从本地 CELEBRITIES 选取（苏格拉底/爱因斯坦…），离线也能出卡片。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Sparkles, X } from 'lucide-react'
import { prepareQuickChatCard, type QuickChatCard } from './quick-chat'
import { onboardingActions } from './onboarding-store'

interface CelebrityQuickChatProps {
  /** 关闭浮层。 */
  onClose?: () => void
  /**
   * 父级路由钩子：点「开始对话」后进入正式对话场景（Library/CharacterHall）。
   * 不传则就地展开降级对话窗。
   */
  onStartChat?: (celebrityId: string) => void
  /** 覆盖推荐名人 id（调试/定向推荐用）。 */
  preferredCelebrityIds?: string[]
}

type Turn = { from: 'me' | 'celeb'; text: string }

/** API 失败时名人的占位回复（降级）。 */
const FALLBACK_REPLY =
  '（网络好像开了点小差）没关系，我们先随便聊——你最近在想什么问题？我慢慢回你。'

export default function CelebrityQuickChat({ onClose, onStartChat, preferredCelebrityIds }: CelebrityQuickChatProps) {
  const card: QuickChatCard | null = useMemo(
    () => prepareQuickChatCard(preferredCelebrityIds),
    [preferredCelebrityIds],
  )
  const [chatOpen, setChatOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)
  const busyRef = useRef(false)

  // 首次进入快车道：标记 celebrity_chat 已完成（幂等）。
  useEffect(() => {
    try { onboardingActions.markFirstTime('celebrity_chat') } catch { /* storage 不可用不阻塞 */ }
  }, [])

  if (!card) return null

  const beginChat = () => {
    setTurns([{ from: 'celeb', text: card.greeting }])
    setChatOpen(true)
    if (onStartChat) onStartChat(card.celebrityId)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || busyRef.current) return
    setTurns((prev) => [...prev, { from: 'me', text }])
    setDraft('')
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/library/celebrity-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celebrityId: card.celebrityId, messages: [...turns, { from: 'me', text }].map((t) => ({ role: t.from === 'me' ? 'user' : 'assistant', content: t.text })) }),
      })
      const data = (await res.json()) as { reply?: string }
      const reply = res.ok && data.reply ? data.reply : FALLBACK_REPLY
      setTurns((prev) => [...prev, { from: 'celeb', text: reply }])
    } catch {
      // API 不可用 → 降级占位回复，不报错给用户
      setTurns((prev) => [...prev, { from: 'celeb', text: FALLBACK_REPLY }])
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="ob-quickchat-root" role="dialog" aria-modal="true" aria-label="和名人聊聊">
      <button type="button" className="ob-quickchat-close" onClick={onClose} aria-label="关闭">
        <X size={16} />
      </button>

      {!chatOpen ? (
        <div className="ob-quickchat-card">
          <div className="ob-quickchat-kicker"><Sparkles size={12} /> 新手快车道</div>
          <div className="ob-quickchat-body">
            <div className="ob-quickchat-portrait">
              {!imgBroken && card.portrait ? (
                <img src={card.portrait} alt={card.name} onError={() => setImgBroken(true)} />
              ) : (
                <span>{card.name[0]}</span>
              )}
            </div>
            <div className="ob-quickchat-info">
              <div className="ob-quickchat-name">{card.name}</div>
              <div className="ob-quickchat-title">{card.title} · {card.field}</div>
              <div className="ob-quickchat-greeting">“{card.greeting}”</div>
            </div>
          </div>
          <button type="button" className="ob-quickchat-cta" onClick={beginChat}>
            <MessageCircle size={15} /> 开始对话
          </button>
        </div>
      ) : (
        <div className="ob-quickchat-chat">
          <div className="ob-quickchat-chathead">
            <b>{card.name}</b>
            <span style={{ fontSize: 11, opacity: 0.6 }}>{card.title}</span>
          </div>
          <div className="ob-quickchat-msgs">
            {turns.map((t, i) => (
              <div key={i} className={`ob-quickchat-msg ${t.from}`}>
                {t.text}
              </div>
            ))}
            {busy && <div className="ob-quickchat-msg celeb">正在想…</div>}
          </div>
          {!onStartChat && (
            <div className="ob-quickchat-input">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
                placeholder={`问 ${card.name} 一个问题…`}
              />
              <button type="button" onClick={() => void send()} disabled={busy || !draft.trim()}>发送</button>
            </div>
          )}
          {onStartChat && (
            <div className="ob-quickchat-hint">正在进入完整对话…</div>
          )}
        </div>
      )}
    </div>
  )
}
