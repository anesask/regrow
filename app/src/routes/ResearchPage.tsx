import { Box, Button, Grid, HStack, SimpleGrid, Skeleton, Stack, Table, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Reveal } from '@/components/motion'
import { Figure, Mono, Page, PageHeader, secondaryButton, Surface } from '@/components/ui'
import { API_URL } from '@/lib/api'
import { fill, useT } from '@/lib/i18n'
import { cssVar } from '@/theme'

// ---- data written by the pipeline (backend/pipeline/08, 10, 11, 12)
type Hist = { x: number; n: number }[]
type Roc = [number, number][]
type Outcome = 'restored' | 'partial' | 'failed'
interface Backtest {
  summary: { cells: number; bySeverity: Record<string, Record<Outcome, number>> }
  model: { aucModel: number; aucBaseline: number; roc: { model: Roc; baseline: Roc } }
}
interface Robustness {
  donorCells: number
  burnedCells: number
  covariates: string[]
  balance: { smdBefore: number[]; smdAfter: number[] }
  regionalVsMatched: {
    medianAdj2026: [number, number]
    outcomeAgreement: number
    controlDrift: Record<string, { regionalControls: number; allUnburnedForest: number }>
  }
  placebo: { cells: number; flagged: number; falseFlagRate: number; noiseRecoveryPoints: number; maxDropHist: Hist }
  kSensitivity: { k: number; medianAdj2026: number }[]
  trajectories: Record<string, { cells: number; series: { year: string; p25: number; median: number; p75: number }[] }>
  adj2026Hist: { regional: Hist; matched: Hist }
}
interface Hansen {
  product: string
  fire: { gfcLoss2021InsidePerimeter: number; bySeverity: Record<string, { forestHa: number; lostIn2021: number }> }
  detector: {
    cells: number
    clearedCells: number
    rocAucMaxDrop: number
    roc: Roc
    thresholds: { threshold: number; flagged: number; precision: number; recall: number; falseFlagRate: number }[]
  }
  survivors: {
    meanLaterLossHa: { checkinDamaged: number; passed: number }
    rocAuc: number
    bySeverityOutcome: { severity: string; outcome: Outcome; cells: number; meanLaterLossHa: number }[]
  }
}
interface Landsat {
  cells: number
  '2023': { pearsonR: number; medianAbsDiff: number; targetAgreement: number; scatter: [number, number][] }
  '2026': { pearsonR: number; medianAbsDiff: number; targetAgreement: number; scatter: [number, number][] }
}
interface Validation {
  iou: number
  oursHa: number
  modisHa: number
}

const getJson = <T,>(path: string) =>
  fetch(`${API_URL}/data/${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} (${r.status})`)
    return r.json() as Promise<T>
  })
// one quick retry, then the page says what failed instead of loading forever
const useData = <T,>(file: string) => useQuery({ queryKey: ['research', file], queryFn: () => getJson<T>(file), staleTime: Infinity, retry: 1 })

