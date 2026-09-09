// Debug: what does the page actually render on first load?
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
await page.goto('http://127.0.0.1:5177', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const body = await page.evaluate(() => document.body.innerText.slice(0, 500))
const html = await page.evaluate(() => document.getElementById('root')?.innerHTML.slice(0, 300) ?? 'EMPTY_ROOT')
const ls = await page.evaluate(() => Object.keys(localStorage))
console.log('BODY:', body)
console.log('ROOT_HTML:', html)
console.log('LOCALSTORAGE_KEYS:', ls)
console.log('ERRORS:', JSON.stringify(errs))
await browser.close()