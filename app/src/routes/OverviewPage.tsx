import { Logo } from '@/components/layout/Logo'
import { Box, Button, Flex, Grid, HStack, Link as CLink, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { ArrowRight, Lock, RotateCcw, Users } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { FilizExplainer, WhoFunds } from '@/components/Funding'
import { CountUp, GrowX, Reveal, STEP } from '@/components/motion'
import { CheckVisual, FundVisual, PayVisual, ProtectVisual } from '@/components/StepVisuals'
import { CompareSlider } from '@/components/plot/CompareSlider'
import { Timelapse } from '@/components/Timelapse'
import { cardHover, Eyebrow, Mono, primaryButton, secondaryButton } from '@/components/ui'
import { API_URL } from '@/lib/api'
import { useT } from '@/lib/i18n'

// Anes's personal story for the overview page. Leave null until written (TODO Anes: year, what you saw, photo).
const PERSONAL_STORY: { quote: string; photo?: string } | null = null

const overview = (p: string) => `${API_URL}/data/img/overview/${p}_rgb.webp`
const container = { maxW: '1200px', mx: 'auto', px: { base: '4', md: '6' } } as const

export default function OverviewPage() {
  const { t } = useT()
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [hash])
  return (
    <Box>
      {/* Hero */}
      <Box bg="shell" borderBottomWidth="1px" borderColor="hairline">
        <Grid {...container} templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={{ base: '10', lg: '14' }} py={{ base: '12', lg: '20' }} alignItems="center">
          <Stack gap="6" minW="0">
            <Reveal onMount delay={0}>
              <HStack gap="2">
                <Box w="6px" h="6px" borderRadius="full" bg="brand.solid" />
                <Eyebrow color="brand.fg">{t("Verified post-wildfire restoration")}</Eyebrow>
              </HStack>
            </Reveal>
            <Reveal onMount delay={1 * STEP}>
              <Text as="h1" textStyle="display">
                {t("Funding for burned forests, released only when they recover.")}
              </Text>
            </Reveal>
            <Reveal onMount delay={2 * STEP}>
              <Text fontSize={{ base: 'body', md: 'lead' }} color="fg.muted" lineHeight="1.65" maxW="560px">
                {t("A forest burned. You fund its recovery. Every quarter, satellites check whether it really grows back. If it does, the local people protecting it get paid. If it does not, you get your money back.")}
              </Text>
            </Reveal>
            <Reveal onMount delay={3 * STEP}>
              <HStack gap="3" flexWrap="wrap">
                <Button asChild {...primaryButton} size="lg" px="6">
                  <Link to="/plots">
                    {t("Explore the plots")} <ArrowRight size={16} />
                  </Link>
                </Button>
                <Button asChild {...secondaryButton} size="lg" px="6">
                  <Link to="/methodology">{t("Read the methodology")}</Link>
                </Button>
              </HStack>
            </Reveal>
            <Reveal onMount delay={4 * STEP}>
              <HStack gap="2" fontSize="small" color="fg.muted">
                <Logo size={15} />
                <Text>
                  {t("This demo runs on")}{' '}
                  <CLink href="#filiz" color="brand.fg" fontWeight="600">
                    Filiz (FLZ)
                  </CLink>
                  {t(", free play money. No real funds.")}
                </Text>
              </HStack>
            </Reveal>
          </Stack>
          <Reveal onMount delay={0.25} y={28} style={{ minWidth: 0 }}>
            <CompareSlider before={overview('pre')} after={overview('post')} beforePeriod="pre" afterPeriod="post" zoom={1.06} aspectRatio="9/8" borderRadius="card" boxShadow="card" />
            <HStack justify="space-between" mt="3" gap="4" flexWrap="wrap">
              <Mono color="fg.muted">Manavgat, Antalya · 36.9°N 31.5°E</Mono>
              <Mono color="fg.muted">Sentinel-2 L2A · 20 m · {t('drag to compare')}</Mono>
            </HStack>
          </Reveal>
        </Grid>
      </Box>

      {/* Key figures */}
      <Box borderBottomWidth="1px" borderColor="hairline" bg="surface">
        <SimpleGrid {...container} columns={{ base: 2, md: 4 }}>
          {/* one story, left to right: the fire, what we track, how it recovers, where the money goes */}
          <KeyFigure value="56,663 ha" label={t("burned at Manavgat in July 2021")} source={t("GTÜ mapping")} />
          <KeyFigure value="534" label={t("burned forest slopes measured by satellite every quarter")} source={t("64 ha each · Sentinel-2")} />
          <KeyFigure value="64%" label={t("median recovery by 2026, beyond what weather explains")} source={t("vs. matched unburned forest")} />
          <KeyFigure value="87.5%" label={t("of funds would have reached local stewards; the rest refunded")} source={t("backtest 2021-2026")} last />
        </SimpleGrid>
      </Box>

      {/* Time-lapse */}
      <Box {...container} py={{ base: '10', md: '14' }}>
        <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={{ base: '8', lg: '14' }} alignItems="center">
          <Reveal>
            <Stack gap="4">
              <Eyebrow>{t('Five summers from space')}</Eyebrow>
              <Text as="h2" textStyle="h2">
                {t('Watch the forest come back.')}
              </Text>
              <Text color="fg.muted" fontSize="body" lineHeight="1.65">
                {t('The same Sentinel-2 view of the burn scar, every summer from 2021 to 2026. This is the data the escrow pays on: not photos we picked, not claims, just what the satellite saw.')}
              </Text>
              <Stack gap="2" mt="2">
                {(
                  [
                    ['#3d5a2e', 'Dark green: healthy forest'],
                    ['#6b2232', 'Dark red: freshly burned'],
                    ['#a08a6c', 'Brown: bare ground and young shrubs'],
                  ] as const
                ).map(([c, label]) => (
                  <HStack key={label} gap="2.5" fontSize="small" color="fg.muted">
                    <Box w="14px" h="14px" borderRadius="3px" bg={c} flexShrink={0} />
                    <Text>{t(label)}</Text>
                  </HStack>
                ))}
              </Stack>
            </Stack>
          </Reveal>
          <Reveal delay={0.1} style={{ minWidth: 0 }}>
            <Timelapse />
          </Reveal>
        </Grid>
      </Box>

      {/* Problem */}
      <Box {...container} py={{ base: '14', md: '20' }}>
        <SectionTitle eyebrow={t("The problem")} title={t("After a fire, money arrives. Proof of results does not.")} />
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={{ base: '8', md: '10' }} mt="10">
          <Numbered n="01" title={t("Planting nobody checks")}>
            {t("Post-fire donations fund tree planting, but survival on burned slopes is rarely verified and outcomes are hard to audit.")}
          </Numbered>
          <Numbered n="02" title={t("Some restoration does harm")}>
            {t("Turkish red pine regenerates from seed after fire. Salvage logging, new roads and terracing can damage that recovery and the soil (Tavşanoğlu & Pausas, Science 2022).")}
          </Numbered>
          <Numbered n="03" title={t("Damage spreads downhill")}>
            {t("Bare slopes erode. Rain carries ash and soil into rivers and coastal waters along a coast that depends on tourism.")}
          </Numbered>
        </SimpleGrid>
      </Box>

      {/* How it works */}
      <Box bg="shell" borderY="1px solid" borderColor="hairline">
        <Box {...container} py={{ base: '14', md: '20' }}>
          <SectionTitle eyebrow={t("How it works")} title={t("Pay for verified recovery, including natural regeneration.")} />
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} gap="4" mt="10">
            <Step n="1" visual={<FundVisual />} title={t("Fund a plot")}>
              {t("Supporters lock money for one burned 64 ha plot. It waits in the escrow, not with us.")}
            </Step>
            <Step n="2" visual={<ProtectVisual />} title={t("Locals protect it")}>
              {t("Village co-operatives guard it: fire watch, no grazing, no clearing.")}
            </Step>
            <Step n="3" visual={<CheckVisual />} title={t("Satellites check it")}>
              {t("Every quarter, satellites compare it with unburned forest nearby.")}
            </Step>
            <Step n="4" visual={<PayVisual />} title={t("Paid or refunded")}>
              {t("Stewards are paid for what the evidence confirms. The rest goes back.")}
            </Step>
          </SimpleGrid>
        </Box>
      </Box>

      {/* Demo currency, then who can fund */}
      <FilizExplainer />
      <WhoFunds />

      {/* Why on-chain */}
      <Box bg="ink" color="white">
        <Grid {...container} templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={{ base: '10', lg: '14' }} py={{ base: '14', md: '20' }} alignItems="center">
          <Stack gap="8">
            <Stack gap="3">
              <Eyebrow color="forest.300">{t("Where the money goes")}</Eyebrow>
              <Text as="h2" textStyle="h2">
                {t("Paid to the people on the ground. Back to you if the forest does not return.")}
              </Text>
            </Stack>
            <Stack gap="6">
              <DarkPoint i={0} icon={<Users size={17} />} title={t("Local stewards earn it")}>
                {t("Paid for each result the satellites confirm.")}
              </DarkPoint>
              <DarkPoint i={1} icon={<RotateCcw size={17} />} title={t("Refunds without waiting")}>
                {t("Every missed target is refunded at once.")}
              </DarkPoint>
              <DarkPoint i={2} icon={<Lock size={17} />} title={t("Rules nobody can bend")}>
                {t("A smart contract holds the money; anyone can check each payout.")}
              </DarkPoint>
            </Stack>
          </Stack>
          <Box bg="rgba(255,255,255,0.04)" borderWidth="1px" borderColor="rgba(255,255,255,0.10)" borderRadius="card" p={{ base: '5', md: '7' }}>
            <Text fontSize="caption" color="whiteAlpha.700">
              {t("Backtest on all 534 burned forest cells, 2021-2026")}
            </Text>
            <Text fontFamily="heading" fontSize="title" fontWeight="600" letterSpacing="-0.02em" mt="2">
              {t("Of every 1,000 FLZ funded:")}
            </Text>
            <GrowX>
            <HStack gap="1" h="40px" borderRadius="md" overflow="hidden" mt="4">
              <Flex h="full" bg="forest.600" align="center" px="3" style={{ flex: 875 }}>
                <Mono fontWeight="600" color="white">875</Mono>
              </Flex>
              <Flex h="full" bg="#bf3a2b" align="center" justify="center" style={{ flex: 125 }} minW="44px">
                <Mono fontWeight="600" color="white">125</Mono>
              </Flex>
            </HStack>
            </GrowX>
            <HStack justify="space-between" mt="2" fontSize="caption" color="whiteAlpha.800" gap="4">
              <Text>{t("paid to stewards for recovery they delivered")}</Text>
              <Text textAlign="right">{t("back to funders")}</Text>
            </HStack>
            {/* the argument for paying stewards: damage after the fire, not the fire, decides failure */}
            <Box mt="7" pt="6" borderTopWidth="1px" borderColor="rgba(255,255,255,0.10)">
              <Text fontWeight="600" fontSize="small">
                {t("Why protection matters")}
              </Text>
              <Text fontSize="caption" color="whiteAlpha.700">
                {t("Share of burned areas that failed to recover by 2026")}
              </Text>
              <Stack gap="3.5" mt="4">
                <FailBar label={t("Left alone")} value={8} />
                <FailBar label={t("Cleared or terraced after the fire")} value={68} />
              </Stack>
            </Box>
            <HStack mt="6" pt="5" borderTopWidth="1px" borderColor="rgba(255,255,255,0.10)" gap="3" align="baseline">
              <Mono color="white" fontWeight="600" fontSize="body">
                <CountUp value="56%" />
              </Mono>
              <Text fontSize="small" color="whiteAlpha.800">
                {t("of failures were already flagged in the first year.")}
              </Text>
            </HStack>
            <CLink asChild color="forest.300" fontSize="small" fontWeight="600" mt="5" display="inline-flex" alignItems="center" gap="1.5">
              <Link to="/impact">
                {t("See the full backtest")} <ArrowRight size={14} />
              </Link>
            </CLink>
          </Box>
        </Grid>
      </Box>

      {PERSONAL_STORY && (
        <Box {...container} py="16" textAlign="center" maxW="760px">
          {PERSONAL_STORY.photo && <img src={PERSONAL_STORY.photo} alt="" style={{ margin: '0 auto 24px', maxHeight: 320, borderRadius: 12 }} />}
          <Text fontFamily="heading" fontSize="title" lineHeight="1.4" letterSpacing="-0.01em">
            “{PERSONAL_STORY.quote}”
          </Text>
          <Text mt="3" fontSize="small" color="fg.muted">
            Anes, builder of ReGrow
          </Text>
        </Box>
      )}

      {/* CTA */}
      <Box {...container} py={{ base: '14', md: '20' }}>
        <Reveal>
        <Flex
          direction={{ base: 'column', md: 'row' }}
          justify="space-between"
          align={{ md: 'center' }}
          gap="6"
          bg="surface"
          borderWidth="1px"
          borderColor="hairline"
          borderRadius="card"
          boxShadow="card"
          p={{ base: '6', md: '10' }}
        >
          <Stack gap="2" maxW="560px">
            <Text as="h2" textStyle="h2" fontSize={{ base: '22px', md: '26px' }}>
              {t("Five summers of real satellite data. Every payout on a public ledger.")}
            </Text>
            <Text color="fg.muted" fontSize="small">
              {t("Plots that recover, plots that fail and one that was bulldozed after the fire.")}
            </Text>
          </Stack>
          <HStack gap="3" flexShrink={0}>
            <Button asChild {...primaryButton} size="lg" px="6">
              <Link to="/plots">
                {t("Explore the plots")} <ArrowRight size={16} />
              </Link>
            </Button>
            <Button asChild {...secondaryButton} size="lg" px="6">
              <Link to="/transparency">{t("View the ledger")}</Link>
            </Button>
          </HStack>
        </Flex>
        </Reveal>
      </Box>
    </Box>
  )
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <Reveal>
    <Stack gap="3" maxW="720px">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text as="h2" textStyle="h2">
        {title}
      </Text>
    </Stack>
    </Reveal>
  )
}

