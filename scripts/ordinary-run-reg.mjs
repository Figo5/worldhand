// ONE ordinary browser run — normal UI actions ONLY (no forced cards, no
// edited saves, no debug money, no mid-run rule changes). The player policy
// is "read every candidate preview and play the highest-Growth hand" —
// exactly what the UI surfaces (each selection's preview IS the UI preview;
// the engine import here only READS the live auto-saved state to enumerate
// candidates, it never writes or forces anything).
// Every play records: chosen cards, previewed breakdown, the argmax WITH the
// live regions, and the argmax WITHOUT them — so we can honestly report
// whether a regional bonus changed any card selection.
import { chromium } from 'playwright'
import { buildPlan } from '../src/engine/worldhand.ts'

const BASE = 'http://127.0.0.1:5177'
const SEED = 'regional-ordinary-1'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

const log = (m) => console.log(m)
const phase = () => p.evaluate(() => document.querySelector('.market') ? 'market'
  : document.querySelector('.verdict') ? 'verdict'
    : document.querySelector('[data-testid="epoch-end"]') ? 'epoch-end'
      : document.querySelectorAll('.pcard-btn').length ? 'select' : 'unknown')
const hud = () => p.evaluate(() => [...document.querySelectorAll('.hud-item')].map((h) => h.innerText.trim()).join(' | '))

let playsTotal = 0, discards = 0, buys = 0
const decisions = []
let bonusChangedSelections = 0

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.fill('#seed', SEED)
await p.click('text=Begin New World')
await p.waitForSelector('.hand-cards .pcard-btn')
log('HUD start: ' + await hud())

for (let g = 0; g < 500; g++) {
  const ph = await phase()
  if (ph === 'verdict') { log('VERDICT: ' + await p.evaluate(() => document.querySelector('.verdict')?.innerText?.replace(/\n/g, ' | ') ?? '?')); break }
  if (ph === 'select') {
    // read the live state (auto-saved by the app after every action) — READ ONLY
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state)
    const hand = st.hand
    // enumerate every legal 1-5 selection, score via the SHARED pipeline
    const subsets = []
    const n = hand.length
    for (let mask = 1; mask < (1 << n); mask++) {
      const sel = []
      for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(i)
      if (sel.length > 5) continue
      const withR = buildPlan(hand, sel, st.laws, st.regions)
      const noR = buildPlan(hand, sel, st.laws, st.regions.map((r) => ({ ...r, dormant: true })))
      subsets.push({ sel, g1: withR.growth, g0: noR.growth, cat: withR.categoryLabel })
    }
    const bestWith = subsets.reduce((a, b) => (b.g1 > a.g1 ? b : a))
    const bestWithout = subsets.reduce((a, b) => (b.g0 > a.g0 ? b : a))
    // the human choice: the argmax of the previews (what the UI would show)
    const chosen = bestWith
    for (const i of chosen.sel) { await p.locator('.hand-cards .pcard-btn').nth(i).click(); await p.waitForTimeout(25) }
    await p.waitForSelector('[data-testid="preview"]')
    const preview = await p.evaluate(() => document.querySelector('[data-testid="preview"]')?.innerText?.replace(/\n/g, ' ') ?? '')
    playsTotal++
    const bonusFlipped = bestWithout.sel.join(',') !== bestWith.sel.join(',')
    if (bonusFlipped) bonusChangedSelections++
    decisions.push(`P${playsTotal} e${st.epoch} chose=[${chosen.sel.map((i) => hand[i].r + hand[i].s).join(',')}] ${chosen.cat} G=${chosen.g1} (no-regions best would be [${bestWithout.sel.map((i) => hand[i].r + hand[i].s).join(',')}] ${subsets.find((x) => x.sel.join(',') === bestWithout.sel.join(','))?.cat} G=${bestWithout.g0}) ${bonusFlipped ? '<< BONUS CHANGED THE SELECTION' : ''} | ${preview}`)
    await p.locator('[data-testid="play-btn"]').click()
    await p.waitForTimeout(90)
    continue
  }
  if (ph === 'market') {
    // human-like shop: grab up to 2 affordable items in displayed order
    const buyBtns = p.locator('.market-btn:not([disabled])')
    const n = await buyBtns.count()
    let bought = 0
    for (let i = 0; i < n && bought < 2; i++) {
      try {
        if (await buyBtns.nth(i).isEnabled()) {
          const name = await buyBtns.nth(i).innerText()
          await buyBtns.nth(i).click()
          bought++; buys++
          decisions.push(`BUY#${buys} ${name.split('\n')[0]}`)
          await p.waitForTimeout(70)
        }
      } catch { /* re-render after a buy */ }
    }
    await p.click('button:has-text("Continue")')
    await p.waitForTimeout(90)
    continue
  }
  if (ph === 'epoch-end') {
    const btn = p.locator('[data-testid="close-epoch-btn"], [data-testid="view-results-btn"]')
    if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(90); continue }
    await p.click('button:has-text("Continue")')
    await p.waitForTimeout(90)
    continue
  }
  if (ph === 'unknown') {
    const cont = p.locator('button:has-text("Continue")')
    if (await cont.count()) { await cont.first().click(); await p.waitForTimeout(90); continue }
    break
  }
  break
}
log(`plays: ${playsTotal} | buys: ${buys} | discards: ${discards}`)
log('--- DECISIONS ---')
for (const d of decisions) log(d)
log(`BONUS-CHANGED-SELECTIONS: ${bonusChangedSelections} of ${playsTotal} plays`)
log('--- ERRORS ---')
log(JSON.stringify(errs))
await p.screenshot({ path: 'shots-review/ordinary-run-final.png', fullPage: true })
const finalState = await p.evaluate(() => { const env = JSON.parse(localStorage.getItem('worldhand.save')); return env.state })
log('FINAL: flourishing ' + finalState.flourishing + ' | lives ' + finalState.lives + ' | seeds ' + finalState.seeds + ' | outcome ' + finalState.outcome)
log('REGIONS AWAKE: ' + JSON.stringify(finalState.regions.filter((r) => !r.dormant && r.specialization).map((r) => [r.name, r.specialization, r.development])))
await b.close()
if (errs.length) throw new Error('page errors: ' + errs.join(' | '))