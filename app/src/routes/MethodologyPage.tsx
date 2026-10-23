import { Box, Code, Grid, Link as CLink, List, Stack, Table, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Eyebrow, Page, PageHeader, Surface } from '@/components/ui'
import { useT } from '@/lib/i18n'

const SECTIONS = [
  ['data', 'Data'],
  ['composites', 'Composites'],
  ['indices', 'Indices'],
  ['perimeter', 'Fire perimeter'],
  ['recovery', 'Recovery score'],
  ['milestones', 'Milestones'],
  ['disturbance', 'Disturbance'],
  ['uncertainty', 'Uncertainty & validation'],
  ['robustness', 'Robustness & placebo'],
  ['evidence', 'Evidence & commitments'],
  ['limits', 'Limitations'],
  ['sources', 'Sources'],
] as const

export default function MethodologyPage() {
  const { t } = useT()
  return (
    <Page>
      <PageHeader eyebrow={t('Methodology')} title={t('How recovery is measured and verified')}>
        {t('Every number on this site comes from public Sentinel-2 imagery processed by an open pipeline. This page explains each step, the thresholds that trigger payouts, and what the method cannot tell you.')}
      </PageHeader>

      <Grid templateColumns={{ base: '1fr', lg: '200px 1fr' }} gap="10" alignItems="start">
        <Box as="nav" position={{ lg: 'sticky' }} top="84px" display={{ base: 'none', lg: 'block' }}>
          <Eyebrow mb="3">{t('On this page')}</Eyebrow>
          <Stack gap="1.5">
            {SECTIONS.map(([id, label]) => (
              <CLink key={id} href={`#${id}`} fontSize="small" color="fg.muted" _hover={{ color: 'fg' }}>
                {t(label)}
              </CLink>
            ))}
          </Stack>
        </Box>

        <Stack gap="12" maxW="760px" css={{ '& p': { fontSize: 'body', lineHeight: 1.75, color: 'fg' } }}>
          <Section id="data" title={t('Data')}>
            <p>
              {t('Sentinel-2 Level-2A surface reflectance from Microsoft Planetary Computer, read at 20 m resolution in UTM zone 36N. The study area covers the Manavgat fire that started on 28 July 2021 in Antalya province. Scenes with more than 20% cloud are skipped; remaining cloud, cloud shadow, cirrus and snow are masked per pixel with the scene classification layer.')}
            </p>
          </Section>

          <Section id="composites" title={t('Composites')}>
            <p>
              {t('For each period we take the per-pixel median of all clear observations. Comparing the same season every year avoids mistaking seasonal greening for recovery.')}
            </p>
            <Spec
              rows={[
                [t('Pre-fire'), t('15 Jun - 27 Jul 2021')],
                [t('Post-fire'), t('15 Aug - 30 Sep 2021')],
                [t('Recovery'), t('Jun - Sep of 2022, 2023, 2024, 2025, 2026')],
              ]}
            />
            <p>{t('Images from 25 Jan 2022 onwards carry a +1000 reflectance offset (processing baseline 04.00), which is removed so all years are comparable.')}</p>
          </Section>

          <Section id="indices" title={t('Indices')}>
            <Formula>
              {`NDVI = (B08 − B04) / (B08 + B04)
NBR  = (B08 − B12) / (B08 + B12)
dNBR = NBR_pre − NBR_post`}
            </Formula>
            <p>
              {t('The normalised burn ratio (NBR) contrasts near-infrared with short-wave infrared, which is sensitive to charred and bare ground. Burn severity classes follow Key & Benson: unburned < 0.10, low 0.10-0.27, moderate-low 0.27-0.44, moderate-high 0.44-0.66, high > 0.66.')}
            </p>
          </Section>

          <Section id="perimeter" title={t('Fire perimeter')}>
            <p>
              {t('Water and non-vegetated ground are masked with pre-fire NDVI. Pixels with dNBR above 0.27 are joined with a 200 m morphological closing and holes are filled; the largest region is the fire. The result is')}{' '}
              <b>{t('59,234 ha')}</b>, {t('within 4.5% of the 56,663 ha reported by Gebze Technical University.')}
            </p>
          </Section>

          <Section id="recovery" title={t('Recovery score')}>
            <p>
              {t('The burn scar is divided into 64 ha cells (800 × 800 m). For each cell, recovery is the share of the fire’s NBR loss that has come back:')}
            </p>
            <Formula>{`RR_t  = (NBR_t − NBR_post) / (NBR_pre − NBR_post)
adj_t = RR_t − (NBR_twins,t − NBR_twins,pre) / (NBR_pre − NBR_post)`}</Formula>
            <p>
              {t('The second line removes the change measured in the plot’s own')} <b>{t('matched controls')}</b>:{' '}
              {t('the 10 unburned forest cells, 2-20 km outside the scar, most similar to it before the fire in vegetation (NBR, NDVI), elevation, slope and the direction the slope faces (Copernicus 30 m elevation model, Mahalanobis distance). If a wet summer greens all forest, the twins green too and the plot gets no credit for it. Twins are chosen only on what was known before the fire, never on how they changed afterwards. Payouts use')}{' '}
              <b>adj</b>.
            </p>
          </Section>

          <Section id="milestones" title={t('Milestones')}>
            <Box borderWidth="1px" borderColor="hairline" borderRadius="md" overflow="hidden">
              <Table.Root size="sm" css={{ '& td, & th': { borderColor: 'hairline' } }}>
                <Table.Header>
                  <Table.Row bg="surfaceSunken">
                    {['Milestone', 'Evidence', 'Pass rule', 'Tranche'].map((h) => (
                      <Table.ColumnHeader key={h} px="4" py="2.5">
                        <Text fontFamily="mono" fontSize="label" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted" fontWeight="500">
                          {t(h)}
                        </Text>
                      </Table.ColumnHeader>
                    ))}
                  </Table.Row>
                </Table.Header>
                <Table.Body fontSize="small">
                  <Row cells={[t('Stewardship start'), t('Baseline severity (2021)'), t('Stewardship agreed'), t('15%')]} />
                  <Row cells={[t('4 quarterly check-ins'), t('Quarterly composite, Q4 2021 - Q3 2022'), t('No net NBR drop > 0.10 vs. controls'), t('4 × 5%')]} />
                  <Row cells={[t('Early recovery'), t('Summer 2023 composite'), t('Graded: adj ÷ 0.30, fails below 0.15'), t('30%')]} />
                  <Row cells={[t('Sustained recovery'), t('Summer 2026 composite'), t('Graded: adj ÷ 0.60, fails below 0.30'), t('35%')]} />
                </Table.Body>
              </Table.Root>
            </Box>
            <p>
              {t('Payouts are graded: the steward earns score ÷ target of each recovery tranche (capped at 100%) and the shortfall is refunded immediately. A missed check-in refunds only its 5%. Below half the target the plot fails and all unreleased funds are refunded. Funders who chose refunds can claim at any time; the rest goes to a replanting pool. Thresholds were set from the literature before looking at individual plots.')}
            </p>
            <p>
              {t('Quarterly check-ins compare each quarter with the previous one, net of the change in the control forest, which removes seasonal greening and browning. On healthy plots the net change ranged from a 0.13 NBR gain to a 0.03 drop, well inside the 0.10 line; the plots cleared or terraced in winter 2021/22 dropped by 0.12 to 0.20. If clouds hide a quarter, the steward gets the benefit of the doubt and the evidence file says so.')}
            </p>
          </Section>

          <Section id="disturbance" title={t('Disturbance')}>
            <p>
              {t('A year-over-year NBR drop of more than 0.15 beyond the controls’ change flags a plot and pauses payouts. If the pause is not resolved within 30 days, anyone can expire it, which fails the plot and refunds funders. In our data this caught slopes that lost further vegetation in 2022 and show bulldozed terraces in later imagery: the kind of post-fire intervention that Tavşanoğlu & Pausas warn can harm natural regeneration. The flag says what changed, not who did it. The forest authority, together with an independent reviewer, decides: approved works resume payouts, anything else fails the plot.')}
            </p>
          </Section>

          <Section id="uncertainty" title={t('Uncertainty & validation')}>
            <p>
              {t('Every recovery verdict reports the per-pixel spread inside the plot, a 95% interval (with an effective sample size of n/9 because neighbouring pixels are correlated) and the margin to the target. Example: Salur slope, summer 2026: 75.0% ± 1.9% against a 60% target. One verdict in the demo set is within noise of its target; graded payouts keep that fair.')}
            </p>
            <p>
              {t('The fire perimeter was compared with NASA’s independent MODIS MCD64A1 burned-area product on the same 500 m grid: 59,075 ha (ours) vs 58,525 ha (MODIS), overlap IoU 0.89, with 94% of our perimeter confirmed by MODIS and 95% of MODIS by ours.')}
            </p>
            <p>
              {t('A second independent check uses the Hansen/UMD Global Forest Change map (30 m, Landsat, loss to 2025): 94% of all forest loss it records in the area in 2021 lies inside our perimeter, and the share of forest it records as lost rises with our severity class, from 1% (unburned) to 84% (high). On burned slopes, the trees that survived the fire were lost far more often where our quarterly check-ins flagged damage (21 ha vs 6 ha per cell, 2022-2025). A third check re-measures recovery with a different satellite: Landsat 8/9 agrees with Sentinel-2 cell by cell (r = 0.993 for 2026, same pass/fail at the target for 97% of cells). All charts are on the')}{' '}
              <CLink href="/research" color="brand.fg" fontWeight="600">{t('research page')}</CLink>.
            </p>
          </Section>

          <Section id="robustness" title={t('Robustness & placebo')}>
            <p>
              <b>{t('Why matched controls.')}</b>{' '}
              {t('Our first version compared every plot with the same three regional control cells, picked partly because they stayed stable. That choice under-corrected: by 2026 all unburned forest in the area had greened by +0.053 NBR, the three controls by only +0.032. Burned slopes also sit lower and gentler than the average unburned forest (elevation differs by 1.2 standard deviations). Matching removes this: after matching, every covariate differs by at most 0.11 standard deviations, the usual balance bar.')}
            </p>
            <p>
              {t('The correction made the engine stricter, not kinder. Median recovery by 2026 fell from 71% to 64%; 18% of the 534 burned cells changed outcome, every one of them towards less payout (67 restored → partial, 30 partial → failed). The result does not depend on the number of twins: 5, 10 or 20 give 63.6-64.3%.')}
            </p>
            <p>
              <b>{t('Placebo test.')}</b>{' '}
              {t('We treated each of the 1,760 unburned forest cells as if it were a funded plot, with twins drawn from forest at least 3 km away, and applied the damage rule for 2021-2026. Only 6 were flagged (0.34%), and some of those may be real clearing. The spread of their net change, ±0.036 NBR, is the noise floor of the method: about ±7 recovery points for a typical burned slope; graded payouts keep its effect on a payout proportional. Reproduce with')}{' '}
              <code>pipeline/11_matched_controls.py</code>.
            </p>
          </Section>

          <Section id="evidence" title={t('Evidence & commitments')}>
            <p>
              {t('Each verdict is a canonical JSON file (sorted keys, no whitespace) with the inputs, the Sentinel-2 scene IDs, thresholds, uncertainty and the pipeline version. All findings form a Merkle tree; an oracle committee (2 of 3) signs its root together with the IPFS CID of the evidence bundle (EIP-712). Every on-chain report must prove membership in a committed root, so no score can change after signing. Press “Verify” on any milestone to re-hash the file and fold the proof in your own browser, or do it by hand:')}
            </p>
            <Formula>{`# 1. download the evidence behind a payout
curl -O /api/data/evidence/plot-r41c21-m6.json

# 2. hash it
cast keccak "$(cat plot-r41c21-m6.json)"
-> 0xa1be80...385307

# 3. compare with the on-chain report (Merkle-proven)
MilestoneReported(plotId 1, idx 6, scoreBps 7499,
  evidenceHash 0xa1be80...385307, datasetRoot 0x0948e3...)`}</Formula>
          </Section>

          <Section id="limits" title={t('Limitations')}>
            <List.Root gap="2" ps="5" fontSize="body" lineHeight="1.7">
              <List.Item>{t('NBR measures vegetation cover, not species, tree survival or carbon stock.')}</List.Item>
              <List.Item>{t('At 20 m, a 64 ha plot averages about 1,600 pixels; small-scale planting is not resolved.')}</List.Item>
              <List.Item>{t('Matched controls cover terrain and pre-fire vegetation, not soil or local rainfall; quarterly check-ins still use three regional controls (fine for a 3-month comparison, where slow drift does not matter).')}</List.Item>
              <List.Item>{t('In this prototype two of the three oracle keys run on one server; production needs independent signers.')}</List.Item>
              <List.Item>{t('Time is compressed for the demo: milestones use real 2023 and 2026 imagery, triggered on request.')}</List.Item>
              <List.Item>{t('We tested a vision model on before/after images of flagged and recovering slopes: it saw the terracing campaign of winter 2021/22 on both alike and could not tell which slopes lost their regrowth, so payouts rely on the vegetation signal against matched twins (pipeline/14_ai_damage.py).')}</List.Item>
            </List.Root>
          </Section>


          <Section id="sources" title={t('Sources')}>
            <List.Root gap="2" ps="5" fontSize="small" lineHeight="1.7">
              <List.Item>
                Tavşanoğlu, Ç. &amp; Pausas, J. G. (2022), <i>Science</i>, on post-fire restoration policy in Türkiye.
              </List.Item>
              <List.Item>Gebze Technical University burn mapping, via Bianet, 12 Aug 2021.</List.Item>
              <List.Item>Key, C. H. &amp; Benson, N. C. (2006). Landscape Assessment, in FIREMON. USDA Forest Service RMRS-GTR-164-CD.</List.Item>
              <List.Item>Copernicus Sentinel-2 L2A, accessed via Microsoft Planetary Computer.</List.Item>
            </List.Root>
          </Section>
        </Stack>
      </Grid>
    </Page>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Stack as="section" id={id} gap="4" scrollMarginTop="84px">
      <Text as="h2" textStyle="h2" fontSize={{ base: '22px', md: '26px' }}>
        {title}
      </Text>
      {children}
    </Stack>
  )
}

