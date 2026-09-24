// Browser QA and human-like playtesting of Ascension, driven through the real UI.
//
// The script keeps a mirror of the run in Node (the same pure engine), lets a
// harness bot choose each action as a "persona", performs that action by
// clicking the rendered UI like a player would, and after every step checks
// that what the screen shows (hands, score, Influence, phase) is the engine's
// state. It also checks the mode menu, Classic, save/resume across a reload,
// backups, the summary, the Chronicle, the mobile layout and console errors,
// and writes screenshots to shots/ascension/.
//
//   npm run build && node --import ./scripts/ts-resolve.mjs scripts/qa-ascension.mjs [baseURL] [personas]
// Without a baseURL it serves dist/ with `vite preview` (the production build).
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BOTS, drive } from './lib/asc-bots.mjs'
import { applyAction, newRun, runStatus } from '../src/engine/ascension/ascension.ts'
import { newProfile, poolOf } from '../src/engine/ascension/profile.ts'

const ROOT = resolve(import.meta.dirname, '..')
const SHOTS = resolve(ROOT, 'shots', 'ascension')
mkdirSync(SHOTS, { recursive: true })
let base = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : null
const personas = (process.argv.find((a, i) => i >= 2 && !a.startsWith('http')) ?? 'planner,mediocre').split(',')
let server = null
if (!base) {
  server = spawn('npx', ['vite', 'preview', '--port', '5188', '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' })
  base = 'http://127.0.0.1:5188/'
  await new Promise((done, fail) => {
    const t = setTimeout(() => fail(new Error('vite preview did not start')), 20000)
    server.stdout.on('data', (d) => { if (String(d).includes('5188')) { clearTimeout(t); done() } })
  })
}
const browser = await chromium.launch()
const results = []
const failures = []
const ok = (name, extra = '') => { const line = `PASS  ${name}${extra ? ' — ' + extra : ''}`; results.push(line); console.log(line) }
const bad = (name, extra = '') => { const line = `FAIL  ${name}${extra ? ' — ' + extra : ''}`; failures.push(line); console.log(line) }
const check = (cond, name, extra) => (cond ? ok(name, extra) : bad(name, extra))

async function open(width, height, hash = '') {
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()))
  await page.goto(base + hash)
  return { ctx, page, errors }
}
const text = async (page, id) => (await page.locator(`[data-testid="${id}"]`).first().textContent())?.trim()
const num = (s) => Number(String(s).replace(/[^0-9-]/g, ''))

/** Perform one engine action through the UI. */
async function perform(page, state, a) {
  if (a.type === 'play' || a.type === 'discard') {
    for (const i of a.cards) await page.locator('[data-testid="asc-card"]').nth(i).click()
    await page.locator(`[data-testid="asc-${a.type}"]`).click()
  } else if (a.type === 'face') {
    await page.locator('[data-testid="asc-face"]').click()
    const confirm = page.locator('[data-testid="asc-face-confirm"]')
    if (await confirm.count()) await confirm.click()
    await page.locator('[data-testid="asc-moment-continue"]').click()
  } else if (a.type === 'legendary') {
    if (a.pick === null) await page.getByRole('button', { name: 'Take none' }).click()
    else await page.locator('[data-testid="asc-legend-offer"]').nth(a.pick).getByRole('button', { name: 'Take it' }).click()
  } else if (a.type === 'buy') {
    await page.locator('[data-testid="asc-offer"]').nth(a.offer).locator('[data-testid="asc-buy"]').click()
    if (a.target !== undefined) {
      const o = state.council.offers[a.offer]
      const picker = page.locator('[data-testid="asc-target"] .picker button')
      if (typeof a.target === 'number') {
        const { REGION_NAMES } = await import('../src/engine/ascension/world.ts')
        const name = o.id === 'patronage' ? state.civilizations.find((c) => c.id === a.target).name : REGION_NAMES[a.target]
        await picker.filter({ hasText: name }).first().click()
      } else {
        await picker.filter({ hasText: { H: '♥', D: '♦', C: '♣', S: '♠' }[a.target] }).first().click()
      }
    }
  } else if (a.type === 'reroll') await page.locator('[data-testid="asc-reroll"]').click()
  else if (a.type === 'leave') await page.locator('[data-testid="asc-leave"]').click()
  else throw new Error(`the QA driver cannot perform ${a.type}`)
}

/** The screen agrees with the engine. */
async function agree(page, s) {
  const st = runStatus(s)
  if (st === 'won' || st === 'lost') return (await page.locator('[data-testid="asc-summary"]').getAttribute('data-result')) === s.phase
  if (st === 'council') return (await page.locator('[data-testid="asc-council"]').count()) === 1 && num(await text(page, 'asc-influence')) === s.influence
  return num(await text(page, 'asc-hands')) === s.handsLeft && num(await text(page, 'asc-score')) === s.score && num(await text(page, 'asc-influence')) === s.influence
}

