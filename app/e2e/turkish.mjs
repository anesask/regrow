// Screenshot pages in Turkish (language stored in localStorage).
import { chromium } from 'playwright-core'
const base = process.env.BASE_URL ?? 'http://localhost:5173'
const out = process.argv[2] ?? '.'
const browser = await chromium.launch({ channel: 'msedge' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => localStorage.setItem('regrow-lang', 'tr'))
const page = await ctx.newPage()
for (const p of ['/', '/steward']) {
  await page.goto(base + p, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/tr${p.replace('/', '_') || '_'}.png` })
  console.log(p, (await page.locator('h1').first().innerText()).slice(0, 80))
}
await browser.close()