function Formula({ children }: { children: string }) {
  return (
    <Surface p="0" boxShadow="none" bg="surfaceSunken">
      <Code display="block" whiteSpace="pre" overflowX="auto" bg="transparent" fontFamily="mono" fontSize="small" lineHeight="1.9" p="4" color="fg">
        {children}
      </Code>
    </Surface>
  )
}

function Spec({ rows }: { rows: [string, string][] }) {
  return (
    <Box borderWidth="1px" borderColor="hairline" borderRadius="md" overflow="hidden">
      {rows.map(([k, v], i) => (
        <Grid key={k} templateColumns="140px 1fr" borderTopWidth={i ? '1px' : '0'} borderColor="hairline" fontSize="small">
          <Text px="4" py="2.5" bg="surfaceSunken" fontFamily="mono" fontSize="label" color="fg.muted">
            {k}
          </Text>
          <Text px="4" py="2.5">
            {v}
          </Text>
        </Grid>
      ))}
    </Box>
  )
}

function Row({ cells }: { cells: string[] }) {
  return (
    <Table.Row>
      {cells.map((c, i) => (
        <Table.Cell key={i} px="4" py="2.5" fontWeight={i === 0 ? '600' : '400'} fontFamily={i === 3 ? 'mono' : undefined}>
          {c}
        </Table.Cell>
      ))}
    </Table.Row>
  )
}
