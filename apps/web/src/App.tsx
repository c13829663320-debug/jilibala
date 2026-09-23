import { Component, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent, type ErrorInfo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Float, Text, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import { Gavel, Sparkles, Play, RotateCcw, Mic2, Scale, WandSparkles, Users, Clock3, ChevronRight, Check, Volume2, Upload, FileText, Bot, Eye } from 'lucide-react'
import RoomEntry from './RoomEntry'
import ArchivePage, { type ArchiveRecord } from './ArchivePage'
import AvatarStudio from './AvatarStudio'
import CharacterHall, { type Character } from './CharacterHall'
import SceneDetail from './SceneDetail'
import { Plaza } from './Plaza'

type Phase = {
  id: string
  label: string
  speaker: string
  quote: string
  tone: 'teal' | 'purple' | 'amber' | 'pink'
}

const phases: Phase[] = [
  { id: 'opening', label: '开庭陈述', speaker: '小法官 · Luna', quote: '“请双方保持友善，让事实自己发光。”', tone: 'teal' },
  { id: 'evidence', label: '证据交换', speaker: '原告 · 泡泡', quote: '“我带来了这段会唱歌的录音。”', tone: 'purple' },
  { id: 'debate', label: '自由辩论', speaker: '被告 · 阿布', quote: '“等等，我可以解释这个彩虹脚印！”', tone: 'amber' },
  { id: 'verdict', label: '趣味宣判', speaker: '小法官 · Luna', quote: '“本庭判定：给彼此一个拥抱，再一起修好它。”', tone: 'pink' },
]

type CourtroomProps = { character?: Character | null }

/**
 * Keep a bad/expired Tripo URL from taking down the whole R3F canvas. The
 * placeholder is rendered by the parent scene when the GLB is still loading
 * or fails to decode.
 */
class CourtroomModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Tripo courtroom model failed to load', error, info.componentStack)
  }

  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function NormalizedCourtroomModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    // Match the built-in court avatars (roughly 1.5 scene units tall), while
    // retaining the source model's proportions and centering it on the seat.
    const scale = 1.55 / maxSize
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

function CourtroomEnvironmentModel() {
  const { scene } = useGLTF('/models/balabala_courtroom.glb')
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const scale = 10.8 / maxSize
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

function FullCourtEnvironment() {
  return <>
    <color attach="background" args={['#120904']} />
    <fog attach="fog" args={['#120904', 12, 28]} />
    <ambientLight intensity={0.9} color="#ffe4bc" />
    <directionalLight position={[0, 8, -5]} intensity={2.8} color="#fff0d1" castShadow shadow-mapSize={[2048, 2048]} />
    <pointLight position={[-5, 4, -4]} intensity={16} distance={14} color="#ffae54" />
    <pointLight position={[5, 4, -4]} intensity={16} distance={14} color="#ffae54" />
    <Suspense fallback={null}><CourtroomEnvironmentModel /></Suspense>
    <OrbitControls enablePan={false} minDistance={8} maxDistance={18} minPolarAngle={0.65} maxPolarAngle={1.42} target={[0, 2.15, 1.6]} />
  </>
}

function CourtroomCharacter({ character }: { character: Character }) {
  if (!character.assetUrl) return null
  const fallback = <Avatar position={[0, 0.55, 0]} body={character.accent} head="#ffd1b3" accent="#f7e0a5" name={character.name} />
  return <group position={[-2.6, 1, -0.1]}>
    <CourtroomModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <NormalizedCourtroomModel url={character.assetUrl} />
        <Text position={[0, 1.82, 0]} fontSize={0.18} color="#f7efff" anchorX="center" anchorY="middle">{character.name}</Text>
      </Suspense>
    </CourtroomModelErrorBoundary>
  </group>
}

function Courtroom({ character }: CourtroomProps) {
  const jury = [
    [-3.7, 0.32, 2.15], [-2.45, 0.32, 2.15], [-1.2, 0.32, 2.15], [1.2, 0.32, 2.15], [2.45, 0.32, 2.15], [3.7, 0.32, 2.15],
    [-3.7, 0.32, 3.65], [-2.45, 0.32, 3.65], [-1.2, 0.32, 3.65], [1.2, 0.32, 3.65], [2.45, 0.32, 3.65], [3.7, 0.32, 3.65],
  ] as Array<[number, number, number]>
  return (
    <group>
      <color attach="background" args={['#21150f']} />
      <fog attach="fog" args={['#21150f', 8, 18]} />
      <ambientLight intensity={1.15} color="#ffe0b0" />
      <directionalLight position={[0, 8, 3]} intensity={4.2} color="#fff0cf" castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-4.5, 4.5, -1.5]} intensity={20} distance={11} color="#ffc16e" />
      <pointLight position={[4.5, 4.5, -1.5]} intensity={20} distance={11} color="#ffc16e" />
      <Environment preset="apartment" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 16]} />
        <meshStandardMaterial color="#6e321b" roughness={0.72} metalness={0.05} />
      </mesh>
      <mesh position={[0, 3.6, -3.7]} receiveShadow>
        <boxGeometry args={[10, 7, 0.3]} />
        <meshStandardMaterial color="#d7b28b" roughness={0.86} />
      </mesh>
      <mesh position={[0, 1.45, -3.48]}>
        <boxGeometry args={[10, 2.2, 0.22]} />
        <meshStandardMaterial color="#4a1f13" roughness={0.56} />
      </mesh>
      <WallPanel position={[0, 2.65, -3.3]} size={[4.7, 3.1, 0.14]} />
      <Text position={[0, 3.2, -3.19]} fontSize={0.34} color="#ffe3a6" anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#7e3b1e">BALA BALA &amp; ASSOCIATES</Text>
      <mesh position={[0, 4.85, -3.38]} rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[0.43, 0.07, 12, 32]} />
        <meshStandardMaterial color="#d89a3d" emissive="#8e4d1a" emissiveIntensity={0.35} metalness={0.72} roughness={0.28} />
      </mesh>
      <mesh position={[0, 4.85, -3.36]} rotation={[0, 0, Math.PI / 4]}>
        <coneGeometry args={[0.28, 0.28, 5]} />
        <meshStandardMaterial color="#f0bc5b" emissive="#8e4d1a" emissiveIntensity={0.3} metalness={0.6} />
      </mesh>
      <WoodBeam position={[-4.7, 3.2, -3.2]} />
      <WoodBeam position={[4.7, 3.2, -3.2]} />
      <HangingLamp position={[-3.8, 4.55, -2.6]} />
      <HangingLamp position={[3.8, 4.55, -2.6]} />

      <JudgeBench position={[0, 1.15, -2.55]} />
      <Desk position={[-2.65, 0.74, -0.05]} color="#76351f" label="原告席" />
      <Desk position={[2.65, 0.74, -0.05]} color="#76351f" label="被告席" />
      <Avatar position={[0, 1.95, -2.38]} body="#ec9fca" head="#ffcba7" accent="#f4e0a5" name="Luna" />
      {character?.assetUrl ? <CourtroomCharacter character={character} /> : <Avatar position={[-2.6, 1.55, -0.1]} body="#7a5ed9" head="#ffd1b3" accent="#74f1de" name="泡泡" />}
      <Avatar position={[2.6, 1.55, -0.1]} body="#3c9ea4" head="#f1b68e" accent="#ffcf71" name="阿布" />
      {jury.map(([x, y, z], index) => <JuryBench key={`${x}-${z}`} position={[x, y, z]} />)}
      <Avatar position={[-3.7, 1.05, 2.02]} body="#e67c4d" head="#b9613e" accent="#f2c65c" name="陪审" scale={0.68} />
      <Avatar position={[3.7, 1.05, 2.02]} body="#52b7bf" head="#efb590" accent="#f2c65c" name="陪审" scale={0.68} />
      <Float speed={2.6} rotationIntensity={0.18} floatIntensity={0.2}>
        <mesh position={[0, 2.25, -2.98]} rotation={[0, 0, Math.PI / 8]}>
          <boxGeometry args={[0.72, 0.18, 0.18]} />
          <meshStandardMaterial color="#e6a43f" emissive="#a4511b" emissiveIntensity={0.45} metalness={0.7} roughness={0.26} />
        </mesh>
      </Float>
      <ContactShadows position={[0, 0.02, 0]} opacity={0.58} scale={13} blur={2.8} far={8} color="#2b120a" />
    </group>
  )
}

