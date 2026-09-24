import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { SafeCanvas } from './SafeCanvas'
import { OrbitControls, ContactShadows, useGLTF } from '@react-three/drei'
import { Box3, Group, Vector3 } from 'three'
import { ChevronDown, ChevronRight, Dumbbell, Gavel, Loader2, MessageCircle, Mic, Pencil, Phone, PhoneOff, Plus, RotateCw, Save, Search, Sparkles, Trash2, Type, Upload, Users, Wine, X, BookOpen } from 'lucide-react'
import { CELEBRITIES, CELEBRITY_FIELDS, resolveCharacterVoice, type CelebrityField } from '@balabala/shared'
import { TtsPlayButton } from './TtsPlayButton'
import { useSceneCleanup } from './useSceneCleanup'
import { useIdentity } from './identity'
import { playTts, stopTts } from './tts'
import { useVoiceEnabled } from './voice-settings'
import { useSpeechRecognition } from './use-speech-recognition'
import { buildGallerySequence, type GalleryEntry } from './character-gallery'
import {
  assetUrl, celebrityListToUi, celebrityToUi, customToUi,
  fetchMyCharacters, fetchPublicCharacters,
  type CustomCharacterApi, type UiCharacter,
} from './custom-characters'
import './character-hall.css'

// 3D 长廊独立懒加载：three/r3f 已在 manualChunks，长廊代码本身再分一个 chunk。
const CharacterGallery3D = lazy(() => import('./CharacterGallery3D'))

const GALLERY_MODE_KEY = 'balabala.gallery-3d'
const GALLERY_INDEX_KEY = 'balabala.gallery-index'

function readStored3d(): boolean {
  try { return window.localStorage.getItem(GALLERY_MODE_KEY) !== '0' } catch { return true }
}
function readStoredIndex(): number {
  try { const v = Number(window.localStorage.getItem(GALLERY_INDEX_KEY)); return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0 } catch { return 0 }
}

type ChatTurn = { from: 'me' | 'character'; text: string }
type HallTab = 'all' | 'mine' | 'plaza'
type InputMode = 'text' | 'voice' | 'phone'

/** Skill 人格（契约由后端提供：GET /api/characters/:id/skill） */
type CharacterSkill = {
  id: string
  name: string
  description: string
  version?: string
  persona?: string
  knowledge?: string
  behavior?: string
  raw?: string
}

/** 可带入的场景 Shell 清单（id 与 App.tsx 的 view 路由一致） */
const SCENE_LIST = [
  { id: 'court', label: '趣味法庭', Icon: Gavel },
  { id: 'gym', label: '健身房', Icon: Dumbbell },
  { id: 'bar', label: '酒吧', Icon: Wine },
  { id: 'talkshow', label: '脱口秀', Icon: Mic },
  { id: 'werewolf', label: '狼人杀', Icon: Users },
  { id: 'library', label: '图书馆', Icon: BookOpen },
  { id: 'plaza', label: '广场', Icon: Users },
] as const