function KeyFigure({ value, label, source, last }: { value: string; label: string; source: string; last?: boolean }) {
  return (
    <Box py="7" px={{ base: '0', md: '6' }} pr="4" borderRightWidth={{ md: last ? '0' : '1px' }} borderColor="hairline" _first={{ pl: '0' }}>
      <Text textStyle="h2" fontVariantNumeric="tabular-nums">
        <CountUp value={value} />
      </Text>
      <Text fontSize="small" color="fg.muted" mt="1" lineHeight="1.5">
        {label}
      </Text>
      <Mono lang="en" fontSize="label" color="fg.subtle" mt="2" display="block" textTransform="uppercase" letterSpacing="0.08em">
        {source}
      </Mono>
    </Box>
  )
}

function Numbered({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <Reveal delay={(Number(n) - 1) * STEP}>
    <Stack gap="3" borderTopWidth="1px" borderColor="hairlineStrong" pt="5">
      <Mono color="brand.fg" fontWeight="600">
        {n}
      </Mono>
      <Text as="h3" textStyle="h3" fontSize="lead">
        {title}
      </Text>
      <Text color="fg.muted" fontSize="small" lineHeight="1.65">
        {children}
      </Text>
    </Stack>
    </Reveal>
  )
}

function Step({ n, visual, title, children }: { n: string; visual: ReactNode; title: string; children: ReactNode }) {
  return (
    <Reveal delay={(Number(n) - 1) * STEP} style={{ height: '100%' }}>
    <Stack h="full" gap="3" bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="card" p="3" pb="5" {...cardHover}>
      {visual}
      <Stack gap="2" px="2" pt="1">
        <Mono color="brand.fg" fontWeight="600" fontSize="label">
          {n.padStart(2, '0')}
        </Mono>
        <Text as="h3" textStyle="h3">
          {title}
        </Text>
        <Text color="fg.muted" fontSize="small" lineHeight="1.6">
          {children}
        </Text>
      </Stack>
    </Stack>
    </Reveal>
  )
}

