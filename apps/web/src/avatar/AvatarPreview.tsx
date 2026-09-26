// ===== Round4 R4-03：化身 3D 预览面板 =====
// 进入房间前 / 人物馆选人后展示：可旋转查看、显示当前穿戴（换装分层结果）。
// 复用程序化胶囊模型（与广场远端化身一致的风格），按 outfit 各层色板上色。
// 云端无 GPU 时由 SafeCanvas 兜底降级；纯展示组件，无业务逻辑单测。
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { OutfitState } from '@balabala/shared'
import SafeCanvas from '../SafeCanvas'
import { LAYER_LABELS, getOptionMeta, OUTFIT_LAYERS } from './outfit-system'

/** 旋转展示的程序化化身（按 outfit 上色） */
function RotatingAvatar({ outfit }: { outfit: OutfitState }) {
  const group = useRef<THREE.Group>(null)
  const base = getOptionMeta(outfit, 'base').swatch
  const top = getOptionMeta(outfit, 'top').swatch
  const bottom = getOptionMeta(outfit, 'bottom').swatch
  const hair = getOptionMeta(outfit, 'hair').swatch
  const acc = getOptionMeta(outfit, 'accessory')
  const hasTop = top !== 'transparent'
  const hasBottom = bottom !== 'transparent'

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.6
  })

  return (
    <group ref={group} position={[0, -0.2, 0]}>
      {/* 身体（base 色） */}
      <mesh position={[0, 0.7, 0]}>
        <capsuleGeometry args={[0.28, 0.7, 8, 16]} />
        <meshStandardMaterial color={base} roughness={0.5} />
      </mesh>
      {/* 上衣（top 色，套在胸口） */}
      {hasTop && (
        <mesh position={[0, 0.85, 0]}>
          <capsuleGeometry args={[0.3, 0.35, 6, 12]} />
          <meshStandardMaterial color={top} roughness={0.6} />
        </mesh>
      )}
      {/* 下装（bottom 色，腰以下） */}
      {hasBottom && (
        <mesh position={[0, 0.35, 0]}>
          <capsuleGeometry args={[0.26, 0.35, 6, 12]} />
          <meshStandardMaterial color={bottom} roughness={0.7} />
        </mesh>
      )}
      {/* 头 */}
      <mesh position={[0, 1.35, 0]}>
        <sphereGeometry args={[0.24, 20, 20]} />
        <meshStandardMaterial color={base} roughness={0.5} />
      </mesh>
      {/* 头发（hair 色，罩在头顶） */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={hair} roughness={0.8} />
      </mesh>
      {/* 配饰（眼镜/帽子/背包，用一个简单立方体占位） */}
      {acc.id !== 'acc-none' && (
        <mesh position={[0, 1.35, 0.24]}>
          <boxGeometry args={[0.2, 0.05, 0.05]} />
          <meshStandardMaterial color={acc.swatch} roughness={0.4} metalness={0.2} />
        </mesh>
      )}
    </group>
  )
}

export interface AvatarPreviewProps {
  /** 当前穿戴 */
  outfit: OutfitState
  /** 面板标题 */
  title?: string
  /** 宽高（CSS px） */
  width?: number
  height?: number
  /** 是否自动旋转 */
  autoRotate?: boolean
}

/**
 * 3D 化身预览面板：旋转展示 + 当前穿戴清单。
 * 用法：进入房间前 / 人物馆选人后以浮层形式挂载。
 */
export default function AvatarPreview({
  outfit,
  title = '化身预览',
  width = 260,
  height = 320,
}: AvatarPreviewProps) {
  return (
    <div style={{ width, overflow: 'hidden', borderRadius: 14, background: '#111318', border: '1px solid #262a31' }}>
      <div style={{ padding: '8px 12px', fontSize: 13, color: '#cfd3da', borderBottom: '1px solid #22262d' }}>
        {title}
      </div>
      <div style={{ height: height - 96 }}>
        <SafeCanvas shadows camera={{ position: [0, 1.4, 3.2], fov: 40 }} dpr={[1, 1.5]}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 5, 4]} intensity={1.2} />
          <RotatingAvatar outfit={outfit} />
        </SafeCanvas>
      </div>
      {/* 当前穿戴清单 */}
      <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 11, color: '#9aa0aa' }}>
        {OUTFIT_LAYERS.map((layer) => (
          <div key={layer} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{LAYER_LABELS[layer]}</span>
            <span style={{ color: '#e6e9ee' }}>{getOptionMeta(outfit, layer).label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
