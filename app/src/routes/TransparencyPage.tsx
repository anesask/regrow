import { Box, Button, HStack, Link as CLink, NativeSelect, SimpleGrid, Skeleton, Stack, Table, Text } from '@chakra-ui/react'
import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { GovernancePanel } from '@/components/GovernancePanel'
import { Chip, Figure, Mono, Page, PageHeader, Segmented, secondaryButton, Surface, type Tone } from '@/components/ui'
import { type ChainEvent, evidenceUrl, useEvents, usePlots } from '@/lib/api'
import { addresses, formatFlz } from '@/lib/contracts'
import { milestoneName, shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { addressUrl, chain, explorerUrl, txUrl } from '@/lib/wagmi'

const EVENT: Record<string, { label: string; tone: Tone }> = {
  PlotCreated: { label: 'Plot created', tone: 'muted' },
  Funded: { label: 'Funded', tone: 'blue' },
  MilestoneReported: { label: 'Oracle report', tone: 'muted' },
  DatasetCommitted: { label: 'Evidence set committed', tone: 'blue' },
  ReportChallenged: { label: 'Report challenged', tone: 'amber' },
  ChallengeResolved: { label: 'Challenge resolved', tone: 'muted' },
  MilestoneExecuted: { label: 'Milestone settled', tone: 'brand' },
  RefundsReleased: { label: 'Refunds released', tone: 'amber' },
  PlotPaused: { label: 'Paused', tone: 'amber' },
  PlotResumed: { label: 'Resumed', tone: 'blue' },
  PlotFailed: { label: 'Plot failed', tone: 'red' },
  PlotCompleted: { label: 'Verified restored', tone: 'brand' },
  Refunded: { label: 'Refund', tone: 'muted' },
  SweptToReplanting: { label: 'To replanting pool', tone: 'muted' },
  ReportCancelled: { label: 'Report cancelled', tone: 'amber' },
}
const MONEY = new Set(['Funded', 'MilestoneExecuted', 'RefundsReleased', 'Refunded'])
const ORACLE = new Set(['DatasetCommitted', 'MilestoneReported', 'ReportChallenged', 'ChallengeResolved', 'PlotPaused', 'PlotResumed', 'PlotFailed', 'PlotCompleted'])
type Filter = 'all' | 'money' | 'oracle'
const PAGE = 15

const big = (v: unknown) => BigInt(v as string | number)

export default function TransparencyPage() {
  const { t } = useT()
  const events = useEvents()
  const plots = usePlots()
  const [filter, setFilter] = useState<Filter>('all')
  const [plotFilter, setPlotFilter] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const all = useMemo(() => events.data?.events ?? [], [events.data])

  const plotByChainId = useMemo(() => {
    const m = new Map<number, { id: string; name: string }>()
    for (const f of plots.data?.features ?? []) if (f.properties.chainId != null) m.set(f.properties.chainId, f.properties)
    return m
  }, [plots.data])

  const totals = useMemo(() => {
    let funded = 0n
    let paid = 0n
    let reports = 0
    let refunded = 0n
    for (const e of all) {
      if (e.event === 'Funded') funded += big(e.args.amount)
      if (e.event === 'MilestoneExecuted') paid += big(e.args.toSteward) + big(e.args.fee ?? 0)
      if (e.event === 'RefundsReleased') refunded += big(e.args.toFunders) + big(e.args.toReplantingPool)
      if (e.event === 'MilestoneReported') reports += 1
    }
    return { funded, paid, refunded, reports }
  }, [all])

  const rows = all
    .filter((e) => EVENT[e.event])
    .filter((e) => filter === 'all' || (filter === 'money' ? MONEY.has(e.event) : ORACLE.has(e.event)))
    .filter((e) => !plotFilter || plotByChainId.get(Number(e.args.plotId))?.id === plotFilter)
    .slice()
    .reverse()
  const shown = rows.slice(0, limit)
  const plotOptions = [...plotByChainId.values()]

  return (
    <Page>
      <PageHeader eyebrow={t('Transparency')} title={t('Public ledger')}>
        {t('Every deposit, oracle report and payout, read directly from the blockchain')} ({chain.name}).{' '}
        {t('Records cannot be edited or deleted, by us or anyone else. Each oracle report carries the hash of its published evidence file.')}
      </PageHeader>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" mb="6">
        <Surface>
          <Figure label={t('Total funded')} value={`${formatFlz(totals.funded)}`} hint={t('FLZ locked by funders')} />
        </Surface>
        <Surface>
          <Figure label={t('Paid to stewards')} value={`${formatFlz(totals.paid)}`} hint={t('FLZ released on evidence')} />
        </Surface>
        <Surface>
          <Figure label={t('Refunded')} value={`${formatFlz(totals.refunded)}`} hint={t('FLZ returned on shortfalls')} />
        </Surface>
        <Surface>
          <Figure label={t('Oracle reports')} value={totals.reports} hint={t('each with an evidence hash')} />
        </Surface>
      </SimpleGrid>

      <GovernancePanel events={all} />

      <Surface p="0" overflow="hidden">
        <HStack justify="space-between" px="5" py="3.5" borderBottomWidth="1px" borderColor="hairline" gap="4" flexWrap="wrap">
          <HStack gap="3" flexWrap="wrap">
            <Segmented
              value={filter}
              onChange={(v) => {
                setFilter(v)
                setLimit(PAGE)
              }}
              options={[
                ['all', t('All events')],
                ['money', t('Money')],
                ['oracle', t('Oracle')],
              ]}
            />
            <NativeSelect.Root size="sm" w="auto">
              <NativeSelect.Field
                aria-label={t('Plot')}
                value={plotFilter}
                onChange={(e) => {
                  setPlotFilter(e.target.value)
                  setLimit(PAGE)
                }}
              >
                <option value="">{t('All plots')}</option>
                {plotOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </HStack>
          <HStack gap="4" flexWrap="wrap">
            {(['RestorationEscrow', 'Filiz', 'ImpactCertificate'] as const).map((k) =>
              explorerUrl ? (
                <CLink key={k} href={addressUrl(addresses[k])} target="_blank" fontSize="caption" color="fg.muted" display="inline-flex" alignItems="center" gap="1.5">
                  {k} <Mono>{shortHash(addresses[k], 4)}</Mono> <ExternalLink size={11} />
                </CLink>
              ) : (
                <Text key={k} fontSize="caption" color="fg.muted">
                  {k} <Mono>{shortHash(addresses[k], 4)}</Mono>
                </Text>
              ),
            )}
          </HStack>
        </HStack>
        <Box overflowX="auto">
          <Table.Root size="sm" variant="line" css={{ '& td, & th': { borderColor: 'hairline' } }}>
            <Table.Header>
              <Table.Row bg="surfaceSunken">
                {[t('Time (UTC)'), t('Event'), t('Plot'), t('Details'), t('Transaction')].map((h, i) => (
                  <Table.ColumnHeader key={h} px="5" py="2.5" textAlign={i === 4 ? 'right' : 'left'}>
                    <Text fontFamily="mono" fontSize="label" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted" fontWeight="500">
                      {h}
                    </Text>
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {events.isLoading &&
                [0, 1, 2, 3, 4].map((i) => (
                  <Table.Row key={i}>
                    <Table.Cell colSpan={5} px="5">
                      <Skeleton h="5" />
                    </Table.Cell>
                  </Table.Row>
                ))}
              {!events.isLoading && rows.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={5} py="12" textAlign="center" color="fg.muted">
                    {events.data?.deployed === false ? t('Contracts not deployed yet.') : t('No events yet.')}
                  </Table.Cell>
                </Table.Row>
              )}
              {shown.map((e) => {
                const plot = plotByChainId.get(Number(e.args.plotId))
                const ev = EVENT[e.event]
                return (
                  <Table.Row key={`${e.txHash}-${e.logIndex}`} _hover={{ bg: 'surfaceSunken' }}>
                    <Table.Cell px="5" py="3" whiteSpace="nowrap">
                      <Mono color="fg.muted">{new Date(e.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')}</Mono>
                    </Table.Cell>
                    <Table.Cell px="5">
                      <Chip tone={ev.tone} dot>
                        {t(ev.label)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell px="5" whiteSpace="nowrap" fontSize="small">
                      {plot ? (
                        <CLink asChild fontWeight="500">
                          <Link to={`/plot/${plot.id}`}>{plot.name}</Link>
                        </CLink>
                      ) : (
                        <Text color="fg.subtle">-</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell px="5" fontSize="small" color="fg.muted">
                      <Details e={e} plotId={plot?.id} />
                    </Table.Cell>
                    <Table.Cell px="5" textAlign="right" whiteSpace="nowrap">
                      {explorerUrl ? (
                        <CLink href={txUrl(e.txHash)} target="_blank" color="fg.muted" display="inline-flex" alignItems="center" gap="1">
                          <Mono>{shortHash(e.txHash, 4)}</Mono> <ExternalLink size={11} />
                        </CLink>
                      ) : (
                        <Mono color="fg.muted">{shortHash(e.txHash, 4)}</Mono>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Root>
        </Box>
        {rows.length > limit && (
          <HStack justify="center" py="4" borderTopWidth="1px" borderColor="hairline">
            <Button {...secondaryButton} size="sm" onClick={() => setLimit((n) => n + PAGE * 2)}>
              {t('Show more')} · {rows.length - limit} {t('older events')}
            </Button>
          </HStack>
        )}
      </Surface>
    </Page>
  )
}

function Details({ e, plotId }: { e: ChainEvent; plotId?: string }) {
  const { t } = useT()
  const a = e.args
  const amt = (v: unknown) => (
    <Text as="span" color="fg" fontVariantNumeric="tabular-nums">
      {formatFlz(big(v))} FLZ
    </Text>
  )
  switch (e.event) {
    case 'Funded':
      return (
        <>
          {amt(a.amount)} {t('from')} <Mono>{shortHash(String(a.funder), 4)}</Mono> · {a.refundOnFail ? t('refundable') : t('replanting pool')}
        </>
      )
    case 'MilestoneReported':
      return (
        <Stack gap="0.5">
          <Text>
            {t(milestoneName(Number(a.idx)))} · {t('score')} {(Number(a.scoreBps) / 100).toFixed(0)}%
          </Text>
          {plotId ? (
            <CLink href={evidenceUrl(plotId, `m${a.idx}`)} target="_blank" color="fg.muted">
              <Mono>
                {t('evidence')} {shortHash(String(a.evidenceHash), 6)}
              </Mono>
            </CLink>
          ) : (
            <Mono>
              {t('evidence')} {shortHash(String(a.evidenceHash), 6)}
            </Mono>
          )}
        </Stack>
      )
    case 'MilestoneExecuted':
      return (
        <>
          {t(milestoneName(Number(a.idx)))} · {Number(a.fractionBps) / 100}% {t('earned')} · {amt(a.toSteward)} {t('to steward')}
          {big(a.refunded) > 0n && (
            <>
              {' '}
              · {amt(a.refunded)} {t('refunded')}
            </>
          )}
        </>
      )
    case 'RefundsReleased':
      return (
        <>
          {amt(a.toFunders)} {t('to funders')} · {amt(a.toReplantingPool)} {t('to replanting pool')}
        </>
      )
    case 'PlotPaused':
      return (
        <Mono>
          {t('evidence')} {shortHash(String(a.evidenceHash), 6)}
        </Mono>
      )
    case 'PlotFailed':
      return (
        <>
          {t(String(a.reason))} · {amt(a.remaining)} {t('released for refunds')}
        </>
      )
    case 'Refunded':
      return (
        <>
          {amt(a.amount)} {t('to')} <Mono>{shortHash(String(a.funder), 4)}</Mono>
        </>
      )
    case 'SweptToReplanting':
      return amt(a.amount)
    case 'PlotCreated':
      return <>{String(a.name)}</>
    default:
      return null
  }
}
