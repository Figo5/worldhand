// Capture the narrow-viewport preview-match shot (banner + tooltip + globe rings).
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { newGame } from '../src/engine/worldhand.ts'
const BASE = 'http://127.0.0.1:5177'
mkdirSync('shots-review', { recursive: true })
const twoPairState = (() => {
  const s = newGame('reg-ui-proof')
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
  const displaced = s.hand.slice(0, 4)
  s.hand = [...pair, ...s.hand.slice(4)]
  s.deckRest.push(...displaced)
  return s
})()
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 480, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate((env) => localStorage.setItem('worldhand.save', env), JSON.stringify({ schema: 3, version: 4, savedAt: '2026-09-09T00:00:00.000Z', state: twoPairState }))
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForSelector('.hand-cards .pcard-btn')
for (const i of [0, 1, 2, 3]) await p.locator('.hand-cards .pcard-btn').nth(i).click()
await p.waitForSelector('[data-testid="region-match-banner"]')
await p.screenshot({ path: 'shots-review/regional-preview-match-narrow.png', fullPage: true })
console.log('narrow shot captured; errors:', JSON.stringify(errs))
await b.close()
if (errs.length) throw new Error('errors: ' + errs.join('|'))