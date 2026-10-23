import { Box, Grid, HStack, Image, Link as CLink, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { useT } from '@/lib/i18n'
import { ArrowLeft, ExternalLink, Hotel, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { SeverityChip, StatusChip } from '@/components/plot/badges'
import { AiReport } from '@/components/plot/AiReport'
import { CompareSlider } from '@/components/plot/CompareSlider'
import { FundCard } from '@/components/plot/FundCard'
import { RecoveryUnits } from '@/components/plot/RecoveryUnits'
import { MilestoneTimeline } from '@/components/plot/MilestoneTimeline'
import { NbrChart, RecoveryChart } from '@/components/plot/RecoveryChart'
import { Chip, Eyebrow, Figure, Mono, Page, PanelHeader, Segmented, Surface } from '@/components/ui'
import { imageUrl, useBacktest, useCertificates, useEvents, usePlots, useResults } from '@/lib/api'
import { fmtAmount, TIER_TONE } from '@/components/certificates'
import { deployed, formatFlz, usePlotOnChain } from '@/lib/contracts'
import { periodLabel, SEVERITY_LABEL, SEVERITY_TOKEN, shortHash, sortPeriods } from '@/lib/format'
import { addressUrl, explorerUrl, txUrl } from '@/lib/wagmi'

const shortPeriod = (p: string) => (p === 'pre' ? 'Jul 21' : p === 'post' ? 'Sep 21' : p)

export default function PlotPage() {
  const { id } = useParams()
  const fromRoomCard = useSearchParams()[0].get('from') === 'room-card'
  const { t } = useT()
  const plots = usePlots()
  const results = useResults()
  const feature = plots.data?.features.find((f) => f.properties.id === id)
  const result = id ? results.data?.[id] : undefined
  const p = feature?.properties
  const onchain = usePlotOnChain(p?.chainId)
  const events = useEvents(p?.chainId)
  const backtest = useBacktest()
  const periods = result ? sortPeriods(Object.keys(result.periods)) : []
  const [kind, setKind] = useState<'rgb' | 'nbr'>('rgb')
  const [chart, setChart] = useState<'recovery' | 'nbr'>('recovery')
  const [after, setAfter] = useState<string | null>(null)

  if (plots.isLoading || results.isLoading) {
    return (
      <Page>
        <Skeleton h="10" w="80" mb="6" />
        <Skeleton h="96" />
      </Page>
    )
  }
  if (!feature || !result || !p) {
    return (
      <Page textAlign="center" py="20">
        <Text fontFamily="heading" fontSize="title" fontWeight="600">
          Plot not found
        </Text>
        <CLink asChild color="brand.fg" mt="3">
          <Link to="/plots">Back to all plots</Link>
        </CLink>
      </Page>
    )
  }

  const afterPeriod = after ?? periods.at(-1)!
  const chainPlot = onchain.plot.data
  const status = onchain.status
  const funded = chainPlot?.totalFunded ?? 0n
  const released = chainPlot?.released ?? 0n
  const refunded = chainPlot?.refunded ?? 0n
  const locked = funded - (chainPlot?.settled ?? 0n)
  const share = (v: bigint) => (funded > 0n ? Number((v * 10_000n) / funded) / 100 : 0)
  const evs = events.data?.events ?? []
  const pause = evs.findLast((e) => e.event === 'PlotPaused')
  const latestAdj = result.periods[periods.at(-1)!]?.adj

  return (
    <Page>
      <CLink asChild fontSize="small" color="fg.muted" _hover={{ color: 'fg' }} mb="4" display="inline-flex" alignItems="center" gap="1.5">
        <Link to={`/plots?plot=${p.id}`}>
          <ArrowLeft size={14} /> {t('All plots')}
        </Link>
      </CLink>

      <HStack justify="space-between" align="end" gap="6" flexWrap="wrap" mb="6">
        <Stack gap="2.5">
          <Eyebrow>
            {t('Plot')} #{p.chainId} · {p.centroid[1].toFixed(4)}°N {p.centroid[0].toFixed(4)}°E
          </Eyebrow>
          <Text as="h1" textStyle="h1">
            {p.name}
          </Text>
          <HStack gap="2" flexWrap="wrap">
            <SeverityChip severity={p.severity.class} />
            <Chip>{p.planType === 'ASSISTED' ? t('Assisted planting') : t('Natural regeneration')}</Chip>
            <Chip>{p.areaHa} ha</Chip>
            {backtest.data?.plots[p.id] && (
              <Chip tone={backtest.data.plots[p.id].risk >= 0.5 ? 'red' : 'brand'} dot>
                {t('early-warning risk')} {Math.round(backtest.data.plots[p.id].risk * 100)}% ({t('end-2022 data')})
              </Chip>
            )}
          </HStack>
        </Stack>
        {status && <StatusChip status={status} />}
      </HStack>

      {fromRoomCard && (
        <HStack align="start" gap="3" borderWidth="1px" borderColor="brand.muted" bg="brand.subtle" borderRadius="card" p="4" mb="6">
          <Box color="brand.fg" pt="0.5">
            <Hotel size={18} />
          </Box>
          <Text fontSize="small" lineHeight="1.6">
            <Text as="span" fontWeight="600">
              {t('Welcome, guest of room 214.')}
            </Text>{' '}
            {t('This is the burned forest near Salur that your stay helps restore. Below you can see it from space, how far it has come back, and where the money went.')}{' '}
            <Text as="span" color="fg.muted">
              {t('(Example hotel in this demo.)')}
            </Text>
          </Text>
        </HStack>
      )}

      {status === 'Paused' && (
        <HStack align="start" gap="3" borderWidth="1px" borderColor="orange.muted" bg="orange.subtle" borderRadius="card" p="4" mb="6">
          <Box color="status.paused" pt="0.5">
            <ShieldAlert size={18} />
          </Box>
          <Text fontSize="small" lineHeight="1.6">
            <Text as="span" fontWeight="600">
              Payouts paused: vegetation loss detected.
            </Text>{' '}
            Satellite data shows a sudden loss of vegetation that the unburned control forest did not show
            {result.disturbance?.year ? ` (summer ${result.disturbance.year})` : ''}, e.g. clearing, terracing or a re-burn.
            Under review by the forest authority: if the work was planned and approved, payouts resume; if not, or if
            nobody decides within the review period, unreleased funds are refunded.
            {pause && explorerUrl && (
              <CLink href={txUrl(pause.txHash)} target="_blank" ml="1" color="status.paused" fontWeight="600">
                Pause transaction <ExternalLink size={12} style={{ display: 'inline' }} />
              </CLink>
            )}
          </Text>
        </HStack>
      )}

      <Grid templateColumns={{ base: '1fr', lg: '1fr 360px' }} gap="6" alignItems="start">
        <Stack gap="6" minW="0">
          {id && <AiReport plotId={id} />}
          <Surface>
            <PanelHeader
              title={t("Satellite view")}
              right={<Segmented value={kind} onChange={setKind} options={[['rgb', 'True colour'], ['nbr', 'Burn index']]} />}
            />
            <CompareSlider before={imageUrl(p.id, 'pre', kind)} after={imageUrl(p.id, afterPeriod, kind)} beforePeriod="pre" afterPeriod={afterPeriod} />
            <HStack gap="1.5" mt="3" overflowX="auto" pb="1">
              {periods.map((x) => {
                const on = x === afterPeriod
                return (
                  <Box
                    key={x}
                    as="button"
                    onClick={() => x !== 'pre' && setAfter(x)}
                    flexShrink={0}
                    borderWidth="2px"
                    borderColor={on ? 'brand.solid' : 'transparent'}
                    borderRadius="md"
                    overflow="hidden"
                    cursor={x === 'pre' ? 'default' : 'pointer'}
                    title={t(periodLabel(x))}
                  >
                    <Image src={imageUrl(p.id, x, kind)} alt={t(periodLabel(x))} w="64px" h="64px" objectFit="cover" loading="lazy" />
                    <Text fontFamily="mono" fontSize="label" py="0.5" textAlign="center" color={on ? 'brand.fg' : 'fg.muted'}>
                      {shortPeriod(x)}
                    </Text>
                  </Box>
                )
              })}
            </HStack>
            <Text fontSize="caption" color="fg.muted" mt="2">
              {t('Sentinel-2 summer composites, 20 m pixels. White square: this plot (64 ha).')}
              {kind === 'nbr' && ` ${t('Burn index (NBR): red = burned or bare, green = vegetated.')}`}
            </Text>
          </Surface>

          <Surface>
            <PanelHeader
              title={t("Recovery")}
              right={<Segmented value={chart} onChange={setChart} options={[['recovery', t('vs. controls')], ['nbr', t('Raw NBR')]]} />}
            />
            {chart === 'recovery' ? (
              <RecoveryChart result={result} milestones={result.milestones} />
            ) : (
              <NbrChart result={result} controlIds={p.controlIds} results={results.data!} />
            )}
            <Text fontSize="caption" color="fg.muted" mt="2" lineHeight="1.6">
              {t('100% = back to the pre-fire condition. “vs. controls” subtracts the change seen in this plot’s matched controls: the 10 unburned forest cells most like it before the fire (vegetation, elevation, slope, aspect), so a wet year does not count as recovery. Payouts use the summer points.')}
            </Text>
          </Surface>

          <Surface>
            <PanelHeader title={t("Milestones")} />
            <MilestoneTimeline plotId={p.id} milestones={result.milestones} reports={onchain.reports.data} events={evs} />
          </Surface>
        </Stack>

        <Stack gap="6" minW="0">
          <Surface>
            <PanelHeader title={t("Escrow")} />
            {!deployed ? (
              <Text fontSize="small" color="fg.muted">
                {t('Contracts not deployed yet.')}
              </Text>
            ) : (
              <Stack gap="4">
                <SimpleGrid columns={2} gap="4">
                  <Figure label={t("Funded")} value={formatFlz(funded)} hint="FLZ" />
                  <Figure label={t("Locked")} value={formatFlz(locked)} hint={t('awaiting evidence')} />
                  <Figure label={t("Paid to stewards")} value={formatFlz(released)} hint={`${share(released)}%`} />
                  <Figure label={t("Refunded")} value={formatFlz(refunded)} hint={`${share(refunded)}%`} />
                </SimpleGrid>
                <HStack h="8px" gap="0.5" borderRadius="full" overflow="hidden" bg="surfaceSunken" title={t('paid · refunded · locked')}>
                  <Box h="full" bg="brand.solid" style={{ width: `${share(released)}%` }} />
                  <Box h="full" bg="status.failed" opacity={0.7} style={{ width: `${share(refunded)}%` }} />
                </HStack>
                {chainPlot && (
                  <Text fontSize="caption" color="fg.muted">
                    {t('Steward')}{' '}
                    {explorerUrl ? (
                      <CLink href={addressUrl(chainPlot.steward)} target="_blank">
                        <Mono>{shortHash(chainPlot.steward, 4)}</Mono>
                      </CLink>
                    ) : (
                      <Mono>{shortHash(chainPlot.steward, 4)}</Mono>
                    )}
                  </Text>
                )}
              </Stack>
            )}
          </Surface>

          {deployed && p.chainId != null && (
            <FundCard chainId={p.chainId} status={status} schedule={chainPlot?.milestones} nextMilestone={chainPlot?.nextMilestone} />
          )}
          {deployed && p.chainId != null && <RecoveryUnits chainId={p.chainId} status={status} />}
          <SupportersCard plotId={p.id} />

          <Surface>
            <PanelHeader title={t("Burn severity")} />
            <Stack gap="2">
              {Object.entries(p.severity.pctByClass).map(([k, v]) => (
                <HStack key={k} gap="3" fontSize="caption">
                  <Text w="100px" color="fg.muted">
                    {t(SEVERITY_LABEL[k as keyof typeof SEVERITY_LABEL])}
                  </Text>
                  <Box flex="1" h="6px" bg="surfaceSunken" borderRadius="full" overflow="hidden">
                    <Box h="full" borderRadius="full" bg={SEVERITY_TOKEN[k as keyof typeof SEVERITY_TOKEN]} style={{ width: `${v * 100}%` }} />
                  </Box>
                  <Mono w="36px" textAlign="right">
                    {Math.round(v * 100)}%
                  </Mono>
                </HStack>
              ))}
            </Stack>
            <Text fontSize="caption" color="fg.muted" mt="3">
              {t('Mean dNBR')} {p.severity.meanDnbr.toFixed(2)} · {t('Key & Benson classes')}
              {latestAdj != null && (
                <>
                  {' '}
                  · {t('recovery vs. controls in')} {periods.at(-1)}: {Math.round(latestAdj * 100)}%
                </>
              )}
            </Text>
          </Surface>
        </Stack>
      </Grid>
    </Page>
  )
}

function SupportersCard({ plotId }: { plotId: string }) {
  const { t } = useT()
  const certs = useCertificates()
  const items = (certs.data ?? []).filter((c) => c.plotKey === plotId).sort((a, b) => b.amount - a.amount)
  if (items.length === 0) return null
  return (
    <Surface>
      <PanelHeader title={`${t('Supporters')} · ${items.length}`} right={<CLink asChild fontSize="caption" color="fg.muted"><Link to="/supporters">{t('All supporters')}</Link></CLink>} />
      <Stack gap="2.5">
        {items.slice(0, 8).map((c) => (
          <HStack key={c.tokenId} justify="space-between" fontSize="small" gap="3">
            <CLink asChild color="fg.muted" _hover={{ color: 'fg' }}>
              <Link to={`/funder/${c.funder}`}>
                <Mono>{shortHash(c.funder, 4)}</Mono>
              </Link>
            </CLink>
            <HStack gap="2">
              <Text fontVariantNumeric="tabular-nums">{fmtAmount(c.amount)} FLZ</Text>
              <Chip tone={TIER_TONE[c.tier]}>{c.tier}</Chip>
            </HStack>
          </HStack>
        ))}
      </Stack>
    </Surface>
  )
}
