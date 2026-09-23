import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Users, Mic, Sparkles, Crown, Send, Upload, MessageCircle } from 'lucide-react'
import { CELEBRITIES, getCelebrity, resolveCharacterVoice, type Celebrity, type WSMessage } from '@balabala/shared'
import { useIdentity } from './identity'
import { playTts } from './tts'
import { getVoiceEnabled } from './voice-settings'

const TalkshowView = lazy(() => import('./TalkshowView'))

const YELLOW = '#FFD600'

/** 反应标签 → emoji 映射。 */
const REACTION_EMOJI: Record<string, string> = {
  笑声: '😂', 鼓掌: '👏', 起哄: '🤭', 冷场: '🤐',
  欢呼: '🎉', 叹息: '😮‍💨', 爆笑: '🤣',
}

type TranscriptEntry =
  | { id: string; kind: 'performance'; performer: string; text: string; score: number; reactions: string[]; time: string }
  | { id: string; kind: 'celebrity'; name: string; jokes: string[]; score: number; time: string }
  | { id: string; kind: 'chat'; nickname: string; text: string; time: string }

export default function TalkshowShell({ onBack, onPlaza }: { onBack: () => void; onPlaza?: () => void }) {
  const { user } = useIdentity()

  // ===== 3D 舞台状态 =====
  const [stageCelebrities, setStageCelebrities] = useState<Celebrity[]>([])
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null)

  // ===== 文本表演 =====
  const [inputText, setInputText] = useState('')
  const [performing, setPerforming] = useState(false)
  const [lastResult, setLastResult] = useState<{ score: number; reactions: string[]; comment: string } | null>(null)
  const [ttsOn, setTtsOn] = useState(() => getVoiceEnabled())

  // ===== AI 帮写 =====
  const [aiTopic, setAiTopic] = useState('')
  const [aiStyle, setAiStyle] = useState('')
  const [aiWriting, setAiWriting] = useState(false)

  // ===== 名人 open-mic =====
  const [celebrityId, setCelebrityId] = useState(CELEBRITIES[0]?.id ?? '')
  const [celebrityBusy, setCelebrityBusy] = useState(false)

  // ===== 发布广场 =====
  const [publishStatus, setPublishStatus] = useState('')

  // ===== 多人 / transcript =====
  const [onlineCount, setOnlineCount] = useState(1)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const wsShouldReconnect = useRef(true)

  const pushEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev.slice(-40), entry])
  }, [])

  // ===== TTS 朗读 =====
  // 脱口秀本地开关默认跟随全局语音开关；上台观众本人用默认音色，名人用其专属音色。
  const speak = useCallback(async (text: string, voice?: string) => {
    if (!ttsOn || !text) return
    try {
      await playTts(text, voice)
    } catch { /* 浏览器自动播放限制等，忽略 */ }
  }, [ttsOn])

  // ===== WebSocket 连接 talkshow:lobby =====
  useEffect(() => {
    if (!user?.userId) return
    wsShouldReconnect.current = true
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/api/ws?userId=${encodeURIComponent(user.userId)}&room=talkshow:lobby`

    const connect = () => {
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onmessage = (ev) => {
        let msg: WSMessage
        try { msg = JSON.parse(ev.data) as WSMessage } catch { return }
        switch (msg.type) {
          case 'welcome':
            setOnlineCount(msg.users.length)
            break
          case 'user_joined':
            setOnlineCount((n) => n + 1)
            break
          case 'user_left':
            setOnlineCount((n) => Math.max(1, n - 1))
            break
          case 'chat':
            pushEntry({ id: `${Date.now()}-${Math.random()}`, kind: 'chat', nickname: msg.nickname, text: msg.text, time: new Date().toISOString() })
            break
          case 'scene_event': {
            const ev = msg.event as Record<string, unknown>
            if (ev.type === 'performance') {
              pushEntry({
                id: `${Date.now()}-${Math.random()}`,
                kind: 'performance',
                performer: String(ev.performer ?? '观众'),
                text: String(ev.text ?? ''),
                score: Number(ev.score ?? 0),
                reactions: Array.isArray(ev.reactions) ? (ev.reactions as unknown[]).map(String) : [],
                time: new Date().toISOString(),
              })
            } else if (ev.type === 'celebrity_set') {
              const cid = String(ev.celebrityId ?? '')
              const celeb = getCelebrity(cid)
              if (celeb) {
                setStageCelebrities([celeb])
                setActiveSpeakerId(cid)
              }
              const jokes = Array.isArray(ev.jokes) ? (ev.jokes as unknown[]).map(String) : []
              pushEntry({
                id: `${Date.now()}-${Math.random()}`,
                kind: 'celebrity',
                name: String(ev.name ?? '名人'),
                jokes,
                score: Number(ev.score ?? 0),
                time: new Date().toISOString(),
              })
              // 名人才艺秀：用该名人的专属音色朗读第一条段子。
              if (jokes.length) void speak(jokes[0], resolveCharacterVoice(cid))
            }
            break
          }
        }
      }
      ws.onclose = () => {
        wsRef.current = null
        if (wsShouldReconnect.current) reconnectTimer.current = window.setTimeout(connect, 3000)
      }
      ws.onerror = () => { ws.close() }
    }
    connect()
    return () => {
      wsShouldReconnect.current = false
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [user?.userId, pushEntry, speak])

  // ===== 上台讲一段 =====
  const perform = async () => {
    const text = inputText.trim()
    if (!text || performing) return
    setPerforming(true)
    setLastResult(null)
    try {
      const res = await fetch('/api/talkshow/perform', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, userId: user?.userId, nickname: user?.nickname }),
      })
      const data = await res.json() as { score?: number; reactions?: string[]; comment?: string; message?: string }
      if (!res.ok) throw new Error(data.message ?? '表演失败')
      const result = { score: Number(data.score ?? 0), reactions: data.reactions ?? [], comment: data.comment ?? '' }
      setLastResult(result)
      pushEntry({
        id: `${Date.now()}-local`, kind: 'performance',
        performer: user?.nickname ?? '我', text, score: result.score, reactions: result.reactions,
        time: new Date().toISOString(),
      })
      void speak(text)
    } catch (e) {
      setLastResult({ score: 0, reactions: [], comment: e instanceof Error ? e.message : '表演失败' })
    } finally {
      setPerforming(false)
    }
  }

  // ===== AI 帮写段子 =====
  const aiWrite = async () => {
    const topic = aiTopic.trim()
    if (!topic || aiWriting) return
    setAiWriting(true)
    try {
      const res = await fetch('/api/talkshow/ai-write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, style: aiStyle.trim() }),
      })
      const data = await res.json() as { joke?: string; message?: string }
      if (!res.ok || !data.joke) throw new Error(data.message ?? '帮写失败')
      setInputText(data.joke)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '帮写失败')
    } finally {
      setAiWriting(false)
    }
  }

  // ===== 名人 open-mic =====
  const celebrityOpenMic = async () => {
    if (!celebrityId || celebrityBusy) return
    setCelebrityBusy(true)
    try {
      const res = await fetch('/api/talkshow/celebrity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ celebrityId }),
      })
      const data = await res.json() as { celebrityId?: string; name?: string; jokes?: string[]; score?: number; message?: string }
      if (!res.ok || !data.jokes) throw new Error(data.message ?? '名人登场失败')
      const cid = data.celebrityId ?? celebrityId
      const celeb = getCelebrity(cid)
      if (celeb) {
        setStageCelebrities([celeb])
        setActiveSpeakerId(cid)
      }
      pushEntry({
        id: `${Date.now()}-celebrity`, kind: 'celebrity',
        name: data.name ?? celeb?.name ?? '名人', jokes: data.jokes, score: Number(data.score ?? 0),
        time: new Date().toISOString(),
      })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '名人登场失败')
    } finally {
      setCelebrityBusy(false)
    }
  }

  // ===== 发布到广场 =====
  const publishToPlaza = async () => {
    if (!lastResult || publishStatus) return
    setPublishStatus('发布中…')
    try {
      const title = inputText.trim().slice(0, 20) || '我的开放麦片段'
      const res = await fetch('/api/talkshow/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, text: inputText.trim(), performer: user?.nickname,
          score: lastResult.score, reactions: lastResult.reactions,
          topics: ['脱口秀', '开放麦'], userId: user?.userId,
        }),
      })
      const data = await res.json() as { content?: unknown; message?: string }
      if (!res.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setPublishStatus('已发布到广场')
      window.setTimeout(() => onPlaza?.(), 900)
    } catch (e) {
      setPublishStatus(e instanceof Error ? e.message : '发布失败')
    }
    window.setTimeout(() => setPublishStatus(''), 2200)
  }

  // ===== 发送聊天 =====
  const sendChat = () => {
    const text = chatDraft.trim()
    if (!text) return
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'chat', text }))
    setChatDraft('')
  }

  const panel: React.CSSProperties = {
    background: 'rgba(12,12,14,0.82)', border: '1px solid rgba(255,214,0,0.25)',
    borderRadius: 14, padding: 14, backdropFilter: 'blur(8px)',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050505', color: '#f4f2ec', fontFamily: 'inherit' }}>
      {/* 3D 背景占满全屏 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <Suspense fallback={null}>
          <TalkshowView celebrities={stageCelebrities} activeSpeakerId={activeSpeakerId} />
        </Suspense>
      </div>

      {/* 顶栏 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', zIndex: 10 }}>
        <button onClick={onBack} style={{ ...btn, background: 'rgba(12,12,14,0.8)', border: '1px solid rgba(255,214,0,0.3)', color: YELLOW }}>
          <ArrowLeft size={15} /> 返回
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...pill }}><Mic size={13} /> OPEN MIC 剧场</span>
          <span style={{ ...pill, color: YELLOW }}><Users size={13} /> {onlineCount} 人在线</span>
          {onPlaza && <button onClick={onPlaza} style={{ ...btn, background: YELLOW, color: '#111', fontWeight: 700 }}>去广场</button>}
        </div>
      </div>

      {/* 左侧：表演控制台 */}
      <div style={{ position: 'absolute', left: 16, top: 64, bottom: 16, width: 340, overflowY: 'auto', zIndex: 10, ...panel }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, color: YELLOW }}>🎤 上台讲一段</h2>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9a9c92' }}>讲个段子，AI 虚拟观众现场打分。</p>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="把你想说的段子写在这里…"
          maxLength={500}
          rows={4}
          style={textarea}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button onClick={() => void perform()} disabled={!inputText.trim() || performing} style={{ ...btn, background: YELLOW, color: '#111', fontWeight: 700, flex: 1 }}>
            <Mic size={15} /> {performing ? '观众笑…' : '上台讲'}
          </button>
          <label style={{ fontSize: 12, color: '#9a9c92', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={ttsOn} onChange={(e) => setTtsOn(e.target.checked)} /> TTS 朗读
          </label>
        </div>

        {/* 观众评分 */}
        {lastResult && (
          <div style={{ margin: '8px 0', padding: 10, background: 'rgba(255,214,0,0.06)', borderRadius: 10, border: '1px solid rgba(255,214,0,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 40, fontWeight: 800, color: YELLOW, lineHeight: 1 }}>{lastResult.score}</span>
              <span style={{ fontSize: 12, color: '#9a9c92' }}>/ 100</span>
            </div>
            <div style={{ margin: '6px 0', fontSize: 18 }}>
              {lastResult.reactions.map((r) => <span key={r} style={{ marginRight: 6 }}>{REACTION_EMOJI[r] ?? r} {r}</span>)}
            </div>
            {lastResult.comment && <p style={{ margin: 0, fontSize: 13, color: '#c8c8c0' }}>观众：“{lastResult.comment}”</p>}
            <button onClick={() => void publishToPlaza()} disabled={!!publishStatus} style={{ ...btn, marginTop: 8, width: '100%', justifyContent: 'center' }}>
              <Upload size={14} /> {publishStatus || '发布精彩片段到广场'}
            </button>
          </div>
        )}

        <div style={{ borderTop: '1px solid rgba(255,214,0,0.15)', margin: '12px 0' }} />

        {/* AI 帮写 */}
        <div style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginBottom: 6 }}><Sparkles size={13} /> AI 帮写段子</div>
        <input value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="主题，例如：加班、相亲、养猫" style={input} />
        <input value={aiStyle} onChange={(e) => setAiStyle(e.target.value)} placeholder="风格（可选），例如：自嘲、谐音梗" style={{ ...input, marginTop: 6 }} />
        <button onClick={() => void aiWrite()} disabled={!aiTopic.trim() || aiWriting} style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center' }}>
          <Sparkles size={14} /> {aiWriting ? '编剧中…' : '生成段子'}
        </button>

        <div style={{ borderTop: '1px solid rgba(255,214,0,0.15)', margin: '12px 0' }} />

        {/* 名人 open-mic */}
        <div style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginBottom: 6 }}><Crown size={13} /> 名人 open-mic</div>
        <select value={celebrityId} onChange={(e) => setCelebrityId(e.target.value)} style={input}>
          {CELEBRITIES.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.title}</option>)}
        </select>
        <button onClick={() => void celebrityOpenMic()} disabled={!celebrityId || celebrityBusy} style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center' }}>
          <Crown size={14} /> {celebrityBusy ? '名人上台…' : '请名人上台'}
        </button>
      </div>

      {/* 右侧：现场 transcript + 聊天 */}
      <div style={{ position: 'absolute', right: 16, top: 64, bottom: 16, width: 360, display: 'flex', flexDirection: 'column', zIndex: 10, ...panel }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: YELLOW, marginBottom: 8 }}>🎬 现场记录</div>
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
          {transcript.length === 0 && <p style={{ fontSize: 12, color: '#6a6d64' }}>还没有人上台，你先来开个场吧。</p>}
          {transcript.map((t) => (
            <div key={t.id} style={{ marginBottom: 10, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
              {t.kind === 'performance' && (
                <>
                  <div style={{ fontSize: 13 }}><b style={{ color: YELLOW }}>{t.performer}</b> <span style={{ color: YELLOW, fontWeight: 700 }}>{t.score}分</span> {t.reactions.map((r) => <span key={r}>{REACTION_EMOJI[r] ?? ''}</span>)}</div>
                  <div style={{ fontSize: 13, color: '#c8c8c0', marginTop: 2 }}>{t.text}</div>
                </>
              )}
              {t.kind === 'celebrity' && (
                <>
                  <div style={{ fontSize: 13 }}><b style={{ color: YELLOW }}>🌟 {t.name}</b> <span style={{ color: YELLOW }}>{t.score}分</span></div>
                  {t.jokes.map((j, i) => <div key={i} style={{ fontSize: 13, color: '#c8c8c0', marginTop: 2 }}>“{j}”</div>)}
                </>
              )}
              {t.kind === 'chat' && (
                <div style={{ fontSize: 13, color: '#c8c8c0' }}><b>{t.nickname}</b>：{t.text}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendChat() }} placeholder="和观众说点什么…" style={{ ...input, flex: 1, margin: 0 }} />
          <button onClick={sendChat} style={{ ...btn, padding: '0 10px' }}><MessageCircle size={14} /></button>
        </div>
      </div>

      {/* 底部提示 */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, fontSize: 12, color: '#6a6d64', background: 'rgba(0,0,0,0.5)', padding: '4px 14px', borderRadius: 20 }}>
        拖动旋转 · 滚轮缩放 · 享受今晚的开放麦
      </div>
    </div>
  )
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px',
  borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
  background: '#222', color: '#f4f2ec',
}
const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'rgba(12,12,14,0.8)', border: '1px solid rgba(255,214,0,0.25)',
  borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#c8c8c0',
}
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #333', background: '#0d0d0d', color: '#f4f2ec', fontSize: 13, outline: 'none',
}
const textarea: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
  border: '1px solid #333', background: '#0d0d0d', color: '#f4f2ec', fontSize: 13, outline: 'none', resize: 'vertical',
}