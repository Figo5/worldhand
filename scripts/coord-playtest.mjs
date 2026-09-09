// Coordinator ordinary-playtest harness: drives ONE complete run in the live
// app WITHOUT any debug currency, forced cards, or edited saves. Plays real
// poker (select best 1-5 cards, discard weak hands), shops, and records every
// decision + the outcome. For the coordinator's (Luna/deepseek) playtest log.
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5177'
const SEED = process.env.SEED || 'coord-playtest-1'

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

// --- helpers ---
const log = (msg) => console.log(msg)
const phase = () => p.evaluate(() => document.querySelector('.market') ? 'market'
  : document.querySelector('.verdict') ? 'verdict'
    : document.querySelectorAll('.pcard-btn').length ? 'select' : 'unknown')
const hud = () => p.evaluate(() => [...document.querySelectorAll('.hud-item')].map(h => h.innerText.trim()).join(' | '))

// pick the best hand from the current 8 by trying all 1-5 subsets locally? No —
// that would be "evaluating". Instead pick a simple human heuristic: prefer
// matching ranks (pairs) first, then suited (flush potential), then high cards.
function chooseHand(texts) {
  // texts: array of card string like "10♠" or "A♥"
  const rankOf = (t) => { const m = t.match(/^(10|[2-9]|J|Q|K|A)/); return m?.[1] ?? t[0] }
  const suitOf = (t) => t.match(/[♠♥♦♣]/)?.[0] ?? ''
  // count ranks
  const rankCount = {}
  for (const t of texts) { const r = rankOf(t); rankCount[r] = (rankCount[r]||0)+1 }
  // prefer pairs: any rank appearing >=2
  const pairRanks = Object.entries(rankCount).filter(([,c]) => c >= 2).map(([r]) => r)
  // choose up to 5: first fill pairs, else highest singles
  const sel = []
  for (const r of pairRanks) {
    const idx = texts.map((t,i)=>[t,i]).filter(([t])=>rankOf(t)===r).map(([,i])=>i)
    for (const i of idx) if (sel.length < 5) sel.push(i)
  }
  // fill with highest ranks (A,K,Q,J,10...) not already chosen
  const order = ['A','K','Q','J','10','9','8','7','6','5','4','3','2']
  for (const r of order) {
    if (sel.length >= 5) break
    for (let i=0;i<texts.length;i++) if (!sel.includes(i) && rankOf(texts[i])===r) { sel.push(i); break }
  }
  return sel.slice(0,5)
}

// --- main ---
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.fill('#seed', SEED)
await p.click('text=Begin New World')
await p.waitForSelector('.pcard-btn')
log('HUD start: ' + await hud())

const decisions = []
let playsTotal = 0, discards = 0, buys = 0
for (let g = 0; g < 500; g++) {
  const ph = await phase()
  if (ph === 'verdict') { log('VERDICT: ' + await p.evaluate(() => document.querySelector('.verdict')?.innerText?.replace(/\n/g,' | ') ?? '?')); break }
  if (ph === 'select') {
    // read hand texts
    const texts = await p.evaluate(() => [...document.querySelectorAll('.pcard-btn')].map(c => c.innerText.replace(/\n/g,'').trim()))
    const sel = chooseHand(texts)
    if (sel.length === 0) { log('EMPTY HAND'); break }
    for (const i of sel) { await p.locator('.pcard-btn').nth(i).click(); await p.waitForTimeout(30) }
    // read preview (growth + chips x mult + breakdown) before playing
    const preview = await p.evaluate(() => document.querySelector('[data-testid="preview"], .preview')?.innerText?.replace(/\n/g,' ') ?? '')
    playsTotal++
    decisions.push(`P${playsTotal} sel=[${sel.map(i=>texts[i]).join(',')}] ${preview}`)
    await p.locator('[data-testid="play-btn"]').click(); await p.waitForTimeout(80)
    continue
  }
  if (ph === 'market') {
    // buy up to 2 items (human: grab a growth upgrade or law if affordable)
    const buyBtns = p.locator('.market-btn:not([disabled])')
    const n = await buyBtns.count()
    let bought = 0
    for (let i = 0; i < n && bought < 2; i++) {
      const afford = await buyBtns.nth(i).isEnabled()
      if (afford) { await buyBtns.nth(i).click().catch(()=>{}); bought++; buys++; decisions.push(`BUY#${buys} (item ${i})`); await p.waitForTimeout(40) }
    }
    await p.click('button:has-text("Continue")'); await p.waitForTimeout(80)
    continue
  }
  if (ph === 'unknown') { // epoch-end
    const close = p.locator('button:has-text("Close")')
    if (await close.count()) { await close.first().click(); await p.waitForTimeout(80); continue }
    const cont = p.locator('button:has-text("Continue")')
    if (await cont.count()) { await cont.click(); await p.waitForTimeout(80); continue }
    break
  }
  break
}
log('plays: ' + playsTotal + ' | buys: ' + buys)
log('--- DECISIONS ---')
for (const d of decisions) log(d)
log('--- ERRORS ---')
log(JSON.stringify(errs))
await p.screenshot({ path: 'shots-review/coord-playtest-final.png', fullPage: true })
await b.close()
