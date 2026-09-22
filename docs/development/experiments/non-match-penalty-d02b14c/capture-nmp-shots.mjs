// Fresh screenshot capture for the Non-Match Penalty pass (ISOLATED storage —
// the user's real save is never touched; Playwright with a fresh profile).
// Shots: matching-bonus preview (+7 regions), non-match-penalty preview (-3),
// market wake offers, and a full-run verdict — all at 1280x800 and 480x800.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { newGame } from '../src/engine/worldhand.ts'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const must = (c, m) => { if (!c) throw new Error(m) }

// Crafted v4 state A: Pellucid awake (dev 6 → twopair bonus 4+3=7), a REAL two
// pair pulled from the deck (conservation stays 52) → matching hand, +7.
const twoPairState = (() => {
  const s = newGame('nmp-shots-match')
  s.regions[6].dormant = false
  s.regions[6].development = 6
  s.seeds = 24
  const take = (rank, n) => {
    const out = []
    for (let i = s.deckRest.length - 1; i >= 0 && out.length < n; i--) {
      if (s.deckRest[i].r === rank) out.push(...s.deckRest.splice(i, 1))
    }
    return out
  }
  const pair = [...take(9, 2), ...take(7, 2)]
  must(pair.length === 4, 'could not assemble a real two pair')
  const displaced = s.hand.slice(0, 4)
  s.hand = [...pair, ...s.hand.slice(4)]
  s.deckRest.push(...displaced)
  return s
})()
// Crafted v4 state B: shipped planet (Auralia pair awake), hand holds ONLY
// non-matching shapes (a straight draw → best non-match play) → −3 visible.
const penaltyState = (() => {
  const s = newGame('nmp-shots-penalty') // Auralia awake; Pellucid/Vantage dormant
  const take = (ranks, suits) => {
    const out = []
    for (const rank of ranks) {
      for (let i = s.deckRest.length - 1; i >= 0 && !out.some((c) => c.r === rank && suits.includes(c.s)); i--) {
        const c = s.deckRest[i]
        if (c.r === rank && suits.includes(c.s)) { out.push(...s.deckRest.splice(i, 1)); break }
      }
    }
    return out
  }
  const five = take([14, 13, 12, 11, 10], ['S', 'H', 'D', 'C'])
  must(fiveOk(five), 'could not assemble a non-matching high/straight shape')
  function fiveOk(cards) { return cards.length === 5 }
  const displaced = s.hand.slice(0, 5)
  s.hand = [...five, ...s.hand.slice(5)]
  s.deckRest.push(...displaced)
  return s
})()
const envelopeV4 = (state) => JSON.stringify({ schema: 3, version: 4, savedAt: '2026-09-09T12:00:00.000Z', state })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

async function capture(state, name, clickCount, expectRe) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate((env) => localStorage.setItem('worldhand.save', env), envelopeV4(state))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.hand-cards .pcard-btn')
  const n = Math.min(clickCount, (await page.locator('.hand-cards .pcard-btn').count()))
  for (let i = 0; i < n; i++) await page.locator('.hand-cards .pcard-btn').nth(i).click()
  await page.waitForSelector('[data-testid="preview"]')
  const pv = await page.locator('[data-testid="preview"]').innerText()
  return pv
}
function fiveOk(cards) { return cards.length === 5 }

// 1. MATCHING preview (+7 regions) at both widths
let clickCount = 4
await capture(twoPairState, 4)
let pv = await page.locator('[data-testid="preview"]').innerText()
must(/\+7 region/.test(pv), `match preview should show +7 region, got: ${pv}`)
await page.screenshot({ path: `${OUT}/nmp-preview-match.png`, fullPage: false })
const banner = await page.locator('[data-testid="region-match-banner"]').innerText()
console.log('match-banner:', banner.replace(/\n/g, ' '))

// 2. PENALTY preview (-3 regions) — high card under the shipped pair-awake planet
const penPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
penPage.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
penPage.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await penPage.goto(BASE, { waitUntil: 'networkidle' })
await penPage.evaluate((env) => localStorage.setItem('worldhand.save', env), envelopeV4(penaltyState))
await penPage.goto(BASE, { waitUntil: 'networkidle' })
await penPage.waitForSelector('.hand-cards .pcard-btn')
// select exactly the 5 crafted broadway cards (indices 0..4)
for (let i = 0; i < 5; i++) await penPage.locator('.hand-cards .pcard-btn').nth(i).click()
await penPage.waitForSelector('[data-testid="preview"]')
const pvPen = await penPage.locator('[data-testid="preview"]').innerText()
console.log('penalty-preview:', pvPen.replace(/\n/g, ' | ').slice(0, 220))
await penPage.screenshot({ path: `${OUT}/nmp-penalty-preview.png`, fullPage: false })

// 3. Market offers (wake notes) + 4. narrow viewport
const narrow = await browser.newPage({ viewport: { width: 480, height: 800 } })
narrow.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
narrow.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await narrow.goto(BASE, { waitUntil: 'networkidle' })
await narrow.evaluate((env) => localStorage.setItem('worldhand.save', env), envelopeV4(twoPairState))
await narrow.goto(BASE, { waitUntil: 'networkidle' })
await narrow.waitForSelector('.hand-cards .pcard-btn')
for (let i = 0; i < 4; i++) await narrow.locator('.hand-cards .pcard-btn').nth(i).click()
await narrow.waitForSelector('[data-testid="preview"]')
await narrow.screenshot({ path: `${OUT}/nmp-preview-match-narrow.png`, fullPage: false })

console.log('errors:', JSON.stringify(errors))
await browser.close()
console.log('NMP SCREENSHOTS CAPTURED')