import { Box, Button, chakra, HStack, Input, Stack, Text } from '@chakra-ui/react'
import { Check, ChevronDown } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Chip, Mono, secondaryButton, Surface } from '@/components/ui'
import { askPlot, type PlotFacts, useAiReports, useAiStatus, usePlotFacts } from '@/lib/api'
import { fill, useT } from '@/lib/i18n'

const SUGGESTIONS = ['How is this plot doing?', 'Was any money refunded, and why?', 'What did the quarterly check-ins find?']

/** Figures worth checking: percentages in any language order (67%, 67 %, %67) and decimals (5.7, 5,7). Years and counts stay plain. */
const FIGURE = /(%\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%|\d+[.,]\d+)/
const valueOf = (s: string) => Number(s.replace(/[%\s]/g, '').replace(',', '.'))

type Source = { label: string; value: string }

/** Every place in the facts sheet that holds this value, as readable labels. */
function sources(n: number, f: PlotFacts, t: (s: string) => string): Source[] {
  const out: Source[] = []
  const same = (v: unknown) => typeof v === 'number' && Math.abs(v - n) < 1e-9
  for (const [year, v] of Object.entries(f.recovery_by_summer_pct)) {
    if (same(v)) out.push({ label: fill(t('Recovery vs. controls, summer {year}'), { year }), value: `${v}%` })
  }
  const FIELDS: [string, string, string][] = [
    ['measured_recovery_pct', '{milestone}: measured recovery', '%'],
    ['target_recovery_pct', '{milestone}: target', '%'],
    ['tranche_pct_of_funds', '{milestone}: share of the funds', '%'],
    ['share_of_tranche_paid_pct', '{milestone}: share of its tranche paid', '%'],
    ['uncertainty_plus_minus_pct', '{milestone}: measurement uncertainty', ' points'],
  ]
  for (const m of f.milestones) {
    for (const [key, label, unit] of FIELDS) {
      if (same(m[key])) out.push({ label: fill(t(label), { milestone: t(m.milestone) }), value: `${key.startsWith('uncertainty') ? '±' : ''}${m[key]}${unit === '%' ? '%' : ''}` })
    }
  }
  if (!out.length && f.payout_schedule.match(/\d+/g)?.some((x) => Number(x) === n)) out.push({ label: t('Payout schedule'), value: `${n}%` })
  return out
}

type Picked = { key: string; src: Source[] } | null

/** Text with every checkable figure marked; pressing or hovering one shows where it comes from. */
function Checked({ text, facts, scope, active, onPick }: { text: string; facts?: PlotFacts; scope: string; active: Picked; onPick: (p: Picked) => void }) {
  const { t } = useT()
  const parts = text.split(FIGURE)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0 || !facts) return <Fragment key={i}>{p}</Fragment>
        const src = sources(valueOf(p), facts, t)
        if (!src.length) return <Fragment key={i}>{p}</Fragment>
        const key = `${scope}:${i}`
        const on = active?.key === key
        const label = src.map((s) => `${s.label} ${s.value}`).join(' · ')
        return (
          <chakra.button
            key={i}
            type="button"
            onClick={() => onPick(on ? null : { key, src })}
            onMouseEnter={() => onPick({ key, src })}
            onFocus={() => onPick({ key, src })}
            title={label}
            aria-label={`${p}: ${label}`}
            aria-pressed={on}
            font="inherit"
            fontWeight="600"
            color="brand.fg"
            px="0.5"
            mx="-0.5"
            borderRadius="xs"
            cursor="help"
            textDecoration="underline"
            textDecorationStyle="dotted"
            textUnderlineOffset="3px"
            bg={on ? 'brand.muted' : 'transparent'}
            transition="background 120ms"
            _hover={{ bg: 'brand.muted' }}
          >
            {p}
          </chakra.button>
        )
      })}
    </>
  )
}

