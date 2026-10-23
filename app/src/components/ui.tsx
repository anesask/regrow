import { Box, type BoxProps, Heading, HStack, Stack, type StackProps, Text, type TextProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

// Hover for cards, one look everywhere: the border darkens, and small cards also lift 2 px (large panels such as maps,
// tables and charts do not move). No shadow change; no movement for reduced-motion users.
export const cardHover = {
  transition: 'transform .25s ease, border-color .25s ease',
  _hover: { transform: { base: 'translateY(-2px)', _motionReduce: 'none' }, borderColor: 'hairlineStrong' },
} as const

/** Backdrop behind dialogs and the mobile menu: the page blurs and dims slightly so the dialog stands out. */
export const backdrop = { bg: 'rgba(6,36,26,0.32)', backdropFilter: 'blur(6px)' } as const

export const panelHover = {
  transition: 'border-color .25s ease',
  _hover: { borderColor: 'hairlineStrong' },
} as const

/** A panel: hairline border, soft shadow, slightly lighter than the canvas. */
export function Surface({ children, ...rest }: BoxProps & { children: ReactNode }) {
  return (
    <Box bg="surface" borderWidth="1px" borderColor="hairline" borderRadius="card" boxShadow="card" p="5" minW="0" {...panelHover} {...rest}>
      {children}
    </Box>
  )
}

/** Small uppercase mono label above a section or value. */
export function Eyebrow({ children, ...rest }: TextProps & { children: ReactNode }) {
  return (
    <Text fontFamily="mono" fontSize="label" fontWeight="medium" letterSpacing="0.1em" textTransform="uppercase" color="fg.muted" {...rest}>
      {children}
    </Text>
  )
}

/** Panel title row: eyebrow-style heading with optional actions on the right. */
export function PanelHeader({ title, right, ...rest }: StackProps & { title: ReactNode; right?: ReactNode }) {
  return (
    <HStack justify="space-between" align="center" mb="4" gap="3" flexWrap="wrap" {...rest}>
      <Eyebrow>{title}</Eyebrow>
      {right}
    </HStack>
  )
}

export type Tone = 'brand' | 'red' | 'amber' | 'blue' | 'muted'

const TONE: Record<Tone, { bg: string; color: string }> = {
  brand: { bg: 'brand.muted', color: 'brand.fg' },
  red: { bg: 'red.subtle', color: 'status.failed' },
  amber: { bg: 'orange.subtle', color: 'status.paused' },
  blue: { bg: 'blue.subtle', color: 'status.active' },
  muted: { bg: 'surfaceSunken', color: 'fg.muted' },
}

/** Status chip: mono, tinted, optional dot. */
export function Chip({ tone = 'muted', children, dot, dotColor }: { tone?: Tone; children: ReactNode; dot?: boolean; dotColor?: string }) {
  const c = TONE[tone]
  return (
    <Text
      as="span"
      fontFamily="mono"
      fontSize="label"
      px="2"
      py="0.5"
      borderRadius="sm"
      bg={c.bg}
      color={c.color}
      whiteSpace="nowrap"
      display="inline-flex"
      alignItems="center"
      gap="1.5"
    >
      {dot && <Box as="span" w="7px" h="7px" borderRadius="full" bg={dotColor ?? 'currentColor'} flexShrink={0} />}
      {children}
    </Text>
  )
}

/** Label + large tabular value. */
/** A key number. One structure everywhere: the number first, then what it is, then optional context. */
export function Figure({ label, value, hint, ...rest }: BoxProps & { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <Box minW="0" {...rest}>
      <Text fontFamily="heading" fontSize="title" fontWeight="600" letterSpacing="-0.02em" fontVariantNumeric="tabular-nums" lineHeight="1.15">
        {value}
      </Text>
      <Text fontSize="small" fontWeight="500" color="fg" mt="1" lineHeight="1.4">
        {label}
      </Text>
      {hint && (
        <Text fontSize="caption" color="fg.muted" mt="0.5" lineHeight="1.45">
          {hint}
        </Text>
      )}
    </Box>
  )
}

/** Page title block used at the top of every page. */
export function PageHeader({ eyebrow, title, children, right }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <HStack justify="space-between" align="end" gap="6" flexWrap="wrap" mb="6">
      <Stack gap="2" maxW="880px">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading as="h1" textStyle="h1">
          {title}
        </Heading>
        {children && (
          <Text color="fg.muted" fontSize={{ base: 'body', md: 'lead' }} lineHeight="1.6">
            {children}
          </Text>
        )}
      </Stack>
      {right}
    </HStack>
  )
}

/** Content container with consistent width and gutters. */
export function Page({ children, ...rest }: BoxProps & { children: ReactNode }) {
  return (
    <Box maxW="1200px" mx="auto" px={{ base: '4', md: '6' }} py={{ base: '6', md: '8' }} {...rest}>
      {children}
    </Box>
  )
}

/** Monospace inline value (hashes, addresses, ids). */
export function Mono({ children, ...rest }: TextProps & { children: ReactNode }) {
  return (
    <Text as="span" fontFamily="mono" fontSize="caption" {...rest}>
      {children}
    </Text>
  )
}

/** Segmented control. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <HStack bg="surfaceSunken" borderWidth="1px" borderColor="hairline" borderRadius="md" p="0.5" gap="0.5" h="32px">
      {options.map(([v, label]) => (
        <Box
          key={v}
          as="button"
          onClick={() => onChange(v)}
          px="3"
          h="26px"
          borderRadius="sm"
          fontSize="caption"
          bg={value === v ? 'surface' : 'transparent'}
          boxShadow={value === v ? 'xs' : 'none'}
          color={value === v ? 'fg' : 'fg.muted'}
          fontWeight={value === v ? 'semibold' : 'medium'}
          cursor="pointer"
        >
          {label}
        </Box>
      ))}
    </HStack>
  )
}

/** Primary button styling. */
// Button hierarchy. Primary: the one main action of a view (solid green, white text). Secondary: alternatives
// next to it (outlined, neutral). Tertiary: minor actions such as cancel, share or small links (text only).
export const primaryButton = {
  bg: 'action.primary',
  color: 'action.primaryFg',
  _hover: { bg: 'action.primaryHover' },
  _disabled: { opacity: 0.45 },
  borderRadius: 'md',
  fontWeight: 'semibold',
} as const

export const secondaryButton = {
  variant: 'outline',
  bg: 'surface',
  color: 'fg',
  borderColor: 'hairlineStrong',
  _hover: { bg: 'surfaceSunken', borderColor: 'fg.subtle' },
  borderRadius: 'md',
  fontWeight: 'medium',
} as const

export const tertiaryButton = {
  variant: 'ghost',
  color: 'fg.muted',
  _hover: { color: 'fg', bg: 'surfaceSunken' },
  borderRadius: 'md',
  fontWeight: 'medium',
} as const
