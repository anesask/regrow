import { useT } from '@/lib/i18n'
import { Box, type BoxProps, Text } from '@chakra-ui/react'
import { MoveHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'
import { periodLabel } from '@/lib/format'

/** Drag the handle to wipe between two images of the same place. */
export function CompareSlider({
  before,
  after,
  beforePeriod,
  afterPeriod,
  zoom = 1,
  ...rest
}: BoxProps & { before: string; after: string; beforePeriod: string; afterPeriod: string; zoom?: number }) {
  const { t } = useT()
  const [pos, setPos] = useState(50)
  const ref = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
  }
  const label = { position: 'absolute', top: '3', px: '2', py: '0.5', borderRadius: 'sm', bg: 'blackAlpha.700', color: 'white', fontFamily: 'mono', fontSize: 'label' } as const

  return (
    <Box
      ref={ref}
      position="relative"
      w="full"
      aspectRatio="1"
      overflow="hidden"
      borderRadius="lg"
      bg="surfaceSunken"
      userSelect="none"
      touchAction="none"
      cursor="ew-resize"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e.clientX)
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
      {...rest}
    >
      <img src={after} alt={t(periodLabel(afterPeriod))} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
      {/* clip on an unscaled wrapper so the wipe edge stays under the handle */}
      <Box position="absolute" inset="0" overflow="hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img
          src={before}
          alt={t(periodLabel(beforePeriod))}
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }}
        />
      </Box>
      <Box position="absolute" top="0" bottom="0" w="2px" bg="white" boxShadow="0 0 0 1px rgba(0,0,0,0.15)" style={{ left: `${pos}%` }}>
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          w="32px"
          h="32px"
          borderRadius="full"
          bg="white"
          color="gray.800"
          display="grid"
          placeItems="center"
          boxShadow="lg"
        >
          <MoveHorizontal size={16} />
        </Box>
      </Box>
      <Text {...label} left="3">
        {t(periodLabel(beforePeriod))}
      </Text>
      <Text {...label} right="3">
        {t(periodLabel(afterPeriod))}
      </Text>
    </Box>
  )
}
