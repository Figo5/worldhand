import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Region } from '../engine/worldhand'
import { STABILITY_MAX } from '../engine/worldhand'

/* =========================================================================
   Planet3D — a living 3D globe (three.js) that replaces the SVG planet disc
   as the primary world view. The world is simulated presentationally only:
   every value shown comes from the pure engine state (Region[]); no engine
   mechanics were added or changed.
   ========================================================================= */

/** Terrain → patch colour (mirrors the documented terrain palette). */
const TERRAIN_COLORS: Record<string, number> = {
  meadow: 0x7cb342,
  coast: 0x4fc3f7,
  highland: 0xa1887f,
  forest: 0x2e7d32,
  steppe: 0xd4b106,
  wetland: 0x00897b,
}

/** Terrain → evolution-icon recipes: groves, farms, workshops, settlements,
 *  observatories — they appear/grow/scatter with development (awake) or go
 *  dim/desaturated (dormant). */
type IconKind = 'tree' | 'farm' | 'workshop' | 'observatory' | 'house'
type IconRecipe = { kind: IconKind; count: number; color: number; height: number }
const RECIPES: Record<string, IconRecipe[]> = {
  forest: [
    { kind: 'tree', count: 10, color: 0x3f9142, height: 1.0 }, // groves
    { kind: 'observatory', count: 2, color: 0x8be9ff, height: 1.0 }, // knowledge
  ],
  meadow: [
    { kind: 'farm', count: 8, color: 0xd8e26a, height: 1.0 }, // food
    { kind: 'house', count: 5, color: 0xf2f0d8, height: 1.0 }, // settlements
  ],
  wetland: [
    { kind: 'farm', count: 6, color: 0x9fe0cf, height: 1.0 }, // food
    { kind: 'observatory', count: 2, color: 0x8be9ff, height: 1.0 }, // knowledge
  ],
  coast: [
    { kind: 'workshop', count: 7, color: 0xffb36b, height: 1.0 }, // industry
    { kind: 'house', count: 6, color: 0xfff4d6, height: 1.0 }, // settlements
  ],
  highland: [
    { kind: 'workshop', count: 6, color: 0xffb36b, height: 1.0 }, // industry
    { kind: 'observatory', count: 3, color: 0x8be9ff, height: 1.15 }, // knowledge
  ],
  steppe: [
    { kind: 'house', count: 8, color: 0xfff4d6, height: 1.0 }, // settlements
    { kind: 'farm', count: 5, color: 0xd8e26a, height: 1.0 }, // food
  ],
}

/** Dormant tint: everything fades toward this desaturated grey. */
const DORMANT_TINT = new THREE.Color(0x5b636b)
const R = 1 // globe radius
const DEG = Math.PI / 180
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Deterministic region anchor on the globe: 3 latitude bands × 4 rows. */
function patchLatLon(id: number): { lat: number; lon: number } {
  const row = id % 4
  const band = Math.floor(id / 4) // 0..2 → north..south
  const lat = 34 - band * 34
  const lon = -135 + row * 90 + (band % 2) * 45
  return { lat, lon }
}

/** Spherical-cap (terrain patch) geometry, local +Y as the cap pole.
 *  Rim vertex positions are appended to `rimOut` for the outline loop. */
