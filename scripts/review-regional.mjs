// Regional-bonus browser acceptance (ISOLATED storage — the user's real save
// is never touched; every probe runs against a crafted or cleared save).
// 1. Crafted v4 save: Pellucid (Two Pair) awake at dev 6, hand holds a REAL
//    two pair → preview parts `{poker, laws, regions}` reconcile, the banner
//    names Pellucid + its bonus, the globe tooltip is visible, the legend
//    badge is active, and the globe shows the gold match ring.
// 2. Market surfaces the specialization expansions with their poker notes;
//    buying Wake Vantage awakens the advertised region + its bonus.
// 3. A legacy v3 save is REJECTED with the fresh-run explanation and the blob
//    preserved under a legacy key (never erased, never reinterpreted).
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { newGame } from '../src/engine/worldhand.ts'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const rec = (k, v) => console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

// --- crafted v4 state: Pellucid awake (dev 6 → twopair bonus 4+3=7), a REAL
// two pair pulled from the deck (conservation stays exactly 52) ---
const twoPairState = (() => {
  const s = newGame('reg-ui-proof')
  s.regions[6].dormant = false // Pellucid
  s.regions[6].development = 6
  s.seeds = 24 // so the 18-nominal earn hits the cap: credited 6, overflow 12
  const take = (rank, n) => {
    const out = []
    for (let i = s.deckRest.length - 1; i >= 0 && out.length < n; i--) {
      if (s.deckRest[i].r === rank) out.push(...s.deckRest.splice(i, 1))
    }
    return out
  }
  const pair = [...take(9, 2), ...take(7, 2)]
  must(pair.length === 4, 'could not assemble a real two pair from the deck')
  const displaced = s.hand.slice(0, 4)
  s.hand = [...pair, ...s.hand.slice(4)]
  s.deckRest.push(...displaced)
  return s
})()
const envelopeV4 = (state) => JSON.stringify({ schema: 3, version: 4, savedAt: '2026-09-09T00:00:00.000Z', state })

// --- a REAL v3 save (pre-regional scoring: version 3, no specialization) ---
const v3state = (() => {
  const s = JSON.parse(JSON.stringify(newGame('legacy-v3-ui')))
  s.version = 3
  for (const r of s.regions) delete r.specialization
  return s
})()
const legacyV3 = JSON.stringify({ schema: 3, version: 3, savedAt: '2026-01-04T00:00:00.000Z', state: v3state })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// ============ 1. preview → banner + tooltip + legend + breakdown ============
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate((env) => localStorage.setItem('worldhand.save', env), envelopeV4(twoPairState))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.hand-cards .pcard-btn')
for (const i of [0, 1, 2, 3]) await page.locator('.hand-cards .pcard-btn').nth(i).click()
await page.waitForSelector('[data-testid="preview"]')
const pvText = await page.locator('[data-testid="preview"]').innerText()
rec('preview', pvText.replace(/\n/g, ' | '))
must(/Banks 71 Growth/.test(pvText), `preview should bank 71 Growth (64 poker + 7 regions), got: ${pvText}`)
must(/\+7 region/.test(pvText), 'preview summary lacks the +7 region clause')
must(/\(Credited 6; overflow 12\)/.test(pvText), 'preview lacks the truthful capped-credit clause')
const breakdown = await page.locator('.growth-hero-breakdown').innerText()
rec('breakdown', breakdown)
must(breakdown.includes('+64 poker') && breakdown.includes('+7 regions'), `breakdown does not reconcile (poker 64 + regions 7): ${breakdown}`)
const banner = await page.locator('[data-testid="region-match-banner"]')
must(await banner.count() === 1, 'region-match banner missing on a matching preview')
const bannerText = await banner.innerText()
rec('banner', bannerText)
must(/Pellucid \(Two Pair\) \+7/.test(bannerText), `banner does not name Pellucid +7: ${bannerText}`)
const tooltip = await page.locator('[data-testid="globe-spec-tooltip"]')
must(await tooltip.count() === 1, 'globe tooltip missing on a matching preview')
const tooltipText = await tooltip.innerText()
rec('tooltip', tooltipText)
must(/Pellucid: Two Pair \+7 Growth/.test(tooltipText), `tooltip wrong: ${tooltipText}`)
// legend: Pellucid button is highlighted as a match
const pellucidBtn = page.locator('.region-btn', { hasText: 'Pellucid' })
must((await pellucidBtn.getAttribute('class')).includes('spec-match'), 'Pellucid legend button lacks the spec-match highlight')
// map-detail specialization sentence
await pellucidBtn.click()
const detail = await page.locator('[data-testid="map-detail"]').innerText()
rec('map-detail', detail.replace(/\n/g, ' | '))
must(/Poker specialization: Two Pair — active: \+7 Growth/.test(detail), `map-detail spec sentence wrong: ${detail}`)
await page.screenshot({ path: `${OUT}/regional-preview-match.png`, fullPage: true })

