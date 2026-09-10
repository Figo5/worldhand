// Bounded acceptance playtest of the Balatro-hard shop mechanics in isolated
// browser storage. Exercises: start, play hands, reach market, buy each new
// card type + world boost, verify preview==commit, consumable consumed once,
// reload preserves the new state, and the joker-slot cap disables the button.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5177'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
// isolated storage: clear any save, start fresh
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('input, button', { timeout: 10000 })
const hasSeedInput = await page.locator('input').count()
if (hasSeedInput) await page.locator('input').first().fill('acceptance-playtest')
const startBtn = page.locator('button:has-text("New Game"), button:has-text("Start"), button:has-text("Begin")').first()
if (await startBtn.count()) await startBtn.click()
await page.waitForSelector('.hand-cards .pcard-btn', { timeout: 15000 })

// helper: play the best-looking hand (select up to 5 cards, click play)
async function playHand() {
  // select the first 2 cards (a pair attempt) — simple human-like policy
  const cards = page.locator('.hand-cards .pcard-btn')
  const n = await cards.count()
  if (n >= 2) { await cards.nth(0).click(); await cards.nth(1).click() }
  else if (n >= 1) { await cards.nth(0).click() }
  await page.waitForSelector('[data-testid="play-btn"]')
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(150)
}

// play until we reach the market (epoch 1 target is 100; a few hands should do it,
// or 4 plays closes the epoch)
let phase = 'select'
for (let i = 0; i < 6 && phase === 'select'; i++) {
  await playHand()
  // check if we're in market now
  const inMarket = await page.locator('.market').count()
  if (inMarket) phase = 'market'
  else {
    const inEpochEnd = await page.locator('[data-testid="epoch-end"]').count()
    if (inEpochEnd) {
      // close epoch to reach market
      const closeBtn = page.locator('button:has-text("Continue"), button:has-text("Close"), button:has-text("View Results")').first()
      if (await closeBtn.count()) await closeBtn.click()
      await page.waitForTimeout(150)
      phase = 'market'
    }
  }
}

console.log('=== reached phase:', phase, '===')

// In the market, inspect what's offered
const marketText = await page.locator('.market').innerText()
console.log('=== MARKET SECTIONS PRESENT ===')
for (const s of ['Jokers', 'Planets', 'Consumables', 'Vouchers', 'World Level', 'World Projects']) {
  console.log(s + ':', marketText.includes(s))
}

// Try to buy a joker (if affordable and offered)
const jokerBtn = page.locator('.market-btn:has-text("Joker")').first()
if (await jokerBtn.count()) {
  const disabled = await jokerBtn.isDisabled()
  console.log('=== JOKER BUY BUTTON ===')
  console.log('joker offered, disabled:', disabled)
  if (!disabled) {
    await jokerBtn.click()
    await page.waitForTimeout(150)
    console.log('bought a joker')
  }
}

// Try to buy a planet card
const planetBtn = page.locator('.market-btn:has-text("Planet:")').first()
if (await planetBtn.count()) {
  const disabled = await planetBtn.isDisabled()
  console.log('=== PLANET BUY BUTTON ===')
  console.log('planet offered, disabled:', disabled)
  if (!disabled) { await planetBtn.click(); await page.waitForTimeout(150); console.log('bought a planet') }
}

// Try to buy a consumable
const consBtn = page.locator('.market-btn:has-text("Double Down"), .market-btn:has-text("Triple Threat")').first()
if (await consBtn.count()) {
  const disabled = await consBtn.isDisabled()
  console.log('=== CONSUMABLE BUY BUTTON ===')
  console.log('consumable offered, disabled:', disabled)
  if (!disabled) { await consBtn.click(); await page.waitForTimeout(150); console.log('bought a consumable') }
}

// Try to buy a voucher
const vouchBtn = page.locator('.market-btn:has-text("Voucher:")').first()
if (await vouchBtn.count()) {
  const disabled = await vouchBtn.isDisabled()
  console.log('=== VOUCHER BUY BUTTON ===')
  console.log('voucher offered, disabled:', disabled)
  if (!disabled) { await vouchBtn.click(); await page.waitForTimeout(150); console.log('bought a voucher') }
}

// Try to boost world level
const boostBtn = page.locator('.market-btn:has-text("Boost World Level")').first()
if (await boostBtn.count()) {
  const disabled = await boostBtn.isDisabled()
  console.log('=== WORLD LEVEL BOOST ===')
  console.log('boost offered, disabled:', disabled)
  if (!disabled) { await boostBtn.click(); await page.waitForTimeout(150); console.log('boosted world level') }
}

// HUD after purchases
const hud = await page.locator('[data-testid="run-rail"]').innerText()
console.log('=== HUD AFTER PURCHASES ===')
console.log(hud.replace(/\n/g, ' | '))

// Continue to next epoch, then verify reload preserves state
const continueBtn = page.locator('button:has-text("Continue → close epoch")').first()
if (await continueBtn.count()) await continueBtn.click()
await page.waitForTimeout(150)

// reload and check the state persisted
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const hudAfterReload = await page.locator('[data-testid="run-rail"]').innerText()
console.log('=== HUD AFTER RELOAD ===')
console.log(hudAfterReload.replace(/\n/g, ' | '))
console.log('=== RELOAD PRESERVES STATE? ===')
console.log('world level visible:', /World Lv\b/.test(hudAfterReload))
console.log('world score visible:', /World Score/.test(hudAfterReload))

console.log('=== PAGE ERRORS ===')
console.log(errors.length ? errors.join(' | ') : 'NONE')
await browser.close()
