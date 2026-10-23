import { Box, createToaster, HStack, Portal, Spinner, Stack, Toast, Toaster as ChakraToaster } from '@chakra-ui/react'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'

export const toaster = createToaster({ placement: 'bottom-end', pauseOnPageIdle: true, max: 4 })

const STYLE: Record<string, { bg: string; fg: string; Icon: typeof Info | null }> = {
  success: { bg: 'brand.solid', fg: 'brand.contrast', Icon: CircleCheck },
  info: { bg: 'fg', fg: 'canvas', Icon: Info },
  loading: { bg: 'fg', fg: 'canvas', Icon: null },
  error: { bg: 'status.failed', fg: 'white', Icon: CircleAlert },
  warning: { bg: 'status.paused', fg: 'white', Icon: CircleAlert },
}

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: '4' }}>
        {(t) => {
          const st = STYLE[t.type ?? 'info'] ?? STYLE.info
          return (
            <Toast.Root w={{ md: '380px' }} bg={st.bg} color={st.fg} borderRadius="lg" boxShadow="0 18px 40px -16px rgba(0,0,0,0.5)" px="4" py="3">
              <HStack align="start" gap="3" w="100%">
                <Box pt="0.5" flexShrink={0}>
                  {st.Icon ? <st.Icon size={18} strokeWidth={2.2} /> : <Spinner size="sm" />}
                </Box>
                <Stack gap="0.5" flex="1" minW="0">
                  {t.title && (
                    <Toast.Title fontWeight="semibold" fontSize="small">
                      {t.title}
                    </Toast.Title>
                  )}
                  {t.description && (
                    <Toast.Description fontFamily="mono" fontSize="label" opacity={0.85} wordBreak="break-word">
                      {t.description}
                    </Toast.Description>
                  )}
                  {t.action && (
                    <Toast.ActionTrigger fontSize="caption" fontWeight="semibold" textDecoration="underline" alignSelf="start" mt="1" cursor="pointer">
                      {t.action.label}
                    </Toast.ActionTrigger>
                  )}
                </Stack>
                <Toast.CloseTrigger color={st.fg} opacity={0.7} _hover={{ opacity: 1, bg: 'blackAlpha.200' }} />
              </HStack>
            </Toast.Root>
          )
        }}
      </ChakraToaster>
    </Portal>
  )
}
