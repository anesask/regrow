import { Logo } from '@/components/layout/Logo'
import { Box, Button, Circle, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { useT } from '@/lib/i18n'
import { Link } from 'react-router'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ArrowRight, Award, Check, Droplets, Fuel, Undo2, Wallet } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { parseUnits } from 'viem'
import { useAccount, useBalance, useConnect, useGasPrice, useReadContract } from 'wagmi'
import { toaster } from '@/components/Toaster'
import { Eyebrow, Mono, PanelHeader, primaryButton, secondaryButton, Surface, tertiaryButton } from '@/components/ui'
import { certificate, certificateRef, escrow, formatFlz, type PlotStatus, FLZ_DECIMALS, flz } from '@/lib/contracts'
import { requestDemoGas } from '@/lib/demoWallet'
import { shortHash } from '@/lib/format'
import { useTx } from '@/lib/tx'

const PRESETS = ['100', '500', '2500']

export interface ScheduleStep {
  bps: number
  targetBps: number
}

/**
 * Funding in three plain steps: get a wallet, get test money, choose an amount. The breakdown under the amount shows
 * where each part of the money goes and on what condition, straight from the plot's on-chain schedule.
 */
export function FundCard({ chainId, status, schedule, nextMilestone }: { chainId: number; status?: PlotStatus; schedule?: readonly ScheduleStep[]; nextMilestone?: number }) {
  const active = status === 'Active'
  const { t } = useT()
  const { address, isConnected, connector } = useAccount()
  const { send, pending } = useTx()
  const fee = useFeeGas()
  const [amount, setAmount] = useState('500')
  const [refundOnFail, setRefundOnFail] = useState(true)
  const [addMore, setAddMore] = useState(false)
  const enabled = { query: { enabled: !!address } }

  const balance = useReadContract({ ...flz, functionName: 'balanceOf', args: [address!], ...enabled })
  const allowance = useReadContract({ ...flz, functionName: 'allowance', args: [address!, escrow.address], ...enabled })
  const position = useReadContract({ ...escrow, functionName: 'positionOf', args: [BigInt(chainId), address!], ...enabled })

  const hasPosition = (position.data?.amount ?? 0n) > 0n
  const hasMoney = (balance.data ?? 0n) > 0n
  const choice = hasPosition ? position.data!.refundOnFail : refundOnFail
  let wei = 0n
  try {
    wei = parseUnits(amount || '0', FLZ_DECIMALS)
  } catch {
    wei = 0n
  }
  const tooMuch = balance.data !== undefined && wei > balance.data

  async function fund() {
    if ((allowance.data ?? 0n) < wei) {
      const ok = await send('Approve FLZ', { ...flz, functionName: 'approve', args: [escrow.address, wei] })
      if (!ok) return
    }
    const ok = await send(`Fund ${amount} FLZ`, { ...escrow, functionName: 'fund', args: [BigInt(chainId), wei, choice] })
    if (ok) setAddMore(false)
  }

  if (hasPosition && !addMore) {
    return (
      <Surface data-fund-card="">
        <PanelHeader title={t('Your support')} />
        <FundedSummary chainId={chainId} amount={position.data!.amount} refundOnFail={position.data!.refundOnFail} claimed={position.data!.refundClaimed} />
        {active && (
          <Button {...tertiaryButton} size="sm" w="full" mt="2" onClick={() => setAddMore(true)}>
            {t('Add more funds')}
          </Button>
        )}
      </Surface>
    )
  }

  return (
    <Surface data-fund-card="">
      <PanelHeader title={t('Fund this plot')} />
      <Text fontSize="small" color="fg.muted" lineHeight="1.6" mb="5">
        {t('Your money is locked in a smart contract, not sent to anyone. Local stewards are paid step by step, only when satellite images show the forest recovering. Whatever is not earned comes back to you.')}
      </Text>

      <Stack gap="0">
        <Step n={1} title={t('Get a wallet')} done={isConnected} last={false}>
          {isConnected ? (
            <Text fontSize="caption" color="fg.muted">
              {connector?.id === 'regrowDemo' ? t('Demo wallet') : t('Wallet')} <Mono>{shortHash(address!, 4)}</Mono>
            </Text>
          ) : (
            <ConnectPrompt />
          )}
        </Step>

        <Step n={2} title={t('Get free test money')} done={isConnected && hasMoney} disabled={!isConnected} last={false}>
          {isConnected && (
            <Stack gap="2">
              <GasStatus />
              <HStack justify="space-between" gap="2">
                <Text fontSize="caption" color="fg.muted">
                  {t('In your wallet')}:{' '}
                  <Text as="span" fontWeight="600" color="fg" fontVariantNumeric="tabular-nums">
                    {formatFlz(balance.data)} FLZ
                  </Text>
                </Text>
                <Button size="xs" {...(hasMoney ? tertiaryButton : secondaryButton)} disabled={!!pending || !fee.ready} onClick={() => send('Get 10,000 FLZ', { ...flz, functionName: 'faucet', args: [] })}>
                  <Droplets size={14} /> {t('Get FLZ')}
                </Button>
              </HStack>
              {!hasMoney && (
                <Text fontSize="label" color="fg.subtle">
                  {t('Filiz (FLZ) is play money for this demo, named after the Turkish word for a young sprout. 1 FLZ stands for one test dollar and has no real value.')}
                </Text>
              )}
            </Stack>
          )}
        </Step>

        <Step n={3} title={t('Choose an amount')} done={false} disabled={!isConnected || !hasMoney} last>
          {isConnected && hasMoney && (
            <Stack gap="4">
              <Box>
                <HStack gap="2">
                  <Input
                    size="sm"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    fontVariantNumeric="tabular-nums"
                    aria-label="Amount"
                  />
                  {PRESETS.map((p) => (
                    <Button key={p} size="sm" {...secondaryButton} {...(amount === p ? { bg: 'brand.subtle', borderColor: 'brand.solid', color: 'brand.fg', fontWeight: 'semibold' } : {})} onClick={() => setAmount(p)} fontVariantNumeric="tabular-nums">
                      {p}
                    </Button>
                  ))}
                </HStack>
                {tooMuch && (
                  <Text fontSize="caption" color="status.failed" mt="1.5">
                    {t('Not enough FLZ in your wallet.')}
                  </Text>
                )}
              </Box>

              {schedule && schedule.length > 0 && <PayoutPlan amount={Number(amount) || 0} schedule={schedule} nextMilestone={nextMilestone ?? 0} />}

              <Box>
                <Eyebrow mb="2">{t("If the forest doesn't recover")}</Eyebrow>
                <Stack gap="2">
                  {([
                    [true, 'Give my money back', 'The unearned part returns to your wallet.'],
                    [false, 'Use it to replant', 'The unearned part funds replanting on other burned plots.'],
                  ] as const).map(([v, title, desc]) => (
                    <Box
                      key={String(v)}
                      as="label"
                      display="flex"
                      gap="3"
                      p="3"
                      borderWidth="1px"
                      borderRadius="md"
                      borderColor={choice === v ? 'brand.solid' : 'hairline'}
                      bg={choice === v ? 'brand.subtle' : 'transparent'}
                      cursor={hasPosition ? 'default' : 'pointer'}
                      opacity={hasPosition && choice !== v ? 0.5 : 1}
                    >
                      <input type="radio" checked={choice === v} disabled={hasPosition} onChange={() => setRefundOnFail(v)} style={{ marginTop: 3, accentColor: 'var(--chakra-colors-brand-solid)' }} />
                      <Box>
                        <Text fontSize="small" fontWeight="600">
                          {t(title)}
                        </Text>
                        <Text fontSize="caption" color="fg.muted">
                          {t(desc)}
                        </Text>
                      </Box>
                    </Box>
                  ))}
                </Stack>
                {hasPosition && (
                  <Text fontSize="label" color="fg.muted" mt="1.5">
                    {t('Fixed by your first deposit.')}
                  </Text>
                )}
              </Box>

              <Button {...primaryButton} size="md" disabled={!active || !!pending || wei === 0n || tooMuch || !fee.ready} onClick={fund}>
                <Logo size={16} color="currentColor" /> {pending ?? (active ? `${t('Fund')} ${amount || 0} FLZ` : t('Funding closed'))}
              </Button>
              <Text fontSize="label" color="fg.subtle" textAlign="center" mt="-2">
                {t('You receive an impact certificate and appear on the public supporter list.')}
              </Text>
              {hasPosition && (
                <Button {...tertiaryButton} size="sm" onClick={() => setAddMore(false)}>
                  {t('Cancel')}
                </Button>
              )}
            </Stack>
          )}
        </Step>
      </Stack>
    </Surface>
  )
}

