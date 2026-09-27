/**
 * R5-IA 底部主 Tab 导航：广场 / 人物 / 场景 三主页面固定切换。
 *
 * 显示规则（由 App 层根据路由决定是否挂载本组件）：
 *  - 卡片列表页（广场 / 人物馆 / 场景选择）→ 显示；
 *  - 全屏对局路由（/scene/*）→ 不挂载（隐藏），改由 SceneShell 提供返回按钮。
 *
 * 样式统一引用 design-tokens.css 的 CSS 变量，不硬编码颜色。
 */
import { MAIN_TABS, type MainTab } from '@balabala/shared'
import './ia.css'

export type MainTabBarProps = {
  /** 当前所在主 Tab。 */
  current: MainTab
  /** 切换到某个主 Tab。 */
  onNavigate: (tab: MainTab) => void
}

export default function MainTabBar({ current, onNavigate }: MainTabBarProps) {
  return (
    <nav className="iatabbar" aria-label="主导航">
      {MAIN_TABS.map((item) => (
        <button
          key={item.tab}
          type="button"
          className={`iatabbar__item ${current === item.tab ? 'is-active' : ''}`}
          aria-current={current === item.tab ? 'page' : undefined}
          onClick={() => onNavigate(item.tab)}
        >
          <span className="iatabbar__dot" aria-hidden="true" />
          <span className="iatabbar__label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
