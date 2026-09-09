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
// suit action names updated for the one-action-per-suit contract
// (Study/Grow/Mine/Settle — formerly Roots/Bloom/Sow/Tend)
const summaryAmt = preview.match(/(Mine|Grow|Study|Settle)[^+]*\+(\d+)/)
console.log('preview:', preview.replace(/\n/g, ' | '))
console.log('extracted-amount:', summaryAmt?.[2])
await p.locator('[data-testid="play-btn"]').click()
await p.waitForTimeout(150)
await p.click('button:has-text("Save")'); await p.waitForTimeout(100)
const logTop = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save')).state.log.slice(-1)[0].text)
console.log('commit-log:', logTop)
console.log('MATCH:', summaryAmt ? logTop.includes('+' + summaryAmt[2]) : false)
// also verify category and suit strings match
const pvCat = preview.match(/(High Card|Pair|Two Pair|Three of a Kind|Straight|Flush|Full House|Four of a Kind|Straight Flush)/)?.[1]
console.log('category-match:', logTop.includes(pvCat ?? '§'))
await b.close()