// ===== R5: 语音指示器 =====
// 谁在说话高亮 + 音量条 + 本地静音开关。
// 纯展示组件；数据由 useVoiceActivity 提供。
import type { VoiceSpeaker } from './useVoiceActivity'

export interface VoiceIndicatorProps {
  speakers: VoiceSpeaker[]
  /** userId -> 昵称（外层注入）。 */
  nicknameOf: (userId: string) => string
  localMuted: boolean
  onToggleMute: () => void
}

export function VoiceIndicator({ speakers, nicknameOf, localMuted, onToggleMute }: VoiceIndicatorProps) {
  const active = speakers.filter((s) => s.speaking)
  return (
    <div style={styles.wrap}>
      <div style={styles.title}>
        🎙 语音
        <button
          style={{ ...styles.muteBtn, ...(localMuted ? styles.muteOn : {}) }}
          onClick={onToggleMute}
          title={localMuted ? '取消静音' : '静音'}
        >
          {localMuted ? '🔇' : '🎤'}
        </button>
      </div>
      {speakers.length === 0 && <div style={styles.empty}>房间里还没有人说话</div>}
      {speakers.slice(0, 6).map((s) => (
        <div key={s.userId} style={styles.row}>
          <span style={{ ...styles.dot, background: s.speaking ? '#4fb3a5' : '#555' }} />
          <span style={styles.name}>{nicknameOf(s.userId)}</span>
          <div style={styles.barTrack}>
            <div style={{ ...styles.barFill, width: `${Math.round(s.intensity * 100)}%` }} />
          </div>
        </div>
      ))}
      {active.length > 0 && <div style={styles.speakingNow}>正在说话：{active.map((s) => nicknameOf(s.userId)).join('、')}</div>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    background: 'rgba(0,0,0,.72)', color: '#EDEDF0', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 10, padding: 8, minWidth: 180, fontSize: 11,
  },
  title: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#FFD600', marginBottom: 4 },
  muteBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, padding: '0 6px', cursor: 'pointer' },
  muteOn: { borderColor: '#ff6b6b' },
  empty: { color: 'rgba(237,237,240,.4)', padding: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' },
  dot: { width: 7, height: 7, borderRadius: 4, display: 'inline-block' },
  name: { width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  barTrack: { flex: 1, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', background: '#4fb3a5' },
  speakingNow: { marginTop: 4, color: '#4fb3a5' },
}