/** Play one whole run through the UI as `persona`. */
async function playRun(page, persona, seedText, { shots = false, reloadAt = -1, maxSteps = 400 } = {}) {
  await page.locator('[data-testid="asc-new"]').click()
  await page.fill('[data-testid="asc-seed"]', seedText)
  await page.locator('[data-testid="asc-begin"]').click()
  await page.waitForSelector('[data-testid="asc-card"]')
  let s = newRun({ seedText, omen: 0, origin: 'pangaea', pool: poolOf(newProfile()) })
  const bot = BOTS[persona]
  let steps = 0, mismatches = 0, lastEra = -1, reloaded = false
  while (s.phase !== 'won' && s.phase !== 'lost' && steps < maxSteps) {
    const st = runStatus(s)
    let a = st === 'crisis' ? { type: 'face' } : st === 'council' ? bot.council(s) : bot.play(s)
    let next
    try { next = applyAction(s, a) } catch { a = { type: 'leave' }; next = applyAction(s, a) }
    if (shots && s.era !== lastEra && st === 'playing') { lastEra = s.era; await page.waitForTimeout(2700); await page.screenshot({ path: `${SHOTS}/${persona}-era${s.era}.png` }) }
    if (shots && st === 'council' && !s.council.offers.some((o) => o.sold) && a.type !== 'legendary') await page.screenshot({ path: `${SHOTS}/${persona}-council${s.era}.png`, fullPage: true })
    if (shots && a.type === 'face') {
      await page.locator('[data-testid="asc-face"]').click()
      const confirm = page.locator('[data-testid="asc-face-confirm"]')
      if (await confirm.count()) { await page.screenshot({ path: `${SHOTS}/${persona}-confirm${s.era}.png` }); await confirm.click() }
      await page.waitForSelector('[data-testid="asc-moment"]')
      await page.screenshot({ path: `${SHOTS}/${persona}-crisis${s.era}.png` })
      await page.locator('[data-testid="asc-moment-continue"]').click()
    } else await perform(page, s, a)
    s = next
    steps += 1
    if (!(await agree(page, s))) mismatches += 1
    if (steps === reloadAt && !reloaded) {
      reloaded = true
      await page.reload()
      await page.waitForSelector('[data-testid="asc-topbar"], [data-testid="asc-council"]')
      check(await agree(page, s), 'save/resume — a reload mid-run resumes the exact state', `step ${steps}, ${s.phase === 'council' ? 'at the Council' : `${s.handsLeft} hands left, score ${s.score}`}`)
    }
  }
  return { s, steps, mismatches }
}

