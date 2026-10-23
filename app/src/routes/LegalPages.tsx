import { Link as CLink, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Page, PageHeader } from '@/components/ui'
import { useT } from '@/lib/i18n'

const OWNER = 'Anes Mulalić'
const CONTACT = 'https://devpost.com/anesdevtoday'
const UPDATED = '2026-10-23'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack as="section" gap="2">
      <Text as="h2" fontFamily="heading" fontWeight="600" fontSize="title">
        {title}
      </Text>
      <Stack gap="3" color="fg.muted" fontSize="body" lineHeight="1.7">
        {children}
      </Stack>
    </Stack>
  )
}

function Contact() {
  return (
    <Text>
      {OWNER}
      <br />
      <CLink href={CONTACT} target="_blank" rel="noreferrer" color="brand.fg">
        devpost.com/anesdevtoday
      </CLink>
    </Text>
  )
}

function Legal({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  const { t } = useT()
  return (
    <Page maxW="820px">
      <PageHeader eyebrow={eyebrow} title={title}>
        {intro}
      </PageHeader>
      <Stack gap="9" pb="8">
        {children}
        <Text fontSize="label" color="fg.subtle">
          {t('Last updated')}: {UPDATED}
        </Text>
      </Stack>
    </Page>
  )
}

export function ImprintPage() {
  const { t } = useT()
  return (
    <Legal eyebrow={t('Legal')} title={t('Imprint')} intro={t('ReGrow is a non-commercial prototype built for the IEEE ClimateChain Global Hackathon 2026, track Carbon Markets & Emissions Transparency.')}>
      <Section title={t('Responsible for this site')}>
        <Contact />
      </Section>
      <Section title={t('Source code')}>
        <Text>
          {t('Open source under the MIT License:')}{' '}
          <CLink href="https://github.com/anesask/regrow" target="_blank" rel="noreferrer" color="brand.fg">
            github.com/anesask/regrow
          </CLink>
        </Text>
      </Section>
      <Section title={t('Not a company, not real money')}>
        <Text>{t('ReGrow sells nothing and takes no real money. Everything runs on Base Sepolia, a public test network, with Filiz (FLZ), test money that has no value. Nothing on this site is an offer, an investment or a request for donations.')}</Text>
      </Section>
      <Section title={t('Data and imagery')}>
        <Text>{t('Contains modified Copernicus Sentinel data 2021-2026, via Microsoft Planetary Computer. Basemap © Esri, Maxar, Earthstar Geographics. Place names © OpenStreetMap contributors.')}</Text>
      </Section>
      <Section title={t('No warranty')}>
        <Text>{t('This is a demo, provided as is, without any warranty that it is complete, correct or available. Nothing on this site is financial, legal or environmental advice, and no decision should rely on it.')}</Text>
      </Section>
      <Section title={t('AI-generated text')}>
        <Text>{t('Progress reports and answers are written by AI and may contain errors, even though their figures are checked against the evidence. They only explain; the satellite data and the smart contracts are what count.')}</Text>
      </Section>
      <Section title={t('External links')}>
        <Text>{t('Links to other sites lead to content we do not control, and we are not responsible for it.')}</Text>
      </Section>
    </Legal>
  )
}

export function PrivacyPage() {
  const { t } = useT()
  return (
    <Legal eyebrow={t('Legal')} title={t('Privacy policy')} intro={t('The short version: no accounts, no cookies, no analytics and no advertising. All money here is play money on a test network.')}>
      <Section title={t('Who is responsible')}>
        <Contact />
      </Section>
      <Section title={t('Stored in your browser')}>
        <Text>{t('Your language, light or dark mode and, if you use it, the demo wallet’s key are kept in your browser’s local storage. They stay on your device, and you can delete them at any time in your browser settings.')}</Text>
      </Section>
      <Section title={t('On our server')}>
        <Text>{t('The site runs on a server of netcup GmbH in Germany. To stop abuse, the server keeps your IP address in memory for up to one hour. It writes no access logs and builds no profiles.')}</Text>
        <Text>{t('A photo uploaded at a steward check-in is checked and then discarded. Only a fingerprint (hash) is kept, to recognise the same photo if it is uploaded again.')}</Text>
      </Section>
      <Section title={t('AI features (OpenAI)')}>
        <Text>{t('When you ask a question about a plot, the question goes to OpenAI (USA) to write the answer. A steward check-in photo goes there too, for an advisory look. Nothing else about you is sent. OpenAI does not train on this data and keeps it for up to 30 days to detect abuse. Our server keeps recent answers in memory so the same question is not sent twice.')}</Text>
      </Section>
      <Section title={t('The blockchain')}>
        <Text>{t('Funding, payouts and certificates are transactions on Base Sepolia, a public test network. Wallet addresses and transactions there are public and permanent by design; nobody can delete them. Use the demo wallet, or a wallet that is not linked to your identity.')}</Text>
      </Section>
      <Section title={t('Services your browser contacts')}>
        <Text>{t('Map imagery from Esri, and blockchain data from the Base Sepolia network (sepolia.base.org, run by Coinbase). If you connect your own wallet, also that wallet’s provider, such as MetaMask or Coinbase Wallet. Like any web request, these see your IP address. Fonts come from our own server. IPFS, Basescan and LinkedIn are contacted only if you open a link to them.')}</Text>
      </Section>
      <Section title={t('Legal basis and your rights')}>
        <Text>{t('We process this data to run the site securely and to provide the features you choose to use (Art. 6(1)(b) and (f) GDPR). You can ask for access to, correction or deletion of data about you, and you can complain to a data protection authority. Since the server keeps nothing about you beyond the short-lived memory described above, there is usually nothing to look up.')}</Text>
      </Section>
    </Legal>
  )
}
