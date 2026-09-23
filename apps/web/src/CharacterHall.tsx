import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows, useGLTF } from '@react-three/drei'
import { Box3, Group, Vector3 } from 'three'
import { ChevronRight, Gavel, Loader2, MessageCircle, Pencil, Plus, RotateCw, Search, Trash2, Upload, X } from 'lucide-react'
import { CELEBRITIES, CELEBRITY_FIELDS, type CelebrityField } from '@balabala/shared'
import { TtsPlayButton } from './TtsPlayButton'
import { useSceneCleanup } from './useSceneCleanup'
import { useIdentity } from './identity'
import {
  assetUrl, celebrityListToUi, celebrityToUi, customToUi,
  fetchMyCharacters, fetchPublicCharacters,
  type CustomCharacterApi, type UiCharacter,
} from './custom-characters'
import './character-hall.css'

type ChatTurn = { from: 'me' | 'character'; text: string }
type HallTab = 'all' | 'mine' | 'plaza'

type CharacterHallProps = {
  onBack: () => void
  onEnterCourt: (character?: UiCharacter) => void
  onPlaza?: () => void
}

const FIELD_GRADIENTS: Record<string, string> = {
  科技: 'linear-gradient(145deg,#3b4a8f,#161d44)',
  商业: 'linear-gradient(145deg,#8f6b3b,#432f14)',
  科学: 'linear-gradient(145deg,#2f7d6e,#0e342c)',
  文学: 'linear-gradient(145deg,#7d3b6e,#331229)',
  艺术: 'linear-gradient(145deg,#8f4b3b,#421c14)',
  哲学: 'linear-gradient(145deg,#5b3b8f,#201240)',
}
const CUSTOM_GRADIENT = 'linear-gradient(145deg,#4a3a6a,#1a1430)'

