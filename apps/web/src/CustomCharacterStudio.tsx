import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, ImagePlus, RefreshCw, Sparkles, Upload, WandSparkles,
} from 'lucide-react'
import './custom-character-studio.css'
import TripoModelPreview from './TripoModelPreview'
import { findTripoAssetUrl, readTripoTask } from './tripo-assets'
import { useIdentity } from './identity'

type CustomCharacterStudioProps = {
  onBack: () => void
  /** 保存成功后跳转到人物详情；未提供则只展示完成页。 */
  onViewCharacter?: (id: string) => void
}

type TaskState = {
  taskId: string
  status: string
  progress?: number
  assetUrl?: string
}

type SavedCharacter = {
  id: string
  name: string
  title?: string
  intro?: string
  tags?: string[]
  greeting?: string
  modelPath?: string
  portraitPath?: string
  visibility?: string
}

type Step = 1 | 2 | 3 | 4

const PROMPT_EXAMPLES = [
  '赛博朋克少女：银色短发，霓虹外套，冷艳神秘',
  '古风侠客：长衫束发，腰佩长剑，气质潇洒',
  '卡通厨师：白色厨师服，高帽，圆脸微笑',
]

const STEP_LABELS = ['选择外观来源', '生成 3D 模型', '填写人设', '完成保存'] as const

