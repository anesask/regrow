import { useT } from '@/lib/i18n'
import { Box, Grid, HStack, Link, Stack, Text } from '@chakra-ui/react'
import { Check, Clock, ExternalLink, FileJson, Minus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Chip, Mono, type Tone } from '@/components/ui'
import { type ChainEvent, evidenceUrl, type Milestone } from '@/lib/api'
import { shortHash } from '@/lib/format'
import { fill } from '@/lib/i18n'
import { explorerUrl, txUrl } from '@/lib/wagmi'
import { OUTCOME } from './badges'
import { VerifyEvidence } from './VerifyEvidence'

interface OnChainReport {
  exists: boolean
  executed: boolean
  fractionBps: number
}

const periodText = (p: string) => (p.includes('Q') ? `${p.slice(4)} ${p.slice(0, 4)}` : p)

function LinkPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      display="inline-flex"
      alignItems="center"
      gap="1.5"
      px="2"
      py="0.5"
      borderWidth="1px"
      borderColor="hairline"
      borderRadius="md"
      fontSize="label"
      color="fg.muted"
      _hover={{ color: 'fg', bg: 'surfaceSunken', textDecoration: 'none' }}
    >
      {children}
    </Link>
  )
}

/** Whole sentences with {placeholders}, so each language puts the numbers where its grammar needs them. */
function explain(m: Milestone, t: (s: string) => string): ReactNode {
  if (m.kind === 'baseline') return t('Burn severity measured from the July and September 2021 images; stewardship begins.')
  if (m.kind === 'checkin') {
    if (m.inconclusive) return t('Too cloudy to judge this quarter; the steward gets the benefit of the doubt.')
    const drop = m.netDrop ?? 0
    return drop > 0.1
      ? fill(t('Vegetation fell {drop} NBR more than in the control forest: clearing or damage detected.'), { drop: drop.toFixed(2) })
      : t('No clearing, construction or re-burn detected by satellite this quarter.')
  }
  const score = m.scoreBps / 100
  const target = (m.targetBps ?? 0) / 100
  return (
    <>
      {fill(t('Recovery vs. matched controls in summer {period}:'), { period: m.period })}{' '}
      <Text as="span" fontWeight="600" color={score >= target ? 'brand.fg' : score >= target * 0.5 ? 'status.paused' : 'status.failed'}>
        {score.toFixed(0)}%
      </Text>
      {m.ci95 != null && <> ± {(m.ci95 * 100).toFixed(1)}</>} {fill(t('against a {target}% target.'), { target: target.toFixed(0) })}
      {m.confident === false ? ` ${t('Within measurement noise, so the graded payout is proportional.')}` : ''}{' '}
      {fill(t('Below {limit}% the plot fails.'), { limit: (target / 2).toFixed(0) })}
    </>
  )
}

/** "Check-in Q4 2021" -> translated "Check-in" + quarter; other labels are dictionary keys. */
const milestoneLabel = (label: string, t: (s: string) => string) => (label.startsWith('Check-in ') ? `${t('Check-in')} ${label.slice(9)}` : t(label))

export function MilestoneTimeline({
  plotId,
  milestones,
  reports,
  events,
}: {
  plotId: string
  milestones: Milestone[]
  reports?: readonly OnChainReport[]
  events: ChainEvent[]
}) {
  const { t } = useT()
  return (
    <Stack gap="0">
      {milestones.map((m, i) => {
        const r = reports?.[m.idx]
        const executed = events.find((e) => e.event === 'MilestoneExecuted' && Number(e.args.idx) === m.idx)
        const reported = events.filter((e) => e.event === 'MilestoneReported' && Number(e.args.idx) === m.idx).at(-1)
        const settled = !!r?.executed
        const fraction = settled ? r!.fractionBps : m.fractionBps
        const o = OUTCOME[m.outcome]
        const state: { tone: Tone; label: string } = settled
          ? fraction === 10_000
            ? { tone: 'brand', label: t('Paid out') }
            : fraction === 0
              ? { tone: 'red', label: t('Refunded') }
              : { tone: 'amber', label: `${fraction / 100}% ${t('paid · rest refunded')}` }
          : r?.exists
            ? { tone: 'blue', label: t('Reported') }
            : { tone: 'muted', label: t('Awaiting report') }
        const last = i === milestones.length - 1
        const icon = settled ? (fraction === 10_000 ? <Check size={13} strokeWidth={3} /> : fraction === 0 ? <X size={13} strokeWidth={3} /> : <Minus size={13} strokeWidth={3} />) : <Clock size={13} />
        return (
          <Grid key={m.idx} templateColumns="26px 1fr" columnGap="4">
            <Stack align="center" gap="0">
              <Box
                w="26px"
                h="26px"
                borderRadius={m.kind === 'checkin' ? 'md' : 'full'}
                display="grid"
                placeItems="center"
                bg={settled ? (fraction === 10_000 ? 'brand.solid' : fraction === 0 ? 'status.failed' : 'status.paused') : 'surface'}
                color={settled ? 'white' : 'fg.muted'}
                borderWidth={settled ? '0' : '1px'}
                borderColor="hairlineStrong"
              >
                {icon}
              </Box>
              {!last && <Box flex="1" w="1px" bg="hairlineStrong" my="1" />}
            </Stack>
            <Box pb={last ? '0' : '5'} minW="0">
              <HStack justify="space-between" gap="3" flexWrap="wrap">
                <HStack gap="2" flexWrap="wrap">
                  <Text fontWeight="600" fontSize="small">
                    {milestoneLabel(m.label, t)}
                  </Text>
                  <Mono color="fg.muted" fontSize="label">
                    {periodText(m.period)} · {m.bps / 100}%{m.scenes ? ` · ${m.scenes} ${t('scenes')}` : ''}
                  </Mono>
                </HStack>
                <HStack gap="1.5">
                  {!settled && (
                    <Chip tone={o.tone} dot>
                      {t('satellite')}: {t(o.label).toLowerCase()}
                    </Chip>
                  )}
                  <Chip tone={state.tone}>{state.label}</Chip>
                </HStack>
              </HStack>
              <Text fontSize="caption" color="fg.muted" mt="1" lineHeight="1.55">
                {explain(m, t)}
              </Text>
              <HStack gap="1.5" mt="2" flexWrap="wrap">
                <LinkPill href={evidenceUrl(plotId, `m${m.idx}`)}>
                  <FileJson size={12} /> <Mono fontSize="label">{shortHash(m.evidenceHash)}</Mono>
                </LinkPill>
                <VerifyEvidence plotKey={plotId} idx={m.idx} evidenceHash={m.evidenceHash} />
                {explorerUrl && reported && (
                  <LinkPill href={txUrl(reported.txHash)}>
                    {t('report')} <ExternalLink size={11} />
                  </LinkPill>
                )}
                {explorerUrl && executed && (
                  <LinkPill href={txUrl(executed.txHash)}>
                    {t('settlement')} <ExternalLink size={11} />
                  </LinkPill>
                )}
                {!explorerUrl && (executed || reported) && <Mono color="fg.subtle" fontSize="label">tx {shortHash((executed ?? reported)!.txHash, 4)}</Mono>}
              </HStack>
            </Box>
          </Grid>
        )
      })}
    </Stack>
  )
}
