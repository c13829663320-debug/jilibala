// M8: 图书馆 — 完整 UI 壳
// 三个功能分区：名人读书会 / 深度多轮问答 / AI 馆员主题问答；
// 右侧为程序化 3D 阅览室；WebSocket 实时同步多人动态与问答。
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Users, BookOpen, MessageCircleQuestion, Library as LibraryIcon,
  Send, BookmarkPlus, Sparkles, MessagesSquare, User,
} from 'lucide-react'
import {
  CELEBRITIES, getCelebrity, CELEBRITY_FIELDS,
  type Celebrity, type CelebrityField, type WSMessage,
} from '@balabala/shared'
import { useIdentity } from './identity'

const LibraryView = lazy(() => import('./LibraryView'))
const QuizArena = lazy(() => import('./library/QuizArena'))

type Tab = 'club' | 'deep' | 'librarian'
type ChatRole = 'user' | 'assistant'

const httpHeaders = { 'Content-Type': 'application/json' }

const panel: React.CSSProperties = {
  background: '#141414',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14,
  padding: 14,
}
const accent = '#4fb3a5'
const muted = 'rgba(237,237,240,0.48)'

function CelebrityPicker({ value, onChange, label }: { value: string; onChange: (id: string) => void; label?: string }) {
  const [field, setField] = useState<CelebrityField | '全部'>('全部')
  const list = useMemo(
    () => (field === '全部' ? CELEBRITIES : CELEBRITIES.filter((c) => c.field === field)),
    [field],
  )
  return (
    <div>
      <div style={{ fontSize: 12, color: muted, marginBottom: 6 }}>{label ?? '选择一位名人'}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['全部', ...CELEBRITY_FIELDS] as const).map((f) => (
          <button key={f} onClick={() => setField(f)} style={chipStyle(field === f)}>{f}</button>
        ))}
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {list.map((c) => (
          <button key={c.id} onClick={() => onChange(c.id)} style={pickStyle(value === c.id)}>
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            <span style={{ fontSize: 10, color: muted }}>{c.field} · {c.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px', borderRadius: 10, fontSize: 12, cursor: 'pointer',
  border: active ? `1px solid ${accent}` : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(79,179,165,0.13)' : 'transparent',
  color: active ? accent : 'rgba(237,237,240,0.7)',
})
const pickStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
  padding: '7px 9px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
  border: active ? `1px solid ${accent}` : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(79,179,165,0.13)' : 'rgba(12,11,20,0.6)',
  color: '#EDEDF0',
})

