import { Box, Button, CloseButton, Dialog, Grid, HStack, Portal, Text } from '@chakra-ui/react'
import { ArrowRight, Download } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { fmtAmount, statusText } from '@/components/certificates'
import { Logo } from '@/components/layout/Logo'
import { backdrop, primaryButton, secondaryButton } from '@/components/ui'
import type { Certificate } from '@/lib/api'
import { addresses } from '@/lib/contracts'
import { milestoneName, shortHash } from '@/lib/format'
import { useT } from '@/lib/i18n'

// public base URL for the QR code, as on the room card; falls back to the current site
const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
// the paper is always light, in dark mode too
const INK = '#06241a'
const MUTED = '#4f6159'
const GREEN = '#0f7f56'
const BAR = (f: number | null) => (f == null ? '#e3e9e6' : f >= 1 ? GREEN : f > 0 ? '#d9a13b' : '#c8513f')

// sizes are in cqw (percent of the paper's width), so the same sheet scales in a dialog and prints at exact A4
const cq = (n: number) => `${n}cqw`

/** The certificate as an A4 document: who backed which plot, how far it has come, and how to verify it. */
export function CertificateDocument({ c }: { c: Certificate }) {
  const { t, lang } = useT()
  const paid = c.amount * c.releasedShare
  const back = c.amount * c.refundedShare
  const locked = Math.max(0, c.amount - paid - back)
  const verifyUrl = `${PUBLIC_URL}/certificate/${c.ref}`
  const since = new Date(c.mintedAt * 1000).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const no = String(c.tokenId).padStart(4, '0')
  const mono = { fontFamily: 'mono' } as const

  return (
    <Box css={{ containerType: 'inline-size' }} w="full">
      <Box className="cert-sheet" position="relative" bg="#ffffff" color={INK} aspectRatio="210 / 297" overflow="hidden" display="flex" flexDirection="column" style={{ padding: cq(9) }}>
        {/* double frame */}
        <Box position="absolute" style={{ inset: cq(3), border: `${cq(0.3)} solid ${GREEN}` }} pointerEvents="none" />
        <Box position="absolute" style={{ inset: cq(4), border: `${cq(0.1)} solid ${GREEN}`, opacity: 0.45 }} pointerEvents="none" />

        <HStack justify="space-between" align="center">
          <HStack style={{ gap: cq(1.6) }}>
            <Box style={{ width: cq(6.5), height: cq(6.5) }} css={{ '& svg': { width: '100%', height: '100%' } }}>
              <Logo color={GREEN} />
            </Box>
            <Text fontFamily="heading" fontWeight="600" letterSpacing="-0.02em" style={{ fontSize: cq(3.6) }}>
              ReGrow
            </Text>
          </HStack>
          <Text {...mono} color={MUTED} letterSpacing="0.12em" style={{ fontSize: cq(1.7) }}>
            {t('No.')} {no}
          </Text>
        </HStack>

        <Box textAlign="center" lineHeight="1.3" style={{ marginTop: cq(9) }}>
          <Text {...mono} color={GREEN} fontWeight="600" letterSpacing="0.22em" style={{ fontSize: cq(1.6) }}>
            {t('IMPACT CERTIFICATE')} · {t(c.tier).toUpperCase()}
          </Text>
          <Text fontFamily="heading" fontWeight="600" letterSpacing="-0.03em" lineHeight="1.1" style={{ fontSize: cq(6.2), marginTop: cq(1.6) }}>
            {t('Certificate of support')}
          </Text>
          <Text color={MUTED} style={{ fontSize: cq(2.1), marginTop: cq(5) }}>
            {t('This certifies that')}
          </Text>
          <Text {...mono} fontWeight="600" style={{ fontSize: cq(2.15), marginTop: cq(1.2) }} wordBreak="break-all">
            {c.funder}
          </Text>
          <Text color={MUTED} style={{ fontSize: cq(2.1), marginTop: cq(2.4) }}>
            {t('has committed')}
          </Text>
          <Text fontFamily="heading" fontWeight="600" style={{ fontSize: cq(4.6), marginTop: cq(0.6) }}>
            {fmtAmount(c.amount)} FLZ
          </Text>
          <Text color={MUTED} style={{ fontSize: cq(2.1), marginTop: cq(1.4) }}>
            {t('to the recovery of')}
          </Text>
          <Text fontFamily="heading" fontWeight="600" letterSpacing="-0.02em" color={GREEN} style={{ fontSize: cq(5.6), marginTop: cq(0.6) }}>
            {c.plotName}
          </Text>
          <Text color={MUTED} style={{ fontSize: cq(1.9), marginTop: cq(1) }}>
            {t('Manavgat wildfire scar · Antalya, Türkiye')}
            {c.areaHa ? ` · ${c.areaHa} ha` : ''}
          </Text>
        </Box>

        <Box style={{ marginTop: 'auto' }}>
          <HStack justify="space-between">
            <Text {...mono} color={MUTED} letterSpacing="0.14em" style={{ fontSize: cq(1.45) }}>
              {t('MILESTONES SETTLED')} {c.milestonesDone}/{c.milestonesTotal}
            </Text>
            <Text {...mono} color={MUTED} style={{ fontSize: cq(1.45) }}>
              {statusText(c.statusLabel, t)}
            </Text>
          </HStack>
          <HStack style={{ gap: cq(0.8), marginTop: cq(1.2) }}>
            {c.fractions.map((f, i) => (
              <Box key={i} flex="1" borderRadius="full" title={t(milestoneName(i))} style={{ height: cq(0.9), background: BAR(f) }} />
            ))}
          </HStack>
          <Grid templateColumns="repeat(3, 1fr)" style={{ gap: cq(2), marginTop: cq(2.6) }}>
            {[
              [t('Paid to stewards'), paid],
              [t('Refunded'), back],
              [t('Still locked'), locked],
            ].map(([label, v]) => (
              <Box key={label as string}>
                <Text fontFamily="heading" fontWeight="600" style={{ fontSize: cq(3) }}>
                  {fmtAmount(v as number)} <span style={{ fontSize: cq(1.6), color: MUTED }}>FLZ</span>
                </Text>
                <Text color={MUTED} style={{ fontSize: cq(1.6) }}>
                  {label}
                </Text>
              </Box>
            ))}
          </Grid>

          <Grid templateColumns="1fr auto" alignItems="end" style={{ gap: cq(4), marginTop: cq(4), paddingTop: cq(3), borderTop: `${cq(0.1)} solid #d5dfda` }}>
            <Box style={{ fontSize: cq(1.55) }} lineHeight="1.7">
              {[
                [t('Since'), since],
                [t('Token'), `ERC-721 #${c.tokenId} · ${shortHash(addresses.ImpactCertificate, 4)}`],
                [t('Transfer'), t('soulbound, cannot be sold')],
                [t('Network'), t('test network, FLZ play money')],
              ].map(([k, v]) => (
                <HStack key={k} style={{ gap: cq(1.5) }}>
                  <Text color={MUTED} minW="0" style={{ width: cq(12) }}>
                    {k}
                  </Text>
                  <Text>{v}</Text>
                </HStack>
              ))}
            </Box>
            <Box textAlign="center">
              <Box style={{ width: cq(14), height: cq(14) }} mx="auto">
                <QRCodeSVG value={verifyUrl} size={256} style={{ width: '100%', height: '100%' }} bgColor="#ffffff" fgColor={INK} marginSize={0} level="M" title={t('QR code to verify this certificate online')} />
              </Box>
              <Text color={MUTED} style={{ fontSize: cq(1.35), marginTop: cq(1) }}>
                {t('Verify online')}
              </Text>
            </Box>
          </Grid>
          <Text textAlign="center" color={MUTED} style={{ fontSize: cq(1.3), marginTop: cq(3) }}>
            {t('Payouts follow Sentinel-2 satellite evidence; unearned funds are refunded.')} {verifyUrl}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

/** Opens the browser's print dialog with only the certificate on an A4 page ("Save as PDF"). */
export function SaveCertificatePdf({ c, size = 'md' }: { c: Certificate; size?: 'sm' | 'md' }) {
  const { t } = useT()
  const print = () => {
    const prev = document.title
    document.title = `ReGrow certificate ${String(c.tokenId).padStart(4, '0')}` // the default PDF file name
    window.addEventListener('afterprint', () => (document.title = prev), { once: true })
    window.print()
  }
  return (
    <>
      <Button {...primaryButton} size={size} onClick={print}>
        <Download size={15} /> {t('Save as PDF')}
      </Button>
      {createPortal(
        <div className="cert-print" aria-hidden="true">
          <style>{`
            @media screen { .cert-print { display: none } }
            @media print {
              @page { size: A4; margin: 0 }
              html, body { background: #fff !important }
              body > *:not(.cert-print) { display: none !important }
              .cert-print { display: block; width: 210mm }
              .cert-print .cert-sheet { height: 296mm; aspect-ratio: auto !important }
              .cert-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact }
            }
          `}</style>
          <CertificateDocument c={c} />
        </div>,
        document.body,
      )}
    </>
  )
}

/** The certificate document in a dialog, with Save as PDF and a link to its page. */
export function CertificateDialog({ c, open, onOpenChange }: { c: Certificate; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT()
  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="md" placement="center" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop {...backdrop} />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="card" mx="4" maxW="600px">
            <Dialog.Header pb="3">
              <Dialog.Title textStyle="h3" fontSize="lead">
                {t('Impact certificate')} #{c.tokenId}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Box borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="hairline" boxShadow="0 18px 40px -24px rgba(5,34,26,0.45)">
                <CertificateDocument c={c} />
              </Box>
            </Dialog.Body>
            <Dialog.Footer gap="3" flexWrap="wrap">
              <Button asChild {...secondaryButton} size="md">
                <Link to={`/certificate/${c.ref}`}>
                  {t('Open page')} <ArrowRight size={15} />
                </Link>
              </Button>
              {open && <SaveCertificatePdf c={c} />}
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
