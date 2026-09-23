// QA for the dev-only Ascension prototype entry (seam PR 3/3).
//
// Proves:
//   1. production (dist/) and portable (dist-portable/) artifacts contain no
//      Ascension code or text at all, and neither shows an entry in a browser;
//   2. the dev server exposes the prototype, which plays, discards, clears,
//      previews with scorePlay, deals deterministically, saves nothing and
//      returns to the Classic title;
//   3. Classic stays the default path and its autosave/load is unchanged.
//
// Starts its own servers through the Vite API (no manual dev server needed).
// Run: npm run build && npm run build:portable && node scripts/qa-ascension-dev.mjs
import { chromium } from 'playwright'
import { createServer, preview } from 'vite'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const PORTABLE = join(root, 'dist-portable', 'worldhand.html')
mkdirSync(join(root, 'shots'), { recursive: true })
const ok = (name, extra = '') => console.log(`PASS  ${name}${extra ? ' — ' + extra : ''}`)
const fail = (msg) => { throw new Error(msg) }

// ------------------------------------------------ 1a. built artifacts, static
const MARKERS = [/ascension/i, /Back to Classic/, /no discards left this round/]
const walk = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])
for (const [label, files] of [['production dist/', existsSync(join(root, 'dist')) ? walk(join(root, 'dist')) : []], ['portable build', existsSync(PORTABLE) ? [PORTABLE] : []]]) {
  if (!files.length) fail(`${label} missing: run npm run build && npm run build:portable first`)
  for (const f of files) {
    const text = readFileSync(f, 'latin1')
    for (const m of MARKERS) if (m.test(text)) fail(`${label}: ${f} contains ${m}`)
  }
  ok(`${label} artifacts`, `${files.length} file(s), no Ascension code or text`)
}

const browser = await chromium.launch()
async function page() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  return { ctx, p, errors }
}
async function freshTitle(p, url) {
  await p.goto(url)
  await p.waitForSelector('#seed', { timeout: 30000 })
  await p.evaluate(() => localStorage.clear())
  await p.reload()
  await p.waitForSelector('#seed', { timeout: 30000 })
}
async function expectNoEntry(p, label) {
  await p.waitForSelector('text=Begin New World')
  if (await p.locator('[data-testid="ascension-entry"]').count()) fail(`${label}: Ascension entry is visible`)
  if (/ascension/i.test(await p.locator('body').innerText())) fail(`${label}: page text mentions Ascension`)
}