function Portrait({ character, className }: { character: UiCharacter; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [character.id, character.portrait])
  const bg = character.isCustom ? CUSTOM_GRADIENT : FIELD_GRADIENTS[character.field ?? '科技']
  if (failed || !character.portrait) {
    return (
      <div className={className} style={{ background: bg }} aria-hidden="true">
        <span className="portrait-initial">{character.name[0]}</span>
      </div>
    )
  }
  return (
    <img
      className={className}
      src={character.portrait}
      alt={character.name}
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
    console.warn('Character 3D model failed to load', error, info.componentStack)
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
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () => (url ? [url] : []))
  if (!url) return null
  return (
    <Canvas camera={{ position: [0, 1.35, 3.4], fov: 38 }} dpr={[1, 1.5]} shadows>
      <color attach="background" args={['#0b0b0b']} />
      <ambientLight intensity={0.75} color="#fff4d6" />
      <directionalLight position={[3, 6, 4]} intensity={1.5} color="#ffffff" castShadow />
      <pointLight position={[-2.5, 2, 2.5]} intensity={12} distance={9} color="#FFD600" />
      <pointLight position={[2.5, 1.2, 1.5]} intensity={6} distance={8} color="#ffb347" />
      <Suspense fallback={null}>
        <group ref={sceneRef}>
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

function CharacterModelViewer({ character }: { character: UiCharacter }) {
  const [loaded, setLoaded] = useState(false)
  const [spinning, setSpinning] = useState(false)
  useEffect(() => { setLoaded(false) }, [character.id])

  const hasModel = Boolean(character.model)
  return (
    <div className="character-viewer">
      {hasModel ? (
        <ModelViewerErrorBoundary
          fallback={<Portrait character={character} className="character-viewer__fallback" />}
        >
          <ModelCanvas url={character.model ?? ''} onReady={() => setLoaded(true)} autoRotate={spinning} />
        </ModelViewerErrorBoundary>
      ) : (
        <Portrait character={character} className="character-viewer__fallback" />
      )}
      {hasModel && !loaded && (
        <div className="character-viewer__loading">
          <Loader2 size={18} className="spin" />
          <span>加载 3D 模型…</span>
        </div>
      )}
      {hasModel && (
        <button
          type="button"
          className={`character-viewer__spin` + (spinning ? ' is-on' : '')}
          onClick={() => setSpinning((v) => !v)}
          aria-pressed={spinning}
          title={spinning ? '停止自动旋转' : '开启自动旋转'}
        >
          <RotateCw size={13} aria-hidden="true" /> {spinning ? '停止旋转' : '自动旋转'}
        </button>
      )}
      <span className="character-viewer__hint">拖动可旋转查看</span>
    </div>
  )
}

/** 编辑自定义人物的表单草稿 */
type EditDraft = {
  name: string; title: string; intro: string
  tags: string; persona: string; greeting: string
}

export default function CharacterHall({ onBack, onEnterCourt, onPlaza }: CharacterHallProps) {
  const { user } = useIdentity()
  const [tab, setTab] = useState<HallTab>('all')
  const [activeField, setActiveField] = useState<CelebrityField | '全部'>('全部')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<UiCharacter | null>(null)
  const [chats, setChats] = useState<Record<string, ChatTurn[]>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // 自定义人物列表
  const [mine, setMine] = useState<UiCharacter[]>([])
  const [publicList, setPublicList] = useState<UiCharacter[]>([])
  const [loadingCustom, setLoadingCustom] = useState(false)

  // 编辑态
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<EditDraft>({ name: '', title: '', intro: '', tags: '', persona: '', greeting: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')

  const showNotice = (msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2400)
  }

  // 预置名人（按领域+搜索过滤）
  const filteredCelebs = CELEBRITIES.filter((c) => {
    const inField = activeField === '全部' || c.field === activeField
    const q = query.trim()
    const inQuery = !q || c.name.includes(q) || c.title.includes(q) || c.intro.includes(q) || c.tags.some((t) => t.includes(q))
    return inField && inQuery
  }).map(celebrityToUi)

  // 自定义列表按搜索过滤
  const q = query.trim()
  const inList = (list: UiCharacter[]) => list.filter((c) =>
    !q || c.name.includes(q) || c.title.includes(q) || c.intro.includes(q) || c.tags.some((t) => t.includes(q)),
  )
  const filteredMine = inList(mine)
  const filteredPublic = inList(publicList)

  // 拉取自定义人物（切到对应 tab 时）
  useEffect(() => {
    if (tab === 'all') return
    setLoadingCustom(true)
    const userId = user?.userId ?? ''
    if (tab === 'mine') {
      fetchMyCharacters(userId).then((list) => { setMine(list); setLoadingCustom(false) })
    } else {
      fetchPublicCharacters().then((list) => { setPublicList(list); setLoadingCustom(false) })
    }
  }, [tab, user?.userId])

  const openChat = (character: UiCharacter) => {
    setSelected(character)
    setError('')
    setEditing(false)
    setConfirmDelete(false)
    setChats((prev) => prev[character.id] ? prev : { ...prev, [character.id]: [{ from: 'character', text: character.greeting }] })
  }

  const currentMessages = selected ? (chats[selected.id] ?? []) : []
  const isOwner = selected?.isCustom && Boolean(user?.userId) && selected.userId === user?.userId

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chats, selected, sending])

  const send = async () => {
    if (!selected || !draft.trim() || sending) return
    const character = selected
    const userText = draft.trim()
    const prior = chats[character.id] ?? []
    const nextHistory = [...prior, { from: 'me' as const, text: userText }]
    setChats((prev) => ({ ...prev, [character.id]: nextHistory }))
    setDraft('')
    setSending(true)
    setError('')
    const payload = {
      messages: prior
        .map((m) => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }))
        .concat([{ role: 'user', content: userText }]),
      ...(character.isCustom ? { userId: user?.userId ?? '' } : {}),
    }
    try {
      const url = character.isCustom
        ? `/api/custom-characters/${character.id}/chat`
        : `/api/celebrities/${character.id}/chat`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({})) as { reply?: string; name?: string; message?: string }
      if (!response.ok || !data.reply) throw new Error(data.message || '对话失败，请稍后再试。')
      setChats((prev) => ({ ...prev, [character.id]: [...(prev[character.id] ?? nextHistory), { from: 'character', text: data.reply! }] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '连不上对话服务。')
    } finally {
      setSending(false)
    }
  }

  // ===== 自定义人物：编辑 / 发布 / 删除 =====
  const startEdit = async () => {
    if (!selected || !isOwner) return
    // 拉完整详情（含 persona）
    try {
      const r = await fetch(`/api/custom-characters/${selected.id}?userId=${encodeURIComponent(user?.userId ?? '')}`)
      const detail = await r.json() as CustomCharacterApi & { persona?: string }
      setEditDraft({
        name: detail.name ?? selected.name,
        title: detail.title ?? selected.title,
        intro: detail.intro ?? selected.intro,
        tags: (detail.tags ?? selected.tags).join(', '),
        persona: detail.persona ?? '',
        greeting: detail.greeting ?? selected.greeting,
      })
    } catch {
      setEditDraft({
        name: selected.name, title: selected.title, intro: selected.intro,
        tags: selected.tags.join(', '), persona: '', greeting: selected.greeting,
      })
    }
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!selected || !isOwner || saving) return
    setSaving(true)
    try {
      const body = {
        userId: user?.userId ?? '',
        name: editDraft.name.trim() || selected.name,
        title: editDraft.title.trim() || selected.title,
        intro: editDraft.intro.trim() || selected.intro,
        tags: editDraft.tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean),
        persona: editDraft.persona,
        greeting: editDraft.greeting.trim() || selected.greeting,
      }
      const r = await fetch(`/api/custom-characters/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message || '保存失败')
      }
      const updated = (await r.json()) as CustomCharacterApi
      const ui = customToUi(updated)
      setSelected(ui)
      // 刷新列表
      if (tab === 'mine') {
        fetchMyCharacters(user?.userId ?? '').then(setMine)
      } else {
        fetchPublicCharacters().then(setPublicList)
      }
      setEditing(false)
      showNotice('已保存')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const publishToPlaza = async () => {
    if (!selected || !isOwner) return
    try {
      const r = await fetch(`/api/custom-characters/${selected.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.userId ?? '', topics: [], title: selected.title }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message || '发布失败')
      }
      setSelected({ ...selected, visibility: 'public' })
      if (tab === 'mine') fetchMyCharacters(user?.userId ?? '').then(setMine)
      showNotice('已发布到广场')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '发布失败')
    }
  }

  const removeCharacter = async () => {
    if (!selected || !isOwner) return
    try {
      const r = await fetch(`/api/custom-characters/${selected.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.userId ?? '' }),
      })
      if (!r.ok) throw new Error('删除失败')
      setSelected(null)
      setConfirmDelete(false)
      fetchMyCharacters(user?.userId ?? '').then(setMine)
      showNotice('已删除')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '删除失败')
    }
  }

  // 顶部 tab 切换后的展示列表
  const visibleList: UiCharacter[] =
    tab === 'all' ? filteredCelebs
    : tab === 'mine' ? filteredMine
    : filteredPublic

  const showEmpty = visibleList.length === 0 && !loadingCustom

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
        <p>古今中外名人齐聚于此。点开任意一位，像朋友一样向他提问、辩论、寻求建议；聊得投缘，还能带他一起走进趣味法庭。</p>
      </div>

      <div className="character-hall__toolbar">
        <label className="character-hall__search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索人物、领域或关键词，如「李白」「投资」" aria-label="搜索人物" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}
        </label>
        {tab === 'all' && (
          <div className="character-hall__filters">
            {(['全部', ...CELEBRITY_FIELDS] as const).map((field) => (
              <button key={field} type="button" className={activeField === field ? 'is-active' : ''} onClick={() => setActiveField(field)}>{field}</button>
            ))}
          </div>
        )}
      </div>

      {/* 三栏切换 */}
      <div className="character-hall__tabs" role="tablist">
        {([
          { id: 'all', label: '全部名人' },
          { id: 'mine', label: '我的人物' },
          { id: 'plaza', label: '广场人物' },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'is-active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadingCustom ? (
        <div className="character-hall__empty"><Loader2 size={18} className="spin" /> 加载中…</div>
      ) : showEmpty ? (
        <div className="character-hall__empty">
          {tab === 'mine' && !q
            ? '你还没有自定义人物。去分身工坊创建一位吧。'
            : tab === 'plaza' && !q
              ? '广场还没有公开人物，把你的人物发布上来试试。'
              : `没有找到「${query}」相关人物，换个关键词试试。`}
        </div>
      ) : (
        <div className="character-hall__grid">
          {visibleList.map((c) => (
            <button type="button" className="character-card" key={c.id} onClick={() => openChat(c)}>
              <div className="character-card__portrait">
                <Portrait character={c} className="character-card__img" />
                <span className="character-card__field">
                  {c.isCustom ? (c.visibility === 'public' ? '已发布' : '私有') : c.field}
                </span>
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
                <CharacterModelViewer key={selected.id} character={selected} />
              </div>

              {/* 右侧：信息 + 聊天 */}
              <div className="character-dialog__side">
                <div className="character-dialog__profile">
                  <Portrait character={selected} className="character-dialog__portrait" />
                  <div>
                    <span className="character-dialog__meta">
                      {selected.isCustom
                        ? (selected.visibility === 'public' ? '已发布 · 自定义人物' : '私有 · 自定义人物')
                        : `${selected.field} · ${selected.era}`}
                    </span>
                    <h2 id="character-dialog-title">{selected.name}</h2>
                    <b>{selected.title}</b>
                    <p>{selected.intro}</p>
                    <div className="character-dialog__tags">{selected.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>
                  </div>
                </div>

                {/* owner 操作按钮 */}
                {isOwner && !editing && (
                  <div className="character-dialog__actions">
                    <button type="button" onClick={() => void startEdit()}><Pencil size={13} /> 编辑</button>
                    {selected.visibility !== 'public' && (
                      <button type="button" onClick={() => void publishToPlaza()}><Upload size={13} /> 发布到广场</button>
                    )}
                    <button type="button" className="is-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={13} /> 删除</button>
                  </div>
                )}

                {/* 删除确认 */}
                {isOwner && confirmDelete && (
                  <div className="character-dialog__confirm">
                    <span>删除后不可恢复，确定删除「{selected.name}」？</span>
                    <button type="button" onClick={() => void removeCharacter()}>确认删除</button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
                  </div>
                )}

                {/* 编辑表单 */}
                {isOwner && editing && (
                  <div className="character-dialog__edit">
                    <label>名字<input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} /></label>
                    <label>头衔<input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} /></label>
                    <label>简介<textarea rows={2} value={editDraft.intro} onChange={(e) => setEditDraft({ ...editDraft, intro: e.target.value })} /></label>
                    <label>标签（逗号分隔）<input value={editDraft.tags} onChange={(e) => setEditDraft({ ...editDraft, tags: e.target.value })} /></label>
                    <label>开场白<textarea rows={2} value={editDraft.greeting} onChange={(e) => setEditDraft({ ...editDraft, greeting: e.target.value })} /></label>
                    <label>人格设定（system prompt）<textarea rows={4} value={editDraft.persona} onChange={(e) => setEditDraft({ ...editDraft, persona: e.target.value })} /></label>
                    <div className="character-dialog__edit-actions">
                      <button type="button" onClick={() => void saveEdit()} disabled={saving}>
                        {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} 保存
                      </button>
                      <button type="button" onClick={() => setEditing(false)}>取消</button>
                    </div>
                  </div>
                )}

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

      {notice && <div className="character-hall__toast">{notice}</div>}
    </div>
  )
}
