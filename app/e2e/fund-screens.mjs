// Screenshots of the funding steps, the certificate page and the stewards page.
// Usage: PLOT=plot-xxx node e2e/fund-screens.mjs <outDir>
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const plot = process.env.PLOT ?? 'plot-r28c27'
const out = process.argv[2] ?? '.'
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const card = () => page.locator('[data-fund-card]')
const shot = async (name, locator) => {
  await page.waitForTimeout(600)
  await (locator ?? page).screenshot({ path: `${out}/${name}.png` })
  console.log(`✓ ${name}`)
}
try {
  await page.goto(`${base}/plot/${plot}`, { waitUntil: 'networkidle' })
  await shot('fund-1-wallet', card())
  await page.getByRole('button', { name: 'Use demo wallet' }).click()
  await page.getByText('In your wallet').waitFor({ timeout: 20_000 })
  await shot('fund-2-money', card())
  await page.getByRole('button', { name: 'Get FLZ' }).click()
  await page.getByText('Where your').waitFor({ timeout: 30_000 })
  await shot('fund-3-amount', card())
  await page.getByRole('button', { name: /^Fund 500 FLZ/ }).click()
  await page.getByText('You back this plot with').waitFor({ timeout: 60_000 })
  await shot('fund-4-done', card())
  await page.getByRole('link', { name: /View your certificate/ }).click()
  await page.getByText('What this support has done so far').waitFor({ timeout: 30_000 })
  await shot('certificate')
  await page.goto(`${base}/stewards`, { waitUntil: 'networkidle' })
  await page.getByText('Plots and their stewards').waitFor()
  await page.screenshot({ path: `${out}/stewards.png`, fullPage: true })
  console.log('✓ stewards')
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0])
  await page.screenshot({ path: `${out}/fund-failure.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
