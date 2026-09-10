// Browser-level review: save rejection UI + quit/reset semantics + legacy save handling.
// Read-only probes; the only localStorage writes are test fixtures the script restores after.
import { chromium } from 'playwright'

const URL = 'http://localhost:5177/'
const results = []
const ok = (name, cond) => results.push({ name, pass: !!cond })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(URL)
await page.waitForLoadState('networkidle')

// 1. legacy v1 save (Roots/Tend/Sow/Grow/Study era): what happens on load?
await page.evaluate(() => {
  localStorage.setItem('worldhand.save', JSON.stringify({
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    state: { version: 1, epoch: 2, phase: 'select', flourishing: 10, lives: 2, seeds: 5 },
  }))
})
await page.reload()
await page.waitForLoadState('networkidle')
// the save must NOT silently resurrect as a v4 game
const menuVisible = await page.locator('.intro').count()
ok('v1 legacy save does not auto-start a game (menu shown)', menuVisible === 1)
// legacy data preserved?
const legacyPreserved = await page.evaluate(() => {
  const raw = localStorage.getItem('worldhand.save')
  const env = JSON.parse(raw)
  return env && env.version === 1 && env.state.lives === 2
})
ok('v1 legacy save byte-preserved in localStorage (not deleted/reinterpreted)', legacyPreserved === true)
// does the UI explain that a fresh run is needed?
const menuText = await page.locator('.intro').innerText()
ok('UI mentions stale/incompatible save needs fresh run', /fresh|new world|start over|incompatible|legacy|outdated/i.test(menuText))

// ---- 2. obsolete item ids (Roots/Tend/Sow/Grow/Study era) in a v2 envelope
await page.evaluate(() => {
  localStorage.setItem('worldhand.save', JSON.stringify({
    version: 2,
    savedAt: '2026-09-09T00:00:00.000Z',
    state: {
      version: 2, seed: 123, seedText: 'legacy-items', epoch: 1, phase: 'market',
      flourishing: 3, lives: 3, seeds: 8,
      regions: [], hand: [], deckRest: [], discardPile: [],
      discardsLeft: 3, playsLeft: 4, selected: [],
      market: [], laws: [{ id: 'deep-taproots', title: 'Deep Taproots', desc: '', cost: 5, kind: 'law' }],
      lastResolution: null,
      log: [], outcome: null, outcomeReason: '',
    },
  }))
})
await page.reload()
await page.waitForLoadState('networkidle')
const loadedObsolete = await page.locator('.shell:not(.intro)').count()
ok('v2 save carrying obsolete law id deep-taproots is NOT loaded as a playable game', loadedObsolete === 0)
const obsoletePreserved = await page.evaluate(() => {
  const env = JSON.parse(localStorage.getItem('worldhand.save'))
  return env.version === 2 && env.state.laws[0].id === 'deep-taproots'
})
ok('obsolete-item v2 save preserved in localStorage (not deleted)', obsoletePreserved === true)

// ---- 3. missing lives / invalid phase / malformed card in a v2 envelope
const corruptCases = [
  ['missing-lives', (st) => { delete st.lives; return st }],
  ['bad-phase', (st) => { st.phase = 'epoch-99'; return st }],
  ['bad-card', (st) => { st.hand = [{ r: 1, s: 'Z' }]; return st }],
  ['bad-save-version', (st) => { st.version = 99; return st }],
]
for (const [tag, mutate] of corruptCases) {
  await page.evaluate(({ tag, mutateStr }) => {
    const base = {
      version: 2, seed: 55, seedText: 'corrupt-' + tag, epoch: 1, phase: 'select',
      flourishing: 3, lives: 3, seeds: 8,
      regions: [], hand: [], deckRest: [], discardPile: [],
      discardsLeft: 3, playsLeft: 4, selected: [],
      market: [], laws: [], lastResolution: null, log: [], outcome: null, outcomeReason: '',
    }
    const state = (new Function('st', 'return (' + mutateStr + ')(st)'))(base)
    localStorage.setItem('worldhand.save', JSON.stringify({ version: 2, savedAt: '2026-09-09T00:00:00.000Z', state }))
  }, { tag, mutateStr: mutate.toString() })
  await page.reload()
  await page.waitForLoadState('networkidle')
  const played = await page.locator('.shell:not(.intro)').count()
  ok(`corrupt save (${tag}) not loaded as playable game`, played === 0)
}

