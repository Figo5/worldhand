// Regression: select ♠ card → region buttons enable → click region → Play commits.
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5177'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.fill('#seed', 'spade-regression')
await page.click('text=Begin New World')
await page.waitForSelector('.pcard-btn')

// find a spade in the hand
const n = await page.locator('.pcard-btn').count()
let spade = -1
for (let i = 0; i < n; i++) {
  const t = await page.locator('.pcard-btn').nth(i).getAttribute('title')
  if (t && t.startsWith('Roots')) { spade = i; break }
}
console.log('SPADE_INDEX', spade)
if (spade < 0) {
  // no spade this hand — advance up to 4 hands looking for one
  for (let h = 0; h < 4 && spade < 0; h++) {
    await page.click('button.advance')
    await page.waitForTimeout(120)
    if (await page.locator('.verdict').count()) break
    const m = await page.locator('.pcard-btn').count()
    for (let i = 0; i < m; i++) {
      const t = await page.locator('.pcard-btn').nth(i).getAttribute('title')
      if (t && t.startsWith('Roots')) { spade = i; break }
    }
  }
}
if (spade < 0) { console.log('NO_SPADE_FOUND'); process.exit(1) }

await page.locator('.pcard-btn').nth(spade).click()
await page.waitForTimeout(100)
const afterSelect = await page.evaluate(() => ({
  hint: [...document.querySelectorAll('.hint')].map((e) => e.textContent).join(' / '),
  enabledRegions: document.querySelectorAll('.region-btn:not([disabled])').length,
  totalRegions: document.querySelectorAll('.region-btn').length,
}))
console.log('AFTER_SELECT', JSON.stringify(afterSelect))
if (afterSelect.enabledRegions === 0) { console.log('FAIL: no regions enabled after ♠ select'); process.exit(1) }

const target = page.locator('.region-btn:not([disabled])').first()
const targetName = await target.locator('strong').innerText()
await target.click()
await page.waitForTimeout(100)
const sel = await page.evaluate(() => document.querySelectorAll('.region-btn.sel').length)
console.log('REGION_SELECTED', sel)

const stabBefore = await page.evaluate((name) => {
  const btns = [...document.querySelectorAll('.region-btn')]
  const b = btns.find((x) => x.querySelector('strong')?.textContent === name)
  return b?.querySelector('.chips')?.textContent ?? '?'
}, targetName)
await page.click('button.primary:has-text("Play")')
await page.waitForTimeout(150)
const stabAfter = await page.evaluate((name) => {
  const btns = [...document.querySelectorAll('.region-btn')]
  const b = btns.find((x) => x.querySelector('strong')?.textContent === name)
  return b?.querySelector('.chips')?.textContent ?? '?'
}, targetName)
console.log('TARGET', targetName, 'STAB', stabBefore, '→', stabAfter)

const logText = await page.evaluate(() => document.querySelector('.log ul')?.innerText.replace(/\n/g, ' | '))
console.log('LOG', logText)
console.log('ERRORS', JSON.stringify(errors))
await page.screenshot({ path: 'shots/08-spade-target-committed.png', fullPage: true })
await browser.close()