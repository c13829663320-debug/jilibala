// ============================================================================
// PromptToScene —— 一句话造场景：输入描述 → AI 解析（纯函数）→ 预览草稿
// ============================================================================
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { SceneDraft } from '@balabala/shared'
import { parsePrompt } from './promptParser'

export interface PromptToSceneProps {
  /** 解析出草稿后回调（交给 ScenePreview）。 */
  onPreview: (draft: SceneDraft) => void
}

const box: React.CSSProperties = {
  background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12,
  padding: 16, color: '#eee',
}

export default function PromptToScene({ onPreview }: PromptToSceneProps) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<SceneDraft | null>(null)

  const handleParse = () => {
    const d = parsePrompt(text)
    setDraft(d)
  }

  return (
    <div style={{ ...box, maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Sparkles size={16} color="#FFD600" />
        <strong style={{ fontSize: 15 }}>一句话造场景</strong>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='例如：一个赛博朋克茶馆，苏轼和马斯克在辩论'
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', background: '#0a0a0a', color: '#eee',
          border: '1px solid #333', borderRadius: 8, padding: 10, fontSize: 14, resize: 'vertical',
        }}
      />
      <button
        onClick={handleParse}
        style={{
          marginTop: 10, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: '#FFD600', color: '#141414', fontWeight: 700, cursor: 'pointer',
        }}
      >
        生成预览
      </button>

      {draft && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7, color: '#bbb' }}>
          <div>主题：<span style={{ color: '#4fb3a5' }}>{draft.theme}</span></div>
          <div>风格：{draft.style}</div>
          <div>玩法：{draft.gameType}</div>
          <div>参与名人：{draft.celebrityIds.length ? draft.celebrityIds.join(', ') : '（无）'}</div>
          <div style={{ color: '#888', fontSize: 12 }}>{draft.notes}</div>
          <button
            onClick={() => onPreview(draft)}
            style={{
              marginTop: 10, padding: '8px 16px', borderRadius: 8, border: '1px solid #4fb3a5',
              background: 'transparent', color: '#4fb3a5', cursor: 'pointer',
            }}
          >
            进入预览 / 发布 →
          </button>
        </div>
      )}
    </div>
  )
}
