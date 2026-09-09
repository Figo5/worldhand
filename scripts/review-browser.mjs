// Independent browser acceptance: 1280x800 + narrow viewport, quit/save/reload, market, discards.
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
  // clear any existing save for a clean run
  await page.evaluate(() => localStorage.removeItem('worldhand.save'))
  await page.reload({ waitUntil: 'networkidle' })

  // menu visible?
  const menu = await page.locator('#seed').count()
  rec(`[${tag}] menu-seed-input`, menu === 1)
  await page.fill('#seed', 'auralia-the-first')
  await page.click('text=Begin New World')
  await page.waitForSelector('.pcard-btn')
  await page.screenshot({ path: `${OUT}/${tag}-01-hand.png`, fullPage: true })

  const counts = await page.evaluate(() => ({
    regions: document.querySelectorAll('.region').length,
    cards: document.querySelectorAll('.pcard-btn').length,
    hud: document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))
  rec(`[${tag}] counts`, counts)

  // multi-card selection: can two cards be selected simultaneously? (click card 0, then card 1)
  await page.locator('.pcard-btn').nth(0).click()
  await page.locator('.pcard-btn').nth(1).click()
  const selCount = await page.locator('.pcard-btn.sel').count()
  rec(`[${tag}] multi-card-selection-selected-count`, selCount) // required: >1; current impl: 1

  // preview equals commit: read lastHandResult preview before playing, then play and compare
  const previewBefore = await page.evaluate(() => localStorage.getItem('worldhand.save') ? JSON.parse(localStorage.getItem('worldhand.save')).state.lastHandResult : null)
  rec(`[${tag}] preview-lastHandResult-shown-in-ui`, await page.locator('text=best').count() > 0 || 'not-visible')
  rec(`[${tag}] saved-lastHandResult`, previewBefore)

  // play a non-spade card
  const suitOf = async (i) => (await page.locator('.pcard-btn').nth(i).getAttribute('title')).trim()
  let played = null
  for (let i = 0; i < (await page.locator('.pcard-btn').count()); i++) {
    const suit = await suitOf(i)
    if (!suit.startsWith('Roots')) {
      const before = await page.locator('.pcard-btn').count()
      await page.locator('.pcard-btn').nth(i).click()
      await page.click('button.primary:has-text("Play")')
      await page.waitForTimeout(120)
      const after = await page.locator('.pcard-btn').count()
      if (after === before - 1) { played = { i, suit: suit.split(' ')[0], before, after }; break }
    }
  }
  rec(`[${tag}] play-non-spade`, played)

  // discard flow + conservation of discard budget
  const dBefore = await page.locator('button:has-text("Discard")').innerText()
  await page.locator('.pcard-btn').first().click()
  await page.click('button:has-text("Discard")')
  await page.waitForTimeout(120)
  const dAfter = await page.locator('button:has-text("Discard")').innerText()
  rec(`[${tag}] discard-budget`, { before: dBefore, after: dAfter })

  // spade targeting if available
  let spade = -1
  for (let i = 0; i < (await page.locator('.pcard-btn').count()); i++) if ((await suitOf(i)).startsWith('Roots')) { spade = i; break }
  if (spade >= 0) {
    await page.locator('.pcard-btn').nth(spade).click()
    const en = await page.locator('.region-btn:not([disabled])').count()
    rec(`[${tag}] spade-enabled-regions`, en)
    if (en > 0) {
      await page.locator('.region-btn:not([disabled])').first().click()
      await page.click('button.primary:has-text("Play")')
      await page.waitForTimeout(120)
      rec(`[${tag}] spade-targeted-play-hand`, await page.locator('.pcard-btn').count())
    }
  }
  await page.screenshot({ path: `${OUT}/${tag}-02-mid.png`, fullPage: true })

  // advance → hand 2
  await page.click('button.advance')
  await page.waitForTimeout(150)
  const hudAfterAdvance = await page.evaluate(() => document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '))
  rec(`[${tag}] hud-after-advance`, hudAfterAdvance)

  // quit preserving save: click Quit, then check save persists in localStorage
  const saveBefore = await page.evaluate(() => localStorage.getItem('worldhand.save')?.length ?? 0)
  await page.click('button:has-text("Quit")')
  await page.waitForTimeout(150)
  const saveAfterQuit = await page.evaluate(() => ({ exists: !!localStorage.getItem('worldhand.save'), bytes: localStorage.getItem('worldhand.save')?.length ?? 0 }))
  rec(`[${tag}] quit-preserves-save`, { saveBefore, saveAfterQuit })
  await page.screenshot({ path: `${OUT}/${tag}-03-after-quit.png` })

  // reload → back to menu, then Load Saved World restores state
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  // after quit, state was cleared in-app; a reload should show menu (state null) but save intact
  const menuAfterReload = await page.locator('#seed').count()
  rec(`[${tag}] menu-after-quit-reload`, menuAfterReload === 1)
  if (menuAfterReload) {
    await page.click('button:has-text("Load Saved World")')
    await page.waitForTimeout(300)
    const hudRestored = await page.evaluate(() => document.querySelector('.hud')?.innerText.replace(/\n/g, ' | '))
    rec(`[${tag}] hud-after-load`, hudRestored)
  }
  await page.screenshot({ path: `${OUT}/${tag}-04-after-load.png`, fullPage: true })

  // run to market: skip laws, advance until market panel visible (epoch end)
  let marketSeen = false
  for (let g = 0; g < 60; g++) {
    if (await page.locator('.market').count()) { marketSeen = true; break }
    const skip = page.locator('button:has-text("Skip")')
    if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(60); continue }
    const adv = page.locator('button.advance')
    if (await adv.count()) { await adv.click(); await page.waitForTimeout(60) } else break
  }
  rec(`[${tag}] market-visible`, marketSeen)
  if (marketSeen) await page.screenshot({ path: `${OUT}/${tag}-05-market.png`, fullPage: true })

  // run to game over
  for (let g = 0; g < 200; g++) {
    if (await page.locator('.verdict').count()) break
    const skip = page.locator('button:has-text("Skip")')
    if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(40); continue }
    const adv = page.locator('button.advance')
    if (await adv.count() && await adv.isEnabled()) { await adv.click(); await page.waitForTimeout(40) } else break
  }
  const verdict = await page.evaluate(() => document.querySelector('.verdict')?.innerText.replace(/\n/g, ' | ') ?? 'NO_VERDICT')
  rec(`[${tag}] verdict`, verdict)
  await page.screenshot({ path: `${OUT}/${tag}-06-verdict.png`, fullPage: true })
  await page.close()
}

await runViewport(1280, 800, 'wide')
await runViewport(480, 800, 'narrow')

rec('errors', errors)
console.log(results.join('\n'))
await browser.close()