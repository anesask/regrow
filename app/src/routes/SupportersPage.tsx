import { Box, Button, Flex, HStack, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { ArrowRight } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CertificateGrid, fmtAmount } from '@/components/certificates'
import { RetirementLog } from '@/components/plot/RecoveryUnits'
import { Eyebrow, Figure, Mono, Page, PageHeader, primaryButton, secondaryButton, Segmented, Surface } from '@/components/ui'
import { type Certificate, useCertificates } from '@/lib/api'
import { useT } from '@/lib/i18n'

type Sort = 'amount' | 'recent'

// tier thresholds as in the API (backend/src/regrow_api/certificates.py, TIERS)
const TIERS: { tier: Certificate['tier']; from: string; h: number; bg: string }[] = [
  { tier: 'Seedling', from: '1', h: 10, bg: 'forest.200' },
  { tier: 'Sapling', from: '100', h: 18, bg: 'forest.400' },
  { tier: 'Grove', from: '1,000', h: 28, bg: 'forest.600' },
  { tier: 'Forest', from: '10,000', h: 40, bg: 'forest.800' },
]

export default function SupportersPage() {
  const { t } = useT()
  const certs = useCertificates()
  const [sort, setSort] = useState<Sort>('amount')
  const items = useMemo(() => {
    const list = [...(certs.data ?? [])]
    return sort === 'amount' ? list.sort((a, b) => b.amount - a.amount) : list.sort((a, b) => b.mintedAt - a.mintedAt)
  }, [certs.data, sort])
  const funders = new Set(items.map((c) => c.funder)).size
  const plots = new Set(items.map((c) => c.plotName)).size
  const total = items.reduce((s, c) => s + c.amount, 0)
  // no misleading zeros while the certificates load
  const n = (v: ReactNode) => (certs.isLoading ? <Skeleton as="span" display="inline-block" h="26px" w="48px" /> : v)

  return (
    <Page>
      <PageHeader eyebrow={t('Recognition')} title={t('Supporters')}>
        {t('Every supporter receives a certificate that cannot be sold. It grows with the forest: each satellite check fills it in, and a restored plot adds recovery units you can retire in your own name.')}
      </PageHeader>

      <Eyebrow mb="3">{t('What supporters receive')}</Eyebrow>
      <SimpleGrid columns={{ base: 1, md: 3 }} gap="4" mb="10">
        <Step n="01" title={t('A certificate on your first deposit')} text={t('One per plot, bound to your address. Its tier follows what you committed.')}>
          <HStack gap="2" align="end">
            {TIERS.map((x) => (
              <Stack key={x.tier} flex="1" gap="1.5" minW="0">
                <Box h={`${x.h}px`} bg={x.bg} borderRadius="sm" />
                <Text fontSize="label" fontWeight="600" lineHeight="1.2" truncate>
                  {t(x.tier)}
                </Text>
                <Mono fontSize="label" color="fg.muted">
                  {x.from}+
                </Mono>
              </Stack>
            ))}
          </HStack>
        </Step>
        <Step n="02" title={t('It fills in with every check')} text={t('Each milestone the satellites confirm turns green. A missed one turns red, and its share is refunded.')}>
          <Stack gap="2">
            <HStack gap="1.5">
              {['brand.solid', 'brand.solid', 'brand.solid', 'status.failed', 'hairlineStrong', 'hairlineStrong', 'hairlineStrong'].map((c, i) => (
                <Box key={i} flex="1" h="6px" borderRadius="full" bg={c} />
              ))}
            </HStack>
            <Mono fontSize="label" color="fg.muted">
              {t('milestones settled')} 4/7
            </Mono>
          </Stack>
        </Step>
        <Step n="03" title={t('Recovery units when the plot is restored')} text={t('Hectares times verified recovery, minus a 20% buffer. Retire them once, in your name or for someone else, on a public record.')}>
          <HStack gap="2.5" borderWidth="1px" borderColor="hairline" borderRadius="md" px="3" py="2" bg="surfaceSunken">
            <Mono fontSize="label" color="brand.fg" fontWeight="600">
              VRU
            </Mono>
            <Text fontSize="caption" color="fg.muted" lineHeight="1.4">
              {t('Example: retired for “our 2026 hotel guests”')}
            </Text>
          </HStack>
        </Step>
      </SimpleGrid>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" mb="10">
        <Surface>
          <Figure label={t('Supporters')} value={n(funders)} />
        </Surface>
        <Surface>
          <Figure label={t('Certificates')} value={n(items.length)} />
        </Surface>
        <Surface>
          <Figure label={t('Plots backed')} value={n(plots)} />
        </Surface>
        <Surface>
          <Figure label={t('Committed')} value={n(fmtAmount(total))} hint={t('FLZ play money')} />
        </Surface>
      </SimpleGrid>

      <HStack justify="space-between" mb="4" gap="4" flexWrap="wrap">
        <Text as="h2" textStyle="h2">
          {t('Certificates')}
        </Text>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            ['amount', t('Largest')],
            ['recent', t('Most recent')],
          ]}
        />
      </HStack>

      {certs.isError ? (
        <Box color="fg.muted" fontSize="small" py="10" textAlign="center">
          {t('Certificates are available once the contracts are deployed.')}
        </Box>
      ) : (
        <CertificateGrid items={items} loading={certs.isLoading} empty={t('No certificates yet. Fund a plot to receive the first one.')} />
      )}
      <Box mt="8">
        <RetirementLog hideEmpty />
      </Box>

      <Surface mt="10" p={{ base: '6', md: '8' }}>
        <Flex direction={{ base: 'column', md: 'row' }} gap="5" justify="space-between" align={{ base: 'start', md: 'center' }}>
          <Box maxW="560px">
            <Text as="h2" textStyle="h3">
              {t('Back a burned slope')}
            </Text>
            <Text fontSize="small" color="fg.muted" mt="1.5" lineHeight="1.6">
              {t('Pick a plot and fund it with FLZ play money. Your certificate appears here at once.')}
            </Text>
          </Box>
          <HStack gap="3" flexWrap="wrap">
            <Button asChild {...primaryButton}>
              <Link to="/plots">
                {t('Choose a plot')} <ArrowRight size={16} />
              </Link>
            </Button>
            <Button asChild {...secondaryButton}>
              <Link to="/how-it-works">{t('How it works')}</Link>
            </Button>
          </HStack>
        </Flex>
      </Surface>

      <Text fontSize="caption" color="fg.muted" mt="6">
        {t('Certificates are ERC-721 tokens without transfer; their artwork and metadata come from live escrow state.')}
      </Text>
    </Page>
  )
}

function Step({ n, title, text, children }: { n: string; title: string; text: string; children: ReactNode }) {
  return (
    <Surface display="flex" flexDirection="column">
      <Mono fontSize="label" color="brand.fg" fontWeight="600">
        {n}
      </Mono>
      <Text as="h3" textStyle="h3" mt="2">
        {title}
      </Text>
      <Text fontSize="small" color="fg.muted" mt="1.5" lineHeight="1.6">
        {text}
      </Text>
      {/* visuals sit at the bottom so the three cards line up */}
      <Box mt="auto" pt="5">
        {children}
      </Box>
    </Surface>
  )
}
