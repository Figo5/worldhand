// Play a real browser run at seed "meander" and capture the epoch-1 chronicle
// lines, proving the "(Credited 0; overflow N)" text is gone.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5177'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
// start a fresh run at seed "meander"
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.goto(BASE, { waitUntil: 'networkidle' })
// find the seed input and start
await page.waitForSelector('input, button', { timeout: 10000 })
// set the seed via the UI if there's an input; otherwise click New Game
const hasSeedInput = await page.locator('input').count()
if (hasSeedInput) {
  await page.locator('input').first().fill('meander')
}
const startBtn = page.locator('button:has-text("New Game"), button:has-text("Start"), button:has-text("Begin")').first()
if (await startBtn.count()) await startBtn.click()
await page.waitForSelector('.hand-cards .pcard-btn', { timeout: 15000 })

// play through epoch 1: select the first card and play 4 times
for (let i = 0; i < 4; i++) {
  await page.locator('.hand-cards .pcard-btn').first().click()
  await page.waitForSelector('[data-testid="play-btn"]')
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(200)
}

// capture the chronicle lines
const logTexts = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.innerText))
console.log('=== EPOCH-1 CHRONICLE LINES ===')
for (const t of logTexts) console.log(t)
console.log('=== HUD ===')
const hud = await page.locator('.hud').innerText()
console.log(hud.replace(/\n/g, ' | '))
console.log('=== overflow/Credited present? ===')
const joined = logTexts.join('\n')
console.log('overflow:', /overflow/.test(joined), '| Credited:', /Credited/.test(joined))
console.log('=== page errors ===')
console.log(errors.length ? errors.join(' | ') : 'NONE')
await browser.close()
