// ===== R5: 队友头顶标识 =====
//
// 纯组件 + CSS：3D 场景中把它绝对定位到队友头顶（由 3D 层投影 avatar 屏幕坐标后挂载）。
// 队徽颜色 + 队长皇冠 + 准备状态 + 说话高亮（VAD）。
// 云端无 WebGL：3D 投影/挂载需真机确认，本组件只负责渲染一个浮标。

export interface TeammateBadgeProps {
  nickname: string
  /** 是否为队长。 */
  isLeader?: boolean
  /** 是否已准备。 */
  ready?: boolean
  /** 是否正在说话（VAD 高亮）。 */
  speaking?: boolean
  /** 队伍主色（默认明黄）。 */
  teamColor?: string
}

export function TeammateBadge({
  nickname,
  isLeader,
  ready,
  speaking,
  teamColor = '#FFD600',
}: TeammateBadgeProps) {
  return (
    <div style={{ ...styles.badge, ...(speaking ? styles.speaking : {}) }}>
      <span style={{ ...styles.dot, background: teamColor }} />
      {isLeader && <span style={styles.crown}>👑</span>}
      <span style={styles.name}>{nickname}</span>
      {ready && <span style={styles.check}>✓</span>}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  badge: {
    position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'rgba(0,0,0,.72)', color: '#EDEDF0',
    borderRadius: 999, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap',
    border: '1px solid rgba(255,255,255,.15)',
  },
  speaking: { boxShadow: '0 0 0 2px #4fb3a5' },
  dot: { width: 8, height: 8, borderRadius: 4, display: 'inline-block' },
  crown: { fontSize: 11 },
  name: { fontWeight: 600 },
  check: { color: '#4fb3a5' },
}
