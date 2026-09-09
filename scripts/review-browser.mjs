// Final acceptance matrix at 1280x800 and 480x800 with the epoch-end fix in place.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const results = []
const rec = (k, v) => results.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)

const browser = await chromium.launch()

async function runViewport(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ` + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ` + m.text()) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('#seed')
  await page.screenshot({ path: `${OUT}/${tag}-00-menu.png` })

  await page.fill('#seed', 'auralia-the-first')
  await page.click('text=Begin New World')
  await page.waitForSelector('.pcard-btn')
  await page.screenshot({ path: `${OUT}/${tag}-01-hand.png`, fullPage: true })

  const counts = await page.evaluate(() => ({
    regions: document.querySelectorAll('.region-btn').length,
    cards: document.querySelectorAll('.pcard-btn').length,
    hud: document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))
  rec(`[${tag}] counts`, counts)

  // multi-card selection 3 cards
  for (const i of [0, 1, 2]) await page.locator('.pcard-btn').nth(i).click()
  rec(`[${tag}] multi-select-3`, await page.locator('.pcard-btn.sel').count())
  await page.screenshot({ path: `${OUT}/${tag}-02-multiselect.png` })

  // preview text
  const previewText = await page.locator('[data-testid="preview"]').innerText().catch(() => 'NO_PREVIEW')
  rec(`[${tag}] preview`, previewText.replace(/\n/g, ' | '))
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(150)
  // save via button (no auto-save) then read log from save
  await page.click('button:has-text("Save")'); await page.waitForTimeout(100)
  const logTop = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null')?.state.log.slice(-1)[0]?.text)
  const pvAmt = previewText.match(/Banks (\d+) Growth/)?.[1]
  rec(`[${tag}] preview-equals-commit`, logTop ? logTop.includes(`Banks ${pvAmt} Growth`) : false, { pvAmt, logTop })

  // discard 2
  await page.locator('.pcard-btn').nth(0).click()
  await page.locator('.pcard-btn').nth(1).click()
  const dBtn = page.locator('button:has-text("Discard")')
  const dBefore = await dBtn.innerText()
  await dBtn.click()
  await page.waitForTimeout(150)
  const dAfter = await dBtn.innerText()
  await page.click('button:has-text("Save")'); await page.waitForTimeout(100)
  const handAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null')?.state.hand.length)
  rec(`[${tag}] discard`, { before: dBefore, after: dAfter, handAfter })

  // map selection: the SVG nodes are now the 3D globe + accessible legend;
  // a legend click selects the same region on the globe and opens map-detail
  await page.locator('.region-btn').first().click()
  await page.waitForTimeout(100)
  const detail = await page.locator('[data-testid="map-detail"]').innerText().catch(() => 'NO_DETAIL')
  rec(`[${tag}] map-selection`, detail.replace(/\n/g, ' | '))
  await page.screenshot({ path: `${OUT}/${tag}-03-map.png`, fullPage: true })

  // quit preserves save
  await page.click('button:has-text("Save")'); await page.waitForTimeout(100)
  const saveBytes = await page.evaluate(() => localStorage.getItem('worldhand.save')?.length ?? 0)
  await page.click('button:has-text("Quit")')
  await page.waitForTimeout(150)
  const afterQuit = await page.evaluate(() => ({ menu: !!document.querySelector('#seed'), saveBytes: localStorage.getItem('worldhand.save')?.length ?? 0 }))
  rec(`[${tag}] quit-preserves-save`, { saveBytes, afterQuit })
  await page.screenshot({ path: `${OUT}/${tag}-04-after-quit.png` })

  // reload + auto-load
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const hudAfterReload = await page.locator('.hud').innerText().catch(() => 'MENU_NO_AUTOLOAD')
  rec(`[${tag}] reload-auto-load`, hudAfterReload.replace(/\n/g, ' | '))
  await page.screenshot({ path: `${OUT}/${tag}-05-after-reload.png`, fullPage: true })

  // full run to verdict
  let marketSeen = false, epochEndSeen = false, marketHtml = 'NO_MARKET_SEEN'
  for (let g = 0; g < 400; g++) {
    if (await page.locator('.verdict').count()) break
    const phase = await page.evaluate(() => document.querySelector('.market') ? 'market'
      : document.querySelector('.verdict') ? 'verdict'
      : document.querySelector('[data-testid="epoch-end"]') ? 'epoch-end'
      : document.querySelectorAll('.pcard-btn').length ? 'select' : 'unknown')
    if (phase === 'select') {
      if (!(await page.locator('.pcard-btn.sel').count())) await page.locator('.pcard-btn').first().click()
      await page.locator('[data-testid="play-btn"]').click(); await page.waitForTimeout(50)
    } else if (phase === 'market') {
      marketSeen = true
      const buy = page.locator('.market-btn:not([disabled])').first()
      if (await buy.count()) await buy.click().catch(() => {})
      await page.click('button:has-text("Continue")'); await page.waitForTimeout(70)
    } else if (phase === 'epoch-end') {
      epochEndSeen = true
      if (marketSeen && marketHtml === 'NO_MARKET_SEEN') marketHtml = 'seen'
      await page.locator('[data-testid="close-epoch-btn"]').click(); await page.waitForTimeout(70)
    } else break
  }
  await page.click('button:has-text("Save")').catch(() => {}); await page.waitForTimeout(100)
  const verdict = await page.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')
  rec(`[${tag}] market`, marketSeen)
  rec(`[${tag}] epoch-end-phase-reached`, epochEndSeen)
  rec(`[${tag}] verdict`, verdict)
  rec(`[${tag}] drought-log`, await page.evaluate(() => [...document.querySelectorAll('.log li')].map(l => l.innerText).filter(t => t.includes('Drought')).join(' ;; ') || 'NONE'))
  await page.screenshot({ path: `${OUT}/${tag}-06-verdict.png`, fullPage: true })
  await page.close()
}

await runViewport(1280, 800, 'wide')
await runViewport(480, 800, 'narrow')

rec('errors', errors)
console.log(results.join('\n'))
await browser.close()