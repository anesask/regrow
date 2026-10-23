import { Box, HStack, Stack, Text } from '@chakra-ui/react'
import { Check, Lock, MoveRight } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { EASE } from '@/components/motion'
import story from '@/data/stepStory.json'
import { useT } from '@/lib/i18n'

// Small "product shots" for the four how-it-works cards, drawn from the real data of two demo plots: Salur (steps 1-3)
// and Güzelyalı (recovered only partly, so part of its funds went back). The data and images are a snapshot bundled
// with the app (scripts/step-story.mjs), so the cards render complete at once and never wait for the API.
const img = (f: string) => `/img/story/${f}.webp`
const H = '150px'
const VIEW = { once: true, margin: '0px 0px -10% 0px' } as const

function Frame({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <Box position="relative" h={H} borderRadius="md" overflow="hidden" bg={dark ? 'ink' : 'surfaceSunken'} borderWidth="1px" borderColor="hairline">
      {children}
    </Box>
  )
}

const chip = { bg: 'rgba(6,36,26,0.82)', color: 'white', px: '2', py: '1', borderRadius: 'sm', fontSize: 'label', fontWeight: '600', backdropFilter: 'blur(3px)' } as const

/** 1 · The plot right after the fire, with its 64 ha outline, and the money locked for it. */
export function FundVisual() {
  const { t } = useT()
  const name = story.story.name
  return (
    <Frame dark>
      <img src={img('post_rgb')} alt="" loading="lazy" width={320} height={320} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <HStack position="absolute" top="2" left="2" {...chip}>
        <Text>
          {name} · 64 ha
        </Text>
      </HStack>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={VIEW}
        transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}
        style={{ position: 'absolute', left: 8, bottom: 8 }}
      >
        <HStack gap="1.5" bg="surface" color="fg" px="2.5" py="1.5" borderRadius="md" boxShadow="0 4px 14px rgba(0,0,0,.3)" fontSize="small" fontWeight="600">
          <Lock size={13} color="var(--chakra-colors-brand-solid)" />
          <Text>500 FLZ {t('locked')}</Text>
        </HStack>
      </motion.div>
    </Frame>
  )
}

/** 2 · The four quarterly check-ins of year one, ticked one after another. */
export function ProtectVisual() {
  const { t } = useT()
  const checks = story.story.checkins
  return (
    <Frame>
      <Stack h="full" justify="center" gap="1.5" px="3.5">
        {checks.map((m, n) => {
          const ok = m.passed
          return (
            <motion.div key={m.period} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={VIEW} transition={{ duration: 0.4, ease: EASE, delay: 0.15 + n * 0.18 }}>
              <HStack gap="2.5" fontSize="small">
                <Box w="20px" h="20px" borderRadius="full" bg={ok ? 'brand.solid' : 'status.failed'} color="white" display="grid" placeItems="center" flexShrink={0}>
                  <Check size={12} strokeWidth={3} />
                </Box>
                <Text fontFamily="mono" fontSize="caption" color="fg.muted" minW="62px">
                  {m.period.slice(4)} {m.period.slice(0, 4)}
                </Text>
                <Text fontWeight="500">{ok ? t('no damage seen') : t('damage seen')}</Text>
              </HStack>
            </motion.div>
          )
        })}
      </Stack>
    </Frame>
  )
}

/** 3 · Burn index right after the fire (red) and in 2026 (green), with the measured recovery. */
export function CheckVisual() {
  const { t } = useT()
  const adj = story.story.recovery2026
  return (
    <Frame dark>
      <HStack h="full" gap="0">
        {(
          [
            ['post_nbr', 'Sep 2021'],
            ['2026_nbr', '2026'],
          ] as const
        ).map(([f, label]) => (
          <Box key={f} position="relative" flex="1" h="full">
            <img src={img(f)} alt="" loading="lazy" width={320} height={320} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <Box position="absolute" top="2" left="2" {...chip} fontFamily="mono">
              {label}
            </Box>
          </Box>
        ))}
      </HStack>
      <Box position="absolute" left="50%" top="50%" transform="translate(-50%, -50%)" bg="surface" color="brand.fg" borderRadius="full" w="30px" h="30px" display="grid" placeItems="center" boxShadow="0 2px 10px rgba(0,0,0,.35)">
        <MoveRight size={16} />
      </Box>
        <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={VIEW} transition={{ duration: 0.5, ease: EASE, delay: 0.35 }} style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <Box bg="surface" color="fg" px="2.5" py="1.5" borderRadius="md" boxShadow="0 4px 14px rgba(0,0,0,.3)" fontSize="small" fontWeight="600">
            <Text as="span" color="brand.fg">
              {Math.round(adj * 100)}%
            </Text>{' '}
            {t('recovered')}
          </Box>
        </motion.div>
    </Frame>
  )
}

/** 4 · Payout bars of two real plots: one paid in full, one partly paid with the rest refunded. */
export function PayVisual() {
  const { t } = useT()
  const rows = [story.story, story.partial].map((p) => ({
    id: p.id,
    name: p.name,
    ms: p.payouts,
    paid: p.payouts.reduce((s, m) => s + (m.bps * m.fractionBps) / 10_000, 0) / 100,
  }))
  return (
    <Frame>
      <Stack h="full" justify="center" gap="3.5" px="3.5">
        {rows.map(({ id, name, ms, paid }, r) => (
          <Stack key={id} gap="1.5">
            <HStack justify="space-between" fontSize="caption">
              <Text fontWeight="600" truncate>
                {name}
              </Text>
              <Text color="fg.muted" whiteSpace="nowrap">
                {Math.round(paid)}% {t('paid')}
                {paid < 99.5 && (
                  <Text as="span" color="status.failed">
                    {' '}
                    · {100 - Math.round(paid)}% {t('back')}
                  </Text>
                )}
              </Text>
            </HStack>
            {/* the row (which has a real size) triggers the animation; zero-width segments follow via variants */}
            <motion.div initial="hidden" whileInView="show" viewport={VIEW} style={{ display: 'flex', gap: 2, height: 12 }}>
              {ms.map((m, n) => (
                <Box key={n} h="full" flex={m.bps} display="flex" borderRadius="2px" overflow="hidden" bg="hairline">
                  <motion.div
                    variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.45, ease: EASE, delay: 0.2 + r * 0.35 + n * 0.08 } } }}
                    style={{ transformOrigin: 'left', display: 'flex', width: '100%' }}
                  >
                    <Box flex={m.fractionBps} bg="brand.solid" />
                    <Box flex={10_000 - m.fractionBps} bg="status.failed" />
                  </motion.div>
                </Box>
              ))}
            </motion.div>
          </Stack>
        ))}
        <HStack gap="3" fontSize="label" color="fg.muted">
          <HStack gap="1">
            <Box w="8px" h="8px" borderRadius="2px" bg="brand.solid" />
            <Text>{t('to stewards')}</Text>
          </HStack>
          <HStack gap="1">
            <Box w="8px" h="8px" borderRadius="2px" bg="status.failed" />
            <Text>{t('back to funders')}</Text>
          </HStack>
        </HStack>
      </Stack>
    </Frame>
  )
}
