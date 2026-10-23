import { Box, Button, Grid, HStack, Link as CLink, Skeleton, Slider, Stack, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import { ArrowLeft, ArrowRight, ChevronRight, Layers } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, ImageOverlay, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Link, useSearchParams } from 'react-router'
import { SeverityChip, VerdictDots } from '@/components/plot/badges'
import { Chip, Eyebrow, Figure, Mono, primaryButton, secondaryButton } from '@/components/ui'
import { API_URL, type PlotFeature, type Results, usePlots, useResults } from '@/lib/api'
import { orderedEntries, periodLabel, SEVERITY_LABEL, SEVERITY_TOKEN, sortPeriods } from '@/lib/format'
import { useT } from '@/lib/i18n'

interface Overview {
  bounds: [[number, number], [number, number]]
  periods: string[]
}

const useOverview = () =>
  useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await fetch(`${API_URL}/data/overview.json`)).json() as Promise<Overview>,
  })

const shortPeriod = (p: string) => (p === 'pre' ? 'Jul 21' : p === 'post' ? 'Sep 21' : p)

function FitToPlots({ features }: { features: PlotFeature[] }) {
  const map = useMap()
  useEffect(() => {
    if (!features.length) return
    const pts = features.flatMap((f) => f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]))
    map.fitBounds(pts, { padding: [40, 40] })
  }, [features, map])
  return null
}

function FlyToPlot({ plot }: { plot?: PlotFeature }) {
  const map = useMap()
  useEffect(() => {
    if (plot) map.flyTo([plot.properties.centroid[1], plot.properties.centroid[0]], 13, { duration: 0.8 })
  }, [plot, map])
  return null
}

const latestAdj = (results: Results | undefined, id: string) => {
  const r = results?.[id]
  return r ? orderedEntries(r.periods).at(-1)?.[1].adj ?? null : null
}

