/**
 * 开放世界 · 建筑室内场景容器
 * ------------------------------------------------------------------
 * 包裹 SafeCanvas + InteriorShell + InteriorPlayer + UI 覆盖层（返回按钮/收集提示）。
 * 每座建筑的室内页面直接使用此容器，传入 buildingId 和专属家具 children。
 *
 * 用法（以法庭为例）：
 *   <InteriorScene buildingId="court" width={14} depth={12} onExit={...}>
 *     <CourtFurniture />
 *   </InteriorScene>
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ArrowLeft, Gem } from 'lucide-react'
import SafeCanvas from '../../SafeCanvas'
import { InteriorShell, buildInteriorColliders, type InteriorCollider } from './InteriorShell'
import InteriorPlayer from './InteriorPlayer'
import { collectItem, loadCollected, COLLECTIBLES, type CollectOutcome } from '../collectibles'
import { BUILDING_THEME } from '../art-spec'

interface InteriorSceneProps {
  buildingId: string
  width: number
  depth: number
  height?: number
  onExit: () => void
  /** 建筑中文名（顶部栏显示） */
  buildingName: string
  /** 各建筑专属家具的 AABB 碰撞体（追加在四壁之后），可选 */
  extraColliders?: InteriorCollider[]
  children?: React.ReactNode
}

export default function InteriorScene({
  buildingId, width, depth, height = 5, onExit, buildingName, extraColliders, children,
}: InteriorSceneProps) {
  const playerPos = useRef({ x: 0, y: 0, z: depth / 2 - 2 })
  const [collectedSet, setCollectedSet] = useState<Set<string>>(() => loadCollected())
  const [toast, setToast] = useState<string>('')
  const [xpToast, setXpToast] = useState<string>('')
  const theme = BUILDING_THEME[buildingId] ?? BUILDING_THEME.court

  const colliders = useMemo<InteriorCollider[]>(
    () => [...buildInteriorColliders(width, depth), ...(extraColliders ?? [])],
    [width, depth, extraColliders],
  )

  const handleCollect = useCallback((id: string) => {
    const result: CollectOutcome | null = collectItem(id)
    if (!result || !result.collected) return
    setCollectedSet(new Set(loadCollected()))
    setToast(`✨ 获得「${result.collectible.name}」`)
    setXpToast(`+${result.xpEarned} XP${result.achievementUnlocked ? ' 🏆 成就解锁!' : ''}`)
    window.setTimeout(() => { setToast(''); setXpToast('') }, 2500)
  }, [])

  // 监听全局收集事件（其他场景收集时同步状态）
  useEffect(() => {
    const handler = () => setCollectedSet(new Set(loadCollected()))
    window.addEventListener('balabala:collectible', handler)
    return () => window.removeEventListener('balabala:collectible', handler)
  }, [])

  const sceneCollectibles = COLLECTIBLES.filter((c) => c.scene === buildingId)
  const sceneCollected = sceneCollectibles.filter((c) => collectedSet.has(c.id)).length

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#0a0a0a' }}>
      <SafeCanvas camera={{ position: [0, 4, 8], fov: 60, near: 0.1, far: 100 }} dpr={[1, 1.5]}>
        <InteriorShell
          buildingId={buildingId}
          width={width}
          depth={depth}
          height={height}
          onExit={onExit}
          playerPos={playerPos.current}
          collectedSet={collectedSet}
          onCollect={handleCollect}
        >
          {children}
        </InteriorShell>
        <InteriorPlayer
          playerPos={playerPos.current}
          colliders={colliders}
          halfWidth={width / 2}
          halfDepth={depth / 2}
          spawn={{ x: 0, z: depth / 2 - 2 }}
        />
      </SafeCanvas>

      {/* 顶部栏 */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(10,10,10,0.85)', padding: '8px 16px',
        borderBottom: `2px solid ${theme.primary}`,
      }}>
        <button onClick={onExit} style={{
          background: 'transparent', border: '1px solid #555', borderRadius: 6,
          color: '#fff', padding: '4px 10px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 4, fontSize: 13,
        }}>
          <ArrowLeft size={14} /> 返回广场
        </button>
        <span style={{ color: theme.primary, fontWeight: 700, fontSize: 16 }}>{buildingName}</span>
        <span style={{ marginLeft: 'auto', color: '#999', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Gem size={12} /> 收集 {sceneCollected}/{sceneCollectibles.length}
        </span>
      </div>

      {/* 操作提示 */}
      <div style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)', color: '#aaa', padding: '6px 14px',
        borderRadius: 8, fontSize: 12, zIndex: 100,
      }}>
        WASD 移动 · Q/E 旋转视角 · 走近发光门返回广场 · 靠近水晶自动拾取
      </div>

      {/* 收集 toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,10,10,0.9)', border: `1px solid ${theme.primary}`,
          color: '#fff', padding: '10px 20px', borderRadius: 10, zIndex: 200,
          textAlign: 'center', animation: 'fadeIn 0.3s',
        }}>
          <div style={{ fontWeight: 700 }}>{toast}</div>
          {xpToast && <div style={{ color: '#FFD600', fontSize: 13, marginTop: 2 }}>{xpToast}</div>}
        </div>
      )}
    </div>
  )
}
