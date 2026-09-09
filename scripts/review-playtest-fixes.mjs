// Review script for the playtest-defect fixes (Fix 2 + Fix 3, UI-level):
// 1. Truthful Seed credit in the REAL UI: a crafted valid save (seeds 24, a
//    two-pair hand = nominal 16) shows `Gains 16 Seeds (Credited 6; overflow 10)`
//    in the preview, and after the play the HUD reads 30/30 and the chronicle
//    carries the identical clause (preview == commit == log).
// 2. Final-epoch flow: a crafted valid save parked at `epoch-end` on epoch 3
//    offers "View Results" (never "begin epoch 4") and clicking it lands on the
//    verdict panel directly.
// 3. Reload safety: reloading a finished run shows the same verdict with an
//    unchanged save (no duplicated reward/deduction).
// Runs against an ISOLATED playwright browser profile — the user's real
// localStorage save is never touched. Screenshots land in shots-review/.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { newGame, SEEDS_CAP, TOTAL_EPOCHS, EPOCH_TARGETS } from '../src/engine/worldhand.ts'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const rec = (k, v) => console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)

// ---- crafted, structurally valid saves (pass validateState by construction) --
// Fix 2: seeds 24, hand holds a REAL two pair (two 9s + two 7s pulled from the
// deckRest pool; the displaced hand cards return to the pool) → chips 32 × 2 =
// 64 Growth = nominal ceil(64/4) = 16 Seeds
const creditState = (() => {
  const s = newGame('fix2-ui-proof')
  s.seeds = 24
  const take = (rank, n) => {
    const out = []
    for (let i = s.deckRest.length - 1; i >= 0 && out.length < n; i--) {
      if (s.deckRest[i].r === rank) out.push(...s.deckRest.splice(i, 1))
    }
    return out
  }
  const pair = [...take(9, 2), ...take(7, 2)]
  if (pair.length !== 4) throw new Error('could not assemble a real two pair from the deck')
  const displaced = s.hand.slice(0, 4)
  s.hand = [...pair, ...s.hand.slice(4)]
  s.deckRest.push(...displaced) // conservation stays exactly 52, all real cards
  return s
})()
// Fix 3: a legacy `epoch-end` state parked at the FINAL epoch, comfortably winning
const finalEpochState = (() => {
  const s = newGame('fix3-ui-proof')
  s.epoch = TOTAL_EPOCHS
  s.phase = 'epoch-end'
  s.flourishing = EPOCH_TARGETS[TOTAL_EPOCHS - 1].need + 140
  s.lives = 3
  return s
})()
const envelope = (state) => JSON.stringify({
  schema: 3, version: 4, savedAt: '2026-09-09T00:00:00.000Z', state,
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// ---------------- Fix 2: truthful Seed credit in preview → commit → log ------
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate((env) => localStorage.setItem('worldhand.save', env), envelope(creditState))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.hand-cards .pcard-btn')
for (const i of [0, 1, 2, 3]) await page.locator('.hand-cards .pcard-btn').nth(i).click()
await page.waitForSelector('[data-testid="preview"]')
const pvText = await page.locator('[data-testid="preview"]').innerText()
rec('preview', pvText.replace(/\n/g, ' | '))
if (!/Gains 16 Seeds/.test(pvText)) throw new Error('preview missing nominal "Gains 16 Seeds"')
if (!/\(Credited 6; overflow 10\)/.test(pvText)) throw new Error(`preview missing truthful clause: ${pvText}`)
await page.screenshot({ path: `${OUT}/fix2-seed-credit-preview.png`, fullPage: true })

await page.locator('[data-testid="play-btn"]').click()
await page.waitForTimeout(250)
const seedsHud = await page.locator('.hud-item:has-text("Seeds")').innerText()
rec('seeds-hud-after-play', seedsHud.replace(/\n/g, ' '))
if (!/30\/30/.test(seedsHud)) throw new Error(`HUD should read 30/30 after the credited play, got ${seedsHud}`)
const logTexts = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.innerText))
const played = logTexts.find((t) => t.includes('Played Two Pair'))
rec('chronicle-played', played ?? 'NONE')
if (!played || !/\(Credited 6; overflow 10\)/.test(played)) throw new Error('chronicle missing the truthful clause')
// preview and chronicle carry the IDENTICAL summary text
const pvSummary = pvText.split('\n').find((l) => l.startsWith('Banks'))
if (!played.includes(pvSummary.trim())) throw new Error(`chronicle does not echo the preview summary verbatim:\n  pv: ${pvSummary}\n  log: ${played}`)

