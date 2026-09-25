// EvidencePicker：出「出示证据」牌时弹出己方已上传证据列表。
import type { EvidenceItem } from './types'

export default function EvidencePicker({
  open,
  evidence,
  onSelect,
  onClose,
}: {
  open: boolean
  evidence: EvidenceItem[]
  onSelect: (ev: EvidenceItem) => void
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="ev-picker__backdrop" onClick={onClose}>
      <div className="ev-picker" onClick={(e) => e.stopPropagation()}>
        <div className="ev-picker__head">
          <span>出示你的证据</span>
          <button className="ev-picker__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {evidence.length === 0 ? (
          <div className="ev-picker__empty">你还没有已上传的证据，可改为「攻击论点」。</div>
        ) : (
          <div className="ev-picker__list">
            {evidence.map((ev) => (
              <button key={ev.id} className="ev-picker__item" onClick={() => onSelect(ev)}>
                <b>{ev.name}</b>
                {ev.content && <span className="ev-picker__content">{ev.content}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