function capGeometry(radDeg: number, rimOut: THREE.Vector3[]): THREE.BufferGeometry {
  const maxAng = radDeg * DEG
  const SEG = 12
  const RING = 14
  const positions: number[] = [0, R * 1.003, 0]
  const indices: number[] = []
  for (let i = 1; i <= SEG; i++) {
    const ang = (i / SEG) * maxAng
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    for (let j = 0; j < RING; j++) {
      const th = (j / RING) * Math.PI * 2
      const x = sa * Math.cos(th)
      const z = sa * Math.sin(th)
      const y = ca
      positions.push(x * R * 1.003, y * R * 1.003, z * R * 1.003)
      if (i === SEG) rimOut.push(new THREE.Vector3(x * R * 1.006, y * R * 1.006, z * R * 1.006))
    }
  }
  for (let j = 0; j < RING; j++) indices.push(0, 1 + ((j + 1) % RING), 1 + j)
  for (let i = 0; i < SEG - 1; i++) {
    const a0 = 1 + i * RING
    const b0 = 1 + (i + 1) * RING
    for (let j = 0; j < RING; j++) {
      const j1 = (j + 1) % RING
      indices.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

/** Tiny surface development icon: a Group (base at origin, grows along +Y). */
function buildIcon(kind: IconKind, color: number): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 1 })
  const group = new THREE.Group()
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    if (rx) m.rotation.x = rx
    group.add(m)
  }
  if (kind === 'tree') {
    const trunk = new THREE.CylinderGeometry(0.008, 0.01, 0.045, 5)
    trunk.translate(0, 0.0225, 0)
    const crown = new THREE.ConeGeometry(0.045, 0.12, 6)
    crown.translate(0, 0.105, 0)
    add(trunk)
    add(crown)
  } else if (kind === 'farm') {
    const plate = new THREE.BoxGeometry(0.1, 0.012, 0.08)
    plate.translate(0, 0.006, 0)
    add(plate)
    for (let k = 0; k < 3; k++) {
      const row = new THREE.CylinderGeometry(0.008, 0.008, 0.075, 4)
      row.rotateZ(Math.PI / 2)
      row.translate(-0.03 + k * 0.03, 0.024, 0)
      add(row)
    }
  } else if (kind === 'workshop') {
    const body = new THREE.BoxGeometry(0.06, 0.05, 0.055)
    body.translate(0, 0.025, 0)
    const stack = new THREE.BoxGeometry(0.02, 0.035, 0.02)
    stack.translate(0.02, 0.0575, 0)
    add(body)
    add(stack)
  } else if (kind === 'observatory') {
    const base = new THREE.CylinderGeometry(0.03, 0.034, 0.04, 8)
    base.translate(0, 0.02, 0)
    const dome = new THREE.SphereGeometry(0.026, 8, 6)
    dome.translate(0, 0.052, 0)
    add(base)
    add(dome)
  } else {
    // house / settlement block
    const body = new THREE.BoxGeometry(0.05, 0.045, 0.05)
    body.translate(0, 0.0225, 0)
    const roof = new THREE.ConeGeometry(0.042, 0.03, 4)
    roof.translate(0, 0.06, 0)
    roof.rotateY(Math.PI / 4)
    add(body)
    add(roof)
  }
  group.scale.setScalar(0.001) // grows in via evolve()
  return { group, mat }
}

export interface Planet3DProps {
  regions: Region[]
  focus: number | null
  onFocus: (id: number) => void
}

