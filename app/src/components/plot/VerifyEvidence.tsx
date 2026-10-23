import { useT } from '@/lib/i18n'
import { Box, Button, CloseButton, Dialog, HStack, Link, Portal, Spinner, Stack, Text } from '@chakra-ui/react'
import { CheckCircle2, CircleDashed, ExternalLink, ShieldCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import { usePublicClient } from 'wagmi'
import { backdrop, Mono, tertiaryButton } from '@/components/ui'
import { deployed, escrow } from '@/lib/contracts'
import { shortHash } from '@/lib/format'
import { fetchDataset, foldProof, hashEvidenceFile, leafHash } from '@/lib/verify'

type State = 'idle' | 'running' | 'ok' | 'fail' | 'skip'
interface Step {
  title: string
  state: State
  detail?: string
}

const STEPS = [
  'Hash the evidence file in your browser',
  'Rebuild the Merkle leaf and fold the proof',
  'Find the committed dataset on-chain',
  'Match the on-chain report',
]

/** Independent, client-side check of one milestone's evidence: file → hash → Merkle proof → on-chain commitment. */
export function VerifyEvidence({ plotKey, idx, evidenceHash }: { plotKey: string; idx: number; evidenceHash: `0x${string}` }) {
  const { t } = useT()
  const client = usePublicClient()
  const [steps, setSteps] = useState<Step[]>(STEPS.map((title) => ({ title, state: 'idle' })))
  const [cid, setCid] = useState<string | null>(null)
  const set = (i: number, s: Partial<Step>) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, ...s } : x)))

  async function run() {
    setSteps(STEPS.map((title) => ({ title, state: 'idle' })))
    try {
      set(0, { state: 'running' })
      const ds = await fetchDataset()
      const entry = ds.leaves.find((l) => l.plot === plotKey && l.kind === 0 && l.idx === idx)
      if (!entry) throw new Error('not in the published dataset')
      const file = await hashEvidenceFile(entry.file)
      const fileOk = file.hash === evidenceHash
      set(0, { state: fileOk ? 'ok' : 'fail', detail: `${entry.file} · ${file.bytes.toLocaleString()} bytes → ${shortHash(file.hash, 6)}` })
      if (!fileOk) return

      set(1, { state: 'running' })
      const leaf = leafHash(0, entry.plotId, idx, entry.scoreBps, evidenceHash)
      const root = foldProof(leaf, entry.proof)
      const proofOk = leaf === entry.leaf && root === ds.root
      set(1, { state: proofOk ? 'ok' : 'fail', detail: `score ${entry.scoreBps / 100}% · ${entry.proof.length} proof steps → root ${shortHash(root, 6)}` })
      if (!proofOk) return

      if (!deployed || !client) {
        set(2, { state: 'skip', detail: t('contracts not deployed') })
        set(3, { state: 'skip' })
        return
      }
      set(2, { state: 'running' })
      const d = await client.readContract({ ...escrow, functionName: 'getDataset', args: [ds.root] })
      if (!d.committedAt) {
        set(2, { state: 'skip', detail: t('not committed yet: the oracle committee commits it with the first report') })
        set(3, { state: 'skip' })
        return
      }
      setCid(d.cid)
      set(2, {
        state: 'ok',
        detail: `commitment #${d.index} on ${new Date(Number(d.committedAt) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      })

      set(3, { state: 'running' })
      const reports = await client.readContract({ ...escrow, functionName: 'getReports', args: [BigInt(entry.plotId)] })
      const r = reports[idx]
      if (!r?.exists) set(3, { state: 'skip', detail: t('not reported on-chain yet') })
      else {
        const ok = r.evidenceHash === evidenceHash && r.datasetRoot === ds.root && r.scoreBps === entry.scoreBps
        set(3, { state: ok ? 'ok' : 'fail', detail: ok ? t('report carries this exact hash, score and root') : t('on-chain report differs') })
      }
    } catch (e) {
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.state === 'running')
        return prev.map((s, j) => (j === i ? { ...s, state: 'fail', detail: e instanceof Error ? e.message : String(e) } : s))
      })
    }
  }

  return (
    <Dialog.Root size="md" placement="center" scrollBehavior="inside" onOpenChange={(d) => d.open && run()}>
      <Dialog.Trigger asChild>
        <Button size="2xs" {...tertiaryButton} px="1.5" h="22px" fontSize="label">
          <ShieldCheck size={12} /> {t('Verify')}
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop {...backdrop} />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="card" mx="4">
            <Dialog.Header>
              <Dialog.Title fontFamily="heading" fontSize="lead">
                {t('Verify this evidence yourself')}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="small" color="fg.muted" mb="4" lineHeight="1.6">
                {t('Everything below runs in your browser: no step trusts ReGrow’s server to tell the truth.')}
              </Text>
              <Stack gap="3">
                {steps.map((s, i) => (
                  <HStack key={s.title} align="start" gap="3">
                    <Box pt="0.5" color={s.state === 'ok' ? 'brand.solid' : s.state === 'fail' ? 'status.failed' : 'fg.subtle'}>
                      {s.state === 'running' ? <Spinner size="xs" /> : s.state === 'ok' ? <CheckCircle2 size={17} /> : s.state === 'fail' ? <XCircle size={17} /> : <CircleDashed size={17} />}
                    </Box>
                    <Box minW="0">
                      <Text fontSize="small" fontWeight="600">
                        {i + 1}. {s.title}
                      </Text>
                      {s.detail && (
                        <Mono display="block" color="fg.muted" fontSize="label" mt="0.5" wordBreak="break-all">
                          {s.detail}
                        </Mono>
                      )}
                    </Box>
                  </HStack>
                ))}
              </Stack>
              {cid && (
                <Text fontSize="caption" color="fg.muted" mt="4">
                  {t('Evidence bundle on IPFS')}:{' '}
                  <Link href={`https://ipfs.io/ipfs/${cid}`} target="_blank" rel="noreferrer" color="brand.fg">
                    <Mono>{shortHash(cid, 8)}</Mono> <ExternalLink size={11} style={{ display: 'inline' }} />
                  </Link>
                </Text>
              )}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
