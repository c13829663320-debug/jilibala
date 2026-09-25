import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { Gavel } from 'lucide-react'
import RoomEntry from './RoomEntry'
import ArchivePage, { type ArchiveRecord } from './ArchivePage'
import AvatarStudio from './AvatarStudio'
import type { Perspective } from '@balabala/shared'
import MyPage from './MyPage'
import VideoStudio from './VideoStudio'
import TopNav, { type TopView } from './TopNav'
import CourtroomShell, { type EvidenceMeta } from './CourtroomShell'
import { IdentityProvider, useIdentity } from './identity'
import ErrorBoundary from './ErrorBoundary'
import LoadingFallback from './LoadingFallback'

const CharacterHall = lazy(() => import('./CharacterHall'))
const CustomCharacterStudio = lazy(() => import('./CustomCharacterStudio'))
const Plaza3D = lazy(() => import('./Plaza3D'))
const TalkshowShell = lazy(() => import('./TalkshowShell'))
const WerewolfShell = lazy(() => import('./WerewolfShell'))
const BarShell = lazy(() => import('./BarShell'))
const LibraryShell = lazy(() => import('./LibraryShell'))
const GymShell = lazy(() => import('./GymShell'))
const SceneStudio = lazy(() => import('./scene-studio/SceneStudio'))
const MyScenes = lazy(() => import('./scene-studio/MyScenes'))
const ScenePlay = lazy(() => import('./scene-studio/ScenePlay'))

type HearingMode = 'quick' | 'evidence'
type View = TopView | 'entry' | 'avatar' | 'custom-studio' | 'talkshow' | 'werewolf' | 'bar' | 'library' | 'gym' | 'scene-play'

/** 把一个懒加载组件包成 ErrorBoundary + Suspense，带重试。 */
function LazyScene({ component: C, props, label }: {
  component: ComponentType<any>
  props?: Record<string, unknown>
  label: string
}) {
  const [resetKey, setResetKey] = useState(0)
  const retry = () => setResetKey((n) => n + 1)
  return (
    <ErrorBoundary onRetry={retry} title={`「${label}」加载失败`}>
      <Suspense fallback={<LoadingFallback label={`正在加载${label}…`} />}>
        <ErrorBoundary is3D title="3D 场景渲染失败">
          <C key={resetKey} {...(props as object)} />
        </ErrorBoundary>
      </Suspense>
    </ErrorBoundary>
  )
}

/** Parse ?room=court:<caseId> from the URL; returns the caseId or null. */
function parseRoomParam(): string | null {
  const room = new URLSearchParams(window.location.search).get('room')
  if (room && room.startsWith('court:')) return room.slice('court:'.length)
  return null
}

