// ============================================================================
// PropPanel —— 场景工作室「道具」面板
// ----------------------------------------------------------------------------
// 从 CC0 道具库选择道具 → 点击场景地面放置；
// 已放置道具可选中 / 移动 / 旋转 / 删除（数据随场景保存/加载）。
// ============================================================================
import { useState } from 'react'
import type { PlacedProp, PropDefinition } from '@balabala/shared'
import { PROP_LIBRARY, getPropById } from '../props/prop-library'

interface PropPanelProps {
  /** 已放置道具列表 */
  placed: PlacedProp[]
  /** 选中某道具 */
  selectedInstanceId: string | null
  onSelect: (instanceId: string | null) => void
  /** 从库中点选一个道具（进入「放置模式」，再点地面落地） */
  onPick: (prop: PropDefinition) => void
  /** 删除已放置道具 */
  onRemove: (instanceId: string) => void
  /** 旋转已放置道具（绕 Y 轴 +45°） */
  onRotate: (instanceId: string) => void
  /** 当前处于放置模式的道具 id（高亮提示） */
  placingPropId: string | null
}

export default function PropPanel({
  placed,
  selectedInstanceId,
  onSelect,
  onPick,
  onRemove,
  onRotate,
  placingPropId,
}: PropPanelProps) {
  const [filter, setFilter] = useState<'all' | PropDefinition['category']>('all')

  const shown = PROP_LIBRARY.filter((p) => filter === 'all' || p.category === filter)

  return (
    <div className="pp__root">
      <div className="pp__filters">
        {(['all', 'furniture', 'decor', 'interactive'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={`pp__filter ${filter === c ? 'is-active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {c === 'all' ? '全部' : c === 'furniture' ? '家具' : c === 'decor' ? '装饰' : '互动'}
          </button>
        ))}
      </div>

      <div className="pp__grid">
        {shown.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`pp__prop ${placingPropId === p.id ? 'is-placing' : ''}`}
            title={p.pickable ? `${p.name}（可拾取）` : p.name}
            onClick={() => onPick(p)}
          >
            <span className="pp__prop-emoji">{p.emoji}</span>
            <small>{p.name}</small>
            {p.pickable && <span className="pp__pickable-dot" title="可拾取" />}
          </button>
        ))}
      </div>

      <div className="pp__placed">
        <label className="pp__placed-title">已放置（{placed.length}）</label>
        {placed.length === 0 && <div className="ss__empty-hint">点上方道具，再点场景地面放置</div>}
        {placed.map((pp) => {
          const def = getPropById(pp.propId)
          return (
            <div
              key={pp.instanceId}
              className={`pp__placed-item ${selectedInstanceId === pp.instanceId ? 'is-selected' : ''}`}
              onClick={() => onSelect(pp.instanceId)}
            >
              <span>{def?.emoji ?? '📦'} {def?.name ?? pp.propId}</span>
              <span className="pp__placed-actions">
                <button type="button" title="旋转" onClick={(e) => { e.stopPropagation(); onRotate(pp.instanceId) }}>⟳</button>
                <button type="button" title="删除" onClick={(e) => { e.stopPropagation(); onRemove(pp.instanceId) }}>🗑</button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