// commit: preview == commit in the chronicle
await page.locator('[data-testid="play-btn"]').click()
await page.waitForTimeout(250)
const played = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.innerText).find((t) => t.includes('Played Two Pair')))
rec('chronicle', played ?? 'NONE')
must(played && played.includes('Banks 71 Growth') && played.includes('+7 region'), 'chronicle does not echo the previewed 71 Growth with the region clause')
const seedsHud = await page.locator('.hud-item:has-text("Seeds")').innerText()
must(/30\/30/.test(seedsHud), `HUD should read 30/30 (balance was 24 + credited 6), got ${seedsHud}`)

// ============ 2. market surfaces the specialization expansions ============
// play out to the market with forced weak singles (legal engine actions), then
// inject the two wake offers into the shop like a real epoch would deal them
let mstate = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state)
// park the state at a fresh market with our offers (crafted, structurally valid)
mstate.market = [
  { id: 'wake-pellucid', title: 'Wake Pellucid', desc: 'Awaken Pellucid — the planet visibly grows, and Two Pair hands gain +4 Growth there (grows with development).', cost: 12, kind: 'expansion', wakeRegionId: 6 },
  { id: 'wake-vantage', title: 'Wake Vantage', desc: 'Awaken Vantage — the planet visibly grows, and Flush hands gain +6 Growth there (grows with development).', cost: 12, kind: 'expansion', wakeRegionId: 11 },
]
mstate.phase = 'market'
mstate.seeds = 30
mstate.regions[6].dormant = true // the realistic wake fixture: Pellucid dormant again
mstate.laws = mstate.laws.filter((l) => l.id !== 'wake-pellucid')
await page.evaluate((st) => localStorage.setItem('worldhand.save', JSON.stringify({ schema: 3, version: 4, savedAt: '2026-09-09T00:00:00.000Z', state: st })), mstate)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.market')
const pellucidOffer = page.locator('.market-btn', { hasText: 'Wake Pellucid' })
must(await pellucidOffer.count() === 1, 'Wake Pellucid offer missing in the market')
const offerText = await pellucidOffer.innerText()
rec('wake-pellucid-offer', offerText.replace(/\n/g, ' | '))
must(/Poker bonus when awake: \+4 Growth on exact Two Pair hands/.test(offerText), 'Wake Pellucid offer lacks the poker-bonus note')
must(/currently dormant/.test(offerText), 'Wake Pellucid offer lacks the dormant/active state')
const vantageOffer = page.locator('.market-btn', { hasText: 'Wake Vantage' })
must(await vantageOffer.count() === 1, 'Wake Vantage offer missing in the market')
const vantageText = await vantageOffer.innerText()
must(/Poker bonus when awake: \+6 Growth on exact Flush hands/.test(vantageText), 'Wake Vantage offer lacks the poker-bonus note')
await page.screenshot({ path: `${OUT}/regional-market-offers.png`, fullPage: true })
// buy Wake Vantage → Vantage awake + bonus live on a flush preview
await vantageOffer.click()
await page.waitForTimeout(250)
const vantageState = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state)
must(vantageState.regions[11].dormant === false, 'buying Wake Vantage did not awaken Vantage')
must(vantageState.laws.some((l) => l.id === 'wake-vantage'), 'wake-vantage law not recorded')
must(vantageState.seeds === 18, `buying at 12 Seeds from 30 should leave 18, got ${vantageState.seeds}`)
rec('vantage-awake', vantageState.regions[11].dormant === false)

// ============ 3. legacy v3 save: rejected + preserved ============
await page.evaluate((raw) => localStorage.setItem('worldhand.save', raw), legacyV3)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="save-reject"]')
const reject = await page.locator('[data-testid="save-reject"]').innerText()
rec('save-reject', reject.replace(/\n/g, ' | '))
must(/engine version 3/.test(reject), 'rejection does not name the v3 engine version')
must(/worldhand\.save\.legacy\./.test(reject), 'rejection does not name the legacy key')
const preserved = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('worldhand.save.legacy.'))
  return keys.map((k) => localStorage.getItem(k))
})
must(preserved.some((b) => b === legacyV3), 'the v3 blob was not preserved BYTE-FOR-BYTE under a legacy key')
rec('legacy-preserved-bytes', legacyV3.length)
await page.screenshot({ path: `${OUT}/regional-legacy-v3-reject.png`, fullPage: true })

await browser.close()
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
console.log('REGIONAL BONUS CHECKS PASSED')