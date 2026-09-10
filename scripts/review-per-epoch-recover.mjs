// Play a real browser run and capture: an epoch MISSED (life lost) followed by
// a LATER epoch MET, proving the run is recoverable under per-epoch targets.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5177'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('input, button', { timeout: 10000 })
const hasSeedInput = await page.locator('input').count()
if (hasSeedInput) await page.locator('input').first().fill('recover-run')
const startBtn = page.locator('button:has-text("New Game"), button:has-text("Start"), button:has-text("Begin")').first()
if (await startBtn.count()) await startBtn.click()
await page.waitForSelector('.hand-cards .pcard-btn', { timeout: 15000 })

// EPOCH 1: play 4 weak single cards to MISS the 100 target (each ~10-14)
for (let i = 0; i < 4; i++) {
  await page.locator('.hand-cards .pcard-btn').first().click()
  await page.waitForSelector('[data-testid="play-btn"]')
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(150)
}
// advance through market + epoch-end to epoch 2
const marketBtn = page.locator('.controls-row button:has-text("Continue")').first()
if (await marketBtn.count()) await marketBtn.click()
await page.waitForTimeout(150)
const closeBtn = page.locator('[data-testid="close-epoch-btn"]').first()
if (await closeBtn.count()) await closeBtn.click()
await page.waitForTimeout(150)

// EPOCH 2: play a strong hand (all 5 cards) to MET the target
const n = await page.locator('.hand-cards .pcard-btn').count()
const take = Math.min(5, n)
for (let i = 0; i < take; i++) await page.locator('.hand-cards .pcard-btn').nth(i).click()
await page.waitForSelector('[data-testid="play-btn"]')
await page.locator('[data-testid="play-btn"]').click()
await page.waitForTimeout(200)

const logTexts = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.innerText))
console.log('=== CHRONICLE (last 16) ===')
for (const t of logTexts.slice(-16)) console.log(t)
console.log('=== HUD ===')
const hud = await page.locator('.hud').innerText().catch(() => '')
console.log(hud.replace(/\n/g, ' | '))
console.log('=== page errors ===')
console.log(errors.length ? errors.join(' | ') : 'NONE')
await browser.close()
