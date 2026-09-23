import { RotateCcw } from 'lucide-react'
import { VoiceToggleButton } from './voice-settings'
import { useIdentity } from './identity'

/**
 * 统一顶部导航：左侧品牌 + 三大入口（人物 / 场景 / 广场），
 * 右侧语音开关、重置、用户头像（点击进入「我的」）。庭审页复用同一条导航。
 */
export type TopView = 'court' | 'characters' | 'plaza' | 'mypage' | 'video' | 'archive' | 'talkshow' | 'werewolf' | 'bar' | 'library' | 'gym'

export type TopNavProps = {
  currentView: TopView
  onNavigate: (view: TopView) => void
  /** 庭审页内可置 true，状态文案显示「庭审进行中」 */
  inCourtroom?: boolean
  onOpenArchive?: () => void
  onReset?: () => void
}

const NAV_ITEMS: Array<{ view: TopView; label: string }> = [
  { view: 'characters', label: '人物' },
  { view: 'court', label: '场景' },
  { view: 'plaza', label: '广场' },
]

/** 场景内页（脱口秀/酒吧/图书馆）高亮「场景」导航。 */
const activeNavView = (v: TopView): TopView =>
  v === 'talkshow' || v === 'werewolf' || v === 'bar' || v === 'library' || v === 'gym' ? 'court' : v

export default function TopNav({ currentView, onNavigate, inCourtroom, onReset }: TopNavProps) {
  const navActive = activeNavView(currentView)
  const { user } = useIdentity()
  const nickname = user?.nickname ?? '我'
  const isPhoto = user?.avatarType === 'photo' && Boolean(user.avatarRef)
  return (
    <header className="topnav">
      <div className="topnav__brand" onClick={() => onNavigate('court')} role="button" tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter') onNavigate('court') }}>
        <img className="topnav__mark" src="/brand/balabala-mark.jpg" alt="BalaBala" />
        <div className="topnav__brand-text">
          <div className="topnav__brand-name">叽里呱啦</div>
          <div className="topnav__brand-sub">BALA BALA</div>
        </div>
      </div>

      <nav className="topnav__links" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`topnav__link ${navActive === item.view ? 'is-active' : ''}`}
            aria-current={navActive === item.view ? 'page' : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="topnav__actions">
        <span className="topnav__status"><span className="topnav__dot" /> {inCourtroom ? '庭审进行中' : '在线'}</span>
        <VoiceToggleButton className="topnav__voice" />
        <button type="button" className="topnav__icon" title="重置体验" onClick={onReset}><RotateCcw size={16} /></button>
        <button
          type="button"
          className="topnav__avatar"
          title="我的（点击查看资料 / 上传头像）"
          onClick={() => onNavigate('mypage')}
        >
          {isPhoto
            ? <img src={user.avatarRef} alt={nickname} />
            : nickname.trim().slice(0, 1).toUpperCase()}
        </button>
      </div>
    </header>
  )
}
