// ===== R5: 名人图鉴收集进度（纯函数，便于单测） =====
import { CELEBRITIES, type CelebrityField } from '@balabala/shared'
import { isAcquainted, type CelebrityRelation } from '@balabala/shared'

/** 单个领域的收集进度。 */
export interface FieldProgress {
  field: CelebrityField
  total: number
  met: number
}

/** 全量收集进度。 */
export interface CollectionProgress {
  /** 名人总数。 */
  total: number
  /** 已结识数（关系档位 ≥ acquainted）。 */
  met: number
  /** 收集率 0–100（四舍五入整数）。 */
  percent: number
  /** 按领域拆分。 */
  byField: FieldProgress[]
  /** 已有至少一位名人结识的领域数。 */
  unlockedFields: number
}

/** 统计收集进度。relations 为 celebrityId → 关系 的映射。 */
export function computeCollectionProgress(
  relations: Record<string, CelebrityRelation> | undefined | null,
): CollectionProgress {
  const rel = relations ?? {}
  const fields: CelebrityField[] = ['科技', '商业', '科学', '文学', '艺术', '哲学', '政治']

  const byField: FieldProgress[] = fields.map((field) => {
    const inField = CELEBRITIES.filter((c) => c.field === field)
    const met = inField.filter((c) => isAcquainted(rel[c.id])).length
    return { field, total: inField.length, met }
  })

  const total = CELEBRITIES.length
  const met = byField.reduce((sum, f) => sum + f.met, 0)
  const percent = total === 0 ? 0 : Math.round((met / total) * 100)
  const unlockedFields = byField.filter((f) => f.met > 0).length

  return { total, met, percent, byField, unlockedFields }
}

/** 某位名人在图鉴中是否已结识。 */
export function isCelebrityMet(
  celebrityId: string,
  relations: Record<string, CelebrityRelation> | undefined | null,
): boolean {
  return isAcquainted(relations?.[celebrityId])
}

/** 未结识名人的解锁提示文案。 */
export function unlockHintFor(celebrityId: string, relations: Record<string, CelebrityRelation> | undefined | null): string {
  const rel = relations?.[celebrityId]
  if (isAcquainted(rel)) return '已结识'
  return '首次与 TA 对话或同台，即可解锁'
}
