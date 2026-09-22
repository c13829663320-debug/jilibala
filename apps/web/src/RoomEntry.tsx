import { useMemo, useState, type CSSProperties } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import './room-entry.css'

export type RoomEntryProps = {
  onEnter: () => void
  onSceneDetail?: () => void
  onArchive: () => void
  onAvatar: () => void
  onCharacters?: () => void
}

type Mode = 'characters' | 'scenes' | 'community'
type Item = { id: string; label: string; eyebrow: string; hint: string; color: string; locked?: boolean }

const CHARACTERS: Item[] = [
  { id: 'luna', label: 'Luna', eyebrow: 'JUDGE', hint: '月光法官', color: '#ffc83d' },
  { id: 'abu', label: '阿布', eyebrow: 'DEBATER', hint: '彩虹辩手', color: '#ff5b61' },
  { id: 'bobo', label: '泡泡', eyebrow: 'EVIDENCE', hint: '证据收藏家', color: '#357be8' },
  { id: 'mimi', label: '米米', eyebrow: 'MEDIATOR', hint: '和事佬', color: '#11c99a' },
  { id: 'qiuqiu', label: '球球', eyebrow: 'DETECTIVE', hint: '问题侦探', color: '#f18820' },
  { id: 'xingxing', label: '星星', eyebrow: 'VISITOR', hint: '星际访客', color: '#7e52c7' },
]

const SCENES: Item[] = [
  { id: 'court', label: '趣味法庭', eyebrow: 'SCENE 01 · ONLINE', hint: '当前可进入', color: '#ffc83d' },
  { id: 'talk', label: '脱口秀剧场', eyebrow: 'SCENE 02 · LOCKED', hint: '即将开放', color: '#ff5b61', locked: true },
  { id: 'werewolf', label: '狼人杀馆', eyebrow: 'SCENE 03 · LOCKED', hint: '即将开放', color: '#357be8', locked: true },
  { id: 'bar', label: '酒吧辩论赛', eyebrow: 'SCENE 04 · LOCKED', hint: '即将开放', color: '#11c99a', locked: true },
  { id: 'gym', label: '健身房', eyebrow: 'SCENE 05 · LOCKED', hint: '即将开放', color: '#f18820', locked: true },
  { id: 'library', label: '图书馆', eyebrow: 'SCENE 06 · LOCKED', hint: '即将开放', color: '#7e52c7', locked: true },
]

function Orb({ item, active, onClick, onHover }: { item: Item; active: boolean; onClick: () => void; onHover: () => void }) {
  const ref = useMemo(() => ({ current: null as THREE.Group | null }), [])
  const color = useMemo(() => new THREE.Color(item.color), [item.color])
  useFrame(({ clock }, delta) => {
    if (!ref.current) return
    const bob = Math.sin(clock.elapsedTime * 1.25 + item.id.length) * 0.045
    ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, (active ? 0.14 : 0) + bob, 1 - Math.exp(-delta * 6))
    ref.current.rotation.y += delta * (active ? 0.32 : 0.1)
  })
  return <group ref={ref} onPointerOver={(event) => { event.stopPropagation(); onHover() }} onClick={(event) => { event.stopPropagation(); onClick() }}>
    <mesh castShadow><sphereGeometry args={[0.68, 48, 32]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.6 : 0.25} roughness={0.25} /></mesh>
    <mesh position={[-0.2, 0.23, 0.49]} scale={0.72}><sphereGeometry args={[0.68, 32, 20]} /><meshBasicMaterial color="#fff7dd" transparent opacity={active ? 0.42 : 0.2} /></mesh>
    <pointLight color={item.color} intensity={active ? 3 : 1.7} distance={3.8} />
  </group>
}

function OrbScene({ items, activeId, onActivate, onHover }: { items: Item[]; activeId: string; onActivate: (item: Item) => void; onHover: (item: Item) => void }) {
  const positions: Array<[number, number, number]> = [[-5.1, 0, 0], [-3.05, 0, 0], [-1.02, 0, 0], [1.02, 0, 0], [3.05, 0, 0], [5.1, 0, 0]]
  return <Canvas camera={{ position: [0, 2.8, 12], fov: 31 }} dpr={[1, 1.7]} shadows>
    <color attach="background" args={['#080908']} /><fog attach="fog" args={['#080908', 9, 19]} />
    <ambientLight intensity={0.25} color="#b8c8cf" /><directionalLight position={[0, 6, 5]} intensity={1.25} color="#fff5dd" castShadow />
    {items.map((item, index) => <group key={item.id} position={positions[index]}><Orb item={item} active={activeId === item.id} onClick={() => onActivate(item)} onHover={() => onHover(item)} />{item.locked && <mesh position={[0, -0.78, 0]}><ringGeometry args={[0.42, 0.48, 32]} /><meshBasicMaterial color={item.color} transparent opacity={0.18} /></mesh>}</group>)}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.02, 0]} receiveShadow><planeGeometry args={[20, 8]} /><meshStandardMaterial color="#0b0d0c" roughness={0.96} /></mesh>
    <gridHelper args={[18, 34, '#191b17', '#10120f']} position={[0, -1, -0.2]} />
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 2.8} maxPolarAngle={Math.PI / 2.1} />
  </Canvas>
}

