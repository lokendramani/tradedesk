export type WealthNAVRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'
export type WealthNAVUIStatus = 'NONE' | 'RUNNING' | 'STALE' | 'SUCCESS' | 'PARTIAL' | 'FAILED'

export interface WealthNAVRunState {
  status: WealthNAVRunStatus
  run_age_seconds: number
}

export function getWealthNAVUIStatus(
  run: WealthNAVRunState | null,
  staleAfterSeconds: number,
  elapsedSinceStatusSeconds = 0,
): WealthNAVUIStatus {
  if (!run) return 'NONE'
  if (run.status !== 'RUNNING') return run.status
  const age = run.run_age_seconds + elapsedSinceStatusSeconds
  return age > staleAfterSeconds ? 'STALE' : 'RUNNING'
}

export function canTriggerWealthNAVUpdate(
  isAdmin: boolean,
  submitting: boolean,
  uiStatus: WealthNAVUIStatus,
): boolean {
  return isAdmin && !submitting && uiStatus !== 'RUNNING'
}
