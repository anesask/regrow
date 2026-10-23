import { Box, Button, Grid, HStack, Link as CLink, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { ArrowRight, Check, Copy, Share2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAccount } from 'wagmi'
import { CertificateDocument, SaveCertificatePdf } from '@/components/CertificateDocument'
import { fmtAmount, TIER_TONE } from '@/components/certificates'
import { Chip, Eyebrow, Figure, Mono, Page, PanelHeader, secondaryButton, Surface, tertiaryButton } from '@/components/ui'
import { useCertificate } from '@/lib/api'
import { addresses } from '@/lib/contracts'
import { milestoneName, shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

export default function CertificatePage() {
  const id = useParams().id ?? ''
  const cert = useCertificate(id)
  const navigate = useNavigate()
  const { t } = useT()
  const { address } = useAccount()
  const [copied, setCopied] = useState(false)
  const c = cert.data

  // old numeric links (/certificate/4) move to the public reference
  useEffect(() => {
    if (c && id !== c.ref) navigate(`/certificate/${c.ref}`, { replace: true })
  }, [c, id, navigate])

  if (cert.isLoading) {
    return (
      <Page maxW="1080px">
        <Grid templateColumns={{ base: '1fr', md: '420px 1fr' }} gap={{ base: '8', md: '12' }}>
          <Skeleton aspectRatio={210 / 297} borderRadius="md" />
          <Skeleton h="420px" borderRadius="card" />
        </Grid>
      </Page>
    )
  }
  if (!c) {
    return (
      <Page textAlign="center" py="20">
        <Text fontFamily="heading" fontSize="title" fontWeight="600">
          {t('Certificate not found')}
        </Text>
        <Button asChild {...secondaryButton} size="md" mt="6">
          <Link to="/supporters">{t('See all supporters')}</Link>
        </Button>
      </Page>
    )
  }

  const mine = !!address && address.toLowerCase() === c.funder.toLowerCase()
  const paid = c.amount * c.releasedShare
  const back = c.amount * c.refundedShare
  const locked = Math.max(0, c.amount - paid - back)
  const url = `${window.location.origin}/certificate/${c.ref}`
  const rows: [string, ReactNode][] = [
    [
      t('Plot'),
      c.plotKey ? (
        <CLink key="plot" asChild color="brand.fg">
          <Link to={`/plot/${c.plotKey}`}>{c.plotName}</Link>
        </CLink>
      ) : (
        c.plotName
      ),
    ],
    [
      t('Supporter'),
      <CLink key="funder" asChild>
        <Link to={`/funder/${c.funder}`}>
          <Mono>{shortHash(c.funder, 6)}</Mono>
        </Link>
      </CLink>,
    ],
    [t('Share of the plot'), `${(c.share * 100).toFixed(1)}%`],
    [t('Token'), <Mono key="token">ERC-721 #{c.tokenId} · {shortHash(addresses.ImpactCertificate, 4)}</Mono>],
  ]

  return (
    <Page maxW="1080px">
      <Grid templateColumns={{ base: '1fr', md: '420px 1fr' }} gap={{ base: '8', md: '12' }} alignItems="start">
        <Box position={{ md: 'sticky' }} top={{ md: '96px' }} borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="hairline" boxShadow="0 30px 60px -30px rgba(5,34,26,0.55)">
          <CertificateDocument c={c} />
        </Box>

        <Stack gap="6">
          <Stack gap="2">
            <HStack gap="2.5" flexWrap="wrap">
              <Eyebrow>
                {mine ? `${t('Thank you')} · ` : ''}
                {t('Impact certificate')}
              </Eyebrow>
              <Chip tone={TIER_TONE[c.tier]}>{t(c.tier)}</Chip>
            </HStack>
            <Text as="h1" textStyle="h1">
              {c.plotName}
            </Text>
            <Text color="fg.muted" fontSize="body" lineHeight="1.65">
              {t('The money behind this certificate is released to local stewards only when Sentinel-2 satellite evidence shows the burned forest recovering. Whatever is not earned is refunded.')}
            </Text>
          </Stack>

          <HStack gap="3" flexWrap="wrap">
            <SaveCertificatePdf c={c} />
            {c.plotKey && (
              <Button asChild {...secondaryButton} size="md">
                <Link to={`/plot/${c.plotKey}`}>
                  {t('Follow the plot')} <ArrowRight size={16} />
                </Link>
              </Button>
            )}
            <Button
              {...tertiaryButton}
              size="md"
              onClick={() => {
                navigator.clipboard?.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('Link copied') : t('Copy link')}
            </Button>
            <Button asChild {...tertiaryButton} size="md">
              <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
                <Share2 size={15} /> LinkedIn
              </a>
            </Button>
          </HStack>

          <Surface>
            <PanelHeader title={t('What this support has done so far')} />
            <SimpleGrid columns={3} gap="4" mb="3">
              <Figure label={t('Paid to stewards')} value={fmtAmount(paid)} hint="FLZ" />
              <Figure label={t('Refunded')} value={fmtAmount(back)} hint="FLZ" />
              <Figure label={t('Still locked')} value={fmtAmount(locked)} hint={t('awaiting evidence')} />
            </SimpleGrid>
            <HStack h="8px" gap="0.5" borderRadius="full" overflow="hidden" bg="surfaceSunken" mb="5">
              <Box h="full" bg="brand.solid" style={{ width: `${c.releasedShare * 100}%` }} />
              <Box h="full" bg="status.failed" opacity={0.7} style={{ width: `${c.refundedShare * 100}%` }} />
            </HStack>
            <Stack gap="2">
              {c.fractions.map((f, i) => (
                <HStack key={i} justify="space-between" fontSize="small">
                  <Text color={f == null ? 'fg.subtle' : 'fg'}>{t(milestoneName(i))}</Text>
                  {f == null ? (
                    <Chip>{t('upcoming')}</Chip>
                  ) : f >= 1 ? (
                    <Chip tone="brand">{t('paid in full')}</Chip>
                  ) : f > 0 ? (
                    <Chip tone="amber">
                      {Math.round(f * 100)}% {t('paid, rest returned')}
                    </Chip>
                  ) : (
                    <Chip tone="red">{t('missed, returned')}</Chip>
                  )}
                </HStack>
              ))}
            </Stack>
            <Text fontSize="label" color="fg.subtle" mt="3">
              {t('Amounts are this certificate’s pro-rata share of the plot’s payouts and refunds.')}
            </Text>
          </Surface>

          <Surface p="0">
            {rows.map(([k, v], i) => (
              <HStack key={k} justify="space-between" gap="4" px="5" py="3" borderTopWidth={i ? '1px' : '0'} borderColor="hairline" fontSize="small">
                <Text color="fg.muted">{k}</Text>
                <Box textAlign="right">{v}</Box>
              </HStack>
            ))}
          </Surface>
        </Stack>
      </Grid>
    </Page>
  )
}