// ---------------- Fix 3: final-epoch results transition (no epoch 4) ---------
await page.evaluate((env) => localStorage.setItem('worldhand.save', env), envelope(finalEpochState))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="epoch-end"]')
const endText = await page.locator('[data-testid="epoch-end"]').innerText()
rec('epoch-end-panel', endText.replace(/\n/g, ' | '))
if (/begin epoch 4/.test(endText)) throw new Error('UI advertises a nonexistent epoch 4')
const resultsBtn = page.locator('[data-testid="view-results-btn"]')
if (!(await resultsBtn.count())) throw new Error('final-epoch results button missing')
if (!/View Results/.test(await resultsBtn.innerText())) throw new Error('button is not named "View Results"')
await page.screenshot({ path: `${OUT}/fix3-final-epoch-results.png`, fullPage: true })
await resultsBtn.click()
await page.waitForSelector('.verdict')
const verdict = await page.locator('.verdict').innerText()
rec('verdict', verdict.replace(/\n/g, ' | '))
if (!/A Flourishing World/.test(verdict)) throw new Error('final-epoch "View Results" did not land on the win verdict')

// ---------------- reload cannot duplicate rewards / deductions ----------------
const savedBefore = await page.evaluate(() => localStorage.getItem('worldhand.save'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.verdict')
const verdictAfter = await page.locator('.verdict').innerText()
if (!/A Flourishing World/.test(verdictAfter)) throw new Error('verdict lost after reload')
const savedAfter = await page.evaluate(() => localStorage.getItem('worldhand.save'))
// the envelope's savedAt is refreshed by the auto-save on load — the RUN STATE
// itself must be identical (no duplicated reward, no second deduction)
const stateBefore = JSON.stringify(JSON.parse(savedBefore).state)
const stateAfter = JSON.stringify(JSON.parse(savedAfter).state)
rec('run-state-unchanged-after-reload', stateBefore === stateAfter)
if (stateBefore !== stateAfter) {
  throw new Error(`the finished-run STATE changed across a reload:\nbefore: ${stateBefore.slice(0, 300)}\nafter: ${stateAfter.slice(0, 300)}`)
}
const st = JSON.parse(savedAfter).state
rec('final-state', { seeds: st.seeds, lives: st.lives, flourishing: st.flourishing, phase: st.phase, outcome: st.outcome })
await page.screenshot({ path: `${OUT}/fix3-verdict-after-reload.png`, fullPage: true })

// narrow-viewport evidence for both fixes
const narrow = await browser.newPage({ viewport: { width: 480, height: 800 } })
narrow.on('pageerror', (e) => errors.push('[narrow] pageerror: ' + e.message))
narrow.on('console', (m) => { if (m.type() === 'error') errors.push('[narrow] console: ' + m.text()) })
await narrow.goto(BASE, { waitUntil: 'networkidle' })
await narrow.evaluate((env) => localStorage.setItem('worldhand.save', env), envelope(creditState))
await narrow.goto(BASE, { waitUntil: 'networkidle' })
await narrow.waitForSelector('.hand-cards .pcard-btn')
for (const i of [0, 1, 2, 3]) await narrow.locator('.hand-cards .pcard-btn').nth(i).click()
await narrow.waitForSelector('[data-testid="preview"]')
const pvNarrow = await narrow.locator('[data-testid="preview"]').innerText()
if (!/\(Credited 6; overflow 10\)/.test(pvNarrow)) throw new Error('truthful clause missing at 480px')
const overflowNarrow = await narrow.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
if (overflowNarrow) throw new Error('horizontal overflow at 480px with the truthful clause')
await narrow.screenshot({ path: `${OUT}/fix2-seed-credit-narrow.png`, fullPage: true })
await narrow.close()

await browser.close()
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
console.log(`SEED_CAP=${SEEDS_CAP} — PLAYTEST-FIX CHECKS PASSED (truthful credit, final-epoch results, reload-inert)`)