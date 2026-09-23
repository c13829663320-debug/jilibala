// BalaBala 趣味法庭 · 庭内交互数据对象（UI 层）
// 与后端 @balabala/shared 的 CourtCase/CourtTurn/CourtVerdict 解耦；
// HttpCourtEngine 负责后端类型 <-> 本文件类型的双向映射。
import type { Verdict } from '@balabala/shared'

/** 玩家游戏视角(= 3D 机位),不是账号身份,庭审中可随时切换。 */
export type Perspective = 'plaintiff' | 'audience' | 'defendant'

/** 庭审角色:法官/原告/被告/辩护人/证人。 */
export type CourtRoleType = 'judge' | 'plaintiff' | 'defendant' | 'defender' | 'witness'

/** 案件状态机。 */
export type CourtCaseStatus =
  | 'DRAFT' | 'ANALYZING' | 'GENERATED' | 'CONFIRMED' | 'IN_PROGRESS' | 'JUDGING' | 'COMPLETED'

/** 证据(文字/图片/文档)。 */
export interface EvidenceItem {
  id: string
  type: 'text' | 'image' | 'document'
  name: string
  size?: number
  mime?: string
  content?: string
  url?: string
}

/** 案件事实:AI 从用户输入抽取的结构化事实,非用户原话。 */
export interface Fact {
  id: string
  content: string
  source: 'user_input' | 'user_stance' | string /* evidence id */
  disputed?: boolean
}

/** 原告/被告/法官角色。 */
export interface CourtRole {
  id: string
  roleType: Exclude<CourtRoleType, 'witness' | 'defender'>
  name: string
  title: string
  /** 核心立场一句话。 */
  position: string
  description: string
  /** 形象主色(对应 3D 头像/卡片色块)。 */
  accent: string
  emoji?: string
  knowledgeBaseId: string
}

/** 证据书 = 角色案件知识库,后续 AI 辩论的上下文基础。 */
export interface KnowledgeBase {
  id: string
  roleType: Exclude<CourtRoleType, 'witness' | 'defender'>
  /** 立场(= role.position 的展开)。 */
  position: string
  /** 认定的核心事实。 */
  facts: string[]
  /** 主要支持观点。 */
  claims: string[]
  /** 已形成的论证。 */
  arguments: string[]
  /** 推断与假设。 */
  assumptions: string[]
  /** 已有证据名。 */
  evidence: string[]
  /** 可能的对方反驳(预判)。 */
  possibleRebuttals: string[]
  /** 玩家补充(入队后由后端写入 KB.user_additions)。 */
  userAdditions?: string[]
}

/** 法庭每一次发言(一个 Turn)。 */
export interface CourtTurn {
  id: string
  round: number
  speaker: CourtRoleType
  /** 后端 speakerId(法官='judge'/原被告=role id/辩护人=celebrity id)。 */
  speakerId?: string
  speakerName: string
  content: string
  /** 引用的证据 id。 */
  referencedEvidence?: string[]
  /** 回应的目标发言 id。 */
  responseTo?: string | null
  /** 法官小结标记。 */
  isRecord?: boolean
  createdAt: string
}

/** 法官持续维护的案件记录(逐轮更新)。 */
export interface CourtRecordSummary {
  round: number
  plaintiffPoint: string
  defendantPoint: string
  judgeNote: string
  /** 仍未解决的争议点。 */
  unresolvedPoints: string[]
}

/** 玩家介入:向某一方 AI 提供新的「弹药」,不直接替 AI 说话。 */
export interface PlayerInput {
  id: string
  playerRole: Perspective
  type: 'opinion' | 'evidence'
  content: string
  evidence?: EvidenceItem[]
  /** 证据提交给哪一方(观众站队时也用)。 */
  targetSide?: 'plaintiff' | 'defendant'
  createdAt: string
}

/** 判决书:沿用后端 Verdict 字段,保证分享/广场发布端点兼容。 */
export type CourtVerdict = Verdict & {
  /** 展示用扩展字段(后端真引擎可补)。 */
  focusPoints?: string[]
  plaintiffArguments?: string
  defendantArguments?: string
  judgeAnalysis?: string
  /** 后端结构化判决结果:原告胜/被告胜/折中/驳回。 */
  outcome?: 'plaintiff' | 'defendant' | 'mixed' | 'dismissed'
}

/** 一场法庭(案件,UI 层)。 */
export interface CourtCase {
  id: string
  title: string
  description: string
  /** 可选的用户立场一句话。 */
  stance?: string
  evidence: EvidenceItem[]
  facts: Fact[]
  disputePoints: string[]
  plaintiff: CourtRole
  defendant: CourtRole
  /** 法官角色(展示用)。 */
  judge: CourtRole
  knowledgeBases: { plaintiff: KnowledgeBase; defendant: KnowledgeBase }
  status: CourtCaseStatus
  currentRound: number
  createdAt: string
  verdict?: CourtVerdict
  /** 后端真实案件 id(判决书走真实 API 时写入,用于分享/广场发布)。 */
  backendCaseId?: string
}

/** 分析输入。 */
export interface AnalyzeCaseInput {
  description: string
  stance?: string
  evidence: EvidenceItem[]
  /** 原告名字(可选,默认由所选 3D 分身决定)。 */
  plaintiffName?: string
}

/** 构建一轮剧本的结果。 */
export interface RoundScript {
  turns: CourtTurn[]
  record: CourtRecordSummary
}

/** 后端真实判决获取结果。 */
export interface RealVerdictResult {
  backendCaseId: string
  verdict: CourtVerdict
}

/** 一轮结束后的「是否继续」信号(后端 should_continue 事件)。 */
export interface ContinueSignal {
  shouldContinue: boolean
  unresolvedPoints: string[]
  reason?: string
}
