import { animate, motion, useInView, useReducedMotion } from 'motion/react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n'

// Shared motion vocabulary: short, eased, once. MotionConfig (providers.tsx) turns it off for reduced-motion users.
export const EASE = [0.22, 1, 0.36, 1] as const
const VIEWPORT = { once: true, margin: '0px 0px -12% 0px' } as const

/** Fades and lifts its children in when they scroll into view (or at once with `onMount`). Stagger siblings with
 *  `delay={i * STEP}`. */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  onMount = false,
  style,
}: {
  children: ReactNode
  delay?: number
  y?: number
  onMount?: boolean
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, VIEWPORT)
  // content that mounts already on screen (e.g. after its data loads) gets no "entered view" event, so check once
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const r = ref.current?.getBoundingClientRect()
      if (r && r.top < window.innerHeight && r.bottom > 0) setOnScreen(true)
    })
    return () => cancelAnimationFrame(id)
  }, [])
  const show = onMount || inView || onScreen
  return (
    <motion.div
      ref={ref}
      style={style}
      initial={{ opacity: 0, y }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

export const STEP = 0.09

/** Counts a figure like "56,663 ha", "≈203,000 ha" or "64%" up from zero when it scrolls into view. */
export function CountUp({ value, duration = 1.4 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotion()
  const { lang } = useT()
  const m = value.match(/^([^\d]*)([\d,.]+)(.*)$/)
  const target = m ? Number(m[2].replaceAll(',', '')) : 0
  const decimals = m?.[2].includes('.') ? m[2].split('.')[1].length : 0
  const numeric = !!m
  const [shown, setShown] = useState(reduce || !numeric ? target : 0)

  useEffect(() => {
    if (!inView || reduce || !numeric) return
    const controls = animate(0, target, { duration, ease: EASE, onUpdate: setShown })
    return () => controls.stop()
  }, [inView, reduce, numeric, target, duration])

  if (!m) return <span>{value}</span>
  // the value is written in English notation; shown in the reader's (56.663 ha, 87,5 % in German)
  const text = shown.toLocaleString(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  // percent sign as each language writes it: 64% (en), 64 % (de), %64 (tr)
  const pct = m[3].startsWith('%')
  const prefix = pct && lang === 'tr' ? `${m[1]}%` : m[1]
  const suffix = pct ? (lang === 'tr' ? m[3].slice(1) : lang === 'de' ? ` ${m[3]}` : m[3]) : m[3]
  return (
    <span ref={ref} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix}
      {text}
      {suffix}
    </span>
  )
}

/** Grows horizontally from the left when it scrolls into view (bars, progress). */
export function GrowX({ children, delay = 0.15 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 1, ease: EASE, delay }}
      style={{ transformOrigin: 'left center' }}
    >
      {children}
    </motion.div>
  )
}
