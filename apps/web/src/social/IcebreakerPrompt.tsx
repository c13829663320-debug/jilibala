// ===== R5: 陌生人破冰话题卡片 =====
// 同房间出现陌生人时弹出，按场景/在场名人领域推荐话题。
// 点击话题即通过 onSendTopic 发到房间聊天（由外层接线）。
import { useMemo } from 'react'
import type { CelebrityField, SceneId } from '@balabala/shared'
import { generateIcebreakerTopics } from './icebreaker'

export interface IcebreakerPromptProps {
  sceneId?: SceneId
  celebrityFields?: CelebrityField[]
  hasTeammate?: boolean
  /** 点击某话题后回调（外层可把它发到房间聊天）。 */
  onSendTopic?: (topic: string) => void
  onClose?: () => void
}

export function IcebreakerPrompt({ sceneId, celebrityFields, hasTeammate, onSendTopic, onClose }: IcebreakerPromptProps) {
  const topics = useMemo(
    () => generateIcebreakerTopics({ sceneId, celebrityFields, hasTeammate }),
    [sceneId, celebrityFields, hasTeammate],
  )

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>💬 破冰话题</span>
        {onClose && <button style={styles.close} onClick={onClose}>×</button>}
      </div>
      <div style={styles.hint}>和房间里还不认识的人，从一句话题开始吧</div>
      {topics.map((t) => (
        <button key={t} style={styles.topicBtn} onClick={() => onSendTopic?.(t)}>
          {t}
        </button>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#000', color: '#EDEDF0', border: '1px solid rgba(255,214,0,.4)',
    borderRadius: 12, padding: 12, width: 260, fontSize: 12,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#FFD600', fontWeight: 600 },
  hint: { color: 'rgba(237,237,240,.5)', margin: '4px 0 8px' },
  topicBtn: {
    display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
    background: '#141414', border: '1px solid rgba(255,255,255,.12)', color: '#EDEDF0',
    borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
  },
  close: { background: 'transparent', border: 'none', color: '#EDEDF0', fontSize: 16, cursor: 'pointer' },
}
