import { Box, Button, Grid, HStack, NativeSelect, Stack, Text } from '@chakra-ui/react'
import { Check, Minus, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { latLngBounds } from 'leaflet'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { Chip, Mono, Page, PageHeader, primaryButton, secondaryButton, Surface } from '@/components/ui'
import { API_URL, usePlots } from '@/lib/api'
import { shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

// the checks /api/photo-check runs (backend/src/regrow_api/photo_check.py), in order; ids match its results
const RULES = [
  ['gps', 'Has a location', 'The photo carries the GPS position the camera recorded.'],
  ['inside', 'Inside the plot', 'That position lies within the plot outline, with 100 m tolerance for phone GPS.'],
  ['date', 'After the fire', 'Taken after the fire began on 28 July 2021, and not in the future.'],
  ['duplicate', 'A new photo', 'A visual fingerprint catches the same picture sent again, even resized or re-saved.'],
  ['ai', 'AI look (optional)', 'A vision model looks for a burned slope with regrowth. Advisory: it can flag doubts but never rejects a photo on its own.'],
] as const

interface CheckResult {
  id: string
  label: string
  ok: boolean | null
  detail: string
}

interface PhotoResult {
  passed: boolean
  checks: CheckResult[]
  gps: [number, number] | null
  evidenceHash: string
}

export default function StewardPage() {
  const { t } = useT()
  const plots = usePlots()
  const options = plots.data?.features.filter((f) => f.properties.kind === 'plot') ?? []
  const [plotId, setPlotId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PhotoResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const plot = options.find((f) => f.properties.id === (plotId || options[0]?.properties.id))

  function pick(f: File | undefined) {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    setPreview(URL.createObjectURL(f))
  }

  async function submit() {
    if (!file || !plot) return
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('plotId', plot.properties.id)
      body.append('file', file)
      const res = await fetch(`${API_URL}/photo-check`, { method: 'POST', body })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `${res.status}`)
      setResult(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader eyebrow={t('Participants')} title={t('Steward check-in')}>
        {t('Local teams prove they are on the ground with a geotagged photo. We check where and when it was taken and whether it was used before, so the same picture cannot be claimed twice or sent from somewhere else.')}
      </PageHeader>

      <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap="6" alignItems="start">
        <Surface>
          <Stack gap="6">
            <Step n={1} title={t('Choose the plot')}>
              <NativeSelect.Root size="md">
                <NativeSelect.Field
                  aria-label={t('Plot')}
                  value={plot?.properties.id ?? ''}
                  onChange={(e) => {
                    setPlotId(e.target.value)
                    setResult(null)
                  }}
                >
                  {options.map((f) => (
                    <option key={f.properties.id} value={f.properties.id}>
                      {f.properties.name}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Step>

            <Step n={2} title={t('Add a photo')}>
              <Box
                as="label"
                display="block"
                borderWidth="1px"
                borderStyle={file ? 'solid' : 'dashed'}
                borderColor="hairlineStrong"
                borderRadius="md"
                cursor="pointer"
                transition="border-color .15s"
                _hover={{ borderColor: 'brand.solid' }}
                _focusWithin={{ outline: '2px solid', outlineColor: 'brand.solid', outlineOffset: '2px' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  pick(e.dataTransfer.files[0])
                }}
              >
                {file && preview ? (
                  <HStack gap="4" p="3">
                    <Box w="96px" h="72px" borderRadius="sm" overflow="hidden" flexShrink={0} bg="surfaceSunken">
                      <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </Box>
                    <Box minW="0" flex="1">
                      <Text fontSize="small" fontWeight="600" truncate>
                        {file.name}
                      </Text>
                      <Mono fontSize="label" color="fg.muted">
                        {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
                      </Mono>
                    </Box>
                    <Text fontSize="caption" fontWeight="600" color="brand.fg" flexShrink={0}>
                      {t('Change')}
                    </Text>
                  </HStack>
                ) : (
                  <Stack align="center" gap="2" py="9" px="4" textAlign="center">
                    <Box as="span" {...secondaryButton} display="inline-flex" alignItems="center" h="9" px="4" borderRadius="md" fontSize="small" fontWeight="600" borderWidth="1px">
                      {t('Choose a photo')}
                    </Box>
                    <Text fontSize="small" color="fg.muted">
                      {t('or drop it here')}
                    </Text>
                    <Text fontSize="label" color="fg.subtle">
                      {t('JPEG or HEIC straight from the camera, with location on')}
                    </Text>
                  </Stack>
                )}
                <input type="file" accept="image/jpeg,image/heic,image/png" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(e) => pick(e.target.files?.[0])} />
              </Box>
            </Step>

            <Step n={3} title={t('Run the checks')}>
              <Button {...primaryButton} size="md" w="full" disabled={!file || !plot || busy} onClick={submit}>
                {busy ? t('Checking…') : t('Run checks')}
              </Button>
              {error && (
                <Text fontSize="small" color="status.failed" mt="2">
                  {error}
                </Text>
              )}
            </Step>
          </Stack>
        </Surface>

        <Stack gap="6">
          {plot && (
            <Surface p="0" overflow="hidden">
              <MapContainer key={plot.properties.id} center={[plot.properties.centroid[1], plot.properties.centroid[0]]} zoom={14} style={{ height: 260, width: '100%' }} scrollWheelZoom={false}>
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Imagery © Esri, Maxar, Earthstar Geographics" />
                <GeoJSON data={plot} style={{ className: 'plot-shape is-selected', fillOpacity: 0.12, weight: 2 }} />
                {result?.gps && <CircleMarker center={result.gps} radius={8} pathOptions={{ className: result.passed ? 'photo-pin ok' : 'photo-pin bad', weight: 3, fillOpacity: 0.9 }} />}
                {result?.gps && <ShowPhoto plot={plot.geometry.coordinates[0] as [number, number][]} gps={result.gps} />}
              </MapContainer>
              <Text fontSize="caption" color="fg.muted" px="4" py="2.5" borderTopWidth="1px" borderColor="hairline">
                {t('Outline')}: {plot.properties.name}. {t('Dot: where the photo was taken.')}
              </Text>
            </Surface>
          )}

          {/* one list: the rules before a photo is checked, the verdict for each rule after */}
          <Surface p="0" overflow="hidden">
            <HStack justify="space-between" gap="3" px="5" py="4">
              <Text as="h2" textStyle="h3">
                {t('Checks')}
              </Text>
              {result ? (
                <Chip tone={result.passed ? 'brand' : 'red'} dot>
                  {result.passed ? t('Accepted as stewardship evidence') : t('Rejected')}
                </Chip>
              ) : (
                <Text fontSize="caption" color="fg.muted">
                  {file ? t('Ready to check') : t('Waiting for a photo')}
                </Text>
              )}
            </HStack>
            {RULES.map(([id, title, rule]) => {
              const r = result?.checks.find((c) => c.id === id)
              const state = !result ? 'pending' : !r ? 'skipped' : r.ok === true ? 'pass' : r.ok === false ? 'fail' : 'skipped'
              return (
                <HStack key={id} align="start" gap="3.5" px="5" py="3.5" borderTopWidth="1px" borderColor="hairline">
                  <Status state={state} />
                  <Box minW="0" flex="1">
                    <HStack justify="space-between" gap="3" align="baseline">
                      <Text fontSize="small" fontWeight="600">
                        {t(title)}
                      </Text>
                      {state !== 'pending' && (
                        <Text fontSize="label" fontFamily="mono" color={state === 'pass' ? 'brand.fg' : state === 'fail' ? 'status.failed' : 'fg.subtle'} flexShrink={0}>
                          {state === 'pass' ? t('pass') : state === 'fail' ? t('fail') : t('not checked')}
                        </Text>
                      )}
                    </HStack>
                    <Text fontSize="caption" color="fg.muted" lineHeight="1.55" mt="0.5">
                      {r ? t(r.detail) : t(rule)}
                    </Text>
                  </Box>
                </HStack>
              )
            })}
            <Text fontSize="caption" color="fg.muted" px="5" py="3.5" borderTopWidth="1px" borderColor="hairline" bg="surfaceSunken" lineHeight="1.55">
              {t('Photos are not stored: only the results, a hash and the fingerprint are kept.')}
              {result && (
                <>
                  {' '}
                  {t('Evidence hash')} <Mono>{shortHash(result.evidenceHash, 6)}</Mono>
                </>
              )}
            </Text>
          </Surface>
        </Stack>
      </Grid>
    </Page>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Box>
      <HStack gap="2.5" mb="2.5" align="baseline">
        <Mono fontSize="caption" color="fg.subtle">
          {n}
        </Mono>
        <Text fontSize="small" fontWeight="600">
          {title}
        </Text>
      </HStack>
      {children}
    </Box>
  )
}

/** Small status mark: an empty ring before the check, then pass, fail or not checked. */
function Status({ state }: { state: 'pending' | 'pass' | 'fail' | 'skipped' }) {
  const style = {
    pending: { borderColor: 'hairlineStrong', bg: 'transparent', color: 'transparent', icon: null },
    pass: { borderColor: 'brand.solid', bg: 'brand.solid', color: 'white', icon: <Check size={11} strokeWidth={3} /> },
    fail: { borderColor: 'status.failed', bg: 'status.failed', color: 'white', icon: <X size={11} strokeWidth={3} /> },
    skipped: { borderColor: 'hairlineStrong', bg: 'surfaceSunken', color: 'fg.subtle', icon: <Minus size={11} strokeWidth={3} /> },
  }[state]
  return (
    <Box w="18px" h="18px" mt="0.5" borderRadius="full" borderWidth="1.5px" borderColor={style.borderColor} bg={style.bg} color={style.color} display="grid" placeItems="center" flexShrink={0}>
      {style.icon}
    </Box>
  )
}

/** Zooms out so a photo taken outside the plot is visible next to it. */
function ShowPhoto({ plot, gps }: { plot: [number, number][]; gps: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    const b = latLngBounds(plot.map(([lon, lat]) => [lat, lon] as [number, number])).extend(gps)
    map.fitBounds(b, { padding: [36, 36], maxZoom: 15 })
  }, [map, plot, gps])
  return null
}
