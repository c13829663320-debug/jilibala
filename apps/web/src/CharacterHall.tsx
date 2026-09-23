import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import { ChevronRight, Gavel, Loader2, MessageCircle, RotateCw, Search, X } from 'lucide-react'
import { CELEBRITIES, CELEBRITY_FIELDS, type Celebrity, type CelebrityField } from '@balabala/shared'
import { TtsPlayButton } from './TtsPlayButton'
import './character-hall.css'

type ChatTurn = { from: 'me' | 'character'; text: string }
type CharacterHallProps = {
  onBack: () => void
  onEnterCourt: (character?: Celebrity) => void
  onPlaza?: () => void
}

const FIELD_GRADIENTS: Record<CelebrityField, string> = {
  科技: 'linear-gradient(145deg,#3b4a8f,#161d44)',
  商业: 'linear-gradient(145deg,#8f6b3b,#432f14)',
  科学: 'linear-gradient(145deg,#2f7d6e,#0e342c)',
  文学: 'linear-gradient(145deg,#7d3b6e,#331229)',
  艺术: 'linear-gradient(145deg,#8f4b3b,#421c14)',
  哲学: 'linear-gradient(145deg,#5b3b8f,#201240)',
}

function Portrait({ celebrity, className }: { celebrity: Celebrity; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={className} style={{ background: FIELD_GRADIENTS[celebrity.field] }} aria-hidden="true">
        <span className="portrait-initial">{celebrity.name[0]}</span>
      </div>
    )
  }
  return (
    <img
      className={className}
      src={celebrity.portrait}
      alt={celebrity.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/* ===== 3D 全身模型展示 ===== */

/** Error boundary so a failed GLB degrades to the portrait image instead of crashing the dialog. */
class ModelViewerErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Celebrity 3D model failed to load', error, info.componentStack)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Load a full-body GLB and normalize it to a fixed height with feet on y=0. */
function FullBodyModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = (() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    // Normalize by HEIGHT (size.y) — full-body models are tall, not busts.
    const scale = 2.0 / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  })()
  return <primitive object={normalized} />
}

/** Fires onReady once its subtree (the GLB) has resolved out of Suspense. */
function ModelReady({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady() }, [onReady])
  return null
}

function ModelCanvas({ url, onReady, autoRotate }: { url: string; onReady: () => void; autoRotate: boolean }) {
  return (
    <Canvas camera={{ position: [0, 1.35, 3.4], fov: 38 }} dpr={[1, 1.5]} shadows>
      <color attach="background" args={['#0b0b0b']} />
      <ambientLight intensity={0.75} color="#fff4d6" />
      <directionalLight position={[3, 6, 4]} intensity={1.5} color="#ffffff" castShadow />
      <pointLight position={[-2.5, 2, 2.5]} intensity={12} distance={9} color="#FFD600" />
      <pointLight position={[2.5, 1.2, 1.5]} intensity={6} distance={8} color="#ffb347" />
      <Suspense fallback={null}>
        <group>
          <FullBodyModel url={url} />
          <ModelReady onReady={onReady} />
        </group>
      </Suspense>
      <ContactShadows position={[0, 0, 0]} opacity={0.65} scale={4.5} blur={2.4} far={2.6} resolution={512} color="#000000" />
      <OrbitControls
        enablePan={false}
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        minDistance={1.5}
        maxDistance={5}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2 + 0.15}
        target={[0, 1.0, 0]}
      />
    </Canvas>
  )
}

function CharacterModelViewer({ celebrity }: { celebrity: Celebrity }) {
  const [loaded, setLoaded] = useState(false)
  const [spinning, setSpinning] = useState(false)
  // Reset loading state when switching celebrities (key remount also handles this).
  useEffect(() => { setLoaded(false) }, [celebrity.id])

  return (
    <div className="character-viewer">
      <ModelViewerErrorBoundary
        fallback={<Portrait celebrity={celebrity} className="character-viewer__fallback" />}
      >
        <ModelCanvas url={celebrity.model ?? ''} onReady={() => setLoaded(true)} autoRotate={spinning} />
      </ModelViewerErrorBoundary>
      {!loaded && (
        <div className="character-viewer__loading">
          <Loader2 size={18} className="spin" />
          <span>加载 3D 模型…</span>
        </div>
      )}
      <button
        type="button"
        className={`character-viewer__spin` + (spinning ? ' is-on' : '')}
        onClick={() => setSpinning((v) => !v)}
        aria-pressed={spinning}
        title={spinning ? '停止自动旋转' : '开启自动旋转'}
      >
        <RotateCw size={13} aria-hidden="true" /> {spinning ? '停止旋转' : '自动旋转'}
      </button>
      <span className="character-viewer__hint">拖动可旋转查看</span>
    </div>
  )
}

