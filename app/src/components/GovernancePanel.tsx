import { Box, Grid, HStack, Link, Stack, Text } from '@chakra-ui/react'
import { ArrowRight, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { useReadContract, useReadContracts } from 'wagmi'
import { Eyebrow, Mono, PanelHeader, Surface } from '@/components/ui'
import type { ChainEvent } from '@/lib/api'
import { addresses, deployed, escrow, formatFlz, timelock } from '@/lib/contracts'
import { shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { addressUrl, explorerUrl } from '@/lib/wagmi'

const fmtDuration = (s: bigint | number | undefined) => {
  if (s === undefined) return '-'
  const n = Number(s)
  if (n === 0) return 'none'
  if (n % 86_400 === 0) return `${n / 86_400} day${n === 86_400 ? '' : 's'}`
  if (n % 3600 === 0) return `${n / 3600} h`
  if (n % 60 === 0) return `${n / 60} min`
  return `${n} s`
}

function Addr({ a }: { a?: string }) {
  if (!a) return <Mono>-</Mono>
  return explorerUrl ? (
    <Link href={addressUrl(a)} target="_blank" rel="noreferrer" color="fg.muted">
      <Mono>{shortHash(a, 4)}</Mono>
    </Link>
  ) : (
    <Mono color="fg.muted">{shortHash(a, 4)}</Mono>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <HStack justify="space-between" gap="4" py="2" borderTopWidth="1px" borderColor="hairline" fontSize="small" _first={{ borderTopWidth: 0 }}>
      <Text color="fg.muted">{k}</Text>
      <Box textAlign="right">{children}</Box>
    </HStack>
  )
}

/** Who can do what, read live from the contracts, plus every committed evidence set. */
export function GovernancePanel({ events }: { events: ChainEvent[] }) {
  const { t } = useT()
  const roles = useReadContracts({
    contracts: [
      { ...escrow, functionName: 'ORACLE_ROLE' },
      { ...escrow, functionName: 'GUARDIAN_ROLE' },
      { ...escrow, functionName: 'PLOT_MANAGER_ROLE' },
      { ...escrow, functionName: 'DEFAULT_ADMIN_ROLE' },
      { ...escrow, functionName: 'oracleThreshold' },
      { ...escrow, functionName: 'challengeWindow' },
      { ...escrow, functionName: 'maxPause' },
      { ...escrow, functionName: 'challengeBond' },
      { ...escrow, functionName: 'replantingPool' },
    ],
    query: { enabled: deployed },
  })
  const [oracleRole, guardianRole, managerRole, adminRole, threshold, window, maxPause, bond, pool] = (roles.data ?? []).map((r) => r.result)
  const members = (role: unknown, n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...escrow, functionName: 'getRoleMember' as const, args: [role as `0x${string}`, BigInt(i)] as const }))
  const counts = useReadContracts({
    contracts: [
      { ...escrow, functionName: 'getRoleMemberCount', args: [oracleRole as `0x${string}`] },
      { ...escrow, functionName: 'getRoleMemberCount', args: [guardianRole as `0x${string}`] },
      { ...escrow, functionName: 'getRoleMemberCount', args: [adminRole as `0x${string}`] },
      { ...escrow, functionName: 'getRoleMemberCount', args: [managerRole as `0x${string}`] },
    ],
    query: { enabled: !!oracleRole },
  })
  const [nOracle, nGuardian, nAdmin, nManager] = (counts.data ?? []).map((r) => Number(r.result ?? 0))
  const lists = useReadContracts({
    contracts: [...members(oracleRole, nOracle || 0), ...members(guardianRole, nGuardian || 0), ...members(adminRole, nAdmin || 0), ...members(managerRole, nManager || 0)],
    query: { enabled: (nOracle ?? 0) > 0 },
  })
  const addrs = (lists.data ?? []).map((r) => r.result as string | undefined)
  const oracles = addrs.slice(0, nOracle)
  const guardians = addrs.slice(nOracle, nOracle + nGuardian)
  const admins = addrs.slice(nOracle + nGuardian, nOracle + nGuardian + nAdmin)
  const managers = addrs.slice(nOracle + nGuardian + nAdmin)
  const delay = useReadContract({ ...timelock, functionName: 'getMinDelay', query: { enabled: deployed } })
  const adminIsTimelock = admins.length === 1 && admins[0]?.toLowerCase() === timelock.address.toLowerCase()
  const commits = events.filter((e) => e.event === 'DatasetCommitted')

  if (!deployed) return null
  return (
    <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap="4" mb="6">
      <Surface>
        <PanelHeader title={t('Governance · who can do what')} />
        <Stack gap="0">
          <Row k={t('Admin (roles, rules)')}>
            <HStack gap="1.5" justify="end">
              {adminIsTimelock ? <CheckCircle2 size={14} color="var(--chakra-colors-brand-solid)" /> : <XCircle size={14} color="var(--chakra-colors-status-failed)" />}
              <Text>
                {t('Timelock')}, {t(fmtDuration(delay.data))} {t('delay')}
              </Text>
              <Addr a={timelock.address} />
            </HStack>
          </Row>
          <Row k={t('Oracle committee')}>
            <Text>
              {threshold?.toString() ?? '-'} {t('of')} {nOracle ?? '-'} {t('signatures per dataset')}
            </Text>
            <HStack gap="2" justify="end" mt="0.5">
              {oracles.map((a) => (
                <Addr key={a} a={a} />
              ))}
            </HStack>
          </Row>
          <Row k={t('Forest authority (opens plots, approves steward and method)')}>
            <HStack gap="2" justify="end">
              {managers.map((a) => (
                <Addr key={a} a={a} />
              ))}
            </HStack>
          </Row>
          <Row k={t('Pause and dispute review (forest authority + independent reviewer)')}>
            <HStack gap="2" justify="end">
              {guardians.map((a) => (
                <Addr key={a} a={a} />
              ))}
            </HStack>
          </Row>
          <Row k={t('Challenge window · bond')}>
            <Text>
              {t(fmtDuration(window as bigint))} · {formatFlz(bond as bigint)} FLZ
            </Text>
          </Row>
          <Row k={t('Pause expires after')}>
            <Text>{t(fmtDuration(maxPause as bigint))}</Text>
          </Row>
          <Row k={t('Replanting pool (reinvest only)')}>
            <Addr a={pool as string} />
          </Row>
        </Stack>
        <Text fontSize="caption" color="fg.muted" mt="3" lineHeight="1.55">
          {t('In Türkiye the forest authority is the General Directorate of Forestry (OGM). OGM is the intended partner; no partnership exists yet, so test accounts hold these roles in this prototype.')}
        </Text>
      </Surface>
      <Surface display="flex" flexDirection="column">
        <PanelHeader title={`${t('Committed evidence sets')} · ${commits.length}`} />
        {commits.length === 0 ? (
          <Text fontSize="small" color="fg.muted">
            {t('No dataset committed yet. The oracle committee commits one with the first report.')}
          </Text>
        ) : (
          <Stack gap="3">
            {commits.map((e) => {
              const signers = (e.args.signers as unknown as string[]) ?? []
              return (
                <Box key={e.txHash} borderWidth="1px" borderColor="hairline" borderRadius="md" p="3">
                  <HStack justify="space-between" gap="2">
                    <Eyebrow fontSize="label">#{String(e.args.index)} · {new Date(e.timestamp * 1000).toISOString().slice(0, 10)}</Eyebrow>
                    <Text fontSize="label" color="fg.muted">
                      {signers.length} {t('signers')}
                    </Text>
                  </HStack>
                  <Mono display="block" mt="1.5" fontSize="label">
                    root {shortHash(String(e.args.root), 10)}
                  </Mono>
                  <Link href={`https://ipfs.io/ipfs/${String(e.args.cid)}`} target="_blank" rel="noreferrer" fontSize="label" color="brand.fg">
                    <Mono>ipfs {shortHash(String(e.args.cid), 10)}</Mono> <ExternalLink size={11} style={{ display: 'inline' }} />
                  </Link>
                </Box>
              )
            })}
          </Stack>
        )}
        <Text fontSize="caption" color="fg.muted" mt="4" lineHeight="1.55">
          {t('Every on-chain report must carry a Merkle proof into one of these sets, so scores cannot change after the committee signs.')}
        </Text>
        {/* how an outsider checks all of this without trusting us */}
        <Box mt="auto" pt="5">
          <Text fontSize="small" fontWeight="600" mb="2">
            {t('Check it yourself')}
          </Text>
          <Stack gap="2.5" fontSize="caption" color="fg.muted" lineHeight="1.55">
            <HStack align="start" gap="3">
              <Mono color="fg.subtle">1</Mono>
              <Box>
                {t('Read the escrow contract: every rule above is in its code.')}{' '}
                {explorerUrl ? (
                  <Link href={addressUrl(addresses.RestorationEscrow)} target="_blank" rel="noreferrer" color="brand.fg">
                    <Mono>{shortHash(addresses.RestorationEscrow, 4)}</Mono> <ExternalLink size={11} style={{ display: 'inline' }} />
                  </Link>
                ) : (
                  <Mono>{shortHash(addresses.RestorationEscrow, 4)}</Mono>
                )}
              </Box>
            </HStack>
            <HStack align="start" gap="3">
              <Mono color="fg.subtle">2</Mono>
              <Box>
                {t('Press “Verify” on any milestone: your browser re-hashes the evidence file and checks its Merkle proof.')}{' '}
                <Link asChild color="brand.fg" fontWeight="600">
                  <RouterLink to="/plot/plot-r41c21">
                    {t('Try it on Salur slope')} <ArrowRight size={11} style={{ display: 'inline' }} />
                  </RouterLink>
                </Link>
              </Box>
            </HStack>
            <HStack align="start" gap="3">
              <Mono color="fg.subtle">3</Mono>
              <Box>
                {t('Re-run the science: each evidence file lists its Sentinel-2 scenes, and the pipeline is open.')}{' '}
                <Link asChild color="brand.fg" fontWeight="600">
                  <RouterLink to="/methodology">
                    {t('Methodology')} <ArrowRight size={11} style={{ display: 'inline' }} />
                  </RouterLink>
                </Link>
              </Box>
            </HStack>
          </Stack>
        </Box>
      </Surface>
    </Grid>
  )
}
