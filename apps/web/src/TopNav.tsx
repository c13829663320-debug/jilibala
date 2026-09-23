import { RotateCcw } from 'lucide-react'

/**
 * 统一顶部导航：左侧品牌 + 三大入口（角色档案 / 场景 / 广场），
 * 右侧案卷库、重置、用户头像。庭审页也复用同一条导航并高亮当前位置。
 */
export type TopView = 'court' | 'characters' | 'plaza' | 'mypage' | 'video' | 'archive' | 'talkshow' | 'bar' | 'library'

export type TopNavProps = {
  currentView: TopView
  onNavigate: (view: TopView) => void
  /** 庭审页内不重复展示「案卷库」「重置」等动作时可置 true（当前默认全展示） */
  inCourtroom?: boolean
  onOpenArchive?: () => void
  onReset?: () => void
}

const NAV_ITEMS: Array<{ view: TopView; label: string }> = [
  { view: 'characters', label: '角色档案' },
  { view: 'court', label: '场景' },
  { view: 'plaza', label: '广场' },
]

/** 场景内页（脱口秀/酒吧/图书馆）高亮「场景」导航。 */
const activeNavView = (v: TopView): TopView =>
  v === 'talkshow' || v === 'bar' || v === 'library' ? 'court' : v

export default function TopNav({ currentView, onNavigate, inCourtroom, onOpenArchive, onReset }: TopNavProps) {
  const navActive = activeNavView(currentView)
  return (
    <header className="topnav">
      <div className="topnav__brand" onClick={() => onNavigate('court')} role="button" tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter') onNavigate('court') }}>
        <img className="topnav__mark" src="/brand/balabala-mark-clean.jpg" alt="BalaBala" />
        <div className="topnav__brand-text">
          <div className="topnav__brand-name">叽里呱啦</div>
          <div className="topnav__brand-sub">BALA BALA · SOCIAL COURT</div>
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
        <button type="button" className="topnav__archive" onClick={onOpenArchive}>案卷库</button>
        <button type="button" className="topnav__icon" title="重置体验" onClick={onReset}><RotateCcw size={16} /></button>
        <div className="topnav__avatar">林<span>△</span></div>
      </div>
    </header>
  )
}
