// Capture fresh card-first UI screenshots (wide + narrow) showing the
// card hand + the big Growth number + the 3D planet. Acceptance evidence only.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()

async function shot(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.fill('#seed', 'auralia-the-first')
  await page.click('text=Begin New World')
  await page.waitForSelector('canvas.planet3d-canvas')
  await page.waitForSelector('.hand-cards .pcard-btn')
  // select two cards so the hero Growth number + breakdown is live
  await page.locator('.hand-cards .pcard-btn').nth(0).click()
  await page.locator('.hand-cards .pcard-btn').nth(1).click()
  await page.waitForSelector('[data-testid="growth-hero"]')
  await page.waitForTimeout(1500) // let the globe settle a few frames
  const growth = await page.locator('[data-testid="growth-hero"]').innerText()
  if (!/Growth/.test(growth) || !/\d/.test(growth)) throw new Error(`growth hero not numeric: ${growth}`)
  await page.screenshot({ path: `${OUT}/ui-${tag}-growth.png`, fullPage: false })
  await page.screenshot({ path: `${OUT}/ui-${tag}-growth-full.png`, fullPage: true })
  console.log(`shot ${tag}: growth-hero = ${growth.replace(/\n/g, ' | ')}`)
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  await page.close()
}

await shot(1280, 800, 'wide')
await shot(480, 800, 'narrow')
await browser.close()
console.log('UI SCREENSHOTS CAPTURED')