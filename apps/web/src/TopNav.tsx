import { VoiceToggleButton } from './voice-settings'
import { useIdentity } from './identity'

/**
 * 统一顶部导航：左侧品牌 + 三大入口（人物 / 场景 / 广场），
 * 右侧语音开关、用户头像（点击进入「我的」）。
 * 法庭页不使用本导航（法庭自带 court-topbar）；品牌与「场景」均回到场景选择首页。
 */
export type TopView = 'court' | 'characters' | 'plaza' | 'mypage' | 'video' | 'archive' | 'talkshow' | 'werewolf' | 'bar' | 'library' | 'gym' | 'home' | 'scene-studio' | 'my-scenes'

export type TopNavProps = {
  currentView: TopView
  onNavigate: (view: TopView) => void
}

const NAV_ITEMS: Array<{ view: TopView; label: string }> = [
  { view: 'characters', label: '人物' },
  { view: 'home', label: '场景' },
  { view: 'scene-studio', label: '创造' },
  { view: 'plaza', label: '广场' },
]

/** 首页与各场景内页（法庭/脱口秀/狼人杀/酒吧/图书馆/健身房）高亮「场景」导航；创造工作室高亮「创造」。 */
const activeNavView = (v: TopView): TopView => {
  if (v === 'talkshow' || v === 'werewolf' || v === 'bar' || v === 'library' || v === 'gym' || v === 'court' || v === 'home') return 'home'
  if (v === 'scene-studio' || v === 'my-scenes') return 'scene-studio'
  return v
}

export default function TopNav({ currentView, onNavigate }: TopNavProps) {
  const navActive = activeNavView(currentView)
  const { user } = useIdentity()
  const nickname = user?.nickname ?? '我'
  const isPhoto = user?.avatarType === 'photo' && Boolean(user.avatarRef)
  return (
    <header className="topnav">
      <button type="button" className="topnav__brand" onClick={() => onNavigate('home')} title="回到场景首页">
        <img className="topnav__mark" src="/brand/balabala-mark.jpg?v=2" alt="叽里呱啦" />
        <span className="topnav__brand-text">
          <span className="topnav__brand-name">叽里呱啦</span>
          <span className="topnav__brand-sub">BALA BALA</span>
        </span>
      </button>

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
        <span className="topnav__status"><span className="topnav__dot" /> 在线</span>
        <VoiceToggleButton className="topnav__voice" />
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
