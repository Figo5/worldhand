// Drought legibility probe (v3, working selectors from review-fullrun.mjs).
// For 3 seeds: play a Bloom-heavy path to epoch 3, capture the EXACT text the
// UI shows about (a) the Drought and (b) Bloom's cost of waking a region, at
// the moment of decision AND at the epoch-3 reveal.
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const seeds = ['bloom-1', 'bloom-2', 'bloom-3']
const b = await chromium.launch()
const out = []
for (const seed of seeds) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  const rec = { seed, texts: [], errs: [] }
  p.on('pageerror', (e) => rec.errs.push('pageerror: ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') rec.errs.push('console: ' + m.text()) })
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'networkidle' })
  await p.fill('#seed', seed)
  await p.click('text=Begin New World')
  await p.waitForSelector('.pcard-btn')

  const hud = () => p.evaluate(() => document.querySelector('.hud, header, .topbar')?.innerText?.replace(/\n/g, ' · ') ?? 'NO_HUD')
  let reachedE3 = false
  for (let g = 0; g < 500; g++) {
    if (await p.locator('.verdict').count()) break
    const phase = await p.evaluate(() => document.querySelector('.market') ? 'market'
      : document.querySelector('.verdict') ? 'verdict'
        : document.querySelectorAll('.pcard-btn').length ? 'select' : 'unknown')
    if (phase === 'select') {
      // Prefer Bloom: a heart card, else any Q/A/K (wake drivers), else first card.
      const cards = p.locator('.pcard-btn')
      const n = await cards.count()
      let idx = 0, found = -1
      for (let i = 0; i < n; i++) {
        const t = (await cards.nth(i).innerText()) || ''
        if (t.includes('♥')) { found = i; break }
      }
      if (found < 0) for (let i = 0; i < n; i++) {
        const t = (await cards.nth(i).innerText()) || ''
        if (/[QKA]/.test(t)) { found = i; break }
      }
      idx = found < 0 ? 0 : found
      await cards.nth(idx).click(); await p.waitForTimeout(40)
      // Capture the preview BEFORE this play (does it say the wake cost?).
      const pv = await p.evaluate(() => document.querySelector('.preview, [data-testid="preview"]')?.innerText?.replace(/\n/g, ' ') ?? 'NO_PREVIEW')
      if (g % 1 === 0 && (pv.includes('wakes') || /Q|K|A/.test((await cards.nth(idx).innerText()) || ''))) {
        rec.texts.push(`PREVIEW(play ${g}): ${pv.slice(0, 260)}`)
        rec.texts.push(`  HUD: ${await hud()}`)
      }
      await p.locator('[data-testid="play-btn"]').click(); await p.waitForTimeout(80)
    } else if (phase === 'market') {
      const buy = p.locator('.market-btn:not([disabled])').first()
      if (await buy.count()) await buy.click().catch(() => {})
      await p.click('button:has-text("Continue")'); await p.waitForTimeout(80)
    } else if (phase === 'unknown') { // epoch-end
      if (!(rec.texts.some((t) => t.startsWith('EPOCH-END')))) {
        const epoch = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null')?.state?.epoch)
        rec.texts.push(`EPOCH-END(epoch ${epoch}): ${await hud()}`)
      }
      const close = p.locator('button:has-text("Close")')
      if (await close.count()) { await close.first().click(); await p.waitForTimeout(80); continue }
      const cont = p.locator('button:has-text("Continue")')
      if (await cont.count()) { await cont.click(); await p.waitForTimeout(80); continue }
      break
    } else break
    // Did we enter epoch 3 with the Drought visible?
    if (await p.locator('.hud-item').count()) {
      const hudTxt = (await hud()).toLowerCase()
      if (hudTxt.includes('drought')) { reachedE3 = true; rec.texts.push(`DROUGHT-ACTIVE: ${await hud()}`); }
    }
  }
  const verdict = await p.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')
  const droughtLog = await p.evaluate(() => [...document.querySelectorAll('.log li')].map(l => l.innerText).filter(t => t.toLowerCase().includes('drought')).join(' ;; ')) || 'NONE'
  rec.texts.push(reachedE3 ? 'REACHED-EPOCH-3-DROUGHT' : `DID-NOT-REACH-E3. ${droughtLog.slice(0, 200)}`)
  rec.texts.push(`VERDICT: ${verdict}`)
  rec.texts.push(`DROUGHT-LOG: ${droughtLog.slice(0, 400)}`)
  rec.texts.push(`ERRORS: ${JSON.stringify(rec.errs)}`)
  await p.screenshot({ path: `shots-review/drought-${seed}.png`, fullPage: true })
  out.push(rec)
  await p.close()
}
await b.close()
console.log(JSON.stringify(out, null, 2))