// ------------------------------------------------------------- 2 + 3. dev server
// Runs BEFORE any preview(): Vite's preview sets process.env.NODE_ENV=production
// when it is unset, and a dev server started later in the same process would
// then compile with import.meta.env.DEV=false.
const dev = await createServer({ root, logLevel: 'silent', server: { port: 5179, strictPort: false, host: '127.0.0.1' } })
await dev.listen()
const DEV_URL = dev.resolvedUrls.local[0]
try {
  const { ctx, p, errors } = await page()
  await freshTitle(p, DEV_URL)
  if (!(await p.locator('[data-testid="ascension-entry"]').count())) fail(`dev server: Ascension entry missing at ${p.url()} — buttons: ${(await p.locator('button').allInnerTexts()).join(' / ')}`)
  if (await p.locator('[data-testid="ascension-app"]').count()) fail('dev server: Classic title must be the default screen')
  await p.screenshot({ path: 'shots/ascension-dev-title.png' })
  ok('dev server title', 'Classic is the default screen; the dev-only Ascension entry is offered')

  // prototype: start, preview, play, discard, clear, 6th card, rollover
  await p.click('[data-testid="ascension-entry"]')
  await p.waitForSelector('[data-testid="ascension-app"]')
  await p.fill('#asc-seed', 'qa-asc')
  await p.click('[data-testid="asc-start"]')
  const cards = p.locator('[data-testid="ascension-app"] .pcard-btn')
  if ((await cards.count()) !== 8) fail('prototype: expected an 8-card hand')
  const firstHand = await cards.allInnerTexts()
  for (const i of [0, 1, 2]) await cards.nth(i).click()
  const pv = await p.locator('[data-testid="asc-preview"]').innerText()
  const m = pv.match(/chips × [\d.]+ mult = (\d+)$/)
  if (!m) fail(`prototype: no scorePlay preview, got "${pv}"`)
  await p.screenshot({ path: 'shots/ascension-dev-preview.png' })
  await p.click('[data-testid="asc-play"]')
  const score = Number(await p.locator('[data-testid="asc-score"]').innerText())
  if (score !== Number(m[1])) fail(`prototype: committed score ${score} != previewed ${m[1]}`)
  if (!(await p.locator('[data-testid="asc-status"]').innerText()).includes('Plays 3 · Discards 3')) fail('prototype: play did not spend a play')
  ok('prototype play', `preview "${pv}" committed exactly (score ${score})`)

  await cards.nth(0).click(); await cards.nth(1).click()
  await p.click('[data-testid="asc-discard"]')
  if (!(await p.locator('[data-testid="asc-status"]').innerText()).includes('Plays 3 · Discards 2')) fail('prototype: discard did not spend a discard')
  await cards.nth(0).click()
  await p.click('[data-testid="asc-clear"]')
  if (await p.locator('[data-testid="ascension-app"] .pcard-btn.sel').count()) fail('prototype: clear left cards selected')
  for (let i = 0; i < 6; i++) await cards.nth(i).click()
  if ((await p.locator('[data-testid="ascension-app"] .pcard-btn.sel').count()) !== 5) fail('prototype: selection must stop at 5')
  if (!(await p.locator('p.error').innerText()).includes('at most 5')) fail('prototype: 6th card should explain the limit')
  await p.click('[data-testid="asc-clear"]')
  ok('prototype discard / clear / limit', 'discard spends a discard, clear empties the selection, a 6th card is refused')

  for (let i = 0; i < 3; i++) { await cards.nth(0).click(); await p.click('[data-testid="asc-play"]') }
  if (!(await p.locator('[data-testid="asc-status"]').innerText()).includes('Round 2 · Plays 4 · Discards 3')) fail('prototype: round did not roll over')
  await p.screenshot({ path: 'shots/ascension-dev-round2.png' })
  ok('prototype rounds', 'the 4th play rolls over to round 2')

  // determinism through the UI: the same seed deals the same first hand
  await p.click('[data-testid="asc-exit"]')
  await p.click('[data-testid="ascension-entry"]')
  await p.fill('#asc-seed', 'qa-asc')
  await p.click('[data-testid="asc-start"]')
  if ((await cards.allInnerTexts()).join() !== firstHand.join()) fail('prototype: same seed dealt a different hand')
  ok('prototype determinism', 'same seed, same first hand')

  // back to Classic; Ascension wrote nothing
  await p.click('[data-testid="asc-exit"]')
  await p.waitForSelector('text=Begin New World')
  const keys = await p.evaluate(() => Object.keys(localStorage))
  if (keys.length) fail(`prototype wrote to localStorage: ${keys.join(', ')}`)
  ok('prototype exit', 'returns to the Classic title; nothing saved')

  // Classic default path + autosave/load unchanged
  await p.fill('#seed', 'qa-classic')
  await p.click('text=Begin New World')
  await p.waitForSelector('.hand-cards .pcard-btn')
  for (const i of [0, 1]) await p.locator('.hand-cards .pcard-btn').nth(i).click()
  await p.click('[data-testid="play-btn"]')
  await p.waitForTimeout(100)
  const handBefore = await p.locator('.hand-cards .pcard-btn').allInnerTexts()
  const env = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null'))
  if (!env || env.schema !== 4 || env.version !== 8 || env.state?.seedText !== 'qa-classic' || env.state.playsLeft !== 3) fail(`Classic autosave: unexpected envelope ${JSON.stringify(env && { schema: env.schema, version: env.version })}`)
  await p.reload()
  await p.waitForSelector('.hand-cards .pcard-btn', { timeout: 30000 })
  if (await p.locator('[data-testid="ascension-entry"]').count()) fail('Classic reload should resume the run, not show the title')
  if ((await p.locator('.hand-cards .pcard-btn').allInnerTexts()).join() !== handBefore.join()) fail('Classic reload: resumed a different hand')
  const reloaded = await p.evaluate(() => JSON.parse(localStorage.getItem('worldhand.save') ?? 'null'))
  if (JSON.stringify(reloaded.state) !== JSON.stringify(env.state)) fail('Classic reload: loading changed the saved state')
  ok('Classic default + autosave/load', 'a Classic run autosaves (schema 4, v8) and resumes on reload')

  if (errors.length) fail('dev console errors: ' + errors.join(' | '))
  ok('dev console', 'zero page/console errors')
  await ctx.close()
} finally {
  await dev.close()
}

// ----------------------------------------- 1b. production + portable, in a browser
{
  const server = await preview({ root, logLevel: 'silent', preview: { port: 5178, strictPort: false, host: '127.0.0.1' } })
  const { ctx, p, errors } = await page()
  await freshTitle(p, server.resolvedUrls.local[0])
  await expectNoEntry(p, 'production preview')
  if (errors.length) fail('production preview console errors: ' + errors.join(' | '))
  ok('production build in a browser', 'title shows Classic only, no Ascension entry')
  await ctx.close()
  await server.close()
}
{
  const { ctx, p, errors } = await page()
  await freshTitle(p, pathToFileURL(PORTABLE).href)
  await expectNoEntry(p, 'portable build')
  if (errors.length) fail('portable console errors: ' + errors.join(' | '))
  ok('portable build in a browser', 'title shows Classic only, no Ascension entry')
  await ctx.close()
}

await browser.close()
console.log('ALL ASCENSION DEV-ENTRY CHECKS PASSED')
