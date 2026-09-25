import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Float, Text } from '@react-three/drei'
import { Gavel, Sparkles, Play, RotateCcw, Mic2, Scale, WandSparkles, Users, Clock3, ChevronRight, Check, Volume2 } from 'lucide-react'
import type { ThreeElements } from '@react-three/fiber'

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

function Courtroom() {
  return (
    <group>
      <color attach="background" args={['#15162d']} />
      <ambientLight intensity={1.8} color="#8f9dff" />
      <directionalLight position={[4, 7, 2]} intensity={3.8} color="#f8dfff" castShadow />
      <pointLight position={[-4, 3, 1]} intensity={18} distance={14} color="#4de9db" />
      <pointLight position={[4, 2, -3]} intensity={20} distance={14} color="#b87bff" />
      <Environment preset="city" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 16]} />
        <meshStandardMaterial color="#1f2141" roughness={0.64} metalness={0.18} />
      </mesh>
      <mesh position={[0, 3.5, -3.7]} receiveShadow>
        <boxGeometry args={[10, 7, 0.25]} />
        <meshStandardMaterial color="#252752" roughness={0.7} />
      </mesh>
      <mesh position={[0, 2.8, -3.45]}>
        <boxGeometry args={[4.3, 3.5, 0.18]} />
        <meshStandardMaterial color="#31336b" emissive="#181a40" emissiveIntensity={0.6} />
      </mesh>
      <Text position={[0, 3.1, -3.34]} fontSize={0.46} color="#fce5a7" anchorX="center" anchorY="middle" font="/fonts/Inter-Bold.woff" outlineWidth={0.008} outlineColor="#885a8f">BALA BALA</Text>

      <Bench position={[0, 1.15, -2.55]} scale={[1, 1, 1]} />
      <Desk position={[-2.6, 0.7, -0.2]} color="#593b78" label="原告" />
      <Desk position={[2.6, 0.7, -0.2]} color="#315d67" label="被告" />
      <Desk position={[0, 0.5, 1.9]} color="#523f6f" label="旁听席" scale={1.12} />
      <Avatar position={[0, 1.95, -2.38]} body="#ec9fca" head="#ffcba7" accent="#f4e0a5" name="Luna" />
      <Avatar position={[-2.6, 1.55, -0.1]} body="#7a5ed9" head="#ffd1b3" accent="#74f1de" name="泡泡" />
      <Avatar position={[2.6, 1.55, -0.1]} body="#3c9ea4" head="#f1b68e" accent="#ffcf71" name="阿布" />
      <Avatar position={[-1.15, 1.1, 2]} body="#f397b6" head="#f9d2bc" accent="#ffc66e" name="小星" scale={0.78} />
      <Avatar position={[1.15, 1.1, 2]} body="#f0b161" head="#9a5c43" accent="#bfe6f5" name="多多" scale={0.78} />
      <Float speed={2.6} rotationIntensity={0.18} floatIntensity={0.2}>
        <mesh position={[0, 4.8, -2.8]} rotation={[0, 0, Math.PI / 8]}>
          <icosahedronGeometry args={[0.36, 1]} />
          <meshStandardMaterial color="#f8d071" emissive="#be6b52" emissiveIntensity={0.45} />
        </mesh>
      </Float>
      <ContactShadows position={[0, 0.02, 0]} opacity={0.48} scale={12} blur={2.4} far={6} color="#08071d" />
    </group>
  )
}

