// Playwright verification: load, start seeded run, select card, play, discard, advance, reload, screenshots.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/01-menu.png` })

// start seeded run
await page.fill('#seed', 'auralia-the-first')
await page.click('text=Begin New World')
await page.waitForSelector('.pcard-btn')
await page.screenshot({ path: `${OUT}/02-first-hand.png`, fullPage: true })

const counts = await page.evaluate(() => ({
  regions: document.querySelectorAll('.region').length,
  cards: document.querySelectorAll('.pcard-btn').length,
  hud: document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '),
  disabledRegions: [...document.querySelectorAll('.region-btn')].filter((b) => b.disabled).length,
  enabledRegions: [...document.querySelectorAll('.region-btn')].filter((b) => !b.disabled).length,
}))
console.log('COUNTS', JSON.stringify(counts))

// find a suit that needs no target to verify play works: try each card, play, check hand shrinks
const suitOf = async (i) => (await page.locator('.pcard-btn').nth(i).getAttribute('title')).trim().slice(0, 2)
let played = null
for (let i = 0; i < 8; i++) {
  if (i >= (await page.locator('.pcard-btn').count())) break
  const suit = await suitOf(i)
  if (!suit.startsWith('♠')) {
    const before = await page.locator('.pcard-btn').count()
    await page.locator('.pcard-btn').nth(i).click()
    await page.click('button.primary:has-text("Play")')
    await page.waitForTimeout(150)
    const after = await page.locator('.pcard-btn').count()
    if (after === before - 1) { played = { suit, i, before, after }; break }
  }
}
console.log('PLAYED', JSON.stringify(played))
await page.screenshot({ path: `${OUT}/03-after-play.png` })

// discard flow
const dBefore = await page.locator('button:has-text("Discard")').innerText()
await page.locator('.pcard-btn').first().click()
await page.click('button:has-text("Discard")')
await page.waitForTimeout(150)
const dAfter = await page.locator('button:has-text("Discard")').innerText()
console.log('DISCARD', JSON.stringify({ before: dBefore, after: dAfter }))

// spade + region targeting flow
let spade = -1
for (let i = 0; i < (await page.locator('.pcard-btn').count()); i++) if ((await suitOf(i)).startsWith('♠')) { spade = i; break }
if (spade >= 0) {
  await page.locator('.pcard-btn').nth(spade).click()
  const enabled = page.locator('.region-btn:not([disabled])')
  const en = await enabled.count()
  console.log('SPADE_ENABLED_REGIONS', en)
  await enabled.first().click()
  await page.screenshot({ path: `${OUT}/04-region-selected.png` })
  await page.click('button.primary:has-text("Play")')
  await page.waitForTimeout(150)
  console.log('SPADE_PLAYED_OK', (await page.locator('.pcard-btn').count()))
}
await page.screenshot({ path: `${OUT}/05-mid-hand.png`, fullPage: true })

// advance twice → verify hand counter / epoch HUD changes
const hud1 = await page.evaluate(() => document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '))
await page.click('button.advance')
await page.waitForTimeout(150)
const hud2 = await page.evaluate(() => document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '))
console.log('HUD_BEFORE', hud1)
console.log('HUD_AFTER_ADVANCE', hud2)

// reload → saved state restored
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const hud3 = await page.evaluate(() => document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '))
const restored = await page.evaluate(() => localStorage.getItem('worldhand.save')?.length ?? 0)
console.log('HUD_AFTER_RELOAD', hud3)
console.log('SAVE_BYTES', restored)
await page.screenshot({ path: `${OUT}/06-after-reload.png`, fullPage: true })

// full run to game-over via Advance-only policy
for (let g = 0; g < 200; g++) {
  const adv = page.locator('button.advance')
  if ((await adv.count()) === 0) break
  if (await adv.isEnabled()) { await adv.click(); await page.waitForTimeout(60) }
  const skip = page.locator('button:has-text("Skip")')
  if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(60) }
  if (await page.locator('.verdict').count()) break
}
const verdict = await page.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')
console.log('VERDICT', verdict)
await page.screenshot({ path: `${OUT}/07-game-over.png`, fullPage: true })

console.log('ERRORS', JSON.stringify(errors))
await browser.close()