export default function CharacterHall({ onBack, onEnterCourt, onPlaza }: CharacterHallProps) {
  const [activeField, setActiveField] = useState<CelebrityField | '全部'>('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Celebrity | null>(null)
  const [chats, setChats] = useState<Record<string, ChatTurn[]>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const filtered = CELEBRITIES.filter((c) => {
    const inField = activeField === '全部' || c.field === activeField
    const q = query.trim()
    const inQuery = !q || c.name.includes(q) || c.title.includes(q) || c.intro.includes(q) || c.tags.some((t) => t.includes(q))
    return inField && inQuery
  })

  const openChat = (celebrity: Celebrity) => {
    setSelected(celebrity)
    setError('')
    setChats((prev) => prev[celebrity.id] ? prev : { ...prev, [celebrity.id]: [{ from: 'character', text: celebrity.greeting }] })
  }

  const currentMessages = selected ? (chats[selected.id] ?? []) : []

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chats, selected, sending])

  const send = async () => {
    if (!selected || !draft.trim() || sending) return
    const celebrity = selected
    const userText = draft.trim()
    const prior = chats[celebrity.id] ?? []
    const nextHistory = [...prior, { from: 'me' as const, text: userText }]
    setChats((prev) => ({ ...prev, [celebrity.id]: nextHistory }))
    setDraft('')
    setSending(true)
    setError('')
    const payload = {
      messages: prior
        .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }))
        .concat([{ role: 'user', content: userText }]),
    }
    try {
      const response = await fetch(`/api/celebrities/${celebrity.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({})) as { reply?: string; message?: string }
      if (!response.ok || !data.reply) throw new Error(data.message || '对话失败，请稍后再试。')
      setChats((prev) => ({ ...prev, [celebrity.id]: [...(prev[celebrity.id] ?? nextHistory), { from: 'character', text: data.reply! }] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '连不上对话服务。')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="character-hall">
      <header className="character-hall__topbar">
        <button type="button" className="character-hall__back" onClick={onBack}>
          <img className="character-hall__brand-logo" src="/brand/balabala-mark-clean.jpg" alt="" aria-hidden="true" />
          <span className="character-hall__brand-text"><b>叽里呱啦</b><i>BALA BALA</i></span>
        </button>
        <nav className="character-hall__nav" aria-label="平台模块导航">
          <button type="button" className="is-active">角色档案</button>
          <button type="button" onClick={onBack}>场景</button>
          <button type="button" onClick={onPlaza}>广场</button>
        </nav>
        <button type="button" className="character-hall__court" onClick={() => onEnterCourt(selected ?? undefined)}>
          <Gavel size={15} aria-hidden="true" /> 进入趣味法庭 {selected ? `· ${selected.name}` : ''} <ChevronRight size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="character-hall__hero">
        <span className="character-hall__kicker">CHARACTER HALL · 人物馆</span>
        <h1>与改变世界的<em>人</em>，面对面聊聊</h1>
        <p>20 位古今中外名人齐聚于此。点开任意一位，像朋友一样向他提问、辩论、寻求建议；聊得投缘，还能带他一起走进趣味法庭。</p>
      </div>

      <div className="character-hall__toolbar">
        <label className="character-hall__search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索人物、领域或关键词，如「李白」「投资」" aria-label="搜索人物" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}
        </label>
        <div className="character-hall__filters">
          {(['全部', ...CELEBRITY_FIELDS] as const).map((field) => (
            <button key={field} type="button" className={activeField === field ? 'is-active' : ''} onClick={() => setActiveField(field)}>{field}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="character-hall__empty">没有找到「{query}」相关人物，换个关键词试试。</div>
      ) : (
        <div className="character-hall__grid">
          {filtered.map((c) => (
            <button type="button" className="character-card" key={c.id} onClick={() => openChat(c)}>
              <div className="character-card__portrait">
                <Portrait celebrity={c} className="character-card__img" />
                <span className="character-card__field">{c.field}</span>
                <span className="character-card__badge3d" title="可旋转查看 3D 全身模型">3D</span>
              </div>
              <div className="character-card__copy">
                <b>{c.name}</b>
                <span>{c.title}</span>
                <p>{c.intro}</p>
                <footer>
                  {c.tags.slice(0, 2).map((tag) => <i key={tag}>{tag}</i>)}
                  <strong>对话 ↗</strong>
                </footer>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="character-dialog-backdrop" onClick={() => setSelected(null)}>
          <section className="character-dialog" role="dialog" aria-modal="true" aria-labelledby="character-dialog-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="character-dialog__close" onClick={() => setSelected(null)} aria-label="关闭人物详情"><X size={20} /></button>

            <div className="character-dialog__main">
              {/* 左侧：3D 全身模型展示 */}
              <div className="character-dialog__viewer">
                <CharacterModelViewer key={selected.id} celebrity={selected} />
              </div>

              {/* 右侧：信息 + 聊天 */}
              <div className="character-dialog__side">
                <div className="character-dialog__profile">
                  <Portrait celebrity={selected} className="character-dialog__portrait" />
                  <div>
                    <span className="character-dialog__meta">{selected.field} · {selected.era}</span>
                    <h2 id="character-dialog-title">{selected.name}</h2>
                    <b>{selected.title}</b>
                    <p>{selected.intro}</p>
                    <div className="character-dialog__tags">{selected.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>
                  </div>
                </div>

                <div className="character-dialog__chat" aria-live="polite">
                  {currentMessages.map((m, i) => (
                    <div className={`character-chat ${m.from}`} key={`${m.from}-${i}`}>
                      <span>{m.from === 'me' ? '你' : selected.name}</span>
                      <p>{m.text}</p>
                      {m.from === 'character' && <TtsPlayButton text={m.text} label="朗读" className="character-chat__tts" />}
                    </div>
                  ))}
                  {sending && (
                    <div className="character-chat character">
                      <span>{selected.name}</span>
                      <p className="character-typing"><Loader2 size={13} className="spin" /> 正在思考…</p>
                    </div>
                  )}
                  {error && <p className="character-chat-error">{error}</p>}
                  <div ref={chatEndRef} />
                </div>

                <div className="character-dialog__composer">
                  <input
                    aria-label="发送消息"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
                    placeholder={`和${selected.name}说点什么…`}
                  />
                  <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()}>
                    {sending ? <Loader2 size={15} className="spin" /> : <MessageCircle size={15} aria-hidden="true" />} 发送
                  </button>
                </div>
              </div>
            </div>

            <button type="button" className="character-dialog__court" onClick={() => onEnterCourt(selected)}>
              <Gavel size={15} aria-hidden="true" /> 带 {selected.name} 进入趣味法庭 <ChevronRight size={15} aria-hidden="true" />
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
