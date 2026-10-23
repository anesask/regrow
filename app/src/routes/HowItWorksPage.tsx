import { Accordion, Box, Grid, HStack, Link as CLink, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { useT } from '@/lib/i18n'
import { ArrowRight, Building2, Coins, Landmark, Satellite, Trees } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { Chip, Eyebrow, Mono, Page, PageHeader, Surface, type Tone } from '@/components/ui'

/** Actors (lifelines) of the sequence diagram, left to right. */
const ACTORS = [
  { key: 'funder', name: 'Funder', note: 'company, city, citizen, tourist', icon: <Coins size={16} /> },
  { key: 'escrow', name: 'Escrow contract', note: 'holds funds, enforces rules', icon: <Building2 size={16} /> },
  { key: 'oracle', name: 'Satellites & oracle', note: 'Sentinel-2 + signed reports', icon: <Satellite size={16} /> },
  { key: 'steward', name: 'Steward', note: 'local team on the plot', icon: <Trees size={16} /> },
  { key: 'authority', name: 'Forest authority', note: 'owns the land (OGM in Türkiye)', icon: <Landmark size={16} /> },
] as const
type Actor = (typeof ACTORS)[number]['key']
const col = (a: Actor) => ACTORS.findIndex((x) => x.key === a)
const N = ACTORS.length

type Kind = 'money' | 'refund' | 'data' | 'record'
const KIND: Record<Kind, { color: string; dash?: string }> = {
  money: { color: 'brand.solid' },
  refund: { color: 'status.failed' },
  data: { color: 'status.active', dash: '5 4' },
  record: { color: 'fg.muted', dash: '2 4' },
}

interface Msg {
  from: Actor
  to: Actor
  label: string
  detail?: string
  kind: Kind
}

interface Phase {
  title: string
  when: string
  tone: Tone
  steps: (Msg | { note: string; at: Actor })[]
}

const PHASES: Phase[] = [
  {
    title: 'Funding',
    when: 'day 0',
    tone: 'blue',
    steps: [
      { from: 'authority', to: 'escrow', label: 'Opens the plot: approves the steward and the method', detail: 'natural regeneration or planting, on state forest land', kind: 'record' },
      { from: 'funder', to: 'escrow', label: 'Deposit FLZ for a plot', detail: 'choose: refund me, or replanting pool', kind: 'money' },
      { from: 'escrow', to: 'funder', label: 'Mint soulbound impact certificate', kind: 'record' },
      { from: 'oracle', to: 'escrow', label: 'Evidence set committed: 2 of 3 oracle signatures', detail: 'Merkle root of all scores + IPFS CID of the files', kind: 'data' },
      { from: 'escrow', to: 'steward', label: '15% start-up tranche', detail: 'protection, fire watch, reporting', kind: 'money' },
    ],
  },
  {
    title: 'Quarterly check-ins',
    when: 'every 3 months, year one',
    tone: 'brand',
    steps: [
      { note: 'Sentinel-2 revisits every 5 days → quarterly pulse vs. unburned controls', at: 'oracle' },
      { from: 'oracle', to: 'escrow', label: 'Check-in score + Merkle proof (anyone can relay)', detail: 'no clearing, construction or re-burn?', kind: 'data' },
      { from: 'escrow', to: 'steward', label: 'No damage → 5% paid', kind: 'money' },
      { from: 'escrow', to: 'funder', label: 'Damage → this 5% refunded at once', kind: 'refund' },
    ],
  },
  {
    title: 'Recovery milestones',
    when: 'summer 2023 · summer 2026',
    tone: 'brand',
    steps: [
      { from: 'oracle', to: 'escrow', label: 'Recovery score vs. matched controls + evidence hash', detail: 'targets 30% (2023), 60% (2026)', kind: 'data' },
      { from: 'escrow', to: 'steward', label: 'Earned share of 30% / 35% tranche', detail: 'score ÷ target, capped at 100%', kind: 'money' },
      { from: 'escrow', to: 'funder', label: 'Shortfall refunded immediately', kind: 'refund' },
      { from: 'funder', to: 'escrow', label: 'Anyone may challenge a report during the window (bond)', kind: 'record' },
      { from: 'escrow', to: 'funder', label: 'Restored plot: Verified Recovery Units, retire once', detail: 'area × verified score, 20% buffer withheld', kind: 'record' },
    ],
  },
  {
    title: 'If something goes wrong',
    when: 'any time',
    tone: 'red',
    steps: [
      { from: 'oracle', to: 'escrow', label: 'Disturbance flag: sudden vegetation loss', kind: 'data' },
      { note: 'Payouts paused. After 30 days without a decision anyone can expire the pause', at: 'escrow' },
      { from: 'authority', to: 'escrow', label: 'Review with an independent party: approved works → payouts resume', kind: 'record' },
      { from: 'escrow', to: 'funder', label: 'Score below half the target, pause expired or report overdue → all unreleased funds refunded', kind: 'refund' },
    ],
  },
]


interface Qa {
  id: string
  q: string
  lead: string
  a: string
  proof?: { to: string; label: string }
}

/** Grouped, answer first; most answers point to the page with the data behind them. Ids allow links like #faq-oracle. */
const FAQ: { title: string; items: Qa[] }[] = [
  {
    title: 'Money and trust',
    items: [
      { id: 'blockchain', q: 'Why does this need a blockchain?', lead: 'So funders do not have to trust us.', a: 'The escrow enforces the payout rules itself, every score is bound to signed evidence nobody can edit later, and each impact claim exists once and can be retired once, in public. A database we run could not promise that.', proof: { to: '/transparency', label: 'View the ledger' } },
      { id: 'team', q: 'Can the team take the money or change the rules?', lead: 'No. Nobody holds instant admin power.', a: 'Rule changes wait out a public 2-day timelock, parameters are capped in code, and the deployer gives up its admin role. Money can only go to stewards on evidence, back to funders, or into other plots: the replanting pool has no withdraw function.', proof: { to: '/transparency', label: 'View the ledger' } },
      { id: 'oracle', q: 'Who checks the oracle?', lead: 'Anyone can.', a: 'Each evidence set needs 2 of 3 oracle signatures, and every report must prove it belongs to that set. Anyone can re-hash the evidence in the browser with “Verify” on any milestone, re-derive the scores from the listed Sentinel-2 scenes, or challenge a report by posting a bond.', proof: { to: '/methodology', label: 'Read the methodology' } },
      { id: 'fees', q: 'Who pays for verification?', lead: 'A small fee, paid only when the forest recovers.', a: 'The verifier receives at most 5% of each paid tranche (capped in code, 1-2% intended) and nothing from refunds, so verification earns only when recovery is real.' },
    ],
  },
  {
    title: 'The science',
    items: [
      { id: 'natural-regeneration', q: 'Isn’t natural regeneration free? Why pay for it?', lead: 'The fire is not the main threat. What happens after it is.', a: 'Across all 534 burned forest cells, slopes that lost vegetation after the fire (logging, roads, terracing) were 8.5× more likely to still be failing in 2026: 67.6% against 8.0%. Stewards are paid to prevent that damage, and quarterly check-ins catch it within months.', proof: { to: '/impact', label: 'See the full backtest' } },
      { id: 'controls', q: 'How do you know the comparison forest is fair?', lead: 'Each plot gets its own 10 unburned twins.', a: 'Twins are chosen only on pre-fire vegetation, elevation, slope and aspect; after matching, the two groups differ by about 0.1 standard deviations at most. On 1,760 healthy forest cells the damage rule fires 0.34% of the time. Our first version used three regional controls; matching showed they flattered recovery by about 7 points, so we replaced them and published both.', proof: { to: '/research', label: 'See the research' } },
      { id: 'measurement', q: 'What if the satellite measurement is wrong?', lead: 'A small error costs a small amount, not everything.', a: 'Payouts are graded: a score 5 recovery points too low against the 60% target moves that payout by about 8%, not 100%. Every verdict publishes its 95% interval (typically ±5 points), cloudy quarters pass as inconclusive, and a second satellite, Landsat 8/9, gives the same pass or fail for 96.8% of cells.', proof: { to: '/research', label: 'See the research' } },
    ],
  },
  {
    title: 'Context',
    items: [
      { id: 'forestry', q: 'Does this compete with the forestry service?', lead: 'No. It brings the forestry service outside money.', a: 'Burned forest in Türkiye is state land and must by law be restored as forest, led by the General Directorate of Forestry (OGM). ReGrow pays the forest-village co-operatives that already do this work, only on plots the forest authority has opened, and the authority rules on every pause with an independent reviewer. OGM is the intended partner; no partnership exists yet.' },
      { id: 'loop', q: 'Regrowth, prevention or detection?', lead: 'All three, as one loop.', a: 'Funders pay for regrowth, measured against unburned forest. Stewards are paid to prevent damage: fire watch, keeping herds out, no clearing. Quarterly check-ins detect damage within months and pause payouts until it is reviewed.' },
      { id: 'carbon', q: 'How is this a carbon-markets project?', lead: 'It applies the integrity tools carbon markets are criticised for lacking.', a: 'A measured baseline, a control-forest counterfactual, regular monitoring, a 20% buffer against reversal, and recovery units that cannot be sold and can be retired only once, on a public record. The units are an impact claim, not a certified carbon credit.', proof: { to: '/methodology', label: 'Read the methodology' } },
      { id: 'privacy', q: 'What about privacy?', lead: 'We keep results, not photos.', a: 'Steward photos are never stored, only the check results and their hashes, and GPS is used only to check the plot boundary. Funders are pseudonymous addresses; a name appears only if a funder retires units for a named beneficiary.' },
      { id: 'demo', q: 'Is the demo real?', lead: 'The data is real. The money is not.', a: 'Every satellite image and number comes from real Sentinel-2 data, 2021-2026. The money is FLZ play money on a test network, and five years of history are replayed through the contract.' },
    ],
  },
]

const SCHEDULE: { label: string; year?: string; bps: number; tone: string }[] = [
  // fixed deep greens in both colour modes, so the white percentages stay readable
  { label: 'Start', bps: 15, tone: 'forest.600' },
  { label: 'Q1', bps: 5, tone: 'forest.700' },
  { label: 'Q2', bps: 5, tone: 'forest.700' },
  { label: 'Q3', bps: 5, tone: 'forest.700' },
  { label: 'Q4', bps: 5, tone: 'forest.700' },
  { label: 'Early recovery', year: '2023', bps: 30, tone: 'forest.800' },
  { label: 'Sustained recovery', year: '2026', bps: 35, tone: 'forest.900' },
]
// phones: the four 5% check-ins share one label
const SCHEDULE_GROUPS: { label: string; sub?: string; bps: number }[] = [
  { label: 'Start', bps: 15 },
  { label: 'Check-ins Q1-Q4', sub: '5% each', bps: 20 },
  { label: 'Early recovery', sub: '2023', bps: 30 },
  { label: 'Sustained recovery', sub: '2026', bps: 35 },
]

export default function HowItWorksPage() {
  const { t } = useT()
  // a link like /how-it-works#faq-oracle opens that answer
  const openId = useLocation().hash.replace('#faq-', '')
  return (
    <Page>
      <PageHeader eyebrow={t('How it works')} title={t('From deposit to verified recovery')}>
        {t(
          'Five parties, one set of rules enforced by a smart contract. Money only moves when satellite evidence, signed by an oracle committee and proven on-chain, says it should; money that is not earned goes back to funders at once. Rule changes wait out a public timelock.',
        )}
      </PageHeader>

      <Surface mb="6">
        <Eyebrow mb="3">{t('Where each plot’s funds go')}</Eyebrow>
        <HStack gap="1" h="44px" borderRadius="md" overflow="hidden">
          {SCHEDULE.map((s) => (
            <Box key={s.label} h="full" bg={s.tone} color="white" display="flex" alignItems="center" px={{ base: '1.5', md: '2.5' }} style={{ flex: s.bps }} minW="0">
              {/* 5% slices are too thin for a number on phones; the label below says "5% each" */}
              <Text fontFamily="mono" fontSize="label" fontWeight="600" truncate hideBelow={s.bps < 10 ? 'md' : undefined}>
                {s.bps}%
              </Text>
            </Box>
          ))}
        </HStack>
        <HStack gap="1" mt="2" hideBelow="md">
          {SCHEDULE.map((s) => (
            <Text key={s.label} fontSize="label" color="fg.muted" style={{ flex: s.bps }} minW="0" truncate>
              {t(s.label)}
              {s.year && ` · ${s.year}`}
            </Text>
          ))}
        </HStack>
        <HStack gap="1" mt="2" align="start" hideFrom="md">
          {SCHEDULE_GROUPS.map((s) => (
            <Box key={s.label} style={{ flex: s.bps }} minW="0" fontSize="label" color="fg.muted" lineHeight="1.35">
              <Text>{t(s.label)}</Text>
              {s.sub && <Text fontFamily="mono">{t(s.sub)}</Text>}
            </Box>
          ))}
        </HStack>
        <Text fontSize="caption" color="fg.muted" mt="3" lineHeight="1.6">
          {t('Each tranche is paid only for the share the evidence earns. Anything not earned is refunded at that moment, not at the end of the project.')}
        </Text>
      </Surface>

      <Surface p={{ base: '4', md: '6' }}>
        <StepList />
        <Box hideBelow="lg">
          <Lifelines />
          {PHASES.map((ph) => (
            <Box key={ph.title} mt="2">
              <HStack gap="3" py="3" px="1" borderTopWidth="1px" borderColor="hairline" bg="surface" position="relative" zIndex="1">
                <Chip tone={ph.tone} dot>
                  {t(ph.title)}
                </Chip>
                <Mono color="fg.muted">{t(ph.when)}</Mono>
              </HStack>
              <Stack gap="0">
                {ph.steps.map((s, i) => ('note' in s ? <Note key={i} at={s.at} text={t(s.note)} /> : <Arrow key={i} m={s} />))}
              </Stack>
            </Box>
          ))}
          <LifelineFoot />
        </Box>
        <HStack gap="5" mt="5" pt="4" borderTopWidth="1px" borderColor="hairline" flexWrap="wrap">
          <Legend kind="money">{t('funds released')}</Legend>
          <Legend kind="refund">{t('refund')}</Legend>
          <Legend kind="data">{t('satellite evidence (signed, hashed)')}</Legend>
          <Legend kind="record">{t('on-chain record')}</Legend>
        </HStack>
      </Surface>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap="4" mt="6">
        <Principle title={t('Results every season')}>
          {t('Funders see a quarterly satellite pulse for their plot and the outcome of each check-in, not just a verdict after several years.')}
        </Principle>
        <Principle title={t('Refunds without waiting')}>
          {t('Missed check-ins and partial scores are refunded at the moment they are settled. A failed plot releases everything that is left.')}
        </Principle>
        <Principle title={t('Nothing stays frozen')}>
          {t('A paused plot cannot hold funds forever: after 30 days without a decision, anyone can trigger the refunds. The same applies if the oracle misses a deadline.')}
        </Principle>
      </SimpleGrid>

      <Surface mt="6" p={{ base: '5', md: '8' }}>
        <Grid templateColumns={{ base: '1fr', lg: '260px 1fr' }} gap={{ base: '6', lg: '12' }}>
          <Box position={{ lg: 'sticky' }} top={{ lg: '96px' }} alignSelf="start">
            <Text as="h2" textStyle="h2">
              {t('Hard questions, straight answers')}
            </Text>
            <Text fontSize="small" color="fg.muted" mt="3" lineHeight="1.65">
              {t('What funders, foresters and sceptics ask first. Most answers link to the data behind them.')}
            </Text>
          </Box>
          <Stack gap="8">
            {FAQ.map((g) => (
              <Box key={g.title}>
                <Eyebrow mb="1">{t(g.title)}</Eyebrow>
                <Accordion.Root collapsible multiple defaultValue={g.items.some((i) => i.id === openId) ? [openId] : []}>
                  {g.items.map((i) => (
                    // the accordion sets its own ids, so the link target is a wrapper
                    <Box key={i.id} id={`faq-${i.id}`} style={{ scrollMarginTop: '96px' }}>
                    <Accordion.Item value={i.id} borderColor="hairline">
                      <Accordion.ItemTrigger py="3.5" cursor="pointer">
                        <Text flex="1" fontWeight="600" fontSize="body">
                          {t(i.q)}
                        </Text>
                        <Accordion.ItemIndicator />
                      </Accordion.ItemTrigger>
                      <Accordion.ItemContent>
                        <Accordion.ItemBody pb="5" pt="0" maxW="68ch">
                          <Text fontSize="body" fontWeight="600" lineHeight="1.5">
                            {t(i.lead)}
                          </Text>
                          <Text fontSize="small" color="fg.muted" lineHeight="1.65" mt="1.5">
                            {t(i.a)}
                          </Text>
                          {i.proof && (
                            <CLink asChild color="brand.fg" fontSize="small" fontWeight="600" mt="3" display="inline-flex" alignItems="center" gap="1.5">
                              <Link to={i.proof.to}>
                                {t(i.proof.label)} <ArrowRight size={14} />
                              </Link>
                            </CLink>
                          )}
                        </Accordion.ItemBody>
                      </Accordion.ItemContent>
                    </Accordion.Item>
                    </Box>
                  ))}
                </Accordion.Root>
              </Box>
            ))}
          </Stack>
        </Grid>
      </Surface>
    </Page>
  )
}

const COLS = `repeat(${N}, 1fr)`

function Lifelines() {
  const { t } = useT()
  return (
    <Grid templateColumns={COLS} gap="0" pb="2">
      {ACTORS.map((a) => (
        <Stack key={a.key} align="center" gap="1" textAlign="center" px="2">
          <Box w="38px" h="38px" borderRadius="md" bg="brand.subtle" color="brand.fg" display="grid" placeItems="center" borderWidth="1px" borderColor="brand.muted">
            {a.icon}
          </Box>
          <Text fontWeight="600" fontSize="small">
            {t(a.name)}
          </Text>
          <Text fontSize="label" color="fg.muted">
            {t(a.note)}
          </Text>
        </Stack>
      ))}
    </Grid>
  )
}

function LifelineFoot() {
  return <Box h="3" />
}

/** A row with the dashed lifelines drawn behind its content. */
function Row({ children, h = '58px' }: { children: ReactNode; h?: string }) {
  return (
    <Box position="relative" minH={h}>
      <Grid templateColumns={COLS} position="absolute" inset="0" pointerEvents="none">
        {ACTORS.map((a) => (
          <Box key={a.key} display="flex" justifyContent="center">
            <Box w="0" borderLeftWidth="1px" borderStyle="dashed" borderColor="hairlineStrong" />
          </Box>
        ))}
      </Grid>
      {children}
    </Box>
  )
}

function Arrow({ m }: { m: Msg }) {
  const { t } = useT()
  const label = t(m.label)
  const a = col(m.from)
  const b = col(m.to)
  const left = Math.min(a, b)
  const right = Math.max(a, b)
  const toRight = b > a
  const k = KIND[m.kind]
  // span from the centre of the left column to the centre of the right column
  const start = `${((left + 0.5) / N) * 100}%`
  const width = `${((right - left) / N) * 100}%`
  // the row grows with its text (labels wrap on narrow spans and run longer in German and Turkish)
  return (
    <Row>
      <Box position="relative" ml={start} w={width} minH="58px" py="2.5" display="flex" flexDirection="column" justifyContent="center" px="3">
        <Text fontSize="caption" fontWeight="600" textAlign="center" lineHeight="1.3" mb="1" bg="surface" alignSelf="center" px="1.5" position="relative" zIndex="1">
          {label}
        </Text>
        <Box position="relative" h="10px" color={k.color}>
          <svg width="100%" height="10" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <line x1="0" y1="5" x2="100%" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={k.dash} />
          </svg>
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', top: 0, [toRight ? 'right' : 'left']: -2 }}>
            <path d={toRight ? 'M0 0 L10 5 L0 10 Z' : 'M10 0 L0 5 L10 10 Z'} fill="currentColor" />
          </svg>
          <Box position="absolute" top="1px" w="8px" h="8px" borderRadius="full" bg="currentColor" style={{ [toRight ? 'left' : 'right']: -4 }} />
        </Box>
        {m.detail && (
          <Text fontSize="label" color="fg.muted" textAlign="center" mt="1" bg="surface" alignSelf="center" px="1.5" position="relative" zIndex="1">
            {t(m.detail)}
          </Text>
        )}
      </Box>
    </Row>
  )
}

const BORDER: Record<Kind, string> = { money: 'solid', refund: 'solid', data: 'dashed', record: 'dotted' }
const actorName = (a: Actor) => ACTORS[col(a)].name

/** Below lg the five lifelines do not fit: the same steps as a list, each naming who acts towards whom. */
function StepList() {
  const { t } = useT()
  return (
    <Stack gap="6" hideFrom="lg">
      <Stack gap="1.5">
        {ACTORS.map((a) => (
          <HStack key={a.key} gap="2.5" fontSize="small">
            <Box w="26px" h="26px" flexShrink="0" borderRadius="md" bg="brand.subtle" color="brand.fg" display="grid" placeItems="center" borderWidth="1px" borderColor="brand.muted">
              {a.icon}
            </Box>
            <Text>
              <Text as="span" fontWeight="600">
                {t(a.name)}
              </Text>
              <Text as="span" color="fg.muted">
                {' · '}
                {t(a.note)}
              </Text>
            </Text>
          </HStack>
        ))}
      </Stack>
      {PHASES.map((ph) => (
        <Stack key={ph.title} gap="3" pt="4" borderTopWidth="1px" borderColor="hairline">
          <HStack gap="3" flexWrap="wrap">
            <Chip tone={ph.tone} dot>
              {t(ph.title)}
            </Chip>
            <Mono color="fg.muted">{t(ph.when)}</Mono>
          </HStack>
          {ph.steps.map((s, i) =>
            'note' in s ? (
              <Text key={i} fontSize="label" bg="surfaceSunken" borderWidth="1px" borderColor="hairline" borderRadius="md" px="3" py="1.5" color="fg.muted" lineHeight="1.45">
                {t(s.note)}
              </Text>
            ) : (
              <Box key={i} borderLeftWidth="2px" borderLeftStyle={BORDER[s.kind]} borderColor={KIND[s.kind].color} pl="3">
                <Mono fontSize="label" color="fg.muted" display="block">
                  {t(actorName(s.from))} → {t(actorName(s.to))}
                </Mono>
                <Text fontSize="small" fontWeight="600" lineHeight="1.4" mt="0.5">
                  {t(s.label)}
                </Text>
                {s.detail && (
                  <Text fontSize="label" color="fg.muted" mt="0.5">
                    {t(s.detail)}
                  </Text>
                )}
              </Box>
            ),
          )}
        </Stack>
      ))}
    </Stack>
  )
}

function Note({ at, text }: { at: Actor; text: string }) {
  const c = col(at)
  return (
    <Row h="48px">
      <Box position="absolute" top="50%" transform="translate(-50%, -50%)" style={{ left: `${((c + 0.5) / N) * 100}%` }} maxW="300px" zIndex="1">
        <Text fontSize="label" bg="surfaceSunken" borderWidth="1px" borderColor="hairline" borderRadius="md" px="3" py="1.5" textAlign="center" color="fg.muted" lineHeight="1.45">
          {text}
        </Text>
      </Box>
    </Row>
  )
}

function Legend({ kind, children }: { kind: Kind; children: ReactNode }) {
  const k = KIND[kind]
  return (
    <HStack gap="2" fontSize="caption" color="fg.muted">
      <Box color={k.color}>
        <svg width="28" height="8">
          <line x1="0" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={k.dash} />
        </svg>
      </Box>
      {children}
    </HStack>
  )
}

function Principle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Surface>
      <Text as="h3" textStyle="h3">
        {title}
      </Text>
      <Text fontSize="small" color="fg.muted" mt="2" lineHeight="1.6">
        {children}
      </Text>
    </Surface>
  )
}
