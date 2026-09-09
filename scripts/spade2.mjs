import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:5177'
const browser = await chromium.launch()
const page = await browser.newPage()
const msgs = []
page.on('pageerror', e => msgs.push('PAGEERROR ' + e.message))
page.on('console', m => msgs.push('CONSOLE ' + m.type() + ' ' + m.text()))
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.fill('#seed', 'spade-regression')
await page.click('text=Begin New World')
await page.waitForSelector('.pcard-btn')
await page.locator('.pcard-btn').nth(0).click()
await page.waitForTimeout(150)
await page.locator('.region-btn:not([disabled])').first().click()
await page.waitForTimeout(150)
const state1 = await page.evaluate(() => ({
  selectedBtns: document.querySelectorAll('.pcard-btn.sel').length,
  regionSel: document.querySelectorAll('.region-btn.sel').length,
  playDisabled: document.querySelector('button.primary')?.disabled ?? null,
  playText: document.querySelector('button.primary')?.textContent,
  error: document.querySelector('.error')?.textContent ?? null,
  hints: [...document.querySelectorAll('.hint')].map(e => e.textContent),
}))
console.log('STATE1', JSON.stringify(state1))
await page.click('button.primary')
await page.waitForTimeout(250)
const state2 = await page.evaluate(() => ({
  cards: document.querySelectorAll('.pcard-btn').length,
  stab: [...document.querySelectorAll('.region-btn')].slice(0,4).map(b => b.querySelector('.chips')?.textContent),
  log: document.querySelector('.log ul')?.innerText,
  error: document.querySelector('.error')?.textContent ?? null,
}))
console.log('STATE2', JSON.stringify(state2))
console.log('MSGS', JSON.stringify(msgs))
await browser.close()