export default function PlotsPage() {
  const { t, lang } = useT()
  const plots = usePlots()
  const results = useResults()
  const overview = useOverview()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('plot')
  const periods = useMemo(() => sortPeriods(overview.data?.periods ?? []), [overview.data])
  const [periodIdx, setPeriodIdx] = useState<number | null>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const idx = periodIdx ?? Math.max(periods.length - 1, 0)
  const period = periods[idx]

  const features = useMemo(() => plots.data?.features ?? [], [plots.data])
  const selected = features.find((f) => f.properties.id === selectedId)
  const plotList = features.filter((f) => f.properties.kind === 'plot')
  const controls = features.filter((f) => f.properties.kind === 'control')
  const select = (id: string | null) => setParams(id ? { plot: id } : {}, { replace: true })

  const style = (f?: GeoJSON.Feature): PathOptions => {
    const p = (f as PlotFeature).properties
    const isSel = p.id === selectedId
    return {
      className: ['plot-shape', p.kind === 'control' ? 'is-control' : `sev-${p.severity.class}`, isSel ? 'is-selected' : ''].join(' '),
      weight: isSel ? 3 : 1.5,
      fillOpacity: p.kind === 'control' ? 0.25 : 0.55,
    }
  }
  const onEach = (f: GeoJSON.Feature, layer: Layer) => {
    const p = (f as PlotFeature).properties
    layer.bindTooltip(p.kind === 'control' ? `${p.name} (${t('unburned reference')})` : p.name, { sticky: true })
    layer.on('click', (e: LeafletMouseEvent) => {
      e.originalEvent.stopPropagation()
      select(p.id)
    })
  }

  return (
    // fills the space the app shell leaves below the header (no hard-coded heights); only the list scrolls
    <Grid templateColumns={{ base: '1fr', lg: '1fr 400px' }} templateRows={{ base: '60svh auto', lg: 'minmax(0, 1fr)' }} flex={{ lg: '1' }} minH={{ lg: '0' }}>
      <Box position="relative" minH="420px">
        <MapContainer center={[36.9, 31.45]} zoom={11} style={{ width: '100%', height: '100%' }} zoomControl={false}>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Imagery © Esri, Maxar, Earthstar Geographics · Sentinel-2: Copernicus"
            maxZoom={18}
          />
          {overview.data && period && showOverlay && (
            <ImageOverlay key={period} url={`${API_URL}/data/img/overview/${period}_rgb.webp`} bounds={overview.data.bounds} opacity={0.95} />
          )}
          {features.length > 0 && <GeoJSON key={`${features.length}-${selectedId}-${lang}`} data={plots.data!} style={style} onEachFeature={onEach} />}
          <FitToPlots features={features} />
          <FlyToPlot plot={selected} />
        </MapContainer>

        {/* Legend */}
        <Box position="absolute" top="3" left="3" zIndex="500" bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="md" boxShadow="card" px="3" py="2.5">
          <Eyebrow fontSize="label" mb="1.5">
            {t('Burn severity')}
          </Eyebrow>
          <Stack gap="1">
            {(['high', 'moderate-high', 'moderate-low', 'low'] as const).map((k) => (
              <HStack key={k} gap="2" fontSize="label">
                <Box w="10px" h="10px" borderRadius="2px" bg={SEVERITY_TOKEN[k]} />
                {t(SEVERITY_LABEL[k])}
              </HStack>
            ))}
            <HStack gap="2" fontSize="label">
              <Box w="10px" h="10px" borderRadius="2px" bg="ash" opacity={0.6} borderWidth="1px" borderStyle="dashed" borderColor="fg.muted" />
              {t('Unburned control')}
            </HStack>
          </Stack>
        </Box>

        {/* Year slider */}
        {periods.length > 0 && (
          <Box position="absolute" left="3" right={{ base: '3', md: 'auto' }} bottom={{ base: '10', md: '3' }} zIndex="500" w={{ md: '440px' }} bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="md" boxShadow="card" px="4" py="3">
            <HStack justify="space-between" mb="2">
              <Box>
                <Eyebrow fontSize="label">{t('Sentinel-2 summer composite')}</Eyebrow>
                <Text fontFamily="heading" fontWeight="600" fontSize="lead">
                  {t(periodLabel(period))}
                </Text>
              </Box>
              <Button size="xs" {...secondaryButton} onClick={() => setShowOverlay((v) => !v)}>
                <Layers size={13} /> {showOverlay ? t('Basemap') : 'Sentinel-2'}
              </Button>
            </HStack>
            <Slider.Root min={0} max={periods.length - 1} step={1} value={[idx]} onValueChange={(d) => setPeriodIdx(d.value[0])} size="sm" aria-label={[t('Year')]}>
              <Slider.Control>
                <Slider.Track bg="surfaceSunken">
                  <Slider.Range bg="brand.solid" />
                </Slider.Track>
                <Slider.Thumbs borderColor="brand.solid" />
              </Slider.Control>
            </Slider.Root>
            <HStack justify="space-between" mt="1.5">
              {periods.map((p, i) => (
                <Mono key={p} fontSize="label" color={i === idx ? 'brand.fg' : 'fg.muted'} fontWeight={i === idx ? '600' : '400'}>
                  {t(shortPeriod(p))}
                </Mono>
              ))}
            </HStack>
          </Box>
        )}
      </Box>

      <Box as="aside" bg="shell" borderLeftWidth={{ lg: '1px' }} borderTopWidth={{ base: '1px', lg: '0' }} borderColor="hairline" overflowY="auto">
        {selected ? (
          <SelectedPanel plot={selected} results={results.data} onBack={() => select(null)} />
        ) : (
          <Box p="5">
            <Eyebrow>{t('Manavgat fire · 28 July 2021')}</Eyebrow>
            <Text as="h1" fontFamily="heading" fontSize="title" fontWeight="600" letterSpacing="-0.02em" mt="1.5">
              {t('Restoration plots')}
            </Text>
            <Text fontSize="small" color="fg.muted" mt="2" lineHeight="1.6">
              {t('Each plot is a 64 ha square inside the burn scar. Unburned control squares nearby separate real recovery from weather effects.')}
            </Text>
            <HStack gap="6" mt="5" mb="5">
              <Figure label={t('Plots')} value={plotList.length || '-'} />
              <Figure label={t('Controls')} value={controls.length || '-'} />
              <Figure label={t('Fire area')} value="59,234 ha" />
            </HStack>
            <Stack gap="0" borderTopWidth="1px" borderColor="hairline">
              {plots.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} h="16" my="1" />)}
              {plots.isError && (
                <Text fontSize="small" color="status.failed" py="4">
                  {t('Could not load plots.')}
                </Text>
              )}
              {plotList.map((f) => {
                const r = results.data?.[f.properties.id]
                const adj = latestAdj(results.data, f.properties.id)
                return (
                  <HStack
                    key={f.properties.id}
                    as="button"
                    onClick={() => select(f.properties.id)}
                    justify="space-between"
                    gap="3"
                    py="3"
                    px="1"
                    borderBottomWidth="1px"
                    borderColor="hairline"
                    textAlign="left"
                    _hover={{ bg: 'surfaceSunken' }}
                    cursor="pointer"
                  >
                    <Box minW="0" flex="1">
                      <Text fontWeight="600" fontSize="small" truncate>
                        {f.properties.name}
                      </Text>
                      <HStack gap="2" rowGap="1.5" mt="1.5" flexWrap="wrap">
                        <SeverityChip severity={f.properties.severity.class} compact />
                        {r && <VerdictDots milestones={r.milestones} />}
                      </HStack>
                    </Box>
                    <HStack gap="2" flexShrink={0}>
                      {adj != null && (
                        <Box textAlign="right">
                          <Mono fontSize="small" fontWeight="600" color={adj >= 0.6 ? 'brand.fg' : adj >= 0.3 ? 'fg' : 'status.failed'}>
                            {Math.round(adj * 100)}%
                          </Mono>
                          <Text fontSize="label" color="fg.muted">
                            {t('recovered')}
                          </Text>
                        </Box>
                      )}
                      <ChevronRight size={16} color="var(--chakra-colors-fg-muted)" />
                    </HStack>
                  </HStack>
                )
              })}
            </Stack>
          </Box>
        )}
      </Box>
    </Grid>
  )
}

