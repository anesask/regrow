import { AspectRatio, Box, HStack, Image, Link as CLink, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { CertificateDialog } from '@/components/CertificateDocument'
import { Chip, Mono, type Tone } from '@/components/ui'
import { type Certificate, certificateImage } from '@/lib/api'
import { shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

export const TIER_TONE: Record<Certificate['tier'], Tone> = { Forest: 'brand', Grove: 'brand', Sapling: 'blue', Seedling: 'muted' }
export const TIER_HINT: Record<Certificate['tier'], string> = {
  Seedling: 'under 100 FLZ',
  Sapling: '100-999 FLZ',
  Grove: '1,000-9,999 FLZ',
  Forest: '10,000 FLZ and more',
}

/** Certificate status from the API ("Funded", "Recovering · 2/7", "Paused", ...) in the reader's language. */
export const statusText = (label: string, t: (s: string) => string) =>
  label.startsWith('Recovering ') ? `${t('Recovering')} ${label.slice('Recovering '.length)}` : t(label)

export const fmtAmount = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })

/** Certificate artwork (rendered by the API from live escrow state) with a compact caption. */
export function CertificateCard({ c, showFunder = true }: { c: Certificate; showFunder?: boolean }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  return (
    <Box bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="card" boxShadow="card" overflow="hidden" transition="transform .15s, box-shadow .15s" _hover={{ transform: 'translateY(-2px)' }}>
      {/* opens the certificate as a document (with Save as PDF) instead of leaving the page */}
      <Box as="button" display="block" w="full" cursor="zoom-in" onClick={() => setOpen(true)} aria-label={`${t('Open certificate')} #${c.tokenId}`}>
        <AspectRatio ratio={4 / 5} bg="ink">
          <Image src={certificateImage(c.tokenId)} alt="" loading="lazy" />
        </AspectRatio>
      </Box>
      <CertificateDialog c={c} open={open} onOpenChange={setOpen} />
      <Stack gap="1.5" px="4" py="3">
        <HStack justify="space-between" gap="2">
          <Text fontWeight="600" fontSize="small" truncate>
            {c.plotName}
          </Text>
          <Chip tone={TIER_TONE[c.tier]}>{t(c.tier)}</Chip>
        </HStack>
        <HStack justify="space-between" fontSize="caption" color="fg.muted">
          <Text fontVariantNumeric="tabular-nums">{fmtAmount(c.amount)} FLZ</Text>
          {showFunder ? (
            <CLink asChild color="fg.muted" _hover={{ color: 'fg' }}>
              <Link to={`/funder/${c.funder}`}>
                <Mono>{shortHash(c.funder, 4)}</Mono>
              </Link>
            </CLink>
          ) : (
            <Text>{statusText(c.statusLabel, t)}</Text>
          )}
        </HStack>
      </Stack>
    </Box>
  )
}

export function CertificateGrid({ items, loading, showFunder = true, empty }: { items: Certificate[]; loading?: boolean; showFunder?: boolean; empty: string }) {
  if (loading) {
    return (
      <SimpleGrid columns={{ base: 2, md: 3, lg: 4 }} gap="4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} borderRadius="card" aspectRatio={4 / 5.6} />
        ))}
      </SimpleGrid>
    )
  }
  if (items.length === 0) {
    return (
      <Box borderWidth="1px" borderStyle="dashed" borderColor="hairlineStrong" borderRadius="card" py="14" textAlign="center" color="fg.muted" fontSize="small">
        {empty}
      </Box>
    )
  }
  return (
    <SimpleGrid columns={{ base: 2, md: 3, lg: 4 }} gap="4">
      {items.map((c) => (
        <CertificateCard key={c.tokenId} c={c} showFunder={showFunder} />
      ))}
    </SimpleGrid>
  )
}
