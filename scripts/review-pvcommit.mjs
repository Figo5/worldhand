// Preview == commit check at UI level, comparing the summary effect amount (not "+N pts").
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://127.0.0.1:5177', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.clear())
await p.reload({ waitUntil: 'networkidle' })
await p.fill('#seed', 'pv-commit-ui')
await p.click('text=Begin New World')
await p.waitForSelector('.pcard-btn')
await p.locator('.pcard-btn').first().click()
await p.locator('.pcard-btn').nth(1).click()
const preview = await p.locator('[data-testid="preview"]').innerText()
// suit action names are gone: the play is a plain poker hand — match the
// "Banks +N Growth" hero-number line instead of a suit-action name
const summaryAmt = preview.match(/Banks (\d+) Growth/)
const amt = summaryAmt?.[1]
console.log('preview:', preview.replace(/\n/g, ' | '))
console.log('extracted-amount:', amt)
await p.locator('[data-testid="play-btn"]').click()
await p.waitForTimeout(150)
await p.waitForTimeout(100) // autosave checkpoint
const logTop = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state.log.slice(-1)[0].text)
console.log('commit-log:', logTop)
console.log('MATCH:', amt ? logTop.includes(`Banks ${amt} Growth`) : false)
// also verify category and suit strings match
const pvCat = preview.match(/(High Card|Pair|Two Pair|Three of a Kind|Straight|Flush|Full House|Four of a Kind|Straight Flush)/)?.[1]
console.log('category-match:', logTop.includes(pvCat ?? '§'))
await b.close()