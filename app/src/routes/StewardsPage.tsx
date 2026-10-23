import { Box, Button, Grid, HStack, Link as CLink, SimpleGrid, Stack, Table, Text } from '@chakra-ui/react'
import { ArrowRight, Ban, Camera, Flame, Footprints } from 'lucide-react'
import { Link } from 'react-router'
import { useReadContracts } from 'wagmi'
import { StatusChip } from '@/components/plot/badges'
import { Eyebrow, Figure, Mono, Page, PageHeader, PanelHeader, primaryButton, Surface } from '@/components/ui'
import { usePlots } from '@/lib/api'
import { deployed, escrow, formatFlz, STATUS } from '@/lib/contracts'
import { shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

const DUTIES = [
  [Flame, 'Fire watch', 'Patrols in the dry season and early reports, because a second fire destroys years of regrowth.'],
  [Footprints, 'Keep grazing out', 'Goats and cattle eat the young shoots of pine and oak. Stewards keep herds off the plot.'],
  [Ban, 'No clearing or building', 'Stop terracing, salvage logging or construction. Satellites check this every quarter.'],
  [Camera, 'Prove presence', 'Geotagged photos from inside the plot, checked for place, date and reuse.'],
] as const

// the payout schedule of every plot (contracts: milestone bps), as on How it works
const SCHEDULE: { bps: number; bg: string }[] = [
  // labelled segments are dark enough for white text (WCAG AA)
  { bps: 15, bg: 'forest.600' },
  { bps: 5, bg: 'forest.500' },
  { bps: 5, bg: 'forest.500' },
  { bps: 5, bg: 'forest.500' },
  { bps: 5, bg: 'forest.500' },
  { bps: 30, bg: 'forest.700' },
  { bps: 35, bg: 'forest.800' },
]

/** Who is paid, for what, and how much each plot's stewards have earned so far. Read live from the escrow. */
export default function StewardsPage() {
  const { t } = useT()
  const plots = usePlots()
  const list = (plots.data?.features ?? []).filter((f) => f.properties.kind === 'plot' && f.properties.chainId != null)
  const onchain = useReadContracts({
    contracts: list.map((f) => ({ ...escrow, functionName: 'getPlot', args: [BigInt(f.properties.chainId!)] }) as const),
    query: { enabled: deployed && list.length > 0, refetchInterval: 15_000 },
  })
  const rows = list.map((f, i) => ({ f, p: onchain.data?.[i]?.result as ChainPlot | undefined }))
  const sum = (k: (p: ChainPlot) => bigint) => rows.reduce((s, r) => s + (r.p ? k(r.p) : 0n), 0n)
  const paid = sum((p) => p.released)
  const toEarn = sum((p) => p.totalFunded - p.settled)
  const settled = rows.reduce((s, r) => s + (r.p?.nextMilestone ?? 0), 0)
  const steps = rows.reduce((s, r) => s + (r.p?.milestones.length ?? 0), 0)
  const ready = rows.some((r) => r.p)

  return (
    <Page>
      <PageHeader eyebrow={t('Participants')} title={t('Stewards')}>
        {t('Stewards are the local teams who protect a burned slope while it grows back: forest-village co-operatives working with the forest authority (OGM in Türkiye). They are paid for results, not for promises.')}
      </PageHeader>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" mb="6">
        <Surface>
          <Figure label={t('Plots under stewardship')} value={list.length || '-'} />
        </Surface>
        <Surface>
          <Figure label={t('Milestones settled')} value={ready ? `${settled}/${steps}` : '-'} hint={t('across all plots')} />
        </Surface>
        <Surface>
          <Figure label={t('Paid to stewards')} value={formatFlz(paid)} hint="FLZ" />
        </Surface>
        <Surface>
          <Figure label={t('Still to be earned')} value={formatFlz(toEarn)} hint={t('FLZ locked, awaiting evidence')} />
        </Surface>
      </SimpleGrid>

      <Grid templateColumns={{ base: '1fr', lg: '1fr 380px' }} gap="6" alignItems="stretch" mb="6">
        <Surface display="flex" flexDirection="column">
          <PanelHeader title={t('What a steward does')} />
          <SimpleGrid columns={{ base: 1, md: 2 }} gapX="6" gapY="7" mt="2" mb="6">
            {DUTIES.map(([Icon, title, text]) => (
              <HStack key={title} align="start" gap="3">
                <Box color="brand.fg" bg="brand.subtle" borderRadius="md" p="2" flexShrink={0}>
                  <Icon size={17} />
                </Box>
                <Box>
                  <Text fontWeight="600" fontSize="small">
                    {t(title)}
                  </Text>
                  <Text fontSize="caption" color="fg.muted" lineHeight="1.55" mt="0.5">
                    {t(text)}
                  </Text>
                </Box>
              </HStack>
            ))}
          </SimpleGrid>
          <HStack mt="auto" pt="5" borderTopWidth="1px" borderColor="hairline" justify="space-between" gap="4" flexWrap="wrap">
            <Text fontSize="caption" color="fg.muted" lineHeight="1.55" maxW="520px">
              {t('Who stewards are: forest-village co-operatives, village groups or NGOs under contract with the forest authority, which opens each plot and approves its steward.')}
            </Text>
            <CLink asChild color="brand.fg" fontSize="caption" fontWeight="600" display="inline-flex" alignItems="center" gap="1">
              <Link to="/how-it-works">
                {t('How it works')} <ArrowRight size={13} />
              </Link>
            </CLink>
          </HStack>
        </Surface>

        <Surface bg="ink" color="white" borderColor="ink" display="flex" flexDirection="column">
          <Eyebrow color="whiteAlpha.700" mb="2">
            {t('For stewards')}
          </Eyebrow>
          <Text fontFamily="heading" fontSize="title" fontWeight="600" letterSpacing="-0.02em" lineHeight="1.25">
            {t('How you get paid')}
          </Text>
          <HStack gap="1" h="30px" borderRadius="sm" overflow="hidden" mt="4">
            {SCHEDULE.map((s, i) => (
              <Box key={i} h="full" bg={s.bg} display="flex" alignItems="center" justifyContent="center" style={{ flex: s.bps }} minW="0">
                {s.bps >= 15 && (
                  <Mono fontSize="label" fontWeight="600" color="white">
                    {s.bps}%
                  </Mono>
                )}
              </Box>
            ))}
          </HStack>
          <HStack gap="1" mt="1.5" fontSize="label" color="whiteAlpha.700">
            <Text style={{ flex: 15 }}>{t('Start')}</Text>
            <Text style={{ flex: 20 }} textAlign="center">
              {t('4 × 5% check-ins')}
            </Text>
            <Text style={{ flex: 30 }} textAlign="center">
              2023
            </Text>
            <Text style={{ flex: 35 }} textAlign="center">
              2026
            </Text>
          </HStack>
          <Stack gap="2" fontSize="small" color="whiteAlpha.800" lineHeight="1.55" mt="4" mb="5">
            <Text>{t('Each share is paid in proportion to what the satellites confirm.')}</Text>
            <Text>{t('Payments go straight from the contract to your account. Nobody can hold them back once the evidence is in.')}</Text>
          </Stack>
          <Button asChild {...primaryButton} size="md" w="full" mt="auto">
            <Link to="/steward">
              {t('Check in with a photo')} <ArrowRight size={15} />
            </Link>
          </Button>
        </Surface>
      </Grid>

      <Surface p="0" overflow="hidden">
        <Box px="5" pt="5">
          <PanelHeader title={t('Plots and their stewards')} />
        </Box>
        <Table.ScrollArea>
          <Table.Root size="sm" fontSize="small">
            <Table.Header>
              <Table.Row bg="surfaceSunken">
                {['Plot', 'Steward', 'Status', 'Milestones', 'Funded', 'Paid', 'Still to earn'].map((h, i) => (
                  <Table.ColumnHeader key={h} textAlign={i >= 4 ? 'right' : 'left'} fontFamily="mono" fontSize="label" letterSpacing="0.06em" textTransform="uppercase" color="fg.muted" px="5" whiteSpace="nowrap">
                    {t(h)}
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map(({ f, p }) => (
                <Table.Row key={f.properties.id}>
                  <Table.Cell px="5" whiteSpace="nowrap">
                    <CLink asChild fontWeight="600" color="fg" _hover={{ color: 'brand.fg' }}>
                      <Link to={`/plot/${f.properties.id}`}>{f.properties.name}</Link>
                    </CLink>
                  </Table.Cell>
                  <Table.Cell px="5">{p ? <Mono color="fg.muted">{shortHash(p.steward, 4)}</Mono> : '-'}</Table.Cell>
                  <Table.Cell px="5">{p ? <StatusChip status={STATUS[p.status]} /> : '-'}</Table.Cell>
                  <Table.Cell px="5">
                    {p ? (
                      <HStack gap="2.5">
                        <HStack gap="0.5" aria-hidden="true">
                          {p.milestones.map((_, i) => (
                            <Box key={i} w="12px" h="6px" borderRadius="full" bg={i < p.nextMilestone ? (STATUS[p.status] === 'Failed' && i === p.nextMilestone - 1 ? 'status.failed' : 'brand.solid') : 'hairlineStrong'} />
                          ))}
                        </HStack>
                        <Mono fontSize="label" color="fg.muted">
                          {p.nextMilestone}/{p.milestones.length}
                        </Mono>
                      </HStack>
                    ) : (
                      '-'
                    )}
                  </Table.Cell>
                  <Table.Cell px="5" textAlign="right" fontVariantNumeric="tabular-nums">
                    {p ? formatFlz(p.totalFunded) : '-'}
                  </Table.Cell>
                  <Table.Cell px="5" textAlign="right" fontVariantNumeric="tabular-nums">
                    {p ? formatFlz(p.released) : '-'}
                  </Table.Cell>
                  <Table.Cell px="5" textAlign="right" fontVariantNumeric="tabular-nums">
                    {p ? formatFlz(p.totalFunded - p.settled) : '-'}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Surface>
      <Text fontSize="caption" color="fg.muted" mt="4" lineHeight="1.6">
        {t('In this prototype every plot uses one test steward account. In a pilot each plot is assigned to a named local team, whose account and agreement are published here.')}
      </Text>
    </Page>
  )
}

interface ChainPlot {
  steward: `0x${string}`
  status: number
  nextMilestone: number
  milestones: readonly unknown[]
  totalFunded: bigint
  settled: bigint
  released: bigint
}
