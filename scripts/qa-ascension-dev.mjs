// QA for the dev-only Ascension prototype entry (seam PR 3/3).
//
// Proves:
//   1. production (dist/) and portable (dist-portable/) artifacts contain no
//      Ascension code or text at all, and neither shows an entry in a browser;
//   2. the dev server exposes the prototype, which shows a seeded 12-region
//      world, plays, discards, clears, previews poker score, world-stat gains
//      and land bonus with evaluatePlay (and commits exactly those), grows
//      civilizations at round ends with an engine-derived reason, deals
//      deterministically, saves nothing and returns to the Classic title;
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
  const terrains = await p.locator('[data-testid="asc-world"] li[data-terrain]').evaluateAll((els) => els.map((e) => e.dataset.terrain))
  const VALID = ['plains', 'forest', 'mountains', 'desert', 'coast', 'tundra']
  if (terrains.length !== 12 || !terrains.every((t) => VALID.includes(t))) fail(`prototype: expected 12 regions with valid terrain, got ${JSON.stringify(terrains)}`)
  const rates = Object.fromEntries([...(await p.locator('[data-testid="asc-affinity"]').innerText()).matchAll(/(\w+) \+(\d+)/g)].map((x) => [x[1].toLowerCase(), Number(x[2])]))
  if (Object.values(rates).reduce((a, b) => a + b, 0) !== 12) fail(`prototype: land rates should cover all 12 regions, got ${JSON.stringify(rates)}`)
  ok('prototype world', `12 regions (${terrains.join(' ')}), land bonus per stat point ${JSON.stringify(rates)}`)
  const readStats = () => p.locator('[data-testid="asc-stats"] [data-stat]')
    .evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.stat, Number(e.dataset.value)])))
  const zero = await readStats()
  if (Object.keys(zero).length !== 4 || Object.values(zero).some((v) => v !== 0)) fail(`prototype: expected four stats at 0, got ${JSON.stringify(zero)}`)
  for (const i of [0, 1, 2]) await cards.nth(i).click()
  const pv = await p.locator('[data-testid="asc-preview"]').innerText()
  const m = pv.match(/chips × [\d.]+ mult = (\d+)$/)
  if (!m) fail(`prototype: no evaluatePlay score preview, got "${pv}"`)
  const pvTotal = p.locator('[data-testid="asc-preview-total"]')
  const land = Number(await pvTotal.getAttribute('data-land'))
  const total = Number(await pvTotal.getAttribute('data-score'))
  const pvStats = p.locator('[data-testid="asc-preview-stats"]')
  const deltas = JSON.parse(await pvStats.getAttribute('data-deltas'))
  const pvStatsText = await pvStats.innerText()
  if (Object.values(deltas).reduce((a, b) => a + b, 0) !== 3) fail(`prototype: 3 cards should preview 3 stat points, got ${JSON.stringify(deltas)}`)
  const expectLand = Object.entries(deltas).reduce((n, [k, d]) => n + d * rates[k], 0)
  if (land !== expectLand || total !== Number(m[1]) + land) fail(`prototype: land bonus ${land} / total ${total} do not match deltas × land rates (${expectLand})`)
  await p.screenshot({ path: 'shots/ascension-dev-preview.png' })
  await p.click('[data-testid="asc-play"]')
  const score = Number(await p.locator('[data-testid="asc-score"]').innerText())
  if (score !== total) fail(`prototype: committed score ${score} != previewed total ${total}`)
  const after = await readStats()
  if (JSON.stringify(after) !== JSON.stringify(deltas)) fail(`prototype: committed stats ${JSON.stringify(after)} != previewed ${JSON.stringify(deltas)}`)
  if (await p.locator('[data-testid="asc-last"]').getAttribute('data-deltas') !== JSON.stringify(deltas)) fail('prototype: last play does not show the committed stat changes')
  if (!(await p.locator('[data-testid="asc-status"]').innerText()).includes('Plays 3 · Discards 3')) fail('prototype: play did not spend a play')
  ok('prototype play', `preview "${pv}" / "${pvStatsText}" / land +${land} committed exactly (score ${score}, stats ${JSON.stringify(after)})`)

  await cards.nth(0).click(); await cards.nth(1).click()
  await p.click('[data-testid="asc-discard"]')
  if (!(await p.locator('[data-testid="asc-status"]').innerText()).includes('Plays 3 · Discards 2')) fail('prototype: discard did not spend a discard')
  if (JSON.stringify(await readStats()) !== JSON.stringify(after)) fail('prototype: a discard changed world stats')
  await cards.nth(0).click()
  await p.click('[data-testid="asc-clear"]')
  if (await p.locator('[data-testid="ascension-app"] .pcard-btn.sel').count()) fail('prototype: clear left cards selected')
  for (let i = 0; i < 6; i++) await cards.nth(i).click()
  if ((await p.locator('[data-testid="ascension-app"] .pcard-btn.sel').count()) !== 5) fail('prototype: selection must stop at 5')
  if (!(await p.locator('p.error').innerText()).includes('at most 5')) fail('prototype: 6th card should explain the limit')
  await p.click('[data-testid="asc-clear"]')
  ok('prototype discard / clear / limit', 'discard spends a discard and leaves stats alone, clear empties the selection, a 6th card is refused')

  // eras: a fresh world is Tribal and says what it still needs
  const eraPanel = p.locator('[data-testid="asc-era"]')
  const reqState = () => p.locator('[data-testid="asc-req"]').evaluateAll((els) => els.map((e) => ({ key: e.dataset.key, have: +e.dataset.have, need: +e.dataset.need, met: e.dataset.met === 'true' })))
  if ((await eraPanel.getAttribute('data-era')) !== 'tribal') fail('prototype: a fresh world should be Tribal')
  const fresh = await reqState()
  if (JSON.stringify(fresh.map((r) => [r.key, r.have, r.need, r.met])) !== JSON.stringify([['civilizations', 0, 1, false], ['stats', 0, 2, false]])) fail(`prototype: fresh Tribal requirements wrong: ${JSON.stringify(fresh)}`)
  const freshStatus = await p.locator('[data-testid="asc-era-status"]').innerText()
  if (!freshStatus.includes('1 more civilization') || !freshStatus.includes('2 more stats to 15')) fail(`prototype: era status should name what is missing: "${freshStatus}"`)
  ok('prototype era panel', `Tribal, 2 requirements; "${freshStatus}"`)

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
  const terrainsAgain = await p.locator('[data-testid="asc-world"] li[data-terrain]').evaluateAll((els) => els.map((e) => e.dataset.terrain))
  if (terrainsAgain.join() !== terrains.join()) fail('prototype: same seed generated a different world')
  ok('prototype determinism', 'same seed, same world and first hand')

  // civilizations: 5-card plays until one emerges at a round end
  if ((await p.locator('[data-testid="asc-civ-next"]').innerText()) !== '6') fail('prototype: first civilization threshold should be 6')
  if (await p.locator('[data-testid="asc-civs"] li').count()) fail('prototype: a fresh world should have no civilizations')
  for (let i = 0; i < 16 && !(await p.locator('[data-testid="asc-civs"] li').count()); i++) {
    for (let j = 0; j < 5; j++) await cards.nth(j).click()
    await p.click('[data-testid="asc-play"]')
  }
  const civ = p.locator('[data-testid="asc-civs"] li').first()
  if (!(await civ.count())) fail('prototype: no civilization emerged after 4 rounds of 5-card plays')
  const home = await civ.getAttribute('data-home')
  const homeTerrain = await p.locator(`[data-testid="asc-world"] li[data-region="${home}"]`).getAttribute('data-terrain')
  const civText = await civ.innerText()
  if (!civText.includes(`home R${home}`) || !/\d+ ≥ \d+/.test(civText)) fail(`prototype: civilization entry lacks home or reason: "${civText}"`)
  if (!(await p.locator(`[data-testid="asc-world"] li[data-region="${home}"]`).innerText()).includes('home of')) fail('prototype: home region is not marked')
  if (!/: .*\+\d/.test(await civ.locator('[data-testid="asc-civ-passive"]').innerText())) fail('prototype: civilization entry lacks its passive')
  if ((await p.locator('[data-testid="asc-civ-next"]').innerText()) !== '12') fail('prototype: second civilization threshold should be 12')

  // its passive: find a selection (single cards, then pairs) that triggers it
  const civLines = p.locator('[data-testid="asc-preview-civ"]')
  const combos = [...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i]), ...[0, 1, 2, 3, 4, 5, 6].flatMap((i) => [1, 2, 3, 4, 5, 6, 7].filter((j) => j > i).map((j) => [i, j]))]
  let picked = null
  for (const combo of combos) {
    for (const i of combo) await cards.nth(i).click()
    if (await civLines.count()) { picked = combo; break }
    await p.click('[data-testid="asc-clear"]')
  }
  if (!picked) fail('prototype: no 1–2 card selection triggers the emerged civilization\'s passive')
  const civLine = await civLines.first().innerText()
  if (!civLine.includes(await civ.locator('[data-testid="asc-civ-passive"] strong').innerText().then((t) => t.replace(':', '')))) fail(`prototype: preview civ line does not name the passive: "${civLine}"`)
  const pvT = p.locator('[data-testid="asc-preview-total"]')
  const civBonus = Number(await pvT.getAttribute('data-civ'))
  const pvScore = Number(await pvT.getAttribute('data-score'))
  const pvPoker = Number((await p.locator('[data-testid="asc-preview"]').innerText()).match(/= (\d+)$/)[1])
  const lineSum = (await civLines.evaluateAll((els) => els.map((e) => Number(e.dataset.amount)))).reduce((x, y) => x + y, 0)
  if (!(civBonus > 0) || lineSum !== civBonus || pvScore !== pvPoker + Number(await pvT.getAttribute('data-land')) + civBonus) fail(`prototype: civ preview ${civBonus} / lines ${lineSum} / total ${pvScore} inconsistent`)
  const scoreBefore = Number(await p.locator('[data-testid="asc-score"]').innerText())
  await p.click('[data-testid="asc-play"]')
  const committed = Number(await p.locator('[data-testid="asc-score"]').innerText()) - scoreBefore
  if (committed !== pvScore) fail(`prototype: committed ${committed} != previewed ${pvScore} with civilization bonus`)
  if (!(await p.locator('[data-testid="asc-last"]').innerText()).includes(`civ ${civBonus}`)) fail('prototype: last play does not show the civilization bonus')
  await p.screenshot({ path: 'shots/ascension-dev-civilization.png' })
  ok('prototype civilizations', `"${civText}" (home terrain ${homeTerrain}); next needs 12; preview "${civLine}" committed exactly (+${pvScore})`)

  // eras: play a balanced strategy through the UI to the end of the first playable
  const readStatsNow = () => p.locator('[data-testid="asc-stats"] [data-stat]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.dataset.stat, +e.dataset.value])))
  const SUIT_STAT = { '♥': 'vitality', '♦': 'prosperity', '♣': 'industry', '♠': 'knowledge' }

  // Fresh game: check crisis forecast block
  const forecast = await p.locator('[data-testid="asc-crisis-forecast"]')
  if (!(await forecast.count())) fail('prototype: crisis forecast missing at start')
  const forecastText = await forecast.innerText()
  if (!forecastText.includes('Harsh Winter')) fail(`prototype: expected "Harsh Winter" forecast, got "${forecastText}"`)
  ok('prototype crisis forecast', 'fresh game shows "Harsh Winter"')

  /** Play a balanced strategy through the UI (resolving each crisis after checking it) until the run ends. */
  const playBalanced = async () => {
    let plays = 0, crises = []
    while (!(await p.locator('[data-testid="asc-complete"], [data-testid="asc-failed"]').count()) && plays < 120) {
      const crisisPanel = p.locator('[data-testid="asc-crisis"]')
      if (await crisisPanel.count()) {
        if ((await cards.count()) || (await p.locator('[data-testid="asc-play"]').count())) fail('prototype: hand and Play must be gone during a crisis')
        const text = await crisisPanel.innerText()
        const sum = (side) => p.locator(`[data-testid="asc-crisis"] [data-testid="asc-factor"][data-side="${side}"]`).evaluateAll((els) => els.reduce((n, e) => n + +e.dataset.amount, 0))
        const [, r, pr, verdict] = text.match(/resilience (\d+) vs pressure (\d+) → (survives|fails) by/) ?? []
        if (!verdict || +r !== (await sum('mitigation')) || +pr !== (await sum('pressure'))) fail(`prototype: crisis verdict does not match its factors: "${text}"`)
        const before = await p.locator('[data-testid="asc-crisis-log"] li').count()
        await p.click('[data-testid="asc-resolve"]')
        const entries = p.locator('[data-testid="asc-crisis-log"] li')
        if ((await entries.count()) !== before + 1) fail('prototype: resolving must log exactly one crisis')
        const result = await entries.last().getAttribute('data-result')
        if (result !== (verdict === 'survives' ? 'survived' : 'failed')) fail(`prototype: logged ${result} but the verdict said ${verdict}`)
        crises.push(`${text.match(/Crisis: ([^\n]+)/)[1]} ${result} ${r}/${pr}`)
        continue
      }
      const reqs = await reqState(), status = await p.locator('[data-testid="asc-era-status"]').innerText()
      if (reqs.some((q) => q.met !== q.have >= q.need)) fail(`prototype: requirement met flag inconsistent: ${JSON.stringify(reqs)}`)
      if (reqs.every((q) => q.met) !== status.startsWith('All requirements met')) fail(`prototype: era status "${status}" contradicts ${JSON.stringify(reqs)}`)
      if (!(await p.locator('[data-testid="asc-crisis-forecast"]').count())) fail('prototype: the coming crisis must be forecast while playing')
      const add = await readStatsNow(), hand = await cards.allInnerTexts(), pick = []
      while (pick.length < 5) {
        const i = hand.map((_, j) => j).filter((j) => !pick.includes(j)).sort((x, y) => add[SUIT_STAT[hand[x].slice(-1)]] - add[SUIT_STAT[hand[y].slice(-1)]] || x - y)[0]
        pick.push(i); add[SUIT_STAT[hand[i].slice(-1)]] += 1
      }
      for (const i of pick) await cards.nth(i).click()
      await p.click('[data-testid="asc-play"]')
      plays += 1
    }
    return { plays, crises }
  }
  const worldKept = async (what) => {
    if ((await cards.count()) || (await p.locator('[data-testid="asc-play"]').count())) fail(`prototype: hand and Play must be gone once ${what}`)
    if (!(await p.locator('[data-testid="asc-civs"] li').count()) || (await p.locator('[data-testid="asc-world"] li[data-terrain]').count()) !== 12) fail(`prototype: world and civilizations must stay visible once ${what}`)
  }

  // qa-asc: a balanced run survives all three crises
  const won = await playBalanced()
  const log = await p.locator('[data-testid="asc-era-log"] li').allInnerTexts()
  if (!(await p.locator('[data-testid="asc-complete"]').count())) fail(`prototype: qa-asc should complete; crises ${JSON.stringify(won.crises)}`)
  if (log.length !== 3 || !log[0].includes('Tribal → Ancient') || !log[1].includes('Ancient → Medieval') || !log[2].includes('Medieval completed')) fail(`prototype: era history wrong: ${JSON.stringify(log)}`)
  const doneText = await p.locator('[data-testid="asc-complete"]').innerText()
  if (!doneText.includes('First playable complete') || !doneText.includes(`end of round ${log[2].match(/End of round (\d+)/)[1]}`)) fail(`prototype: completion block wrong: "${doneText}"`)
  await worldKept('complete')
  await p.screenshot({ path: 'shots/ascension-dev-complete.png', fullPage: true })
  ok('prototype crises survived', `${won.plays} balanced plays; ${won.crises.join(' | ')}; "First playable complete", world kept`)

  // crisis-11: the same balanced strategy loses the Harsh Winter by one point
  await p.click('[data-testid="asc-exit"]')
  await p.click('[data-testid="ascension-entry"]')
  await p.fill('#asc-seed', 'crisis-11')
  await p.click('[data-testid="asc-start"]')
  const lost = await playBalanced()
  const failedText = (await p.locator('[data-testid="asc-failed"]').count()) ? await p.locator('[data-testid="asc-failed"]').innerText() : ''
  if (!failedText.includes('Run over') || !failedText.includes('Harsh Winter') || !failedText.includes('resilience 27 vs pressure 28')) fail(`prototype: crisis-11 should end in the Harsh Winter (27 vs 28): "${failedText}" ${JSON.stringify(lost.crises)}`)
  if (await p.locator('[data-testid="asc-era-log"] li').count()) fail('prototype: a failed crisis must not advance the era')
  await worldKept('failed')
  await p.screenshot({ path: 'shots/ascension-dev-failed.png', fullPage: true })
  ok('prototype crisis failed', `${lost.plays} plays; ${lost.crises.join(' | ')}; "Run over", world kept`)

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
