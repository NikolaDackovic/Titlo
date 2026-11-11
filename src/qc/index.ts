import { checkFormatting } from './checks/formatting'
import { checkLanguage } from './checks/language'
import { checkReadability } from './checks/readability'
import { checkTerminology } from './checks/terminology'
import { checkTiming } from './checks/timing'
import { checkTranscript } from './checks/transcript'
import type { QcInput, QcIssue, QcSeverity } from './types'

export * from './types'
export { QC_PROFILES, getQcProfile } from './profiles'
export { flaggedSegmentIds, TRANSCRIPT_CHECKS } from './checks/transcript'

const SEVERITY_ORDER: Record<QcSeverity, number> = { error: 0, warning: 1, suggestion: 2 }

/** Run all QC checks. Pure function: never modifies segments. */
export function runQc(input: QcInput): QcIssue[] {
  const issues = [
    ...checkTranscript(input),
    ...checkTiming(input),
    ...checkReadability(input),
    ...checkLanguage(input),
    ...checkTerminology(input),
    ...checkFormatting(input),
  ]
  return issues.sort(
    (a, b) =>
      (a.segmentNumber ?? Number.MAX_SAFE_INTEGER) - (b.segmentNumber ?? Number.MAX_SAFE_INTEGER) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
}

export function summarize(issues: QcIssue[]) {
  return {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    suggestion: issues.filter((i) => i.severity === 'suggestion').length,
  }
}