function Step({ n, title, done, disabled, last, children }: { n: number; title: string; done: boolean; disabled?: boolean; last: boolean; children?: ReactNode }) {
  return (
    // an inactive step uses muted colours, not transparency, so its title stays readable (WCAG AA)
    <HStack align="stretch" gap="3">
      <Stack align="center" gap="0">
        <Circle size="24px" bg={done ? 'brand.solid' : 'transparent'} borderWidth="1.5px" borderColor={done ? 'brand.solid' : 'hairlineStrong'} color={done ? 'white' : 'fg.muted'} fontSize="caption" fontWeight="600">
          {done ? <Check size={14} strokeWidth={3} /> : n}
        </Circle>
        {!last && <Box flex="1" w="1.5px" bg={done ? 'brand.solid' : 'hairline'} my="1" />}
      </Stack>
      <Box flex="1" minW="0" pb={last ? '0' : '5'}>
        <Text fontSize="small" fontWeight="600" lineHeight="24px" mb={children ? '1.5' : '0'} color={disabled ? 'fg.muted' : 'fg'}>
          {title}
        </Text>
        {!disabled && children}
      </Box>
    </HStack>
  )
}

/** Where each part of the amount goes, grouped the way people think about it: now, every quarter, 2023, 2026. */
function PayoutPlan({ amount, schedule, nextMilestone }: { amount: number; schedule: readonly ScheduleStep[]; nextMilestone: number }) {
  const { t } = useT()
  const part = (i: number) => (amount * schedule[i].bps) / 10_000
  const checkIns = schedule.map((_, i) => i).filter((i) => i >= 1 && i <= schedule.length - 3)
  const early = schedule.length - 2
  const sustained = schedule.length - 1
  const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const rows: [string, string, string][] = [
    [fmt(part(0)), t('When stewardship starts'), t('fire watch, no grazing, no clearing')],
    [
      `${checkIns.length} × ${fmt(part(checkIns[0] ?? 0))}`,
      t('Every 3 months in year one'),
      t('only if satellites see no clearing or damage that quarter'),
    ],
    [`${t('up to')} ${fmt(part(early))}`, t('In 2023'), `${t('Full amount at')} ${schedule[early].targetBps / 100}% ${t('recovery vs. unburned forest; less recovery, less paid')}`],
    [`${t('up to')} ${fmt(part(sustained))}`, t('In 2026'), `${t('Full amount at')} ${schedule[sustained].targetBps / 100}% ${t('recovery; the forest must keep growing back')}`],
  ]
  return (
    <Box bg="surfaceSunken" borderRadius="md" px="3.5" py="3">
      <Eyebrow fontSize="label" mb="2.5">
        {t('Where your')} {fmt(amount)} FLZ {t('goes')}
      </Eyebrow>
      <HStack h="6px" gap="0.5" borderRadius="full" overflow="hidden" mb="3">
        {schedule.map((s, i) => (
          <Box key={i} h="full" bg="brand.solid" opacity={i < nextMilestone ? 0.35 : 0.55 + (0.45 * i) / schedule.length} style={{ width: `${s.bps / 100}%` }} />
        ))}
      </HStack>
      <Stack gap="2.5">
        {rows.map(([value, when, condition]) => (
          <Box key={when} fontSize="caption">
            <HStack justify="space-between" gap="3">
              <Text fontWeight="500">{when}</Text>
              <Text fontWeight="600" fontVariantNumeric="tabular-nums" whiteSpace="nowrap">
                {value} FLZ
              </Text>
            </HStack>
            <Text color="fg.muted" fontSize="caption" lineHeight="1.45">
              {condition}
            </Text>
          </Box>
        ))}
        <HStack align="start" gap="2" pt="2.5" borderTopWidth="1px" borderColor="hairline">
          <Box color="brand.fg" pt="0.5" flexShrink={0}>
            <Undo2 size={14} />
          </Box>
          <Text color="fg.muted" fontSize="caption" lineHeight="1.45">
            {t('Anything not earned is returned at that moment, not at the end.')}
            {nextMilestone > 0 && ` ${t('Steps already settled on this plot are caught up at the next one.')}`}
          </Text>
        </HStack>
      </Stack>
    </Box>
  )
}

