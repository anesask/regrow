import { Box } from '@chakra-ui/react'
import { MARK_PATH, MARK_VIEWBOX } from '@/lib/brand'

/** The ReGrow mark (also the Filiz/FLZ token mark): forest green in light mode, light green in dark mode. */
export function Logo({ size = 24, color }: { size?: number; color?: string }) {
  return (
    <Box asChild color={color ?? { base: 'forest.600', _dark: 'forest.300' }} flexShrink="0">
      <svg viewBox={MARK_VIEWBOX} width={size} height={size} aria-hidden="true">
        <path d={MARK_PATH} fill="currentColor" />
      </svg>
    </Box>
  )
}
