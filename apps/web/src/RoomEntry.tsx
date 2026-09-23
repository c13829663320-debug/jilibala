import { Suspense, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Vector3, type Group } from 'three'
import { ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, Dumbbell, Lock, Mic2, Moon, Wine, type LucideIcon } from 'lucide-react'
import './room-entry.css'

export type RoomEntryProps = {
  onEnter: () => void
  onArchive: () => void
  onAvatar: () => void
  onCharacters?: () => void
  onPlaza?: () => void
  onMyPage?: () => void
  onEnterTalkshow?: () => void
  onEnterWerewolf?: () => void
  onEnterBar?: () => void
  onEnterLibrary?: () => void
  onEnterGym?: () => void
}

type Item = { id: string; label: string; eyebrow: string; hint: string; color: string; locked?: boolean }


const SCENES: Item[] = [
  { id: 'court', label: '趣味法庭', eyebrow: 'SCENE 01 · ONLINE', hint: '当前可进入', color: '#ffc83d' },
  { id: 'talkshow', label: '脱口秀剧场', eyebrow: 'SCENE 02 · ONLINE', hint: '上台讲段子，AI 观众实时反应', color: '#ff5b61' },
  { id: 'werewolf', label: '狼人杀馆', eyebrow: 'SCENE 03 · ONLINE', hint: '夜晚圆桌，身份迷局，AI 名人陪玩', color: '#357be8' },
  { id: 'bar', label: '酒吧辩论赛', eyebrow: 'SCENE 04 · ONLINE', hint: '与名人围坐对辩，酒保总结金句', color: '#11c99a' },
  { id: 'gym', label: '健身房', eyebrow: 'SCENE 05 · ONLINE', hint: 'AI 教练 + 名人带练，多人云健身', color: '#f18820' },
  { id: 'library', label: '图书馆', eyebrow: 'SCENE 06 · ONLINE', hint: '名人读书会与深度问答', color: '#7e52c7' },
]

const SCENE_ICONS: Record<string, LucideIcon> = {
  talkshow: Mic2,
  werewolf: Moon,
  bar: Wine,
  gym: Dumbbell,
  library: BookOpen,
}