type HearingMode = 'quick' | 'evidence'
type Perspective = 'plaintiff' | 'defendant' | 'audience'
type EvidenceMeta = { name: string; size: number; type: string }
type TrialMessage = { id: string; role: Perspective; text: string; time: string }
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

function WallPanel({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return <mesh position={position} castShadow><boxGeometry args={size} /><meshStandardMaterial color="#7b3a21" roughness={0.6} /></mesh>
}

function WoodBeam({ position }: { position: [number, number, number] }) {
  return <mesh position={position} rotation={[0, 0, 0.06]} castShadow><boxGeometry args={[0.28, 6.1, 0.3]} /><meshStandardMaterial color="#4a1e12" roughness={0.54} /></mesh>
}

function HangingLamp({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh position={[0, 0.42, 0]}><cylinderGeometry args={[0.018, 0.018, 0.8, 8]} /><meshStandardMaterial color="#9a642d" /></mesh><mesh position={[0, 0, 0]}><sphereGeometry args={[0.2, 16, 12]} /><meshStandardMaterial color="#ffe3a7" emissive="#ffb84f" emissiveIntensity={1.4} /></mesh><pointLight color="#ffbe68" intensity={5} distance={4} /></group>
}

function JudgeBench({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh castShadow><boxGeometry args={[4.2, 1.5, 1.1]} /><meshStandardMaterial color="#75331e" roughness={0.5} /></mesh><mesh position={[0, 0.82, 0]} castShadow><boxGeometry args={[4.6, 0.25, 1.3]} /><meshStandardMaterial color="#b85b2b" roughness={0.38} /></mesh><mesh position={[0, 1.5, 0.3]} castShadow><boxGeometry args={[2.9, 1.8, 0.22]} /><meshStandardMaterial color="#4b2014" roughness={0.6} /></mesh></group>
}

function JuryBench({ position }: { position: [number, number, number] }) {
  return <group position={position}><mesh castShadow><boxGeometry args={[2.2, 0.42, 0.72]} /><meshStandardMaterial color="#7b371f" roughness={0.58} /></mesh><mesh position={[0, 0.46, 0.18]} castShadow><boxGeometry args={[2.28, 0.14, 0.82]} /><meshStandardMaterial color="#a24c27" roughness={0.48} /></mesh></group>
}

function Bench({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh castShadow><boxGeometry args={[3.9, 1.5, 0.8]} /><meshStandardMaterial color="#6b3f57" roughness={0.48} /></mesh>
    <mesh position={[0, 0.84, 0]} castShadow><boxGeometry args={[4.35, 0.22, 1]} /><meshStandardMaterial color="#f1c05f" emissive="#79502a" emissiveIntensity={0.15} /></mesh>
  </group>
}

function Desk({ position, color, label, scale = 1 }: { position: [number, number, number]; color: string; label: string; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh castShadow><boxGeometry args={[2.35, 0.34, 1.35]} /><meshStandardMaterial color="#e4b273" roughness={0.55} /></mesh>
    <mesh position={[0, -0.65, 0]} castShadow><boxGeometry args={[1.85, 1.05, 0.92]} /><meshStandardMaterial color={color} roughness={0.68} /></mesh>
    <Text position={[0, 0.23, 0.7]} rotation={[-0.16, 0, 0]} fontSize={0.2} color="#ffe5b3" anchorX="center" anchorY="middle">{label}</Text>
  </group>
}

function Avatar({ position, body, head, accent, name, scale = 1 }: { position: [number, number, number]; body: string; head: string; accent: string; name: string; scale?: number }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.18, 0]} castShadow><capsuleGeometry args={[0.34, 0.75, 8, 16]} /><meshStandardMaterial color={body} roughness={0.45} /></mesh>
    <mesh position={[0, 0.83, 0]} castShadow><sphereGeometry args={[0.37, 24, 20]} /><meshStandardMaterial color={head} roughness={0.52} /></mesh>
    <mesh position={[0, 0.98, -0.03]} castShadow><sphereGeometry args={[0.39, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.54]} /><meshStandardMaterial color={accent} roughness={0.5} /></mesh>
    <mesh position={[-0.12, 0.84, -0.34]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color="#2a2042" /></mesh>
    <mesh position={[0.12, 0.84, -0.34]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color="#2a2042" /></mesh>
    <Text position={[0, 1.4, 0]} fontSize={0.18} color="#f7efff" anchorX="center" anchorY="middle">{name}</Text>
  </group>
}

function App() {
  const [enteredCourt, setEnteredCourt] = useState(false)
  const [sceneDetailOpen, setSceneDetailOpen] = useState(false)
  const [courtCharacter, setCourtCharacter] = useState<Character | null>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [characterHallOpen, setCharacterHallOpen] = useState(false)
  const [plazaOpen, setPlazaOpen] = useState(false)
  const [caseText, setCaseText] = useState('泡泡借走了阿布的彩虹伞，但下雨后伞变成了会唱歌的蘑菇。')
  const [hearingMode, setHearingMode] = useState<HearingMode>('quick')
  const [perspective, setPerspective] = useState<Perspective>('plaintiff')
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceMeta[]>(() => {
    try {
      const saved = window.localStorage.getItem('balabala.pending-evidence')
      return saved ? JSON.parse(saved) as EvidenceMeta[] : []
    } catch { return [] }
  })
  const [phase, setPhase] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [liveSpeaker, setLiveSpeaker] = useState('')
  const [liveQuote, setLiveQuote] = useState('')
  const [verdictTitle, setVerdictTitle] = useState('')
  const [verdictSummary, setVerdictSummary] = useState('')
  const [avatarPrompt, setAvatarPrompt] = useState('卡通风格、穿红色法官袍的猫咪')
  const [avatarTask, setAvatarTask] = useState('')
  const [avatarStatus, setAvatarStatus] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [showArchivePage, setShowArchivePage] = useState(false)
  const [archives, setArchives] = useState<ArchiveRecord[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [trialMessages, setTrialMessages] = useState<TrialMessage[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [supportChoice, setSupportChoice] = useState<'plaintiff' | 'defendant' | null>(null)
  const [supportCounts, setSupportCounts] = useState({ plaintiff: 0, defendant: 0 })
  const [trialEvidence, setTrialEvidence] = useState<EvidenceMeta[]>([])
  const [evidenceTarget, setEvidenceTarget] = useState<'plaintiff' | 'defendant'>('plaintiff')
  const [appealOpen, setAppealOpen] = useState(false)
  const [appealNote, setAppealNote] = useState('')
  const [isListening, setIsListening] = useState(false)
  const speechRef = useRef<SpeechRecognitionLike | null>(null)
  const [sharedCase, setSharedCase] = useState<{ title: string; quote: string; charge: string; sentence: string; disclaimer: string } | null>(null)
  const shareId = window.location.pathname.match(/^\/share\/([^/]+)/)?.[1]
  const currentPhase = phases[phase]
  const displayedSpeaker = liveSpeaker || currentPhase.speaker
  const displayedQuote = liveQuote || currentPhase.quote
  const stats = useMemo(() => ({ witnesses: 3 + phase, minutes: 12 + phase * 4 }), [phase])
  const generatedTitle = useMemo(() => {
    const clean = caseText.trim()
    if (!clean) return '等待一个新案件'
    const firstSentence = clean.split(/[。！？!?\n]/)[0].trim()
    const short = firstSentence.slice(0, 18)
    return short || '生活小事案'
  }, [caseText])

  useEffect(() => {
    if (!shareId) return
    fetch(`/api/shares/${encodeURIComponent(shareId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('分享内容不存在或已失效')
        return response.json() as Promise<{ title: string; quote: string; charge: string; sentence: string; disclaimer: string }>
      })
      .then(setSharedCase)
      .catch(() => setSharedCase(null))
  }, [shareId])

  useEffect(() => {
    try { window.localStorage.setItem('balabala.pending-evidence', JSON.stringify(evidenceFiles)) } catch { /* storage may be unavailable in private mode */ }
  }, [evidenceFiles])

  const fetchArchives = async () => {
    setArchiveLoading(true)
    setArchiveError('')
    try {
      const response = await fetch('/api/archives')
      if (!response.ok) throw new Error('案卷服务暂时不可用')
      setArchives(await response.json() as ArchiveRecord[])
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : '案卷加载失败')
    } finally {
      setArchiveLoading(false)
    }
  }

  if (shareId) return <main className="share-page"><div className="share-brand"><Gavel size={20} /> 叽里呱啦 · BalaBala</div>{sharedCase ? <article className="shared-verdict"><span className="micro-label">AI 趣味判决书</span><h1>{sharedCase.title}</h1><div className="shared-quote">“{sharedCase.quote}”</div><div className="shared-field"><b>罪名认定</b><span>{sharedCase.charge}</span></div><div className="shared-field"><b>判决主文</b><span>{sharedCase.sentence}</span></div><p className="shared-disclaimer">{sharedCase.disclaimer}</p><a href="/" className="shared-cta">我也要上法庭</a></article> : <article className="shared-verdict"><h1>分享内容不存在</h1><p className="shared-disclaimer">这份案卷可能已被删除，或者分享链接已经失效。</p><a href="/" className="shared-cta">进入趣味法庭</a></article>}</main>
  if (showArchivePage) return <ArchivePage archives={archives} loading={archiveLoading} error={archiveError} onBack={() => { setShowArchivePage(false); setEnteredCourt(false) }} onCourt={() => { setShowArchivePage(false); setEnteredCourt(true) }} onRefresh={() => { void fetchArchives() }} onOpenCase={(record) => { setCaseText(record.input); setShowArchivePage(false); setEnteredCourt(true) }} onDelete={async (record) => { try { await fetch(`/api/cases/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('删除案卷失败') } }} onClear={async () => { try { await fetch('/api/archives', { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('清空案卷失败') } }} />
  if (avatarOpen) return <AvatarStudio onBack={() => setAvatarOpen(false)} onEnterCourt={() => { setAvatarOpen(false); setEnteredCourt(true) }} />
  if (characterHallOpen) return <CharacterHall onBack={() => setCharacterHallOpen(false)} onEnterCourt={(character) => { setCharacterHallOpen(false); setCourtCharacter(character ?? null); setEnteredCourt(true) }} />
  if (sceneDetailOpen) return <SceneDetail onBack={() => setSceneDetailOpen(false)} onStartHearing={(mode) => { setHearingMode(mode ?? 'quick'); setSceneDetailOpen(false); setEnteredCourt(true) }} />
  const plazaParam = new URLSearchParams(window.location.search).get('plaza');
  if (plazaOpen || plazaParam === '1') return <Plaza onBack={() => { if (plazaParam === '1') window.location.href = '/'; else setPlazaOpen(false); }} />
  if (!enteredCourt) return <RoomEntry onEnter={() => setEnteredCourt(true)} onSceneDetail={() => setSceneDetailOpen(true)} onArchive={() => { setShowArchivePage(true); void fetchArchives() }} onAvatar={() => setAvatarOpen(true)} onCharacters={() => setCharacterHallOpen(true)} onPlaza={() => setPlazaOpen(true)} />


  const generateAvatar = async () => {
    if (!avatarPrompt.trim()) return
    setAvatarStatus('提交中…')
    setAvatarUrl('')
    try {
      const response = await fetch('/api/avatars/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text_to_model', prompt: avatarPrompt.trim() }) })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建任务失败')
      setAvatarTask(data.taskId)
      setAvatarStatus('已提交，正在生成…')
      const poll = async () => {
        const statusResponse = await fetch(`/api/avatars/tasks/${data.taskId}`)
        const statusData = await statusResponse.json() as { data?: { status?: string; output?: Record<string, string> }; status?: string; output?: Record<string, string> }
        const task = statusData.data ?? statusData
        if (task.status === 'success') { const output = task.output ?? {}; setAvatarUrl(output.pbr_model ?? output.model ?? output.mesh ?? ''); setAvatarStatus('生成完成'); return }
        if (task.status === 'failed') { setAvatarStatus('生成失败'); return }
        setAvatarStatus(`生成中… ${task.status ?? 'queued'}`)
        window.setTimeout(poll, 2500)
      }
      window.setTimeout(poll, 1200)
    } catch (error) { setAvatarStatus(error instanceof Error ? error.message : '生成失败') }
  }

  const startHearing = async (overrideInput?: string) => {
    const hearingInput = overrideInput?.trim() || caseText.trim()
    if (!hearingInput) return
    setIsPlaying(true)
    setErrorMessage('')
    setPhase(0)
    setLiveSpeaker('')
    setLiveQuote('')
    setVerdictTitle('')
    setVerdictSummary('')
    setTrialMessages([])
    setTrialEvidence([])
    setEvidenceTarget('plaintiff')
    setSupportChoice(null)
    setSupportCounts({ plaintiff: 0, defendant: 0 })
    setShowToast(true)
    window.setTimeout(() => setShowToast(false), 2200)
    try {
      const created = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: hearingInput,
          mode: hearingMode,
          perspective,
          evidence: evidenceFiles,
        }),
      })
      if (!created.ok) {
        const error = await created.json().catch(() => ({})) as { message?: string }
        throw new Error(error.message ?? '案件创建失败')
      }
      const { id } = await created.json() as { id: string }
      const stream = new EventSource(`/api/cases/${id}/trial/stream`)
      stream.onmessage = (message) => {
        const event = JSON.parse(message.data) as { type: string; stage?: string; role?: string; text?: string; verdict?: { title: string; sentence: string; quote: string } }
        if (event.stage) {
          const stageIndex: Record<string, number> = { '立案': 0, '开庭': 0, '举证': 1, '辩论': 2, '判决': 3, '执行': 3 }
          setPhase(stageIndex[event.stage] ?? 0)
        }
        if (event.type === 'dialogue') {
          setLiveSpeaker(event.role === 'judge' ? 'AI 法官' : event.role === 'plaintiff' ? '原告 · AI 数字人' : event.role === 'defendant' ? '被告 · 你的分身' : '证人 · AI 数字人')
          setLiveQuote(`“${event.text ?? ''}”`)
        }
        if (event.type === 'verdict' && event.verdict) {
          setVerdictTitle(event.verdict.title)
          setVerdictSummary(`${event.verdict.sentence} ${event.verdict.quote}`)
          setPhase(3)
          setIsPlaying(false)
          setArchives((previous) => [{ id, input: hearingInput, verdict: event.verdict }, ...previous.filter((item) => item.id !== id)])
          stream.close()
        }
      }
      stream.onerror = () => { stream.close(); setIsPlaying(false) }
    } catch (error) {
      setIsPlaying(false)
      setErrorMessage(error instanceof Error ? error.message : '庭审服务暂时不可用')
    }
  }

  const loadArchives = async () => {
    setShowArchivePage(true)
    await fetchArchives()
  }

  const shareVerdict = async () => {
    setShareStatus('准备分享…')
    try {
      const latest = archives[0]
      if (!latest?.id) throw new Error('请先完成一次庭审')
      const response = await fetch(`/api/cases/${latest.id}/share`, { method: 'POST' })
      const data = await response.json() as { shareUrl?: string; title?: string; quote?: string; message?: string }
      if (!response.ok || !data.shareUrl) throw new Error(data.message ?? '分享链接生成失败')
      const shareUrl = new URL(data.shareUrl, window.location.origin).toString()
      if (navigator.share) await navigator.share({ title: data.title ?? '叽里呱啦趣味法庭判决', text: data.quote ?? '', url: shareUrl })
      else { await navigator.clipboard.writeText(`${data.title ?? '叽里呱啦趣味法庭判决'}\n${data.quote ?? ''}\n${shareUrl}`); setShareStatus('分享链接已复制') }
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '分享失败') }
    window.setTimeout(() => setShareStatus(''), 2800)
  }

  const publishCourt = async () => {
    setShareStatus('正在发布到广场…')
    try {
      const latest = archives[0]
      if (!latest?.id) throw new Error('请先完成一次庭审')
      const response = await fetch(`/api/cases/${latest.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await response.json() as { content?: unknown; message?: string }
      if (!response.ok || !data.content) throw new Error(data.message ?? '发布失败')
      setShareStatus('已发布到广场')
      setPlazaOpen(true)
    } catch (error) { setShareStatus(error instanceof Error ? error.message : '发布失败') }
    window.setTimeout(() => setShareStatus(''), 1600)
  }

  const submitTrialMessage = () => {
    const text = messageDraft.trim()
    if (!text) return
    const role = perspective === 'audience' ? 'audience' : perspective
    setTrialMessages((previous) => [...previous, { id: crypto.randomUUID(), role, text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setMessageDraft('')
    setLiveSpeaker(role === 'audience' ? '观众 · 你' : role === 'plaintiff' ? '原告 · 你' : '被告 · 你')
    setLiveQuote(`“${text}”`)
    setPhase(Math.max(phase, 2))
  }

  const toggleVoiceInput = () => {
    if (isListening) { speechRef.current?.stop(); setIsListening(false); return }
    const browserWindow = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition
    if (!Recognition) { setErrorMessage('当前浏览器不支持语音输入，请使用文字发言。'); return }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.continuous = false
    recognition.onresult = (event) => { setMessageDraft((previous) => `${previous}${event.results[0]?.[0]?.transcript ?? ''}`) }
    recognition.onerror = () => { setIsListening(false); setErrorMessage('语音识别没有听清，请再试一次。') }
    recognition.onend = () => setIsListening(false)
    speechRef.current = recognition; recognition.start(); setIsListening(true); setErrorMessage('')
  }

  const addTrialEvidence = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).map((file) => ({ name: file.name, size: file.size, type: file.type }))
    if (files.length) setTrialEvidence((previous) => [...previous, ...files].slice(0, 8))
    event.currentTarget.value = ''
  }

  const castSupport = (side: 'plaintiff' | 'defendant') => {
    setSupportChoice(side)
    setSupportCounts((previous) => ({ ...previous, [side]: previous[side] + 1 }))
    setLiveSpeaker('观众 · 你')
    setLiveQuote(`“我支持${side === 'plaintiff' ? '原告' : '被告'}，请法庭注意这份观点。”`)
  }

  const beginAppeal = () => {
    const suffix = appealNote.trim() ? ` 上诉补充：${appealNote.trim()}` : ' 我对上一份判决提出复议。'
    const nextInput = `${caseText.replace(/\s+$/u, '')}${suffix}`.slice(0, 120)
    setCaseText(nextInput)
    setAppealOpen(false); setAppealNote('');
    void startHearing(nextInput)
  }

  const reset = () => {
    setIsPlaying(false)
    setPhase(0)
    setCaseText('')
    setLiveSpeaker('')
    setLiveQuote('')
    setVerdictTitle('')
    setVerdictSummary('')
    setHearingMode('quick')
    setPerspective('plaintiff')
    setEvidenceFiles([])
    setTrialMessages([])
    setTrialEvidence([])
    setEvidenceTarget('plaintiff')
    setMessageDraft('')
    setSupportChoice(null)
    setSupportCounts({ plaintiff: 0, defendant: 0 })
    setAppealNote('')
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Gavel size={19} strokeWidth={2.7} /></div><div><div className="brand-name">叽里呱啦</div><div className="brand-sub">BALA BALA · SOCIAL COURT</div></div></div>
      <div className="top-actions"><span className="status-dot"><span className="dot" /> 房间 #0317 在线</span><button className="archive-button" onClick={loadArchives}>案卷库</button><button className="icon-button" title="重置体验" onClick={reset}><RotateCcw size={17} /></button><div className="avatar-chip">林<span>△</span></div></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="eyebrow"><Sparkles size={14} /> 今日趣味法庭</div>
        <h1>把小事说清楚，<br /><span>让快乐继续发生。</span></h1>
        <p className="intro">输入一个生活里的小小争议，和朋友一起进入 3D 法庭，探索每个人的可爱证词。</p>
        <label className="field-label" htmlFor="case">案件描述 · 客观叙述</label>
        <div className="textarea-wrap"><textarea id="case" value={caseText} onChange={e => setCaseText(e.target.value)} placeholder="例如：谁把最后一块小蛋糕吃掉了？" maxLength={120} /><span>{caseText.length}/120</span></div>
        <div className="hearing-prep" aria-label="开庭准备">
          <div className="prep-heading"><span>开庭方式</span><small>{hearingMode === 'evidence' ? '已带证据' : '轻装上庭'}</small></div>
          <div className="prep-segmented" role="tablist" aria-label="开庭方式">
            <button type="button" role="tab" aria-selected={hearingMode === 'quick'} className={hearingMode === 'quick' ? 'is-active' : ''} onClick={() => setHearingMode('quick')}>快速开庭</button>
            <button type="button" role="tab" aria-selected={hearingMode === 'evidence'} className={hearingMode === 'evidence' ? 'is-active' : ''} onClick={() => setHearingMode('evidence')}>带着证据开庭</button>
          </div>
          <div className="prep-heading prep-role-heading"><span>我的视角</span><small>AI 自动生成对手</small></div>
          <div className="perspective-grid" role="radiogroup" aria-label="我的视角">
            <button type="button" role="radio" aria-checked={perspective === 'plaintiff'} className={perspective === 'plaintiff' ? 'is-active' : ''} onClick={() => setPerspective('plaintiff')}><Scale size={14} /><span>原告</span><small>提出主张</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'defendant'} className={perspective === 'defendant' ? 'is-active' : ''} onClick={() => setPerspective('defendant')}><Bot size={14} /><span>被告</span><small>回应质疑</small></button>
            <button type="button" role="radio" aria-checked={perspective === 'audience'} className={perspective === 'audience' ? 'is-active' : ''} onClick={() => setPerspective('audience')}><Eye size={14} /><span>观众</span><small>旁观站队</small></button>
          </div>
          <label className="evidence-dropzone" htmlFor="evidence-upload">
            <Upload size={15} />
            <span>{evidenceFiles.length ? `已选择 ${evidenceFiles.length} 份证据` : '添加聊天记录、图片或文件'}</span>
            <input id="evidence-upload" type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.zip" onChange={event => { const files = Array.from(event.target.files ?? []).map(file => ({ name: file.name, size: file.size, type: file.type })); setEvidenceFiles(previous => [...previous, ...files].slice(0, 8)); event.currentTarget.value = '' }} />
          </label>
          {evidenceFiles.length > 0 && <div className="evidence-list">{evidenceFiles.map((file, index) => <div className="evidence-chip" key={`${file.name}-${index}`}><FileText size={12} /><span title={file.name}>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setEvidenceFiles(previous => previous.filter((_, i) => i !== index))}>×</button></div>)}</div>}
          <div className="perspective-note"><Sparkles size={12} /> {perspective === 'audience' ? '你将以中立观众身份旁观，也可以在自由辩论时站队。' : `你将扮演${perspective === 'plaintiff' ? '原告' : '被告'}，另一方由 AI 数字分身应答。`}</div>
        </div>
        <button className="primary-button" onClick={() => { void startHearing() }} disabled={!caseText.trim()}><Play size={17} fill="currentColor" /> {isPlaying ? '继续庭审' : '开始庭审'}<ChevronRight size={17} /></button>
        {errorMessage && <div className="error-message">{errorMessage}</div>}
        <div className="hint-row"><WandSparkles size={14} /> AI 会把你的故事变成一场有趣的对话</div>
        <div className="avatar-builder">
          <div className="section-title"><span>创建 3D 分身</span><span className="phase-count">Tripo3D</span></div>
          <input value={avatarPrompt} onChange={e => setAvatarPrompt(e.target.value)} placeholder="例如：穿西装的赛博朋克律师" maxLength={120} />
          <button className="secondary-button" onClick={generateAvatar} disabled={!avatarPrompt.trim() || avatarStatus.startsWith('生成中') || avatarStatus === '提交中…'}><Sparkles size={14} /> 生成模型</button>
          {avatarStatus && <div className="avatar-status">{avatarStatus}</div>}
          {avatarUrl && <a className="model-link" href={avatarUrl} target="_blank" rel="noreferrer">打开 GLB 模型文件</a>}
        </div>
        <div className="divider" />
        <div className="section-title"><span>庭审进度</span><span className="phase-count">{phase + 1} / {phases.length}</span></div>
        <div className="phase-list">{phases.map((item, i) => <button className={`phase-item ${phase === i ? 'active' : ''} ${phase > i ? 'done' : ''}`} onClick={() => { setPhase(i); setIsPlaying(true) }} key={item.id}><span className={`phase-icon ${item.tone}`}>{phase > i ? <Check size={13} /> : i + 1}</span><span>{item.label}</span>{phase === i && <span className="live-pill">LIVE</span>}</button>)}</div>
        <div className="sidebar-footer"><div><Users size={15} /> {stats.witnesses} 位角色</div><div><Clock3 size={15} /> 约 {stats.minutes} 分钟</div></div>
      </aside>
      <section className="main-stage">
        <div className="stage-header"><div><div className="stage-kicker"><span className="tiny-dot" /> 正在进行 · {currentPhase.label}</div><h2>{generatedTitle}</h2><div className="case-meta"><span>{hearingMode === 'evidence' ? '带证据开庭' : '快速开庭'}</span><span>·</span><span>{perspective === 'audience' ? '观众视角' : perspective === 'plaintiff' ? '原告视角' : '被告视角'}</span>{evidenceFiles.length > 0 && <><span>·</span><span>{evidenceFiles.length} 份证据</span></>}</div></div><div className="stage-tools"><span className="scene-tag">3D 场景 · 趣味法庭</span><button className="round-button" title="语音模式"><Volume2 size={17} /></button></div></div>
        <div className="scene-card"><Canvas shadows camera={{ position: [7, 5.2, 8], fov: 38 }} dpr={[1, 2]}><Courtroom character={courtCharacter} /><OrbitControls enablePan={false} minDistance={6} maxDistance={12} maxPolarAngle={Math.PI / 2.1} /></Canvas><div className="scene-overlay"><div className="camera-hint">拖动旋转 · 滚轮缩放</div><div className="scene-corner"><Scale size={13} /> 友善模式已开启</div>{courtCharacter && <div className="scene-character-chip" style={{ '--character-accent': courtCharacter.accent } as React.CSSProperties}><div className="scene-character-avatar"><span>{courtCharacter.emoji}</span></div><div><small>本场角色</small><strong>{courtCharacter.name}</strong><em>{courtCharacter.title}</em></div>{courtCharacter.assetUrl && <a href={courtCharacter.assetUrl} target="_blank" rel="noreferrer">打开 3D</a>}</div>}</div></div>
        <div className="below-grid">
          <div className="dialogue-card"><div className="card-heading"><div><span className="micro-label">当前发言</span><h3>{displayedSpeaker}</h3></div><button className="listen-button"><Mic2 size={15} /> 播放台词</button></div><div className={`quote quote-${currentPhase.tone}`}>{liveQuote ? displayedQuote : <><span className="quote-mark">“</span>{displayedQuote}<span className="quote-mark end">”</span></>}</div><div className="stepper">{phases.map((item, i) => <button aria-label={item.label} key={item.id} className={`step ${i === phase ? 'current' : ''} ${i < phase ? 'passed' : ''}`} onClick={() => setPhase(i)} />)}</div></div>
          <div className="verdict-card"><div className="verdict-top"><div className="verdict-icon"><Gavel size={18} /></div><div><span className="micro-label">AI 判决书 · 草稿</span><h3>{verdictTitle || (phase === phases.length - 1 ? '友谊大于输赢' : '等待全部证词')}</h3></div><span className="draft-tag">{(verdictTitle || phase === phases.length - 1) ? '已生成' : '进行中'}</span></div><p>{verdictSummary || (phase === phases.length - 1 ? '双方各获得一枚“会唱歌的蘑菇”纪念章，彩虹伞由两人轮流使用。' : '完成四个庭审阶段后，这里会出现一份温柔又好玩的判决。')}</p><div className="verdict-progress"><span style={{ width: `${((phase + 1) / phases.length) * 100}%` }} /></div>{verdictTitle && <div className="verdict-card__buttons"><button className="share-button" onClick={shareVerdict}>分享判决</button><button className="share-button share-button--plaza" onClick={publishCourt}>发布到广场</button></div>}{shareStatus && <div className="share-status">{shareStatus}</div>}</div>
        </div>
        <section className="trial-interaction" aria-label="庭审互动">
          <div className="interaction-head"><div><span className="micro-label">LIVE PARTICIPATION</span><h3>庭上互动</h3></div><span className="interaction-role">{perspective === 'audience' ? '观众模式' : perspective === 'plaintiff' ? '原告席' : '被告席'}</span></div>
          <div className="interaction-grid">
            <div className="interaction-compose">
              <label htmlFor="trial-message">{perspective === 'audience' ? '发表观众意见' : '补充你的陈述'}</label>
              <textarea id="trial-message" value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="输入一句友善、具体的观点…" maxLength={240} />
              <div className="compose-actions"><button type="button" className={`voice-button ${isListening ? 'is-listening' : ''}`} onClick={toggleVoiceInput}><Mic2 size={14} /> {isListening ? '正在聆听' : '语音输入'}</button><button type="button" className="send-button" onClick={submitTrialMessage} disabled={!messageDraft.trim()}>提交发言 <ChevronRight size={14} /></button></div>
            </div>
            <div className="interaction-side">
              <div className="support-title"><span>观众站队</span><small>可随时更换支持对象</small></div>
              <div className="support-buttons"><button type="button" className={supportChoice === 'plaintiff' ? 'is-selected' : ''} onClick={() => castSupport('plaintiff')}><Scale size={14} /> 支持原告 <b>{supportCounts.plaintiff}</b></button><button type="button" className={supportChoice === 'defendant' ? 'is-selected' : ''} onClick={() => castSupport('defendant')}><Bot size={14} /> 支持被告 <b>{supportCounts.defendant}</b></button></div>
              <div className="evidence-target-row"><span>证据提交给</span><button type="button" className={evidenceTarget === 'plaintiff' ? 'is-selected' : ''} onClick={() => setEvidenceTarget('plaintiff')}>原告</button><button type="button" className={evidenceTarget === 'defendant' ? 'is-selected' : ''} onClick={() => setEvidenceTarget('defendant')}>被告</button></div>
              <label className="trial-evidence-button" htmlFor="trial-evidence-upload"><Upload size={14} /> 补充给{evidenceTarget === 'plaintiff' ? '原告' : '被告'}的新证据 {trialEvidence.length > 0 && <b>{trialEvidence.length}</b>}<input id="trial-evidence-upload" type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx" onChange={addTrialEvidence} /></label>
              {trialEvidence.length > 0 && <div className="trial-evidence-list">{trialEvidence.map((file, index) => <span key={`${file.name}-${index}`} title={file.name}><FileText size={11} /> {file.name}<button type="button" onClick={() => setTrialEvidence((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
            </div>
          </div>
          {trialMessages.length > 0 && <div className="trial-message-list">{trialMessages.slice(-3).map((item) => <div className="trial-message" key={item.id}><span>{item.role === 'audience' ? '观众' : item.role === 'plaintiff' ? '原告' : '被告'}</span><p>{item.text}</p><time>{item.time}</time></div>)}</div>}
          {verdictTitle && <div className="appeal-row"><div><b>对判决有新想法？</b><span>基于本案卷补充证据，开启二次上诉。</span></div><button type="button" className="appeal-button" onClick={() => setAppealOpen(true)}><RotateCcw size={14} /> 发起上诉</button></div>}
        </section>
      </section>
    </div>
    {showToast && <div className="toast"><Sparkles size={15} /> 场景已准备好，欢迎来到 BalaBala 法庭！</div>}
    {appealOpen && <div className="appeal-backdrop" onClick={() => setAppealOpen(false)}><section className="appeal-modal" onClick={(event) => event.stopPropagation()}><div className="appeal-modal-head"><div><span className="micro-label">APPEAL HEARING</span><h2>发起二次上诉</h2></div><button type="button" className="icon-button" onClick={() => setAppealOpen(false)}>×</button></div><p>保留原案卷事实，在下一轮庭审中加入一条新的理由或证据。</p><textarea value={appealNote} onChange={(event) => setAppealNote(event.target.value)} placeholder="例如：补充医院诊断书，说明泡面导致肚子不舒服。" maxLength={100} /><div className="appeal-modal-actions"><button type="button" className="listen-button" onClick={() => setAppealOpen(false)}>稍后再说</button><button type="button" className="send-button" onClick={beginAppeal}>确认上诉 <ChevronRight size={14} /></button></div></section></div>}
    {archiveOpen && <div className="archive-backdrop" onClick={() => setArchiveOpen(false)}><section className="archive-drawer" onClick={(event) => event.stopPropagation()}><div className="archive-heading"><div><span className="micro-label">PERSONAL ARCHIVE</span><h2>我的案卷库</h2></div><button className="icon-button" onClick={() => setArchiveOpen(false)}>×</button></div>{archives.length === 0 ? <div className="empty-archive">完成一次庭审后，判决书会自动归档在这里。</div> : <div className="archive-list">{archives.map((item) => <button className="archive-item" key={item.id} onClick={() => { setCaseText(item.input); setArchiveOpen(false) }}><span className="archive-icon"><Gavel size={15} /></span><span><b>{item.verdict?.title || `${item.input.slice(0, 18)}案`}</b><small>{item.verdict?.quote || item.input}</small></span><ChevronRight size={15} /></button>)}</div>}<p className="archive-note">案卷仅保存在当前开发环境；接入 PostgreSQL 后可跨设备同步。</p></section></div>}
  </main>
}

function LegacyRoomEntry({ onEnter }: { onEnter: () => void }) {
  const rooms = [
    { title: '快速开庭', subtitle: 'QUICK HEARING · M-01', hint: '输入一件破事，马上开庭', color: '#f6d283', icon: '⚖' },
    { title: '律师辩论', subtitle: 'DEBATE ROOM · M-02', hint: '让两位 AI 律师替你吵一架', color: '#ec9fca', icon: '✦' },
    { title: '聊天纠纷', subtitle: 'CHAT CASE · M-03', hint: '把一句“哈哈”送上法庭', color: '#78e5d1', icon: '◌' },
    { title: '案卷库', subtitle: 'ARCHIVE · M-04', hint: '回看你曾经被判的那些事', color: '#8aa4ff', icon: '▣' },
  ]
  const [active, setActive] = useState(0)
  return <main className="room-entry"><header className="room-topbar"><div className="room-brand"><span className="room-light" /> BALABALA & ASSOCIATES</div><div className="room-nav"><span>房间</span><span>分身</span><span>案卷</span><button className="sound-pill">••• 声 OFF</button></div></header><section className="room-hero"><span className="room-kicker">THE FUN COURTROOM</span><h1>叽里呱啦的<br /><em>趣味法庭</em></h1><p>走近一点，法槌就会醒来；推开一扇门，就进入一场只属于你的生活审判。</p></section><section className="room-grid">{rooms.map((room, index) => <button key={room.title} className={`room-card ${active === index ? 'room-active' : ''}`} style={{ ['--room-color' as string]: room.color }} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={index === 0 ? onEnter : undefined}><div className="room-icon">{room.icon}</div><div className="room-card-copy"><strong>{room.title}</strong><span>{room.subtitle}</span><small>{room.hint}</small></div><span className="room-status">{index === 0 ? '在线 · 可进入' : '即将开放'}</span></button>)}</section><footer className="room-footer"><span>走廊尽头，已经有人敲响法槌 →</span><button onClick={onEnter}>进入快速开庭</button></footer></main>
}

export default App
