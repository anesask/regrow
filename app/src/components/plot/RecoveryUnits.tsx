import { useT } from '@/lib/i18n'
import { Box, Button, HStack, Input, SimpleGrid, Stack, Table, Text } from '@chakra-ui/react'
import { Award, Stamp } from 'lucide-react'
import { useState } from 'react'
import { parseUnits } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { Eyebrow, Figure, Mono, PanelHeader, primaryButton, Surface } from '@/components/ui'
import { formatVru, hasRegistry, type PlotStatus, registry, VRU_DECIMALS } from '@/lib/contracts'
import { shortHash } from '@/lib/format'
import { useTx } from '@/lib/tx'

/** Verified Recovery Units of one plot: issuance, your entitlement, and permanent retirement. */
export function RecoveryUnits({ chainId, status }: { chainId: number; status?: PlotStatus }) {
  const { t } = useT()
  const { address } = useAccount()
  const { send, pending } = useTx()
  const [amount, setAmount] = useState('')
  const [beneficiary, setBeneficiary] = useState('')
  const [purpose, setPurpose] = useState('')
  const id = BigInt(chainId)
  const iss = useReadContract({ ...registry, functionName: 'issuance', args: [id], query: { enabled: hasRegistry, refetchInterval: 15_000 } })
  const area = useReadContract({ ...registry, functionName: 'areaHa', args: [id], query: { enabled: hasRegistry } })
  const avail = useReadContract({ ...registry, functionName: 'available', args: [id, address!], query: { enabled: hasRegistry && !!address, refetchInterval: 15_000 } })
  const done = useReadContract({ ...registry, functionName: 'retired', args: [id, address!], query: { enabled: hasRegistry && !!address } })
  if (!hasRegistry) return null

  const issued = !!iss.data && iss.data.issuedAt > 0n
  let wei = 0n
  try {
    wei = parseUnits(amount || '0', VRU_DECIMALS)
  } catch {
    wei = 0n
  }
  const tooMuch = avail.data !== undefined && wei > avail.data

  return (
    <Surface>
      <PanelHeader title={t('Verified recovery units')} right={<Award size={16} color="var(--chakra-colors-brand-fg)" />} />
      <Text fontSize="caption" color="fg.muted" lineHeight="1.6" mb="4">
        {t('1 VRU = 1 hectare returned to its pre-fire vegetation condition, weighted by the final verified score. Issued once per restored plot, 20% held back as a buffer against reversal, the rest shared by funders. Units cannot be traded, only retired once, publicly.')}
      </Text>
      {!issued ? (
        status === 'Completed' ? (
          <Button {...primaryButton} size="sm" w="full" disabled={!!pending} onClick={() => send('Issue recovery units', { ...registry, functionName: 'issue', args: [id] })}>
            <Award size={14} /> {t('Issue units for this plot')}
          </Button>
        ) : (
          <Text fontSize="caption" color="fg.muted">
            {t('Units are issued when the plot is verified restored')}
            {area.data ? ` (${area.data} ha ${t('registered')})` : ''}.
          </Text>
        )
      ) : (
        <Stack gap="4">
          <SimpleGrid columns={3} gap="3">
            <Figure label={t('Issued')} value={formatVru(iss.data!.units)} hint={`${iss.data!.areaHa} ha × ${(Number(iss.data!.finalScoreBps) / 100).toFixed(0)}%`} />
            <Figure label={t('Buffer')} value={formatVru(iss.data!.buffer)} hint={t('20% held back')} />
            <Figure label={t('Yours')} value={formatVru(avail.data)} hint={done.data ? `${formatVru(done.data)} ${t('retired')}` : t('available to retire')} />
          </SimpleGrid>
          {address && (avail.data ?? 0n) > 0n && (
            <Box borderTopWidth="1px" borderColor="hairline" pt="4">
              <Eyebrow mb="2">{t('Retire units (permanent, public)')}</Eyebrow>
              <Stack gap="2">
                <Input size="sm" placeholder={t('Amount (VRU)')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
                <Input size="sm" placeholder={t('Beneficiary, e.g. company name')} maxLength={120} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
                <Input size="sm" placeholder={t('Purpose, e.g. 2026 sustainability report')} maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                <Button
                  {...primaryButton}
                  size="sm"
                  disabled={!!pending || wei === 0n || tooMuch || !beneficiary.trim()}
                  onClick={() => send(`Retire ${amount} VRU`, { ...registry, functionName: 'retire', args: [id, wei, beneficiary.trim(), purpose.trim()] })}
                >
                  <Stamp size={14} /> {t('Retire')}
                </Button>
                {tooMuch && (
                  <Text fontSize="caption" color="status.failed">
                    More than your available units.
                  </Text>
                )}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </Surface>
  )
}

/** Public retirement record across all plots. */
/** `hideEmpty`: render nothing until the first retirement (where the page already explains retiring). */
export function RetirementLog({ hideEmpty = false }: { hideEmpty?: boolean }) {
  const { t } = useT()
  const count = useReadContract({ ...registry, functionName: 'retirementCount', query: { enabled: hasRegistry, refetchInterval: 20_000 } })
  const n = count.data ?? 0n
  const list = useReadContract({ ...registry, functionName: 'retirements', args: [0n, n], query: { enabled: hasRegistry && n > 0n } })
  if (!hasRegistry || (hideEmpty && n === 0n)) return null
  return (
    <Surface p="0" overflow="hidden">
      <HStack justify="space-between" px="5" py="3.5" borderBottomWidth="1px" borderColor="hairline">
        <Eyebrow>{t('Retirement record · each unit claimed once')}</Eyebrow>
        <Mono color="fg.muted">
          {n.toString()} {t('retirements')}
        </Mono>
      </HStack>
      {n === 0n ? (
        <Text px="5" py="8" textAlign="center" color="fg.muted" fontSize="small">
          {t('No units retired yet. Units are issued when a plot is verified restored.')}
        </Text>
      ) : (
        <Box overflowX="auto">
          <Table.Root size="sm" css={{ '& td, & th': { borderColor: 'hairline' } }}>
            <Table.Body>
              {[...(list.data ?? [])].reverse().map((r, i) => (
                <Table.Row key={i}>
                  <Table.Cell px="5" py="2.5">
                    <Mono color="fg.muted">{new Date(Number(r.retiredAt) * 1000).toISOString().slice(0, 10)}</Mono>
                  </Table.Cell>
                  <Table.Cell px="5" fontWeight="600" fontSize="small">
                    {r.beneficiary}
                  </Table.Cell>
                  <Table.Cell px="5" fontSize="small" color="fg.muted">
                    {r.purpose}
                  </Table.Cell>
                  <Table.Cell px="5" fontSize="small" textAlign="right" whiteSpace="nowrap">
                    {formatVru(r.amount)} VRU · plot #{r.plotId.toString()} · <Mono>{shortHash(r.account, 4)}</Mono>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
    </Surface>
  )
}
