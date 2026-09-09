// Planet3D acceptance: the three.js globe mounts, the region legend selects
// regions (map-detail updates), the globe canvas is keyboard-operable, the
// scene really renders (WebGL pixel sample), reduced-motion disables rotation,
// and the view fits wide + narrow without overflow. Screenshots land in
// shots-review/planet3d-*.png.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://127.0.0.1:5177'
const OUT = 'shots-review'
mkdirSync(OUT, { recursive: true })
const errors = []
const rec = (k, v) => console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)

const browser = await chromium.launch()

async function runViewport(width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ` + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ` + m.text()) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.fill('#seed', 'auralia-the-first')
  await page.click('text=Begin New World')

  // 1) the globe canvas mounts
  await page.waitForSelector('canvas.planet3d-canvas', { timeout: 10000 })
  const canvasBox = await page.locator('canvas.planet3d-canvas').boundingBox()
  rec(`[${tag}] canvas-box`, canvasBox && { w: Math.round(canvasBox.width), h: Math.round(canvasBox.height) })
  if (!canvasBox || canvasBox.width < 200 || canvasBox.height < 200) throw new Error(`globe canvas too small at ${tag}`)

  // wait for frames to render, then confirm the canvas actually has pixels
  await page.waitForTimeout(1200)
  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas.planet3d-canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return 'no-gl-context'
    const px = new Uint8Array(4)
    // sample a few points; a rendered space scene is not uniformly blank
    const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.6], [0.4, 0.75]]
    const colours = new Set()
    for (const [x, y] of pts) {
      gl.readPixels(Math.floor(c.width * x), Math.floor(c.height * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      colours.add([...px].join(','))
    }
    return { distinct: colours.size, samples: [...colours] }
  })
  rec(`[${tag}] canvas-pixels`, painted)
  if (typeof painted === 'object' && painted.distinct < 2) throw new Error(`globe canvas appears blank at ${tag}`)

  // 2) legend selects a region → map-detail updates
  await page.locator('.region-btn').nth(3).click()
  await page.waitForSelector('[data-testid="map-detail"]')
  const detail1 = await page.locator('[data-testid="map-detail"]').innerText()
  rec(`[${tag}] map-detail(Thessaly)`, detail1.replace(/\n/g, ' | '))
  if (!/^Thessaly/.test(detail1.trim()) || !/neighbors:/.test(detail1)) throw new Error(`map-detail wrong after legend select at ${tag}`)
  const selCount = await page.locator('.region-btn.sel').count()
  if (selCount !== 1) throw new Error(`expected exactly 1 selected legend button at ${tag}, got ${selCount}`)

  // switch to another region — detail follows
  await page.locator('.region-btn').nth(9).click()
  const detail2 = await page.locator('[data-testid="map-detail"]').innerText()
  rec(`[${tag}] map-detail(Brumal)`, detail2.replace(/\n/g, ' | '))
  if (!/^Brumal/.test(detail2.trim())) throw new Error(`map-detail did not follow legend selection at ${tag}`)

  // 3) keyboard: focus the globe canvas, arrow-key to the next region
  await page.locator('canvas.planet3d-canvas').focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(120)
  const detailKb = await page.locator('[data-testid="map-detail"]').innerText()
  rec(`[${tag}] keyboard-arrow-detail`, detailKb.replace(/\n/g, ' | '))
  if (!/neighbors:/.test(detailKb)) throw new Error(`keyboard navigation did not update map-detail at ${tag}`)

  // 4) click directly on the globe canvas (raycast) — centre-ish of the canvas
  const box = await page.locator('canvas.planet3d-canvas').boundingBox()
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.55)
  await page.waitForTimeout(120)
  const detailClick = await page.locator('[data-testid="map-detail"]').innerText().catch(() => 'NO_CHANGE')
  rec(`[${tag}] canvas-click-detail`, detailClick.replace(/\n/g, ' | '))

  await page.screenshot({ path: `${OUT}/planet3d-${tag}.png`, fullPage: false })

  // 5) overflow check at this viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) throw new Error(`horizontal overflow at ${width}x${height}`)

  await page.close()
}

await runViewport(1280, 800, 'wide')
await runViewport(480, 800, 'narrow')

// 6) reduced motion: auto-rotation must stop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  page.on('pageerror', (e) => errors.push('[reduced] pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[reduced] console: ' + m.text()) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.fill('#seed', 'auralia-the-first')
  await page.click('text=Begin New World')
  await page.waitForSelector('canvas.planet3d-canvas')
  await page.waitForTimeout(800)
  const sample = () => page.evaluate(() => {
    const c = document.querySelector('canvas.planet3d-canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    const px = new Uint8Array(4)
    gl.readPixels(Math.floor(c.width * 0.3), Math.floor(c.height * 0.4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return [...px].join(',')
  })
  // with rotation disabled the same pixel should stay stable across a gap
  const a = await sample()
  await page.waitForTimeout(1500)
  const b = await sample()
  rec('[reduced] pixel-stable', { a, b, same: a === b })
  if (a !== b) throw new Error('globe still appears to auto-rotate under prefers-reduced-motion')

  // with rotation stopped, region 1 (Veymark, lat 34, lon -45) projects to a
  // deterministic canvas point (fov 42, camera (0,1.25,3.3), tilt -0.18):
  // fraction ≈ (0.274, 0.308). A click there must select Veymark via raycast.
  const box = await page.locator('canvas.planet3d-canvas').boundingBox()
  const px = box.x + box.width * 0.274
  const py = box.y + box.height * 0.308
  await page.mouse.move(px, py)
  await page.waitForTimeout(150)
  const cursor = await page.evaluate(() => document.querySelector('canvas.planet3d-canvas').style.cursor)
  rec('[reduced] hover-cursor', cursor)
  if (cursor !== 'pointer') throw new Error(`hover over a patch should set cursor pointer, got "${cursor}"`)
  await page.mouse.click(px, py)
  await page.waitForTimeout(150)
  const rayDetail = await page.locator('[data-testid="map-detail"]').innerText().catch(() => 'NO_DETAIL')
  rec('[reduced] raycast-click-detail', rayDetail.replace(/\n/g, ' | '))
  if (!/^Veymark/.test(rayDetail.trim())) throw new Error(`raycast click did not select Veymark, got: ${rayDetail}`)

  // corner of the canvas is open space → grab cursor, no selection
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.05)
  await page.waitForTimeout(100)
  const cursor2 = await page.evaluate(() => document.querySelector('canvas.planet3d-canvas').style.cursor)
  if (cursor2 !== 'grab') throw new Error(`hover over space should keep grab cursor, got "${cursor2}"`)

  await page.screenshot({ path: `${OUT}/planet3d-reduced-motion.png`, fullPage: false })
  await page.close()
}

await browser.close()
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
console.log('PLANET3D CHECKS PASSED')