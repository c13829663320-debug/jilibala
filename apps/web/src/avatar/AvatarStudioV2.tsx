// ===== AvatarStudioV2：换装/配色/配饰 + 表情手势注视实时预览 =====
// 不改动既有 AvatarStudio（Tripo 生成流程），新建独立页面：
// 左侧 R3F 实时预览（AvatarController 驱动程序化人体 + OutfitLayer/AccessorySlot），
// 右侧换装面板（槽位穿戴/卸下 + 配色 + 6 套预设）+ 表情/手势/动画演示控制。
import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { ArrowLeft } from 'lucide-react'
import {
  OUTFIT_SLOTS, SLOT_LABELS, OUTFIT_CATALOG, getItem,
  createEmptyOutfit, equip, unequip, setSlotColor, applyOutfitSet,
  type OutfitSlot, type OutfitState,
} from './outfit-system'
import { AVATAR_PRESETS } from './avatar-presets'
import { OutfitLayer } from './OutfitLayer'
import { AccessorySlot } from './AccessorySlot'
import { ColorPicker } from './ColorPicker'
import { AvatarController } from './AvatarController'
import type { ProceduralExpression } from './procedural-expressions'
import { ALL_EXPRESSIONS } from './procedural-expressions'
import type { GestureType } from './gesture-system'
import { ALL_GESTURES } from './gesture-system'
import type { AnimState } from './animation-state-machine'

interface AvatarStudioV2Props {
  onBack: () => void
}

