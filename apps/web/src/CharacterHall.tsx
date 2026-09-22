import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Check, ChevronRight, Eye, FileText, Gavel, MessageCircle, Plus, Search, Sparkles, Users, WandSparkles } from 'lucide-react'
import './character-hall.css'
import TripoModelPreview from './TripoModelPreview'
import { findTripoAssetUrl, readTripoTask } from './tripo-assets'

export type Character = {
  id: string
  name: string
  title: string
  intro: string
  category: string
  tags: string[]
  accent: string
  emoji: string
  prompt: string
  assetUrl?: string
}

type CharacterHallProps = {
  onBack: () => void
  onEnterCourt: (character?: Character) => void
}

const CATEGORIES = ['全部', '法庭角色', '生活搭子', '奇趣生物', '故事人物']
const CUSTOM_CHARACTERS_STORAGE_KEY = 'balabala.custom-characters.v1'

const CHARACTERS: Character[] = [
  ['luna', 'Luna', '月光法官', '把复杂的心事说成一句温柔的判词。', '法庭角色', ['中立', '洞察'], '#8de4d3', '☾', '穿月白法官袍的猫咪，银色法槌'],
  ['abu', '阿布', '彩虹辩手', '擅长为每一件小事找到另一种解释。', '法庭角色', ['被告', '机灵'], '#f6c873', '◒', '蓝绿色的圆滚滚辩手，彩虹领带'],
  ['bobo', '泡泡', '证据收藏家', '随身携带一整本会发光的证据册。', '法庭角色', ['原告', '认真'], '#ce9df6', '✦', '紫色证据收藏家，背着发光文件夹'],
  ['mimi', '米米', '和事佬', '先递一杯热茶，再问双方真正想要什么。', '生活搭子', ['友善', '调停'], '#f19fbd', '☕', '粉色围巾和热茶的圆脸和事佬'],
  ['dudu', '嘟嘟', '吐槽编辑', '把争论剪成三句有节奏的金句。', '生活搭子', ['幽默', '金句'], '#ffad85', '✎', '橙色毛衣的吐槽编辑，手拿铅笔'],
  ['nana', '娜娜', '共情姐姐', '听完你的故事，帮你把情绪放回原位。', '生活搭子', ['共情', '倾听'], '#f6a8d3', '♡', '紫粉色短发的温柔倾听者'],
  ['qiuqiu', '球球', '问题侦探', '专门追问“然后呢”，直到线索连成一条线。', '故事人物', ['推理', '追问'], '#86c5ff', '⌕', '蓝色侦探帽和放大镜，卡通 3D'],
  ['kaka', '卡卡', '派对主持', '让每位观众都能在恰当的时机举手。', '生活搭子', ['主持', '热闹'], '#ffd27b', '✹', '黄色礼帽的派对主持人，明亮 3D'],
  ['mogu', '蘑菇', '雨天证人', '只在下雨天出现，记得每一滴水的声音。', '奇趣生物', ['证人', '雨天'], '#ed9fca', '🍄', '会唱歌的红色蘑菇，软胶玩具质感'],
  ['puff', 'Puff', '云朵律师', '说话轻轻的，但论点像云一样有形。', '法庭角色', ['律师', '轻盈'], '#9fd8f4', '☁', '白色云朵律师，蓝色领结，3D 卡通'],
  ['tangtang', '糖糖', '甜点证人', '关于最后一块蛋糕，她有自己的完整口供。', '奇趣生物', ['证人', '甜点'], '#f5b36d', '●', '糖果色小精灵，手捧蛋糕证据'],
  ['mocha', '摩卡', '深夜书记员', '替所有熬夜的人保存一份清醒的记录。', '法庭角色', ['记录', '夜行'], '#bc9a85', '▣', '棕色猫咪书记员，戴圆框眼镜'],
  ['xiaoyu', '小雨', '反方队长', '看到漏洞就会亮起一盏蓝色小灯。', '法庭角色', ['反驳', '敏锐'], '#79c7d7', '▲', '蓝色短发反方队长，未来感服装'],
  ['lele', '乐乐', '快乐观众', '用一枚彩色贴纸表达立场。', '生活搭子', ['观众', '活泼'], '#f5da68', '☺', '黄色连帽衫的快乐观众，贴纸风'],
  ['xiaoke', '小壳', '慢半拍蜗牛', '反应有点慢，但从不漏掉关键细节。', '奇趣生物', ['细节', '慢热'], '#99cfae', '◌', '绿色蜗牛观察员，背着小书包'],
  ['yoyo', '悠悠', '风筝诗人', '把双方的主张写成一首不会吵架的诗。', '故事人物', ['诗意', '创作'], '#d6a4f6', '⌁', '紫色风筝诗人，轻盈长围巾'],
  ['dada', '大大', '木匠邻居', '证据不够时，先帮你把桌子修好。', '生活搭子', ['务实', '修理'], '#d49668', '⌘', '木匠邻居，棕色围裙和工具箱'],
  ['xingxing', '星星', '星际访客', '来自很远的地方，带来一种全新的解释。', '奇趣生物', ['想象', '访客'], '#a99cff', '✧', '紫色星际访客，透明头盔'],
  ['ahei', '阿黑', '影子证人', '不抢镜，但总知道灯光背后的答案。', '故事人物', ['神秘', '证词'], '#8193b4', '◐', '深蓝影子证人，银色眼睛'],
  ['mango', '芒果', '热心陪审', '每次投票前，都会先问大家吃饱了吗。', '法庭角色', ['陪审', '热心'], '#ffc467', '◉', '橙黄色热心陪审，圆润卡通风'],
] .map(([id, name, title, intro, category, tags, accent, emoji, prompt]) => ({ id, name, title, intro, category, tags, accent, emoji, prompt } as Character))

