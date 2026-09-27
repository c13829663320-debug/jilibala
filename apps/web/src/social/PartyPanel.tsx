// ===== R5: 组队面板 =====
// 成员列表 + 准备状态 + 邀请好友 + 队长选场景/开始按钮。
// 品牌色沿用好友面板：纯黑底 + 明黄 #FFD600 + 青绿 #4fb3a5。
// 注：云端无 GPU，UI 仅做组件实现，需真机确认布局。
import type { Friend, SceneId } from '@balabala/shared'
import { SCENE_META } from '@balabala/shared'
import type { UsePartyResult } from './useParty'

export interface PartyPanelProps {
  party: UsePartyResult
  /** 可邀请的好友列表（通常在线好友）。 */
  friends: Friend[]
  /** 我自己的 userId（用于在成员列表标注「（我）」）。 */
  myUserId: string
}

export function PartyPanel({ party, friends, myUserId }: PartyPanelProps) {
  const { party: state, isLeader, amReady, invites } = party

  return (
    <aside style={styles.panel}>
      <h3 style={styles.title}>组队开黑</h3>

      {/* 待处理邀请 */}
      {invites.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>组队邀请 {invites.length}</div>
          {invites.map((inv) => (
            <div key={inv.inviteId} style={styles.inviteRow}>
              <span style={styles.name}>{inv.fromNickname} 邀你组队{inv.message ? `：${inv.message}` : ''}</span>
              <button style={styles.acceptBtn} onClick={() => party.acceptInvite(inv)}>加入</button>
              <button style={styles.rejectBtn} onClick={() => party.declineInvite(inv.inviteId)}>忽略</button>
            </div>
          ))}
        </div>
      )}

      {!state && (
        <div style={styles.empty}>
          <div style={{ marginBottom: 8 }}>还没有队伍，创建一支叫上好友一起开局吧</div>
          <button style={styles.primaryBtn} onClick={party.createParty}>创建队伍</button>
        </div>
      )}

      {state && (
        <>
          <div style={styles.meta}>
            状态：{state.status === 'forming' ? '组人中' : state.status === 'in-game' ? '已开局' : '已解散'}
            {state.sceneId ? ` · 目标 ${sceneLabel(state.sceneId)}` : ''}
          </div>

          <div style={styles.section}>
            {state.members.map((m) => (
              <div key={m.userId} style={styles.memberRow}>
                <span style={styles.crown}>{m.isLeader ? '👑' : ''}</span>
                <span style={styles.name}>{m.nickname}{m.userId === myUserId ? '（我）' : ''}</span>
                <span style={{ ...styles.readyDot, background: m.status === 'ready' ? '#4fb3a5' : '#555' }} />
                <span style={styles.readyText}>{m.status === 'ready' ? '已准备' : '未准备'}</span>
              </div>
            ))}
          </div>

          {/* 我的准备按钮 */}
          <button
            style={{ ...styles.readyBtn, background: amReady ? '#4fb3a5' : 'transparent', color: amReady ? '#000' : '#4fb3a5' }}
            onClick={party.toggleReady}
          >
            {amReady ? '取消准备' : '准备'}
          </button>

          {/* 队长区：选场景 + 开始 */}
          {isLeader && state.status === 'forming' && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>选择场景</div>
              <div style={styles.sceneGrid}>
                {SCENE_META.map((s) => (
                  <button
                    key={s.id}
                    style={{
                      ...styles.sceneBtn,
                      ...(state.sceneId === s.id ? styles.sceneActive : {}),
                    }}
                    onClick={() => party.chooseScene(s.id as SceneId)}
                  >
                    {s.emoji} {s.label}
                  </button>
                ))}
              </div>
              <button
                style={{ ...styles.primaryBtn, opacity: allReady(state.members) && state.sceneId ? 1 : 0.4 }}
                disabled={!(allReady(state.members) && state.sceneId)}
                onClick={party.startGame}
                title={!state.sceneId ? '请先选择场景' : !allReady(state.members) ? '等待全员准备' : '全员就绪，开局！'}
              >
                开始游戏
              </button>
            </div>
          )}

          {/* 邀请好友 */}
          {isLeader && state.status === 'forming' && friends.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>邀请好友入队</div>
              {friends.filter((f) => f.status === 'online' && !state.members.some((m) => m.userId === f.userId)).map((f) => (
                <div key={f.userId} style={styles.inviteRow}>
                  <span style={styles.name}>{f.nickname}</span>
                  <button style={styles.iconBtn} onClick={() => party.inviteFriend(f.userId)}>邀请</button>
                </div>
              ))}
            </div>
          )}

          <div style={styles.footer}>
            {isLeader
              ? <button style={styles.dangerBtn} onClick={party.disbandParty}>解散队伍</button>
              : <button style={styles.dangerBtn} onClick={party.leaveParty}>离开队伍</button>}
          </div>
        </>
      )}
    </aside>
  )
}

function sceneLabel(id: SceneId): string {
  return SCENE_META.find((s) => s.id === id)?.label ?? id
}

function allReady(members: Array<{ status: string }>): boolean {
  return members.length > 0 && members.every((m) => m.status === 'ready')
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#000', color: '#EDEDF0', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 12, padding: 12, width: 280, fontSize: 13,
  },
  title: { margin: '0 0 8px', fontSize: 14, color: '#FFD600' },
  meta: { color: 'rgba(237,237,240,.6)', fontSize: 12, marginBottom: 8 },
  section: { marginTop: 8 },
  sectionTitle: { color: '#4fb3a5', marginBottom: 4 },
  empty: { color: 'rgba(237,237,240,.6)', padding: 8, textAlign: 'center' },
  inviteRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' },
  memberRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.05)' },
  crown: { width: 16 },
  name: { flex: 1 },
  readyDot: { width: 8, height: 8, borderRadius: 4, display: 'inline-block' },
  readyText: { color: 'rgba(237,237,240,.5)', fontSize: 11 },
  sceneGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 },
  sceneBtn: { background: '#141414', border: '1px solid rgba(255,255,255,.15)', color: '#EDEDF0', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', fontSize: 11, textAlign: 'left' },
  sceneActive: { borderColor: '#FFD600', color: '#FFD600' },
  primaryBtn: { background: '#FFD600', border: 'none', color: '#000', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, width: '100%' },
  readyBtn: { border: '1px solid #4fb3a5', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', marginTop: 8, width: '100%' },
  acceptBtn: { background: '#4fb3a5', border: 'none', color: '#000', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  rejectBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,.3)', color: '#EDEDF0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  iconBtn: { background: 'transparent', border: '1px solid #4fb3a5', color: '#4fb3a5', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  dangerBtn: { background: 'transparent', border: '1px solid rgba(255,107,107,.5)', color: '#ff6b6b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11 },
  footer: { marginTop: 10, textAlign: 'right' },
}
