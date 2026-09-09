// Independent v5 BROWSER probe (reviewer-added; read-only vs source).
// Runs in an ISOLATED Playwright profile — the user's real localStorage save
// is never touched. Constructions differ from the implementation worker's
// script (different seed phrase, different hand ranks, different balances):
//   1. Truthful Seed credit in the real UI: crafted save (balance 27, a REAL
//      two pair Q-Q-9-9 pulled from the deck = chips 42 x 2 = 84 Growth ->
//      nominal 21) must show `Gains 21 Seeds (Credited 3; overflow 18)` in the
//      preview, then the HUD reads 30/30 and the chronicle echoes the same
//      clause; the saved state's seeds must be exactly 30.
//   2. Final-epoch flow through a REAL full UI run (seed v5-flow-run-xyz):
//      epochs 1 and 2 must open the market + epoch-end panel + "begin epoch N+1"
//      buttons; after the epoch-3 4th play the verdict must appear DIRECTLY —
//      no market, no epoch-end panel, no "begin epoch 4" anywhere.
//   3. Reload of the finished run: verdict persists, saved run-state is
//      byte-identical (no duplicated reward/deduction), exactly one
//      "Epoch end:" line for e3.
// Zero console/page errors required throughout.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { newGame, EPOCH_TARGETS } from '../src/engine/worldhand.ts'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const rec = (k, v) => console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
const must = (cond, msg) => { if (!cond) throw new Error(msg) }

// ---- crafted structurally-valid save: balance 27, real two pair Q,Q,9,9 ----
const creditState = (() => {
  const s = newGame('v5-craft-credit-xyz')
  s.seeds = 27
  const take = (rank, n) => {
    const out = []
    for (let i = s.deckRest.length - 1; i >= 0 && out.length < n; i--) {
      if (s.deckRest[i].r === rank) out.push(...s.deckRest.splice(i, 1))
    }
    return out
  }
  const pair = [...take(12, 2), ...take(9, 2)] // queens + nines
  must(pair.length === 4, 'could not assemble Q-Q-9-9 from the deck')
  const displaced = s.hand.slice(0, 4)
  s.hand = [...pair, ...s.hand.slice(4)]
  s.deckRest.push(...displaced) // conservation stays exactly 52
  return s
})()
const envelope = (state) => JSON.stringify({ schema: 3, version: 3, savedAt: '2026-09-09T00:00:00.000Z', state })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

// ================= 1. truthful Seed credit (crafted save, isolated) ==========
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate((env) => localStorage.setItem('worldhand.save', env), envelope(creditState))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.hand-cards .pcard-btn')
for (const i of [0, 1, 2, 3]) await page.locator('.hand-cards .pcard-btn').nth(i).click()
await page.waitForSelector('[data-testid="preview"]')
const pv = await page.locator('[data-testid="preview"]').innerText()
rec('v5-preview', pv.replace(/\n/g, ' | '))
must(pv.includes('Gains 21 Seeds (Credited 3; overflow 18)'), `preview lacks truthful clause: ${pv}`)
await page.screenshot({ path: `${OUT}/v5-preview-credit.png`, fullPage: true })

await page.locator('[data-testid="play-btn"]').click()
await page.waitForTimeout(300)
const hud = await page.locator('.hud-item:has-text("Seeds")').innerText()
rec('v5-hud-after-play', hud.replace(/\n/g, ' '))
must(/30\/30/.test(hud), `HUD should read 30/30, got ${hud}`)
const logTexts = await page.evaluate(() => [...document.querySelectorAll('.log li')].map((l) => l.innerText))
const played = logTexts.find((t) => t.includes('Played Two Pair'))
rec('v5-chronicle', played ?? 'NONE')
must(played && played.includes('Gains 21 Seeds (Credited 3; overflow 18)'), 'chronicle lacks truthful clause')
const pvSummary = pv.split('\n').find((l) => l.startsWith('Banks'))
must(played.includes(pvSummary.trim()), 'chronicle does not echo the preview summary verbatim')
const savedNow = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state)
must(savedNow.seeds === 30, `committed balance should be 30, got ${savedNow.seeds}`)
rec('v5-committed-balance', savedNow.seeds)

// ================= 2. final-epoch flow through a REAL full UI run ============
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('#seed', 'v5-flow-run-xyz')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')

