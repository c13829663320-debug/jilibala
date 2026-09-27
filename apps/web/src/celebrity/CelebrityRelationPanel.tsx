// ===== R5: 名人详情页的关系 / 好感 / 回忆面板 =====
// 自包含：内部用 relation + memory hooks，CharacterHall 只需传 celebrityId。
import { getCelebrity } from '@balabala/shared'
import { useCelebrityRelation } from './useCelebrityRelation'
import { useCelebrityMemory } from './useCelebrityMemory'
import { MEMORY_IMPORTANCE_LABEL } from './memoryImportance'
import AffinityBar from './AffinityBar'

export interface CelebrityRelationPanelProps {
  celebrityId: string
  /** 自定义人物不展示关系面板。 */
  isCustom?: boolean
}

export function CelebrityRelationPanel({ celebrityId, isCustom = false }: CelebrityRelationPanelProps) {
  const { getRelation } = useCelebrityRelation()
  const { getMemories } = useCelebrityMemory()

  if (isCustom) return null
  const celeb = getCelebrity(celebrityId)
  if (!celeb) return null

  const relation = getRelation(celebrityId)
  const memories = getMemories(celebrityId)

  return (
    <div
      style={{
        marginTop: 16,
        padding: '14px 16px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: 1, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>
        我们的关系
      </div>

      {relation ? (
        <>
          <AffinityBar affection={relation.affection} level={relation.acquaintanceLevel} />
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
            <span>互动 {relation.interactionCount} 次</span>
            {relation.unlockedTopics.length > 0 && <span>话题 {relation.unlockedTopics.length}</span>}
            {relation.unlockedLines.length > 0 && <span>彩蛋 {relation.unlockedLines.length}</span>}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
          还没结识 TA。第一次对话或同台后，这里会显示你们的好感与回忆。
        </div>
      )}

      {memories.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 1, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            我们的回忆（{memories.length}）
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {memories.slice(0, 5).map((m) => (
              <li
                key={m.id}
                style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.8)', paddingLeft: 10, borderLeft: '2px solid rgba(255,255,255,0.2)' }}
              >
                <div>{m.text}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                  {m.context} · {MEMORY_IMPORTANCE_LABEL[m.importance]}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default CelebrityRelationPanel
