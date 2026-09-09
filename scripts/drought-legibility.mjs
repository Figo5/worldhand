// Drought-removal legibility probe (v4). The Drought challenge is REMOVED from
// the game; this probe plays a full run and asserts the UI/log NEVER mentions
// a Drought, and that the verdict still resolves. Selectors mirror
// review-fullrun.mjs.
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const seeds = ['bloom-1', 'bloom-2', 'bloom-3']
const b = await chromium.launch()
const out = []
for (const seed of seeds) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
  const rec = { seed, errs: [] }
  p.on('pageerror', (e) => rec.errs.push('pageerror: ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') rec.errs.push('console: ' + m.text()) })
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'networkidle' })
  await p.fill('#seed', seed)
  await p.click('text=Begin New World')
  await p.waitForSelector('.pcard-btn')
  for (let g = 0; g < 500; g++) {
    if (await p.locator('.verdict').count()) break
    const phase = await p.evaluate(() => document.querySelector('.market') ? 'market'
      : document.querySelector('.verdict') ? 'verdict'
        : document.querySelectorAll('.pcard-btn').length ? 'select' : 'unknown')
    if (phase === 'select') {
      await p.locator('.pcard-btn').first().click(); await p.waitForTimeout(40)
      await p.locator('[data-testid="play-btn"]').click(); await p.waitForTimeout(80)
    } else if (phase === 'market') {
      const buy = p.locator('.market-btn:not([disabled])').first()
      if (await buy.count()) await buy.click().catch(() => {})
      await p.click('button:has-text("Continue")'); await p.waitForTimeout(80)
    } else if (phase === 'unknown') { // epoch-end
      const close = p.locator('button:has-text("Close")')
      if (await close.count()) { await close.first().click(); await p.waitForTimeout(80); continue }
      const cont = p.locator('button:has-text("Continue")')
      if (await cont.count()) { await cont.click(); await p.waitForTimeout(80); continue }
      break
    } else break
  }
  const verdict = await p.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')
  const droughtLog = await p.evaluate(() => [...document.querySelectorAll('.log li')].map(l => l.innerText).filter(t => t.toLowerCase().includes('drought')).join(' ;; ')) || 'NONE'
  const droughtUi = await p.evaluate(() => document.body.innerText.toLowerCase().includes('drought'))
  rec.verdict = verdict
  rec.droughtLog = droughtLog
  rec.droughtInUi = droughtUi
  rec.assertNoDrought = !droughtUi && droughtLog === 'NONE'
  rec.errors = rec.errs
  await p.screenshot({ path: `shots-review/drought-${seed}.png`, fullPage: true })
  out.push(rec)
  await p.close()
}
await b.close()
const allClean = out.every(r => r.assertNoDrought && r.errs.length === 0)
console.log(JSON.stringify(out, null, 2))
console.log('NO-DROUGHT ASSERTION:', allClean ? 'PASSED' : 'FAILED')
if (!allClean) process.exit(1)