/** 预览用程序化人体：命名节点供 rig 探测（head/jaw/armL/armR） */
function PreviewAvatar({ skinColor, outfit }: { skinColor: string; outfit: OutfitState }) {
  return (
    <>
      {/* 腿 */}
      <mesh position={[-0.09, 0.39, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.78, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      <mesh position={[0.09, 0.39, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.78, 12]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      {/* 躯干 */}
      <mesh position={[0, 1.09, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.14, 0.62, 16]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>
      {/* 头（rig 命名节点） */}
      <group name="head" position={[0, 1.58, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.105, 16, 16]} />
          <meshStandardMaterial color={skinColor} roughness={0.6} />
        </mesh>
        <group name="jaw" position={[0, -0.06, 0.08]}>
          <mesh>
            <boxGeometry args={[0.1, 0.05, 0.12]} />
            <meshStandardMaterial color={skinColor} roughness={0.6} />
          </mesh>
        </group>
      </group>
      {/* 手臂（rig 命名节点） */}
      <group name="armL" position={[-0.24, 1.3, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <capsuleGeometry args={[0.05, 0.28, 4, 8]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
      </group>
      <group name="armR" position={[0.24, 1.3, 0]}>
        <mesh position={[0, -0.18, 0]}>
          <capsuleGeometry args={[0.05, 0.28, 4, 8]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
      </group>
      {/* 服装层 + 配饰 */}
      <OutfitLayer outfit={outfit} />
      <AccessorySlot slot="head" equipped={outfit.head} />
      <AccessorySlot slot="accessoryL" equipped={outfit.accessoryL} />
      <AccessorySlot slot="accessoryR" equipped={outfit.accessoryR} />
    </>
  )
}

export default function AvatarStudioV2({ onBack }: AvatarStudioV2Props) {
  const [outfit, setOutfit] = useState<OutfitState>(() => applyOutfitSet(createEmptyOutfit(), AVATAR_PRESETS[0].outfit))
  const [skinColor, setSkinColor] = useState(AVATAR_PRESETS[0].skinColor)
  const [selectedSlot, setSelectedSlot] = useState<OutfitSlot | null>(null)
  const [expression, setExpression] = useState<ProceduralExpression>('neutral')
  const [gesture, setGesture] = useState<GestureType>('none')
  const [animState, setAnimState] = useState<AnimState>('idle')

  const selected = selectedSlot ? outfit[selectedSlot] : undefined
  const slotItems = useMemo(
    () => (selectedSlot ? OUTFIT_CATALOG.filter((i) => i.slot === selectedSlot) : []),
    [selectedSlot],
  )

  const panelBtn: React.CSSProperties = {
    background: 'rgba(20,18,10,0.7)', color: '#ddd', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
  }

  return (
    <main style={{ display: 'flex', height: '100vh', background: '#0d0c08', color: '#eee' }}>
      {/* —— 左：3D 预览 —— */}
      <div style={{ flex: 1, position: 'relative' }}>
        <button onClick={onBack} style={{ ...panelBtn, position: 'absolute', top: 12, left: 12, zIndex: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> 返回
        </button>
        <Canvas shadows camera={{ position: [0, 1.6, 3.2], fov: 40 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 4, 3]} intensity={1.1} castShadow />
          <directionalLight position={[-2, 2, -2]} intensity={0.3} />
          <group position={[0, -0.9, 0]}>
            <AvatarController expression={expression} gesture={gesture} animationState={animState}>
              <PreviewAvatar skinColor={skinColor} outfit={outfit} />
            </AvatarController>
          </group>
          <OrbitControls target={[0, 0.6, 0]} enablePan={false} minDistance={2} maxDistance={6} />
        </Canvas>
      </div>

      {/* —— 右：面板 —— */}
      <aside style={{ width: 340, overflowY: 'auto', padding: 16, borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>换装工坊 <em style={{ color: '#4fb3a5' }}>Outfit Studio</em></h2>

        {/* 预设 */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>预设套装</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            {AVATAR_PRESETS.map((p) => (
              <button key={p.id} style={panelBtn} onClick={() => {
                setOutfit(applyOutfitSet(createEmptyOutfit(), p.outfit))
                setSkinColor(p.skinColor)
              }}>
                {p.emoji} {p.name}
              </button>
            ))}
          </div>
        </section>

        {/* 槽位 */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>槽位</div>
          {OUTFIT_SLOTS.map((slot) => {
            const eq = outfit[slot]
            return (
              <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <button
                  style={{ ...panelBtn, flex: 1, textAlign: 'left', borderColor: selectedSlot === slot ? '#4fb3a5' : undefined }}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {SLOT_LABELS[slot]}{eq ? `：${getItem(eq.itemId)?.name ?? eq.itemId}` : '：未穿戴'}
                </button>
                {eq && (
                  <button style={{ ...panelBtn, color: '#e88' }} onClick={() => setOutfit((o) => unequip(o, slot))}>卸</button>
                )}
              </div>
            )
          })}
        </section>

        {/* 选中槽位：选物品 + 配色 */}
        {selectedSlot && (
          <section style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>{SLOT_LABELS[selectedSlot]} · 选择物品</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {slotItems.map((item) => (
                <button key={item.id} style={panelBtn} onClick={() => setOutfit((o) => equip(o, selectedSlot, item.id))}>
                  {item.name}
                </button>
              ))}
            </div>
            {selected && (
              <ColorPicker color={selected.color} onChange={(c) => setOutfit((o) => setSlotColor(o, selectedSlot, c))} />
            )}
          </section>
        )}

        {/* 表情演示 */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>表情</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ALL_EXPRESSIONS.map((e) => (
              <button key={e} style={{ ...panelBtn, borderColor: expression === e ? '#4fb3a5' : undefined }} onClick={() => setExpression(e)}>{e}</button>
            ))}
          </div>
        </section>

        {/* 手势演示 */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>手势</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ALL_GESTURES.map((g) => (
              <button key={g} style={{ ...panelBtn, borderColor: gesture === g ? '#4fb3a5' : undefined }} onClick={() => setGesture(g)}>{g}</button>
            ))}
          </div>
        </section>

        {/* 动画演示 */}
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 6 }}>动画</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(['idle', 'talking', 'walking', 'running', 'wave'] as AnimState[]).map((s) => (
              <button key={s} style={{ ...panelBtn, borderColor: animState === s ? '#4fb3a5' : undefined }} onClick={() => setAnimState(s)}>{s}</button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  )
}
