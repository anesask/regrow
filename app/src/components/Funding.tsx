import { Logo } from '@/components/layout/Logo'
import { Box, Button, CloseButton, Dialog, Flex, Grid, HStack, Portal, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { Building2, ChevronRight, CircleHelp, CreditCard, Hotel, Landmark, Lock, Plane, Sprout, Users } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Reveal, STEP } from '@/components/motion'
import { backdrop, cardHover, Eyebrow, panelHover, secondaryButton } from '@/components/ui'
import { useT } from '@/lib/i18n'

const container = { maxW: '1200px', mx: 'auto', px: { base: '4', md: '6' } } as const
// where the example room card's QR code leads: the real Salur plot page, opened as a hotel guest. The code encodes the
// public base URL (VITE_PUBLIC_URL, e.g. the deployed domain) so a printed card works; it falls back to the current site.
const ROOM_CARD_URL = '/plot/plot-r41c21?from=room-card'
const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, '')

/** The FLZ mark. A placeholder until the Filiz logo exists: swap the contents for the logo image. */
/** Filiz (FLZ) uses the ReGrow mark. */
function FlzMark() {
  return <Logo size={40} />
}

/** Three short answers about FLZ, behind a button so the section stays simple. */
function FlzQuestions({ faq }: { faq: [string, string][] }) {
  const { t } = useT()
  return (
    <Dialog.Root size="md" placement="center" scrollBehavior="inside">
      <Dialog.Trigger asChild>
        <Button {...secondaryButton} size="sm" alignSelf="start" gap="2">
          <CircleHelp size={15} /> {t('Questions about FLZ')}
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop {...backdrop} />
        <Dialog.Positioner>
          <Dialog.Content borderRadius="card" mx="4">
            <Dialog.Header>
              <HStack gap="3">
                <FlzMark />
                <Dialog.Title textStyle="h3" fontSize="lead">
                  {t('FLZ in three questions')}
                </Dialog.Title>
              </HStack>
            </Dialog.Header>
            <Dialog.Body pb="6">
              <Stack gap="5">
                {faq.map(([q, a]) => (
                  <Stack key={q} gap="1.5">
                    <Text fontWeight="600" fontSize="body">
                      {q}
                    </Text>
                    <Text fontSize="small" color="fg.muted" lineHeight="1.6">
                      {a}
                    </Text>
                  </Stack>
                ))}
                <Text fontSize="caption" color="fg.subtle">
                  {t('"Filiz" is Turkish for a young sprout, the first green after a fire.')}
                </Text>
              </Stack>
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

/** What Filiz (FLZ) is: a token, used here as free play money; real funders would never need crypto. */
export function FilizExplainer() {
  const { t } = useT()
  const flow: [LucideIcon, string, string][] = [
    [CreditCard, t('You pay'), t('Card, bank transfer or stablecoin')],
    [Lock, t('Held in escrow'), t('As tokens, released only by the rules')],
    [Sprout, t('Stewards are paid'), t('In Turkish lira, to their bank')],
  ]
  const faq: [string, string][] = [
    [t('Is it a cryptocurrency I can buy?'), t('No. FLZ exists only on a test network, has no value and cannot be sold. One click gives a demo wallet 10,000 FLZ.')],
    [t('Why use a token at all?'), t('A contract can hold a token and release it only when the evidence says so, in public. A bank account cannot prove that to you.')],
    [t('Do funders or stewards need crypto?'), t('No. In real use a payment provider converts cards and bank transfers, and stewards receive lira. The token stays inside the system.')],
  ]
  return (
    <Box id="filiz" {...container} py={{ base: '14', md: '20' }} scrollMarginTop="80px">
      <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={{ base: '8', lg: '14' }} alignItems="center">
        <Reveal>
          <Stack gap="4">
            <HStack gap="3">
              <FlzMark />
              <Eyebrow>{t('The demo currency')}</Eyebrow>
            </HStack>
            <Text as="h2" textStyle="h2">
              {t('What is Filiz (FLZ)?')}
            </Text>
            <Text color="fg.muted" fontSize="body" lineHeight="1.7">
              {t('FLZ is a token: a balance on a public ledger that the escrow can hold and release by fixed rules. Here it is free play money. 1 FLZ stands for one dollar and has no real value.')}
            </Text>
            <FlzQuestions faq={faq} />
          </Stack>
        </Reveal>

        {/* how money moves in real use; FLZ stands in for it in the demo */}
        <Reveal delay={0.1}>
          <Stack gap="3" bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="card" boxShadow="card" p={{ base: '4', md: '6' }} {...panelHover}>
            <Eyebrow>{t('In real use')}</Eyebrow>
            <Grid // three equal columns where the card is wide enough; stacked on phones and while the card is half-width (lg)
            templateColumns={{ base: '1fr', sm: 'minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr)', lg: '1fr', xl: 'minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr)' }} gap="3" alignItems="stretch">
              {flow.map(([Icon, title, text], n) => (
                <Box key={title} display="contents">
                  <Stack gap="2" bg="surfaceSunken" borderRadius="md" p="3.5">
                    <Box color="brand.fg">
                      <Icon size={18} />
                    </Box>
                    <Text fontWeight="600" fontSize="small" lineHeight="1.3" whiteSpace="nowrap">
                      {title}
                    </Text>
                    <Text fontSize="caption" color="fg.muted" lineHeight="1.5">
                      {text}
                    </Text>
                  </Stack>
                  {n < flow.length - 1 && (
                    <Flex align="center" justify="center" color="fg.subtle" display={{ base: 'none', sm: 'flex', lg: 'none', xl: 'flex' }}>
                      <ChevronRight size={18} />
                    </Flex>
                  )}
                </Box>
              ))}
            </Grid>
            <Text fontSize="caption" color="fg.muted">
              {t('In this demo, FLZ test tokens stand in for real money at every step.')}
            </Text>
          </Stack>
        </Reveal>
      </Grid>

    </Box>
  )
}

/** An optional illustration. Renders nothing until its file exists. */
function Illustration({ name, onShown, h }: { name: string; onShown: () => void; h?: string }) {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return (
    // the box is reserved at its final size before the image loads, so nothing shifts; h fixes the height of the small cards
    <Box {...(h ? { h } : { aspectRatio: '16/9' })} flexShrink={0} borderRadius="md" overflow="hidden" bg="surfaceSunken">
      <img
        src={`/img/supporters/${name}.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={onShown}
        onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </Box>
  )
}

/** Who can support ReGrow, how they would pay and what they get back. Hotels lead: this is a tourism coast. */
export function WhoFunds() {
  const { t } = useT()
  const [shown, setShown] = useState(0)
  const onShown = () => setShown((n) => n + 1)
  const others: [LucideIcon, string, string, string][] = [
    [Plane, 'tour-operators', t('Tour operators'), t('A share of every trip to the region.')],
    [Building2, 'companies', t('Companies'), t('A sustainability budget in, Recovery Units out for their report.')],
    [Landmark, 'municipalities', t('Municipalities'), t('Protect the forest above their water, roads and beaches.')],
    [Users, 'citizens', t('Citizens and diaspora'), t('Any amount by card, money back if the forest does not recover.')],
  ]
  return (
    <Box bg="shell" borderY="1px solid" borderColor="hairline">
      <Box {...container} py={{ base: '14', md: '20' }}>
        <Reveal>
          <Stack gap="3" maxW="720px">
            <Eyebrow>{t('Who can support ReGrow')}</Eyebrow>
            <Text as="h2" textStyle="h2">
              {t('Everyone who lives from this coast.')}
            </Text>
            <Text color="fg.muted" fontSize="body" lineHeight="1.65">
              {t('Most supporters never see a token: they pay by card or invoice and follow their forest online.')}
            </Text>
          </Stack>
        </Reveal>

        <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap="4" mt="10">
          {/* hotels: the Antalya case, with a mock room card */}
          <Reveal style={{ height: '100%' }}>
            <Grid h="full" templateColumns={{ base: '1fr', sm: '1fr 190px' }} gap="5" bg="ink" color="white" borderRadius="card" p={{ base: '5', md: '7' }} alignItems="center" {...cardHover} _hover={{ ...cardHover._hover, borderColor: 'transparent' }}>
              <Box gridColumn="1 / -1">
                <Illustration name="hotels" onShown={onShown} />
              </Box>
              <Stack gap="3">
                <HStack gap="2" color="forest.300">
                  <Hotel size={18} />
                  <Eyebrow color="forest.300">{t('Hotels and resorts')}</Eyebrow>
                </HStack>
                <Text fontFamily="heading" fontWeight="600" fontSize="title" lineHeight="1.2" letterSpacing="-0.02em">
                  {t('“Restore the forest you are on holiday in.”')}
                </Text>
                <Text fontSize="small" color="whiteAlpha.800" lineHeight="1.6">
                  {t('Guests add a little per night; a code on the room card shows their forest growing back.')}
                </Text>
              </Stack>
              <Box bg="white" color="ink" borderRadius="md" p="4" boxShadow="0 12px 30px rgba(0,0,0,.35)" transform={{ sm: 'rotate(5deg)' }}>
                <Text fontSize="label" fontFamily="mono" color="gray.500" textTransform="uppercase" letterSpacing="0.08em">
                  {t('Room 214')}
                </Text>
                <Text fontWeight="600" fontSize="small" lineHeight="1.3" mt="1">
                  {t('Your stay helps the burned forest near Salur grow back')}
                </Text>
                {/* a real code: scanning (or clicking) opens the Salur plot as a hotel guest would see it */}
                <HStack mt="3" gap="3" align="center">
                  <a href={ROOM_CARD_URL} target="_blank" rel="noreferrer" aria-label={t('Open the forest from the room card')} style={{ lineHeight: 0 }}>
                    <QRCodeSVG title={t('QR code to the Salur forest plot')} value={`${PUBLIC_URL}${ROOM_CARD_URL}`} size={58} bgColor="#ffffff" fgColor="#06241a" marginSize={0} level="M" />
                  </a>
                  <Text fontSize="caption" color="gray.600" lineHeight="1.4">
                    {t('Scan to see it from space')}
                  </Text>
                </HStack>
              </Box>
            </Grid>
          </Reveal>

          <SimpleGrid columns={{ base: 1, sm: 2 }} gap="4">
            {others.map(([Icon, file, title, line], n) => (
              <Reveal key={title} delay={(n + 1) * STEP} style={{ height: '100%' }}>
                <Stack h="full" gap="2" bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="card" p="4" {...cardHover}>
                  <Illustration name={file} onShown={onShown} h="150px" />
                  <HStack gap="2" color="brand.fg">
                    <Icon size={18} />
                    <Text fontWeight="600" fontSize="small" color="fg">
                      {title}
                    </Text>
                  </HStack>
                  <Text fontSize="caption" color="fg.muted" lineHeight="1.5">
                    {line}
                  </Text>
                </Stack>
              </Reveal>
            ))}
          </SimpleGrid>
        </Grid>
        {shown > 0 && (
          <Text fontSize="caption" color="fg.subtle" mt="4">
            {t('Illustrations are AI-generated. All maps, numbers and satellite images are real data.')}
          </Text>
        )}
      </Box>
    </Box>
  )
}
