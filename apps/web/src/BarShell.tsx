// M8: 酒吧辩论 — 完整 UI 壳
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft, Beer, Users, Send, Sparkles, Vote, MessageCircle, ChevronRight, Check,
} from 'lucide-react'
import { getCelebrity, type Celebrity, type WSMessage } from '@balabala/shared'
import { useIdentity } from './identity'
import { fetchMyCharacters, fetchPublicCharacters, type UiCharacter } from './custom-characters'

const BarView = lazy(() => import('./BarView'))

type Side = 'pro' | 'con'
type RoomPhase = 'pick' | 'debating' | 'summarized'

interface DebaterInfo {
  celebrityId: string
  name: string
  title?: string
  portrait?: string
  side: Side
}

interface TranscriptEntry {
  id: string
  speakerId?: string
  speakerName: string
  side: Side | 'bartender' | 'user'
  text: string
  quote?: string
  time: string
}

interface BarQuote {
  speaker: string
  text: string
  side: Side
}

interface ChatMsg {
  userId: string
  nickname: string
  text: string
}

const SIDE_LABEL: Record<Side, string> = { pro: '正方', con: '反方' }

export default function BarShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  // ===== 本地状态 =====
  const [phase, setPhase] = useState<RoomPhase>('pick')
  const [topics, setTopics] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [customTopic, setCustomTopic] = useState('')
  const [debaterList, setDebaterList] = useState<DebaterInfo[]>([])
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)
  const [votes, setVotes] = useState({ pro: 0, con: 0 })
  const [consensus, setConsensus] = useState('')
  const [quotes, setQuotes] = useState<BarQuote[]>([])
  const [online, setOnline] = useState(1)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [joined, setJoined] = useState<Side | null>(null)
  const [mySide, setMySide] = useState<Side>('pro')
  const [myText, setMyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyName, setBusyName] = useState('')
  const [published, setPublished] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  // 自定义辩手（我的 + 广场），可选加入辩论
  const [customDebaters, setCustomDebaters] = useState<UiCharacter[]>([])
  const [chosenDebaterIds, setChosenDebaterIds] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const activeTimer = useRef<number | null>(null)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  transcriptRef.current = transcript

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2400)
  }, [])

  // ===== 加载话题 =====
  useEffect(() => {
    fetch('/api/bar/topics')
      .then(async (r) => { if (!r.ok) throw new Error('topics'); return r.json() as Promise<{ topics: string[] }> })
      .then((d) => setTopics(d.topics))
      .catch(() => setTopics(['外卖迟到，该不该给差评？', 'AI 会不会取代人类的工作？', '恋爱里，该不该看对方手机？']))
  }, [])

  // ===== 加载可选自定义辩手（我的 + 广场，去重） =====
  useEffect(() => {
    const userId = user?.userId ?? ''
    if (!userId) return
    let alive = true
    Promise.all([fetchMyCharacters(userId), fetchPublicCharacters()]).then(([mine, pub]) => {
      if (!alive) return
      const seen = new Set(mine.map((c) => c.id))
      const merged = [...mine, ...pub.filter((c) => !seen.has(c.id))]
      setCustomDebaters(merged)
    })
    return () => { alive = false }
  }, [user?.userId])

  // ===== WS 房间 =====
  const handleSceneEvent = useCallback((event: Record<string, unknown>) => {
    const type = event.type
    switch (type) {
      case 'debate_start': {
        const list = (event.debaters ?? []) as DebaterInfo[]
        if (Array.isArray(list) && list.length) {
          setTopic(String(event.topic ?? ''))
          setDebaterList(list)
          setTranscript([])
          setQuotes([])
          setConsensus('')
          setVotes({ pro: 0, con: 0 })
          setPhase('debating')
        }
        break
      }
      case 'speech': {
        const speakerId = String(event.speakerId ?? '')
        const text = String(event.text ?? '')
        // 去重：本地 POST 响应已追加，WS 回显跳过。
        setTranscript((prev) => {
          if (prev.some((e) => e.speakerId === speakerId && e.text === text)) return prev
          return [...prev.slice(-80), {
            id: `${Date.now()}-${Math.random()}`,
            speakerId,
            speakerName: String(event.speakerName ?? ''),
            side: (event.side === 'con' ? 'con' : 'pro') as Side,
            text,
            quote: typeof event.quote === 'string' && event.quote ? event.quote : undefined,
            time: new Date().toISOString(),
          }]
        })
        break
      }
      case 'user_speech': {
        setTranscript((prev) => [...prev.slice(-80), {
          id: `${Date.now()}-${Math.random()}`,
          speakerName: String(event.nickname ?? '客人'),
          side: (event.side === 'con' ? 'con' : 'pro') as Side,
          text: String(event.text ?? ''),
          time: new Date().toISOString(),
        }])
        break
      }
      case 'vote_update': {
        setVotes({ pro: Number(event.pro ?? 0), con: Number(event.con ?? 0) })
        break
      }
      case 'summary': {
        setConsensus(String(event.consensus ?? ''))
        setQuotes(Array.isArray(event.quotes) ? (event.quotes as BarQuote[]) : [])
        setPhase('summarized')
        break
      }
    }
  }, [])

  useEffect(() => {
    if (!user?.userId) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=bar:lobby`
    let closed = false
    let timer: number | null = null
    const connect = () => {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onmessage = (ev) => {
        let msg: WSMessage
        try { msg = JSON.parse(ev.data) as WSMessage } catch { return }
        switch (msg.type) {
          case 'welcome': setOnline(msg.users.length); break
          case 'user_joined': setOnline((n) => n + 1); break
          case 'user_left': setOnline((n) => Math.max(1, n - 1)); break
          case 'chat':
            setChatMessages((p) => [...p.slice(-50), { userId: msg.userId, nickname: msg.nickname, text: msg.text }])
            break
          case 'scene_event': handleSceneEvent(msg.event); break
        }
      }
      ws.onclose = () => {
        if (!closed) timer = window.setTimeout(connect, 3000)
      }
      ws.onerror = () => { ws.close() }
    }
    connect()
    return () => { closed = true; if (timer) window.clearTimeout(timer); wsRef.current?.close(); wsRef.current = null }
  }, [user?.userId, handleSceneEvent])

  // ===== 动作 =====
  const activeTopic = customTopic.trim() || topic

  const startDebate = async () => {
    const t = activeTopic
    if (!t || busy) return
    setBusy(true); setBusyName('召集辩手中…')
    try {
      const res = await fetch('/api/bar/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: t, userId: user?.userId ?? '', celebrityIds: chosenDebaterIds }),
      })
      const data = await res.json() as { debaters?: DebaterInfo[]; topic?: string; message?: string }
      if (!res.ok) throw new Error(data.message ?? '开桌失败')
      if (Array.isArray(data.debaters)) {
        setDebaterList(data.debaters)
        setTopic(data.topic ?? t)
        setTranscript([])
        setQuotes([]); setConsensus('')
        setVotes({ pro: 0, con: 0 })
        setPhase('debating')
      }
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '开桌失败')
    } finally {
      setBusy(false); setBusyName('')
    }
  }

  const markActiveSpeaker = useCallback((id: string) => {
    setActiveSpeakerId(id)
    if (activeTimer.current) window.clearTimeout(activeTimer.current)
    activeTimer.current = window.setTimeout(() => setActiveSpeakerId(null), 3000)
  }, [])

  const speak = async (debater: DebaterInfo) => {
    if (busy || !activeTopic) return
    setBusy(true); setBusyName(`${debater.name} 正在发言…`)
    markActiveSpeaker(debater.celebrityId)
    const context = transcriptRef.current.map((e) => `【${e.speakerName}】${e.text}`)
    try {
      const res = await fetch('/api/bar/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celebrityId: debater.celebrityId, topic: activeTopic, side: debater.side, context }),
      })
      const data = await res.json() as { text?: string; quote?: string; message?: string }
      if (!res.ok) throw new Error(data.message ?? '发言失败')
      if (data.text) {
        setTranscript((prev) => [...prev.slice(-80), {
          id: `${Date.now()}-${Math.random()}`,
          speakerId: debater.celebrityId,
          speakerName: debater.name,
          side: debater.side,
          text: data.text!,
          quote: data.quote || undefined,
          time: new Date().toISOString(),
        }])
      }
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '发言失败')
    } finally {
      setBusy(false); setBusyName('')
    }
  }

  const joinSide = (side: Side) => { setJoined(side); setMySide(side) }

  const userSpeak = async () => {
    const text = myText.trim()
    if (!text || !joined) return
    try {
      await fetch('/api/bar/user-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, side: joined, userId: user?.userId ?? '', nickname: user?.nickname ?? '' }),
      })
      setMyText('')
    } catch { showNotice('发送失败') }
  }

  const castVote = async (side: Side) => {
    try {
      const res = await fetch('/api/bar/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, userId: user?.userId ?? '' }),
      })
      const data = await res.json() as { pro: number; con: number }
      if (typeof data.pro === 'number') setVotes({ pro: data.pro, con: data.con })
    } catch { showNotice('投票失败') }
  }

  const summarize = async () => {
    if (busy || !activeTopic) return
    setBusy(true); setBusyName('酒保听大家聊得差不多了…')
    try {
      const all = transcriptRef.current
      const proPoints = all.filter((e) => e.side === 'pro' && e.speakerId).map((e) => e.text)
      const conPoints = all.filter((e) => e.side === 'con' && e.speakerId).map((e) => e.text)
      const res = await fetch('/api/bar/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: activeTopic, proPoints, conPoints }),
      })
      const data = await res.json() as { consensus?: string; quotes?: BarQuote[]; message?: string }
      if (!res.ok) throw new Error(data.message ?? '总结失败')
      setConsensus(data.consensus ?? '')
      setQuotes(data.quotes ?? [])
      setPhase('summarized')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '总结失败')
    } finally {
      setBusy(false); setBusyName('')
    }
  }

  const publishQuote = async (quote: BarQuote, idx: number) => {
    const key = `${idx}:${quote.text}`
    if (published.has(key)) return
    try {
      const res = await fetch('/api/bar/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${activeTopic} · ${quote.speaker}`,
          topic: activeTopic,
          quote: quote.text,
          speaker: quote.speaker,
          side: quote.side,
          consensus,
          topics: [activeTopic],
          userId: user?.userId ?? '',
        }),
      })
      if (!res.ok) throw new Error('发布失败')
      setPublished((p) => new Set(p).add(key))
      showNotice('金句已发到广场 🍻')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '发布失败')
    }
  }

  const sendChat = () => {
    const text = chatInput.trim()
    if (!text || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'chat', text }))
    setChatInput('')
  }

  // 3D 用的名人对象（从 debaterList 映射）
  const viewCelebs: Celebrity[] = debaterList
    .map((d) => getCelebrity(d.celebrityId))
    .filter((c): c is Celebrity => Boolean(c))

  const proDebaters = debaterList.filter((d) => d.side === 'pro')
  const conDebaters = debaterList.filter((d) => d.side === 'con')

  const panelBg = '#160d06'
  const amber = '#ffb066'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0803', color: '#f4e8d2' }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        background: '#1a0f08', borderBottom: '1px solid #3a2410',
      }}>
        <button onClick={onBack} style={headerBtn}><ArrowLeft size={16} /></button>
        <span style={{ fontSize: 18, fontWeight: 700, color: amber }}>🍺 酒吧辩论</span>
        <span style={{ fontSize: 12, color: '#9a7a50' }}>暖光小馆 · 不站队，只聊最有趣的</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c9a270' }}>
          <Users size={14} /> {online} 位客人
        </span>
        {onPlaza && (
          <button onClick={onPlaza} style={{ ...headerBtn, color: amber }}>广场 →</button>
        )}
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左：3D 场景 */}
        <div style={{ flex: 1.4, position: 'relative', minWidth: 0 }}>
          {viewCelebs.length > 0 ? (
            <Suspense fallback={<LoadingBar name={busyName} />}>
              <BarView celebrities={viewCelebs} activeSpeakerId={activeSpeakerId} />
            </Suspense>
          ) : (
            <div style={{
              height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', color: '#7a5a30', gap: 12,
            }}>
              <Beer size={48} />
              <div style={{ fontSize: 15 }}>挑一个话题，开一桌酒，让名人们先吵起来</div>
            </div>
          )}
          {busy && (
            <div style={{
              position: 'absolute', left: 16, bottom: 16, padding: '8px 14px',
              background: 'rgba(40,20,8,0.85)', border: '1px solid #5a3a22', borderRadius: 8,
              fontSize: 13, color: amber,
            }}>
              {busyName || '…'}
            </div>
          )}
          {notice && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              padding: '8px 16px', background: '#ffb066', color: '#1a0f08', borderRadius: 8,
              fontSize: 13, fontWeight: 600, zIndex: 5,
            }}>{notice}</div>
          )}
        </div>

        {/* 右：控制面板 */}
        <div style={{
          width: 420, background: panelBg, borderLeft: '1px solid #3a2410',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          {/* 话题选择 / 辩手 */}
          {phase === 'pick' ? (
            <div style={{ padding: 18, overflowY: 'auto' }}>
              <SectionTitle>选个话题开桌</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {topics.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTopic(t); setCustomTopic('') }}
                    style={{
                      ...topicBtn,
                      borderColor: topic === t && !customTopic ? amber : '#3a2410',
                      background: topic === t && !customTopic ? 'rgba(255,176,102,0.12)' : 'transparent',
                    }}
                  >{t}</button>
                ))}
              </div>
              <input
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                placeholder="或者自己想一个话题…"
                style={inputStyle}
              />
              {/* 可选：自定义辩手（我的 + 广场人物） */}
              {customDebaters.length > 0 && (
                <>
                  <SectionTitle>邀位自定义辩手（可选）</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 180, overflowY: 'auto' }}>
                    {customDebaters.map((c) => {
                      const on = chosenDebaterIds.includes(c.id)
                      return (
                        <button
                          key={c.id}
                          onClick={() => setChosenDebaterIds((prev) => on ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                            background: on ? 'rgba(255,176,102,0.18)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${on ? '#ffb066' : '#3a2410'}`,
                            borderRadius: 6, color: '#f0e2c8', cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          {c.portrait ? (
                            <img src={c.portrait} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#3a2410', fontSize: 12 }}>{c.name[0]}</span>
                          )}
                          <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
                          <span style={{ fontSize: 11, color: '#9a7a50' }}>{c.visibility === 'public' ? '广场' : '我的'}</span>
                          {on && <Check size={13} color="#ffb066" />}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              <button
                onClick={startDebate}
                disabled={(!topic && !customTopic.trim()) || busy}
                style={{ ...primaryBtn, marginTop: 12, opacity: (!topic && !customTopic.trim()) || busy ? 0.5 : 1 }}
              >
                <Beer size={15} /> {busy ? '正在召集…' : '开始辩论'}
              </button>
            </div>
          ) : (
            <>
              {/* 辩论进行区 */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #3a2410' }}>
                <SectionTitle>话题：{activeTopic}</SectionTitle>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <SideGroup label="正方" color="#6ab0ff" debaters={proDebaters} activeId={activeSpeakerId} onSpeak={speak} disabled={busy} />
                  <SideGroup label="反方" color="#ff8a6a" debaters={conDebaters} activeId={activeSpeakerId} onSpeak={speak} disabled={busy} />
                </div>
                {/* 投票 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#9a7a50', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Vote size={13} /> 谁更有趣
                  </span>
                  <button onClick={() => castVote('pro')} style={{ ...voteBtn, borderColor: '#6ab0ff', color: '#9cc8ff' }}>
                    正方 {votes.pro}
                  </button>
                  <button onClick={() => castVote('con')} style={{ ...voteBtn, borderColor: '#ff8a6a', color: '#ffb09a' }}>
                    反方 {votes.con}
                  </button>
                </div>
              </div>

              {/* 发言记录 */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px', minHeight: 0 }}>
                {transcript.length === 0 && (
                  <div style={{ color: '#7a5a30', fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                    点一位名人的「发言」，先让场子热起来
                  </div>
                )}
                {transcript.map((e) => (
                  <div key={e.id} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: e.side === 'pro' ? '#9cc8ff' : e.side === 'con' ? '#ffb09a' : '#c9a270', marginBottom: 3 }}>
                      {e.side === 'user' ? '👤 ' : ''}{e.speakerName}
                      {e.side === 'pro' ? ' · 正方' : e.side === 'con' ? ' · 反方' : ''}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.5, color: '#f0e2c8' }}>{e.text}</div>
                    {e.quote && (
                      <div style={{
                        marginTop: 4, padding: '4px 10px', borderLeft: `3px solid ${amber}`,
                        background: 'rgba(255,176,102,0.08)', fontSize: 13, color: amber,
                      }}>“{e.quote}”</div>
                    )}
                  </div>
                ))}
              </div>

              {/* 酒保总结 */}
              {consensus && (
                <div style={{ padding: '12px 18px', borderTop: '1px solid #3a2410', background: 'rgba(255,176,102,0.06)' }}>
                  <SectionTitle>🍸 酒保小结</SectionTitle>
                  <div style={{ fontSize: 13, lineHeight: 1.6, color: '#e8d0a8', marginBottom: 10 }}>{consensus}</div>
                  {quotes.map((q, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                      padding: '6px 10px', background: 'rgba(255,176,102,0.08)', borderRadius: 6,
                    }}>
                      <div style={{ flex: 1, fontSize: 13, color: amber }}>
                        “{q.text}”<span style={{ color: '#9a7a50', fontSize: 11 }}> — {q.speaker}</span>
                      </div>
                      <button
                        onClick={() => publishQuote(q, i)}
                        disabled={published.has(`${i}:${q.text}`)}
                        style={{
                          ...voteBtn,
                          opacity: published.has(`${i}:${q.text}`) ? 0.6 : 1,
                          color: published.has(`${i}:${q.text}`) ? '#7ad39a' : '#f0e2c8',
                        }}
                      >
                        {published.has(`${i}:${q.text}`) ? <><Check size={12} /> 已发</> : '发广场'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 底部：用户发言 + 酒保按钮 */}
              <div style={{ padding: 12, borderTop: '1px solid #3a2410' }}>
                {!joined ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: '#9a7a50', alignSelf: 'center' }}>你站哪边：</span>
                    <button onClick={() => joinSide('pro')} style={{ ...voteBtn, borderColor: '#6ab0ff', color: '#9cc8ff' }}>正方</button>
                    <button onClick={() => joinSide('con')} style={{ ...voteBtn, borderColor: '#ff8a6a', color: '#ffb09a' }}>反方</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: joined === 'pro' ? '#9cc8ff' : '#ffb09a', alignSelf: 'center' }}>
                      你是{joined === 'pro' ? '正方' : '反方'}
                    </span>
                    <input
                      value={myText}
                      onChange={(e) => setMyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void userSpeak() }}
                      placeholder="说两句…"
                      style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                    />
                    <button onClick={userSpeak} style={{ ...primaryBtn, padding: '8px 12px', marginTop: 0 }}>
                      <Send size={13} />
                    </button>
                  </div>
                )}
                {/* 聊天 */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }}
                    placeholder="和客人闲聊…"
                    style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                  />
                  <button onClick={sendChat} style={{ ...voteBtn }}><MessageCircle size={13} /></button>
                </div>
                {chatMessages.slice(-3).map((m, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#9a7a50', marginBottom: 2 }}>
                    {m.nickname}：{m.text}
                  </div>
                ))}
                <button onClick={summarize} disabled={busy || transcript.length === 0} style={{ ...primaryBtn, width: '100%', opacity: busy || transcript.length === 0 ? 0.5 : 1 }}>
                  <Sparkles size={14} /> {phase === 'summarized' ? '重新听酒保小结' : '喊酒保总结'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- 子组件 ---------- */
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: '#c9a270', marginBottom: 10, letterSpacing: 1 }}>
      {children}
    </div>
  )
}