/** After funding: what you put in, what happened to it so far, and the way to your certificate. */
function FundedSummary({ chainId, amount, refundOnFail, claimed }: { chainId: number; amount: bigint; refundOnFail: boolean; claimed: bigint }) {
  const { t } = useT()
  const { address } = useAccount()
  const tokenId = useReadContract({ ...certificate, functionName: 'tokenOf', args: [BigInt(chainId), address!], query: { enabled: !!address, refetchInterval: 10_000 } })
  const id = Number(tokenId.data ?? 0n)
  return (
    <Stack gap="4">
      <HStack gap="3" bg="brand.subtle" borderRadius="md" px="3.5" py="3">
        <Circle size="32px" bg="brand.solid" color="white">
          <Check size={17} strokeWidth={3} />
        </Circle>
        <Box>
          <Text fontWeight="600" fontSize="small">
            {t('You back this plot with')} {formatFlz(amount)} FLZ
          </Text>
          <Text fontSize="caption" color="fg.muted">
            {refundOnFail ? t('Unearned money comes back to you.') : t('Unearned money goes to replanting.')}
          </Text>
        </Box>
      </HStack>
      {refundOnFail && <RefundBox chainId={chainId} claimed={claimed} />}
      {id > 0 && (
        <Button asChild {...primaryButton} size="md">
          <Link to={`/certificate/${certificateRef(id)}`}>
            <Award size={16} /> {t('View your certificate')} <ArrowRight size={15} />
          </Link>
        </Button>
      )}
    </Stack>
  )
}