/** One bar of the failure comparison: label and percentage above, a red bar that grows into view. */
function FailBar({ label, value }: { label: string; value: number }) {
  return (
    <Stack gap="1.5">
      <HStack justify="space-between" gap="4" fontSize="small">
        <Text color="whiteAlpha.900">{label}</Text>
        <Mono color="white" fontWeight="600" fontSize="small">
          <CountUp value={`${value}%`} />
        </Mono>
      </HStack>
      <Box h="8px" borderRadius="full" bg="rgba(255,255,255,0.08)" overflow="hidden">
        <Box w={`${value}%`} h="full">
          <GrowX>
            <Box h="8px" borderRadius="full" bg="status.failed" />
          </GrowX>
        </Box>
      </Box>
    </Stack>
  )
}

function DarkPoint({ i, icon, title, children }: { i: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Reveal delay={i * STEP}>
    <HStack align="start" gap="4">
      <Box w="34px" h="34px" flexShrink={0} borderRadius="md" bg="rgba(255,255,255,0.06)" color="forest.300" display="grid" placeItems="center">
        {icon}
      </Box>
      <Box>
        <Text fontWeight="600" fontSize="body">
          {title}
        </Text>
        <Text color="whiteAlpha.700" fontSize="small" lineHeight="1.6" mt="1">
          {children}
        </Text>
      </Box>
    </HStack>
    </Reveal>
  )
}