function SideGroup({
  label, color, debaters, activeId, onSpeak, disabled,
}: {
  label: string
  color: string
  debaters: DebaterInfo[]
  activeId: string | null
  onSpeak: (d: DebaterInfo) => void
  disabled: boolean
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {debaters.map((d) => (
          <button
            key={d.celebrityId}
            onClick={() => onSpeak(d)}
            disabled={disabled}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              background: d.celebrityId === activeId ? 'rgba(255,176,102,0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${d.celebrityId === activeId ? '#ffb066' : '#3a2410'}`,
              borderRadius: 6, color: '#f0e2c8', cursor: disabled ? 'wait' : 'pointer', textAlign: 'left',
            }}
          >
            {d.portrait && (
              <img src={d.portrait} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
            )}
            <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
            <ChevronRight size={13} color="#9a7a50" />
          </button>
        ))}
      </div>
    </div>
  )
}

function LoadingBar({ name }: { name: string }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f0803', color: '#ffb066', fontSize: 14,
    }}>
      {name || '布置酒吧中…'}
    </div>
  )
}

/* ---------- 样式常量 ---------- */
const headerBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', background: 'transparent', border: '1px solid #3a2410',
  borderRadius: 6, color: '#c9a270', cursor: 'pointer', fontSize: 13,
}

const topicBtn: CSSProperties = {
  padding: '8px 12px', background: 'transparent', border: '1px solid #3a2410',
  borderRadius: 6, color: '#e8d0a8', cursor: 'pointer', fontSize: 13, textAlign: 'left',
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 6,
  border: '1px solid #3a2410', background: '#0d0702', color: '#f0e2c8', fontSize: 13,
  outline: 'none', marginBottom: 8,
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '10px 16px', background: '#ffb066', border: 'none', borderRadius: 6,
  color: '#1a0f08', fontSize: 14, fontWeight: 700, cursor: 'pointer', marginTop: 8,
}

const voteBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', background: 'transparent', border: '1px solid #3a2410',
  borderRadius: 6, cursor: 'pointer', fontSize: 13,
}
