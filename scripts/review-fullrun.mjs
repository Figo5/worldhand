// Verify epoch-end panel + full 3-epoch run to verdict (fixed loop handles epoch-end UI).
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await p.goto('http://127.0.0.1:5177', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.fill('#seed', 'full-run-check')
await p.click('text=Begin New World')
await p.waitForSelector('.pcard-btn')

const logLine = (t) => console.log(t)
let marketSeen = false, epochEndSeen = false
let lastPhase = ''
for (let g = 0; g < 400; g++) {
  if (await p.locator('.verdict').count()) break
  const phase = await p.evaluate(() => document.querySelector('.market') ? 'market'
    : document.querySelector('.verdict') ? 'verdict'
    : document.querySelectorAll('.pcard-btn').length ? 'select'
    : 'unknown')
  if (phase !== lastPhase) { logLine(`phase: ${phase} (g=${g})`); lastPhase = phase }
  if (phase === 'select') {
    if (!(await p.locator('.pcard-btn.sel').count())) await p.locator('.pcard-btn').first().click()
    await p.locator('[data-testid="play-btn"]').click(); await p.waitForTimeout(60)
  } else if (phase === 'market') {
    marketSeen = true
    const buy = p.locator('.market-btn:not([disabled])').first()
    if (await buy.count()) await buy.click().catch(() => {})
    await p.click('button:has-text("Continue")'); await p.waitForTimeout(80)
  } else if (phase === 'unknown') {
    // epoch-end? capture UI once
    if (!epochEndSeen) {
      epochEndSeen = true
      logLine('unknown-phase-ui: ' + JSON.stringify(await p.evaluate(() => ({
        headings: [...document.querySelectorAll('main h2, main h3')].map(h => h.innerText),
        buttons: [...document.querySelectorAll('main button')].map(bt => bt.innerText.slice(0, 30)),
      }))))
    }
    const close = p.locator('button:has-text("Close")')
    if (await close.count()) { await close.first().click(); await p.waitForTimeout(80); continue }
    const cont = p.locator('button:has-text("Continue")')
    if (await cont.count()) { await cont.click(); await p.waitForTimeout(80); continue }
    break
  } else break
}
logLine('marketSeen: ' + marketSeen + ' epochEndSeen: ' + epochEndSeen)
logLine('verdict: ' + (await p.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')))
logLine('drought-log: ' + (await p.evaluate(() => [...document.querySelectorAll('.log li')].map(l => l.innerText).filter(t => t.includes('Drought')).join(' ;; ')) || 'NONE'))
logLine('epoch: ' + await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null')?.state?.epoch))
logLine('errors: ' + JSON.stringify(errs))
await p.screenshot({ path: 'shots-review/full-run-final.png', fullPage: true })
await b.close()