import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Eyebrow, Page, primaryButton, secondaryButton } from '@/components/ui'
import { useT } from '@/lib/i18n'

/** Shown for any unknown address, inside the normal header and footer. */
export default function NotFoundPage() {
  const { t } = useT()
  return (
    <Page>
      <Stack gap="4" py={{ base: '12', md: '20' }} maxW="560px">
        <Eyebrow>404</Eyebrow>
        <Text as="h1" textStyle="h1">
          {t('This page does not exist.')}
        </Text>
        <Text color="fg.muted" fontSize="body" lineHeight="1.65">
          {t('The link may be mistyped or out of date. The plots and the research are a good place to start.')}
        </Text>
        <HStack gap="3" flexWrap="wrap" mt="2">
          <Button asChild {...primaryButton} size="md">
            <Link to="/plots">
              {t('Explore the plots')} <ArrowRight size={16} />
            </Link>
          </Button>
          <Button asChild {...secondaryButton} size="md">
            <Link to="/">{t('Back to the start')}</Link>
          </Button>
        </HStack>
      </Stack>
    </Page>
  )
}
