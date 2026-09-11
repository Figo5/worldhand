// Playwright QA of the ACTUAL portable artifact, loaded over file:// exactly
// the way a player double-clicks it — no dev server, no preview server.
//
// Covers: load + localStorage availability on file://, wide (1280x800) and
// mobile (480x800), keyboard card navigation, a full run to game-over, reload
// persistence, a real shop purchase, and portable save export -> import on a
// second "device" (a fresh browser context with empty storage).
//
// Run: npm run build:portable && node scripts/qa-portable.mjs
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const ARTIFACT = resolve(import.meta.dirname, '..', 'dist-portable', 'worldhand.html')
if (!existsSync(ARTIFACT)) throw new Error(`missing artifact ${ARTIFACT} — run npm run build:portable`)
const URL_ = pathToFileURL(ARTIFACT).href

const browser = await chromium.launch()
const results = []
const ok = (name, extra = '') => { results.push(`PASS  ${name}${extra ? ' — ' + extra : ''}`); console.log(`PASS  ${name}${extra ? ' — ' + extra : ''}`) }

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
}

async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  watch(page, errors)
  return { ctx, page, errors }
}

async function startWorld(page, seed) {
  await page.goto(URL_)
  await page.waitForSelector('#seed', { timeout: 15000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('#seed')
  await page.fill('#seed', seed)
  await page.click('text=Begin New World')
  await page.waitForSelector('.hand-cards .pcard-btn', { timeout: 15000 })
}

/** true when the run is over (verdict panel). */
const isOver = async (page) => (await page.locator('.panel.verdict').count()) > 0

async function playOnce(page) {
  const n = await page.locator('.hand-cards .pcard-btn').count()
  for (let i = 0; i < Math.min(5, n); i++) await page.locator('.hand-cards .pcard-btn').nth(i).click()
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(60)
}

/** Advance past market / epoch-end panels if either is showing. */
async function advancePanels(page) {
  if (await page.locator('[data-testid="end-market-btn"]').count()) {
    await page.locator('[data-testid="end-market-btn"]').first().click()
    await page.waitForTimeout(60)
  }
  if (await page.locator('[data-testid="close-epoch-btn"]').count()) {
    await page.locator('[data-testid="close-epoch-btn"]').first().click()
    await page.waitForTimeout(60)
  }
}

// ---------------------------------------------------------------- file:// load
{
  const { ctx, page, errors } = await newPage(1280, 800)
  await page.goto(URL_)
  await page.waitForSelector('#seed', { timeout: 15000 })
  if (!(await page.evaluate(() => { try { localStorage.setItem('__probe', '1'); const v = localStorage.getItem('__probe'); localStorage.removeItem('__probe'); return v === '1' } catch { return false } })))
    throw new Error('localStorage is NOT available over file:// — saves would not persist in the portable build')
  const reqs = []
  page.on('request', (r) => { if (!r.url().startsWith('file:')) reqs.push(r.url()) })
  await page.reload()
  await page.waitForSelector('#seed')
  if (reqs.length) throw new Error('portable artifact made network requests: ' + reqs.join(', '))
  if (errors.length) throw new Error('console errors on load: ' + errors.join(' | '))
  await page.screenshot({ path: 'shots/portable-menu-1280.png' })
  ok('file:// load', 'localStorage available, zero network requests, zero console errors')
  await ctx.close()
}

// ------------------------------------------------- wide: keyboard + full run
{
  const { ctx, page, errors } = await newPage(1280, 800)
  await startWorld(page, 'portable-qa-wide')

  // keyboard: focus first card, arrow to the next, toggle with Enter/Space
  await page.locator('.hand-cards .pcard-btn').first().focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  const selected = await page.locator('.pcard-btn.sel').count()
  if (selected !== 2) throw new Error(`keyboard selection expected 2 selected cards, got ${selected}`)
  if (!(await page.locator('[data-testid="preview"]').count())) throw new Error('keyboard selection produced no preview')
  await page.locator('.pcard-btn.sel').first().click()
  await page.locator('.pcard-btn.sel').first().click()
  ok('keyboard', 'arrow navigation + Enter/Space toggle select cards and drive the preview')

  // shop: reach the first market and buy the cheapest affordable offer
  let guard = 0
  while (!(await page.locator('[data-testid="end-market-btn"]').count()) && guard++ < 12) {
    if (await page.locator('[data-testid="close-epoch-btn"]').count()) await page.locator('[data-testid="close-epoch-btn"]').first().click()
    else await playOnce(page)
    await page.waitForTimeout(60)
  }
  if (!(await page.locator('[data-testid="end-market-btn"]').count())) throw new Error('never reached the market')
  const before = await page.locator('[data-testid="run-rail"]').innerText()
  let bought = null
  for (const tab of ['world', 'jokers', 'planets', 'consumables', 'vouchers']) {
    await page.locator(`[data-testid="shop-tab-${tab}"]`).click()
    const enabled = page.locator('.offer-card:not([disabled])')
    if (await enabled.count()) {
      bought = (await enabled.first().innerText()).split('\n')[0]
      await enabled.first().click()
      await page.waitForTimeout(80)
      break
    }
  }
  if (!bought) throw new Error('no affordable shop offer in any tab')
  const after = await page.locator('[data-testid="run-rail"]').innerText()
  if (before === after) throw new Error('shop purchase did not change the run rail')
  await page.screenshot({ path: 'shots/portable-shop-1280.png' })
  ok('shop', `bought "${bought}" from the tabbed market; rail updated`)

  // reload persistence: the bought state must survive a full reload
  const railBefore = await page.locator('[data-testid="run-rail"], .shop-head').first().innerText()
  await page.reload()
  await page.waitForTimeout(300)
  if (await page.locator('#seed').count()) throw new Error('reload dropped the run back to the menu')
  const railAfter = await page.locator('[data-testid="run-rail"], .shop-head').first().innerText()
  if (railBefore !== railAfter) throw new Error(`reload changed state:\n${railBefore}\n---\n${railAfter}`)
  ok('reload persistence', 'run + purchase survived a reload of the file:// artifact')

  // full run to game-over
  let steps = 0
  while (!(await isOver(page)) && steps++ < 600) {
    if (await page.locator('[data-testid="play-btn"]').count()) await playOnce(page)
    else await advancePanels(page)
  }
  if (!(await isOver(page))) throw new Error(`run did not end within ${steps} steps`)
  await page.screenshot({ path: 'shots/portable-gameover-1280.png' })
  const verdict = (await page.locator('.panel.verdict').innerText()).replace(/\s+/g, ' ').slice(0, 160)
  ok('full run to game-over', verdict)

  if (errors.length) throw new Error('console errors during wide run: ' + errors.join(' | '))
  ok('wide console', 'zero page/console errors at 1280x800')
  await ctx.close()
}

// --------------------------------------------------------------- mobile 480
{
  const { ctx, page, errors } = await newPage(480, 800)
  await startWorld(page, 'portable-qa-mobile')
  await page.locator('.hand-cards .pcard-btn').nth(0).click()
  await page.locator('.hand-cards .pcard-btn').nth(1).click()
  await page.waitForSelector('[data-testid="preview"]')
  await page.locator('[data-testid="play-btn"]').click()
  await page.waitForTimeout(150)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  if (overflow) throw new Error('horizontal overflow at 480x800')
  await page.screenshot({ path: 'shots/portable-play-480.png' })
  if (errors.length) throw new Error('console errors at 480x800: ' + errors.join(' | '))
  ok('mobile 480x800', 'play works, no horizontal overflow, zero console errors')
  await ctx.close()
}

// --------------------------------- portable save: export here, import there
{
  const a = await newPage(1280, 800)
  await startWorld(a.page, 'portable-transfer')
  await playOnce(a.page)
  const railA = await a.page.locator('[data-testid="run-rail"]').innerText()
  await a.page.locator('[data-testid="menu-btn"]').click()
  await a.page.locator('.menu-quit').click()
  await a.page.waitForSelector('[data-testid="export-save-btn"]')
  const [download] = await Promise.all([
    a.page.waitForEvent('download', { timeout: 10000 }),
    a.page.locator('[data-testid="export-save-btn"]').click(),
  ])
  const file = resolve(mkdtempSync(resolve(tmpdir(), 'worldhand-')), download.suggestedFilename())
  await download.saveAs(file)
  if (a.errors.length) throw new Error('console errors during export: ' + a.errors.join(' | '))
  ok('save export', `downloaded ${download.suggestedFilename()} from the file:// artifact`)

  // second "device": a fresh context, empty storage
  const b = await newPage(1280, 800)
  await b.page.goto(URL_)
  await b.page.waitForSelector('#seed')
  await b.page.evaluate(() => localStorage.clear())
  await b.page.reload()
  await b.page.waitForSelector('[data-testid="import-save-input"]', { state: 'attached' })
  await b.page.setInputFiles('[data-testid="import-save-input"]', file)
  await b.page.waitForSelector('[data-testid="run-rail"]', { timeout: 10000 })
  const railB = await b.page.locator('[data-testid="run-rail"]').innerText()
  if (railA !== railB) throw new Error(`imported run differs:\n${railA}\n---\n${railB}`)

  // a junk file must be refused without damaging the run now on this device
  await b.page.locator('[data-testid="menu-btn"]').click()
  await b.page.locator('.menu-quit').click()
  await b.page.waitForSelector('[data-testid="import-save-input"]', { state: 'attached' })
  await b.page.setInputFiles('[data-testid="import-save-input"]', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('not a save') })
  await b.page.waitForTimeout(200)
  if (!(await b.page.locator('.error').count())) throw new Error('junk import produced no error message')
  await b.page.click('text=Load Saved World')
  await b.page.waitForSelector('[data-testid="run-rail"]')
  if ((await b.page.locator('[data-testid="run-rail"]').innerText()) !== railA) throw new Error('junk import damaged the existing save')
  if (b.errors.length) throw new Error('console errors during import: ' + b.errors.join(' | '))
  ok('save import', 'transferred run matches the source device; junk file refused without damaging the local save')
  await a.ctx.close(); await b.ctx.close()
}

await browser.close()
console.log('\nALL PORTABLE ARTIFACT CHECKS PASSED\n' + results.map((r) => '  ' + r).join('\n'))