/** Q版卡通法院外观模型（带底座，明亮可辨），缩放到转盘友好的尺寸。 */
function CourtPreviewModel() {
  const { scene } = useGLTF('/models/buildings/court.glb', false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const scale = 2.6 / maxSize
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => { child.castShadow = true; child.receiveShadow = true })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

function SpinModel() {
  const spin = useRef<Group>(null)
  useFrame((_, delta) => { if (spin.current) spin.current.rotation.y += delta * 0.4 })
  return (
    <group ref={spin} position={[0, 0, 0]}>
      <Suspense fallback={null}><CourtPreviewModel /></Suspense>
    </group>
  )
}

function CourtCellCanvas() {
  return (
    <Canvas shadows camera={{ position: [3.2, 2.6, 4.6], fov: 36 }} dpr={[1, 1.5]}>
      <color attach="background" args={['#0e0c09']} />
      <ambientLight intensity={1.15} color="#ffe4bc" />
      <directionalLight position={[3, 6, 4]} intensity={2.1} color="#fff0d1" castShadow />
      <pointLight position={[-3, 3, 2]} intensity={7} distance={9} color="#ffae54" />
      <pointLight position={[3, 3, 2]} intensity={7} distance={9} color="#ffae54" />
      <SpinModel />
      <OrbitControls enablePan={false} enableZoom={false} target={[0, 1.1, 0]} minPolarAngle={0.5} maxPolarAngle={1.35} />
    </Canvas>
  )
}

type CarouselProps = {
  activeId: string
  onSelect: (id: string) => void
  onOpen: (scene: Item) => void
}

function ScenesCarousel({ activeId, onSelect, onOpen }: CarouselProps) {
  const cellRefs = useRef<Array<HTMLDivElement | null>>([])
  const scrollTo = (index: number) => {
    const clamped = Math.max(0, Math.min(SCENES.length - 1, index))
    onSelect(SCENES[clamped].id)
    cellRefs.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }
  const activeIndex = Math.max(0, SCENES.findIndex((s) => s.id === activeId))
  return (
    <div className="carousel">
      <button type="button" className="carousel-arrow" aria-label="上一个场景" onClick={() => scrollTo(activeIndex - 1)}><ChevronLeft size={18} /></button>
      <div className="carousel-viewport">
        {SCENES.map((scene, index) => {
          const isActive = activeId === scene.id
          const Icon = SCENE_ICONS[scene.id]
          return (
            <div
              key={scene.id}
              ref={(el) => { cellRefs.current[index] = el }}
              className={`carousel-cell ${isActive ? 'is-active' : ''} ${scene.locked ? 'is-locked' : ''}`}
              style={{ '--cell-color': scene.color } as CSSProperties}
              onClick={() => { onSelect(scene.id); onOpen(scene) }}
            >
              <div className="carousel-cell__media">
                {scene.id === 'court'
                  ? <CourtCellCanvas />
                  : Icon ? <Icon size={40} strokeWidth={1.4} style={{ color: scene.color }} /> : null}
              </div>
              <div className="carousel-cell__info">
                <span className="carousel-cell__eyebrow">{scene.eyebrow}</span>
                <b>{scene.label}</b>
                <small>{scene.locked ? '即将开放' : scene.hint}</small>
              </div>
              {scene.locked && <span className="carousel-cell__lock"><Lock size={13} /></span>}
            </div>
          )
        })}
      </div>
      <button type="button" className="carousel-arrow" aria-label="下一个场景" onClick={() => scrollTo(activeIndex + 1)}><ChevronRight size={18} /></button>
    </div>
  )
}

export default function RoomEntry({ onEnter, onArchive, onAvatar, onCharacters, onPlaza, onMyPage, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym }: RoomEntryProps) {
  const [activeId, setActiveId] = useState('court')
  const [notice, setNotice] = useState('')
  const items = SCENES
  const active = items.find((item) => item.id === activeId) ?? items[0]
  const openScene = (scene: Item) => {
    if (scene.id === 'court') { onEnter(); return }
    if (scene.id === 'talkshow') { onEnterTalkshow?.(); return }
    if (scene.id === 'werewolf') { onEnterWerewolf?.(); return }
    if (scene.id === 'bar') { onEnterBar?.(); return }
    if (scene.id === 'library') { onEnterLibrary?.(); return }
    if (scene.id === 'gym') { onEnterGym?.(); return }
    if (scene.locked) setNotice(`${scene.label} · 该场景即将开放`)
  }
  return <main className="main-home" aria-label="BalaBala 平台主界面">
    <header className="main-home__topbar">
      <button type="button" className="main-home__brand" onClick={() => setActiveId('court')}><img className="main-home__brand-mark" src="/brand/balabala-mark-clean.jpg" alt="BalaBala" /><span className="main-home__brand-text"><b>叽里呱啦</b><small>BALA BALA</small></span></button>
      <nav className="main-home__nav" aria-label="平台模块导航">
        <button type="button" onClick={() => onCharacters?.()}>角色档案</button>
        <button type="button" className="is-active" onClick={() => { setActiveId('court') }}>场景</button>
        <button type="button" onClick={() => onPlaza?.()}>广场</button>
        <button type="button" onClick={() => onMyPage?.()}>我的</button>
      </nav>
      <div className="main-home__account"><span>Lv.7</span><b>WY</b></div>
    </header>
    <section className="main-home__hero"><span className="main-home__kicker">BALA BALA SOCIAL WORLD</span><h1>选择一个场景，<em>开始你的故事。</em></h1><p>趣味法庭已上线，更多互动空间正在解锁。</p></section>
    <section className="main-home__scene" aria-label="场景空间">
      <ScenesCarousel activeId={activeId} onSelect={(id) => setActiveId(id)} onOpen={openScene} />
      <div className="main-home__scene-caption"><span>当前选择</span><strong style={{ color: active.color }}>{active.label}</strong><small>{active.locked ? '即将开放' : active.hint}</small></div>
    </section>
    <section className="main-home__modules" aria-label="快捷入口">{items.map((item) => { const QuickIcon = item.locked ? Lock : ArrowUpRight; return <button type="button" key={item.id} className={activeId === item.id ? 'is-active' : ''} style={{ '--module-color': item.color } as CSSProperties} onMouseEnter={() => setActiveId(item.id)} onFocus={() => setActiveId(item.id)} onClick={() => { setActiveId(item.id); openScene(item) }}><QuickIcon size={14} aria-hidden="true" /><b>{item.label}</b></button> })}</section>
    {notice && <button type="button" className="main-home__notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
    <footer className="main-home__footer"><span>© 2025 BALABALA</span><span>6 / 6 个场景已解锁</span></footer>
  </main>
}