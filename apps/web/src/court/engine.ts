// Court Engine 接口:与 REST 端点一一对应。
// 唯一生产实现见 http-engine.ts(HttpCourtEngine)——直连 /api/court/* 真实后端。
// 历史上的 mockEngine 已删除:AI 不可用时显式报错,绝不静默兜底假数据。
import type {
  AnalyzeCaseInput, ContinueSignal, CourtCase, CourtRecordSummary, CourtTurn,
  CourtVerdict, EvidenceItem, PlayerInput, Perspective, RealVerdictResult, RoundScript,
} from './types'

export interface CourtEngineClient {
  /** S1→S3:案件分析(建案 DRAFT → AI 分析 → GENERATED)。 */
  analyzeCase(input: AnalyzeCaseInput): Promise<CourtCase>

  /** S4:确认案件(GENERATED → CONFIRMED)。 */
  confirmCase?(): Promise<void>

  /** S5:开始庭审(POST /start,SSE 流)。幂等,重复调用安全。 */
  startTrial?(): Promise<void>

  /** S5:构建第 N 轮辩论剧本(缓冲 SSE,该轮 turns 收齐后 resolve)。 */
  buildRound(
    courtCase: CourtCase,
    round: number,
    playerInputs: PlayerInput[],
    previousRecord?: CourtRecordSummary,
  ): Promise<RoundScript>

  /** S5:一轮结束后查询「是否继续下一轮」(后端 should_continue 事件)。 */
  waitForContinue?(): Promise<ContinueSignal>

  /** S5:最后陈述剧本(后端无独立最后陈述流,等待判决流收尾)。 */
  buildFinalStatements(
    courtCase: CourtCase,
    playerInputs: PlayerInput[],
    records: CourtRecordSummary[],
  ): Promise<{ turns: CourtTurn[] }>

  /** S5→S6:等待真实 AI 判决(court_verdict 事件 / GET verdict)。 */
  requestRealVerdict(
    description: string,
    evidence: EvidenceItem[],
  ): Promise<RealVerdictResult | null>

  /** 玩家输入入队(POST /player-input,非阻塞)。 */
  submitPlayerInput?(input: { playerRole: 'plaintiff' | 'defendant'; type: 'argument' | 'evidence' | 'question'; content: string; evidenceName?: string }): Promise<void>

  /** 释放 SSE 流。 */
  dispose?(): void
}

export type { Perspective }
