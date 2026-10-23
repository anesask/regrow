// Failure path: fund a plot whose check-in and early-recovery evidence fails → funder claims refund.
// Usage: ADMIN_PASSCODE=... PLOT=plot-xxx node e2e/refund-flow.mjs
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const { PLOT: plot, ADMIN_PASSCODE: passcode } = process.env
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const step = (s) => console.log(`✓ ${s}`)
try {
  await page.goto(`${base}/plot/${plot}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Use demo wallet' }).click()
  await page.getByRole('button', { name: 'Get FLZ' }).click()
  await page.getByText('10,000 FLZ').first().waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: /^Fund 500 FLZ/ }).click()
  await page.getByText('You back this plot with').waitFor({ timeout: 60_000 })
  step('funded 500 FLZ (refund on failure)')

  const admin = await browser.newPage()
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' })
  await admin.getByPlaceholder('Admin passcode').fill(passcode)
  await admin.getByRole('button', { name: 'Enter' }).click()
  const card = admin.locator(`[data-plot="${plot}"]`)
  // start + four check-ins, then early recovery (this plot scores far below half the target → fails)
  for (const [btn, label] of [['M0', 'Stewardship start'], ['C1', 'Check-in Q4 2021'], ['C2', 'Check-in Q1 2022'], ['C3', 'Check-in Q2 2022'], ['C4', 'Check-in Q3 2022'], ['M1', 'Early recovery']]) {
    await card.getByRole('button', { name: new RegExp(`^${btn}`) }).click()
    await card.getByText(new RegExp(`Verify ${label} 0x`)).first().waitFor({ timeout: 60_000 })
    step(`oracle settled ${label}`)
  }

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Failed', { exact: true }).first().waitFor({ timeout: 30_000 })
  step('plot status Failed')
  await page.getByRole('button', { name: 'Claim' }).click()
  await page.getByText('Refunded to you').waitFor({ timeout: 60_000 })
  const refunded = await page.getByText('Refunded to you').locator('..').innerText()
  step(`refund claimed: ${refunded.replace(/\s+/g, ' ')}`)
  console.log('refund flow OK')
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0])
  for (const t of await page.locator('[data-sonner-toast]').allInnerTexts()) console.log('TOAST:', t.replaceAll('\n', ' | '))
  process.exitCode = 1
} finally {
  await browser.close()
}
