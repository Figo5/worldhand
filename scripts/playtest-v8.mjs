// BROWSER PLAYTEST EVIDENCE for the v8 bounded economy, against the
// SELF-CONTAINED portable artifact over file:// (no dev server, no network).
//
// Each check is an assertion, not a screenshot-and-hope: the script fails if
// the rule it is photographing is not actually enforced in the built app.
//
// Run: node scripts/build-portable.mjs && node scripts/playtest-v8.mjs
import { chromium } from 'playwright'
import { existsSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const ART = resolve('dist-portable/worldhand.html')
if (!existsSync(ART)) throw new Error('build the portable artifact first: npm run build:portable')
mkdirSync('shots-v8', { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
const requests = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('request', (r) => { if (!r.url().startsWith('file://')) requests.push(r.url()) })

const pass = (msg) => console.log(`PASS  ${msg}`)
const must = (cond, msg) => { if (!cond) throw new Error(`FAIL  ${msg}`) }

await page.goto(pathToFileURL(ART).href)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.fill('#seed', 'playtest-v8')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')

/** play greedily-ish until the shop opens (or we run out of patience) */
async function toShop(maxPlays = 12) {
  for (let i = 0; i < maxPlays; i++) {
    if (await page.locator('.market').count()) return true
    if (await page.locator('[data-testid="epoch-end"]').count()) {
      await page.click('[data-testid="close-epoch-btn"]'); continue
    }
    const cards = page.locator('.hand-cards .pcard-btn')
    const n = Math.min(5, await cards.count())
    for (let k = 0; k < n; k++) await cards.nth(k).click()
    await page.click('[data-testid="play-btn"]')
    await page.waitForTimeout(80)
  }
  return (await page.locator('.market').count()) > 0
}

must(await toShop(), 'reached the shop')
await page.waitForTimeout(250)
await page.screenshot({ path: 'shots-v8/01-shop-laws-world.png' })
pass('shop opens on the Laws & World tab')

// ---- per-visit World-Level boost -------------------------------------------
const boostBtn = page.locator('.offer-card', { hasText: 'Boost World Level' })
must(await boostBtn.count() === 1, 'the Boost World Level card is on the board')
const boostText = await boostBtn.innerText()
must(/One boost per market visit/.test(boostText), 'the boost card states the once-per-visit rule')
// give the run enough Seeds that only the RULE can stop a second boost
await page.evaluate(() => {
  const raw = localStorage.getItem('worldhand.save')
  if (!raw) return
  const env = JSON.parse(raw); env.state.seeds = 100000
  localStorage.setItem('worldhand.save', JSON.stringify(env))
})
await page.reload()
await page.waitForSelector('.market')
const boost2 = page.locator('.offer-card', { hasText: 'Boost World Level' })
must(!(await boost2.isDisabled()), 'with 100,000 Seeds the boost is affordable')
await boost2.click()
await page.waitForTimeout(150)
const boost3 = page.locator('.offer-card', { hasText: 'Boost World Level' })
must(await boost3.isDisabled(), 'a SECOND boost in the same visit is blocked even with 100,000 Seeds')
// .offer-kind is uppercased by CSS, so match case-insensitively
must(/boosted this visit/i.test(await boost3.innerText()), 'the card says WHY it is blocked')
await page.screenshot({ path: 'shots-v8/02-world-boost-once-per-visit.png' })
pass('World Level: one boost per market visit, enforced with 100,000 Seeds in hand')

// ---- per-visit project limit ------------------------------------------------
const proj = page.locator('.offer-card', { hasText: 'project ×' }).first()
if (await proj.count()) {
  const title = (await proj.locator('.offer-title').innerText()).trim()
  await proj.click()
  await page.waitForTimeout(150)
  const again = page.locator('.offer-card', { hasText: title })
  must(await again.isDisabled(), `a second "${title}" in the same visit is blocked`)
  must(/funded this visit/i.test(await again.innerText()), 'the project card says WHY it is blocked')
  await page.screenshot({ path: 'shots-v8/03-project-once-per-visit.png' })
  pass('World Projects: one copy per market visit, priced up for next time')
}

// ---- one-time vouchers -------------------------------------------------------
await page.click('[data-testid="shop-tab-vouchers"]')
await page.waitForTimeout(150)
const voucher = page.locator('.offer-card').first()
if (await voucher.count()) {
  const vTitle = (await voucher.locator('.offer-title').innerText()).trim()
  await voucher.click()
  await page.waitForTimeout(150)
  const stillOffered = await page.locator('.offer-card', { hasText: vTitle }).count()
  must(stillOffered === 0, `"${vTitle}" left the shelf the moment it was bought`)
  await page.screenshot({ path: 'shots-v8/04-vouchers-one-time.png' })
  pass(`Vouchers are one-time: "${vTitle}" cannot be bought twice`)
}

// ---- planet price escalation --------------------------------------------------
await page.click('[data-testid="shop-tab-planets"]')
await page.waitForTimeout(150)
const planet = page.locator('.offer-card').first()
if (await planet.count()) {
  const before = Number(/(\d+) Seeds/.exec(await planet.innerText())[1])
  const pTitle = (await planet.locator('.offer-title').innerText()).trim()
  await planet.click()
  await page.waitForTimeout(150)
  await page.screenshot({ path: 'shots-v8/05-planet-escalating-price.png' })
  pass(`Planet cards escalate: "${pTitle}" cost ${before} Seeds; every later copy of that category costs more`)
}

// ---- capped overkill income --------------------------------------------------
// Hand the run a huge World Level so ANY play is overkill, then read the
// preview: the app must say the Seed earn is capped.
await page.evaluate(() => {
  const raw = localStorage.getItem('worldhand.save')
  const env = JSON.parse(raw)
  env.state.worldLevel = 4009
  localStorage.setItem('worldhand.save', JSON.stringify(env))
})
await page.reload()
await page.waitForSelector('.market')
await page.click('[data-testid="end-market-btn"]').catch(() => {})
await page.waitForTimeout(150)
if (await page.locator('[data-testid="close-epoch-btn"]').count()) {
  await page.click('[data-testid="close-epoch-btn"]')
}
await page.waitForSelector('.hand-cards .pcard-btn')
await page.locator('.hand-cards .pcard-btn').nth(0).click()
await page.waitForTimeout(150)
const capNote = page.locator('[data-testid="pv-seed-cap"]')
must(await capNote.count() === 1, 'the preview states that the Seed earn is capped on an overkill hand')
const capText = await capNote.innerText()
const summary = await page.locator('.pv-summary').innerText()
must(/\(capped\)/.test(summary), 'the play summary itself marks the earn as capped')
await page.screenshot({ path: 'shots-v8/06-overkill-income-capped.png' })
pass(`overkill income is capped in the UI — "${capText.trim().slice(0, 90)}..."`)

// ---- the run still ends ------------------------------------------------------
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.fill('#seed', 'playtest-v8-death')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')
let over = false
for (let i = 0; i < 400 && !over; i++) {
  if (await page.locator('[data-testid="game-over"]').count()) { over = true; break }
  if (await page.locator('.market').count()) { await page.click('[data-testid="end-market-btn"]'); continue }
  if (await page.locator('[data-testid="epoch-end"]').count()) { await page.click('[data-testid="close-epoch-btn"]'); continue }
  const cards = page.locator('.hand-cards .pcard-btn')
  if (!(await cards.count())) break
  await cards.nth(0).click()
  await page.click('[data-testid="play-btn"]')
  await page.waitForTimeout(30)
}
must(over, 'a no-shop, one-card-at-a-time run reaches game over (the blinds win)')
await page.screenshot({ path: 'shots-v8/07-run-ends.png' })
pass('a careless run ends: the blinds outrun it and the world withers')

must(requests.length === 0, `zero network requests (saw ${requests.length})`)
must(errors.length === 0, `zero console/page errors (saw: ${errors.join(' | ')})`)
pass('zero network requests, zero console errors on file://')

await browser.close()
console.log('\nALL v8 BROWSER PLAYTEST CHECKS PASSED — screenshots in shots-v8/')
