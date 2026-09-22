import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Float, Text } from '@react-three/drei'
import { ArrowLeft, ArrowRight, Bot, Eye, FileUp, Gavel, Mic2, Play, Scale, Sparkles, Users, Wifi } from 'lucide-react'
import { useRef } from 'react'
import * as THREE from 'three'
import './scene-detail.css'

export type SceneDetailProps = {
  onBack: () => void
  onStartHearing: (mode?: 'quick' | 'evidence') => void
}

function CourtPreview() {
  const gavel = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (gavel.current) gavel.current.rotation.z = Math.sin(clock.elapsedTime * 1.4) * 0.12
  })
  return <>
    <color attach="background" args={['#0d0c0a']} />
    <fog attach="fog" args={['#0d0c0a', 7, 16]} />
    <ambientLight intensity={0.7} color="#ffe7ba" />
    <pointLight position={[-3, 4, 2]} intensity={16} distance={9} color="#ffb34d" />
    <pointLight position={[4, 3, 1]} intensity={12} distance={8} color="#f6c667" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow><planeGeometry args={[15, 10]} /><meshStandardMaterial color="#2a1710" roughness={0.8} /></mesh>
    <mesh position={[0, 2.5, -3]} castShadow><boxGeometry args={[9, 6.5, 0.25]} /><meshStandardMaterial color="#401b11" roughness={0.55} /></mesh>
    {[-3.8, -2.2, 2.2, 3.8].map((x) => <mesh key={x} position={[x, 1.8, -2.8]} castShadow><boxGeometry args={[0.14, 4.8, 0.22]} /><meshStandardMaterial color="#a7642e" metalness={0.22} /></mesh>)}
    <mesh position={[0, 0.15, -2.05]} castShadow><boxGeometry args={[4.8, 1.2, 1.05]} /><meshStandardMaterial color="#74351f" roughness={0.5} /></mesh>
    <mesh position={[0, 0.8, -2.05]} castShadow><boxGeometry args={[5.1, 0.18, 1.18]} /><meshStandardMaterial color="#c27a37" roughness={0.35} /></mesh>
    <mesh position={[-2.7, -0.05, -0.2]} castShadow><boxGeometry args={[2.3, 0.9, 1.1]} /><meshStandardMaterial color="#69301d" /></mesh>
    <mesh position={[2.7, -0.05, -0.2]} castShadow><boxGeometry args={[2.3, 0.9, 1.1]} /><meshStandardMaterial color="#69301d" /></mesh>
    <Float speed={2} floatIntensity={0.12} rotationIntensity={0.1}><group ref={gavel} position={[0, 1.38, -2.62]} rotation={[0, 0, -0.15]}><mesh castShadow><cylinderGeometry args={[0.08, 0.08, 0.55, 16]} /><meshStandardMaterial color="#d49842" metalness={0.65} /></mesh><mesh position={[0, 0.27, 0]} castShadow><boxGeometry args={[0.42, 0.2, 0.2]} /><meshStandardMaterial color="#e8b45d" metalness={0.5} /></mesh></group></Float>
    <Text position={[0, 3.18, -2.83]} fontSize={0.27} color="#f5c241" anchorX="center" anchorY="middle">趣味法庭 · BALA BALA</Text>
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 2.9} maxPolarAngle={Math.PI / 2.05} />
  </>
}

export default function SceneDetail({ onBack, onStartHearing }: SceneDetailProps) {
  return <main className="scene-detail">
    <header className="scene-detail__topbar"><button className="scene-detail__back" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回场景</button><div className="scene-detail__brand"><span className="scene-detail__mark" />BalaBala</div><span className="scene-detail__status"><i /> 场景在线</span></header>
    <div className="scene-detail__body">
      <section className="scene-detail__intro"><span className="scene-detail__eyebrow">SCENE 01 · SOCIAL COURTROOM</span><h1>趣味法庭</h1><p>把生活里的小争议搬上 3D 法庭，让 AI 法官、数字分身和围观好友一起把事实说清楚。</p><div className="scene-detail__stats"><span><Users size={14} /> 1,248 人正在围观</span><span><Wifi size={14} /> 平均 12 分钟</span><span><Sparkles size={14} /> AI 辅助裁决</span></div><div className="scene-detail__actions"><button className="scene-detail__primary" type="button" onClick={() => onStartHearing('quick')}><Play size={16} fill="currentColor" /> 快速开庭 <ArrowRight size={16} /></button><button className="scene-detail__secondary" type="button" onClick={() => onStartHearing('evidence')}><FileUp size={16} /> 带证据开庭</button></div></section>
      <section className="scene-detail__preview"><div className="scene-detail__canvas"><Canvas shadows camera={{ position: [7, 4.6, 8], fov: 37 }} dpr={[1, 1.7]}><CourtPreview /></Canvas><div className="scene-detail__canvas-label"><Gavel size={13} /> 可旋转预览 · 法庭准备就绪</div></div></section>
      <section className="scene-detail__content"><div className="scene-detail__feature"><span className="scene-detail__eyebrow">HOW IT WORKS</span><h2>一场友善的生活审判</h2><div className="scene-detail__feature-grid"><article><span className="feature-icon feature-icon--yellow"><Scale size={18} /></span><b>选择你的视角</b><p>原告、被告或中立观众，AI 会自动生成另一方的数字分身。</p></article><article><span className="feature-icon feature-icon--purple"><Bot size={18} /></span><b>多轮 AI 辩论</b><p>文字和语音都能发言，庭审中还可以随时补充新证据。</p></article><article><span className="feature-icon feature-icon--green"><Gavel size={18} /></span><b>生成趣味判决</b><p>AI 法官根据证据和观点裁决，生成可分享的专属案卷。</p></article></div></div><aside className="scene-detail__roles"><span className="scene-detail__eyebrow">WHO IS IN COURT</span><h3>本场角色</h3><div className="role-row"><div><span className="role-avatar role-avatar--judge">L</span><b>AI 法官 Luna</b><small>中立裁决</small></div><div><span className="role-avatar role-avatar--opponent">A</span><b>AI 对手</b><small>由案件生成</small></div><div><span className="role-avatar role-avatar--audience"><Eye size={15} /></span><b>观众</b><small>围观站队</small></div></div><button type="button" className="scene-detail__voice"><Mic2 size={14} /> 支持文字与语音互动</button></aside></section>
    </div>
  </main>
}
