// Play a real browser run and capture: (1) an epoch closing early on the target,
// (2) the state at epoch 8+.
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
if (hasSeedInput) await page.locator('input').first().fill('deep-run')
const startBtn = page.locator('button:has-text("New Game"), button:has-text("Start"), button:has-text("Begin")').first()
if (await startBtn.count()) await startBtn.click()
await page.waitForSelector('.hand-cards .pcard-btn', { timeout: 15000 })

// helper: play the best-looking hand (select all 5, or as many as exist) and
// check whether the epoch closed early
async function playBest() {
  const n = await page.locator('.hand-cards .pcard-btn').count()
  const take = Math.min(5, n)
  for (let i = 0; i < take; i++) await page.locator('.hand-cards .pcard-btn').nth(i).click()
  await page.waitForSelector('[data-testid="play-btn"]')
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(150)
}

// drive through epochs, capturing when an epoch closes early (market appears
// before 4 plays) and reaching epoch 8+
let epoch = 1
let earlyCloseSeen = false
let earlyCloseEpoch = null
let playsAtClose = null
let guard = 0
let runOver = false
while (epoch < 9 && !runOver && guard++ < 200) {
  // play until the phase leaves 'select'
  let plays = 0
  while (true) {
    const phase = await page.evaluate(() => {
      const hud = document.querySelector('.hud')
      return hud ? 'select' : 'unknown'
    })
    // check if we're in market or epoch-end
    const inMarket = await page.locator('[data-testid="end-market-btn"]').count()
    const inEpochEnd = await page.locator('[data-testid="epoch-end"]').count()
    const isOver = await page.locator('.panel.verdict').count()
    if (isOver) { runOver = true; break }
    if (inMarket || inEpochEnd) break
    if (plays >= 4) break
    await playBest()
    plays++
  }
  if (runOver) break
  // record early close
  if (plays < 4 && !earlyCloseSeen) {
    earlyCloseSeen = true
    earlyCloseEpoch = epoch
    playsAtClose = plays
  }
  // advance through market / epoch-end
  const marketBtn = page.locator('[data-testid="end-market-btn"]').first()
  if (await marketBtn.count()) await marketBtn.click()
  await page.waitForTimeout(150)
  const closeBtn = page.locator('[data-testid="close-epoch-btn"]').first()
  if (await closeBtn.count()) await closeBtn.click()
  await page.waitForTimeout(150)
  // read the new epoch from the seed line
  const railLine = await page.locator('.run-rail').innerText().catch(() => '')
  const m = railLine.match(/Epoch (\d+)/)
  if (m) epoch = parseInt(m[1], 10)
  else break
}

const logTexts = await page.evaluate(() => [...document.querySelectorAll('.chronicle li')].map((l) => l.textContent))
console.log('=== EARLY CLOSE ===')
console.log(`epoch ${earlyCloseEpoch} closed after ${playsAtClose} plays (early advance fired)`)
console.log('=== CHRONICLE (last 20) ===')
for (const t of logTexts.slice(-20)) console.log(t)
console.log('=== RUN END ===')
console.log(runOver ? await page.locator('.panel.verdict').innerText().then((t) => t.replace(/\n/g, ' | ')) : `reached epoch ${epoch} without a verdict`)
console.log('=== HUD ===')
const hud = await page.locator('.run-rail').innerText().catch(() => '')
console.log(hud.replace(/\n/g, ' | '))
console.log('=== page errors ===')
console.log(errors.length ? errors.join(' | ') : 'NONE')
await browser.close()
