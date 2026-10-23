import { ChakraProvider } from '@chakra-ui/react'
import { type DisclaimerComponent, darkTheme, lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { ThemeProvider, useTheme } from 'next-themes'
import type { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { Toaster } from '@/components/Toaster'
import { LangProvider, useT } from '@/lib/i18n'
import { wagmiConfig } from '@/lib/wagmi'
import { system } from '@/theme'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

const rk = { borderRadius: 'small', fontStack: 'system' } as const

const LOCALE = { en: 'en-US', de: 'de-DE', tr: 'tr-TR' } as const

function ThemedRainbowKit({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme()
  const { lang, t } = useT()
  const theme =
    resolvedTheme === 'dark'
      ? darkTheme({ ...rk, accentColor: '#0f7f56', accentColorForeground: '#ffffff' })
      : lightTheme({ ...rk, accentColor: '#0f7f56' })
  const Disclaimer: DisclaimerComponent = ({ Text }) => (
    <Text>{t('The demo wallet lives in this browser and holds only play money (FLZ). No app, no sign-up.')}</Text>
  )
  return (
    <RainbowKitProvider theme={theme} modalSize="compact" locale={LOCALE[lang]} appInfo={{ appName: 'ReGrow', disclaimer: Disclaimer, learnMoreUrl: `${window.location.origin}/how-it-works#faq-demo` }}>
      {children}
    </RainbowKitProvider>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
        <LangProvider>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <ThemedRainbowKit>
              <MotionConfig reducedMotion="user">{children}</MotionConfig>
              <Toaster />
            </ThemedRainbowKit>
          </QueryClientProvider>
        </WagmiProvider>
        </LangProvider>
      </ThemeProvider>
    </ChakraProvider>
  )
}