/** The evidence line under a text: what the selected figure was checked against. */
function Evidence({ active, idle }: { active: Picked; idle: string }) {
  const { t } = useT()
  const src = active?.key.startsWith('report:') ? active.src : []
  return (
    <HStack align="start" gap="2" mt="3" minH="22px" fontSize="label" color="fg.muted" aria-live="polite">
      <Box as="span" mt="0.5" color={src.length ? 'brand.fg' : 'fg.subtle'} flexShrink={0}>
        <Check size={14} strokeWidth={2.5} />
      </Box>
      {src.length ? (
        <Text>
          {t('Matches the evidence:')}{' '}
          {src.slice(0, 3).map((s, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              {s.label} <Mono color="fg">{s.value}</Mono>
            </Fragment>
          ))}
          {src.length > 3 && ` · ${fill(t('{n} more'), { n: src.length - 3 })}`}
        </Text>
      ) : (
        <Text color="fg.subtle">{idle}</Text>
      )}
    </HStack>
  )
}

function Typing() {
  return (
    <HStack gap="1" h="22px" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Box key={i} w="6px" h="6px" borderRadius="full" bg="fg.subtle" animation="pulse 1s ease-in-out infinite" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </HStack>
  )
}

type Turn = { q: string; text: string | null; ok: boolean }

/** Plain-language progress report written by AI from this plot's evidence, plus live questions about it.
 *  Advisory text: every number was checked against the evidence facts before it is shown (backend/src/regrow_api/reports.py). */
