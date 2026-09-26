// ============================================================================
// SceneStudio —— 场景创作向导（三步：描述 → 生成中 → 编辑布置）
// 编辑模式：传入 sceneId 时从 getScene 加载已有蓝图，直接进入 Step 3。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Check, Loader2, MessageCircle, Plus, Save, Send, Sparkles, Trash2, X,
} from 'lucide-react'
import type {
  Celebrity,
  GameplayTemplate,
  SceneBlueprint,
  SceneGenerateEvent,
  SceneNpc,
  SceneRecord,
  SceneStructure,
  TerrainTheme,
} from '@balabala/shared'
import SceneRunner from './SceneRunner'
import {
  addNpc as addNpcApi,
  chatWithNpc,
  deleteScene,
  fetchCelebrities,
  generateScene,
  getScene,
  polishSceneDescription,
  publishScene,
  synthesizeSpeech,
  updateScene,
  type ChatMessage,
} from './api-client'
import { useIdentity } from '../identity'
import './scene-studio.css'

type Step = 1 | 2 | 3

const THEME_TAGS: Array<{ id: TerrainTheme; emoji: string; label: string }> = [
  { id: 'forest', emoji: '🌲', label: '森林' },
  { id: 'desert', emoji: '🏜️', label: '沙漠' },
  { id: 'snow', emoji: '❄️', label: '雪地' },
  { id: 'beach', emoji: '🏖️', label: '海滩' },
  { id: 'mountain', emoji: '⛰️', label: '山地' },
  { id: 'plains', emoji: '🌾', label: '平原' },
  { id: 'cave', emoji: '🕳️', label: '洞穴' },
  { id: 'city', emoji: '🏙️', label: '城市' },
]

const GAMEPLAY_TAGS: Array<{ id: GameplayTemplate; label: string }> = [
  { id: 'explore', label: '探索' },
  { id: 'collect', label: '收集' },
  { id: 'reach', label: '到达' },
  { id: 'quest', label: '任务' },
]

const STAGES: Array<{ key: string; label: string }> = [
  { key: 'planning', label: '规划地形' },
  { key: 'terrain', label: '生成地形' },
  { key: 'scatter', label: '地表物' },
  { key: 'structures', label: '结构资产' },
  { key: 'npcs', label: 'NPC 布置' },
  { key: 'done', label: '完成' },
]

const STAGE_ORDER = ['planning', 'terrain', 'scatter', 'structures', 'npcs', 'done']

type AssetStatus = 'queued' | 'generating' | 'ready' | 'failed'

type ChatDialogState = {
  npc: SceneNpc
  history: ChatMessage[]
  draft: string
  sending: boolean
  reply: string
}

export type SceneStudioProps = {
  onBack: () => void
  /** 传入则为编辑模式；不传为新建。 */
  sceneId?: string
  /** 发布成功后跳转「我的场景」。 */
  onPublished?: (id: string) => void
}

function parseBlueprint(json: string | undefined): SceneBlueprint | null {
  if (!json) return null
  try {
    return JSON.parse(json) as SceneBlueprint
  } catch {
    return null
  }
}

