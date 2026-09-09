// Autosave probe: perform actions WITHOUT pressing Save, then verify localStorage
// was updated after each committed action, and that quit preserves the save.
import { chromium } from 'playwright'
const URL = 'http://localhost:5177/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(URL)
await page.waitForLoadState('networkidle')
await page.evaluate(() => localStorage.clear())
await page.fill('#seed', 'autosave-probe')
await page.click('text=Begin New World')
await page.waitForSelector('.hand-cards .pcard-btn')

const snap = () => page.evaluate(() => {
  const raw = localStorage.getItem('worldhand.save')
  if (!raw) return null
  const s = JSON.parse(raw).state
  return { playsLeft: s.playsLeft, hand: s.hand.length, logTop: s.log[s.log.length - 1].text, savedAt: JSON.parse(raw).savedAt }
})

// after starting a world, save should exist without pressing Save
let s0 = await snap()
if (!s0 || !s0.logTop.includes('takes root')) throw new Error('new world not auto-saved: ' + JSON.stringify(s0))

// play an action — no Save click
await page.locator('.hand-cards .pcard-btn').nth(0).click()
await page.click('[data-testid="play-btn"]')
await page.waitForTimeout(250)
const s1 = await snap()
if (s1.playsLeft !== 3) throw new Error('play not reflected in autosave: ' + JSON.stringify(s1))

// discard — no Save click
await page.locator('.hand-cards .pcard-btn').nth(0).click()
await page.locator('button:has-text("Discard")').first().click()
await page.waitForTimeout(250)
const s2 = await snap()
if (!/Discarded/.test(s2.logTop)) throw new Error('discard not auto-saved: ' + JSON.stringify(s2))

// quit WITHOUT pressing Save — save must remain at the post-discard state
await page.click('button:has-text("Quit")')
await page.waitForSelector('.intro')
const s3 = await page.evaluate(() => localStorage.getItem('worldhand.save') && JSON.parse(localStorage.getItem('worldhand.save')).state.log.slice(-1)[0].text)
if (!/Discarded/.test(s3)) throw new Error('quit lost the auto-saved state: ' + s3)

// reload restores exactly where we left off
await page.click('text=Load Saved World')
await page.waitForSelector('.hand-cards .pcard-btn')
const plays = await page.locator('.hud-item:has-text("Plays")').innerText()
if (!/3\/4/.test(plays)) throw new Error('reload lost progress: ' + plays)

console.log('AUTOSAVE CHECKS PASSED — post-start, post-play, post-discard saves + quit/reload preserve them; errors:', errors.length === 0 ? '[]' : errors)
await browser.close()