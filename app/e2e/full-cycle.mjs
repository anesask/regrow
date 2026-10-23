// Full cycle on a healthy plot: demo wallet funds → oracle settles all 7 milestones → plot verified restored →
// recovery units issued → funder retires units for a named beneficiary.
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL ?? 'http://localhost:5173'
const { PLOT: plot = 'plot-r41c21', ADMIN_PASSCODE: passcode = 'regrow-local' } = process.env
const out = process.argv[2] ?? '.'
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
  step('funded 500 FLZ')

  const admin = await browser.newPage()
  await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' })
  await admin.getByPlaceholder('Admin passcode').fill(passcode)
  await admin.getByRole('button', { name: 'Enter' }).click()
  const card = admin.locator(`[data-plot="${plot}"]`)
  for (const btn of ['M0', 'C1', 'C2', 'C3', 'C4', 'M1', 'M2']) {
    await card.getByRole('button', { name: new RegExp(`^${btn}`) }).click()
    await card.getByText(/ 0x[0-9a-f]{6}/).nth(['M0', 'C1', 'C2', 'C3', 'C4', 'M1', 'M2'].indexOf(btn) * 2).waitFor({ timeout: 60_000 })
  }
  step('oracle settled all 7 milestones')

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Verified restored').first().waitFor({ timeout: 30_000 })
  step('plot verified restored')
  await page.getByRole('button', { name: 'Issue units for this plot' }).click()
  await page.getByText('20% held back').waitFor({ timeout: 60_000 })
  step('recovery units issued')
  await page.getByPlaceholder('Amount (VRU)').fill('2')
  await page.getByPlaceholder('Beneficiary, e.g. company name').fill('Demo Holidays GmbH')
  await page.getByPlaceholder('Purpose, e.g. 2026 sustainability report').fill('2026 sustainability report')
  await page.getByRole('button', { name: 'Retire', exact: true }).click()
  await page.getByText(/2 retired/).waitFor({ timeout: 60_000 })
  step('2 VRU retired for Demo Holidays GmbH')
  await page.screenshot({ path: `${out}/cycle-plot.png`, fullPage: true })

  await page.goto(`${base}/supporters`, { waitUntil: 'networkidle' })
  await page.getByText('Demo Holidays GmbH').waitFor({ timeout: 30_000 })
  step('retirement listed publicly')
  await page.goto(`${base}/transparency`, { waitUntil: 'networkidle' })
  await page.getByText('Evidence set committed').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/cycle-transparency.png`, fullPage: true })
  step('ledger shows the committed evidence set')
  console.log('full cycle OK')
} catch (e) {
  console.log('FAILED:', e.message.split('\n')[0])
  for (const t of await page.locator('[data-scope="toast"]').allInnerTexts()) console.log('TOAST:', t.replaceAll('\n', ' | '))
  await page.screenshot({ path: `${out}/cycle-error.png`, fullPage: true })
  process.exitCode = 1
} finally {
  await browser.close()
}
