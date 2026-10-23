// Snapshot of the real plot data shown in the landing page's how-it-works cards, so that section renders complete and
// without layout shifts even before (or without) the API. Source: backend/data (pipeline steps 04, 05, 07).
// Re-run after the pipeline changes:  node scripts/step-story.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const STORY = 'plot-r41c21' // Salur: steps 1-3
const PARTIAL = 'plot-r42c36' // Güzelyalı: partly paid, rest refunded
const data = new URL('../../backend/data/', import.meta.url)
const results = JSON.parse(readFileSync(new URL('results.json', data), 'utf8'))
const names = Object.fromEntries(
  JSON.parse(readFileSync(new URL('plots.geojson', data), 'utf8')).features.map((f) => [f.properties.id, f.properties.name]),
)

const payouts = (id) => results[id].milestones.map((m) => ({ bps: m.bps, fractionBps: m.fractionBps }))
const story = {
  source: 'backend/data/results.json and plots.geojson (ReGrow pipeline)',
  story: {
    id: STORY,
    name: names[STORY],
    checkins: results[STORY].milestones.filter((m) => m.kind === 'checkin').map((m) => ({ period: m.period, passed: m.outcome === 'paid' })),
    recovery2026: results[STORY].periods['2026'].adj,
    payouts: payouts(STORY),
  },
  partial: { id: PARTIAL, name: names[PARTIAL], payouts: payouts(PARTIAL) },
}
writeFileSync(new URL('../src/data/stepStory.json', import.meta.url), JSON.stringify(story, null, 1) + '\n')

const out = new URL('../public/img/story/', import.meta.url)
mkdirSync(out, { recursive: true })
for (const f of ['post_rgb', 'post_nbr', '2026_nbr']) copyFileSync(new URL(`img/${STORY}/${f}.webp`, data), new URL(`${f}.webp`, out))
console.log('step story:', story.story.name, '+', story.partial.name)
