// Screenshot pages at desktop and phone size with the locally installed Edge.
// Usage: node e2e/screens.mjs <outDir> [path ...]
import { chromium } from 'playwright-core'

const [outDir = '.', ...paths] = process.argv.slice(2)
const base = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'msedge' })
for (const [name, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const page = await browser.newPage(opts)
  for (const p of paths.length ? paths : ['/']) {
    await page.goto(base + p, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const file = `${outDir}/${name}${p.replace(/[/?=&]/g, '_') || '_'}.png`
    await page.screenshot({ path: file, fullPage: true })
    console.log(`${name} ${p}: horizontal overflow ${overflow}px -> ${file}`)
  }
  await page.close()
}
await browser.close()