/** Refunds accrue whenever a tranche is not earned (missed check-in, partial score, failure) and can be claimed any time. */
function RefundBox({ chainId, claimed }: { chainId: number; claimed: bigint }) {
  const { t } = useT()
  const { address } = useAccount()
  const { send, pending } = useTx()
  const claimable = useReadContract({ ...escrow, functionName: 'claimable', args: [BigInt(chainId), address!], query: { enabled: !!address, refetchInterval: 10_000 } })
  const owed = claimable.data ?? 0n
  if (owed === 0n && claimed === 0n) return null
  return (
    <HStack justify="space-between" gap="3" borderWidth="1px" borderColor={owed > 0n ? 'brand.solid' : 'hairline'} bg={owed > 0n ? 'brand.subtle' : 'transparent'} borderRadius="md" px="3" py="2.5">
      <Box>
        <Eyebrow fontSize="label">{owed > 0n ? t('Refund available') : t('Refunded to you')}</Eyebrow>
        <Text fontWeight="600" fontVariantNumeric="tabular-nums">
          {formatFlz(owed > 0n ? owed : claimed)} FLZ
        </Text>
        {owed > 0n && claimed > 0n && (
          <Text fontSize="label" color="fg.muted">
            {formatFlz(claimed)} FLZ {t('already claimed')}
          </Text>
        )}
      </Box>
      {owed > 0n && (
        <Button size="sm" {...primaryButton} disabled={!!pending} onClick={() => send('Claim refund', { ...escrow, functionName: 'claimRefund', args: [BigInt(chainId)] })}>
          <Undo2 size={14} /> {t('Claim')}
        </Button>
      )}
    </HStack>
  )
}

/** No wallet yet: one click to a throwaway demo wallet, or connect your own. */
function ConnectPrompt() {
  const { t } = useT()
  const { connectors, connect, isPending } = useConnect()
  const demo = connectors.find((c) => c.id === 'regrowDemo')
  return (
    <Stack gap="2">
      <Button {...primaryButton} size="sm" disabled={!demo || isPending} onClick={() => demo && connect({ connector: demo })}>
        <Wallet size={15} /> {isPending ? t('Creating demo wallet…') : t('Use demo wallet')}
      </Button>
      <Text fontSize="label" color="fg.muted" lineHeight="1.55">
        {t('No crypto wallet needed. A test wallet is created in this browser and receives free test ETH for network fees.')}
      </Text>
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <Button {...tertiaryButton} size="xs" alignSelf="start" px="1" onClick={openConnectModal}>
            {t('Connect your own wallet')}
          </Button>
        )}
      </ConnectButton.Custom>
    </Stack>
  )
}

/** Whether the wallet holds enough test ETH for approve + fund (about 400k gas) at today's fee level.
 *  Checked often while it does not, so a fresh demo wallet can continue as soon as its fee ETH lands. */
function useFeeGas() {
  const { address } = useAccount()
  const gasPrice = useGasPrice()
  const need = (gasPrice.data ?? 0n) * 600_000n
  const gas = useBalance({ address, query: { enabled: !!address, refetchInterval: (q) => ((q.state.data?.value ?? 0n) >= need && need > 0n ? 15_000 : 2_000) } })
  const ready = !!gas.data && !!gasPrice.data && gas.data.value >= need
  return { gas, ready, known: !!gas.data && !!gasPrice.data }
}

/** Fees on the test network are paid in free test ETH; the demo wallet gets it from our API. */
function GasStatus() {
  const { t } = useT()
  const { address, connector } = useAccount()
  const { gas, ready, known } = useFeeGas()
  const [asking, setAsking] = useState(false)
  if (!known || ready) return null
  const isDemo = connector?.id === 'regrowDemo'
  return (
    <HStack justify="space-between" gap="2" borderWidth="1px" borderColor="orange.muted" bg="orange.subtle" borderRadius="md" px="3" py="2">
      <HStack gap="2" fontSize="caption">
        <Fuel size={15} />
        <Text>{isDemo ? t('Getting free test ETH for fees…') : t('Not enough test ETH for fees')}</Text>
      </HStack>
      <Button
        size="xs"
        {...secondaryButton}
        disabled={asking}
        onClick={async () => {
          setAsking(true)
          try {
            await requestDemoGas(address!)
            await gas.refetch()
          } catch (e) {
            toaster.create({ type: 'error', title: t('Could not get test ETH'), description: e instanceof Error ? e.message : String(e) })
          } finally {
            setAsking(false)
          }
        }}
      >
        {asking ? t('Requesting…') : t('Get fee ETH')}
      </Button>
    </HStack>
  )
}
