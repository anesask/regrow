import { useT } from '@/lib/i18n'
import { Box, HStack, Text } from '@chakra-ui/react'
import { Check, Minus, X } from 'lucide-react'
import { Chip, type Tone } from '@/components/ui'
import type { Milestone, Outcome, SeverityClass } from '@/lib/api'
import type { PlotStatus } from '@/lib/contracts'
import { SEVERITY_LABEL, SEVERITY_TOKEN } from '@/lib/format'

/** `compact` drops the word "severity" where the context already says it (e.g. the plot list next to the legend). */
export function SeverityChip({ severity, compact = false }: { severity: SeverityClass; compact?: boolean }) {
  const { t } = useT()
  return (
    <Chip dot dotColor={SEVERITY_TOKEN[severity]}>
      {compact ? t(SEVERITY_LABEL[severity]) : t(`${SEVERITY_LABEL[severity]} severity`)}
    </Chip>
  )
}

const STATUS: Record<PlotStatus, { tone: Tone; label: string }> = {
  Active: { tone: 'blue', label: 'Active' },
  Paused: { tone: 'amber', label: 'Paused' },
  Failed: { tone: 'red', label: 'Failed' },
  Completed: { tone: 'brand', label: 'Verified restored' },
}

export function StatusChip({ status }: { status: PlotStatus }) {
  const { t } = useT()
  const s = STATUS[status]
  return (
    <Chip tone={s.tone} dot>
      {t(s.label)}
    </Chip>
  )
}

export const OUTCOME: Record<Outcome, { tone: Tone; label: string; bg: string; fg: string }> = {
  paid: { tone: 'brand', label: 'Paid in full', bg: 'brand.muted', fg: 'brand.fg' },
  partial: { tone: 'amber', label: 'Partly paid', bg: 'orange.subtle', fg: 'status.paused' },
  missed: { tone: 'red', label: 'Missed · refunded', bg: 'red.subtle', fg: 'status.failed' },
  fail: { tone: 'red', label: 'Plot fails', bg: 'red.subtle', fg: 'status.failed' },
  'not reached': { tone: 'muted', label: 'Not reached', bg: 'surfaceSunken', fg: 'fg.subtle' },
}

/** One dot per milestone, coloured by the satellite verdict (what the oracle will report). */
export function VerdictDots({ milestones }: { milestones: Milestone[] }) {
  const { t } = useT()
  const paid = milestones.filter((m) => m.outcome === 'paid' || m.outcome === 'partial').length
  return (
    <HStack gap="0.5">
      {milestones.map((m) => {
        const o = OUTCOME[m.outcome]
        return (
          <Box
            key={m.idx}
            title={`${m.label}: ${t(o.label)}`}
            display="grid"
            placeItems="center"
            w={m.kind === 'checkin' ? '10px' : '16px'}
            h="16px"
            borderRadius={m.kind === 'checkin' ? 'sm' : 'full'}
            bg={o.bg}
            color={o.fg}
          >
            {m.kind !== 'checkin' &&
              (m.outcome === 'paid' ? <Check size={10} strokeWidth={3} /> : m.outcome === 'not reached' ? <Minus size={10} /> : m.outcome === 'partial' ? <Text fontSize="8px" fontWeight="700">½</Text> : <X size={10} strokeWidth={3} />)}
          </Box>
        )
      })}
      <Text fontFamily="mono" fontSize="label" color="fg.muted" ml="1.5">
        {paid}/{milestones.length}
      </Text>
    </HStack>
  )
}
