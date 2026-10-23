import { Box, Button, CloseButton, Drawer, Flex, HStack, IconButton, Link as CLink, Menu, Portal, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { ArrowUp, ChevronDown, Menu as MenuIcon, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { EASE } from '@/components/motion'
import { useT } from '@/lib/i18n'
import { backdrop, Eyebrow, secondaryButton, tertiaryButton } from '@/components/ui'
import { LanguageButtons, LanguageSelect } from './LanguageSelect'
import { Logo } from './Logo'

type NavLinkDef = readonly [to: string, label: string]

/** Top-level links on wide screens; the logo leads to the overview. */
const PRIMARY: NavLinkDef[] = [
  ['/plots', 'Plots'],
  ['/impact', 'Impact'],
  ['/research', 'Research'],
  ['/how-it-works', 'How it works'],
]
/** Grouped behind a dropdown on wide screens. */
const GROUPS: { label: string; links: NavLinkDef[] }[] = [
  { label: 'People', links: [['/supporters', 'Supporters'], ['/stewards', 'Stewards'], ['/steward', 'Steward check-in']] },
  { label: 'Trust', links: [['/transparency', 'Transparency'], ['/methodology', 'Methodology']] },
]
/** The mobile menu shows everything, in sections. */
const SECTIONS: { label: string; links: NavLinkDef[] }[] = [{ label: 'Explore', links: [['/', 'Overview'], ...PRIMARY] }, ...GROUPS]

const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`))

const itemStyle = (active: boolean, filled = true) =>
  ({
    position: 'relative',
    isolation: 'isolate',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    px: '3',
    h: '34px',
    borderRadius: 'md',
    fontSize: 'small',
    fontWeight: active ? '600' : '500',
    color: active ? 'fg' : 'fg.muted',
    bg: active && filled ? 'surfaceSunken' : 'transparent',
    _hover: { color: 'fg', bg: 'surfaceSunken' },
    transition: 'color .15s, background .15s',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  }) as const

/** The highlight behind the active top-level item; it slides from item to item on navigation. */
function NavPill() {
  return (
    <motion.span
      layoutId="nav-pill"
      transition={{ type: 'spring', stiffness: 520, damping: 42 }}
      style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'var(--chakra-colors-surface-sunken)', zIndex: -1 }}
    />
  )
}

function NavItem({ to, label }: { to: string; label: string }) {
  const { t } = useT()
  return (
    <NavLink to={to} end={to === '/'} style={{ borderRadius: 6 }}>
      {({ isActive: active }) => (
        <Box as="span" {...itemStyle(active, false)}>
          {active && <NavPill />}
          {t(label)}
        </Box>
      )}
    </NavLink>
  )
}

function NavGroup({ label, links }: { label: string; links: NavLinkDef[] }) {
  const { t } = useT()
  const { pathname } = useLocation()
  const active = links.some(([to]) => isActive(pathname, to))
  return (
    <Menu.Root positioning={{ placement: 'bottom-start' }}>
      <Menu.Trigger asChild>
        <Box as="button" {...itemStyle(active, false)}>
          {active && <NavPill />}
          {t(label)}
          <ChevronDown size={14} />
        </Box>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex="popover">
          <Menu.Content minW="190px">
            {links.map(([to, l]) => (
              <Menu.Item key={to} value={to} asChild cursor="pointer" fontWeight={isActive(pathname, to) ? '600' : '400'}>
                <Link to={to}>{t(l)}</Link>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useT()
  const dark = resolvedTheme === 'dark'
  return (
    <IconButton aria-label={t(dark ? 'Light mode' : 'Dark mode')} {...tertiaryButton} size="sm" onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  )
}

/** Hamburger + slide-in panel with every page, the language and the colour mode (below the lg breakpoint). */
function MobileMenu() {
  const { t } = useT()
  const { pathname } = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <Drawer.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="start" size="xs">
      <Drawer.Trigger asChild>
        <IconButton aria-label={t('Menu')} {...tertiaryButton} color="fg" size="sm" ml="-2" display={{ base: 'inline-flex', lg: 'none' }}>
          <MenuIcon size={22} />
        </IconButton>
      </Drawer.Trigger>
      <Portal>
        <Drawer.Backdrop zIndex="modal" {...backdrop} />
        <Drawer.Positioner zIndex="modal">
          <Drawer.Content bg="shell">
            <Drawer.Header borderBottomWidth="1px" borderColor="hairline" py="3">
              <HStack gap="2">
                <Logo size={18} />
                <Text fontFamily="heading" fontWeight="600">
                  ReGrow
                </Text>
              </HStack>
              <Drawer.CloseTrigger asChild position="absolute" top="2.5" insetEnd="3">
                <CloseButton size="sm" aria-label={t('Close menu')} />
              </Drawer.CloseTrigger>
            </Drawer.Header>
            <Drawer.Body py="4">
              <Stack gap="6">
                {SECTIONS.map((s) => (
                  <Stack key={s.label} gap="1">
                    <Eyebrow mb="1">{t(s.label)}</Eyebrow>
                    {s.links.map(([to, label]) => {
                      const active = isActive(pathname, to)
                      return (
                        <Box key={to} asChild {...itemStyle(active)} h="40px" fontSize="body" px="3" mx="-3">
                          <Link to={to} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}>
                            {t(label)}
                          </Link>
                        </Box>
                      )
                    })}
                  </Stack>
                ))}
                <Stack gap="2">
                  <Eyebrow>{t('Language')}</Eyebrow>
                  <LanguageButtons />
                </Stack>
                <Button {...secondaryButton} size="sm" alignSelf="start" gap="2" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                  {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                  {t(resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode')}
                </Button>
              </Stack>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  )
}

/** Visible only on keyboard focus: jumps past the header to the page content. */
function SkipLink() {
  const { t } = useT()
  return (
    <CLink
      href="#main"
      position="absolute"
      top="2"
      left="2"
      zIndex="2000"
      px="4"
      py="2"
      borderRadius="md"
      bg="action.primary"
      color="action.primaryFg"
      fontWeight="600"
      transform="translateY(-200%)"
      _focusVisible={{ transform: 'translateY(0)' }}
    >
      {t('Skip to content')}
    </CLink>
  )
}

/** Round button that appears after scrolling down and takes the reader back to the top. */
function BackToTop() {
  const { t } = useT()
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 900)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    document.getElementById('main')?.focus({ preventScroll: true })
  }
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={{ duration: 0.25, ease: EASE }}
          style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 900 }}
        >
          <IconButton
            aria-label={t('Back to top')}
            title={t('Back to top')}
            onClick={toTop}
            borderRadius="full"
            size="lg"
            bg="surface"
            color="fg"
            borderWidth="1px"
            borderColor="hairlineStrong"
            boxShadow="0 6px 24px rgba(6,36,26,0.18)"
            _hover={{ bg: 'action.primary', color: 'action.primaryFg', borderColor: 'action.primary' }}
          >
            <ArrowUp size={18} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Slim notice above the header: everything here is play money on a test network. */
function DemoBar() {
  const { t } = useT()
  return (
    <Box as="aside" aria-label={t('Demo notice')} bg="ink" color="whiteAlpha.900" fontSize="caption" lineHeight="1.4">
      <HStack maxW="1200px" mx="auto" px={{ base: '4', md: '6' }} py="1.5" gap="2" justify="center" textAlign="center">
        <Logo size={14} color="forest.300" />
        <Text display={{ base: 'none', md: 'block' }}>{t('Demo on a test network. All money is Filiz (FLZ) play money, no real funds.')}</Text>
        <Text display={{ base: 'block', md: 'none' }}>{t('Demo: play money only.')}</Text>
        <CLink asChild color="forest.300" fontWeight="600" textDecoration="underline" textUnderlineOffset="2px" whiteSpace="nowrap" _hover={{ color: 'white' }}>
          <Link to={{ pathname: '/', hash: '#filiz' }}>{t('What is FLZ?')}</Link>
        </CLink>
      </HStack>
    </Box>
  )
}

export function AppShell() {
  const location = useLocation()
  const { t } = useT()
  const [scrolled, setScrolled] = useState(false)
  const appScreen = location.pathname === '/plots'
  const shownPath = useRef(location.pathname + location.hash)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // A new page starts at the top, and keyboard and screen-reader focus moves to its content.
  useEffect(() => {
    const path = location.pathname + location.hash
    if (shownPath.current === path) return // first render (effects may run twice in development)
    shownPath.current = path
    if (!location.hash) window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [location.pathname, location.hash])

  return (
    // the plots map is an app-like screen on wide displays: locked to the window height, no footer, one scroll area
    <Flex direction="column" minH="100svh" overflowX="clip" {...(appScreen ? { h: { lg: '100svh' }, overflowY: { lg: 'hidden' } } : {})}>
      <SkipLink />
      <DemoBar />
      <Box
        as="header"
        position="sticky"
        top="0"
        zIndex="1000"
        bg="shell"
        borderBottomWidth="1px"
        borderColor="hairline"
        boxShadow={scrolled ? '0 4px 20px rgba(6,36,26,0.08)' : 'none'}
        transition="box-shadow .25s"
      >
        <Flex maxW="1200px" mx="auto" px={{ base: '4', md: '6' }} h="60px" align="center" gap={{ base: '2', lg: '5' }}>
          <MobileMenu />
          <Link to="/" aria-label="ReGrow, overview">
            <HStack gap="2">
              <Logo />
              <Text fontFamily="heading" fontSize="lead" fontWeight="600" letterSpacing="-0.02em">
                ReGrow
              </Text>
            </HStack>
          </Link>
          <HStack as="nav" aria-label={t('Main')} gap="0.5" display={{ base: 'none', lg: 'flex' }}>
            {PRIMARY.map(([to, label]) => (
              <NavItem key={to} to={to} label={label} />
            ))}
            {GROUPS.map((g) => (
              <NavGroup key={g.label} label={g.label} links={g.links} />
            ))}
          </HStack>
          <HStack ml="auto" gap="2" flexShrink={0} whiteSpace="nowrap">
            <Box display={{ base: 'none', md: 'block' }}>
              <LanguageSelect />
            </Box>
            <Box display={{ base: 'none', lg: 'block' }}>
              <ThemeToggle />
            </Box>
            <ConnectButton
              label={t('Connect')}
              showBalance={false}
              chainStatus="none"
              accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
            />
          </HStack>
        </Flex>
      </Box>

      <Box as="main" id="main" tabIndex={-1} flex="1" outline="none" scrollMarginTop="80px" {...(appScreen ? { minH: 0, display: 'flex', flexDirection: 'column' } : {})}>
        <ErrorBoundary key={location.pathname}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            style={appScreen ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}
          >
            <Outlet />
          </motion.div>
        </ErrorBoundary>
      </Box>
      {!appScreen && <BackToTop />}

      {!appScreen && (
      <Box as="footer" borderTopWidth="1px" borderColor="hairline" bg="shell">
        <SimpleGrid maxW="1200px" mx="auto" px={{ base: '4', md: '6' }} py="10" columns={{ base: 1, sm: 2, md: 4 }} gap="8">
          <Stack gap="3">
            <HStack gap="2">
              <Logo size={18} />
              <Text fontFamily="heading" fontWeight="600">
                ReGrow
              </Text>
            </HStack>
            <Text fontSize="small" color="fg.muted" lineHeight="1.6">
              {t('Pay-for-results restoration of wildfire scars, verified by satellite and settled on-chain.')}
            </Text>
          </Stack>
          {/* same groups as the navigation */}
          <FooterCol title="Explore" links={[['/', 'Overview'], ...PRIMARY]} />
          <FooterCol title="People" links={[...GROUPS[0].links, ['/admin', 'Oracle console'] as const]} />
          <FooterCol title="Trust" links={GROUPS[1].links} />
        </SimpleGrid>
        <Box borderTopWidth="1px" borderColor="hairline">
          <Stack maxW="1200px" mx="auto" px={{ base: '4', md: '6' }} py="4" gap="2">
            <Flex justify="space-between" gap="4" flexWrap="wrap">
              <Text fontSize="caption" color="fg.subtle">
                IEEE ClimateChain Global Hackathon 2026 · Carbon Markets &amp; Emissions Transparency
              </Text>
              <HStack gap="4" fontSize="caption" color="fg.subtle">
                <Text>{t('Testnet prototype. No real funds.')}</Text>
                {(
                  [
                    ['/imprint', 'Imprint'],
                    ['/privacy', 'Privacy'],
                  ] as const
                ).map(([to, label]) => (
                  <CLink key={to} asChild color="fg.muted" _hover={{ color: 'fg' }}>
                    <Link to={to}>{t(label)}</Link>
                  </CLink>
                ))}
              </HStack>
            </Flex>
            <Text fontSize="label" color="fg.subtle" lineHeight="1.6">
              {t('Contains modified Copernicus Sentinel data 2021-2026, via Microsoft Planetary Computer. Basemap © Esri, Maxar, Earthstar Geographics. Place names © OpenStreetMap contributors.')}
            </Text>
          </Stack>
        </Box>
      </Box>
      )}
    </Flex>
  )
}

function FooterCol({ title, links }: { title: string; links: readonly NavLinkDef[] }) {
  const { t } = useT()
  return (
    <Stack gap="2">
      <Eyebrow>{t(title)}</Eyebrow>
      {links.map(([to, label]) => (
        <CLink key={to} asChild fontSize="small" color="fg.muted" _hover={{ color: 'fg' }}>
          <Link to={to}>{t(label)}</Link>
        </CLink>
      ))}
    </Stack>
  )
}