export default function Planet3D({ regions, focus, onFocus }: Planet3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const focusRef = useRef(focus)
  const regionsRef = useRef(regions)
  const onFocusRef = useRef(onFocus)
  useEffect(() => { focusRef.current = focus }, [focus])
  useEffect(() => { regionsRef.current = regions }, [regions])
  useEffect(() => { onFocusRef.current = onFocus }, [onFocus])

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const reducedRef = useRef(reduced)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 1.25, 3.3)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      // preserveDrawingBuffer keeps the frame readable (toDataURL/readPixels)
      // so acceptance scripts can verify the scene actually renders.
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
    } catch {
      // No WebGL in this browser: hide the canvas; the accessible region
      // legend + map-detail panel below remain fully functional.
      if (canvasRef.current) canvasRef.current.style.display = 'none'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // ---------- space: starfield + atmosphere ----------
    scene.add(new THREE.AmbientLight(0x445566, 0.9))
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.0)
    sun.position.set(5, 3, 4)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x8fb7ff, 0.4)
    fill.position.set(-4, -2, -3)
    scene.add(fill)

    const starGeo = new THREE.BufferGeometry()
    const STAR_N = 900
    const starPos = new Float32Array(STAR_N * 3)
    for (let i = 0; i < STAR_N; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(
        16 + Math.random() * 20,
        Math.acos(2 * Math.random() - 1),
        Math.random() * Math.PI * 2,
      )
      starPos[i * 3] = v.x
      starPos[i * 3 + 1] = v.y
      starPos[i * 3 + 2] = v.z
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbcd6ff, size: 0.055 })))

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.13, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x7db8f5, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false }),
    )
    scene.add(atmosphere)

    // ---------- ocean base + tilted, slowly spinning world ----------
    // Planet visual growth: the globe scale follows total development of
    // living regions (engine `development` + awakenings) — the world visibly
    // grows as the civilization gets smarter. Presentation only.
    const planetScaleGroup = new THREE.Group()
    const ocean = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d2b4d, roughness: 0.55, metalness: 0.1 }),
    )
    ocean.name = 'planet-ocean'
    const tilt = new THREE.Group()
    tilt.rotation.z = -0.18
    planetScaleGroup.add(tilt)
    scene.add(planetScaleGroup)

    const world = new THREE.Group()
    tilt.add(world)

    const PLANET_MIN_SCALE = 1.0
    const PLANET_MAX_SCALE = 1.22
    const targetScale = { current: 1 }
    const applyPlanetGrowth = (rs: typeof regions) => {
      const total = rs.length
      const living = rs.filter((r) => !r.dormant)
      const totalDev = living.reduce((n, r) => n + r.development, 0)
      const devPotential = living.length * STABILITY_MAX
      // half awakenings, half development — waking regions and accumulating
      // development both visibly grow the globe
      const frac = total > 0
        ? 0.5 * (living.length / total) + 0.5 * (devPotential > 0 ? Math.min(1, totalDev / devPotential) : 0)
        : 0
      targetScale.current = PLANET_MIN_SCALE + (PLANET_MAX_SCALE - PLANET_MIN_SCALE) * frac
    }

    interface IconState {
      group: THREE.Group
      mat: THREE.MeshStandardMaterial
      baseColor: THREE.Color
      phase: number
      sizeJitter: number
      recipeIdx: number
      order: number
      height: number
    }
    interface Patch {
      id: number
      mat: THREE.MeshStandardMaterial
      baseColor: THREE.Color
      dormantColor: THREE.Color
      outlineMat: THREE.LineBasicMaterial
      icons: IconState[]
    }

    const patches: Patch[] = []
    const patchMeshes: THREE.Mesh[] = []
    const disposables: { dispose: () => void }[] = []

    const capRimTemplate: THREE.Vector3[] = []
    const capGeo = capGeometry(20, capRimTemplate) // ~20° caps leave ocean between regions
    disposables.push(capGeo)
    const rimGeo = new THREE.BufferGeometry().setFromPoints(capRimTemplate)
    disposables.push(rimGeo)

    regions.forEach((region, id) => {
      const { lat, lon } = patchLatLon(id)
      const up = new THREE.Vector3(
        Math.cos(lat * DEG) * Math.sin(lon * DEG),
        Math.sin(lat * DEG),
        Math.cos(lat * DEG) * Math.cos(lon * DEG),
      ).normalize()
      const east = new THREE.Vector3().crossVectors(Y_AXIS, up).normalize()
      const north = new THREE.Vector3().crossVectors(up, east).normalize()

      const g = new THREE.Group()
      g.quaternion.setFromUnitVectors(Y_AXIS, up)
      world.add(g)

      const baseColor = new THREE.Color(TERRAIN_COLORS[region.terrain] ?? 0x7cb342)
      const mat = new THREE.MeshStandardMaterial({ color: baseColor.clone(), roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(capGeo, mat)
      mesh.userData.regionId = id
      g.add(mesh)
      patchMeshes.push(mesh)
      disposables.push(mat)

      const outlineMat = new THREE.LineBasicMaterial({ color: 0x16324f, transparent: true, opacity: 0.55 })
      const outline = new THREE.LineLoop(rimGeo, outlineMat)
      disposables.push(outlineMat)
      g.add(outline)

      const icons: IconState[] = []
      const recipes = RECIPES[region.terrain] ?? RECIPES.meadow
      recipes.forEach((recipe, ri) => {
        for (let k = 0; k < recipe.count; k++) {
          const { group, mat: imat } = buildIcon(recipe.kind, recipe.color)
          // deterministic golden-angle scatter inside the cap (cap is ~20°,
          // so icons stay on the patch: 0..~18° from the centre)
          const t = (k + 0.5) / recipe.count
          const ang = t * 0.32
          const th = k * 2.399963 + ri * 1.7
          const local = g.worldToLocal(
            up.clone().multiplyScalar(Math.cos(ang))
              .addScaledVector(east, Math.sin(ang) * Math.cos(th))
              .addScaledVector(north, Math.sin(ang) * Math.sin(th))
              .normalize()
              .multiplyScalar(R),
          )
          group.position.copy(local)
          icons.push({
            group,
            mat: imat,
            baseColor: new THREE.Color(recipe.color),
            phase: (id * 7 + k * 13 + ri * 3) % (Math.PI * 2),
            sizeJitter: 0.8 + ((k * 37 + id * 11) % 10) / 25, // 0.8..1.16
            recipeIdx: ri,
            order: t,
            height: recipe.height,
          })
          g.add(group)
          disposables.push(imat)
        }
      })

      patches.push({
        id,
        mat,
        baseColor,
        dormantColor: baseColor.clone().lerp(DORMANT_TINT, 0.72),
        outlineMat: outlineMat,
        icons,
      })
    })

    // ---------- adjacency links: faint web + bright focus neighbours ----------
    const linkPoint = (id: number) => {
      const { lat, lon } = patchLatLon(id)
      return new THREE.Vector3(
        Math.cos(lat * DEG) * Math.sin(lon * DEG) * R * 1.01,
        Math.sin(lat * DEG) * R * 1.01,
        Math.cos(lat * DEG) * Math.cos(lon * DEG) * R * 1.01,
      )
    }
    const pairs: [number, number][] = []
    regions.forEach((r) => r.adjacency.forEach((a) => { if (a > r.id) pairs.push([r.id, a]) }))
    const webGeo = new THREE.BufferGeometry().setFromPoints(
      pairs.flatMap(([a, b]) => [linkPoint(a), linkPoint(b)]),
    )
    const webMat = new THREE.LineBasicMaterial({ color: 0x2b4d75, transparent: true, opacity: 0.55 })
    world.add(new THREE.LineSegments(webGeo, webMat))
    disposables.push(webGeo, webMat)

    const neighbourGeo = new THREE.BufferGeometry()
    const neighbourMat = new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.95 })
    const neighbourLines = new THREE.LineSegments(neighbourGeo, neighbourMat)
    world.add(neighbourLines)
    disposables.push(neighbourGeo, neighbourMat)

    const rebuildNeighbours = (fid: number | null) => {
      const pts: THREE.Vector3[] = []
      if (fid !== null) {
        const r = regionsRef.current[fid]
        if (r) r.adjacency.forEach((a) => pts.push(linkPoint(fid), linkPoint(a)))
      }
      neighbourGeo.setFromPoints(pts)
    }
    rebuildNeighbours(focusRef.current)

    // ---------- pointer picking (click ≠ drag; hover sets cursor) ----------
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let hovered: number | null = null
    let downAt: { x: number; y: number } | null = null

    const pick = (ev: PointerEvent): number | null => {
      const rect = canvas.getBoundingClientRect()
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      const hits = raycaster.intersectObjects(patchMeshes, false)
      return hits.length ? (hits[0].object.userData.regionId as number) : null
    }
    const onMove = (ev: PointerEvent) => {
      hovered = pick(ev)
      canvas.style.cursor = hovered !== null ? 'pointer' : 'grab'
    }
    const onLeave = () => { hovered = null }
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY } }
    const onUp = (ev: PointerEvent) => {
      if (!downAt) return
      const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y)
      downAt = null
      if (moved > 6) return // drag, not a click
      const id = pick(ev)
      if (id !== null) onFocusRef.current(id)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.style.cursor = 'grab'

    // keyboard on the globe itself: arrows walk the regions, Enter re-selects
    const onKey = (ev: KeyboardEvent) => {
      const n = regionsRef.current.length
      const cur = focusRef.current ?? -1
      let next: number | null = null
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (cur + 1) % n
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (cur - 1 + n) % n
      else if (ev.key === 'Enter' || ev.key === ' ') next = cur >= 0 ? cur : 0
      if (next !== null) {
        ev.preventDefault()
        onFocusRef.current(next)
      }
    }
    canvas.addEventListener('keydown', onKey)

    // reduced-motion can flip while the page is open — honour it live
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => { reducedRef.current = mq.matches }
    mq.addEventListener('change', onMq)

    // ---------- responsive sizing (ResizeObserver) ----------
    const resize = () => {
      const w = wrap.clientWidth || 320
      const h = wrap.clientHeight || 320
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // ---------- animation loop ----------
    let raf = 0
    let t = 0
    let last = performance.now()
    const lerp = (a: number, b: number, kk: number) => a + (b - a) * kk

    const evolve = (dt: number) => {
      const rs = regionsRef.current
      const fid = focusRef.current
      const k = reducedRef.current ? 1 : Math.min(1, dt * 3.2) // instant under reduced motion
      applyPlanetGrowth(rs)
      const sk = reducedRef.current ? 1 : Math.min(1, dt * 2.2)
      planetScaleGroup.scale.setScalar(lerp(planetScaleGroup.scale.x, targetScale.current, sk))
      for (const p of patches) {
        const region = rs[p.id]
        if (!region) continue
        const asleep = region.dormant
        const selected = fid === p.id
        const hoveredNow = hovered === p.id

        // patch: terrain colour awake; desaturated dim dormant; emissive on select
        p.mat.color.lerp(asleep ? p.dormantColor : p.baseColor, k)
        p.mat.emissive.copy(p.baseColor).multiplyScalar(asleep ? 0 : selected ? 0.5 : hoveredNow ? 0.22 : 0.06)

        // outline: bright gold ring on the selected region (not colour-only —
        // the legend check glyph + map-detail carry selection too)
        p.outlineMat.color.setHex(selected ? 0xffd166 : hoveredNow ? 0x58a6ff : 0x16324f)
        p.outlineMat.opacity = selected ? 1 : hoveredNow ? 0.9 : 0.55

        // icons: appear/grow/scatter with development; dormant → dim & tiny
        const devFrac = Math.min(1, region.development / 6)
        const awakeFrac = asleep ? 0 : 0.4 + 0.6 * devFrac
        const sizeBase = asleep ? 0.1 : 0.55 + 0.75 * Math.min(1, region.development / STABILITY_MAX)
        const dim = asleep ? 0.3 : 1
        for (const ic of p.icons) {
          const frac = ic.recipeIdx === 0 ? awakeFrac : awakeFrac * 0.8
          const visible = ic.order <= frac
          const bob = !reducedRef.current && !asleep ? 1 + 0.05 * Math.sin(t * 1.6 + ic.phase) : 1
          const target = visible ? sizeBase * ic.sizeJitter * bob * ic.height : 0.001
          ic.group.scale.setScalar(lerp(ic.group.scale.x, target, k))
          ic.mat.opacity = lerp(ic.mat.opacity, dim, k)
          if (asleep) ic.mat.color.lerp(DORMANT_TINT, k)
          else ic.mat.color.lerp(ic.baseColor, k)
        }
      }
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      evolve(dt)
      if (!reducedRef.current) world.rotation.y += dt * 0.12 // slow living drift
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mq.removeEventListener('change', onMq)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('keydown', onKey)
      for (const d of disposables) d.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div className="planet3d-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="planet3d-canvas"
        tabIndex={0}
        role="application"
        aria-label="3D planet globe — arrow keys walk the 12 regions, Enter selects; Tab to the region legend for direct access"
        data-testid="planet3d-canvas"
      />
    </div>
  )
}