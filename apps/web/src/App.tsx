import { lazy, Suspense, useEffect, useState } from 'react'
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

const CharacterHall = lazy(() => import('./CharacterHall'))
const Plaza3D = lazy(() => import('./Plaza3D'))
const TalkshowShell = lazy(() => import('./TalkshowShell'))
const BarShell = lazy(() => import('./BarShell'))
const LibraryShell = lazy(() => import('./LibraryShell'))

type HearingMode = 'quick' | 'evidence'
type View = TopView | 'entry' | 'avatar' | 'talkshow' | 'bar' | 'library'/**
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
      style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#FFD600', color: '#1a1a1a', padding: '8px 16px', fontSize: 13, fontWeight: 600, textAlign: 'center', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}>
      后端未连接，正在重连…（点击立即重试）
    </div>,
    document.body,
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
    return 'entry'
  })
  const [roomId] = useState<string | null>(() => parseRoomParam())
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

  const reset = () => {
    setCaseText(''); setHearingMode('quick'); setPerspective('audience'); setEvidenceFiles([])
    setView('court')
  }

  const navigate = (next: TopView) => setView(next)
  const openArchives = () => { void fetchArchives(); setView('archive') }

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
      onArchive={openArchives}
      onAvatar={() => setView('avatar')}
      onCharacters={() => setView('characters')}
      onPlaza={() => setView('plaza')}
      onMyPage={() => setView('mypage')}
      onEnterTalkshow={() => setView('talkshow')}
      onEnterBar={() => setView('bar')}
      onEnterLibrary={() => setView('library')}
    />
  }

  // ===== 3D 分身工坊（全屏子工具，无顶栏） =====
  if (view === 'avatar') {
    return <AvatarStudio onBack={() => setView('court')} onEnterCourt={() => setView('court')} />
  }

  const navProps = {
    onNavigate: navigate,
    onOpenArchive: openArchives,
    onReset: reset,
  }

  // ===== 案卷库 =====
  if (view === 'archive') {
    return <>
      <TopNav {...navProps} currentView="archive" />
      <ArchivePage archives={archives} loading={archiveLoading} error={archiveError}
        onBack={() => setView('court')} onCourt={() => setView('court')} onRefresh={() => void fetchArchives()}
        onOpenCase={(record) => { setCaseText(record.input); setView('court') }}
        onDelete={async (record) => { try { await fetch(`/api/cases/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('删除案卷失败') } }}
        onClear={async () => { try { await fetch('/api/archives', { method: 'DELETE' }); await fetchArchives() } catch { setArchiveError('清空案卷失败') } }} />
    </>
  }

  // ===== 角色馆（懒加载） =====
  if (view === 'characters') {
    return <>
      <TopNav {...navProps} currentView="characters" />
      <Suspense fallback={null}><CharacterHall onBack={() => setView('entry')} onEnterCourt={() => setView('court')} onPlaza={() => setView('plaza')} /></Suspense>
    </>
  }

  // ===== 广场（懒加载） =====
  if (view === 'plaza') {
    return <>
      <TopNav {...navProps} currentView="plaza" />
      <Suspense fallback={null}><Plaza3D
        onBack={() => setView('entry')}
        onEnterCourt={() => setView('court')}
        onEnterTalkshow={() => setView('talkshow')}
        onEnterBar={() => setView('bar')}
        onEnterLibrary={() => setView('library')}
      /></Suspense>
    </>
  }

  // ===== M8: 脱口秀剧场 =====
  if (view === 'talkshow') {
    return <>
      <TopNav {...navProps} currentView="talkshow" />
      <Suspense fallback={null}><TalkshowShell onBack={() => setView('entry')} onPlaza={() => setView('plaza')} /></Suspense>
    </>
  }

  // ===== M8: 酒吧辩论 =====
  if (view === 'bar') {
    return <>
      <TopNav {...navProps} currentView="bar" />
      <Suspense fallback={null}><BarShell onBack={() => setView('entry')} onPlaza={() => setView('plaza')} /></Suspense>
    </>
  }

  // ===== M8: 图书馆 =====
  if (view === 'library') {
    return <>
      <TopNav {...navProps} currentView="library" />
      <Suspense fallback={null}><LibraryShell onBack={() => setView('entry')} onPlaza={() => setView('plaza')} /></Suspense>
    </>
  }

  // ===== 我的 =====
  if (view === 'mypage') {
    return <>
      <TopNav {...navProps} currentView="mypage" />
      <MyPage onBack={() => setView('entry')} onCourt={(input) => { if (input) setCaseText(input); setView('court') }} onPlaza={() => setView('plaza')} onVideo={() => setView('video')} />
    </>
  }

  // ===== 视频工坊 =====
  if (view === 'video') {
    return <>
      <TopNav {...navProps} currentView="video" />
      <VideoStudio onBack={() => setView('court')} />
    </>
  }

  // ===== 默认：庭审（合议庭） =====
  return (
    <main className="app-shell">
      <ApiHealthBanner />
      <TopNav {...navProps} currentView="court" inCourtroom />
      <CourtroomShell
        caseText={caseText} onCaseTextChange={setCaseText}
        hearingMode={hearingMode} onHearingModeChange={setHearingMode}
        perspective={perspective} onPerspectiveChange={setPerspective}
        evidenceFiles={evidenceFiles} onEvidenceFilesChange={setEvidenceFiles}
        onOpenAvatarStudio={() => setView('avatar')}
        onPublishToPlaza={() => setView('plaza')}
        roomId={roomId ?? undefined}
      />
    </main>
  )
}

function App() {
  return (
    <IdentityProvider>
      <AppInner />
    </IdentityProvider>
  )
}

export default App