export default function SceneStudio({ onBack, sceneId, onPublished }: SceneStudioProps) {
  const { user } = useIdentity()

  // ---- 向导状态 ----
  const [step, setStep] = useState<Step>(1)
  const [description, setDescription] = useState('')
  const [theme, setTheme] = useState<TerrainTheme | undefined>(undefined)
  const [gameplay, setGameplay] = useState<GameplayTemplate | undefined>(undefined)
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState('')

  // ---- 生成状态 ----
  const [loading, setLoading] = useState(Boolean(sceneId))
  const [loadError, setLoadError] = useState('')
  const [activeStage, setActiveStage] = useState('planning')
  const [progress, setProgress] = useState(0)
  const [stageMessage, setStageMessage] = useState('准备生成…')
  const [assetStatuses, setAssetStatuses] = useState<Record<string, AssetStatus>>({})
  const [generateError, setGenerateError] = useState('')

  // ---- 蓝图与场景记录 ----
  const [blueprint, setBlueprint] = useState<SceneBlueprint | null>(null)
  const [record, setRecord] = useState<SceneRecord | null>(null)
  const [objective, setObjective] = useState('')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState('')

  // ---- NPC 选择器 / 对话 ----
  const [pickerOpen, setPickerOpen] = useState(false)
  const [celebrities, setCelebrities] = useState<Celebrity[]>([])
  const [celebSearch, setCelebSearch] = useState('')
  const [chatDialog, setChatDialog] = useState<ChatDialogState | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  // 编辑模式：加载已有场景
  useEffect(() => {
    if (!sceneId) return
    let alive = true
    ;(async () => {
      try {
        const rec = await getScene(sceneId)
        if (!alive) return
        setRecord(rec)
        const bp = parseBlueprint(rec.blueprint_json)
        setBlueprint(bp)
        setDescription(rec.description)
        setObjective(bp?.gameplay?.config?.objective ?? '')
        setStep(3)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : '加载场景失败')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [sceneId])

  useEffect(() => () => {
    abortRef.current?.abort()
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
  }, [])

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2600)
  }, [])

  // ---- AI 智能优化描述 ----
  const handlePolish = async () => {
    if (!description.trim() || polishing) return
    setPolishing(true)
    setPolishError('')
    try {
      const result = await polishSceneDescription(description)
      setDescription(result)
    } catch (e) {
      setPolishError(e instanceof Error ? e.message : 'AI 优化失败')
    } finally {
      setPolishing(false)
    }
  }

  // ---- Step1 → Step2：开始生成 ----
  const handleStartGenerate = async () => {
    if (!description.trim()) { showNotice('先描述一下你想要的世界吧'); return }
    setGenerateError('')
    setStep(2)
    setProgress(0)
    setActiveStage('planning')
    setStageMessage('正在规划…')
    setAssetStatuses({})
    const controller = new AbortController()
    abortRef.current = controller

    const onEvent = (event: SceneGenerateEvent) => {
      if (event.type === 'stage') {
        setActiveStage(event.stage)
        setStageMessage(event.message ?? STAGES.find((s) => s.key === event.stage)?.label ?? event.stage)
        const idx = STAGE_ORDER.indexOf(event.stage)
        if (idx >= 0) setProgress(Math.round(((idx + 1) / STAGE_ORDER.length) * 100))
      } else if (event.type === 'progress') {
        setProgress(Math.round(event.percent))
        if (event.message) setStageMessage(event.message)
      } else if (event.type === 'blueprint') {
        setBlueprint(event.blueprint)
        setObjective(event.blueprint.gameplay.config.objective ?? '')
      } else if (event.type === 'asset') {
        setAssetStatuses((prev) => ({ ...prev, [event.structureId]: event.status }))
      } else if (event.type === 'error') {
        setGenerateError(event.message || '生成失败')
      }
    }

    try {
      const result = await generateScene(description, {
        theme,
        gameplay,
        ownerId: user?.userId,
        onEvent,
        signal: controller.signal,
      })
      if (result.blueprint) {
        setBlueprint(result.blueprint)
        setObjective(result.blueprint.gameplay.config.objective ?? '')
      }
      if (result.sceneId) {
        try { setRecord(await getScene(result.sceneId)) } catch { /* 忽略 */ }
      }
      setActiveStage('done')
      setProgress(100)
      setStageMessage('生成完成')
      // 完成后进入 Step 3
      window.setTimeout(() => setStep(3), 600)
    } catch (e) {
      if (!controller.signal.aborted) {
        setGenerateError(e instanceof Error ? e.message : '生成失败')
        setStep(1)
      }
    }
  }

  // ---- Step3：编辑 ----
  const mutateBlueprint = useCallback((fn: (bp: SceneBlueprint) => SceneBlueprint) => {
    setBlueprint((prev) => (prev ? fn(structuredClone(prev)) : prev))
  }, [])

  // onPlacementChange → 更新本地，并防抖 PUT 保存
  const handlePlacementChange = useCallback((
    kind: 'npc' | 'structure',
    id: string,
    position: [number, number, number],
  ) => {
    mutateBlueprint((bp) => {
      if (kind === 'npc') {
        const npc = bp.npcs.find((n) => n.id === id)
        if (npc) npc.position = position
      } else {
        const s = bp.structures.find((s) => s.id === id)
        if (s) s.position = position
      }
      return bp
    })
    if (!record?.id) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      setBlueprint((bp) => {
        if (bp) updateScene(record.id, { blueprint: bp }).catch(() => { /* 静默 */ })
        return bp
      })
    }, 800)
  }, [mutateBlueprint, record?.id])

  const handleRemoveNpc = (id: string) => {
    mutateBlueprint((bp) => ({ ...bp, npcs: bp.npcs.filter((n) => n.id !== id) }))
  }

  const handleRemoveStructure = (id: string) => {
    mutateBlueprint((bp) => ({ ...bp, structures: bp.structures.filter((s) => s.id !== id) }))
  }

  // 打开人物选择器
  const openPicker = async () => {
    setPickerOpen(true)
    setCelebSearch('')
    if (celebrities.length === 0) {
      try { setCelebrities(await fetchCelebrities()) } catch { /* 空列表 */ }
    }
  }

  // 选中名人 → 放置到场景中心
  const handlePickCelebrity = async (celeb: Celebrity) => {
    if (!blueprint) return
    const half = blueprint.terrain.size / 2
    const npc: Omit<SceneNpc, 'id'> = {
      characterId: celeb.id,
      label: celeb.name,
      position: [0, 0, Math.min(6, half - 2)],
      rotation: [0, 0, 0],
      role: 'companion',
      defaultPrompt: celeb.greeting ?? '',
    }
    if (record?.id) {
      try {
        const rec = await addNpcApi(record.id, npc)
        setRecord(rec)
        const bp = parseBlueprint(rec.blueprint_json)
        if (bp) setBlueprint(bp)
        setPickerOpen(false)
        showNotice(`已添加 NPC：${celeb.name}`)
        return
      } catch { /* 降级为本地添加 */ }
    }
    // 本地添加（尚未持久化）
    mutateBlueprint((bp) => ({
      ...bp,
      npcs: [...bp.npcs, { ...npc, id: `npc-local-${Date.now()}` }],
    }))
    setPickerOpen(false)
    showNotice(`已添加 NPC：${celeb.name}（保存后生效）`)
  }

  // NPC 对话测试
  const openChat = (npc: SceneNpc) => {
    setChatDialog({ npc, history: [], draft: '', sending: false, reply: '' })
  }

  const handleSendChat = async () => {
    if (!chatDialog) return
    const text = chatDialog.draft.trim()
    if (!text || chatDialog.sending) return
    const history: ChatMessage[] = [
      ...chatDialog.history,
      { role: 'user', content: text },
    ]
    setChatDialog({ ...chatDialog, history, draft: '', sending: true, reply: '' })
    try {
      const reply = await chatWithNpc(chatDialog.npc.characterId, history, user?.userId)
      setChatDialog((prev) => prev
        ? { ...prev, history: [...history, { role: 'assistant', content: reply }], sending: false, reply }
        : prev)
    } catch (e) {
      setChatDialog((prev) => prev ? { ...prev, sending: false, reply: e instanceof Error ? e.message : '对话失败' } : prev)
    }
  }

  const handlePlayReply = async () => {
    if (!chatDialog?.reply) return
    try {
      const url = await synthesizeSpeech(chatDialog.reply)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch { /* 静默 */ }
  }

  // ---- 保存 / 发布 / 删除 ----
  const handleSave = async () => {
    if (!blueprint) return
    const id = record?.id ?? sceneId
    if (!id) { showNotice('场景尚未持久化，无法保存'); return }
    setSaving(true)
    try {
      const bp = structuredClone(blueprint)
      bp.gameplay.config.objective = objective
      const rec = await updateScene(id, {
        name: record?.name || '未命名场景',
        description,
        blueprint: bp,
      })
      setRecord(rec)
      showNotice('已保存')
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async () => {
    const id = record?.id ?? sceneId
    if (!id) { showNotice('场景尚未持久化，无法发布'); return }
    setPublishing(true)
    try {
      // 先保存最新蓝图
      if (blueprint) {
        const bp = structuredClone(blueprint)
        bp.gameplay.config.objective = objective
        await updateScene(id, { blueprint: bp }).catch(() => { /* 忽略 */ })
      }
      await publishScene(id)
      showNotice('发布成功')
      onPublished?.(id)
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  const handleDelete = async () => {
    const id = record?.id ?? sceneId
    if (!id) return
    if (!window.confirm('确定删除这个场景吗？此操作不可恢复。')) return
    try {
      await deleteScene(id)
      onBack()
    } catch {
      showNotice('删除失败')
    }
  }

  const filteredCelebrities = useMemo(() => {
    const q = celebSearch.trim().toLowerCase()
    if (!q) return celebrities
    return celebrities.filter((c) =>
      c.name.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.intro.toLowerCase().includes(q),
    )
  }, [celebrities, celebSearch])

  // ---- 渲染 ----
  if (loading) {
    return (
      <div className="ss__root">
        <div className="ss__center"><Loader2 className="ss__spin" size={22} /> 正在加载场景…</div>
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="ss__root">
        <div className="ss__center ss__error">
          <p>{loadError}</p>
          <button type="button" className="ss__btn" onClick={onBack}>返回</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ss__root">
      {/* 顶栏 */}
      <header className="ss__topbar">
        <button type="button" className="ss__iconbtn" onClick={onBack}><ArrowLeft size={18} /></button>
        <div className="ss__topbar-title">
          <span className="ss__kicker">SCENE STUDIO</span>
          <b>{sceneId ? '编辑场景' : '创造世界'}</b>
        </div>
        <div className="ss__steps">
          {(['描述', '生成', '布置'] as const).map((label, i) => (
            <span key={label} className={`ss__step ${step === i + 1 ? 'is-active' : ''} ${step > i + 1 ? 'is-done' : ''}`}>
              {step > i + 1 ? <Check size={12} /> : i + 1} {label}
            </span>
          ))}
        </div>
      </header>

      {/* ============ Step 1：描述 ============ */}
      {step === 1 && (
        <div className="ss__step1">
          <div className="ss__panel ss__description-panel">
            <label className="ss__label">你的世界</label>
            <textarea
              className="ss__textarea"
              placeholder="描述你想要的世界，例如：一片樱花飞舞的山谷，有一座古老的神社，李白在树下饮酒…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
            />
            <div className="ss__polish-row">
              <button type="button" className="ss__btn ss__btn-ghost" onClick={() => void handlePolish()} disabled={polishing || !description.trim()}>
                <Sparkles size={14} /> {polishing ? 'AI 优化中…' : 'AI 智能优化'}
              </button>
              {polishError && <span className="ss__error-text">{polishError}</span>}
            </div>
          </div>

          <div className="ss__panel">
            <label className="ss__label">地形主题（可选）</label>
            <div className="ss__tags">
              {THEME_TAGS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`ss__tag ${theme === t.id ? 'is-active' : ''}`}
                  onClick={() => setTheme(theme === t.id ? undefined : t.id)}
                >
                  <span>{t.emoji}</span>{t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ss__panel">
            <label className="ss__label">玩法模板（可选）</label>
            <div className="ss__tags">
              {GAMEPLAY_TAGS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`ss__tag ${gameplay === g.id ? 'is-active' : ''}`}
                  onClick={() => setGameplay(gameplay === g.id ? undefined : g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {generateError && <div className="ss__error-banner">{generateError}</div>}

          <div className="ss__actions">
            <button type="button" className="ss__btn ss__btn-primary" onClick={() => void handleStartGenerate()}>
              开始生成 →
            </button>
          </div>
        </div>
      )}

      {/* ============ Step 2：生成中 ============ */}
      {step === 2 && (
        <div className="ss__step2">
          <div className="ss__gen-left">
            <div className="ss__panel">
              <label className="ss__label">生成进度</label>
              <div className="ss__stage-list">
                {STAGES.map((s) => {
                  const idx = STAGE_ORDER.indexOf(s.key)
                  const active = activeStage === s.key
                  const done = STAGE_ORDER.indexOf(activeStage) > idx || activeStage === 'done'
                  return (
                    <div key={s.key} className={`ss__stage ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
                      <span className="ss__stage-dot">{done ? <Check size={12} /> : active ? <Loader2 size={12} className="ss__spin" /> : ''}</span>
                      <span>{s.label}</span>
                    </div>
                  )
                })}
              </div>
              <div className="ss__progress-track">
                <div className="ss__progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <div className="ss__stage-msg">{stageMessage} · {progress}%</div>
            </div>

            {Object.keys(assetStatuses).length > 0 && (
              <div className="ss__panel">
                <label className="ss__label">结构资产</label>
                <div className="ss__asset-list">
                  {Object.entries(assetStatuses).map(([id, status]) => (
                    <div key={id} className="ss__asset">
                      <span className={`ss__asset-dot ss__asset-${status}`} />
                      <span className="ss__asset-id">{id.slice(0, 18)}</span>
                      <span className="ss__asset-status">{status === 'ready' ? '完成' : status === 'failed' ? '失败' : status === 'generating' ? '生成中' : '排队中'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {generateError && <div className="ss__error-banner">{generateError}</div>}
          </div>

          <div className="ss__gen-preview">
            {blueprint ? (
              <SceneRunner blueprint={blueprint} editable={false} />
            ) : (
              <div className="ss__preview-placeholder">
                <Loader2 className="ss__spin" size={26} />
                <span>正在生成 3D 预览…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ Step 3：编辑布置 ============ */}
      {step === 3 && blueprint && (
        <div className="ss__step3">
          <aside className="ss__leftpanel">
            <div className="ss__panel">
              <div className="ss__panel-head">
                <label className="ss__label">NPC（{blueprint.npcs.length}）</label>
                <button type="button" className="ss__iconbtn ss__iconbtn-sm" onClick={() => void openPicker()} title="添加 NPC"><Plus size={16} /></button>
              </div>
              <div className="ss__item-list">
                {blueprint.npcs.length === 0 && <div className="ss__empty-hint">还没有 NPC，点 + 添加</div>}
                {blueprint.npcs.map((npc) => (
                  <div key={npc.id} className="ss__item">
                    <div className="ss__item-main">
                      <b>{npc.label}</b>
                      <small>{npc.role}</small>
                    </div>
                    <div className="ss__item-actions">
                      <button type="button" className="ss__iconbtn ss__iconbtn-sm" onClick={() => openChat(npc)} title="对话测试"><MessageCircle size={14} /></button>
                      <button type="button" className="ss__iconbtn ss__iconbtn-sm ss__danger" onClick={() => handleRemoveNpc(npc.id)} title="删除"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ss__panel">
              <label className="ss__label">结构（{blueprint.structures.length}）</label>
              <div className="ss__item-list">
                {blueprint.structures.length === 0 && <div className="ss__empty-hint">暂无结构</div>}
                {blueprint.structures.map((s) => (
                  <div key={s.id} className="ss__item">
                    <div className="ss__item-main"><b>{s.label || s.kind}</b><small>{s.source}</small></div>
                    <button type="button" className="ss__iconbtn ss__iconbtn-sm ss__danger" onClick={() => handleRemoveStructure(s.id)} title="删除"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="ss__panel">
              <label className="ss__label">玩法目标</label>
              <div className="ss__gamplay-meta">模板：<b>{blueprint.gameplay.template}</b></div>
              <textarea
                className="ss__textarea ss__textarea-sm"
                placeholder="这个场景要让玩家做什么？"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={3}
              />
            </div>
          </aside>

          <div className="ss__editor">
            <SceneRunner
              blueprint={blueprint}
              editable
              onPlacementChange={handlePlacementChange}
              onNpcInteract={(npc) => openChat(npc)}
            />
          </div>

          <footer className="ss__bottombar">
            <button type="button" className="ss__btn ss__btn-ghost" onClick={onBack}>返回</button>
            {record?.id && <button type="button" className="ss__btn ss__btn-ghost ss__danger" onClick={() => void handleDelete()}>删除</button>}
            <span className="ss__spacer" />
            <button type="button" className="ss__btn" onClick={() => void handleSave()} disabled={saving}>
              <Save size={14} /> {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="ss__btn ss__btn-primary" onClick={() => void handlePublish()} disabled={publishing}>
              {publishing ? '发布中…' : '发布'}
            </button>
          </footer>
        </div>
      )}

      {/* 人物选择器弹窗 */}
      {pickerOpen && (
        <div className="ss__modal-mask" onClick={() => setPickerOpen(false)}>
          <div className="ss__modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss__modal-head">
              <b>选择人物加入场景</b>
              <button type="button" className="ss__iconbtn" onClick={() => setPickerOpen(false)}><X size={16} /></button>
            </div>
            <input
              className="ss__search"
              placeholder="搜索名人…"
              value={celebSearch}
              onChange={(e) => setCelebSearch(e.target.value)}
            />
            <div className="ss__celeb-list">
              {filteredCelebrities.map((c) => (
                <button key={c.id} type="button" className="ss__celeb" onClick={() => void handlePickCelebrity(c)}>
                  <span className="ss__celeb-portrait">{c.portrait ? <img src={c.portrait} alt={c.name} /> : c.name[0]}</span>
                  <span className="ss__celeb-info"><b>{c.name}</b><small>{c.title}</small></span>
                </button>
              ))}
              {filteredCelebrities.length === 0 && <div className="ss__empty-hint">没有匹配的人物</div>}
            </div>
          </div>
        </div>
      )}

      {/* NPC 对话弹窗 */}
      {chatDialog && (
        <div className="ss__modal-mask" onClick={() => setChatDialog(null)}>
          <div className="ss__modal ss__chat" onClick={(e) => e.stopPropagation()}>
            <div className="ss__modal-head">
              <b>💬 {chatDialog.npc.label}</b>
              <button type="button" className="ss__iconbtn" onClick={() => setChatDialog(null)}><X size={16} /></button>
            </div>
            <div className="ss__chat-log">
              {chatDialog.history.map((m, i) => (
                <div key={i} className={`ss__chat-msg ${m.role === 'user' ? 'is-user' : ''}`}>{m.content}</div>
              ))}
              {chatDialog.sending && <div className="ss__chat-msg">正在输入…</div>}
            </div>
            {chatDialog.reply && !chatDialog.sending && (
              <button type="button" className="ss__btn ss__btn-ghost ss__btn-sm" onClick={() => void handlePlayReply()}>
                🔊 播放语音
              </button>
            )}
            <div className="ss__chat-input">
              <input
                value={chatDialog.draft}
                onChange={(e) => setChatDialog({ ...chatDialog, draft: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSendChat() }}
                placeholder={`对 ${chatDialog.npc.label} 说点什么…`}
              />
              <button type="button" className="ss__btn ss__btn-primary" onClick={() => void handleSendChat()} disabled={chatDialog.sending}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="ss__toast">{notice}</div>}
    </div>
  )
}
