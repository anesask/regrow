// End-to-end check of the demo flow in a real browser (local Edge):
// demo wallet → get FLZ → fund → oracle verifies M0 → payout + certificate.
// Usage: ADMIN_PASSCODE=... PLOT=plot-xxx node e2e/demo-flow.mjs [screenshotDir]
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const plot = process.env.PLOT
const passcode = process.env.ADMIN_PASSCODE
const out = process.argv[2] ?? '.'
if (!plot || !passcode) throw new Error('set PLOT and ADMIN_PASSCODE')

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 400)))
const step = (s) => console.log(`✓ ${s}`)

async function run() {
  await page.goto(`${base}/plot/${plot}`, { waitUntil: 'networkidle' })
  await page.getByText('Escrow', { exact: true }).waitFor()
  step('plot page loaded')

  await page.getByRole('button', { name: 'Use demo wallet' }).click()
  await page.getByText('In your wallet').waitFor({ timeout: 20_000 })
  step('demo wallet connected')

  await page.getByRole('button', { name: 'Get FLZ' }).click()
  await page.getByText('10,000 FLZ').first().waitFor({ timeout: 30_000 })
  step('faucet: 10,000 FLZ')

  await page.getByRole('button', { name: /^Fund 500 FLZ/ }).click()
  await page.getByText('You back this plot with').waitFor({ timeout: 60_000 })
  step('funded 500 FLZ')
  await page.getByRole('link', { name: /View your certificate/ }).waitFor({ timeout: 30_000 })
  step('certificate shown')
  await page.screenshot({ path: `${out}/flow-1-funded.png`, fullPage: true })

  const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' })
  await admin.getByPlaceholder('Admin passcode').fill(passcode)
  await admin.getByRole('button', { name: 'Enter' }).click()
  const card = admin.locator(`[data-plot="${plot}"]`)
  await card.getByRole('button', { name: /^M0/ }).click()
  await card.getByText(/Verify Stewardship start 0x/).first().waitFor({ timeout: 60_000 })
  step('oracle verified M0')

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Paid out', { exact: true }).first().waitFor({ timeout: 30_000 })
  step('M0 shown as paid out on plot page')
  await page.screenshot({ path: `${out}/flow-2-paid.png`, fullPage: true })

  await page.goto(`${base}/ledger`, { waitUntil: 'networkidle' })
  await page.getByText('Milestone settled').first().waitFor({ timeout: 30_000 })
  step('ledger shows the payout')
  await page.screenshot({ path: `${out}/flow-3-ledger.png`, fullPage: true })
}

try {
  await run()
  console.log('demo flow OK')
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0])
  for (const t of await page.locator('[data-sonner-toast]').allInnerTexts()) console.log('TOAST:', t.replaceAll('\n', ' | '))
  await page.screenshot({ path: `${out}/flow-error.png`, fullPage: true })
  process.exitCode = 1
} finally {
  await browser.close()
}