type CharacterHallProps = {
  onBack: () => void
  onEnterCourt: (character?: UiCharacter) => void
  onPlaza?: () => void
  /** 点击「创建我的人物」占位入口 → 跳分身工坊。 */
  onCreateCharacter?: () => void
  /** 带入场景入口；不传则按钮显示「即将开放」。 */
  onEnterScene?: (sceneId: string, character: UiCharacter) => void
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

/** 通话计时 MM:SS */
function formatCallTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

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
    <SafeCanvas camera={{ position: [0, 1.35, 3.4], fov: 38 }} dpr={[1, 1.5]} shadows>
      <color attach="background" args={['#0A0A0A']} />
      <ambientLight intensity={0.75} color="#fff4d6" />
      <directionalLight position={[3, 6, 4]} intensity={1.5} color="#ffffff" castShadow />
      <pointLight position={[-2.5, 2, 2.5]} intensity={12} distance={9} color="#4fb3a5" />
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
    </SafeCanvas>
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

export default function CharacterHall({ onEnterCourt, onCreateCharacter, onEnterScene }: CharacterHallProps) {
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

  // ===== 多模态输入：文字 / 语音 / 电话 =====
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [callActive, setCallActive] = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)
  const [interimText, setInterimText] = useState('')

  // ===== Skill 人格展示与编辑 =====
  const [skillData, setSkillData] = useState<CharacterSkill | null>(null)
  const [skillLoading, setSkillLoading] = useState(false)
  const [skillOpen, setSkillOpen] = useState(false)
  const [skillEditing, setSkillEditing] = useState(false)
  const [skillMarkdown, setSkillMarkdown] = useState('')
  const [skillSaving, setSkillSaving] = useState(false)

  // ===== 人物视频（/videos/<id>.mp4 不存在时静默隐藏） =====
  const [videoMissing, setVideoMissing] = useState(false)

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

  // ===== M13 第五轮：3D 人物长廊 =====
  const [galleryMode3d, setGalleryMode3d] = useState<boolean>(readStored3d)
  const [activeIndex, setActiveIndex] = useState<number>(readStoredIndex)
  const [voiceEnabled] = useVoiceEnabled()
  const greetedOnceRef = useRef(false)

  // ASR 实例：语音模式与电话模式共用。
  // - 语音模式：final 文本填入输入框，用户编辑后点发送
  // - 电话模式：按住说话，松手 final 后直接发送（半双工）
  const {
    supported: speechSupported,
    listening: asrListening,
    start: startAsr,
    stop: stopAsr,
  } = useSpeechRecognition({
    onFinal: (text) => {
      setInterimText('')
      if (!text.trim()) return
      if (callActive) {
        void send(text)
      } else {
        setDraft((prev) => (prev ? `${prev}${text}` : text))
      }
    },
    onInterim: (t) => setInterimText(t),
  })

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

  // 拉取自定义人物：我的人物始终拉（all tab 的 C 位要用最近创建的角色）；广场仅切到 plaza 时拉。
  useEffect(() => {
    fetchMyCharacters(user?.userId ?? '').then(setMine)
  }, [user?.userId])
  useEffect(() => {
    if (tab !== 'plaza') return
    setLoadingCustom(true)
    fetchPublicCharacters().then((list) => { setPublicList(list); setLoadingCustom(false) })
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

  // 关闭弹窗时清理：停止 TTS / ASR、退出电话模式
  const closeDialog = () => {
    stopTts()
    stopAsr()
    setCallActive(false)
    setInputMode('text')
    setInterimText('')
    setSelected(null)
  }

  // ===== 电话模式 =====
  const enterPhoneMode = () => {
    if (!speechSupported) { showNotice('当前浏览器不支持语音输入'); return }
    setInputMode('phone')
    setCallActive(true)
  }
  const exitPhoneMode = () => {
    stopAsr()
    setInterimText('')
    setCallActive(false)
    setInputMode('text')
  }

  // 通话计时器（MM:SS）
  useEffect(() => {
    if (!callActive) return
    setCallSeconds(0)
    const id = window.setInterval(() => setCallSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [callActive])

  // ===== 带入场景 =====
  const enterScene = (sceneId: string) => {
    if (!selected) return
    if (onEnterScene) onEnterScene(sceneId, selected)
    else showNotice('即将开放')
  }

  // ===== Skill 人格加载 / 保存 =====
  useEffect(() => {
    if (!selected) {
      setSkillData(null); setSkillLoading(false); setSkillEditing(false); setSkillOpen(false)
      return
    }
    // UiCharacter 后续会带 skill 字段（另一代理实现），有缓存直接用
    const cached = (selected as { skill?: CharacterSkill }).skill
    if (cached) { setSkillData(cached); setSkillLoading(false); return }
    let cancelled = false
    setSkillLoading(true)
    fetch(`/api/characters/${selected.id}/skill`)
      .then((r) => (r.ok ? (r.json() as Promise<CharacterSkill>) : null))
      .then((d) => { if (!cancelled && d) setSkillData(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSkillLoading(false) })
    return () => { cancelled = true }
  }, [selected])

  const saveSkill = async () => {
    if (!selected || !isOwner || skillSaving) return
    setSkillSaving(true)
    try {
      const r = await fetch(`/api/custom-characters/${selected.id}/skill`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user?.userId ?? '', skillMarkdown: skillMarkdown }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { message?: string }
        throw new Error(d.message || '保存 Skill 失败')
      }
      setSkillData((prev) => (prev ? { ...prev, raw: skillMarkdown } : prev))
      setSkillEditing(false)
      showNotice('Skill 已保存')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '保存 Skill 失败')
    } finally {
      setSkillSaving(false)
    }
  }

  // 切换人物时重置视频错误标记，让新人物重新尝试加载视频
  useEffect(() => { setVideoMissing(false) }, [selected?.id])

  // 弹窗被异常关闭（删除等路径直接置空 selected）时释放麦克风 / TTS
  useEffect(() => {
    if (selected) return
    stopAsr()
    stopTts()
    setCallActive(false)
    setInputMode('text')
    setInterimText('')
  }, [selected, stopAsr])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chats, selected, sending])

  const send = async (overrideText?: string) => {
    if (!selected || sending) return
    const character = selected
    const userText = (overrideText ?? draft).trim()
    if (!userText) return
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
      // 语音 / 电话模式：收到回复自动朗读（playTts 是单例，新回复自动打断旧播放）
      if (voiceEnabled && inputMode !== 'text') {
        void playTts(data.reply, resolveCharacterVoice(character.id, character.voice)).catch(() => {})
      }
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

  // 长廊条目：按 tab 组织，自定义角色/创建入口默认 C 位居中。
  const { entries, centerIndex } = useMemo(
    () => buildGallerySequence({ tab, celebs: filteredCelebs, mine: filteredMine, plaza: filteredPublic }),
    [tab, filteredCelebs, filteredMine, filteredPublic],
  )

  // 切 tab / 列表变化时回到默认 C 位（最近自定义角色或创建入口）。
  useEffect(() => {
    setActiveIndex(centerIndex)
  }, [centerIndex, tab])

  // 列表变短（搜索过滤）时收敛当前索引。
  useEffect(() => {
    if (activeIndex > entries.length - 1) setActiveIndex(Math.max(0, entries.length - 1))
  }, [entries.length, activeIndex])

  // 记住模式与位置。
  useEffect(() => {
    try { window.localStorage.setItem(GALLERY_MODE_KEY, galleryMode3d ? '1' : '0') } catch { /* noop */ }
  }, [galleryMode3d])
  useEffect(() => {
    try { window.localStorage.setItem(GALLERY_INDEX_KEY, String(activeIndex)) } catch { /* noop */ }
  }, [activeIndex])

  // 走近（居中切换）才发声：仅在 3D 模式、开关开、索引真的变化时朗读该角色问候语。
  useEffect(() => {
    if (!galleryMode3d) return
    if (!greetedOnceRef.current) { greetedOnceRef.current = true; return }
    if (!voiceEnabled) return
    const entry = entries[activeIndex]
    if (!entry || entry.isCreateEntry) return
    void playTts(entry.greeting, resolveCharacterVoice(entry.character.id, entry.character.voice)).catch(() => { /* 朗读失败静默 */ })
  }, [activeIndex, galleryMode3d, voiceEnabled, entries])

  // 从 3D 长廊进入对话（复用现有 openChat 对话框）。
  const enterGalleryEntry = (entry: GalleryEntry) => openChat(entry.character)

  return (
    <div className={galleryMode3d ? 'character-hall character-hall--immersive' : 'character-hall'}>
      {/* M13 第六轮：删除自带 .character-hall__topbar（与全局 TopNav 重复）。
          品牌/导航交 TopNav；"进入趣味法庭" CTA 移入下方 hero 内容区。 */}

      <div className="character-hall__hero">
        <span className="character-hall__kicker">CHARACTER HALL · 人物馆</span>
        <h1>与改变世界的<em>人</em>，面对面聊聊</h1>
        <p>古今中外名人齐聚于此。点开任意一位，像朋友一样向他提问、辩论、寻求建议；聊得投缘，还能带他一起走进趣味法庭。</p>
        <button type="button" className="character-hall__court" onClick={() => onEnterCourt(selected ?? undefined)}>
          <Gavel size={15} aria-hidden="true" /> 进入趣味法庭 {selected ? `· ${selected.name}` : ''} <ChevronRight size={14} aria-hidden="true" />
        </button>
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
        <button
          type="button"
          className="character-hall__viewtoggle"
          onClick={() => setGalleryMode3d((v) => !v)}
          aria-pressed={galleryMode3d}
          title={galleryMode3d ? '切回 2D 卡片网格' : '切到 3D 人物长廊'}
        >
          {galleryMode3d ? '平面视图' : '3D 长廊'}
        </button>
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
      ) : galleryMode3d ? (
        <div className="character-hall__stage">
          <Suspense fallback={<div className="character-hall__empty"><Loader2 size={18} className="spin" /> 正在加载 3D 长廊…</div>}>
            <CharacterGallery3D
              entries={entries}
              activeIndex={Math.min(activeIndex, entries.length - 1)}
              onIndexChange={setActiveIndex}
              onEnter={enterGalleryEntry}
              onModelError={() => setGalleryMode3d(false)}
              onCreate={onCreateCharacter}
            />
          </Suspense>
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
        <div className="character-dialog-backdrop" onClick={closeDialog}>
          <section className="character-dialog" role="dialog" aria-modal="true" aria-labelledby="character-dialog-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="character-dialog__close" onClick={closeDialog} aria-label="关闭人物详情"><X size={20} /></button>

            <div className="character-dialog__main">
              {/* 左栏（35%）：3D 全身模型 + 人物视频 */}
              <div className="character-dialog__viewer">
                <CharacterModelViewer key={selected.id} character={selected} />
                {!videoMissing && (
                  <div className="character-dialog__video-wrap">
                    <video
                      className="character-dialog__video"
                      src={`/videos/${selected.id}.mp4`}
                      poster={selected.portrait || undefined}
                      playsInline controls
                      ref={(el) => { if (el && !el.dataset.mutedSet) { el.muted = true; el.dataset.mutedSet = '1' } }}
                      autoPlay
                      loop
                      onError={() => setVideoMissing(true)}
                    />
                  </div>
                )}
              </div>

              {/* 中栏（40%）：profile + 场景代入 + Skill 人格 */}
              <div className="character-dialog__center">
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

                {/* 带入场景 */}
                <div className="character-dialog__scenes">
                  <h3>带入场景</h3>
                  <div className="character-dialog__scene-grid">
                    {SCENE_LIST.map(({ id, label, Icon }) => (
                      <button key={id} type="button" onClick={() => enterScene(id)}>
                        <Icon size={15} aria-hidden="true" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Skill 人格（折叠区） */}
                <div className="character-dialog__skill">
                  <button type="button" className="character-dialog__skill-head" onClick={() => setSkillOpen((v) => !v)} aria-expanded={skillOpen}>
                    <Sparkles size={14} aria-hidden="true" />
                    <span>Skill 人格</span>
                    {!selected.isCustom && <em>默认 Skill</em>}
                    <ChevronDown size={14} className={`character-dialog__skill-caret ${skillOpen ? 'is-open' : ''}`} aria-hidden="true" />
                  </button>
                  {skillOpen && (
                    <div className="character-dialog__skill-body">
                      {skillLoading && <p className="character-dialog__skill-hint"><Loader2 size={12} className="spin" /> 加载 Skill…</p>}
                      {!skillLoading && !skillData && <p className="character-dialog__skill-hint">暂无 Skill 描述</p>}
                      {skillData && (
                        <>
                          <b className="character-dialog__skill-name">{skillData.name || '未命名 Skill'}</b>
                          {skillData.description && <p className="character-dialog__skill-desc">{skillData.description}</p>}
                          {skillData.persona && (
                            <div className="skill-section"><h4>Persona</h4><p>{skillData.persona}</p></div>
                          )}
                          {skillData.knowledge && (
                            <div className="skill-section"><h4>Knowledge</h4><p>{skillData.knowledge}</p></div>
                          )}
                          {skillData.behavior && (
                            <div className="skill-section"><h4>Behavior</h4><p>{skillData.behavior}</p></div>
                          )}
                          {isOwner && !skillEditing && (
                            <button
                              type="button"
                              className="character-dialog__skill-editbtn"
                              onClick={() => { setSkillMarkdown(skillData.raw ?? ''); setSkillEditing(true) }}
                            >
                              <Pencil size={12} /> 编辑 Skill
                            </button>
                          )}
                          {isOwner && skillEditing && (
                            <div className="character-dialog__skill-edit">
                              <textarea
                                rows={6}
                                value={skillMarkdown}
                                onChange={(e) => setSkillMarkdown(e.target.value)}
                                placeholder="粘贴 Skill Markdown…"
                              />
                              <div className="character-dialog__skill-actions">
                                <button type="button" onClick={() => void saveSkill()} disabled={skillSaving}>
                                  {skillSaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />} 保存
                                </button>
                                <button type="button" onClick={() => setSkillEditing(false)}>取消</button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 右栏（25%）：聊天区 + 三种输入模式（电话模式接管整栏） */}
              <div className="character-dialog__chatcol">
                {callActive ? (
                  <div className="character-call">
                    <Portrait character={selected} className="character-call__avatar" />
                    <b className="character-call__name">{selected.name}</b>
                    <span className="character-call__status">通话中… {formatCallTime(callSeconds)}</span>
                    <div className="character-call__wave" aria-hidden="true">
                      {Array.from({ length: 22 }).map((_, i) => (
                        <i key={i} style={{ animationDelay: `${(i % 11) * 90}ms`, animationDuration: `${0.7 + (i % 5) * 0.12}s` }} />
                      ))}
                    </div>
                    {asrListening && interimText && <p className="character-call__interim">{interimText}</p>}
                    {sending && <p className="character-call__interim">{selected.name} 正在思考…</p>}
                    <div className="character-call__controls">
                      <button
                        type="button"
                        className={`character-call__mic ${asrListening ? 'is-listening' : ''}`}
                        onPointerDown={(e) => { e.preventDefault(); startAsr() }}
                        onPointerUp={() => stopAsr()}
                        onPointerLeave={() => { if (asrListening) stopAsr() }}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-label="按住说话"
                      >
                        <Mic size={24} aria-hidden="true" />
                      </button>
                      <button type="button" className="character-call__hangup" onClick={exitPhoneMode} aria-label="挂断">
                        <PhoneOff size={20} aria-hidden="true" />
                      </button>
                    </div>
                    <p className="character-call__hint">按住麦克风说话，松开发送</p>
                  </div>
                ) : (
                  <>
                    <div className="character-dialog__chat" aria-live="polite">
                      {currentMessages.map((m, i) => (
                        <div className={`character-chat ${m.from}`} key={`${m.from}-${i}`}>
                          <span>{m.from === 'me' ? '你' : selected.name}</span>
                          <p>{m.text}</p>
                          {m.from === 'character' && <TtsPlayButton text={m.text} voice={resolveCharacterVoice(selected.id, selected.voice)} label="朗读" className="character-chat__tts" />}
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

                    {/* 输入模式切换 */}
                    <div className="character-dialog__modes" role="tablist" aria-label="输入模式">
                      <button
                        type="button" role="tab" aria-selected={inputMode === 'text'}
                        className={inputMode === 'text' ? 'is-active' : ''}
                        onClick={() => setInputMode('text')}
                      >
                        <Type size={13} aria-hidden="true" /> 文字
                      </button>
                      <button
                        type="button" role="tab" aria-selected={inputMode === 'voice'}
                        className={inputMode === 'voice' ? 'is-active' : ''}
                        onClick={() => setInputMode('voice')}
                      >
                        <Mic size={13} aria-hidden="true" /> 语音
                      </button>
                      <button
                        type="button" role="tab" aria-selected={inputMode === 'phone'}
                        className={inputMode === 'phone' ? 'is-active' : ''}
                        onClick={enterPhoneMode}
                      >
                        <Phone size={13} aria-hidden="true" /> 电话
                      </button>
                    </div>

                    {inputMode === 'voice' && (
                      speechSupported ? (
                        <div className="character-dialog__voice">
                          <button
                            type="button"
                            className={`voice-mic ${asrListening ? 'is-listening' : ''}`}
                            onClick={() => (asrListening ? stopAsr() : startAsr())}
                            aria-pressed={asrListening}
                            title={asrListening ? '停止录音' : '开始语音输入'}
                          >
                            <Mic size={22} aria-hidden="true" />
                          </button>
                          <p className="character-dialog__voice-hint">
                            {asrListening ? (interimText || '正在聆听…') : '点击麦克风说话，识别文字会填入输入框'}
                          </p>
                        </div>
                      ) : (
                        <p className="character-dialog__asr-error">当前浏览器不支持语音输入</p>
                      )
                    )}

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
                  </>
                )}
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