export default function LibraryShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  // ===== 通用状态 =====
  const [view, setView] = useState<'arena' | 'deep'>('arena')
  const [tab, setTab] = useState<Tab>('club')
  const [topics, setTopics] = useState<string[]>([])
  const [online, setOnline] = useState(1)
  const [feed, setFeed] = useState<Array<{ id: string; who: string; text: string; time: string }>>([])
  const [chatMsgs, setChatMsgs] = useState<Array<{ id: string; nickname: string; text: string }>>([])
  const [showChat, setShowChat] = useState(false)
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pubNote, setPubNote] = useState('')

  // ===== 读书会 =====
  const [clubCelebId, setClubCelebId] = useState(CELEBRITIES[0].id)
  const [rec, setRec] = useState<{ book: string; author: string; reason: string } | null>(null)
  const [bookTitle, setBookTitle] = useState('')
  const [opening, setOpening] = useState('')
  const [clubLog, setClubLog] = useState<Array<{ role: ChatRole; content: string }>>([])
  const [clubInput, setClubInput] = useState('')

  // ===== 深度问答 =====
  const [chatCelebId, setChatCelebId] = useState(CELEBRITIES[4].id ?? CELEBRITIES[0].id)
  const [deepMsgs, setDeepMsgs] = useState<Array<{ role: ChatRole; content: string }>>([])
  const [deepInput, setDeepInput] = useState('')

  // ===== AI 馆员 =====
  const [topic, setTopic] = useState('量子物理入门')
  const [libQuestion, setLibQuestion] = useState('')
  const [libAnswer, setLibAnswer] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const shouldReconnect = useRef(true)

  // ===== 拉取主题 =====
  useEffect(() => {
    fetch('/api/library/topics')
      .then(async (r) => (r.json() as Promise<{ topics: string[] }>))
      .then((d) => setTopics(d.topics ?? []))
      .catch(() => { /* 忽略 */ })
  }, [])

  // ===== WebSocket：library:lobby =====
  useEffect(() => {
    if (!user?.userId) return
    shouldReconnect.current = true
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=library:lobby`

    const connect = () => {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onmessage = (ev) => {
        let msg: WSMessage
        try { msg = JSON.parse(ev.data as string) as WSMessage } catch { return }
        switch (msg.type) {
          case 'welcome':
            setOnline(msg.users.length); break
          case 'user_joined':
            setOnline((n) => n + 1); break
          case 'user_left':
            setOnline((n) => Math.max(1, n - 1)); break
          case 'chat':
            setChatMsgs((prev) => [...prev.slice(-40), { id: `${Date.now()}-${Math.random()}`, nickname: msg.nickname, text: msg.text }])
            break
          case 'scene_event': {
            const ev = msg.event as Record<string, unknown>
            const kind = String(ev.type ?? '')
            if (kind === 'celebrity_chat' || kind === 'book_club' || kind === 'librarian') {
              const who = String(ev.name ?? ev.topic ?? '馆员')
              const text = String(ev.answer ?? ev.opening ?? '')
              setFeed((prev) => [...prev.slice(-30), { id: `${Date.now()}-${Math.random()}`, who, text, time: new Date().toLocaleTimeString() }])
            }
            break
          }
          default:
            break
        }
      }
      ws.onclose = () => {
        wsRef.current = null
        if (shouldReconnect.current) reconnectTimer.current = window.setTimeout(connect, 3000)
      }
      ws.onerror = () => { ws.close() }
    }
    connect()
    return () => {
      shouldReconnect.current = false
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [user?.userId])

  const sendChat = (text: string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'chat', text }))
  }

  const flash = useCallback((msg: string) => {
    setPubNote(msg)
    window.setTimeout(() => setPubNote(''), 2200)
  }, [])

  // ===== 3D 中展示的名人（≤3）=====
  const viewCelebrities = useMemo<Celebrity[]>(() => {
    const ids = [...new Set([clubCelebId, chatCelebId])]
    return ids.map((id) => getCelebrity(id)).filter((c): c is Celebrity => Boolean(c)).slice(0, 3)
  }, [clubCelebId, chatCelebId])

  // ===== 读书会：推荐著作 =====
  const doRecommend = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/library/recommend', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ celebrityId: clubCelebId }) })
      const data = await res.json() as { book?: string; author?: string; reason?: string; message?: string }
      if (!res.ok || !data.book) throw new Error(data.message ?? '推荐失败')
      setRec({ book: data.book, author: data.author ?? '', reason: data.reason ?? '' })
    } catch (e) { setError(e instanceof Error ? e.message : '推荐失败') }
    finally { setBusy(false) }
  }

  // ===== 读书会：开场 =====
  const startClub = async () => {
    if (busy) return
    const celeb = getCelebrity(clubCelebId)
    if (!celeb) return
    setBusy(true); setError(''); setActiveSpeakerId(celeb.id)
    try {
      const res = await fetch('/api/library/book-club', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ celebrityId: clubCelebId, book: rec?.book, userId: user?.userId }) })
      const data = await res.json() as { book?: string; author?: string; reason?: string; opening?: string; message?: string }
      if (!res.ok || !data.opening) throw new Error(data.message ?? '开场失败')
      setBookTitle(data.book ?? '')
      if (data.book) {
        setRec((prev) => ({ book: data.book!, author: data.author ?? prev?.author ?? '', reason: data.reason ?? prev?.reason ?? '' }))
      }
      setOpening(data.opening)
      setClubLog([{ role: 'assistant', content: data.opening }])
    } catch (e) { setError(e instanceof Error ? e.message : '开场失败') }
    finally { setBusy(false); setActiveSpeakerId(null) }
  }

  // ===== 读书会：继续讨论 =====
  const askClub = async () => {
    const text = clubInput.trim()
    if (!text || busy) return
    const celeb = getCelebrity(clubCelebId)!
    const history = [...clubLog, { role: 'user' as ChatRole, content: text }]
    setClubLog(history); setClubInput(''); setBusy(true); setActiveSpeakerId(celeb.id)
    try {
      const res = await fetch('/api/library/celebrity-chat', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ celebrityId: clubCelebId, messages: history, userId: user?.userId }) })
      const data = await res.json() as { reply?: string; message?: string }
      if (!res.ok || !data.reply) throw new Error(data.message ?? '没有回复')
      setClubLog((prev) => {
        const next: Array<{ role: ChatRole; content: string }> = [...prev, { role: 'assistant', content: data.reply ?? '' }]
        return next.slice(-20)
      })
    } catch (e) { setError(e instanceof Error ? e.message : '没有回复') }
    finally { setBusy(false); setActiveSpeakerId(null) }
  }

  // ===== 深度问答 =====
  const sendDeep = async () => {
    const text = deepInput.trim()
    if (!text || busy) return
    const celeb = getCelebrity(chatCelebId)!
    const history = [...deepMsgs, { role: 'user' as ChatRole, content: text }]
    setDeepMsgs(history); setDeepInput(''); setBusy(true); setActiveSpeakerId(celeb.id)
    try {
      const res = await fetch('/api/library/celebrity-chat', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ celebrityId: chatCelebId, messages: history, userId: user?.userId }) })
      const data = await res.json() as { reply?: string; message?: string }
      if (!res.ok || !data.reply) throw new Error(data.message ?? '没有回复')
      setDeepMsgs((prev) => {
        const next: Array<{ role: ChatRole; content: string }> = [...prev, { role: 'assistant', content: data.reply ?? '' }]
        return next.slice(-20)
      })
    } catch (e) { setError(e instanceof Error ? e.message : '没有回复') }
    finally { setBusy(false); setActiveSpeakerId(null) }
  }

  // ===== AI 馆员 =====
  const askLibrarian = async () => {
    const q = libQuestion.trim()
    if (!q || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/library/librarian', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ topic, question: q, userId: user?.userId }) })
      const data = await res.json() as { answer?: string; message?: string }
      if (!res.ok || !data.answer) throw new Error(data.message ?? '馆员暂时不在')
      setLibAnswer(data.answer)
    } catch (e) { setError(e instanceof Error ? e.message : '馆员暂时不在') }
    finally { setBusy(false) }
  }

  // ===== 发布到广场 =====
  const publish = async (p: { title: string; answer: string; celebrityId?: string; celebrityName?: string; book?: string; question?: string; topics?: string[] }) => {
    try {
      const res = await fetch('/api/library/publish', { method: 'POST', headers: httpHeaders, body: JSON.stringify({ ...p, userId: user?.userId }) })
      if (!res.ok) throw new Error('发布失败')
      flash('已发布到广场')
    } catch { flash('发布失败') }
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: 'club', label: '名人读书会', icon: <BookOpen size={14} /> },
    { id: 'deep', label: '深度问答', icon: <MessageCircleQuestion size={14} /> },
    { id: 'librarian', label: 'AI 馆员', icon: <LibraryIcon size={14} /> },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0A0A0A', color: '#EDEDF0' }}>
      <img src="/scenes/library.png" alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.2, zIndex: 0, pointerEvents: 'none' }} />
      {/* 顶栏 */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#141414' }}>
        <button onClick={onBack} style={iconBtn}><ArrowLeft size={16} /></button>
        <LibraryIcon size={18} color={accent} />
        <strong style={{ letterSpacing: 1 }}>图书馆</strong>
        <span style={{ fontSize: 12, color: muted }}>安静 · 书卷气 · 与智者共读</span>
        {/* 主入口切换：知识擂台 / 深聊 */}
        <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
          <button onClick={() => setView('arena')} style={viewTabStyle(view === 'arena', true)}>知识擂台</button>
          <button onClick={() => setView('deep')} style={viewTabStyle(view === 'deep', false)}>深聊</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: accent, background: 'rgba(79,179,165,0.13)', borderRadius: 12, padding: '2px 10px' }}>
            <Users size={12} /> {online} 人在线
          </span>
          <button onClick={() => setShowChat((v) => !v)} style={ghostBtn}><MessagesSquare size={13} /> 小声聊天</button>
          {onPlaza && <button onClick={onPlaza} style={ghostBtn}>广场</button>}
        </div>
      </header>

      {view === 'arena' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#000000' }}>
          <Suspense fallback={<div style={{ padding: 80, textAlign: 'center', color: muted }}>擂台布置中…</div>}>
            <QuizArena onDeepChat={() => setView('deep')} />
          </Suspense>
        </div>
      )}

      {view === 'deep' && (
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧控制面板 */}
        <aside style={{ width: 380, overflowY: 'auto', padding: 14, borderRight: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} style={tabStyle(tab === t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ===== 读书会 ===== */}
          {tab === 'club' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={panel}>
                <CelebrityPicker value={clubCelebId} onChange={setClubCelebId} label="今晚与谁共读？" />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => void doRecommend()} disabled={busy} style={primaryBtn}><Sparkles size={13} /> {busy ? '思考中…' : '推荐一本著作'}</button>
                </div>
                {rec && (
                  <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ color: accent, fontWeight: 600 }}>{rec.book} · {rec.author}</div>
                    <div style={{ color: 'rgba(237,237,240,0.7)', marginTop: 4 }}>{rec.reason}</div>
                  </div>
                )}
                <button onClick={() => void startClub()} disabled={busy} style={{ ...primaryBtn, marginTop: 10 }}>
                  {opening ? '重新开始读书会' : '开始读书会'}
                </button>
              </div>

              {opening && (
                <div style={panel}>
                  <div style={{ fontSize: 12, color: accent, marginBottom: 6 }}>《{bookTitle}》读书会开场</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(237,237,240,0.9)' }}>{opening}</div>
                  <button onClick={() => void publish({ title: `${getCelebrity(clubCelebId)?.name ?? ''} 的读书会：《${bookTitle}》`, answer: opening, celebrityId: clubCelebId, celebrityName: getCelebrity(clubCelebId)?.name, book: bookTitle, topics: ['图书馆', '读书会'] })} style={secBtn}>
                    <BookmarkPlus size={13} /> 发布开场到广场
                  </button>
                </div>
              )}

              {/* 讨论记录 */}
              <div style={panel}>
                {clubLog.map((m, i) => (
                  <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                    <span style={{ fontSize: 12, color: muted }}>{m.role === 'user' ? '我' : getCelebrity(clubCelebId)?.name}</span>
                    <div style={{ display: 'inline-block', maxWidth: '92%', padding: '8px 11px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.65, background: m.role === 'user' ? 'rgba(90,110,160,0.25)' : 'rgba(79,179,165,0.13)', textAlign: 'left' }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input value={clubInput} onChange={(e) => setClubInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askClub() }}
                    placeholder="继续提问，参与讨论…" style={inputStyle} />
                  <button onClick={() => void askClub()} disabled={busy} style={sendBtn}><Send size={14} /></button>
                </div>
              </div>
            </div>
          )}

          {/* ===== 深度问答 ===== */}
          {tab === 'deep' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={panel}>
                <CelebrityPicker value={chatCelebId} onChange={setChatCelebId} label="向谁请教一个深问题？" />
                <div style={{ fontSize: 11, color: muted, marginTop: 6 }}>多轮对话，最多保留最近 10 轮；回答可较长，可展开论述。</div>
              </div>
              <div style={panel}>
                {deepMsgs.map((m, i) => (
                  <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                    <span style={{ fontSize: 12, color: muted }}>{m.role === 'user' ? '我' : getCelebrity(chatCelebId)?.name}</span>
                    <div style={{ display: 'inline-block', maxWidth: '92%', padding: '8px 11px', borderRadius: 10, fontSize: 13.5, lineHeight: 1.65, background: m.role === 'user' ? 'rgba(90,110,160,0.25)' : 'rgba(79,179,165,0.13)', textAlign: 'left' }}>
                      {m.content}
                      {m.role === 'assistant' && (
                        <button onClick={() => void publish({ title: `${getCelebrity(chatCelebId)?.name ?? ''}的一段回答`, answer: m.content, celebrityId: chatCelebId, celebrityName: getCelebrity(chatCelebId)?.name, question: deepMsgs[i - 1]?.content, topics: ['图书馆', getCelebrity(chatCelebId)?.field ?? ''] })} style={{ ...secBtn, display: 'block', marginTop: 6, fontSize: 11 }}>
                          <BookmarkPlus size={12} /> 发布金句到广场
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input value={deepInput} onChange={(e) => setDeepInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendDeep() }}
                    placeholder="提一个值得深谈的问题…" style={inputStyle} />
                  <button onClick={() => void sendDeep()} disabled={busy} style={sendBtn}><Send size={14} /></button>
                </div>
              </div>
            </div>
          )}

          {/* ===== AI 馆员 ===== */}
          {tab === 'librarian' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={panel}>
                <div style={{ fontSize: 12, color: muted, marginBottom: 6 }}>选择一个知识主题</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {(topics.length ? topics : LIBRARY_TOPIC_FALLBACK).map((t) => (
                    <button key={t} onClick={() => setTopic(t)} style={chipStyle(topic === t)}>{t}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <input value={libQuestion} onChange={(e) => setLibQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void askLibrarian() }}
                    placeholder={`关于「${topic}」，你想问什么？`} style={inputStyle} />
                  <button onClick={() => void askLibrarian()} disabled={busy} style={sendBtn}><Send size={14} /></button>
                </div>
              </div>
              {libAnswer && (
                <div style={panel}>
                  <div style={{ fontSize: 12, color: accent, marginBottom: 6 }}>AI 馆员 · {topic}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: 'rgba(237,237,240,0.9)' }}>{libAnswer}</div>
                  <button onClick={() => void publish({ title: `馆员笔记：${topic}`, answer: libAnswer, question: libQuestion, topics: ['图书馆', topic] })} style={{ ...secBtn, marginTop: 10 }}>
                    <BookmarkPlus size={13} /> 发布笔记到广场
                  </button>
                </div>
              )}
            </div>
          )}

          {error && <div style={{ color: '#e08a8a', fontSize: 12 }}>{error}</div>}
          {pubNote && <div style={{ color: accent, fontSize: 12 }}>{pubNote}</div>}
        </aside>

        {/* 右侧：3D 场景 + 动态/聊天 */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: muted }}>阅览室布置中…</div>}>
              <LibraryView celebrities={viewCelebrities} activeSpeakerId={activeSpeakerId} />
            </Suspense>
            <div style={{ position: 'absolute', left: 14, bottom: 12, fontSize: 11, color: 'rgba(237,237,240,0.3)' }}>
              拖动旋转 · 滚轮缩放 · 保持安静
            </div>
            {busy && <div style={{ position: 'absolute', right: 14, top: 12, fontSize: 12, color: accent }}>正在讲述…</div>}
          </div>

          {/* 阅览室动态（其他读者的问答同步） */}
          {feed.length > 0 && (
            <div style={{ maxHeight: 120, overflowY: 'auto', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 14px', fontSize: 12 }}>
              <div style={{ color: accent, marginBottom: 4 }}>阅览室动态</div>
              {feed.slice(-6).map((f) => (
                <div key={f.id} style={{ color: 'rgba(237,237,240,0.7)', marginBottom: 3 }}>
                  <b style={{ color: 'rgba(237,237,240,0.9)' }}>{f.who}</b>：{f.text.slice(0, 80)}{f.text.length > 80 ? '…' : ''}
                </div>
              ))}
            </div>
          )}
        </main>

        {/* 可折叠的安静聊天 */}
        {showChat && (
          <aside style={{ width: 280, borderLeft: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 10, fontSize: 12, color: accent, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>小声聊天（{chatMsgs.length}）</div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 10, fontSize: 12.5 }}>
              {chatMsgs.map((m) => (
                <div key={m.id} style={{ marginBottom: 8 }}>
                  <User size={11} style={{ display: 'inline', color: muted }} /> <b style={{ color: 'rgba(237,237,240,0.9)' }}>{m.nickname}</b>
                  <div style={{ color: 'rgba(237,237,240,0.7)' }}>{m.text}</div>
                </div>
              ))}
              {chatMsgs.length === 0 && <div style={{ color: muted }}>还没有人说话，嘘…</div>}
            </div>
            <ChatComposer onSend={sendChat} />
          </aside>
        )}
      </div>
      )}
    </div>
  )
}

function ChatComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        placeholder="轻声说一句…" style={{ ...inputStyle, flex: 1 }} />
      <button onClick={send} style={sendBtn}><Send size={13} /></button>
    </div>
  )
}

const LIBRARY_TOPIC_FALLBACK = ['量子物理入门', '经济学思维', '哲学经典', '艺术史', '心理学']

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#EDEDF0', borderRadius: 8, padding: '5px 9px', cursor: 'pointer',
}
const ghostBtn: React.CSSProperties = {
  ...iconBtn, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'rgba(237,237,240,0.7)',
}
const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '8px 4px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5,
  border: active ? `1px solid ${accent}` : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(79,179,165,0.13)' : 'rgba(12,11,20,0.6)',
  color: active ? accent : 'rgba(237,237,240,0.7)',
})
// 顶栏主入口切换：擂台用明黄，深聊用青
const viewTabStyle = (active: boolean, arena: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
  border: active ? `1px solid ${arena ? '#FFD600' : accent}` : '1px solid rgba(255,255,255,0.08)',
  background: active ? (arena ? '#FFD600' : 'rgba(79,179,165,0.13)') : 'rgba(12,11,20,0.6)',
  color: active ? (arena ? '#000' : accent) : 'rgba(237,237,240,0.7)',
})
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 9, cursor: 'pointer',
  border: 'none', background: '#EDEDF0', color: '#0A0A0A', fontSize: 13, fontWeight: 600,
}
const secBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(79,179,165,0.42)', background: 'transparent', color: accent, fontSize: 12,
}
const sendBtn: React.CSSProperties = {
  ...primaryBtn, padding: '0 12px', borderRadius: 9,
}
const inputStyle: React.CSSProperties = {
  flex: 1, padding: '9px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)',
  background: '#0F0F0F', color: '#EDEDF0', fontSize: 13, outline: 'none',
}
