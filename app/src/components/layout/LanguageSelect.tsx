import { Box, Button, HStack, Menu, Portal, Text } from '@chakra-ui/react'
import DE from 'country-flag-icons/react/3x2/DE'
import GB from 'country-flag-icons/react/3x2/GB'
import TR from 'country-flag-icons/react/3x2/TR'
import { Check, ChevronDown } from 'lucide-react'
import { secondaryButton } from '@/components/ui'
import { type Lang, LANGS, useT } from '@/lib/i18n'

const FLAGS = { en: GB, tr: TR, de: DE } as const

export function Flag({ code, size = 18 }: { code: Lang; size?: number }) {
  const Svg = FLAGS[code]
  return (
    <Box
      as="span"
      display="inline-flex"
      flexShrink={0}
      w={`${size}px`}
      h={`${Math.round((size * 2) / 3)}px`}
      borderRadius="2px"
      overflow="hidden"
      boxShadow="0 0 0 1px rgba(0,0,0,0.12)"
      css={{ '& svg': { width: '100%', height: '100%', display: 'block' } }}
      aria-hidden
    >
      <Svg title={LANGS.find((l) => l.code === code)?.name} />
    </Box>
  )
}

/** Header language picker: current flag + code, dropdown with each language in its own name. */
export function LanguageSelect() {
  const { t, lang, setLang } = useT()
  return (
    <Menu.Root positioning={{ placement: 'bottom-end' }}>
      <Menu.Trigger asChild>
        <Button {...secondaryButton} borderColor="hairline" size="xs" h="30px" px="2" gap="1.5" aria-label={t('Language')}>
          <Flag code={lang} />
          <Text as="span" fontFamily="mono" fontSize="label" fontWeight="600">
            {lang.toUpperCase()}
          </Text>
          <ChevronDown size={13} />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex="popover">
          <Menu.Content minW="170px">
            {/* a radio group, so assistive technology announces which language is selected */}
            <Menu.RadioItemGroup value={lang} onValueChange={(e) => setLang(e.value as Lang)}>
              {LANGS.map((l) => (
                <Menu.RadioItem key={l.code} value={l.code} cursor="pointer" lang={l.code}>
                  <HStack gap="2.5" flex="1">
                    <Flag code={l.code} />
                    <Text fontSize="small" fontWeight={l.code === lang ? '600' : '400'}>
                      {l.name}
                    </Text>
                  </HStack>
                  <Menu.ItemIndicator>
                    <Check size={14} />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioItemGroup>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

/** Flag buttons for the mobile menu, where a dropdown inside a drawer is awkward. */
export function LanguageButtons() {
  const { lang, setLang } = useT()
  return (
    <HStack gap="2" flexWrap="wrap">
      {LANGS.map((l) => (
        <Button
          key={l.code}
          size="sm"
          {...secondaryButton}
          {...(l.code === lang ? { bg: 'brand.subtle', borderColor: 'brand.solid', color: 'brand.fg', fontWeight: 'semibold' } : {})}
          gap="2"
          onClick={() => setLang(l.code)}
          aria-pressed={l.code === lang}
        >
          <Flag code={l.code} />
          {l.name}
        </Button>
      ))}
    </HStack>
  )
}
