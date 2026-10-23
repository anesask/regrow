import { useQuery } from '@tanstack/react-query'
import type { Polygon } from 'geojson'

// Data contract shared with backend/pipeline (03_define_plots.py, 04_compute_scores.py).

export type PlanType = 'NATURAL_REGEN' | 'ASSISTED'
export type SeverityClass = 'unburned' | 'low' | 'moderate-low' | 'moderate-high' | 'high'

export interface PlotProps {
  id: string
  name: string
  kind: 'plot' | 'control'
  chainId: number | null // on-chain plot id (null for controls)
  planType: PlanType | null
  areaHa: number
  severity: { meanDnbr: number; class: SeverityClass; pctByClass: Record<SeverityClass, number> }
  controlIds: string[]
  centroid: [number, number] // lon, lat
}

export interface PlotFeature {
  type: 'Feature'
  geometry: Polygon
  properties: PlotProps
}

export interface PlotCollection {
  type: 'FeatureCollection'
  features: PlotFeature[]
}

export interface YearStats {
  ndvi: number
  nbr: number
  rr: number | null // recovery ratio (plots only)
  adj: number | null // control-adjusted recovery (plots only)
}

export type MilestoneKind = 'baseline' | 'checkin' | 'recovery'
/** Expected on-chain result, simulated by the pipeline from the satellite scores. */
export type Outcome = 'paid' | 'partial' | 'missed' | 'fail' | 'not reached'

export interface Milestone {
  idx: number
  kind: MilestoneKind
  label: string
  period: string // '2021' | '2022Q1' | '2023' …
  bps: number // share of the plot's funds settled at this milestone
  targetBps: number | null // score for the full tranche (recovery milestones)
  failBelowBps: number | null // fraction of target below which the plot fails
  scoreBps: number
  fractionBps: number // share of the tranche the steward earns
  outcome: Outcome
  evidenceHash: `0x${string}`
  netDrop?: number | null // check-ins: net NBR drop vs controls
  inconclusive?: boolean | null
  ci95?: number // recovery: 95% interval half-width (fraction)
  confident?: boolean // recovery: score clearly above/below target
  scenes?: number // Sentinel-2 scenes behind the verdict
}

export interface PulsePoint {
  q: string // '2022Q1'
  phase?: 'pre' | 'fire' | 'post'
  nbr: number | null
  ctrlNbr?: number | null
  adj?: number | null
}

export interface PlotResult {
  chainId: number | null
  periods: Record<string, YearStats> // 'pre' | 'post' | '2022'..'2026'
  milestones: Milestone[]
  pulse?: PulsePoint[]
  disturbance: { flagged: boolean; year: string | null; drop: number | null; evidenceHash: `0x${string}` | null } | null
  twins?: { method: string; ids: string[]; nbr: Record<string, number> } // matched controls behind the annual scores
}

export interface Certificate {
  tokenId: number
  ref: string
  plotId: number
  plotKey: string | null
  plotName: string
  funder: `0x${string}`
  amount: number
  share: number
  tier: 'Seedling' | 'Sapling' | 'Grove' | 'Forest'
  status: 'Active' | 'Paused' | 'Failed' | 'Completed'
  statusLabel: string
  milestonesDone: number
  milestonesTotal: number
  fractions: (number | null)[]
  releasedShare: number
  refundedShare: number
  mintedAt: number
  severity: SeverityClass | null
  areaHa: number | null
}

export type Results = Record<string, PlotResult>

export const API_URL = import.meta.env.VITE_API_URL || '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status}`)
  return res.json() as Promise<T>
}

export const imageUrl = (plotId: string, period: string, kind: 'rgb' | 'nbr' = 'rgb') =>
  `${API_URL}/data/img/${plotId}/${period}_${kind}.webp`

export const evidenceUrl = (plotId: string, kind: string) => `${API_URL}/data/evidence/${plotId}-${kind}.json`

export interface ChainEvent {
  event: string
  args: Record<string, string | number | boolean>
  blockNumber: number
  timestamp: number
  txHash: `0x${string}`
  logIndex: number
}

export interface BacktestPlots {
  plots: Record<string, { risk: number; outcome: string }>
}
export const useBacktest = () =>
  useQuery({ queryKey: ['backtest'], queryFn: () => fetch(`${API_URL}/data/backtest.json`).then((r) => r.json() as Promise<BacktestPlots>), staleTime: Infinity })

export const usePlots = () => useQuery({ queryKey: ['plots'], queryFn: () => get<PlotCollection>('/plots') })
export const useResults = () => useQuery({ queryKey: ['results'], queryFn: () => get<Results>('/results') })
export const certificateImage = (tokenId: number) => `${API_URL}/certificates/${tokenId}/image.svg`

export const useCertificates = (funder?: string) =>
  useQuery({
    enabled: funder === undefined || /^0x[0-9a-fA-F]{40}$/.test(funder),
    queryKey: ['certificates', funder ?? 'all'],
    queryFn: () => get<Certificate[]>(funder ? `/certificates?funder=${funder}` : '/certificates'),
    refetchInterval: 20_000,
  })

/** By link reference (or, for old links, token id). */
export const useCertificate = (id: string) =>
  useQuery({
    queryKey: ['certificate', id],
    queryFn: () => get<Certificate>(`/certificates/${id}?view=full`),
    enabled: /^([1-9][0-9]{0,7}|[0-9a-f]{12})$/.test(id),
    retry: false,
  })

export const useEvents = (chainId?: number | null) =>
  useQuery({
    queryKey: ['events', chainId ?? 'all'],
    queryFn: () =>
      get<{ deployed: boolean; events: ChainEvent[] }>(chainId == null ? '/events' : `/events?plotId=${chainId}`),
    refetchInterval: 15_000,
  })

// ------------------------------------------------------------------ AI (advisory text grounded in the evidence)
export interface AiReports {
  method: { model: string; check: string; generatedAt: string }
  plots: Record<string, { verified: boolean; en?: string; de?: string; tr?: string }>
}
export const useAiReports = () =>
  useQuery({
    queryKey: ['ai-reports'],
    queryFn: () => fetch(`${API_URL}/data/ai_reports.json`).then((r) => (r.ok ? (r.json() as Promise<AiReports>) : null)),
    staleTime: Infinity,
  })
export const useAiStatus = () =>
  useQuery({ queryKey: ['ai-status'], queryFn: () => get<{ configured: boolean; available: boolean; model: string | null }>('/ai/status'), staleTime: 60_000, retry: false })
/** The facts sheet an AI text is written from; every number in the text must appear here. */
export type PlotFacts = {
  recovery_by_summer_pct: Record<string, number>
  milestones: ({ milestone: string } & Record<string, unknown>)[]
  payout_schedule: string
} & Record<string, unknown>
export const usePlotFacts = (plotId: string) =>
  useQuery({ queryKey: ['facts', plotId], queryFn: () => get<PlotFacts>(`/plots/${plotId}/facts`), staleTime: Infinity, retry: false })
export const askPlot = (plotId: string, question: string, lang: string) =>
  post<{ answer: string | null; verified: boolean }>(`/plots/${plotId}/ask`, { question, lang })
