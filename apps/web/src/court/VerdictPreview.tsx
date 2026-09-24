import { useEffect, useState } from 'react'
import './court.css'
import VerdictScreen from './screens/VerdictScreen'
import { backendCaseToUi, backendVerdictToUi } from './http-engine'
import type { CourtCase, CourtVerdict } from './types'

const noop = () => {}

export default function VerdictPreview({ caseId }: { caseId: string }) {
  const [data, setData] = useState<{ c: CourtCase; v: CourtVerdict } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const [cr, vd] = await Promise.all([
          fetch(`/api/court/cases/${encodeURIComponent(caseId)}?perspective=audience`).then((r) => r.json()),
          fetch(`/api/court/cases/${encodeURIComponent(caseId)}/verdict`).then((r) => r.json()),
        ])
        if (!cr.case) throw new Error('no case')
        if (!vd.verdict) throw new Error('no verdict')
        if (on) setData({ c: backendCaseToUi(cr.case), v: backendVerdictToUi(vd.verdict) })
      } catch (e) {
        if (on) setErr(e instanceof Error ? e.message : 'load fail')
      }
    })()
    return () => { on = false }
  }, [caseId])

  if (err) return <div style={{ padding: 40 }}>{err}</div>
  if (!data) return null
  return (
    <VerdictScreen
      courtCase={data.c}
      verdict={data.v}
      onSaveArchive={noop}
      onOpenArchive={noop}
      onPublishToPlaza={noop}
      onNewTrial={noop}
      onExit={noop}
    />
  )
}
