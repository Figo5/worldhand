// Capture shop (tabbed offer board) + menu popover evidence at 1280 and 480.
import { chromium } from 'playwright'
const browser = await chromium.launch()
async function shopShot(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('http://127.0.0.1:5177/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.fill('#seed', 'shop-shot')
  await page.click('text=Begin New World')
  await page.waitForSelector('.hand-cards .pcard-btn')
  // play hands until market
  for (let i = 0; i < 8; i++) {
    const inMarket = await page.locator('.market').count()
    if (inMarket) break
    const inEnd = await page.locator('[data-testid="epoch-end"]').count()
    if (inEnd) { await page.click('[data-testid="close-epoch-btn"]'); continue }
    const cards = page.locator('.hand-cards .pcard-btn')
    await cards.nth(0).click(); await cards.nth(1).click()
    await page.click('[data-testid="play-btn"]')
    await page.waitForTimeout(120)
  }
  if (!(await page.locator('.market').count())) throw new Error('never reached market')
  await page.waitForTimeout(300)
  const tabs = await page.locator('.shop-tabs').innerText()
  for (const want of ['Laws & World', 'Jokers', 'Planets', 'Consumables', 'Vouchers']) {
    if (!tabs.includes(want)) throw new Error(`shop tab missing: ${want}`)
  }
  await page.screenshot({ path: `shots-review/shop-${tag}.png`, fullPage: false })
  // jokers tab
  await page.click('[data-testid="shop-tab-jokers"]')
  await page.waitForTimeout(150)
  await page.screenshot({ path: `shots-review/shop-${tag}-jokers.png`, fullPage: false })
  // menu popover
  await page.click('[data-testid="menu-btn"]')
  await page.waitForSelector('[data-testid="menu-pop"]')
  await page.screenshot({ path: `shots-review/menu-${tag}.png`, fullPage: false })
  // overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) throw new Error(`horizontal overflow in shop at ${width}`)
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log(`shop OK ${tag}`)
  await page.close()
}
await shopShot(1280, 800, '1280')
await shopShot(480, 800, 'narrow')
await browser.close()
console.log('SHOP+MENU SHOTS OK')