function AvatarPlaceholder({ character, size = 'card' }: { character: Character; size?: 'card' | 'large' }) {
  return <div className={`character-avatar character-avatar--${size}`} style={{ '--accent': character.accent } as React.CSSProperties} aria-hidden="true"><div className="character-avatar__halo" /><div className="character-avatar__body" /><div className="character-avatar__head"><span>{character.emoji}</span></div><i /><i /></div>
}

function loadCustomCharacters(): Character[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_CHARACTERS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Character => {
      if (!item || typeof item !== 'object') return false
      const value = item as Partial<Character>
      return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.intro === 'string'
    }).slice(0, 5)
  } catch {
    return []
  }
}

export default function CharacterHall({ onBack, onEnterCourt }: CharacterHallProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [selected, setSelected] = useState<Character | null>(null)
  const [messages, setMessages] = useState<Array<{ from: 'me' | 'character'; text: string }>>([])
  const [draft, setDraft] = useState('')
  const [step, setStep] = useState(0)
  const [customPrompt, setCustomPrompt] = useState('')
  const [customName, setCustomName] = useState('我的新角色')
  const [customAccent, setCustomAccent] = useState('#9e8bf4')
  const [customStatus, setCustomStatus] = useState('')
  const [customCharacters, setCustomCharacters] = useState<Character[]>(loadCustomCharacters)

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_CHARACTERS_STORAGE_KEY, JSON.stringify(customCharacters.slice(0, 5)))
    } catch {
      // localStorage may be unavailable in private browsing; the in-memory list still works.
    }
  }, [customCharacters])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return CHARACTERS.filter((character) => (category === '全部' || character.category === category) && (!normalized || [character.name, character.title, character.intro, ...character.tags].join(' ').toLowerCase().includes(normalized)))
  }, [category, query])

  const choose = (character: Character) => { setSelected(character); setMessages([{ from: 'character', text: `你好，我是${character.name}。今天想和我聊聊“${character.title}”吗？` }]) }
  const sendMessage = () => {
    const text = draft.trim()
    if (!text || !selected) return
    setMessages((previous) => [...previous, { from: 'me', text }, { from: 'character', text: `${selected.name}：我收到了。先把这件事放到桌面上，我们一起看看它更像一条证据，还是一个需要被听见的心情。` }])
    setDraft('')
  }
  const generateCustom = async () => {
    if (!customPrompt.trim()) return
    if (customCharacters.length >= 5) {
      setCustomStatus('我的人物最多保存 5 个，请先删除一个角色再创建。')
      return
    }
    setCustomStatus('正在连接 Tripo3D…')
    try {
      const response = await fetch('/api/avatars/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'text_to_model', prompt: customPrompt.trim() }) })
      const data = await response.json() as { taskId?: string; message?: string }
      if (!response.ok || !data.taskId) throw new Error(data.message ?? '创建生成任务失败')
      const taskId = data.taskId
      const characterId = `custom-${Date.now()}`
      const character: Character = { id: characterId, name: customName.trim() || '我的新角色', title: '自定义角色', intro: customPrompt.trim(), category: '我的人物', tags: ['自定义'], accent: customAccent, emoji: '✦', prompt: customPrompt.trim() }
      setCustomCharacters((previous) => [character, ...previous].slice(0, 5))
      setCustomStatus('模型任务已提交，正在生成 3D 形象…')
      const poll = async (attempt = 0): Promise<void> => {
        if (attempt > 80) { setCustomStatus('生成时间较长，可稍后回到人物馆查看。'); return }
        try {
          const statusResponse = await fetch(`/api/avatars/tasks/${encodeURIComponent(taskId)}`)
          const payload = await statusResponse.json()
          if (!statusResponse.ok) throw new Error('暂时无法读取生成状态')
          const parsed = readTripoTask(payload)
          const status = parsed.status?.toLowerCase() ?? 'queued'
          const directAssetUrl = findTripoAssetUrl(payload)
          const assetUrl = directAssetUrl ? `/api/tripo/tasks/${encodeURIComponent(taskId)}/download.glb` : ''
          if (assetUrl) {
            // Keep the temporary Tripo URL on the server; the browser loads the
            // model through our same-origin redirect to avoid CDN CORS issues.
            const previewUrl = `/api/tripo/tasks/${encodeURIComponent(taskId)}/download.glb?asset=pbr_model`
            setCustomCharacters((previous) => previous.map((item) => item.id === characterId ? { ...item, assetUrl: previewUrl } : item))
            setCustomStatus('3D 形象生成完成，已加入我的人物。')
            return
          }
          if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) { setCustomStatus('模型生成失败，角色仍保留为占位形象。'); return }
          setCustomStatus(`正在生成 3D 形象… ${parsed.progress != null ? `${parsed.progress}%` : ''}`)
          window.setTimeout(() => { void poll(attempt + 1) }, 2600)
        } catch (error) { setCustomStatus(error instanceof Error ? error.message : '读取生成状态失败') }
      }
      window.setTimeout(() => { void poll() }, 1800)
      setStep(0)
    } catch (error) { setCustomStatus(error instanceof Error ? error.message : '生成失败，请稍后再试') }
  }

  const renameCustomCharacter = (character: Character) => {
    const nextName = window.prompt('为人物输入新名字', character.name)?.trim()
    if (!nextName || nextName === character.name) return
    setCustomCharacters((previous) => previous.map((item) => item.id === character.id ? { ...item, name: nextName } : item))
    setSelected((current) => current?.id === character.id ? { ...current, name: nextName } : current)
  }

  const deleteCustomCharacter = (character: Character) => {
    if (!window.confirm(`确定删除「${character.name}」吗？`)) return
    setCustomCharacters((previous) => previous.filter((item) => item.id !== character.id))
    setSelected((current) => current?.id === character.id ? null : current)
  }

  return <main className="character-hall">
    <header className="character-hall__topbar"><button type="button" className="character-hall__back" onClick={onBack} aria-label="返回平台空间"><span className="character-hall__brand-mark" /> <b>BalaBala</b></button><nav className="character-hall__nav" aria-label="平台模块导航"><button type="button" className="is-active">角色档案</button><button type="button" onClick={onBack}>场景</button><button type="button" disabled>社区</button></nav><button type="button" className="character-hall__court" onClick={() => onEnterCourt(selected ?? undefined)}><Gavel size={15} aria-hidden="true" /> 进入趣味法庭 {selected ? `· ${selected.name}` : ''} <ChevronRight size={14} aria-hidden="true" /></button></header>
    <section className="character-hall__hero"><div><span className="character-hall__kicker"><Users size={13} /> DIGITAL CAST · 角色档案</span><h1>认识你的角色，<em>开始一段关系。</em></h1><p>浏览人物、创建分身，再把喜欢的角色带进任何场景。</p></div><div className="character-hall__hero-stat"><strong>{CHARACTERS.length + customCharacters.length}</strong><span>可用人物</span></div></section>
    <section className="character-hall__orb-stage" aria-label="精选人物"><div className="character-hall__orb-row">{CHARACTERS.slice(0, 6).map((character) => <button type="button" key={character.id} className={`character-hall__orb ${selected?.id === character.id ? 'is-active' : ''}`} style={{ '--orb-color': character.accent } as React.CSSProperties} onClick={() => choose(character)} aria-label={`选择${character.name}`}><span>{character.emoji}</span><b>{character.name}</b></button>)}</div><div className="character-hall__orb-caption"><span>当前选择</span><strong style={{ color: (selected ?? CHARACTERS[0]).accent }}>{(selected ?? CHARACTERS[0]).name}</strong><small>{(selected ?? CHARACTERS[0]).title}</small></div></section>
    <section className="character-hall__toolbar"><label className="character-hall__search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名字、性格或标签" /></label><div className="character-hall__filters">{CATEGORIES.map((item) => <button type="button" key={item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><button type="button" className="character-hall__create" onClick={() => setStep(1)}><Plus size={15} /> 创建人物</button></section>
    {customCharacters.length > 0 && <section className="character-hall__my"><div className="character-hall__section-head"><div><span>MY CAST</span><h2>我的人物</h2></div><small>{customCharacters.length}/5 · 角色会自动保存在本机</small></div><div className="character-hall__my-grid">{customCharacters.map((character) => <div className="character-hall__my-card" key={character.id}><button type="button" className="character-hall__my-main" onClick={() => choose(character)} aria-label={`查看人物 ${character.name}`}>{character.assetUrl ? <TripoModelPreview url={character.assetUrl} className="character-hall__model" label={`${character.name} 3D 模型`} /> : <AvatarPlaceholder character={character} size="card" />}<span><b>{character.name}</b><small>{character.intro}</small></span></button><div className="character-hall__my-actions"><button type="button" onClick={() => renameCustomCharacter(character)} aria-label={`重命名 ${character.name}`}>重命名</button><button type="button" onClick={() => deleteCustomCharacter(character)} aria-label={`删除 ${character.name}`}>删除</button></div></div>)}</div></section>}
    <section className="character-hall__section-head character-hall__library-head"><div><span>THE CAST</span><h2>预置人物</h2></div><small>{filtered.length} 位角色可选择</small></section>
    <section className="character-hall__grid">{filtered.map((character) => <button type="button" className="character-card" key={character.id} onClick={() => choose(character)}><AvatarPlaceholder character={character} /><div className="character-card__copy"><div><b>{character.name}</b><span>{character.title}</span></div><p>{character.intro}</p><footer>{character.tags.map((tag) => <i key={tag}>{tag}</i>)}<strong>对话 ↗</strong></footer></div></button>)}</section>
    {filtered.length === 0 && <div className="character-hall__empty"><Bot size={24} /><h2>还没有找到这位角色</h2><p>试试换一个名字，或者创建一个全新的角色。</p><button type="button" onClick={() => setStep(1)}>创建人物</button></div>}
    {selected && <div className="character-dialog-backdrop" onClick={() => setSelected(null)}><section className="character-dialog" role="dialog" aria-modal="true" aria-labelledby="character-dialog-title" onClick={(event) => event.stopPropagation()}><button type="button" className="character-dialog__close" onClick={() => setSelected(null)} aria-label="关闭人物详情">×</button><div className="character-dialog__profile">{selected.assetUrl ? <TripoModelPreview url={selected.assetUrl} className="character-dialog__model" label={`${selected.name} 3D 模型`} /> : <AvatarPlaceholder character={selected} size="large" />}<div><span>{selected.category}</span><h2 id="character-dialog-title">{selected.name}</h2><b>{selected.title}</b><p>{selected.intro}</p><div>{selected.tags.map((tag) => <i key={tag}>{tag}</i>)}</div></div></div><div className="character-dialog__chat" aria-live="polite">{messages.map((message, index) => <div className={`character-chat ${message.from}`} key={`${message.from}-${index}`}><span>{message.from === 'me' ? '你' : selected.name}</span><p>{message.text}</p></div>)}</div><div className="character-dialog__composer"><input aria-label="发送消息" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendMessage() }} placeholder="和角色说点什么…" /><button type="button" onClick={sendMessage}><MessageCircle size={15} aria-hidden="true" /> 发送</button></div><button type="button" className="character-dialog__court" onClick={() => onEnterCourt(selected)}><Gavel size={15} aria-hidden="true" /> 带 {selected.name} 进入趣味法庭 <ChevronRight size={15} aria-hidden="true" /></button></section></div>}
    {step > 0 && <div className="character-create-backdrop"><section className="character-create" role="dialog" aria-modal="true" aria-labelledby="character-create-title"><div className="character-create__head"><div><span>CREATE YOUR CAST · {step}/3</span><h2 id="character-create-title">三步创建新人物</h2></div><button type="button" onClick={() => { setStep(0); setCustomStatus('') }} aria-label="关闭创建人物">×</button></div><div className="character-create__steps" aria-label={`创建步骤 ${step}/3`}><i className={step >= 1 ? 'is-active' : ''}>1</i><span /><i className={step >= 2 ? 'is-active' : ''}>2</i><span /><i className={step >= 3 ? 'is-active' : ''}>3</i></div>{step === 1 && <div className="character-create__body"><label>给角色取一个名字<input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="例如：小满" /></label><label>一句话描述它<input value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="例如：会讲冷笑话的蓝色机器人" /></label><button type="button" className="character-create__next" onClick={() => setStep(2)} disabled={!customPrompt.trim()}>下一步 <ChevronRight size={15} aria-hidden="true" /></button></div>}{step === 2 && <div className="character-create__body"><label>选择角色主色<div className="character-colors">{['#9e8bf4', '#7ce8dc', '#ffb985', '#f19fbd', '#9fd8f4'].map((color) => <button type="button" key={color} aria-label={`选择颜色 ${color}`} className={customAccent === color ? 'is-active' : ''} style={{ background: color }} onClick={() => setCustomAccent(color)} />)}</div></label><div className="character-create__preview"><AvatarPlaceholder character={{ id: 'preview', name: customName, title: '预览', intro: customPrompt, category: '我的人物', tags: [], accent: customAccent, emoji: '✦', prompt: customPrompt }} size="large" /><span>{customName || '我的新角色'}</span></div><button type="button" className="character-create__next" onClick={() => setStep(3)}>下一步 <ChevronRight size={15} aria-hidden="true" /></button></div>}{step === 3 && <div className="character-create__body"><div className="character-create__final"><Check size={22} aria-hidden="true" /><h3>{customName || '我的新角色'}</h3><p>{customPrompt}</p></div><button type="button" className="character-create__next" onClick={() => { void generateCustom() }}><WandSparkles size={15} aria-hidden="true" /> 保存并生成 3D 形象</button>{customStatus && <p className="character-create__status" role="status" aria-live="polite">{customStatus}</p>}</div>}</section></div>}
  </main>
}
