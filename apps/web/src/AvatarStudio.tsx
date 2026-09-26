import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Cuboid, ExternalLink, ImagePlus, Sparkles, Upload, WandSparkles } from 'lucide-react'
import './avatar-studio.css'
import TripoModelPreview from './TripoModelPreview'
import { findTripoAssetUrl, readTripoTask } from './tripo-assets'

type AvatarStudioProps = { onBack: () => void; onEnterCourt: () => void }

type TaskState = {
  taskId: string
  status: string
  progress?: number
  assetUrl?: string
}

const EXAMPLES = [
  '穿红色法官袍的猫咪，圆润可爱，金色领结',
  '戴护目镜的蓝色小恐龙，软胶玩具质感',
  '穿紫色宇航服的兔子，儿童绘本风格',
]

export default function AvatarStudio({ onBack, onEnterCourt }: AvatarStudioProps) {
  const [mode, setMode] = useState<'text' | 'image'>('text')
  const [prompt, setPrompt] = useState('卡通风格、穿红色法官袍的猫咪')
  const [imageData, setImageData] = useState<{ dataUrl: string; contentType: string; filename: string } | null>(null)
  const [task, setTask] = useState<TaskState | null>(null)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const pollRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    if (pollRef.current) window.clearTimeout(pollRef.current)
  }, [])

  const pollTask = (taskId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/avatars/tasks/${encodeURIComponent(taskId)}`)
        const payload = await response.json()
        const parsed = readTripoTask(payload)
        if (!response.ok) throw new Error('暂时无法读取生成状态')
        const status = parsed.status ?? 'queued'
        const directAssetUrl = findTripoAssetUrl(payload)
        // Keep the browser on our API origin; it follows the Tripo redirect
        // server-side and avoids exposing a temporary CDN URL to the UI.
        const assetUrl = directAssetUrl ? `/api/tripo/tasks/${encodeURIComponent(taskId)}/download.glb` : ''
        setTask((current) => current ? { ...current, status, progress: parsed.progress, assetUrl: assetUrl || current.assetUrl } : current)
        if (['success', 'succeeded', 'complete', 'completed'].includes(status.toLowerCase())) {
          setMessage(assetUrl ? '角色生成完成，可以下载模型。' : '角色生成完成，模型文件正在整理。')
          return
        }
        if (['failed', 'error', 'cancelled', 'canceled'].includes(status.toLowerCase())) {
          setMessage('生成失败，请换一张更清晰的正面照片再试。')
          return
        }
        pollRef.current = window.setTimeout(poll, 2600)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '读取生成状态失败')
      }
    }
    void poll()
  }

  const generateText = async () => {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) return
    setMessage('正在连接 Tripo3D…')
    setTask({ taskId: '', status: 'submitting' })
    setCopied(false)
    try {
      const response = await fetch('/api/avatars/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'text_to_model', prompt: cleanPrompt }),
      })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建生成任务失败')
      setTask({ taskId: data.taskId, status: 'queued' })
      setMessage('任务已提交，正在生成你的 3D 分身…')
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

  const generateFromImage = async () => {
    if (!imageData) return
    setMessage('正在上传照片到 Tripo…')
    setTask({ taskId: '', status: 'submitting' })
    setCopied(false)
    try {
      const response = await fetch('/api/avatars/generate-from-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageData.dataUrl,
          contentType: imageData.contentType,
          filename: imageData.filename,
        }),
      })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建生成任务失败')
      setTask({ taskId: data.taskId, status: 'queued' })
      setMessage('照片已上传，正在根据照片雕刻 3D 分身…')
      pollTask(data.taskId)
    } catch (error) {
      setTask(null)
      setMessage(error instanceof Error ? error.message : '生成失败，请稍后再试')
    }
  }

  const copyAsset = async () => {
    if (!task?.assetUrl) return
    try {
      await navigator.clipboard.writeText(task.assetUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setMessage('复制失败，请直接打开模型链接。')
    }
  }

  const busy = ['submitting', 'queued', 'running', 'processing'].includes(task?.status?.toLowerCase() ?? '')
  const progress = task?.progress == null ? (busy ? 18 : task?.assetUrl ? 100 : 0) : Math.max(0, Math.min(100, task.progress))

  return (
    <main className="avatar-studio">
      <header className="avatar-studio__topbar">
        <button className="avatar-studio__back" type="button" onClick={onBack}><ArrowLeft size={16} /> 返回空间</button>
        <div className="avatar-studio__brand"><span className="avatar-studio__mark">叽</span><span>叽里呱啦 <em>· BalaBala</em></span></div>
        <div className="avatar-studio__account"><i /> 林同学 · 在线</div>
      </header>

      <nav className="avatar-studio__crumb" aria-label="当前位置"><span>平台空间</span><b>/</b><strong>我的角色</strong></nav>
      <section className="avatar-studio__hero">
        <div>
          <span className="avatar-studio__kicker"><Cuboid size={14} /> DIGITAL IDENTITY LAB</span>
          <h1>让你的分身，<em>先替你亮相。</em></h1>
          <p>文字描述或一张照片，Tripo3D 会把它变成可带入不同场景的 3D 角色。生成后，你可以在趣味法庭和其他房间继续使用。</p>
        </div>
        <button className="avatar-studio__court-link" type="button" onClick={onEnterCourt}>进入趣味法庭 <span>↗</span></button>
      </section>

      <div className="avatar-studio__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}><WandSparkles size={14} /> 文字生成</button>
        <button type="button" role="tab" aria-selected={mode === 'image'} className={mode === 'image' ? 'is-active' : ''} onClick={() => setMode('image')}><ImagePlus size={14} /> 照片生成</button>
      </div>

      <section className="avatar-studio__workspace">
        <div className="avatar-studio__form-card">
          {mode === 'text' ? (
            <>
              <div className="avatar-studio__card-label">01 · CREATE YOUR AVATAR</div>
              <h2>告诉我你想长什么样</h2>
              <label htmlFor="avatar-prompt">角色描述</label>
              <textarea id="avatar-prompt" value={prompt} maxLength={300} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：穿西装的赛博朋克律师，蓝紫色灯光，友善的表情" />
              <div className="avatar-studio__counter">{prompt.length}/300</div>
              <div className="avatar-studio__examples"><span>灵感：</span>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setPrompt(example)}>{example}</button>)}</div>
              <button className="avatar-studio__generate" type="button" onClick={generateText} disabled={!prompt.trim() || busy || task?.status === 'submitting'}><WandSparkles size={16} /> {busy || task?.status === 'submitting' ? '正在生成…' : '生成我的 3D 分身'} <span>↗</span></button>
            </>
          ) : (
            <>
              <div className="avatar-studio__card-label">01 · PHOTO TO 3D</div>
              <h2>用一张照片生成分身</h2>
              <p className="avatar-studio__hint">上传正面、光线清晰的人物或玩偶照片，Tripo 会把它转成 3D 模型。</p>
              <input
                ref={fileInputRef}
                id="avatar-photo"
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => pickImage(event.target.files?.[0])}
              />
              <button className="avatar-studio__photo-drop" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {imageData ? <img src={imageData.dataUrl} alt="已选择的照片" /> : <span className="avatar-studio__photo-empty"><Upload size={22} /> 点击选择照片</span>}
              </button>
              {imageData && (
                <button className="avatar-studio__photo-repick" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>换一张照片</button>
              )}
              <button className="avatar-studio__generate" type="button" onClick={generateFromImage} disabled={!imageData || busy || task?.status === 'submitting'}><ImagePlus size={16} /> {busy || task?.status === 'submitting' ? '正在生成…' : '用照片生成 3D 分身'} <span>↗</span></button>
            </>
          )}
          {message && <div className={`avatar-studio__message ${task?.status?.toLowerCase() === 'failed' ? 'is-error' : ''}`} role="status">{message}</div>}
        </div>

        <div className="avatar-studio__preview-card">
          <div className="avatar-studio__card-label">02 · PREVIEW</div>
          <div className={`avatar-studio__preview ${task?.assetUrl ? 'has-model' : ''}`}>
            {task?.assetUrl ? <TripoModelPreview url={task.assetUrl} className="avatar-studio__model" label="生成的 3D 分身" /> : <div className="avatar-studio__orb" aria-hidden="true"><div className="avatar-studio__avatar-head">叽</div><div className="avatar-studio__avatar-body" /></div>}
            <span className="avatar-studio__preview-note">{task?.assetUrl ? '模型已就绪' : busy ? '正在雕刻轮廓…' : '你的角色会出现在这里'}</span>
          </div>
          <div className="avatar-studio__status-row"><span><i className={busy ? 'is-busy' : task?.assetUrl ? 'is-ready' : ''} /> {busy ? `生成中 ${progress}%` : task?.assetUrl ? '已生成' : '等待创建'}</span>{task?.taskId && <code>#{task.taskId.slice(-8)}</code>}</div>
          <div className="avatar-studio__progress"><span style={{ width: `${progress}%` }} /></div>
          {task?.assetUrl && <div className="avatar-studio__asset-actions"><a href={task.assetUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> 打开模型</a><button type="button" onClick={copyAsset}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已复制' : '复制链接'}</button></div>}
        </div>
      </section>

      <footer className="avatar-studio__footer"><span>角色数据仅用于你的平台空间</span><span><Sparkles size={13} /> 后续可在更多房间使用</span></footer>
    </main>
  )
}