try {
  // ---- the mode menu and Classic -------------------------------------------
  {
    const { ctx, page, errors } = await open(1280, 820)
    await page.waitForSelector('[data-testid="mode-menu"]')
    check(await page.locator('[data-testid="mode-ascension"]').count() === 1 && await page.locator('[data-testid="mode-classic"]').count() === 1, 'mode menu — Classic and Ascension are both offered in the production build')
    await page.screenshot({ path: `${SHOTS}/modes.png` })
    await page.locator('[data-testid="mode-classic"]').click()
    await page.waitForSelector('#seed')
    check(page.url().endsWith('#classic'), 'Classic — opens from the menu (#classic)')
    await page.locator('[data-testid="classic-to-modes"]').click()
    await page.waitForSelector('[data-testid="mode-menu"]')
    ok('Classic — returns to the mode menu')
    check(errors.length === 0, 'mode menu console — no errors', errors.join(' | '))
    await ctx.close()
  }

  // ---- full runs as personas, with a reload mid-run -------------------------
  for (const [i, persona] of personas.entries()) {
    const { ctx, page, errors } = await open(1440, 900, '#ascension')
    await page.waitForSelector('[data-testid="asc-hub"]')
    if (i === 0) await page.screenshot({ path: `${SHOTS}/hub.png` })
    const seed = `qa-${persona}`
    const expected = drive({ seedText: seed, omen: 0, origin: 'pangaea', pool: poolOf(newProfile()) }, BOTS[persona])
    const { s, steps, mismatches } = await playRun(page, persona, seed, { shots: i === 0, reloadAt: 9 })
    check(mismatches === 0, `${persona} — every screen matched the engine`, `${steps} actions, ${mismatches} mismatches`)
    check(s.phase === expected.phase && s.score === expected.score, `${persona} — the UI run equals the headless run of the same bot`, `${s.phase} in the ${['Tribal', 'Ancient', 'Medieval', 'Industrial', 'Information', 'Stellar'][s.era]} age, score ${s.score}`)
    await page.waitForSelector('[data-testid="asc-summary"]')
    await page.screenshot({ path: `${SHOTS}/${persona}-summary.png`, fullPage: true })
    const title = await text(page, 'asc-summary-title')
    check(!!title && (await page.locator('[data-testid="asc-chronicle"] li').count()) > 3, `${persona} — summary and Chronicle`, `“${title}”`)
    if (i === 0) {
      // play again: same seed, fresh run
      await page.locator('[data-testid="asc-play-again"]').click()
      await page.waitForSelector('[data-testid="asc-topbar"]')
      check(num(await text(page, 'asc-score')) === 0 && num(await text(page, 'asc-hands')) > 0, 'play again — a fresh run on the same seed')
      // the Chronicle overlay during a run
      await page.locator('[data-testid="asc-open-chronicle"]').click()
      check(await page.locator('[data-testid="asc-chronicle"] li').count() > 0, 'Chronicle — opens during a run')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Close' }).click()
      // past worlds: the finished run is in the history
      await page.locator('[data-testid="asc-menu"]').click()
      await page.locator('[data-testid="asc-open-history"]').click()
      await page.getByRole('button', { name: 'Read its Chronicle' }).first().click()
      check(await page.locator('[data-testid="asc-chronicle"] li').count() > 3, 'past worlds — a finished run replays into its Chronicle')
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      // encyclopedia
      await page.locator('[data-testid="asc-open-collection"]').click()
      await page.screenshot({ path: `${SHOTS}/encyclopedia.png`, fullPage: true })
      check(await page.locator('[data-testid="asc-entry"]').count() >= 30, 'encyclopedia — lists the world cards')
      await page.getByRole('tab', { name: 'Achievements' }).click()
      check(await page.locator('[data-testid="asc-achievement"][data-earned="true"]').count() >= 1, 'profile — the finished run earned an achievement')
      await page.locator('[data-testid="asc-back"]').click()
      // backups: export, a junk import is refused, the real one is accepted
      await page.locator('[data-testid="asc-open-settings"]').click()
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid="asc-export"]').click()])
      const backup = resolve(SHOTS, 'backup.json')
      await dl.saveAs(backup)
      const junk = resolve(SHOTS, 'junk.json')
      writeFileSync(junk, '{"kind":"worldhand-ascension-backup","run":{"kind":"worldhand-ascension-run","schema":1,"rules":10,"content":1,"setup":{},"actions":[{"type":"face"}]}}')
      await page.setInputFiles('[data-testid="asc-import-input"]', junk)
      await page.waitForTimeout(200)
      const refused = await page.locator('[data-testid="asc-data-notice"]').textContent()
      await page.setInputFiles('[data-testid="asc-import-input"]', backup)
      await page.waitForTimeout(200)
      const accepted = await page.locator('[data-testid="asc-data-notice"]').textContent()
      check(/cannot be resumed|Nothing was changed/.test(refused ?? '') && /Imported/.test(accepted ?? ''), 'backups — export, a bad file refused without damage, the real file imported', `${refused?.slice(0, 60)} / ${accepted?.slice(0, 40)}`)
      // a second device: a fresh browser with the imported backup
      const other = await browser.newContext({ viewport: { width: 1280, height: 820 } })
      const p2 = await other.newPage()
      await p2.goto(base + '#ascension')
      await p2.waitForSelector('[data-testid="asc-hub"]')
      await p2.locator('[data-testid="asc-open-settings"]').click()
      await p2.setInputFiles('[data-testid="asc-import-input"]', backup)
      await p2.getByRole('button', { name: 'Back', exact: true }).click()
      check(await p2.locator('[data-testid="asc-continue"]').count() === 1, 'backups — a second device continues the imported run')
      await other.close()
    }
    check(errors.length === 0, `${persona} — zero console errors, zero failed requests`, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }

  // ---- mobile ---------------------------------------------------------------
  {
    const { ctx, page, errors } = await open(390, 844, '#ascension')
    await page.waitForSelector('[data-testid="asc-hub"]')
    await page.screenshot({ path: `${SHOTS}/mobile-hub.png` })
    const { s } = await playRun(page, 'planner', 'qa-mobile', { maxSteps: 12 })
    await page.waitForTimeout(2700)
    await page.screenshot({ path: `${SHOTS}/mobile-run.png` })
    await page.screenshot({ path: `${SHOTS}/mobile-run-full.png`, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(overflow <= 0, 'mobile 390×844 — no horizontal overflow', `overflow ${overflow}px, ${s.plays} plays in`)
    await page.locator('[data-testid="asc-card"]').first().click()
    const box = await page.locator('[data-testid="asc-card"]').first().boundingBox()
    check(box && box.width >= 40, 'mobile — cards are tappable', `${Math.round(box?.width ?? 0)}px wide`)
    check(await page.locator('[data-testid="asc-globe"]').count() === 1, 'mobile — the globe mounts')
    check(errors.length === 0, 'mobile — zero console errors', errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  server?.kill()
}
console.log(failures.length ? `\n${failures.length} CHECK(S) FAILED` : '\nALL ASCENSION BROWSER CHECKS PASSED')
process.exit(failures.length ? 1 : 0)