function AppInner() {
  const { phase } = useIdentity()
  const [view, setView] = useState<View>(() => {
    if (parseRoomParam()) return 'court'
    if (new URLSearchParams(window.location.search).get('plaza') === '1') return 'plaza'
    const scene = new URLSearchParams(window.location.search).get('scene')
    if (scene === 'werewolf' || scene === 'gym') return scene
    return 'entry'
  })
  const [roomId] = useState<string | null>(() => parseRoomParam())
  // 场景工作室：正在编辑的场景 id（undefined = 新建）；正在播放的场景 id
  const [sceneStudioId, setSceneStudioId] = useState<string | undefined>(undefined)
  const [scenePlayId, setScenePlayId] = useState<string | null>(null)
  // 开庭前全局配置（合议庭流程在 CourtroomShell 内自治）
  const [caseText, setCaseText] = useState('泡泡借走了阿布的彩虹伞，但下雨后伞变成了会唱歌的蘑菇。')
  const [hearingMode, setHearingMode] = useState<HearingMode>('quick')
  const [perspective, setPerspective] = useState<Perspective>('plaintiff')
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceMeta[]>(() => {
    try { const saved = window.localStorage.getItem('balabala.pending-evidence'); return saved ? JSON.parse(saved) as EvidenceMeta[] : [] } catch { return [] }
  })
  // 案卷库
  const [archives, setArchives] = useState<ArchiveRecord[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  // 记录从哪里进入案卷库，返回时回到来源页（法庭 / 我的 / 入口大厅）
  const archiveOriginRef = useRef<View>('entry')
  // 分享页
  const [sharedCase, setSharedCase] = useState<{ title: string; quote: string; charge: string; sentence: string; disclaimer: string } | null>(null)

  const shareId = window.location.pathname.match(/^\/share\/([^/]+)/)?.[1]

  useEffect(() => {
    try { window.localStorage.setItem('balabala.pending-evidence', JSON.stringify(evidenceFiles)) } catch { /* storage may be unavailable */ }
  }, [evidenceFiles])

  useEffect(() => {
    if (!shareId) return
    fetch(`/api/shares/${encodeURIComponent(shareId)}`)
      .then(async (res) => { if (!res.ok) throw new Error('分享内容不存在或已失效'); return res.json() as Promise<{ title: string; quote: string; charge: string; sentence: string; disclaimer: string }> })
      .then(setSharedCase).catch(() => setSharedCase(null))
  }, [shareId])

  // Identity still loading: show nothing (the setup modal covers 'setup' phase)
  if (phase === 'loading') return null

  const fetchArchives = async () => {
    setArchiveLoading(true); setArchiveError('')
    try {
      const response = await fetch('/api/archives')
      if (!response.ok) throw new Error('案卷服务暂时不可用')
      setArchives(await response.json() as ArchiveRecord[])
    } catch (error) { setArchiveError(error instanceof Error ? error.message : '案卷加载失败') }
    finally { setArchiveLoading(false) }
  }

  const navigate = (next: TopView) => setView(next === 'home' ? 'entry' : next)
  const openArchives = (origin: View) => { archiveOriginRef.current = origin; void fetchArchives(); setView('archive') }

  // ===== 分享页（路径直达，无导航） =====
  if (shareId) {
    return <main className="share-page"><div className="share-brand"><Gavel size={20} /> 叽里呱啦 · BalaBala</div>
      {sharedCase ? (
        <article className="shared-verdict"><span className="micro-label">AI 趣味判决书</span><h1>{sharedCase.title}</h1><div className="shared-quote">“{sharedCase.quote}”</div><div className="shared-field"><b>罪名认定</b><span>{sharedCase.charge}</span></div><div className="shared-field"><b>判决主文</b><span>{sharedCase.sentence}</span></div><p className="shared-disclaimer">{sharedCase.disclaimer}</p><a href="/" className="shared-cta">我也要上法庭</a></article>
      ) : (
        <article className="shared-verdict"><h1>分享内容不存在</h1><p className="shared-disclaimer">这份案卷可能已被删除，或者分享链接已经失效。</p><a href="/" className="shared-cta">进入趣味法庭</a></article>
      )}
    </main>
  }

  // ===== 入口页（房间大厅，自带导航） =====
  if (view === 'entry') {
    return <RoomEntry
      onEnter={() => setView('court')}
      onArchive={() => openArchives('entry')}
      onAvatar={() => setView('avatar')}
      onCharacters={() => setView('characters')}
      onCreateCharacter={() => setView('custom-studio')}
      onPlaza={() => setView('plaza')}
      onMyPage={() => setView('mypage')}
      onEnterTalkshow={() => setView('talkshow')}
      onEnterWerewolf={() => setView('werewolf')}
      onEnterBar={() => setView('bar')}
      onEnterLibrary={() => setView('library')}
      onEnterGym={() => setView('gym')}
      onEnterSceneStudio={() => { setSceneStudioId(undefined); setView('scene-studio') }}
      onMyScenes={() => setView('my-scenes')}
    />
  }

  // ===== 3D 分身工坊（全屏子工具，无顶栏） =====
  if (view === 'avatar') {
    return <AvatarStudio onBack={() => setView('court')} onEnterCourt={() => setView('court')} />
  }

  const navProps = {
    onNavigate: navigate,
  }

  // ===== 案卷库（独立全屏页：顶部仅一个返回按钮，不再叠全局导航；返回回到来路页） =====
  if (view === 'archive') {
    return <ArchivePage archives={archives} loading={archiveLoading} error={archiveError}
        onBack={() => setView(archiveOriginRef.current)} onCourt={() => setView('court')} onRefresh={() => void fetchArchives()}
        onOpenCase={(record) => { setCaseText(record.input); setView('court') }}
        onDelete={async (record) => { try { await fetch(`/api/cases/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('删除案卷失败') } }}
        onClear={async () => { try { await fetch('/api/archives', { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('清空案卷失败') } }} />
  }

  // ===== 角色馆（懒加载） =====
  if (view === 'characters') {
    return <>
      <TopNav {...navProps} currentView="characters" />
      <LazyScene component={CharacterHall} label="角色馆"
        props={{
          onBack: () => setView('entry'),
          onEnterCourt: () => setView('court'),
          onPlaza: () => setView('plaza'),
          onCreateCharacter: () => setView('custom-studio'),
          onEnterScene: (sceneId: string) => {
            if (sceneId === 'court') setView('court')
            else if (sceneId === 'plaza') setView('plaza')
            else if (sceneId === 'gym' || sceneId === 'bar' || sceneId === 'library' || sceneId === 'talkshow' || sceneId === 'werewolf') setView(sceneId as View)
          },
        }} />
    </>
  }

  // ===== 自定义人物创建向导（懒加载） =====
  if (view === 'custom-studio') {
    return <>
      <TopNav {...navProps} currentView="characters" />
      <LazyScene component={CustomCharacterStudio} label="创建自定义人物"
        props={{ onBack: () => setView('entry'), onViewCharacter: () => setView('characters') }} />
    </>
  }

  // ===== 广场（懒加载） =====
  if (view === 'plaza') {
    return <>
      <TopNav {...navProps} currentView="plaza" />
      <LazyScene component={Plaza3D} label="广场"
        props={{
          onBack: () => setView('entry'),
          onEnterCourt: () => setView('court'),
          onEnterTalkshow: () => setView('talkshow'),
          onEnterWerewolf: () => setView('werewolf'),
          onEnterBar: () => setView('bar'),
          onEnterLibrary: () => setView('library'),
          onEnterGym: () => setView('gym'),
        }} />
    </>
  }

  // ===== M8: 脱口秀剧场 =====
  if (view === 'talkshow') {
    return <>
      <TopNav {...navProps} currentView="talkshow" />
      <LazyScene component={TalkshowShell} label="脱口秀剧场"
        props={{ onBack: () => setView('entry'), onPlaza: () => setView('plaza') }} />
    </>
  }

  // ===== M9: 狼人杀馆 =====
  if (view === 'werewolf') {
    return <>
      <TopNav {...navProps} currentView="werewolf" />
      <LazyScene component={WerewolfShell} label="狼人杀馆"
        props={{ onBack: () => setView('entry'), onPlaza: () => setView('plaza') }} />
    </>
  }

  // ===== M8: 酒吧辩论 =====
  if (view === 'bar') {
    return <>
      <TopNav {...navProps} currentView="bar" />
      <LazyScene component={BarShell} label="酒吧辩论"
        props={{ onBack: () => setView('entry'), onPlaza: () => setView('plaza') }} />
    </>
  }

  // ===== M8: 图书馆 =====
  if (view === 'library') {
    return <>
      <TopNav {...navProps} currentView="library" />
      <LazyScene component={LibraryShell} label="图书馆"
        props={{ onBack: () => setView('entry'), onPlaza: () => setView('plaza') }} />
    </>
  }

  // ===== M11: 健身房 =====
  if (view === 'gym') {
    return <>
      <TopNav {...navProps} currentView="gym" />
      <LazyScene component={GymShell} label="健身房"
        props={{ onBack: () => setView('entry'), onPlaza: () => setView('plaza') }} />
    </>
  }

  // ===== 场景创作工作室（三步向导，懒加载） =====
  if (view === 'scene-studio') {
    return <>
      <TopNav {...navProps} currentView="scene-studio" />
      <LazyScene component={SceneStudio} label="创造世界"
        props={{
          onBack: () => setView(sceneStudioId ? 'my-scenes' : 'entry'),
          sceneId: sceneStudioId,
          onPublished: (id: string) => { setScenePlayId(id); setView('scene-play') },
        }} />
    </>
  }

  // ===== 我的场景列表（懒加载） =====
  if (view === 'my-scenes') {
    return <>
      <TopNav {...navProps} currentView="my-scenes" />
      <LazyScene component={MyScenes} label="我的场景"
        props={{
          onBack: () => setView('entry'),
          onEdit: (id?: string) => { setSceneStudioId(id); setView('scene-studio') },
          onPlay: (id: string) => { setScenePlayId(id); setView('scene-play') },
        }} />
    </>
  }

  // ===== 场景运行时播放（全屏，无 TopNav） =====
  if (view === 'scene-play' && scenePlayId) {
    return <LazyScene component={ScenePlay} label="场景播放"
      props={{ sceneId: scenePlayId, onBack: () => setView('my-scenes') }} />
  }

  // ===== 我的 =====
  if (view === 'mypage') {
    return <>
      <TopNav {...navProps} currentView="mypage" />
      <MyPage onBack={() => setView('entry')} onCourt={(input) => { if (input) setCaseText(input); setView('court') }} onPlaza={() => setView('plaza')} onVideo={() => setView('video')} onEnterGym={() => setView('gym')} onCustomCharacter={() => setView('custom-studio')} onAvatarStudio={() => setView('avatar')} onArchive={() => openArchives('mypage')} />
    </>
  }

  // ===== 视频工坊 =====
  if (view === 'video') {
    return <>
      <TopNav {...navProps} currentView="video" />
      <VideoStudio onBack={() => setView('court')} />
    </>
  }

  // ===== 默认：庭审（合议庭）——法庭自带 court-topbar（退出法庭/案卷库），不再叠加全局导航 =====
  return (
    <main className="app-shell">
      <ApiHealthBanner />
      <CourtroomShell
        caseText={caseText} onCaseTextChange={setCaseText}
        hearingMode={hearingMode} onHearingModeChange={setHearingMode}
        perspective={perspective} onPerspectiveChange={setPerspective}
        evidenceFiles={evidenceFiles} onEvidenceFilesChange={setEvidenceFiles}
        onOpenAvatarStudio={() => setView('avatar')}
        onPublishToPlaza={() => setView('plaza')}
        roomId={roomId ?? undefined}
        onExitToEntry={() => setView('entry')}
        onOpenArchive={() => openArchives('court')}
      />
    </main>
  )
}

/**
 * Lightweight non-blocking backend health probe. On failure shows a fixed yellow
 * overlay bar (portal to body) and retries every 5s; clicking the bar retries immediately.
 */
function ApiHealthBanner() {
  const [down, setDown] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 3000)
    fetch('/api/health', { signal: controller.signal })
      .then((res) => { if (!cancelled) setDown(!res.ok) })
      .catch(() => { if (!cancelled) setDown(true) })
      .finally(() => window.clearTimeout(timer))
    return () => { cancelled = true; controller.abort() }
  }, [retryTick])
  useEffect(() => {
    if (!down) return
    const id = window.setInterval(() => setRetryTick((n) => n + 1), 5000)
    return () => window.clearInterval(id)
  }, [down])
  if (!down) return null
  return createPortal(
    <div onClick={() => setRetryTick((n) => n + 1)}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#4fb3a5', color: '#1a1a1a', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
      后端未连接，正在重连…（点击立即重试）
    </div>,
    document.body,
  )
}

function App() {
  return (
    <IdentityProvider>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </IdentityProvider>
  )
}

export default App
