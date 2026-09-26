import { useEffect, useState } from 'react'
import { ChevronRight, Upload, FileText, X, Sparkles, WandSparkles, Scale, Shield } from 'lucide-react'
import { CourtroomShell } from '../shared'
import type { Celebrity } from '@balabala/shared'

export type RawEvidence = { name: string; size: number; type: string }
export type PlayerSide = 'plaintiff' | 'defendant'

type Props = {
  character?: Celebrity | null
  initialInput?: string
  initialEvidenceOpen?: boolean
  onSubmit: (input: { description: string; stance?: string; evidence: RawEvidence[]; playerSide: PlayerSide }) => void
  onQuickStart: (storyIndex: number, playerSide: PlayerSide) => void
  onExit: () => void
  onOpenArchive: () => void
  onSwitchToBench?: () => void
}

export default function CreateCase({ character: _character, initialInput, initialEvidenceOpen, onSubmit, onQuickStart, onExit, onOpenArchive, onSwitchToBench }: Props) {
  const [description, setDescription] = useState(initialInput ?? '')
  const [stance, setStance] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(initialEvidenceOpen ?? false)
  const [evidence, setEvidence] = useState<RawEvidence[]>([])
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')
  // 玩家身份：必选，无默认（玩家当原告/被告，亲自上庭）
  const [playerSide, setPlayerSide] = useState<PlayerSide | null>(null)
  const [presets, setPresets] = useState<Array<{ description: string; stance: string }>>([])

  // 拉取 3 个预置生活小案（快速开庭卡片）
  useEffect(() => {
    fetch('/api/court/presets').then((r) => r.json()).then((d: { presets?: Array<{ description: string; stance: string }> }) => {
      if (Array.isArray(d.presets)) setPresets(d.presets)
    }).catch(() => { /* 拉取失败则不显示快速开庭卡片 */ })
  }, [])

  const aiDraft = async () => {
    if (drafting) return
    setDrafting(true); setDraftError('')
    try {
      const res = await fetch('/api/court/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: description.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({})) as { description?: string; stance?: string; message?: string }
      if (!res.ok || !data.description) throw new Error(data.message ?? 'AI 帮写失败')
      setDescription(data.description)
      if (data.stance && !stance.trim()) setStance(data.stance)
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'AI 帮写失败，请重试')
    } finally {
      setDrafting(false)
    }
  }

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

        {/* 选择你的身份：玩家亲自当原告/被告上庭 */}
        <div className="live-create__field">
          <label className="live-create__label">选择你的身份（必选）</label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              className={`court-btn court-btn--lg ${playerSide === 'plaintiff' ? 'court-btn--primary' : 'court-btn--secondary'}`}
              onClick={() => setPlayerSide('plaintiff')}
              style={{ flex: 1, borderColor: playerSide === 'plaintiff' ? '#FFD60A' : undefined }}
            >
              <Scale size={18} /> 我要当原告 ⚖️
            </button>
            <button
              type="button"
              className={`court-btn court-btn--lg ${playerSide === 'defendant' ? 'court-btn--primary' : 'court-btn--secondary'}`}
              onClick={() => setPlayerSide('defendant')}
              style={{ flex: 1, borderColor: playerSide === 'defendant' ? '#4fb3a5' : undefined }}
            >
              <Shield size={18} /> 我要当被告 🛡️
            </button>
          </div>
        </div>

        {/* 快速开庭：3 个预置生活小案，跳过 analyze 等待 */}
        {presets.length > 0 && (
          <div className="live-create__field">
            <label className="live-create__label">⚡ 快速开庭（一键进入，跳过分析等待）</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="court-btn court-btn--secondary"
                  disabled={!playerSide}
                  onClick={() => onQuickStart(i, playerSide!)}
                  style={{ textAlign: 'left', opacity: playerSide ? 1 : 0.5 }}
                >
                  <span style={{ fontWeight: 700 }}>{p.stance || `小案 ${i + 1}`}</span>
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.8, marginTop: 2 }}>{p.description}</span>
                </button>
              ))}
            </div>
            {!playerSide && <span style={{ color: '#888', fontSize: 12 }}>↑ 先选身份，再点卡片一键开庭</span>}
          </div>
        )}

        <div className="live-create__field">
          <label className="live-create__label" htmlFor="desc">或者自己写案情 · 客观叙述</label>
          <textarea id="desc" className="live-create__textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如:泡泡借走了阿布的彩虹伞,但下雨后伞变成了会唱歌的蘑菇。" maxLength={500} />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="court-btn court-btn--secondary court-btn--sm" onClick={() => void aiDraft()} disabled={drafting}>
              <WandSparkles size={14} /> {drafting ? 'AI 正在构思…' : 'AI 帮我写案情'}
            </button>
            {draftError && <span style={{ color: '#ff8a8a', fontSize: 12 }}>{draftError}</span>}
          </div>
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

        <button className="live-create__submit" disabled={!description.trim() || !playerSide} onClick={() => onSubmit({ description: description.trim(), stance: stance.trim() || undefined, evidence, playerSide: playerSide! })}>
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
