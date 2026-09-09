// Playwright QA: 1280x800 and narrow width; before/after screenshots; smoke the new core loop.
import { chromium } from 'playwright'

const URL = 'http://localhost:5177/'
const shots = 'shots'

async function run(width, height, tag) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(URL)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${shots}/before-${tag}.png`, fullPage: false })

  // start a new world
  await page.fill('#seed', 'playwright-qa')
  await page.click('text=Begin New World')
  await page.waitForSelector('.planet-svg')
  await page.waitForSelector('.hand-cards .pcard-btn')

  // select 2 cards and preview
  const cards = page.locator('.hand-cards .pcard-btn')
  await cards.nth(0).click()
  await cards.nth(1).click()
  await page.waitForSelector('[data-testid="preview"]')
  const pv = await page.locator('[data-testid="preview"]').innerText()
  if (!/Resolution preview/.test(pv)) throw new Error('preview missing')
  await page.screenshot({ path: `${shots}/after-${tag}-selected.png`, fullPage: false })

  // play
  await page.click('[data-testid="play-btn"]')
  await page.waitForTimeout(200)
  const plays = await page.locator('.hud-item:has-text("Plays")').innerText()
  if (!/3\/4/.test(plays)) throw new Error(`expected 3/4 plays after one play, got: ${plays}`)

  // discard: select one card, discard, expect refill (8 cards) and 2/3
  await cards.nth(0).click()
  await page.locator('button:has-text("Discard")').first().click()
  await page.waitForTimeout(200)
  const handCount = await page.locator('.hand-cards .pcard-btn').count()
  if (handCount !== 8) throw new Error(`hand should refill to 8, got ${handCount}`)
  const disc = await page.locator('.hud-item:has-text("Discards")').innerText()
  if (!/2\/3/.test(disc)) throw new Error(`expected 2/3 discards, got: ${disc}`)

  // map interaction: click a region node, check detail panel
  await page.locator('.region-node').nth(0).click()
  await page.waitForSelector('[data-testid="map-detail"]')
  const detail = await page.locator('[data-testid="map-detail"]').innerText()
  if (!/neighbors:/.test(detail)) throw new Error('adjacency missing in map detail')
  await page.screenshot({ path: `${shots}/after-${tag}-map.png`, fullPage: false })

  // quit keeps save: save, quit, load
  await page.click('button:has-text("Save")')
  await page.click('button:has-text("Quit")')
  await page.waitForSelector('.intro')
  await page.click('text=Load Saved World')
  await page.waitForSelector('.planet-svg')

  // horizontal overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) throw new Error(`horizontal overflow at ${width}x${height}`)

  await browser.close()
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(`OK ${tag} (${width}x${height})`)
}

await run(1280, 800, '1280')
await run(420, 820, 'narrow')
console.log('ALL PLAYWRIGHT CHECKS PASSED')