export default function RoomEntry({ onEnter, onSceneDetail, onArchive, onAvatar, onCharacters }: RoomEntryProps) {
  const [mode, setMode] = useState<Mode>('scenes')
  const [activeId, setActiveId] = useState('court')
  const [notice, setNotice] = useState('')
  const items = mode === 'characters' ? CHARACTERS : SCENES
  const active = items.find((item) => item.id === activeId) ?? items[0]
  const activate = (item: Item) => {
    setActiveId(item.id)
    if (mode === 'characters') { onCharacters?.(); return }
    if (item.id === 'court') { (onSceneDetail ?? onEnter)(); return }
    if (item.locked) setNotice(`${item.label} 尚未解锁，敬请期待`)
  }
  return <main className="main-home" aria-label="BalaBala 平台主界面">
    <header className="main-home__topbar">
      <button type="button" className="main-home__brand" onClick={() => setMode('scenes')}><span className="main-home__brand-mark" /><b>BalaBala</b></button>
      <nav className="main-home__nav" aria-label="平台模块导航">
        <button type="button" className={mode === 'characters' ? 'is-active' : ''} onClick={() => { setMode('characters'); setActiveId(CHARACTERS[0].id) }}>角色档案</button>
        <button type="button" className={mode === 'scenes' ? 'is-active' : ''} onClick={() => { setMode('scenes'); setActiveId('court') }}>场景</button>
        <button type="button" className={mode === 'community' ? 'is-active' : ''} onClick={() => { setMode('community'); setNotice('社区广场正在准备中'); }}>社区</button>
      </nav>
      <div className="main-home__account"><span>Lv.7</span><b>WY</b></div>
    </header>
    <section className="main-home__hero"><span className="main-home__kicker">BALA BALA SOCIAL WORLD</span><h1>{mode === 'characters' ? '认识你的角色，' : mode === 'scenes' ? '选择一个场景，' : '来到社区，'}<em>{mode === 'characters' ? '开始一段关系。' : mode === 'scenes' ? '开始你的故事。' : '看看大家的故事。'}</em></h1><p>{mode === 'characters' ? '浏览人物、创建分身，再把喜欢的角色带进任何场景。' : mode === 'scenes' ? '趣味法庭已上线，更多互动空间正在解锁。' : '分享判决、认识角色，和更多玩家一起玩。'}</p></section>
    {mode !== 'community' ? <><section className="main-home__scene" aria-label={mode === 'characters' ? '人物档案空间' : '场景空间'}><OrbScene items={items} activeId={activeId} onActivate={activate} onHover={(item) => setActiveId(item.id)} /><div className="main-home__scene-caption"><span>当前选择</span><strong style={{ color: active.color }}>{active.label}</strong><small>{active.hint}</small></div></section><section className="main-home__modules" aria-label="可选模块">{items.map((item) => <button type="button" key={item.id} className={activeId === item.id ? 'is-active' : ''} style={{ '--module-color': item.color } as CSSProperties} onMouseEnter={() => setActiveId(item.id)} onFocus={() => setActiveId(item.id)} onClick={() => activate(item)}><span>{item.eyebrow}</span><b>{item.label}</b><small>{item.hint}</small><i>{item.locked ? '🔒' : '↗'}</i></button>)}</section></> : <section className="main-home__community"><span>COMMUNITY · 社区</span><h2>这里会出现大家正在进行的庭审、角色和判决。</h2><p>社区功能将在趣味法庭和人物馆稳定后开放。</p><button type="button" onClick={() => setMode('scenes')}>返回场景</button></section>}
    {notice && <button type="button" className="main-home__notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
    <footer className="main-home__footer"><span>© 2025 BALABALA</span><span>{mode === 'scenes' ? '1 / 6 个场景已解锁' : mode === 'characters' ? '人物档案 · 6 个精选角色' : '社区即将开放'}</span></footer>
  </main>
}