export function AiReport({ plotId }: { plotId: string }) {
  const { t, lang } = useT()
  const reports = useAiReports()
  const status = useAiStatus()
  const facts = usePlotFacts(plotId).data
  const report = reports.data?.plots[plotId]
  const text = report?.verified ? (report[lang as 'en' | 'de' | 'tr'] ?? report.en) : null
  const model = reports.data?.method?.model
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [active, setActive] = useState<Picked>(null)
  const [showFacts, setShowFacts] = useState(false)

  if (!text && !status.data?.available) return null
  const figures = text && facts ? text.split(FIGURE).filter((p, i) => i % 2 === 1 && sources(valueOf(p), facts, t).length).length : 0

  async function ask(question: string) {
    const clean = question.trim()
    if (clean.length < 3 || busy) return
    setBusy(true)
    setQ('')
    setTurns((ts) => [...ts.slice(-3), { q: clean, text: null, ok: false }])
    let turn: Turn
    try {
      const r = await askPlot(plotId, clean, lang)
      turn = { q: clean, ok: r.verified, text: r.answer ?? t('The AI could not answer this reliably from the evidence, so nothing is shown.') }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      turn = {
        q: clean,
        ok: false,
        text: msg.includes('budget') ? t('The AI budget for today is used up. The report above stays available.') : msg.startsWith('429') || msg.includes('Too many') ? t('Too many questions for now. Please try again later.') : t('The AI is not available right now.'),
      }
    }
    setTurns((ts) => [...ts.slice(0, -1), turn])
    setBusy(false)
  }

  const header = (
    <HStack justify="space-between" align="start" gap="3" mb="4" flexWrap="wrap">
      <HStack gap="3" align="center">
        <Box w="34px" h="34px" borderRadius="md" bg="brand.muted" color="brand.fg" display="grid" placeItems="center" fontFamily="mono" fontWeight="600" fontSize="small" flexShrink={0}>
          AI
        </Box>
        <Stack gap="0">
          <Text fontFamily="heading" fontWeight="600" fontSize="body">
            {t('Progress report')}
          </Text>
          <Text fontSize="label" color="fg.muted">
            {model ? fill(t('Written by {model} from the satellite record 2021-2026'), { model }) : t('Written by AI from the satellite record 2021-2026')}
          </Text>
        </Stack>
      </HStack>
      {text && (
        <Chip tone="brand">
          <Check size={12} strokeWidth={3} /> {figures ? fill(t('{n} figures checked'), { n: figures }) : t('numbers checked')}
        </Chip>
      )}
    </HStack>
  )

  return (
    <Surface data-ai-report>
      {header}
      {text && (
        <>
          <Text fontSize="body" lineHeight="1.75" maxW="72ch" onMouseLeave={() => setActive(null)}>
            <Checked text={text} facts={facts} scope="report" active={active} onPick={setActive} />
          </Text>
          {facts && <Evidence active={active} idle={t('Every highlighted figure was checked against the plot’s evidence. Select one to see its source.')} />}
          <Text fontSize="label" color="fg.subtle" mt="2" lineHeight="1.55">
            {t('The report covers the whole satellite record. On this demo network the payouts are replayed milestone by milestone, so the escrow shows where this plot stands now.')}
          </Text>
        </>
      )}

      {status.data?.available && (
        <Box mt={text ? '5' : '0'} pt={text ? '5' : '0'} borderTopWidth={text ? '1px' : '0'} borderColor="hairline">
          <Text fontSize="small" fontWeight="600">
            {t('Ask about this plot')}
          </Text>
          <Text fontSize="label" color="fg.muted" mb="3">
            {t('Answers use only this plot’s evidence. An answer with a figure that does not match is not shown.')}
          </Text>

          {turns.length > 0 && (
            <Stack gap="3" mb="4" aria-live="polite">
              {turns.map((turn, i) => (
                <Stack key={i} gap="2">
                  <Box alignSelf="end" maxW="85%" px="3.5" py="2" borderRadius="lg" borderBottomRightRadius="sm" bg="brand.muted" fontSize="small">
                    {turn.q}
                  </Box>
                  <Box alignSelf="start" maxW="92%" px="3.5" py="2.5" borderRadius="lg" borderBottomLeftRadius="sm" bg="surfaceSunken" fontSize="small" lineHeight="1.65">
                    {turn.text == null ? (
                      <Typing />
                    ) : (
                      <>
                        <Text color={turn.ok ? 'fg' : 'fg.muted'}>{turn.ok ? <Checked text={turn.text} facts={facts} scope={`answer${i}`} active={active} onPick={setActive} /> : turn.text}</Text>
                        {turn.ok && (
                          <HStack gap="1.5" mt="1.5" fontSize="label" color="brand.fg">
                            <Check size={12} strokeWidth={3} /> {t('figures match the evidence')}
                          </HStack>
                        )}
                      </>
                    )}
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}

          <HStack
            as="form"
            gap="2"
            onSubmit={(e) => {
              e.preventDefault()
              ask(q)
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder={t('For example: why was money refunded?')} aria-label={t('Ask about this plot')} size="md" />
            <Button {...secondaryButton} size="md" type="submit" disabled={busy || q.trim().length < 3}>
              {busy ? t('Asking…') : t('Ask')}
            </Button>
          </HStack>
          <HStack gap="2" mt="2.5" flexWrap="wrap">
            {SUGGESTIONS.map((s) => (
              <Button key={s} size="xs" variant="outline" borderRadius="full" fontWeight="500" color="fg.muted" borderColor="hairlineStrong" disabled={busy} onClick={() => ask(t(s))}>
                {t(s)}
              </Button>
            ))}
          </HStack>
        </Box>
      )}

      {facts && (
        <Box mt="5" pt="4" borderTopWidth="1px" borderColor="hairline">
          <Button variant="plain" size="sm" px="0" h="auto" fontWeight="500" color="fg.muted" _hover={{ color: 'fg' }} onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
            {t('What the AI was given')}
            <Box as="span" transform={showFacts ? 'rotate(180deg)' : undefined} transition="transform 150ms">
              <ChevronDown size={15} />
            </Box>
          </Button>
          {showFacts && (
            <Box as="pre" mt="3" p="3.5" borderRadius="md" bg="surfaceSunken" fontFamily="mono" fontSize="label" lineHeight="1.6" maxH="320px" overflow="auto" whiteSpace="pre-wrap">
              {JSON.stringify(facts, null, 1)}
            </Box>
          )}
          <Text fontSize="label" color="fg.subtle" mt="3" lineHeight="1.55">
            {t('The AI sees only this facts sheet, built from the satellite record 2021-2026. It explains results; it never decides a payout.')}
          </Text>
        </Box>
      )}
    </Surface>
  )
}
