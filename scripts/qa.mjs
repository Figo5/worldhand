// Playwright QA: 1280x800 and narrow width; before/after screenshots; smoke the new core loop.
// Updated for the Celestial Card Table redesign: the status HUD is now the
// compact .run-rail (data-testid run-rail) with rail-chip values; the market
// is the tabbed .market with .offer-card buttons and [data-testid=end-market-btn].
// Same coverage as before — play/discard/region/save-load/overflow — only the
// selectors track the redesigned components.
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
  // the 3D globe canvas must mount (replaces the old .planet-svg wait)
  await page.waitForSelector('.planet3d-canvas')
  await page.waitForSelector('.hand-cards .pcard-btn')
  await page.waitForSelector('[data-testid="run-rail"]')

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
  const plays = await page.locator('[data-testid="run-rail"]').innerText()
  if (!/Plays\s*3\/4/.test(plays.replace(/\n/g, ' '))) throw new Error(`expected 3/4 plays after one play, got: ${plays}`)

  // discard: select one card, discard, expect refill (8 cards) and 2/3
  await cards.nth(0).click()
  await page.locator('button:has-text("Discard")').first().click()
  await page.waitForTimeout(200)
  const handCount = await page.locator('.hand-cards .pcard-btn').count()
  if (handCount !== 8) throw new Error(`hand should refill to 8, got ${handCount}`)
  const disc = await page.locator('[data-testid="run-rail"]').innerText()
  if (!/Discards\s*2\/3/.test(disc.replace(/\n/g, ' '))) throw new Error(`expected 2/3 discards, got: ${disc}`)

  // planet interaction: select a region via the accessible legend, check that
  // the map-detail panel shows adjacency (same flow as the old .region-node click)
  await page.locator('.region-btn').nth(0).click()
  await page.waitForSelector('[data-testid="map-detail"]')
  const detail = await page.locator('[data-testid="map-detail"]').innerText()
  if (!/neighbors:/.test(detail)) throw new Error('adjacency missing in map detail')
  await page.screenshot({ path: `${shots}/after-${tag}-map.png`, fullPage: false })

  // quit keeps save: save via the Menu popover, quit, load
  await page.click('[data-testid="menu-btn"]')
  await page.waitForSelector('[data-testid="menu-pop"]')
  await page.click('[data-testid="menu-pop"] button:has-text("Save now")')
  await page.click('[data-testid="menu-btn"]')
  await page.click('[data-testid="menu-pop"] button:has-text("Quit to menu")')
  await page.waitForSelector('.intro')
  await page.click('text=Load Saved World')
  await page.waitForSelector('.planet3d-canvas')

  // menu popover language: Save/Load/Chronicle/Quit all present
  await page.click('[data-testid="menu-btn"]')
  await page.waitForSelector('[data-testid="menu-pop"]')
  const pop = await page.locator('[data-testid="menu-pop"]').innerText()
  for (const want of ['Save now', 'Load last save', 'World Chronicle', 'Quit to menu']) {
    if (!pop.includes(want)) throw new Error(`menu popover missing "${want}"`)
  }
  await page.keyboard.press('Escape') // closes the popover; game continues
  await page.waitForTimeout(150)

  // horizontal overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) throw new Error(`horizontal overflow at ${width}x${height}`)

  await browser.close()
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(`OK ${tag} (${width}x${height})`)
}

await run(1280, 800, '1280')
await run(480, 800, 'narrow')
console.log('ALL PLAYWRIGHT CHECKS PASSED')