// ============================================================================
// MyScenes —— 我的场景列表
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Grid3x3, Loader2, Play, Pencil, Plus, Trash2 } from 'lucide-react'
import type { GameplayTemplate, SceneRecord, SceneStatus, TerrainTheme } from '@balabala/shared'
import { deleteScene, listScenes } from './api-client'
import { useIdentity } from '../identity'
import './scene-studio.css'

export type MyScenesProps = {
  onBack: () => void
  /** 新建（id=undefined）或编辑已有场景。 */
  onEdit: (id?: string) => void
  /** 进入播放页。 */
  onPlay: (id: string) => void
}

const THEME_EMOJI: Record<TerrainTheme, string> = {
  forest: '🌲', desert: '🏜️', snow: '❄️', beach: '🏖️',
  mountain: '⛰️', plains: '🌾', cave: '🕳️', city: '🏙️',
}

const THEME_GRADIENT: Record<TerrainTheme, string> = {
  forest: 'linear-gradient(145deg,#1d3a24,#0c1a10)',
  desert: 'linear-gradient(145deg,#4a3a1a,#1c1508)',
  snow: 'linear-gradient(145deg,#2a3a4a,#101820)',
  beach: 'linear-gradient(145deg,#1a4a5a,#0a2028)',
  mountain: 'linear-gradient(145deg,#2a2f3a,#12151c)',
  plains: 'linear-gradient(145deg,#3a4a1a,#18200c)',
  cave: 'linear-gradient(145deg,#2a2438,#100d18)',
  city: 'linear-gradient(145deg,#24304a,#0c1220)',
}

const STATUS_LABEL: Record<SceneStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'ss__status-draft' },
  generating: { label: '生成中', cls: 'ss__status-gen' },
  ready: { label: '就绪', cls: 'ss__status-ready' },
  published: { label: '已发布', cls: 'ss__status-pub' },
}

const GAMEPLAY_LABEL: Record<GameplayTemplate, string> = {
  explore: '探索', collect: '收集', reach: '到达', quest: '任务',
}

export default function MyScenes({ onBack, onEdit, onPlay }: MyScenesProps) {
  const { user } = useIdentity()
  const [scenes, setScenes] = useState<SceneRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await listScenes(user?.userId)
      setScenes(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载场景列表失败')
    } finally {
      setLoading(false)
    }
  }, [user?.userId])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (rec: SceneRecord) => {
    if (!window.confirm(`确定删除「${rec.name || '未命名场景'}」吗？`)) return
    setBusyId(rec.id)
    try {
      await deleteScene(rec.id)
      setScenes((prev) => prev.filter((s) => s.id !== rec.id))
    } catch {
      setError('删除失败')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="ss__root ss__myscenes">
      <header className="ss__topbar">
        <button type="button" className="ss__iconbtn" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="ss__topbar-title">
          <span className="ss__kicker">MY SCENES</span>
          <b>我的场景</b>
        </div>
        <span className="ss__spacer" />
        <button type="button" className="ss__btn ss__btn-primary" onClick={() => onEdit(undefined)}>
          <Plus size={14} /> 创建新场景
        </button>
      </header>

      {loading && (
        <div className="ss__center"><Loader2 className="ss__spin" size={22} /> 正在加载…</div>
      )}

      {!loading && error && (
        <div className="ss__center ss__error">
          <p>{error}</p>
          <button type="button" className="ss__btn" onClick={() => void load()}>重试</button>
        </div>
      )}

      {!loading && !error && scenes.length === 0 && (
        <div className="ss__center ss__empty">
          <Grid3x3 size={40} />
          <h2>还没有属于你的世界</h2>
          <p>用一句话描述想象，AI 帮你生成可探索的 3D 场景，还能拉上名人 NPC 一起冒险。</p>
          <button type="button" className="ss__btn ss__btn-primary" onClick={() => onEdit(undefined)}>
            <Plus size={16} /> 创造第一个场景
          </button>
        </div>
      )}

      {!loading && !error && scenes.length > 0 && (
        <div className="ss__grid">
          {scenes.map((rec) => {
            const theme = rec.theme
            const status = STATUS_LABEL[rec.status] ?? STATUS_LABEL.draft
            // 从 blueprint_json 粗取玩法模板（失败则不显示标签）
            let gameplayLabel = ''
            try {
              const bp = JSON.parse(rec.blueprint_json) as { gameplay?: { template?: GameplayTemplate } }
              if (bp.gameplay?.template) gameplayLabel = GAMEPLAY_LABEL[bp.gameplay.template] ?? ''
            } catch { /* ignore */ }
            return (
              <div key={rec.id} className="ss__card" style={{ background: THEME_GRADIENT[theme] }}>
                <div className="ss__card-cover">
                  {rec.cover ? <img src={rec.cover} alt="" /> : <span className="ss__card-emoji">{THEME_EMOJI[theme] ?? '🌍'}</span>}
                  <span className={`ss__status ${status.cls}`}>{status.label}</span>
                </div>
                <div className="ss__card-body">
                  <b className="ss__card-name">{rec.name || '未命名场景'}</b>
                  <div className="ss__card-meta">
                    <span>{THEME_EMOJI[theme] ?? '🌍'} {theme}</span>
                    {gameplayLabel && <span className="ss__chip">{gameplayLabel}</span>}
                    <span>▶ {rec.play_count ?? 0}</span>
                  </div>
                  <div className="ss__card-actions">
                    <button type="button" className="ss__iconbtn" title="进入" onClick={() => onPlay(rec.id)}><Play size={15} /></button>
                    <button type="button" className="ss__iconbtn" title="编辑" onClick={() => onEdit(rec.id)}><Pencil size={15} /></button>
                    <button type="button" className="ss__iconbtn ss__danger" title="删除" disabled={busyId === rec.id} onClick={() => void handleDelete(rec)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
