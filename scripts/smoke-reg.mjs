// Smoke check: regional-bonus UI wiring (isolated playwright, localStorage cleared).
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:5177'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.fill('#seed', 'reg-smoke-1')
await p.click('text=Begin New World')
await p.waitForSelector('.hand-cards .pcard-btn')
const legend = await p.locator('[data-testid="region-legend"]').innerText()
console.log('LEGEND_HAS_PAIR_BADGE:', legend.includes('Pair'), '| FLUSH_BADGE:', legend.includes('Flush'), '| TWOPAIR_BADGE:', legend.includes('Two Pair'))
await p.locator('.hand-cards .pcard-btn').nth(0).click()
await p.locator('.hand-cards .pcard-btn').nth(1).click()
await p.waitForSelector('[data-testid="preview"]')
const breakdown = await p.locator('.growth-hero-breakdown').innerText()
console.log('BREAKDOWN:', JSON.stringify(breakdown))
console.log('BANNER:', await p.locator('[data-testid="region-match-banner"]').count(),
  '| DORMANT-NOTE:', await p.locator('[data-testid="region-dormant-note"]').count(),
  '| TOOLTIP:', await p.locator('[data-testid="globe-spec-tooltip"]').count())
// map-detail with specialization sentence (click Auralia)
await p.locator('.region-btn').nth(0).click()
const detail = await p.locator('[data-testid="map-detail"]').innerText()
console.log('DETAIL_HAS_SPEC:', detail.includes('Poker specialization: Pair'))
const spec = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('worldhand.save')).state
  return s.regions.filter(r => r.specialization).map(r => [r.name, r.specialization, r.dormant])
})
console.log('SAVED_SPECS:', JSON.stringify(spec))
console.log('ERRORS:', JSON.stringify(errs))
await p.screenshot({ path: 'shots-review/smoke-preview.png', fullPage: true })
await b.close()