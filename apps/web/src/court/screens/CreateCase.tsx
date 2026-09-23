import { useState } from 'react'
import { ChevronRight, Upload, FileText, X, Sparkles, WandSparkles } from 'lucide-react'
import { CourtroomShell } from '../shared'
import type { Celebrity } from '@balabala/shared'

export type RawEvidence = { name: string; size: number; type: string }

type Props = {
  character?: Celebrity | null
  initialInput?: string
  initialEvidenceOpen?: boolean
  onSubmit: (input: { description: string; stance?: string; evidence: RawEvidence[] }) => void
  onExit: () => void
  onOpenArchive: () => void
  onSwitchToBench?: () => void
}

export default function CreateCase({ character: _character, initialInput, initialEvidenceOpen, onSubmit, onExit, onOpenArchive, onSwitchToBench }: Props) {
  const [description, setDescription] = useState(initialInput ?? '')
  const [stance, setStance] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(initialEvidenceOpen ?? false)
  const [evidence, setEvidence] = useState<RawEvidence[]>([])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files).map((f) => ({ name: f.name, size: f.size, type: f.type }))
    setEvidence((prev) => [...prev, ...next].slice(0, 8))
  }

  return (
    <CourtroomShell onExit={onExit} onOpenArchive={onOpenArchive} frostStrong>
      <div className="live-create">
        <div className="live-create__head">
          <span className="live-create__eyebrow">CASE CREATION</span>
          <h1>说一件生活里的<u>小事</u>。</h1>
          <p>客观描述发生了什么,AI 会帮你分析事实、提取争议点,并生成双方立场。</p>
        </div>

        <div className="live-create__field">
          <label className="live-create__label" htmlFor="desc">案件描述 · 客观叙述</label>
          <textarea id="desc" className="live-create__textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如:泡泡借走了阿布的彩虹伞,但下雨后伞变成了会唱歌的蘑菇。" maxLength={500} />
        </div>

        <div className="live-create__field">
          <label className="live-create__label" htmlFor="stance">我的立场(可选)</label>
          <input id="stance" className="live-create__input" value={stance} onChange={(e) => setStance(e.target.value)} placeholder="一句话,例如:我觉得泡泡应该负责修好它。" maxLength={60} />
        </div>

        <div className="live-create__field">
          <button className="live-create__evidence-toggle" onClick={() => setEvidenceOpen((v) => !v)}>
            <Upload size={15} /> 证据(可选){evidence.length > 0 && ` · ${evidence.length}`}
          </button>
          {evidenceOpen && (
            <div style={{ marginTop: 10 }}>
              <label className="live-create__dropzone">
                <Upload size={14} />
                <span>{evidence.length ? `已选 ${evidence.length} 份证据` : '添加图片、文档或文件'}</span>
                <input type="file" multiple accept="image/*,.pdf,.txt,.doc,.docx,.zip" onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = '' }} />
              </label>
              {evidence.length > 0 && (
                <div className="live-create__chips">
                  {evidence.map((f, i) => (
                    <span className="live-create__chip" key={`${f.name}-${i}`}>
                      <FileText size={11} />
                      <span title={f.name}>{f.name}</span>
                      <button onClick={() => setEvidence((prev) => prev.filter((_, idx) => idx !== i))}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button className="live-create__submit" disabled={!description.trim()} onClick={() => onSubmit({ description: description.trim(), stance: stance.trim() || undefined, evidence })}>
          <Sparkles size={16} /> 生成法庭 <ChevronRight size={16} />
        </button>

        {onSwitchToBench && (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button className="court-btn court-btn--ghost court-btn--sm" onClick={onSwitchToBench}>
              <WandSparkles size={14} /> 切换到名人合议庭模式
            </button>
          </div>
        )}
      </div>
    </CourtroomShell>
  )
}