// ---- chart styling (same as the plot charts)
const tick = { fontSize: 11, fill: cssVar('fg.muted'), fontFamily: '"IBM Plex Mono", monospace' }
const tooltip = {
  contentStyle: { background: cssVar('surface'), border: `1px solid ${cssVar('hairline')}`, borderRadius: 8, fontSize: 12 },
  labelStyle: { color: cssVar('fg'), fontWeight: 600 },
}
const legend = { wrapperStyle: { fontSize: 12, paddingTop: 8 } }
const barCursor = { fill: 'rgba(128,128,128,0.12)' }
const grid = <CartesianGrid stroke={cssVar('hairline')} vertical={false} />
const OUTCOME_COLOR: Record<Outcome, string> = { restored: '#1a9c6a', partial: '#e7b04a', failed: '#bf3a2b' }
const SEV_COLOR: Record<string, string> = { 'moderate-low': '#e7b04a', 'moderate-high': '#d9772b', high: '#9c2f22' }
const SEVERITIES = ['moderate-low', 'moderate-high', 'high']
const SHORT: Record<string, string> = { unburned: 'unburned', low: 'low', 'moderate-low': 'mod-low', 'moderate-high': 'mod-high', high: 'high' }
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`
/** Fills `{name}` placeholders in a translated string. */
/** Like `fill`, but the placeholders become React nodes (inline code, links). */
const rich = (s: string, v: Record<string, ReactNode>) => s.split(/\{(\w+)\}/g).map((p, i) => (i % 2 ? <Fragment key={i}>{v[p]}</Fragment> : p))
const COVARIATE_LABEL: Record<string, string> = {
  preNbr: 'Pre-fire NBR',
  preNdvi: 'Pre-fire NDVI',
  elev: 'Elevation',
  slope: 'Slope',
  northness: 'Faces north',
}

/** Every chart behind the claims on this site, drawn from the pipeline outputs. */
export default function ResearchPage() {
  const bt = useData<Backtest>('backtest.json')
  const rob = useData<Robustness>('robustness.json')
  const han = useData<Hansen>('hansen.json')
  const val = useData<Validation>('validation.json')
  const ls = useData<Landsat>('landsat.json')
  const ready = bt.data && rob.data && han.data && val.data && ls.data
  const failed = [bt, rob, han, val, ls].filter((q) => q.isError)
  const { t } = useT()

  return (
    <Page>
      <PageHeader eyebrow={t('Research')} title={t('Does the engine measure what it claims?')}>
        {t('We tested every part of the satellite engine against independent data and against itself: NASA burned area and the Hansen/UMD global forest-loss map, a placebo test on healthy forest, and a backtest of the payout rules on all 534 burned forest cells of the Manavgat fire. Every chart is drawn from the published pipeline output, and each one names the script that reproduces it.')}
      </PageHeader>
      {failed.length > 0 ? (
        <Surface>
          <Text fontWeight="600">{t('The research data could not be loaded.')}</Text>
          <Text fontSize="small" color="fg.muted" mt="1">
            {fill(t('Missing: {list}. The server may be restarting.'), { list: failed.map((q) => (q.error as Error).message).join(', ') })}
          </Text>
          <Button {...secondaryButton} size="sm" mt="4" onClick={() => failed.forEach((q) => q.refetch())}>
            {t('Try again')}
          </Button>
        </Surface>
      ) : !ready ? (
        <Skeleton h="600px" borderRadius="card" />
      ) : (
        <Content bt={bt.data} rob={rob.data} han={han.data} val={val.data} ls={ls.data} />
      )}
    </Page>
  )
}

function Content({ bt, rob, han, val, ls }: { bt: Backtest; rob: Robustness; han: Hansen; val: Validation; ls: Landsat }) {
  const [regionalMedian, matchedMedian] = rob.regionalVsMatched.medianAdj2026
  const cur = han.detector.thresholds.find((t) => t.threshold === 0.15)!
  const alt = han.detector.thresholds.find((t) => t.threshold === 0.1)!
  const { t } = useT()

  return (
    <Stack gap="10">
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="4">
        <Surface>
          <Figure value={val.iou.toFixed(2)} label={t("Overlap with NASA's fire map")} hint={fill(t('IoU · {ours} ha vs {modis} ha (MODIS)'), { ours: val.oursHa.toLocaleString(), modis: val.modisHa.toLocaleString() })} />
        </Surface>
        <Surface>
          <Figure value={pct(rob.placebo.falseFlagRate, 2)} label={t('Healthy forest falsely flagged')} hint={fill(t('{flagged} of {cells} cells (placebo test)'), { flagged: rob.placebo.flagged, cells: rob.placebo.cells.toLocaleString() })} />
        </Surface>
        <Surface>
          <Figure value={han.detector.rocAucMaxDrop.toFixed(2)} label={t('Damage signal vs real clearings (AUC)')} hint={fill(t('{cleared} cleared of {cells} forest cells'), { cleared: han.detector.clearedCells, cells: han.detector.cells.toLocaleString() })} />
        </Surface>
        <Surface>
          <Figure value={bt.model.aucModel.toFixed(2)} label={t('Early warning by end of 2022 (AUC)')} hint={fill(t('one-variable baseline {auc}'), { auc: bt.model.aucBaseline.toFixed(2) })} />
        </Surface>
      </SimpleGrid>

      {/* 1. Recovery */}
      <Section n="1" title={t('How the burned forest came back')} lead={t('Recovery is the share of the fire’s vegetation loss that has returned, net of the change in each cell’s matched unburned twins.')}>
        <Chart
          title={t('Recovery over five summers, by burn severity')}
          axes={t("↑ recovery, % of the fire's vegetation loss regained · → summer")}
          takeaway={fill(t('Median recovery reached {median} by 2026. Severely burned slopes recovered fastest: Turkish red pine reseeds after a crown fire.'), { median: pct(matchedMedian) })}
          source="11_matched_controls.py"
        >
          <Trajectories rob={rob} />
        </Chart>
        <Chart
          title={t('Backtest outcome by burn severity')}
          axes={t('↑ number of 64 ha cells · → burn severity')}
          takeaway={t('Failures concentrate on moderate-low severity slopes, where trees survived the fire. The next chart shows why.')}
          source="08_backtest.py"
        >
          <OutcomesBySeverity bt={bt} />
        </Chart>
        <Chart
          title={t('Why slopes fail: trees lost after the fire')}
          axes={t('↑ surviving trees lost 2022-2025, ha per 64 ha cell · → burn severity')}
          takeaway={t('Failed slopes lost far more of their surviving trees in 2022-2025 (Hansen/UMD), from delayed mortality or logging. That is what stewards are paid to prevent.')}
          source="12_hansen.py"
        >
          <LaterLoss han={han} />
        </Chart>
        <Chart
          title={t('Distribution of 2026 recovery, all 534 burned cells')}
          axes={t('↑ number of cells · → recovery by 2026, %')}
          takeaway={fill(t('Old regional controls vs matched twins: matching shifts the median from {from} to {to}; {changed} of cells change outcome, all towards less payout.'), { from: pct(regionalMedian), to: pct(matchedMedian), changed: pct(1 - rob.regionalVsMatched.outcomeAgreement) })}
          source="11_matched_controls.py"
        >
          <RecoveryHist rob={rob} />
        </Chart>
      </Section>

      {/* 2. Fire map */}
      <Section n="2" title={t('Do other satellites agree?')} lead={t('Independent products and sensors, made by other teams, compared with our Sentinel-2 measurements.')}>
        <Chart
          title={t('Recovery measured by Landsat 8/9 vs Sentinel-2')}
          axes={t('↑ recovery by Landsat 8/9, % · → recovery by Sentinel-2, %')}
          takeaway={fill(t('Each dot is one of {cells} burned cells, 2026 recovery against the same matched twins. A different satellite gives the same answer: r = {r}, typical difference {diff} points, same pass/fail at the target for {agree} of cells.'), { cells: ls.cells, r: ls['2026'].pearsonR.toFixed(3), diff: Math.round(ls['2026'].medianAbsDiff * 100), agree: pct(ls['2026'].targetAgreement, 1) })}
          source="13_landsat.py"
        >
          <CrossSensor points={ls['2026'].scatter} />
        </Chart>
        <Chart
          title={t('Our severity classes vs Hansen/UMD tree-cover loss in 2021')}
          axes={t('↑ forest that Hansen records as lost in 2021, % · → our burn severity')}
          takeaway={fill(t('The more severe our map says a fire was, the more often Hansen records the forest as lost. {share} of all 2021 forest loss in the area lies inside our perimeter.'), { share: pct(han.fire.gfcLoss2021InsidePerimeter) })}
          source="12_hansen.py"
        >
          <SeverityVsHansen han={han} />
        </Chart>
      </Section>

      {/* 3. Matched controls */}
      <Section n="3" title={t('Is the comparison fair?')} lead={t('Each burned cell is compared with its own 10 unburned twins, chosen only on pre-fire vegetation and terrain.')}>
        <Chart
          title={t('Covariate balance before and after matching')}
          axes={t('→ standardised mean difference (0 = alike, within ±0.1 = balanced)')}
          takeaway={t('Standardised mean difference between burned cells and their controls. Matching brings every covariate near the usual 0.1 bar, and the result barely moves with the number of twins.')}
          source="11_matched_controls.py"
        >
          <Balance rob={rob} />
          <TwinCounts rob={rob} />
        </Chart>
        <Chart
          title={t('Why we replaced the old controls')}
          axes={t('↑ change in NBR (vegetation index) since July 2021 · → summer')}
          takeaway={t('NBR change since before the fire. The three regional controls of v1 greened less than unburned forest as a whole, so v1 gave plots credit for weather.')}
          source="11_matched_controls.py"
        >
          <Drift rob={rob} />
        </Chart>
      </Section>

      {/* 4. Damage detector */}
      <Section n="4" title={t('Does the damage detector work?')} lead={t('A damage flag pauses payouts, so false alarms are costly. We tested it on healthy forest and against real clearings.')}>
        <Chart
          title={t('Placebo: healthy forest treated as a funded plot')}
          axes={t('↑ number of healthy cells · → largest yearly NBR drop, net of twins')}
          takeaway={fill(t('Largest year-over-year vegetation drop of {cells} unburned forest cells, net of their twins. Only {flagged} cross the 0.15 flag line; noise is about ±{noise} recovery points.'), { cells: rob.placebo.cells.toLocaleString(), flagged: rob.placebo.flagged, noise: rob.placebo.noiseRecoveryPoints })}
          source="11_matched_controls.py"
        >
          <PlaceboHist rob={rob} />
        </Chart>
        <Chart
          title={t('Detector vs real clearings (Hansen/UMD 2022-2025)')}
          axes={t('↑ real clearings found, % · → healthy cells flagged, %')}
          takeaway={fill(t('On unburned forest, the drop signal ranks cells that were really cleared above the rest with AUC {auc}.'), { auc: han.detector.rocAucMaxDrop.toFixed(2) })}
          source="12_hansen.py"
        >
          <RocChart found={t('of real clearings found')} wrong={t('of healthy cells flagged')} lines={[{ name: fill(t('Drop signal (AUC {auc})'), { auc: han.detector.rocAucMaxDrop.toFixed(2) }), points: han.detector.roc, color: cssVar('brand.solid') }]} />
        </Chart>
        <Chart
          title={t('Choosing the flag threshold')}
          takeaway={fill(t('A lower line catches more clearings but pauses more healthy forest. The current 0.15 is cautious ({recall} recall). At 0.10 the flag would find {altRecall} of clearings with {precision} precision while pausing only {paused} of healthy cells. Smaller damage is caught by the quarterly check-ins.'), { recall: pct(cur.recall), altRecall: pct(alt.recall), precision: pct(alt.precision), paused: pct(alt.falseFlagRate, 2) })}
          source="12_hansen.py"
        >
          <Thresholds han={han} />
        </Chart>
        <Chart
          title={t('Quarterly check-ins vs later tree loss')}
          axes={t('↑ surviving trees lost 2022-2025, ha per 64 ha cell')}
          takeaway={fill(t('Burned slopes whose check-ins flagged damage lost {damaged} ha of surviving trees by 2025 (Hansen), vs {passed} ha where check-ins passed (AUC {auc}).'), { damaged: han.survivors.meanLaterLossHa.checkinDamaged.toFixed(1), passed: han.survivors.meanLaterLossHa.passed.toFixed(1), auc: han.survivors.rocAuc.toFixed(2) })}
          source="12_hansen.py"
        >
          <CheckinBars han={han} />
        </Chart>
      </Section>

      {/* 5. Early warning */}
      <Section
        n="5"
        title={t('Can failure be predicted early?')}
        lead={t('Using only data available by the end of 2022, months before the first recovery verdict.')}
        note={
          <Text fontSize="caption" color="fg.muted" lineHeight="1.6" maxW="900px">
            <Text as="span" fontWeight="600" color="fg">
              {t('Reproduce:')}
            </Text>{' '}
            {rich(t('all inputs are public (Sentinel-2 L2A, Copernicus DEM, MODIS MCD64A1, Hansen/UMD GFC v1.13). Run {first} to {last} with {cmd}; the outputs in {dir} are served unchanged to this page. Method details: {link}.'), {
              first: <Mono>backend/pipeline/01</Mono>,
              last: <Mono>13</Mono>,
              cmd: <Mono>uv run python</Mono>,
              dir: <Mono>backend/data</Mono>,
              link: (
                <Link to="/methodology" style={{ color: cssVar('brand.fg'), fontWeight: 600 }}>
                  {t('methodology')}
                </Link>
              ),
            })}
          </Text>
        }
      >
        <Chart
          wide
          title={t('Early-warning model vs one-variable baseline')}
          axes={t('↑ failing cells predicted, % · → recovering cells wrongly flagged, %')}
          takeaway={fill(t('Out-of-fold ROC. The model (AUC {model}) does not beat summer-2022 recovery alone (AUC {baseline}): the first year already tells most of the story, which is why the schedule pays early and checks often.'), { model: bt.model.aucModel.toFixed(2), baseline: bt.model.aucBaseline.toFixed(2) })}
          source="08_backtest.py"
        >
          <RocChart
            found={t('of failing cells predicted')}
            wrong={t('of recovering cells flagged')}
            lines={[
              { name: fill(t('Gradient boosting (AUC {auc})'), { auc: bt.model.aucModel.toFixed(2) }), points: bt.model.roc.model, color: cssVar('brand.solid') },
              { name: fill(t('2022 recovery only (AUC {auc})'), { auc: bt.model.aucBaseline.toFixed(2) }), points: bt.model.roc.baseline, color: cssVar('ember') },
            ]}
          />
        </Chart>
      </Section>
    </Stack>
  )
}

// ---- layout

function Section({ n, title, lead, note, children }: { n: string; title: string; lead: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap="4">
      <Stack gap="1">
        <HStack gap="3">
          <Mono color="brand.fg" fontWeight="600">
            {n.padStart(2, '0')}
          </Mono>
          <Text as="h2" textStyle="h2" fontSize={{ base: '22px', md: '26px' }}>
            {title}
          </Text>
        </HStack>
        <Text color="fg.muted" fontSize="small" maxW="760px">
          {lead}
        </Text>
      </Stack>
      <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap="5">
        {children}
      </Grid>
      {note}
    </Stack>
  )
}

function Chart({ title, takeaway, source, axes, wide = false, children }: { title: string; takeaway: string; source: string; axes?: string; wide?: boolean; children: ReactNode }) {
  const axisLine = axes && (
    <Mono fontSize="label" color="fg.muted" display="block" mt="3" mb="-1">
      {axes}
    </Mono>
  )
  // wide: a card alone in its section spans the full row, with its text beside the chart instead of above it
  if (wide)
    return (
      <Reveal style={{ minWidth: 0, gridColumn: '1 / -1' }}>
        <Surface minW="0">
          <Grid templateColumns={{ base: '1fr', lg: '1fr 1.4fr' }} gap={{ base: '3', lg: '8' }} alignItems="center">
            <Stack gap="2">
              <Text fontWeight="600" fontSize="body">
                {title}
              </Text>
              <Text fontSize="small" color="fg.muted" lineHeight="1.6">
                {takeaway}
              </Text>
              <Mono fontSize="label" color="fg.muted" mt="1" display="block">
                backend/pipeline/{source}
              </Mono>
            </Stack>
            <Box minW="0">
              {axisLine}
              {children}
            </Box>
          </Grid>
        </Surface>
      </Reveal>
    )
  return (
    <Reveal style={{ minWidth: 0, height: '100%' }}>
    <Surface minW="0" h="full">
      <Text fontWeight="600" fontSize="body">
        {title}
      </Text>
      <Text fontSize="caption" color="fg.muted" mt="1" lineHeight="1.55" minH="38px">
        {takeaway}
      </Text>
      {axisLine}
      <Box mt="3">{children}</Box>
      <Mono fontSize="label" color="fg.muted" mt="2" display="block">
        backend/pipeline/{source}
      </Mono>
    </Surface>
    </Reveal>
  )
}

// ---- charts

function Trajectories({ rob }: { rob: Robustness }) {
  const { t } = useT()
  const all = rob.trajectories.all.series
  const data = all.map((s, i) => ({
    year: s.year,
    band: [Math.round(s.p25 * 100), Math.round(s.p75 * 100)],
    all: Math.round(s.median * 100),
    ...Object.fromEntries(SEVERITIES.map((sev) => [sev, Math.round((rob.trajectories[sev]?.series[i].median ?? 0) * 100)])),
  }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="year" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
        <Tooltip {...tooltip} formatter={(v) => (Array.isArray(v) ? `${v[0]}-${v[1]}%` : `${v}%`)} />
        <Legend {...legend} />
        <Area isAnimationActive={false} dataKey="band" name={t('All cells, middle half')} fill={cssVar('brand.solid')} fillOpacity={0.12} stroke="none" />
        <Line isAnimationActive={false} dataKey="all" name={t('All cells, median')} stroke={cssVar('brand.solid')} strokeWidth={2.75} dot={{ r: 3.5 }} />
        {SEVERITIES.map((sev) => (
          <Line key={sev} isAnimationActive={false} dataKey={sev} name={t(sev)} stroke={SEV_COLOR[sev]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function OutcomesBySeverity({ bt }: { bt: Backtest }) {
  const { t } = useT()
  const data = SEVERITIES.filter((s) => bt.summary.bySeverity[s]).map((sev) => ({ sev, ...bt.summary.bySeverity[sev] }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="sev" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v: string) => t(v)} />
        <YAxis tick={tick} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip} cursor={barCursor} labelFormatter={(v) => t(String(v))} formatter={(v) => fill(t('{v} cells'), { v })} />
        <Legend {...legend} />
        {(['restored', 'partial', 'failed'] as const).map((o) => (
          <Bar key={o} isAnimationActive={false} dataKey={o} stackId="a" fill={OUTCOME_COLOR[o]} name={t(o)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function LaterLoss({ han }: { han: Hansen }) {
  const { t } = useT()
  const data = SEVERITIES.map((sev) => ({
    sev,
    ...Object.fromEntries(han.survivors.bySeverityOutcome.filter((r) => r.severity === sev).map((r) => [r.outcome, r.meanLaterLossHa])),
  }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="sev" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v: string) => t(v)} />
        <YAxis tick={tick} axisLine={false} tickLine={false} unit=" ha" />
        <Tooltip {...tooltip} cursor={barCursor} labelFormatter={(v) => t(String(v))} formatter={(v) => fill(t('{v} ha per 64 ha cell'), { v })} />
        <Legend {...legend} />
        {(['restored', 'partial', 'failed'] as const).map((o) => (
          <Bar key={o} isAnimationActive={false} dataKey={o} fill={OUTCOME_COLOR[o]} name={t(o)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function RecoveryHist({ rob }: { rob: Robustness }) {
  const { t } = useT()
  const data = rob.adj2026Hist.matched.map((b, i) => ({ x: Math.round(b.x * 100), matched: b.n, regional: rob.adj2026Hist.regional[i].n }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="x" tick={tick} axisLine={false} tickLine={false} unit="%" interval={3} />
        <YAxis tick={tick} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip} labelFormatter={(x) => fill(t('recovery {from}% to {to}%'), { from: x, to: Number(x) + 5 })} formatter={(v) => fill(t('{v} cells'), { v })} />
        <Legend {...legend} />
        <ReferenceLine x={60} stroke={cssVar('ember')} strokeDasharray="4 4" label={{ value: t('2026 target'), position: 'insideTopRight', fontSize: 10.5, fill: cssVar('ember') }} />
        <Area isAnimationActive={false} type="step" dataKey="regional" name={t('Regional controls (v1)')} stroke={cssVar('ash')} fill={cssVar('ash')} fillOpacity={0.15} />
        <Area isAnimationActive={false} type="step" dataKey="matched" name={t('Matched twins (now)')} stroke={cssVar('brand.solid')} fill={cssVar('brand.solid')} fillOpacity={0.2} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function CrossSensor({ points }: { points: [number, number][] }) {
  const { t } = useT()
  const data = points.map(([s2, l8]) => ({ s2: Math.round(s2 * 100), l8: Math.round(l8 * 100) }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 12, left: -16, bottom: 12 }}>
        <CartesianGrid stroke={cssVar('hairline')} />
        <XAxis type="number" dataKey="s2" name="Sentinel-2" unit="%" domain={[-60, 120]} ticks={[-50, 0, 50, 100]} tick={tick} axisLine={false} tickLine={false} label={{ value: 'Sentinel-2', position: 'insideBottomRight', offset: -8, fontSize: 10.5, fill: cssVar('fg.muted') }} />
        <YAxis type="number" dataKey="l8" name="Landsat 8/9" unit="%" domain={[-60, 120]} ticks={[-50, 0, 50, 100]} tick={tick} axisLine={false} tickLine={false} />
        <Tooltip {...tooltip} cursor={{ strokeDasharray: '3 3' }} />
        <ReferenceLine segment={[{ x: -60, y: -60 }, { x: 120, y: 120 }]} stroke={cssVar('fg.subtle')} strokeDasharray="4 4" />
        <ReferenceLine x={60} stroke={cssVar('ember')} strokeDasharray="3 3" />
        <ReferenceLine y={60} stroke={cssVar('ember')} strokeDasharray="3 3" label={{ value: t('target'), position: 'insideTopLeft', fontSize: 10.5, fill: cssVar('ember') }} />
        <Scatter isAnimationActive={false} data={data} fill={cssVar('brand.solid')} fillOpacity={0.45} r={2.5} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function SeverityVsHansen({ han }: { han: Hansen }) {
  const { t } = useT()
  const data = Object.entries(han.fire.bySeverity).map(([sev, v]) => ({ sev: SHORT[sev] ?? sev, lost: Math.round(v.lostIn2021 * 1000) / 10, ha: v.forestHa }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis dataKey="sev" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v: string) => t(v)} />
        <YAxis tick={tick} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
        <Tooltip {...tooltip} cursor={barCursor} labelFormatter={(v) => t(String(v))} formatter={(v) => fill(t('{v}% of forest recorded as lost in 2021'), { v })} />
        <Bar isAnimationActive={false} dataKey="lost" name={t('Forest lost in 2021 (Hansen)')} fill={cssVar('ember')} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Balance({ rob }: { rob: Robustness }) {
  const { t } = useT()
  const data = rob.covariates.map((c, i) => ({ name: t(COVARIATE_LABEL[c] ?? c), before: rob.balance.smdBefore[i], after: rob.balance.smdAfter[i] }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
        <CartesianGrid stroke={cssVar('hairline')} horizontal={false} />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} domain={[-1.3, 0.7]} />
        <YAxis type="category" dataKey="name" tick={tick} axisLine={false} tickLine={false} width={96} />
        <Tooltip {...tooltip} cursor={barCursor} formatter={(v) => fill(t('{v} standard deviations'), { v: Number(v).toFixed(2) })} />
        <Legend {...legend} />
        <ReferenceLine x={0.1} stroke={cssVar('hairlineStrong')} strokeDasharray="3 3" />
        <ReferenceLine x={-0.1} stroke={cssVar('hairlineStrong')} strokeDasharray="3 3" />
        <Bar isAnimationActive={false} dataKey="before" name={t('Before matching')} fill={cssVar('ash')} />
        <Bar isAnimationActive={false} dataKey="after" name={t('After matching')} fill={cssVar('brand.solid')} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Drift({ rob }: { rob: Robustness }) {
  const { t } = useT()
  const data = [{ year: t('pre'), regional: 0, all: 0 }, ...Object.entries(rob.regionalVsMatched.controlDrift).map(([year, d]) => ({ year, regional: d.regionalControls, all: d.allUnburnedForest }))]
  return (
    <ResponsiveContainer width="100%" height={370} /* matches the balance card beside it, which also holds the twin-count strip */>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="year" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => (v > 0 ? `+${v}` : `${v}`)} />
        <Tooltip {...tooltip} formatter={(v) => `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(3)} NBR`} />
        <Legend {...legend} />
        <Line isAnimationActive={false} dataKey="all" name={fill(t('All unburned forest ({cells} cells)'), { cells: rob.donorCells.toLocaleString() })} stroke={cssVar('brand.solid')} strokeWidth={2.5} dot={{ r: 3 }} />
        <Line isAnimationActive={false} dataKey="regional" name={t('3 regional controls (v1)')} stroke={cssVar('ash')} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/** Median 2026 recovery for each number of twins, as a compact strip under the balance chart. */
function TwinCounts({ rob }: { rob: Robustness }) {
  const { t } = useT()
  return (
    <Stack gap="1.5" mt="3" pt="3" borderTopWidth="1px" borderColor="hairline">
      <Text fontSize="caption" color="fg.muted">
        {fill(t('Median recovery 2026 by number of twins per plot (v1 regional controls: {pct})'), { pct: pct(rob.regionalVsMatched.medianAdj2026[0], 1) })}
      </Text>
      <HStack gap="2" flexWrap="wrap">
        {rob.kSensitivity.map((k) => (
          <Box key={k.k} flex="1" minW="64px" bg="surfaceSunken" borderRadius="md" px="2" py="1.5" textAlign="center">
            <Mono fontSize="label" color="fg.muted" display="block">
              {fill(t('{n} twins'), { n: k.k })}
            </Mono>
            <Mono fontSize="small" fontWeight="600" color={k.k === 10 ? 'brand.fg' : 'fg'}>
              {pct(k.medianAdj2026, 1)}
            </Mono>
          </Box>
        ))}
      </HStack>
    </Stack>
  )
}

function PlaceboHist({ rob }: { rob: Robustness }) {
  const { t } = useT()
  const data = rob.placebo.maxDropHist.map((b) => ({ x: b.x, n: b.n }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }} barCategoryGap={1}>
        {grid}
        <XAxis dataKey="x" tick={tick} axisLine={false} tickLine={false} interval={4} />
        <YAxis tick={tick} axisLine={false} tickLine={false} scale="sqrt" />
        <Tooltip {...tooltip} cursor={barCursor} labelFormatter={(x) => fill(t('largest yearly drop {from} to {to} NBR'), { from: x, to: (Number(x) + 0.01).toFixed(2) })} formatter={(v) => fill(t('{v} healthy cells'), { v })} />
        <ReferenceLine x={0.15} stroke={cssVar('status.failed')} strokeDasharray="4 4" label={{ value: t('flag 0.15'), position: 'insideTopRight', fontSize: 10.5, fill: cssVar('status.failed') }} />
        <Bar isAnimationActive={false} dataKey="n" name={t('Healthy forest cells')} fill={cssVar('brand.solid')} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function RocChart({ lines, found, wrong }: { lines: { name: string; points: Roc; color: string }[]; found: string; wrong: string }) {
  const { t } = useT()
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        {grid}
        <XAxis type="number" dataKey="fpr" domain={[0, 1]} tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => pct(v)} label={{ value: wrong, position: 'insideBottomRight', offset: -2, fontSize: 10.5, fill: cssVar('fg.muted') }} />
        <YAxis type="number" dataKey="tpr" domain={[0, 1]} tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => pct(v)} />
        <Tooltip {...tooltip} formatter={(v) => `${pct(Number(v))} ${found}`} labelFormatter={(v) => `${pct(Number(v))} ${wrong}`} />
        <Legend {...legend} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={cssVar('fg.subtle')} strokeDasharray="4 4" label={{ value: t('chance'), position: 'insideBottomRight', fontSize: 10.5, fill: cssVar('fg.subtle') }} />
        {lines.map((l) => (
          <Line key={l.name} isAnimationActive={false} data={l.points.map(([fpr, tpr]) => ({ fpr, tpr }))} dataKey="tpr" name={l.name} stroke={l.color} strokeWidth={2.5} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

function Thresholds({ han }: { han: Hansen }) {
  const { t } = useT()
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          {['Flag at drop >', 'Cells flagged', 'Precision', 'Recall', 'Healthy cells paused'].map((h) => (
            <Table.ColumnHeader key={h} fontSize="label" color="fg.muted" px="2">
              {t(h)}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {han.detector.thresholds.map((th) => (
          <Table.Row key={th.threshold} bg={th.threshold === 0.15 ? 'brand.subtle' : undefined}>
            <Table.Cell px="2" fontFamily="mono" fontSize="caption">
              {th.threshold}
              {th.threshold === 0.15 ? ` (${t('current')})` : ''}
            </Table.Cell>
            <Table.Cell px="2" fontFamily="mono" fontSize="caption">
              {th.flagged}
            </Table.Cell>
            <Table.Cell px="2" fontFamily="mono" fontSize="caption">
              {pct(th.precision)}
            </Table.Cell>
            <Table.Cell px="2" fontFamily="mono" fontSize="caption">
              {pct(th.recall)}
            </Table.Cell>
            <Table.Cell px="2" fontFamily="mono" fontSize="caption">
              {pct(th.falseFlagRate, 2)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}

function CheckinBars({ han }: { han: Hansen }) {
  const { t } = useT()
  const data = [
    { name: t('Check-in flagged damage'), ha: han.survivors.meanLaterLossHa.checkinDamaged, fill: OUTCOME_COLOR.failed },
    { name: t('All check-ins passed'), ha: han.survivors.meanLaterLossHa.passed, fill: OUTCOME_COLOR.restored },
  ]
  return (
    <ResponsiveContainer width="100%" height={270}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
        {grid}
        <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} height={36} />
        <YAxis tick={tick} axisLine={false} tickLine={false} unit=" ha" />
        <Tooltip {...tooltip} cursor={barCursor} formatter={(v) => fill(t('{v} ha of surviving trees lost 2022-2025'), { v })} />
        <Bar isAnimationActive={false} dataKey="ha" name={t('Later tree loss')} radius={[4, 4, 0, 0]} fill={cssVar('brand.solid')} shape={(p: { x?: number; y?: number; width?: number; height?: number; payload?: { fill: string } }) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={p.payload?.fill} />} />
      </BarChart>
    </ResponsiveContainer>
  )
}
