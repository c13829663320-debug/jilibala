/**
 * 开放世界 · 场景选择菜单（DOM 覆盖层）
 * ------------------------------------------------------------------
 * 按钮打开后列出 6 大场景，点击直接传送到对应建筑入口前。
 *
 * R5 分片C：首启用户 collapsed=true 时只显示推荐场景 + 「展开全部」，
 * 避免新手被一堆选项淹没；回归用户保持原样。
 */
import { useState } from 'react'
import { BUILDINGS } from './config'
import type { BuildingId } from './types'

interface SceneSelectProps {
  onTeleport: (x: number, z: number) => void
  /** 首启折叠：默认只露出推荐场景，其余收进「展开全部」。 */
  collapsed?: boolean
  /** 折叠模式下高亮/优先展示的推荐建筑 id。 */
  recommendedId?: BuildingId
}

export default function SceneSelect({ onTeleport, collapsed = false, recommendedId }: SceneSelectProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const recommended = recommendedId ? BUILDINGS.find((b) => b.id === recommendedId) : undefined
  // 折叠模式且未展开：只展示推荐项
  const showOnlyRecommended = collapsed && !expanded

  const list = showOnlyRecommended
    ? (recommended ? [recommended] : BUILDINGS.slice(0, 1))
    : BUILDINGS

  return (
    <>
      <button className="plaza-scene-btn" onClick={() => setOpen((v) => !v)}>
        {open ? '关闭' : '场景'}
      </button>
      {open && (
        <div className="plaza-scene-panel">
          <div className="plaza-scene-title">选择场景</div>
          {list.map((b) => (
            <button
              key={b.id}
              className="plaza-scene-item"
              onClick={() => {
                onTeleport(b.entranceX, b.entranceZ)
                setOpen(false)
              }}
            >
              <span>{b.emoji}</span> {b.name}
              {showOnlyRecommended && b.id === recommendedId && <em className="plaza-scene-rec">新手推荐</em>}
            </button>
          ))}
          {showOnlyRecommended && (
            <button className="plaza-scene-item" onClick={() => setExpanded(true)}>
              <span>⋯</span> 展开全部场景
            </button>
          )}
        </div>
      )}
    </>
  )
}