function SelectedPanel({ plot, results, onBack }: { plot: PlotFeature; results?: Results; onBack: () => void }) {
  const { t } = useT()
  const p = plot.properties
  const r = results?.[p.id]
  const adj = latestAdj(results, p.id)
  return (
    <Box p="5">
      <CLink as="button" onClick={onBack} fontSize="small" color="fg.muted" display="inline-flex" alignItems="center" gap="1.5" _hover={{ color: 'fg' }}>
        <ArrowLeft size={14} /> {t('All plots')}
      </CLink>
      <Text fontFamily="heading" fontSize="title" fontWeight="600" letterSpacing="-0.02em" mt="3">
        {p.name}
      </Text>
      <HStack gap="2" mt="2" flexWrap="wrap">
        {p.kind === 'control' ? (
          <Chip>{t('Unburned control')}</Chip>
        ) : (
          <>
            <SeverityChip severity={p.severity.class} />
            <Chip>{p.planType === 'ASSISTED' ? t('Assisted planting') : t('Natural regeneration')}</Chip>
          </>
        )}
      </HStack>
      <Grid templateColumns="1fr 1fr" gap="4" mt="5" p="4" bg="surfaceSunken" borderRadius="md">
        <Figure label={t('Area')} value={`${p.areaHa} ha`} />
        <Figure label={t('Mean dNBR')} value={p.severity.meanDnbr.toFixed(2)} />
        {adj != null && <Figure label={t('Recovered vs. controls')} value={`${Math.round(adj * 100)}%`} hint={t('Summer 2026')} />}
        {r && r.milestones.length > 0 && (
          <Box>
            <Eyebrow mb="2">{t('Satellite verdicts')}</Eyebrow>
            <VerdictDots milestones={r.milestones} />
          </Box>
        )}
      </Grid>
      {p.kind === 'control' ? (
        <Text fontSize="small" color="fg.muted" mt="4" lineHeight="1.6">
          {t('Unburned forest used as a reference: its year-to-year change is subtracted from every plot’s recovery score.')}
        </Text>
      ) : (
        <Button asChild {...primaryButton} w="full" mt="5" size="md">
          <Link to={`/plot/${p.id}`}>
            {t('Open plot')} <ArrowRight size={16} />
          </Link>
        </Button>
      )}
    </Box>
  )
}
