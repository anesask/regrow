import type { SeverityClass } from './api'

export const PERIOD_LABEL: Record<string, string> = {
  pre: 'Jul 2021 · before',
  post: 'Sep 2021 · after fire',
}
/** Periods in time order. JS objects list number-like keys ('2022') before 'pre'/'post', so never rely on key order. */
const periodRank = (p: string) => (p === 'pre' ? 0 : p === 'post' ? 1 : Number(p))
export const sortPeriods = (ps: string[]) => [...ps].sort((a, b) => periodRank(a) - periodRank(b))
export const orderedEntries = <T>(o: Record<string, T>) => sortPeriods(Object.keys(o)).map((p) => [p, o[p]] as [string, T])

export const periodLabel = (p: string) => PERIOD_LABEL[p] ?? `Summer ${p}`

export const SEVERITY_LABEL: Record<SeverityClass, string> = {
  unburned: 'Unburned',
  low: 'Low',
  'moderate-low': 'Moderate-low',
  'moderate-high': 'Moderate-high',
  high: 'High',
}

/** Chakra colour tokens per severity class. */
export const SEVERITY_TOKEN: Record<SeverityClass, string> = {
  unburned: 'sev.unburned',
  low: 'sev.low',
  'moderate-low': 'sev.modlow',
  'moderate-high': 'sev.modhigh',
  high: 'sev.high',
}

export const shortHash = (h: string, n = 6) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h)
export const pct = (v: number | null | undefined, digits = 0) => (v == null ? '-' : `${(v * 100).toFixed(digits)}%`)

/** Short name for a milestone index in the standard 7-step schedule. */
export const milestoneName = (idx: number) =>
  idx === 0 ? 'Start' : idx <= 4 ? `Check-in ${idx}` : idx === 5 ? 'Early recovery' : 'Sustained recovery'
