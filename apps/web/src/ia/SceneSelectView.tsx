/**
 * R5-IA 场景选择页（/scenes）：六大场景卡片列表。
 * 卡片列表页 = cards 模式：显示底部 MainTabBar，不显示全屏返回。
 * 点击卡片进入 /scene/:sceneId（全屏对局）。
 */
import { SCENE_META, type SceneId } from '@balabala/shared'
import './ia.css'

export type SceneSelectViewProps = {
  /** 点击某个场景卡片，进入对应全屏对局。 */
  onEnterScene: (sceneId: SceneId) => void
}

export default function SceneSelectView({ onEnterScene }: SceneSelectViewProps) {
  return (
    <div className="iascenes">
      <header className="iascenes__head">
        <h1 className="iascenes__title">选一个场景开场</h1>
        <p className="iascenes__sub">六大趣味场景，点进去就能玩。</p>
      </header>
      <div className="iascenes__grid">
        {SCENE_META.map((scene) => (
          <button
            key={scene.id}
            type="button"
            className="iascenes__card"
            onClick={() => onEnterScene(scene.id)}
          >
            <span className="iascenes__emoji" aria-hidden="true">{scene.emoji}</span>
            <span className="iascenes__label">{scene.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
