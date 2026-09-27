// ============================================================================
// SceneTemplatePicker —— 从模板创建：模板卡片网格弹窗
// ----------------------------------------------------------------------------
// 进入场景工作室时可「从模板创建」，展示 6 个内置模板；
// 点击卡片后把模板参数（光照/雾/地面/物体列表）预填回工作室。
// ============================================================================
import { useEffect, useState } from 'react'
import type { SceneTemplate } from '@balabala/shared'

interface SceneTemplatePickerProps {
  open: boolean
  onClose: () => void
  /** 选中模板，回传完整模板参数 */
  onSelect: (template: SceneTemplate) => void
}

/** GET /api/scene-templates —— 拉取内置模板列表。失败时返回空列表。 */
async function fetchTemplates(): Promise<SceneTemplate[]> {
  try {
    const res = await fetch('/api/scene-templates')
    if (!res.ok) throw new Error('bad')
    const data = await res.json() as { templates?: SceneTemplate[] }
    if (Array.isArray(data.templates) && data.templates.length > 0) return data.templates
  } catch {
    /* 降级到空列表 */
  }
  return []
}

export default function SceneTemplatePicker({ open, onClose, onSelect }: SceneTemplatePickerProps) {
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    fetchTemplates()
      .then((list) => { if (alive) setTemplates(list) })
      .catch(() => { if (alive) setTemplates([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open])

  if (!open) return null

  return (
    <div className="ss__modal-mask" onClick={onClose}>
      <div className="ss__modal tpl__modal" onClick={(e) => e.stopPropagation()}>
        <div className="ss__modal-head">
          <b>从模板创建场景</b>
          <button type="button" className="ss__iconbtn" onClick={onClose}>✕</button>
        </div>
        <div className="tpl__grid">
          {loading && <div className="ss__empty-hint">加载模板中…</div>}
          {!loading && templates.length === 0 && (
            <div className="ss__empty-hint">暂无可用模板</div>
          )}
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tpl__card"
              style={{ borderColor: t.color }}
              onClick={() => onSelect(t)}
            >
              <span className="tpl__thumb" style={{ background: `${t.color}22` }}>{t.thumbnail}</span>
              <b>{t.name}</b>
              <small>{t.description}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
