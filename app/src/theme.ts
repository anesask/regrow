import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

// Type: Instrument Sans (headings, display figures) · IBM Plex Sans (body) · IBM Plex Mono (data, labels).
// Green-tech look: clean white panels on a faintly green-tinted canvas, hairline borders, one brand accent
// (emerald green)
// for anything primary, active or verified. Fire colours are reserved for burn severity; red = failed,
// amber = paused. Fonts are bundled (Inter, JetBrains Mono): nothing loads from the network.
const config = defineConfig({
  globalCss: {
    html: { fontSize: '14px' },
    body: { bg: 'canvas', color: 'fg' },
    'h1, h2, h3': { fontFamily: 'heading', letterSpacing: '-0.02em' },
    // line breaks: headings and captions split into even lines; running text avoids one-word last lines and
    // long German and Turkish words are hyphenated by the browser (html lang follows the chosen language)
    'h1, h2, h3, h4, figcaption, blockquote': { textWrap: 'balance' },
    'p, li': { textWrap: 'pretty', overflowWrap: 'break-word' },
    ':lang(de) p, :lang(de) li, :lang(tr) p, :lang(tr) li': { hyphens: 'auto' },
    '::selection': { bg: 'brand.muted' },
    // one visible focus ring for keyboard users on links and custom controls
    'a:focus-visible, [role="menuitem"]:focus-visible, header button:focus-visible': {
      outline: '2px solid {colors.forest.400}',
      outlineOffset: '2px',
    },
    '*::-webkit-scrollbar': { width: '10px', height: '10px' },
    '*::-webkit-scrollbar-thumb': {
      bg: 'hairlineStrong',
      borderRadius: '999px',
      border: '3px solid transparent',
      backgroundClip: 'padding-box',
    },
    // Leaflet: plot polygons are styled by class so theme tokens apply (CSS beats SVG attributes)
    '.leaflet-container': { fontFamily: 'body', bg: 'surfaceSunken' },
    '.plot-shape': { stroke: 'white' },
    '.plot-shape.sev-unburned': { fill: 'sev.unburned' },
    '.plot-shape.sev-low': { fill: 'sev.low' },
    '.plot-shape.sev-moderate-low': { fill: 'sev.modlow' },
    '.plot-shape.sev-moderate-high': { fill: 'sev.modhigh' },
    '.plot-shape.sev-high': { fill: 'sev.high' },
    '.plot-shape.is-control': { fill: 'ash', stroke: 'white', strokeDasharray: '5 4' },
    '.plot-shape.is-selected': { stroke: 'brand.selected', strokeWidth: '3px' },
    '.photo-pin': { stroke: 'white' },
    '.photo-pin.ok': { fill: 'status.completed' },
    '.photo-pin.bad': { fill: 'status.failed' },
    '.leaflet-tooltip': { fontFamily: 'body', fontSize: 'caption', borderRadius: '6px' },
  },
  theme: {
    // Type scale: everyday text uses these sizes, headings use the text styles below. One job per size.
    textStyles: {
      display: { value: { fontFamily: 'heading', fontSize: { base: '38px', md: '56px' }, fontWeight: '600', lineHeight: '1.03', letterSpacing: '-0.035em' } },
      h1: { value: { fontFamily: 'heading', fontSize: { base: '28px', md: '36px' }, fontWeight: '600', lineHeight: '1.1', letterSpacing: '-0.03em' } },
      h2: { value: { fontFamily: 'heading', fontSize: { base: '24px', md: '30px' }, fontWeight: '600', lineHeight: '1.15', letterSpacing: '-0.025em' } },
      h3: { value: { fontFamily: 'heading', fontSize: '17px', fontWeight: '600', lineHeight: '1.3', letterSpacing: '-0.01em' } },
    },
    tokens: {
      fontSizes: {
        label: { value: '11.5px' }, // mono uppercase eyebrows, chips
        caption: { value: '12.5px' }, // hints, metadata, sources
        small: { value: '14px' }, // secondary text in cards, tables, navigation
        body: { value: '15px' }, // paragraphs
        lead: { value: '17px' }, // intro paragraphs
        title: { value: '22px' }, // panel titles, key figures
      },
      fonts: {
        body: { value: `"IBM Plex Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif` },
        heading: { value: `"Instrument Sans Variable", "IBM Plex Sans Variable", system-ui, sans-serif` },
        mono: { value: `"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace` },
      },
      radii: { card: { value: '12px' }, chip: { value: '999px' } },
      colors: {
        forest: {
          50: { value: '#ecfaf3' },
          100: { value: '#d1f3e2' },
          200: { value: '#a3e6c6' },
          300: { value: '#6cd2a4' },
          400: { value: '#36b883' },
          500: { value: '#1a9c6a' },
          600: { value: '#0f7f56' },
          700: { value: '#0d6647' },
          800: { value: '#0c513a' },
          900: { value: '#0a3b2b' },
          950: { value: '#05221a' },
        },
      },
    },
    semanticTokens: {
      colors: {
        canvas: { value: { base: '#f4f6f5', _dark: '#0a0f0d' } },
        // the lightest text colour, darkened to meet WCAG AA (4.5:1) on white, the canvas and dark surfaces
        fg: { subtle: { value: { base: '#6b6b75', _light: '#6b6b75', _dark: '#9b9ba4' } } },
        shell: { value: { base: '#ffffff', _dark: '#0f1512' } },
        ink: { value: '#06241a' },
        surface: { value: { base: '#ffffff', _dark: '#121915' } },
        surfaceSunken: { value: { base: '#f3f7f5', _dark: '#0d1310' } },
        hairline: { value: { base: 'rgba(12,40,28,0.10)', _dark: 'rgba(255,255,255,0.08)' } },
        hairlineStrong: { value: { base: 'rgba(12,40,28,0.20)', _dark: 'rgba(255,255,255,0.18)' } },
        brand: {
          solid: { value: { base: '{colors.forest.600}', _dark: '{colors.forest.400}' } },
          hover: { value: { base: '{colors.forest.700}', _dark: '{colors.forest.300}' } },
          contrast: { value: { base: '#ffffff', _dark: '#07120c' } },
          fg: { value: { base: '{colors.forest.700}', _dark: '{colors.forest.300}' } },
          muted: { value: { base: '{colors.forest.100}', _dark: '{colors.forest.900}' } },
          subtle: { value: { base: '{colors.forest.50}', _dark: '{colors.forest.950}' } },
          selected: { value: { base: '#ffffff', _dark: '{colors.forest.300}' } },
          focusRing: { value: '{colors.forest.400}' },
        },
        // buttons: a deep green with white text in both modes (brand.solid turns light green in dark mode for accents)
        action: {
          primary: { value: '{colors.forest.600}' },
          primaryHover: { value: { base: '{colors.forest.700}', _dark: '{colors.forest.500}' } },
          primaryFg: { value: '#ffffff' },
        },
        ash: { value: { base: '#8a8f88', _dark: '#7c827b' } },
        ember: { value: { base: '#d0622b', _dark: '#e8834d' } },
        sev: {
          unburned: { value: '#6f9e6a' },
          low: { value: '#e9cf5f' },
          modlow: { value: '#eb9a45' },
          modhigh: { value: '#d9622f' },
          high: { value: '#9e2b25' },
        },
        status: {
          active: { value: { base: '#2c64c4', _dark: '#6b9cf0' } },
          paused: { value: { base: '#8a5a06', _dark: '#e7b04a' } }, // deep enough for 4.5:1 text on light amber
          failed: { value: { base: '#b23427', _dark: '#ef7a68' } }, // 4.5:1 text on light red
          completed: { value: { base: '{colors.forest.600}', _dark: '{colors.forest.400}' } },
        },
      },
      shadows: {
        card: {
          value: {
            base: '0 1px 2px rgba(18,24,20,0.04), 0 8px 24px -18px rgba(18,24,20,0.25)',
            _dark: '0 1px 0 rgba(255,255,255,0.03) inset, 0 16px 40px -24px rgba(0,0,0,0.8)',
          },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)

/** CSS variable for a token, for libraries that take plain colour strings (Recharts, Leaflet, SVG). */
export const cssVar = (token: string) => `var(--chakra-colors-${token.replaceAll('.', '-')})`
