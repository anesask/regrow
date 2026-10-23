import { useT } from '@/lib/i18n'
import { CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Milestone, PlotResult, Results } from '@/lib/api'
import { orderedEntries } from '@/lib/format'
import { cssVar } from '@/theme'

const tick = { fontSize: 11, fill: cssVar('fg.muted'), fontFamily: '"IBM Plex Mono", monospace' }
const shortPeriod = (p: string) => (p === 'pre' ? 'Jul 21' : p === 'post' ? 'Sep 21' : p)
const tooltip = {
  contentStyle: { background: cssVar('surface'), border: `1px solid ${cssVar('hairline')}`, borderRadius: 8, fontSize: 12 },
  labelStyle: { color: cssVar('fg'), fontWeight: 600 },
}
const legend = { wrapperStyle: { fontSize: 12, paddingTop: 8 } }
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100))
const qLabel = (q: string) => (q === '2021Q3' ? 'Fire' : `${q.slice(4)} ${q.slice(0, 4)}`)

/**
 * Recovery vs. controls over time: quarterly satellite pulse (thin) and the summer composites that recovery
 * milestones pay on (thick), with the check-in period and milestone targets.
 */
export function RecoveryChart({ result, milestones }: { result: PlotResult; milestones: Milestone[] }) {
  const { t } = useT()
  const pulse = (result.pulse ?? []).filter((p) => p.phase === 'post' || p.phase === 'fire')
  const data = pulse.map((p) => {
    const year = p.q.slice(0, 4)
    const summer = p.q.endsWith('Q3') && result.periods[year] ? pct(result.periods[year].adj) : null
    return { q: p.q, quarterly: p.phase === 'fire' ? 0 : pct(p.adj), summer: p.phase === 'fire' ? 0 : summer }
  })
  const values = data.flatMap((d) => [d.quarterly, d.summer]).filter((x): x is number => x != null)
  const floor = Math.floor(Math.min(0, ...values) / 25) * 25
  const ticks = Array.from({ length: (100 - floor) / 25 + 1 }, (_, i) => floor + i * 25)
  const checkins = milestones.filter((m) => m.kind === 'checkin')
  const targets = milestones.filter((m) => m.kind === 'recovery' && m.targetBps)

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 16, right: 12, left: floor < 0 ? -4 : -16, bottom: 0 }}>
        <CartesianGrid stroke={cssVar('hairline')} vertical={false} />
        {checkins.length > 0 && (
          <ReferenceArea
            x1={checkins[0].period}
            x2={checkins.at(-1)!.period}
            fill={cssVar('brand.solid')}
            fillOpacity={0.06}
            label={{ value: t('quarterly check-ins'), position: 'insideTop', fontSize: 10.5, fill: cssVar('brand.fg') }}
          />
        )}
        <XAxis
          dataKey="q"
          tick={tick}
          axisLine={false}
          tickLine={false}
          interval={0}
          tickFormatter={(q: string) => (q === '2021Q3' ? 'Fire' : q.endsWith('Q1') ? q.slice(0, 4) : '')}
        />
        <YAxis tick={tick} axisLine={false} tickLine={false} unit="%" domain={[floor, 110]} ticks={ticks} />
        {floor < 0 && <ReferenceLine y={0} stroke={cssVar('hairlineStrong')} />}
        <Tooltip {...tooltip} labelFormatter={(q) => qLabel(String(q))} formatter={(v) => (v == null ? '-' : `${v}%`)} />
        <Legend {...legend} />
        {targets.map((m) => (
          <ReferenceLine
            key={m.idx}
            y={(m.targetBps ?? 0) / 100}
            stroke={cssVar('ember')}
            strokeDasharray="4 4"
            label={{ value: `${m.label} target ${(m.targetBps ?? 0) / 100}% · ${m.period}`, position: 'insideTopLeft', fontSize: 10.5, fill: cssVar('ember') }}
          />
        ))}
        <Line isAnimationActive={false} type="monotone" dataKey="quarterly" name={t('Quarterly pulse')} stroke={cssVar('brand.solid')} strokeOpacity={0.45} strokeWidth={1.5} dot={false} connectNulls />
        <Line isAnimationActive={false} type="linear" dataKey="summer" name={t('Summer composite (pays milestones)')} stroke={cssVar('brand.solid')} strokeWidth={2.75} dot={{ r: 4, fill: cssVar('surface'), strokeWidth: 2.5 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Raw NBR of the plot against the mean of its matched controls (twins), or of the regional controls if it has none. */
export function NbrChart({ result, controlIds, results }: { result: PlotResult; controlIds: string[]; results: Results }) {
  const { t } = useT()
  const data = orderedEntries(result.periods).map(([p, v]) => {
    const ctrl = controlIds.map((id) => results[id]?.periods[p]?.nbr).filter((x): x is number => x != null)
    const twin = result.twins?.nbr[p]
    return {
      period: shortPeriod(p),
      plot: +v.nbr.toFixed(3),
      control: twin != null ? +twin.toFixed(3) : ctrl.length ? +(ctrl.reduce((a, b) => a + b, 0) / ctrl.length).toFixed(3) : null,
    }
  })
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 16, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid stroke={cssVar('hairline')} vertical={false} />
        <XAxis dataKey="period" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
        <Tooltip {...tooltip} />
        <Legend {...legend} />
        <Line isAnimationActive={false} type="monotone" dataKey="plot" name={t('This plot (NBR)')} stroke={cssVar('brand.solid')} strokeWidth={2.5} dot={{ r: 3.5 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="control" name={result.twins ? `${t('Matched controls')} (${result.twins.ids.length} ${t('twins')})` : t('Unburned controls')} stroke={cssVar('ash')} strokeWidth={1.5} strokeDasharray="5 4" dot={{ r: 2.5 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}