function Bench({ position, scale = 1 }: { position: [number, number, number]; scale?: [number, number, number] | number }) {
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
  const [caseText, setCaseText] = useState('泡泡借走了阿布的彩虹伞，但下雨后伞变成了会唱歌的蘑菇。')
  const [phase, setPhase] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const currentPhase = phases[phase]

  const stats = useMemo(() => ({ witnesses: 3 + phase, minutes: 12 + phase * 4 }), [phase])

  const startHearing = () => {
    setIsPlaying(true)
    setPhase(0)
    setShowToast(true)
    window.setTimeout(() => setShowToast(false), 2200)
  }

  const reset = () => {
    setIsPlaying(false)
    setPhase(0)
    setCaseText('')
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><Gavel size={19} strokeWidth={2.7} /></div><div><div className="brand-name">叽里呱啦</div><div className="brand-sub">BALA BALA · SOCIAL COURT</div></div></div>
      <div className="top-actions"><span className="status-dot"><span className="dot" /> 房间 #0317 在线</span><button className="icon-button" title="重置体验" onClick={reset}><RotateCcw size={17} /></button><div className="avatar-chip">林<span>△</span></div></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="eyebrow"><Sparkles size={14} /> 今日趣味法庭</div>
        <h1>把小事说清楚，<br /><span>让快乐继续发生。</span></h1>
        <p className="intro">输入一个生活里的小小争议，和朋友一起进入 3D 法庭，探索每个人的可爱证词。</p>
        <label className="field-label" htmlFor="case">案件标题</label>
        <div className="textarea-wrap"><textarea id="case" value={caseText} onChange={e => setCaseText(e.target.value)} placeholder="例如：谁把最后一块小蛋糕吃掉了？" maxLength={120} /><span>{caseText.length}/120</span></div>
        <button className="primary-button" onClick={startHearing}><Play size={17} fill="currentColor" /> {isPlaying ? '继续庭审' : '快速开庭'}<ChevronRight size={17} /></button>
        <div className="hint-row"><WandSparkles size={14} /> AI 会把你的故事变成一场有趣的对话</div>
        <div className="divider" />
        <div className="section-title"><span>庭审进度</span><span className="phase-count">{phase + 1} / {phases.length}</span></div>
        <div className="phase-list">{phases.map((item, i) => <button className={`phase-item ${phase === i ? 'active' : ''} ${phase > i ? 'done' : ''}`} onClick={() => { setPhase(i); setIsPlaying(true) }} key={item.id}><span className={`phase-icon ${item.tone}`}>{phase > i ? <Check size={13} /> : i + 1}</span><span>{item.label}</span>{phase === i && <span className="live-pill">LIVE</span>}</button>)}</div>
        <div className="sidebar-footer"><div><Users size={15} /> {stats.witnesses} 位角色</div><div><Clock3 size={15} /> 约 {stats.minutes} 分钟</div></div>
      </aside>
      <section className="main-stage">
        <div className="stage-header"><div><div className="stage-kicker"><span className="tiny-dot" /> 正在进行 · {currentPhase.label}</div><h2>{caseText || '等待一个新案件'}</h2></div><div className="stage-tools"><span className="scene-tag">3D 场景 · 趣味法庭</span><button className="round-button" title="语音模式"><Volume2 size={17} /></button></div></div>
        <div className="scene-card"><Canvas shadows camera={{ position: [7, 5.2, 8], fov: 38 }} dpr={[1, 2]}><Courtroom /><OrbitControls enablePan={false} minDistance={6} maxDistance={12} maxPolarAngle={Math.PI / 2.1} /></Canvas><div className="scene-overlay"><div className="camera-hint">拖动旋转 · 滚轮缩放</div><div className="scene-corner"><Scale size={13} /> 友善模式已开启</div></div></div>
        <div className="below-grid">
          <div className="dialogue-card"><div className="card-heading"><div><span className="micro-label">当前发言</span><h3>{currentPhase.speaker}</h3></div><button className="listen-button"><Mic2 size={15} /> 播放台词</button></div><div className={`quote quote-${currentPhase.tone}`}><span className="quote-mark">“</span>{currentPhase.quote}<span className="quote-mark end">”</span></div><div className="stepper">{phases.map((item, i) => <button aria-label={item.label} key={item.id} className={`step ${i === phase ? 'current' : ''} ${i < phase ? 'passed' : ''}`} onClick={() => setPhase(i)} />)}</div></div>
          <div className="verdict-card"><div className="verdict-top"><div className="verdict-icon"><Gavel size={18} /></div><div><span className="micro-label">AI 判决书 · 草稿</span><h3>{phase === phases.length - 1 ? '友谊大于输赢' : '等待全部证词'}</h3></div><span className="draft-tag">{phase === phases.length - 1 ? '已生成' : '进行中'}</span></div><p>{phase === phases.length - 1 ? '双方各获得一枚“会唱歌的蘑菇”纪念章，彩虹伞由两人轮流使用。' : '完成四个庭审阶段后，这里会出现一份温柔又好玩的判决。'}</p><div className="verdict-progress"><span style={{ width: `${((phase + 1) / phases.length) * 100}%` }} /></div></div>
        </div>
      </section>
    </div>
    {showToast && <div className="toast"><Sparkles size={15} /> 场景已准备好，欢迎来到 BalaBala 法庭！</div>}
  </main>
}

export default App