export default function CustomCharacterStudio({ onBack, onViewCharacter }: CustomCharacterStudioProps) {
  const { user } = useIdentity()

  const [step, setStep] = useState<Step>(1)
  const [mode, setMode] = useState<'text' | 'image'>('text')
  const [prompt, setPrompt] = useState('')
  const [imageData, setImageData] = useState<{ dataUrl: string; contentType: string; filename: string } | null>(null)
  const [task, setTask] = useState<TaskState | null>(null)
  const [message, setMessage] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedCharacter, setSavedCharacter] = useState<SavedCharacter | null>(null)
  const [form, setForm] = useState({
    name: '',
    title: '',
    intro: '',
    tags: '',
    persona: '',
    greeting: '',
  })

  const pollRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (pollRef.current) window.clearTimeout(pollRef.current)
  }, [])

  /* ---------- Tripo 任务轮询（复用 AvatarStudio 模式） ---------- */
  const pollTask = (taskId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/avatars/tasks/${encodeURIComponent(taskId)}`)
        const payload = await response.json()
        const parsed = readTripoTask(payload)
        if (!response.ok) throw new Error('暂时无法读取生成状态')
        const status = parsed.status ?? 'queued'
        const directAssetUrl = findTripoAssetUrl(payload)
        // 走服务端代理，不暴露临时 CDN 地址
        const assetUrl = directAssetUrl ? `/api/tripo/tasks/${encodeURIComponent(taskId)}/download.glb` : ''
        setTask((current) => current
          ? { ...current, status, progress: parsed.progress, assetUrl: assetUrl || current.assetUrl }
          : current)
        if (['success', 'succeeded', 'complete', 'completed'].includes(status.toLowerCase())) {
          setMessage(assetUrl ? '3D 模型生成完成，可以继续填写人设。' : '3D 模型生成完成，模型文件正在整理。')
          return
        }
        if (['failed', 'error', 'cancelled', 'canceled'].includes(status.toLowerCase())) {
          setMessage('生成失败，请更换照片或文字描述后重试。')
          return
        }
        pollRef.current = window.setTimeout(poll, 2600)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '读取生成状态失败')
      }
    }
    void poll()
  }

  const startGenerate = async () => {
    setMessage('正在连接 Tripo3D…')
    setTask({ taskId: '', status: 'submitting' })
    try {
      let response: Response
      if (mode === 'image') {
        if (!imageData) return
        setMessage('正在上传照片到 Tripo…')
        response = await fetch('/api/avatars/generate-from-image', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imageBase64: imageData.dataUrl,
            contentType: imageData.contentType,
            filename: imageData.filename,
          }),
        })
      } else {
        const cleanPrompt = prompt.trim()
        if (!cleanPrompt) return
        response = await fetch('/api/avatars/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'text_to_model', prompt: cleanPrompt }),
        })
      }
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建生成任务失败')
      setTask({ taskId: data.taskId, status: 'queued' })
      setMessage(mode === 'image' ? '照片已上传，正在根据照片雕刻 3D 模型…' : '任务已提交，正在生成 3D 模型…')
      pollTask(data.taskId)
    } catch (error) {
      setTask(null)
      setMessage(error instanceof Error ? error.message : '生成失败，请稍后再试')
    }
  }

  const pickImage = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setMessage('请选择图片文件。'); return }
    if (file.size > 10 * 1024 * 1024) { setMessage('图片不能超过 10MB。'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      setImageData({ dataUrl, contentType: file.type, filename: file.name })
      setMessage('照片已就绪，可以开始生成。')
    }
    reader.onerror = () => setMessage('读取图片失败。')
    reader.readAsDataURL(file)
  }

  /* ---------- AI 帮填人设 ---------- */
  const polishPersona = async () => {
    const description = mode === 'text'
      ? prompt.trim()
      : (imageData?.filename ?? '一张人物照片')
    const seed = form.name.trim()
      ? `名字：${form.name.trim()}\n描述：${description}`
      : description
    if (!seed.trim()) { setFormMessage('请先填写名字或输入描述，再让 AI 帮填。'); return }
    setPolishing(true)
    setFormMessage('AI 正在生成人设…')
    try {
      const response = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: seed, context: 'character' }),
      })
      const data = await response.json() as { result?: string; message?: string }
      if (!response.ok || !data.result) throw new Error(data.message ?? 'AI 帮填失败')
      try {
        const parsed = JSON.parse(data.result) as {
          title?: string; intro?: string; tags?: string[]; greeting?: string; persona?: string
        }
        setForm((f) => ({
          ...f,
          title: typeof parsed.title === 'string' && parsed.title ? parsed.title : f.title,
          intro: typeof parsed.intro === 'string' && parsed.intro ? parsed.intro : f.intro,
          tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.join(',') : f.tags,
          greeting: typeof parsed.greeting === 'string' && parsed.greeting ? parsed.greeting : f.greeting,
          persona: typeof parsed.persona === 'string' && parsed.persona ? parsed.persona : f.persona,
        }))
        setFormMessage('AI 已帮填人设，你仍可以继续编辑。')
      } catch {
        // 降级：非 JSON 字符串，整体填入 persona
        setForm((f) => ({ ...f, persona: data.result ?? f.persona }))
        setFormMessage('AI 返回内容已填入人格描述，可继续编辑。')
      }
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : 'AI 帮填失败，请稍后再试。')
    } finally {
      setPolishing(false)
    }
  }

  /* ---------- 保存 ---------- */
  const saveCharacter = async () => {
    if (!user?.userId) { setSaveError('未登录，无法保存人物。'); return }
    if (!form.name.trim()) { setSaveError('请填写人物名字。'); return }
    if (!form.persona.trim()) { setSaveError('请填写人格描述。'); return }
    if (!task?.taskId) { setSaveError('请先生成 3D 模型。'); return }
    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch('/api/custom-characters/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: user.userId,
          name: form.name.trim(),
          persona: form.persona.trim(),
          title: form.title.trim(),
          intro: form.intro.trim(),
          tags: form.tags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean),
          greeting: form.greeting.trim(),
          tripoTaskId: task.taskId,
          portraitDataUrl: mode === 'image' ? (imageData?.dataUrl ?? '') : '',
          visibility: 'private',
        }),
      })
      const data = await response.json() as (SavedCharacter & { message?: string })
      if (!response.ok || !data.id) throw new Error(data.message ?? '保存失败')
      setSavedCharacter(data)
      setStep(4)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后再试。')
    } finally {
      setSaving(false)
    }
  }

  const resetAll = () => {
    if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null }
    setStep(1)
    setMode('text')
    setPrompt('')
    setImageData(null)
    setTask(null)
    setMessage('')
    setFormMessage('')
    setSaveError('')
    setSavedCharacter(null)
    setForm({ name: '', title: '', intro: '', tags: '', persona: '', greeting: '' })
  }

  /* ---------- 派生状态 ---------- */
  const busy = ['submitting', 'queued', 'running', 'processing'].includes(task?.status?.toLowerCase() ?? '')
  const genFailed = ['failed', 'error', 'cancelled', 'canceled'].includes(task?.status?.toLowerCase() ?? '')
  const modelReady = Boolean(task?.assetUrl)
  const progress = task?.progress == null
    ? (busy ? 18 : modelReady ? 100 : 0)
    : Math.max(0, Math.min(100, task.progress))

  const canGoStep2 = mode === 'image' ? Boolean(imageData) : Boolean(prompt.trim())
  const canSave = Boolean(user?.userId && form.name.trim() && form.persona.trim() && modelReady && task?.taskId && !saving)

  return (
    <main className="ccs">
      <header className="ccs__topbar">
        <button className="ccs__back" type="button" onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <div className="ccs__brand"><span className="ccs__mark">叽</span><span>创建自定义人物</span></div>
        <div className="ccs__account"><i /> {user?.nickname ?? '未登录'}</div>
      </header>

      {/* 步骤指示条 */}
      <ol className="ccs__steps" aria-label="创建步骤">
        {STEP_LABELS.map((label, index) => {
          const n = (index + 1) as Step
          const state = n < step ? 'is-done' : n === step ? 'is-current' : ''
          return (
            <li key={label} className={`ccs__step ${state}`}>
              <span className="ccs__step-dot">{n < step ? <Check size={12} /> : n}</span>
              <span className="ccs__step-label">{label}</span>
            </li>
          )
        })}
      </ol>

      {/* ===== Step 1: 选择外观来源 ===== */}
      {step === 1 && (
        <section className="ccs__card">
          <div className="ccs__card-label">STEP 01 · 选择外观来源</div>
          <h2>用照片或文字，生成你的专属 3D 人物</h2>
          <div className="ccs__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'text'}
              className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}>
              <WandSparkles size={14} /> 文字描述
            </button>
            <button type="button" role="tab" aria-selected={mode === 'image'}
              className={mode === 'image' ? 'is-active' : ''} onClick={() => setMode('image')}>
              <ImagePlus size={14} /> 上传照片
            </button>
          </div>

          {mode === 'text' ? (
            <>
              <label htmlFor="ccs-prompt">角色描述（maxLength 300）</label>
              <textarea id="ccs-prompt" value={prompt} maxLength={300}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：穿西装的赛博朋克律师，蓝紫色灯光，友善的表情" />
              <div className="ccs__counter">{prompt.length}/300</div>
              <div className="ccs__examples">
                <span>示例：</span>
                {PROMPT_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setPrompt(ex)}>{ex}</button>
                ))}
              </div>
              <p className="ccs__hint">描述越详细，3D 模型越精准。</p>
            </>
          ) : (
            <>
              <p className="ccs__hint">建议使用从头到脚的全身照，中性背景，以获得最佳 3D 效果。图片 ≤10MB。</p>
              <input ref={fileInputRef} id="ccs-photo" type="file" accept="image/*" hidden
                onChange={(e) => pickImage(e.target.files?.[0])} />
              <button className="ccs__photo-drop" type="button"
                onClick={() => fileInputRef.current?.click()}>
                {imageData
                  ? <img src={imageData.dataUrl} alt="已选择的照片" />
                  : <span className="ccs__photo-empty"><Upload size={22} /> 点击选择照片</span>}
              </button>
              {imageData && (
                <button className="ccs__photo-repick" type="button"
                  onClick={() => fileInputRef.current?.click()}>换一张照片</button>
              )}
            </>
          )}

          {message && <div className="ccs__message" role="status">{message}</div>}

          <button className="ccs__primary" type="button" disabled={!canGoStep2 || busy}
            onClick={() => setStep(2)}>
            下一步：生成 3D 模型 <span>→</span>
          </button>
        </section>
      )}

      {/* ===== Step 2: 生成 3D 模型 ===== */}
      {step === 2 && (
        <section className="ccs__card">
          <div className="ccs__card-label">STEP 02 · 生成 3D 模型</div>
          <h2>{mode === 'image' ? '根据照片生成 3D 模型' : '根据文字生成 3D 模型'}</h2>
          <p className="ccs__hint">
            {mode === 'image' ? '将上传的照片交由 Tripo 生成可预览的 3D 模型。' : prompt.trim()}
          </p>

          <button className="ccs__primary" type="button" onClick={startGenerate}
            disabled={busy || genFailed || (mode === 'image' ? !imageData : !prompt.trim())}>
            {busy ? '正在生成…' : genFailed ? '重新生成' : modelReady ? '重新生成' : '生成 3D 模型'}
            {genFailed && <RefreshCw size={14} />}
          </button>

          {message && (
            <div className={`ccs__message ${genFailed ? 'is-error' : ''}`} role="status">{message}</div>
          )}

          <div className="ccs__progress-wrap">
            <div className="ccs__progress-row">
              <span><i className={busy ? 'is-busy' : modelReady ? 'is-ready' : ''} />
                {busy ? `生成中 ${progress}%` : modelReady ? '已生成' : '等待生成'}</span>
              {task?.taskId && <code>#{task.taskId.slice(-8)}</code>}
            </div>
            <div className="ccs__progress"><span style={{ width: `${progress}%` }} /></div>
          </div>

          <div className={`ccs__preview ${modelReady ? 'has-model' : ''}`}>
            {modelReady && task?.assetUrl
              ? <TripoModelPreview url={task.assetUrl} className="ccs__model" label="生成的 3D 人物" />
              : <div className="ccs__preview-placeholder">
                  <WandSparkles size={28} />
                  <span>{busy ? '正在雕刻轮廓…' : '你的 3D 人物会出现在这里'}</span>
                </div>}
          </div>

          <div className="ccs__nav-row">
            <button className="ccs__ghost" type="button" onClick={() => setStep(1)} disabled={busy}>← 上一步</button>
            <button className="ccs__primary ccs__primary--inline" type="button"
              disabled={!modelReady || busy} onClick={() => setStep(3)}>
              下一步：填写人设 →
            </button>
          </div>
        </section>
      )}

      {/* ===== Step 3: 填写人设 ===== */}
      {step === 3 && (
        <section className="ccs__card">
          <div className="ccs__card-label">STEP 03 · 填写人设</div>
          <h2>告诉大家这个人物是谁</h2>

          <button className="ccs__ai-btn" type="button" onClick={() => void polishPersona} disabled={polishing}>
            <Sparkles size={15} /> {polishing ? 'AI 正在帮填…' : 'AI 帮填人设'}
          </button>
          {formMessage && <div className="ccs__message" role="status">{formMessage}</div>}

          <div className="ccs__form-grid">
            <label>
              <span>名字 *</span>
              <input value={form.name} maxLength={20} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：林小满" />
            </label>
            <label>
              <span>身份 / 头衔</span>
              <input value={form.title} maxLength={30} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="例如：赛博侦探" />
            </label>
            <label>
              <span>一句话简介</span>
              <textarea className="ccs__textarea--short" value={form.intro} maxLength={100}
                onChange={(e) => setForm({ ...form, intro: e.target.value })}
                placeholder="用一句话介绍 TA" />
            </label>
            <label>
              <span>标签（逗号分隔）</span>
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="例如：冷静,理性,毒舌" />
            </label>
            <label className="ccs__field-full">
              <span>人格描述 *</span>
              <textarea value={form.persona} maxLength={500}
                onChange={(e) => setForm({ ...form, persona: e.target.value })}
                placeholder="你是……，性格……，说话风格……" />
              <div className="ccs__counter">{form.persona.length}/500</div>
            </label>
            <label>
              <span>开场白</span>
              <input value={form.greeting} maxLength={80} onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                placeholder="TA 见到你时说的第一句话" />
            </label>
          </div>

          <div className="ccs__nav-row">
            <button className="ccs__ghost" type="button" onClick={() => setStep(2)}>← 上一步</button>
            <button className="ccs__primary ccs__primary--inline" type="button"
              onClick={() => setStep(4)}>
              下一步：完成保存 →
            </button>
          </div>
        </section>
      )}

      {/* ===== Step 4: 完成保存 ===== */}
      {step === 4 && !savedCharacter && (
        <section className="ccs__card">
          <div className="ccs__card-label">STEP 04 · 完成保存</div>
          <h2>确认并保存这个人物</h2>
          <p className="ccs__hint">
            将以「{form.name.trim() || '未命名'}」的身份保存到你的人物馆，默认私有。
          </p>
          {saveError && <div className="ccs__message is-error" role="alert">{saveError}</div>}
          <div className="ccs__nav-row">
            <button className="ccs__ghost" type="button" onClick={() => setStep(3)} disabled={saving}>← 上一步</button>
            <button className="ccs__primary ccs__primary--inline" type="button"
              onClick={() => void saveCharacter} disabled={!canSave}>
              {saving ? '保存中…' : '保存人物'}
            </button>
          </div>
        </section>
      )}

      {/* ===== Step 4: 保存成功 ===== */}
      {step === 4 && savedCharacter && (
        <section className="ccs__card ccs__card--success">
          <div className="ccs__success-badge"><Check size={28} /></div>
          <h2>人物「{savedCharacter.name}」创建成功！</h2>
          {savedCharacter.title && <p className="ccs__success-title">{savedCharacter.title}</p>}
          {task?.assetUrl && (
            <div className="ccs__preview ccs__preview--small">
              <TripoModelPreview url={task.assetUrl} className="ccs__model" label="已保存的 3D 人物" />
            </div>
          )}
          <div className="ccs__success-actions">
            {onViewCharacter && (
              <button className="ccs__primary ccs__primary--inline" type="button"
                onClick={() => onViewCharacter(savedCharacter.id)}>
                去人物馆查看 →
              </button>
            )}
            <button className="ccs__ghost" type="button" onClick={resetAll}>再创建一个</button>
          </div>
        </section>
      )}
    </main>
  )
}
