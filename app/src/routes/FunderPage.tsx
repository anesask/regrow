import { Box, Button, HStack, SimpleGrid, Text } from '@chakra-ui/react'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { CertificateGrid, fmtAmount } from '@/components/certificates'
import { Chip, Figure, Mono, Page, PageHeader, secondaryButton, Surface } from '@/components/ui'
import { useCertificates } from '@/lib/api'
import { shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

export default function FunderPage() {
  const { t } = useT()
  const { address = '' } = useParams()
  const { address: me } = useAccount()
  const valid = isAddress(address)
  const certs = useCertificates(valid ? address : undefined)
  const [copied, setCopied] = useState(false)
  const items = (certs.data ?? []).slice().sort((a, b) => b.amount - a.amount)
  const total = items.reduce((s, c) => s + c.amount, 0)
  const paid = items.reduce((s, c) => s + c.amount * c.releasedShare, 0)
  const refunded = items.reduce((s, c) => s + c.amount * c.refundedShare, 0)
  const isMe = me?.toLowerCase() === address.toLowerCase()

  if (!valid) {
    return (
      <Page textAlign="center" py="20">
        <Text fontFamily="heading" fontSize="title" fontWeight="600">
          {t('Not a valid wallet address')}
        </Text>
      </Page>
    )
  }
  return (
    <Page>
      <PageHeader
        eyebrow={isMe ? t('Your impact') : t('Supporter')}
        title={<Mono fontSize="inherit" fontFamily="mono">{shortHash(address, 6)}</Mono>}
        right={
          <Button
            size="sm"
            {...secondaryButton}
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy profile link')}
          </Button>
        }
      >
        {t('Certificates held by this address. Amounts are test money on a test network.')}
      </PageHeader>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="4" mb="6">
        <Surface>
          <Figure label={t('Plots supported')} value={items.length} />
        </Surface>
        <Surface>
          <Figure label={t('Committed')} value={fmtAmount(total)} hint="FLZ" />
        </Surface>
        <Surface>
          <Figure label={t('Paid on evidence')} value={fmtAmount(paid)} hint={t('FLZ released to stewards')} />
        </Surface>
        <Surface>
          <Figure label={t('Refunded')} value={fmtAmount(refunded)} hint={t('FLZ from unearned tranches')} />
        </Surface>
      </SimpleGrid>

      <HStack mb="4" gap="2">
        {isMe && <Chip tone="brand">{t('This is your wallet')}</Chip>}
        <Text fontSize="caption" color="fg.muted">
          {t('Full address')} <Mono>{address}</Mono>
        </Text>
      </HStack>
      <CertificateGrid items={items} loading={certs.isLoading} showFunder={false} empty={t('This address has not funded a plot yet.')} />
      <Box h="4" />
    </Page>
  )
}
