// Open a plot, run the in-browser evidence verification for its first milestone, print each step.
import { chromium } from 'playwright-core'
const base = process.env.BASE_URL ?? 'http://localhost:5173'
const plot = process.env.PLOT ?? 'plot-r26c32'
const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto(`${base}/plot/${plot}`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Verify' }).first().click()
const dialog = page.getByRole('dialog')
await dialog.getByText('4. Match the on-chain report').waitFor()
await page.waitForTimeout(4000)
console.log((await dialog.innerText()).split('\n').filter((l) => l.trim()).join('\n'))
if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
await browser.close()