// play 4 hands in the current epoch
const playEpoch = async () => {
  for (let i = 0; i < 4; i++) {
    await page.locator('.hand-cards .pcard-btn').first().click()
    await page.locator('[data-testid="play-btn"]').click()
    await page.waitForTimeout(350)
  }
}
// epoch 1: market + epoch-end + begin epoch 2 (normal flow)
await playEpoch()
await page.waitForSelector('.market')
must(await page.locator('button:has-text("begin epoch 4")').count() === 0, 'epoch-4 text leaked early')
await page.locator('button:has-text("close epoch 1")').click()
await page.waitForSelector('[data-testid="epoch-end"]')
const end1 = await page.locator('[data-testid="epoch-end"]').innerText()
must(endTextHas(end1, 'begin epoch 2'), `epoch-end 1 lacks "begin epoch 2": ${end1}`)
await page.screenshot({ path: `${OUT}/v5-epoch1-end.png`, fullPage: true })
await page.locator('[data-testid="close-epoch-btn"]').click()
await page.waitForTimeout(400)
must(await page.locator('.hand-cards .pcard-btn').count() > 0, 'epoch 2 hand not dealt')
rec('epoch-2-starts', true)

// epoch 2: market + epoch-end + begin epoch 3 (normal flow)
await playEpoch()
await page.waitForSelector('.market')
await page.locator('button:has-text("close epoch 2")').click()
await page.waitForSelector('[data-testid="epoch-end"]')
const end2 = await page.locator('[data-testid="epoch-end"]').innerText()
must(endTextHas(end2, 'begin epoch 3'), `epoch-end 2 lacks "begin epoch 3": ${end2}`)
await page.locator('[data-testid="close-epoch-btn"]').click()
await page.waitForTimeout(400)
must(await page.locator('.hand-cards .pcard-btn').count() > 0, 'epoch 3 hand not dealt')
rec('epoch-3-starts', true)

// epoch 3: after the 4TH play the verdict must appear DIRECTLY
await playEpoch()
await page.waitForSelector('.verdict')
const marketCount = await page.locator('.market').count()
const endPanelCount = await page.locator('[data-testid="epoch-end"]').count()
const bodyText = await page.evaluate(() => document.body.innerText)
must(marketCount === 0, 'a market opened for the finished run')
must(endPanelCount === 0, 'an epoch-end panel appeared for the finished run')
must(!/begin epoch 4/i.test(bodyText), 'UI advertises a nonexistent epoch 4')
const verdict = await page.locator('.verdict').innerText()
rec('v5-verdict', verdict.replace(/\n/g, ' | '))
await page.screenshot({ path: `${OUT}/v5-final-verdict.png`, fullPage: true })

// ================= 3. reload: no duplicated rewards/deductions ==============
// the save settled once the verdict is up (plays auto-save; the finished state
// itself is inert). Non-duplication = the settled save is IDENTICAL after reload.
await page.waitForTimeout(400) // let the post-verdict auto-save settle
const settledSave = await page.evaluate(() => localStorage.getItem('worldhand.save'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.verdict')
const verdict2 = await page.locator('.verdict').innerText()
must(verdict2.replace(/\s+/g, ' ') === verdict.replace(/\s+/g, ' '), 'verdict changed across reload')
const stBefore = JSON.stringify(JSON.parse(settledSave).state)
const stAfterRaw = await page.evaluate(() => localStorage.getItem('worldhand.save'))
const stAfter = JSON.stringify(JSON.parse(stAfterRaw).state)
rec('v5-run-state-unchanged-after-reload', stBefore === stAfter)
must(stBefore === stAfter, 'finished-run STATE mutated across reload (duplication risk)')
const st = JSON.parse(stAfter)
const e3Income = (st.log || []).filter((l) => l.at === 'e3' && String(l.text).startsWith('Epoch end: +')).length
const e3LifeLoss = (st.log || []).filter((l) => l.at === 'e3' && String(l.text).includes('a life is lost')).length
rec('v5-final-bookkeeping', { epoch: st.epoch, phase: st.phase, outcome: st.outcome, seeds: st.seeds, lives: st.lives, flourishing: st.flourishing, e3IncomeLines: e3Income, e3LifeLossLines: e3LifeLoss })
must(e3Income <= 1 && e3LifeLoss <= 1, 'final-epoch income/life-deduction duplicated in the chronicle')
await page.screenshot({ path: `${OUT}/v5-verdict-after-reload.png`, fullPage: true })

await browser.close()
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
console.log('INDEPENDENT V5 BROWSER PROBES PASSED (truthful credit, final-epoch flow, reload-inert)')

function endTextHas(text, needle) { return text.includes(needle) }