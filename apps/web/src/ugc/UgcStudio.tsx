// ============================================================================
// UgcStudio —— R5 UGC 闭环总入口（tab 容器）
// 一句话造场景 / 模板市场 / 我的作品 / 照片化身 / 自定义道具与规则。
// ============================================================================
import { useState } from 'react'
import type { SceneDraft, UgcSceneMeta } from '@balabala/shared'
import PromptToScene from './PromptToScene'
import ScenePreview from './ScenePreview'
import TemplateMarket from './TemplateMarket'
import MyWorks from './MyWorks'
import PhotoToAvatar from './PhotoToAvatar'
import CustomPropEditor from './CustomPropEditor'
import CustomRules from './CustomRules'

type Tab = 'new' | 'templates' | 'mine' | 'photo' | 'props' | 'rules'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'new', label: '一句话造场景' },
  { key: 'templates', label: '模板市场' },
  { key: 'mine', label: '我的作品' },
  { key: 'photo', label: '照片化身' },
  { key: 'props', label: '自定义道具' },
  { key: 'rules', label: '游戏规则' },
]

export interface UgcStudioProps {
  onBack: () => void
}

export default function UgcStudio({ onBack }: UgcStudioProps) {
  const [tab, setTab] = useState<Tab>('new')
  const [draft, setDraft] = useState<SceneDraft | null>(null)

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', padding: 16 }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button onClick={onBack} style={backBtn}>←</button>
          <h2 style={{ margin: 0, color: '#FFD600' }}>UGC 创作间</h2>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '6px 12px', borderRadius: 16, cursor: 'pointer', fontSize: 13,
              border: '1px solid #333', background: tab === t.key ? '#2a2a14' : '#141414',
              color: tab === t.key ? '#FFD600' : '#ccc',
            }}>{t.label}</button>
          ))}
        </div>

        {tab === 'new' && (
          draft
            ? <ScenePreview draft={draft} onBack={() => setDraft(null)} />
            : <PromptToScene onPreview={(d) => setDraft(d)} />
        )}
        {tab === 'templates' && (
          <TemplateMarket
            onPickTemplate={() => setTab('new')}
            onPickUserWork={() => setTab('mine')}
          />
        )}
        {tab === 'mine' && <MyWorks onEdit={() => setTab('new')} />}
        {tab === 'photo' && <PhotoToAvatar onDone={() => setTab('new')} />}
        {tab === 'props' && <CustomPropEditor onSave={() => undefined} />}
        {tab === 'rules' && <CustomRules onApply={() => undefined} />}
      </div>
    </div>
  )
}

const backBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid #444',
  background: 'transparent', color: '#ccc', cursor: 'pointer', fontSize: 16,
}