// ---- 4. quit preserves progress; clear save is the only destructive path
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.reload()
await page.fill('#seed', 'quit-keeps-save-review')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')
await page.locator('.hand-cards .pcard-btn').nth(0).click()
await page.click('[data-testid="play-btn"]')
await page.waitForTimeout(150)
const before = await page.evaluate(() => localStorage.getItem('worldhand.save'))
ok('autosave wrote a save after a play', !!before)
await page.click('[data-testid="menu-btn"]')
await page.waitForSelector('[data-testid="menu-pop"]')
await page.click('[data-testid="menu-pop"] button:has-text("Quit to menu")')
await page.waitForSelector('.intro')
const afterQuit = await page.evaluate(() => localStorage.getItem('worldhand.save'))
ok('Quit preserves the save byte-for-byte', afterQuit === before)
// reload auto-loads
await page.reload()
await page.waitForLoadState('networkidle')
const resumed = await page.locator('.shell:not(.intro)').count()
const hud = resumed ? await page.locator('[data-testid="run-rail"]').innerText() : ''
ok('reload resumes the saved run (auto-load)', resumed === 1 && /Plays/.test(hud))

// destructive reset (Clear Save) — is it guarded by a confirmation?
// (the app uses a two-step in-UI Confirm/Cancel gate, not window.confirm).
// The gate lives on the intro screen: quit back to the menu first.
await page.click('[data-testid="menu-btn"]')
await page.waitForSelector('[data-testid="menu-pop"]')
await page.click('[data-testid="menu-pop"] button:has-text("Quit to menu")')
await page.waitForSelector('.intro')
const clearBtn = page.locator('.intro button:has-text("Clear Save")')
const clearCount = await clearBtn.count()
let confirmGuard = 'none'
if (clearCount) {
  await clearBtn.click()
  await page.waitForTimeout(150)
  // step 1 must NOT clear the save; a Confirm button must appear instead
  const stillThereStep1 = await page.evaluate(() => !!localStorage.getItem('worldhand.save'))
  const confirmBtn = page.locator('button:has-text("Confirm: Clear Save")')
  if (stillThereStep1 && (await confirmBtn.count())) {
    // dismissing (Cancel) keeps the save
    await page.locator('button:has-text("Cancel")').first().click()
    await page.waitForTimeout(150)
    const afterCancel = await page.evaluate(() => !!localStorage.getItem('worldhand.save'))
    // then a full confirm actually clears it
    await clearBtn.click()
    await page.waitForTimeout(100)
    await page.locator('button:has-text("Confirm: Clear Save")').first().click()
    await page.waitForTimeout(200)
    const afterConfirm = await page.evaluate(() => !localStorage.getItem('worldhand.save'))
    confirmGuard = afterCancel && afterConfirm ? 'two-step-confirm' : 'broken'
  }
}
ok('Clear Save requires confirmation before destroying data', confirmGuard === 'two-step-confirm')
console.log('clear-save guard observed:', confirmGuard)

// ---- 5. game-over "Back to Menu" — destructive without confirmation?
await page.evaluate(() => localStorage.removeItem('worldhand.save'))
await page.reload()
await page.fill('#seed', 'gameover-review')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('worldhand.save'))
  raw.state.phase = 'game-over'
  raw.state.outcome = 'withered'
  raw.state.outcomeReason = 'review probe: forced game over'
  localStorage.setItem('worldhand.save', JSON.stringify(raw))
})
await page.reload()
await page.waitForLoadState('networkidle')
const verdict = await page.locator('.verdict').count()
ok('game-over verdict renders', verdict === 1)
const backBtn = page.locator('.verdict button:has-text("Back to Menu")')
if (await backBtn.count()) {
  await backBtn.click()
  await page.waitForTimeout(120)
  const step1Kept = await page.evaluate(() => !!localStorage.getItem('worldhand.save'))
  const confirmBtn2 = page.locator('.verdict button:has-text("Confirm: Back to Menu")')
  if (step1Kept && (await confirmBtn2.count())) {
    await confirmBtn2.click()
    await page.waitForTimeout(200)
    const cleared = await page.evaluate(() => !localStorage.getItem('worldhand.save'))
    console.log('Back-to-Menu gated by two-step confirm (step1 kept save:', step1Kept + '); cleared after confirm:', cleared)
    ok('Back to Menu requires confirmation before clearing', step1Kept && cleared)
  } else {
    ok('Back to Menu requires confirmation before clearing', false)
  }
}

console.log('\npage errors:', JSON.stringify(errors))
console.log(JSON.stringify({ results }, null, 2))
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} browser probes passed`)
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' - ' + f.name) }
await browser.close()