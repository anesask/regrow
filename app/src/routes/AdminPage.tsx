import { Box, Button, HStack, Input, Link as CLink, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Lock, ShieldAlert, Timer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { StatusChip } from '@/components/plot/badges'
import { toaster } from '@/components/Toaster'
import { Eyebrow, Mono, Page, PageHeader, primaryButton, secondaryButton, Surface } from '@/components/ui'
import { type PlotFeature, post, type PlotResult, usePlots, useResults } from '@/lib/api'
import { usePlotOnChain } from '@/lib/contracts'
import { shortHash } from '@/lib/format'
import { explorerUrl, txUrl } from '@/lib/wagmi'

const KEY = 'regrow-admin-passcode'

function readPasscode() {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

interface ReportResult {
  passed?: boolean
  reportTx?: string
  executeTx?: string | null
  executesInSeconds?: number
  tx?: string
}

export default function AdminPage() {
  const plots = usePlots()
  const results = useResults()
  const [passcode, setPasscode] = useState(readPasscode)
  const [draft, setDraft] = useState('')

  if (!passcode) {
    return (
      <Page maxW="440px" py="20">
        <Surface p="6">
          <HStack gap="2.5" mb="2">
            <Lock size={16} />
            <Text fontFamily="heading" fontSize="lead" fontWeight="600">
              Oracle console
            </Text>
          </HStack>
          <Text fontSize="small" color="fg.muted" mb="5">
            Operator access. Runs satellite verification and posts signed results on-chain.
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              try {
                sessionStorage.setItem(KEY, draft)
              } catch {
                // storage unavailable: keep in memory only
              }
              setPasscode(draft)
            }}
          >
            <HStack gap="2">
              <Input size="sm" type="password" placeholder="Admin passcode" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button {...primaryButton} size="sm" type="submit">
                Enter
              </Button>
            </HStack>
          </form>
        </Surface>
      </Page>
    )
  }

  const plotFeatures = plots.data?.features.filter((f) => f.properties.kind === 'plot') ?? []
  return (
    <Page>
      <PageHeader eyebrow="Participants · operator" title="Oracle console">
        Each action reads the precomputed Sentinel-2 verdict for a plot and milestone, signs it with the oracle key and
        submits it on-chain with its evidence hash. With a zero challenge window the escrow executes it immediately.
      </PageHeader>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
        {plotFeatures.map((f) => (
          <AdminPlotCard key={f.properties.id} feature={f} result={results.data?.[f.properties.id]} passcode={passcode} onUnauthorized={() => setPasscode('')} />
        ))}
      </SimpleGrid>
    </Page>
  )
}

function AdminPlotCard({ feature, result, passcode, onUnauthorized }: { feature: PlotFeature; result?: PlotResult; passcode: string; onUnauthorized: () => void }) {
  const p = feature.properties
  const onchain = usePlotOnChain(p.chainId)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<{ label: string; tx: string }[]>([])
  const next = onchain.plot.data?.nextMilestone
  const status = onchain.status

  async function run(label: string, path: string, body: object) {
    setBusy(label)
    const id = toaster.create({ type: 'loading', title: `${p.name}: ${label}`, description: 'Signing and submitting…' })
    try {
      const res = await post<ReportResult>(path, body, { 'X-Admin-Passcode': passcode })
      const txs = [res.reportTx, res.executeTx, res.tx].filter(Boolean) as string[]
      setLog((l) => [...txs.map((tx) => ({ label, tx })), ...l])
      toaster.update(id, {
        type: res.passed === false ? 'warning' : 'success',
        title: `${p.name}: ${label}`,
        description:
          res.passed === false
            ? 'Failed verification, recorded on-chain'
            : res.executesInSeconds
              ? `Reported on-chain. Settles by itself in about ${Math.ceil(res.executesInSeconds / 60)} min, after the challenge window.`
              : 'Recorded on-chain',
        duration: res.executesInSeconds ? 9000 : 5000,
      })
      await queryClient.invalidateQueries()
      if (res.executesInSeconds) setTimeout(() => queryClient.invalidateQueries(), (res.executesInSeconds + 15) * 1000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('passcode')) onUnauthorized()
      toaster.update(id, { type: 'error', title: `${label} rejected`, description: msg, duration: 8000 })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Surface data-plot={p.id}>
      <HStack justify="space-between" align="start" mb="4" gap="3">
        <Box minW="0">
          <CLink asChild fontFamily="heading" fontSize="lead" fontWeight="600">
            <Link to={`/plot/${p.id}`}>{p.name}</Link>
          </CLink>
          <Mono display="block" color="fg.muted" mt="0.5">
            plot #{p.chainId} · next milestone {next ?? '-'}
          </Mono>
        </Box>
        {status && <StatusChip status={status} />}
      </HStack>
      <Eyebrow mb="2">Satellite verdicts</Eyebrow>
      <HStack gap="2" flexWrap="wrap">
        {result?.milestones.map((m) => {
          const isNext = m.idx === next
          return (
            <Button
              key={m.idx}
              size="xs"
              {...(isNext ? primaryButton : secondaryButton)}
              disabled={!!busy || status !== 'Active' || !isNext}
              onClick={() => run(`Verify ${m.label}`, '/oracle/report', { plotId: p.id, milestone: m.idx })}
              title={`${m.label} (${m.period}): ${m.outcome}`}
            >
              {m.kind === 'checkin' ? `C${m.idx}` : m.kind === 'baseline' ? 'M0' : m.idx === 5 ? 'M1' : 'M2'}
              <Mono opacity={0.75} fontSize="label">
                {m.kind === 'recovery' ? `${(m.scoreBps / 100).toFixed(0)}%` : m.outcome === 'paid' ? 'ok' : m.outcome}
              </Mono>
            </Button>
          )
        })}
        {result?.disturbance?.flagged && status === 'Active' && (
          <Button size="xs" variant="outline" color="status.paused" borderColor="orange.muted" disabled={!!busy} onClick={() => run('Flag disturbance', '/oracle/disturbance', { plotId: p.id })}>
            <ShieldAlert size={13} /> Flag disturbance · {result.disturbance.year}
          </Button>
        )}
        {status === 'Paused' && (
          <Button size="xs" variant="outline" color="status.failed" disabled={!!busy} onClick={() => run('Expire pause', '/oracle/expire-pause', { plotId: p.id })}>
            <Timer size={13} /> Expire pause → refunds
          </Button>
        )}
      </HStack>
      {log.length > 0 && (
        <Stack gap="1" mt="4" pt="3" borderTopWidth="1px" borderColor="hairline">
          {log.map((l) =>
            explorerUrl ? (
              <CLink key={l.tx} href={txUrl(l.tx)} target="_blank" fontSize="caption" color="fg.muted" display="inline-flex" alignItems="center" gap="1.5">
                {l.label} <Mono>{shortHash(l.tx, 6)}</Mono> <ExternalLink size={11} />
              </CLink>
            ) : (
              <Text key={l.tx} fontSize="caption" color="fg.muted">
                {l.label} <Mono>{shortHash(l.tx, 6)}</Mono>
              </Text>
            ),
          )}
        </Stack>
      )}
    </Surface>
  )
}
