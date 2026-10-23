import { Box, Button, HStack, Stack, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { ArrowRight, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { EASE } from '@/components/motion'
import { API_URL, usePlots, useResults } from '@/lib/api'
import { useT } from '@/lib/i18n'

// One Sentinel-2 summer composite per frame, all with the same colour stretch (pipeline/05_thumbnails.py).
const FRAMES = [
  { p: 'pre', year: 'Jul 2021', short: 'Jul 21', label: 'Before the fire' },
  { p: 'post', year: 'Sep 2021', short: 'Sep 21', label: 'Weeks after the fire' },
  { p: '2022', year: '2022', short: '2022', label: 'Bare slopes' },
  { p: '2023', year: '2023', short: '2023', label: 'First green' },
  { p: '2024', year: '2024', short: '2024', label: 'Growing back' },
  { p: '2025', year: '2025', short: '2025', label: 'Growing back' },
  { p: '2026', year: '2026', short: '2026', label: 'Most slopes green again' },
] as const
const STEP_MS = 1900
const ZOOM = 1.05
const HOLD_LAST_MS = 3500
const src = (p: string) => `${API_URL}/data/img/timelapse/${p}.webp`

interface Overview {
  bounds: [[number, number], [number, number]] // [[south, west], [north, east]] of the Web Mercator image
}
interface Robustness {
  trajectories: { all: { series: { year: string; median: number }[] } }
}
const getJson = <T,>(f: string) => fetch(`${API_URL}/data/${f}`).then((r) => r.json() as Promise<T>)

/** lon/lat -> position on the Web Mercator image, as fractions of its width and height. */
function project([lon, lat]: [number, number], b: Overview['bounds']) {
  const merc = (d: number) => Math.log(Math.tan(Math.PI / 4 + (d * Math.PI) / 360))
  const [[s, w], [n, e]] = b
  return { x: (lon - w) / (e - w), y: (merc(n) - merc(lat)) / (merc(n) - merc(s)) }
}

/** Recovery of a plot in a frame. Before the fire there is nothing to recover (null); right after it, 0; then the
 *  measured score vs matched controls. */
const recoveryAt = (p: string, periods: Record<string, { adj: number | null }>) =>
  p === 'pre' ? null : p === 'post' ? 0 : (periods[p]?.adj ?? null)

const tone = (v: number | null, p: string) =>
  p === 'pre' ? '#ffffff' : v == null ? '#8a8f88' : v < 0.3 ? '#d64533' : v < 0.6 ? '#e7a93a' : '#22a873'

/** What a plot's value means in a frame: words before and right after the fire, a percentage afterwards. */
function valueText(v: number | null, p: string, t: (s: string) => string) {
  if (p === 'pre') return t('Before the fire: healthy forest')
  if (p === 'post') return t('Just burned')
  return v == null ? '-' : `${Math.round(v * 100)}% ${t('recovery')}`
}

interface Dot {
  id: string
  name: string
  x: number
  y: number
  series: (number | null)[]
}

/** Interactive satellite time-lapse of the Manavgat burn scar, 2021-2026, with the real plots as live dots. */
export function Timelapse() {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '0px 0px -20% 0px' })
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  // 'auto' plays on its own unless the reader prefers reduced motion; pressing Play or Pause is always honoured
  const [mode, setMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [active, setActive] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (id: string) => {
    clearTimeout(hideTimer.current)
    setActive(id)
  }
  // leaving a dot closes its card after a moment, so the pointer can still reach the card's link
  const hideSoon = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setActive(null), 250)
  }
  const playing = active == null && (mode === 'on' || (mode === 'auto' && !reduce))
  const ready = loaded >= FRAMES.length

  const plots = usePlots()
  const results = useResults()
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => getJson<Overview>('overview.json'), staleTime: Infinity })
  const robust = useQuery({ queryKey: ['research', 'robustness.json'], queryFn: () => getJson<Robustness>('robustness.json'), staleTime: Infinity })

  useEffect(() => {
    if (!playing || !inView || !ready) return
    const id = setTimeout(() => setI((n) => (n + 1) % FRAMES.length), i === FRAMES.length - 1 ? HOLD_LAST_MS : STEP_MS)
    return () => clearTimeout(id)
  }, [i, playing, inView, ready])

  const dots: Dot[] =
    overview.data && results.data
      ? (plots.data?.features ?? [])
          .filter((f) => f.properties.kind === 'plot')
          .map((f) => ({
            id: f.properties.id,
            name: f.properties.name,
            ...project(f.properties.centroid as [number, number], overview.data.bounds),
            series: FRAMES.map((fr) => recoveryAt(fr.p, results.data[f.properties.id]?.periods ?? {})),
          }))
      : []
  const f = FRAMES[i]
  const median = robust.data?.trajectories.all.series.find((s) => s.year === f.p)?.median
  const big = f.p === 'pre' ? t('Forest intact') : f.p === 'post' ? t('Burned') : median != null ? `${Math.round(median * 100)}%` : ''
  const bigLabel = f.p === 'pre' || f.p === 'post' ? f.year : t('median recovery, 534 burned cells')
  const found = dots.find((d) => d.id === active)
  const sel = found && { ...found, x: 0.5 + (found.x - 0.5) * ZOOM, y: 0.5 + (found.y - 0.5) * ZOOM }

  return (
    <Stack as="figure" gap="3" ref={ref} m="0" onKeyDown={(e) => e.key === 'Escape' && setActive(null)}>
      <Box position="relative" aspectRatio="1100/979" borderRadius="card" overflow="hidden" onClick={() => setActive(null)}>
        {/* zoomed 5% so the thin no-data edges of the reprojected images are cropped; dots zoom with the image */}
        <Box position="absolute" inset="0" transform={`scale(${ZOOM})`}>
        {inView || loaded > 0
          ? FRAMES.map((fr, n) => (
              <img
                key={fr.p}
                src={src(fr.p)}
                alt={n === i ? `${t('Sentinel-2 image of the Manavgat burn scar')}, ${fr.year}: ${t(fr.label)}` : ''}
                aria-hidden={n !== i}
                onLoad={() => setLoaded((c) => c + 1)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: n === i ? 1 : 0, transition: reduce ? 'none' : 'opacity .8s ease' }}
              />
            ))
          : null}

        {/* the real plots, coloured by that year's measured recovery */}
        {dots.map((d) => {
          const v = d.series[i]
          const c = tone(v, f.p)
          const on = d.id === active
          return (
            <Box
              key={d.id}
              as="button"
              position="absolute"
              style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}
              transform="translate(-50%, -50%)"
              w="30px"
              h="30px"
              display="grid"
              placeItems="center"
              cursor="pointer"
              zIndex={on ? 3 : 2}
              aria-label={`${d.name}, ${f.year}: ${valueText(v, f.p, t)}`}
              aria-expanded={on}
              onClick={(e) => {
                e.stopPropagation()
                setActive(on ? null : d.id)
              }}
              // hover only for a real mouse: on touch, the tap toggles the card
              onPointerEnter={(e) => e.pointerType === 'mouse' && show(d.id)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && hideSoon()}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && show(d.id)} // keyboard; taps and clicks toggle below
            >
              {!reduce && (
                <motion.span
                  style={{ position: 'absolute', width: 14, height: 14, borderRadius: '50%', background: c }}
                  animate={{ scale: [1, 2.4], opacity: [0.55, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <motion.span
                animate={{ backgroundColor: c, scale: on ? 1.35 : 1 }}
                transition={{ duration: 0.5, ease: EASE }}
                style={{ position: 'relative', width: 14, height: 14, borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 6px rgba(0,0,0,.5)' }}
              />
            </Box>
          )
        })}

        </Box>

        {/* the selected plot's card, placed beside its dot and kept inside the image */}
        <AnimatePresence>
          {sel && (
            <motion.div
              key={sel.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              onPointerEnter={() => clearTimeout(hideTimer.current)}
              onPointerLeave={(e) => e.pointerType === 'mouse' && hideSoon()}
              style={{
                position: 'absolute',
                zIndex: 4,
                width: 210,
                ...(sel.x > 0.55 ? { right: `${(1 - sel.x) * 100 + 3}%` } : { left: `${sel.x * 100 + 3}%` }),
                ...(sel.y > 0.45 ? { bottom: `${(1 - sel.y) * 100 + 3}%` } : { top: `${sel.y * 100 + 3}%` }),
              }}
            >
              <PlotCard dot={sel} i={i} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* year and the headline number for the frame */}
        <Box display={{ base: 'none', md: 'block' }} position="absolute" left="3" bottom="3" bg="rgba(6,36,26,0.80)" color="white" px="3.5" py="2.5" borderRadius="md" backdropFilter="blur(4px)" pointerEvents="none" minW="150px">
          <Headline k={f.p} big={big} label={bigLabel} />
        </Box>
        <HStack position="absolute" top="3" left="3" gap="2" bg="rgba(6,36,26,0.80)" color="white" px="3" py="1.5" borderRadius="md" backdropFilter="blur(4px)" pointerEvents="none">
          <Text fontFamily="mono" fontWeight="600" fontSize="small">
            {f.year}
          </Text>
          <Text fontSize="small" color="whiteAlpha.800">
            {t(f.label)}
          </Text>
        </HStack>
        <Button
          aria-label={t(playing ? 'Pause time-lapse' : 'Play time-lapse')}
          position="absolute"
          top="3"
          right="3"
          size="xs"
          h="30px"
          px="3"
          gap="1.5"
          borderRadius="full"
          bg="rgba(6,36,26,0.80)"
          color="white"
          fontWeight="600"
          backdropFilter="blur(4px)"
          _hover={{ bg: 'action.primary' }}
          onClick={(e) => {
            e.stopPropagation()
            setActive(null)
            if (playing) return setMode('off')
            if (i === FRAMES.length - 1) setI(0) // at the end, play again from 2021
            setMode('on')
          }}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
          {playing ? t('Pause') : t('Play 2021-2026')}
        </Button>
      </Box>

      <Box display={{ base: 'block', md: 'none' }} bg="ink" color="white" px="3.5" py="2.5" borderRadius="md">
        <Headline k={f.p} big={big} label={bigLabel} />
      </Box>

      {/* scrubber: drag or use the arrow keys to move through the years */}
      <Stack as="figcaption" gap="1.5">
        <input
          type="range"
          min={0}
          max={FRAMES.length - 1}
          step={1}
          value={i}
          aria-label={t('Choose a year')}
          aria-valuetext={`${f.year}: ${t(f.label)}`}
          onChange={(e) => {
            setI(Number(e.target.value))
            setMode('off')
          }}
          style={{ width: '100%', accentColor: 'var(--chakra-colors-action-primary)', cursor: 'pointer' }}
        />
        <HStack justify="space-between" gap="1">
          {FRAMES.map((fr, n) => (
            <Text key={fr.p} fontFamily="mono" fontSize="label" color={n === i ? 'fg' : 'fg.muted'} fontWeight={n === i ? '600' : '400'} flex="1" textAlign={n === 0 ? 'left' : n === FRAMES.length - 1 ? 'right' : 'center'}>
              <Box as="span" display={{ base: 'inline', md: 'none' }}>
                {fr.short}
              </Box>
              <Box as="span" display={{ base: 'none', md: 'inline' }}>
                {fr.year}
              </Box>
            </Text>
          ))}
        </HStack>
        <Text fontSize="caption" color="fg.muted">
          {t('Dots are the funded demo plots. Hover or tap one to see its recovery.')}
        </Text>
      </Stack>
    </Stack>
  )
}

function Headline({ k, big, label }: { k: string; big: string; label: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
        <Text fontFamily="heading" fontWeight="600" fontSize="title" lineHeight="1.1" fontVariantNumeric="tabular-nums">
          {big}
        </Text>
        <Text fontSize="caption" color="whiteAlpha.800">
          {label}
        </Text>
      </motion.div>
    </AnimatePresence>
  )
}

/** Card for one plot: this year's recovery, the whole path as a sparkline, and a link to the plot. */
function PlotCard({ dot, i }: { dot: Dot; i: number }) {
  const { t } = useT()
  const v = dot.series[i]
  const p = FRAMES[i].p
  // the line starts at the fire (0%); before it there is no recovery to draw
  const after = dot.series.slice(1)
  const pts = after.map((s, n) => [6 + (n * 168) / (after.length - 1), 34 - Math.max(-0.2, Math.min(1.1, s ?? 0)) * 26] as const)
  return (
    <Box bg="surface" color="fg" borderRadius="md" boxShadow="0 10px 30px rgba(0,0,0,.35)" p="3" borderWidth="1px" borderColor="hairline">
      <Text fontWeight="600" fontSize="small" lineHeight="1.3">
        {dot.name}
      </Text>
      {p === 'pre' || p === 'post' ? (
        <Text fontSize="small" mt="0.5" fontWeight="600" color={p === 'post' ? '#d64533' : 'brand.fg'}>
          {valueText(v, p, t)} · {FRAMES[i].year}
        </Text>
      ) : (
        <HStack gap="1.5" mt="0.5" align="baseline">
          <Text fontFamily="heading" fontWeight="600" fontSize="lead" color={tone(v, p)}>
            {v == null ? '-' : `${Math.round(v * 100)}%`}
          </Text>
          <Text fontSize="caption" color="fg.muted">
            {t('recovery')} · {FRAMES[i].year}
          </Text>
        </HStack>
      )}
      {/* no recovery line before the fire: there is nothing to recover yet */}
      {p !== 'pre' && (
        <>
          <svg viewBox="0 0 180 40" width="100%" height="40" aria-hidden style={{ display: 'block', marginTop: 4 }}>
            <line x1="6" x2="174" y1={34 - 0.6 * 26} y2={34 - 0.6 * 26} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 3" />
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--chakra-colors-brand-solid)" strokeWidth="2" />
            {i > 0 && <circle cx={pts[i - 1][0]} cy={pts[i - 1][1]} r="3.5" fill={tone(v, p)} stroke="white" strokeWidth="1.5" />}
          </svg>
          <Text fontSize="label" color="fg.subtle" fontFamily="mono">
            {t('dashed line: 60% target')}
          </Text>
        </>
      )}
      <Link to={`/plot/${dot.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 13, fontWeight: 600, color: 'var(--chakra-colors-brand-fg)' }}>
        {t('Open plot')} <ArrowRight size={13} />
      </Link>
    </Box>
  )
}
