import { Box, Button, Grid, HStack, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { PathOptions } from 'leaflet'
import { useEffect } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Eyebrow, Figure, Mono, Page, PageHeader, PanelHeader, secondaryButton, Surface } from '@/components/ui'
import { API_URL } from '@/lib/api'
import { useT } from '@/lib/i18n'

interface Backtest {
  summary: {
    cells: number
    hectares: number
    fundPerCell: number
    paidShare: number
    refundedShare: number
    restored: number
    partial: number
    failed: number
    failuresCaughtByCheckins: number
    failuresCaughtShare: number
    restoredWithMissedCheckin: number
    damaged2022: number
    failRateDamaged: number
    failRateClean: number
    riskRatio: number
  }
  model: { aucModel: number; aucBaseline: number; apModel: number; apBaseline: number; precisionAt50: number; recallAt50: number; positives: number; n: number }
}

interface Validation {
  oursHa: number
  modisHa: number
  referenceHa: number
  iou: number
  oursCoveredByModis: number
  modisCoveredByOurs: number
}

type CellFC = GeoJSON.FeatureCollection<GeoJSON.Polygon, { outcome: 'restored' | 'partial' | 'failed'; caught: string | null; adj2026: number; risk: number }>

const getJson = <T,>(path: string) =>
  fetch(`${API_URL}/data/${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} (${r.status})`)
    return r.json() as Promise<T>
  })
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`
const COLORS = { restored: '#1a9c6a', partial: '#e7b04a', failed: '#bf3a2b' } as const

function Fit({ fc }: { fc?: CellFC }) {
  const map = useMap()
  useEffect(() => {
    if (!fc?.features.length) return
    const pts = fc.features.flatMap((f) => f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]))
    map.fitBounds(pts, { padding: [16, 16] })
  }, [fc, map])
  return null
}

export default function ImpactPage() {
  const { t, lang } = useT()
  const bt = useQuery({ queryKey: ['backtest'], queryFn: () => getJson<Backtest>('backtest.json'), retry: 1 })
  const val = useQuery({ queryKey: ['validation'], queryFn: () => getJson<Validation>('validation.json'), retry: 1 })
  const cells = useQuery({ queryKey: ['backtest-cells'], queryFn: () => getJson<CellFC>('backtest.geojson'), retry: 1 })
  const failed = [bt, val, cells].filter((q) => q.isError)
  const s = bt.data?.summary
  const m = bt.data?.model
  const v = val.data

  const style = (f?: GeoJSON.Feature): PathOptions => {
    const p = (f as CellFC['features'][number]).properties
    return {
      color: p.caught ? '#ffffff' : COLORS[p.outcome],
      weight: p.caught ? 1.4 : 0.4,
      fillColor: COLORS[p.outcome],
      fillOpacity: 0.65,
    }
  }

  return (
    <Page>
      <PageHeader eyebrow={t('Impact · backtest 2021-2026')} title={t('What ReGrow would have done for the whole Manavgat fire')}>
        {t('We ran the exact on-chain rules over every burned forest cell of the 2021 fire, using five years of real Sentinel-2 data, as if each 64 ha cell had been funded with')}{' '}
        {s ? s.fundPerCell.toLocaleString() : '1,000'} FLZ.
      </PageHeader>
      {failed.length > 0 && (
        <Surface mb="6">
          <Text fontWeight="600">{t('Some backtest data could not be loaded.')}</Text>
          <Text fontSize="small" color="fg.muted" mt="1">
            {t('Missing:')} {failed.map((q) => (q.error as Error).message).join(', ')}. {t('The server may be restarting.')}
          </Text>
          <Button {...secondaryButton} size="sm" mt="4" onClick={() => failed.forEach((q) => q.refetch())}>
            {t('Try again')}
          </Button>
        </Surface>
      )}

      {!s ? (
        <Skeleton h="32" mb="6" />
      ) : (
        <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" mb="6">
          <Surface>
            <Figure label={t('Burned forest backtested')} value={`${s.hectares.toLocaleString()} ha`} hint={`${s.cells} ${t('cells of 64 ha')}`} />
          </Surface>
          <Surface>
            <Figure label={t('Paid on evidence')} value={pct(s.paidShare, 1)} hint={`${pct(s.refundedShare, 1)} ${t('refunded to funders')}`} />
          </Surface>
          <Surface>
            <Figure
              label={t('Failures caught in year one')}
              value={pct(s.failuresCaughtShare)}
              hint={`${s.failuresCaughtByCheckins} ${t('of')} ${s.failed} ${t('by quarterly check-ins')}`}
            />
          </Surface>
          <Surface>
            <Figure
              label={t('Risk after post-fire damage')}
              value={`${s.riskRatio}×`}
              hint={`${pct(s.failRateDamaged)} ${t('fail vs')} ${pct(s.failRateClean, 1)} ${t('untouched')}`}
            />
          </Surface>
        </SimpleGrid>
      )}

      <Grid templateColumns={{ base: '1fr', lg: '1.4fr 1fr' }} gap="6" alignItems="start">
        <Surface p="0" overflow="hidden">
          <Box h={{ base: '380px', md: '520px' }}>
            <MapContainer center={[36.9, 31.45]} zoom={11} style={{ width: '100%', height: '100%' }} zoomControl={false} scrollWheelZoom={false}>
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Imagery © Esri, Maxar, Earthstar Geographics" />
              {cells.data && <GeoJSON key={lang} data={cells.data} style={style} onEachFeature={(f, l) => {
                const p = (f as CellFC['features'][number]).properties
                l.bindTooltip(
                  `${t(p.outcome)} · ${t('recovery')} ${Math.round(p.adj2026 * 100)}% ${t('in 2026')}${p.caught ? ` · ${t('flagged')} ${p.caught}` : ''}`,
                  { sticky: true },
                )
              }} />}
              <Fit fc={cells.data} />
            </MapContainer>
          </Box>
          <HStack gap="4" px="4" py="3" borderTopWidth="1px" borderColor="hairline" flexWrap="wrap" fontSize="caption">
            {(['restored', 'partial', 'failed'] as const).map((k) => (
              <HStack key={k} gap="1.5">
                <Box w="10px" h="10px" borderRadius="2px" bg={COLORS[k]} />
                <Text textTransform="capitalize">
                  {t(k)} {s ? `· ${s[k]}` : ''}
                </Text>
              </HStack>
            ))}
            <HStack gap="1.5">
              <Box w="10px" h="10px" borderRadius="2px" borderWidth="1.5px" borderColor="fg" />
              <Text>{t('white outline: caught by a check-in in year one')}</Text>
            </HStack>
          </HStack>
        </Surface>

        <Stack gap="6">
          <Surface>
            <PanelHeader title={t('Where 1,000 FLZ per plot would have gone')} />
            {s && (
              <>
                <HStack h="10px" gap="0.5" borderRadius="full" overflow="hidden">
                  <Box h="full" bg="brand.solid" style={{ width: pct(s.paidShare, 2) }} />
                  <Box h="full" bg="status.failed" opacity={0.75} style={{ width: pct(s.refundedShare, 2) }} />
                </HStack>
                <Text fontSize="small" color="fg.muted" mt="3" lineHeight="1.6">
                  {pct(s.paidShare, 1)} {t('reached stewards for verified recovery;')} {pct(s.refundedShare, 1)}{' '}
                  {t('went back to funders, mostly from slopes cleared or terraced after the fire.')} {s.restoredWithMissedCheckin}{' '}
                  {t('slopes that recovered later lost one 5% check-in: the cost of a strict early signal.')}
                </Text>
              </>
            )}
          </Surface>

          <Surface>
            <PanelHeader title={t('The threat is what happens after the fire')} />
            {s && (
              <Text fontSize="small" lineHeight="1.65">
                {t('Slopes that lost more vegetation in the year after the fire, net of the control forest (bulldozing, salvage logging, terracing), failed to recover by 2026 in')}{' '}
                <Text as="span" fontWeight="600" color="status.failed">{pct(s.failRateDamaged)}</Text> {t('of cases.')}{' '}
                {t('Untouched burned slopes failed in only')}{' '}
                <Text as="span" fontWeight="600" color="brand.fg">{pct(s.failRateClean, 1)}</Text>.{' '}
                {t('That is why ReGrow pays stewards to protect natural regeneration and checks every quarter.')}
              </Text>
            )}
          </Surface>
        </Stack>
      </Grid>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap="6" mt="6">
        <Surface>
          <PanelHeader title={t('Independent validation of the fire map')} />
          {v && (
            <Stack gap="4">
              <SimpleGrid columns={3} gap="3">
                <Figure label="ReGrow (S-2, 20 m)" value={`${(v.oursHa / 1000).toFixed(1)}k ha`} />
                <Figure label="NASA MODIS" value={`${(v.modisHa / 1000).toFixed(1)}k ha`} />
                <Figure label={t('Reported (GTÜ)')} value={`${(v.referenceHa / 1000).toFixed(1)}k ha`} />
              </SimpleGrid>
              <Text fontSize="small" color="fg.muted" lineHeight="1.6">
                {t('Compared on the same 500 m grid with NASA’s MCD64A1 burned-area product: overlap (IoU)')}{' '}
                <Mono color="fg">{v.iou.toFixed(2)}</Mono>; {pct(v.oursCoveredByModis)} {t('of our perimeter is confirmed by MODIS and')}{' '}
                {pct(v.modisCoveredByOurs)} {t('of MODIS by ours.')}
              </Text>
            </Stack>
          )}
        </Surface>

        <Surface>
          <PanelHeader title={t('Early warning: the first year predicts the next four')} />
          {m && (
            <Stack gap="4">
              <SimpleGrid columns={3} gap="3">
                <Figure label="ROC-AUC" value={m.aucModel.toFixed(2)} hint={`${t('baseline')} ${m.aucBaseline.toFixed(2)}`} />
                <Figure label={t('Precision')} value={pct(m.precisionAt50)} hint={t('of flagged slopes')} />
                <Figure label={t('Recall')} value={pct(m.recallAt50)} hint={t('of eventual failures')} />
              </SimpleGrid>
              <Text fontSize="small" color="fg.muted" lineHeight="1.6">
                {t('A gradient-boosted model sees only data available by the end of 2022 and predicts which of the')} {m.n}{' '}
                {t('slopes will not be restored by 2026')} ({m.positives} {t('did not).')}{' '}
                {t('Scores are out-of-fold (5-fold cross-validation).')}{' '}
                {t('A one-variable baseline, recovery in summer 2022, scores almost as well: the early signal is robust, not an artefact of a complex model.')}
              </Text>
            </Stack>
          )}
        </Surface>
      </SimpleGrid>

      <Box mt="6">
        <Eyebrow mb="2">{t('Method')}</Eyebrow>
        <Text fontSize="caption" color="fg.muted" lineHeight="1.6" maxW="3xl">
          {t('Pipeline steps 06 (quarterly composites for every cell), 08 (contract simulation and model) and 10 (MODIS comparison) are in the repository and reproducible from public data. This is a retrospective test of the rules, not money that was actually paid.')}
        </Text>
      </Box>
    </Page>
  )
}
