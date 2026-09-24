// The Ascension globe: three.js, adapted from Classic's Planet3D (same
// spherical-cap regions, lighting and picking) as a separate component so
// Classic stays untouched. It only renders engine state — terrain (it
// follows terraforming live), civilizations (towers grow with tier),
// alliances and rivalries, the land the current crisis strikes or shelters,
// and the world's development. Nothing here decides anything.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Region, Terrain, WorldStats } from '../../engine/ascension/world'
import { REGION_NAMES, TERRAIN } from '../../engine/ascension/world'
import type { Archetype, Civilization, CivPair } from '../../engine/ascension/civilizations'

const TERRAIN_COLOR: Record<Terrain, number> = {
  plains: 0x9fc462, forest: 0x2f7d3a, mountains: 0x8a7a68, desert: 0xd6b36a, coast: 0x4fb8e0, tundra: 0xcfe0e6, wasteland: 0x3b3230,
}
const CIV_COLOR: Record<Archetype, number> = {
  natureKeepers: 0x7fcf8f, nomads: 0xe8c07a, merchants: 0xe0b55a, empireBuilders: 0xdf8b55, scholars: 0x86a9ff, technocrats: 0x9fe0ff, mystics: 0xb79cff, mariners: 0x5fd1d1,
}
const R = 1
const DEG = Math.PI / 180
const Y = new THREE.Vector3(0, 1, 0)

/** Region anchor on the globe: the same layout Classic's globe uses. */
function anchor(id: number): THREE.Vector3 {
  const row = id % 4, band = Math.floor(id / 4)
  const lat = 34 - band * 34, lon = -135 + row * 90 + (band % 2) * 45
  return new THREE.Vector3(Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)).normalize()
}
function capGeometry(radDeg: number, rim: THREE.Vector3[]): THREE.BufferGeometry {
  const maxAng = radDeg * DEG, SEG = 12, RING = 16
  const pos: number[] = [0, R * 1.003, 0], idx: number[] = []
  for (let i = 1; i <= SEG; i++) {
    const a = (i / SEG) * maxAng, ca = Math.cos(a), sa = Math.sin(a)
    for (let j = 0; j < RING; j++) {
      const th = (j / RING) * Math.PI * 2
      pos.push(sa * Math.cos(th) * R * 1.003, ca * R * 1.003, sa * Math.sin(th) * R * 1.003)
      if (i === SEG) rim.push(new THREE.Vector3(sa * Math.cos(th) * R * 1.007, ca * R * 1.007, sa * Math.sin(th) * R * 1.007))
    }
  }
  for (let j = 0; j < RING; j++) idx.push(0, 1 + ((j + 1) % RING), 1 + j)
  for (let i = 0; i < SEG - 1; i++) {
    const a0 = 1 + i * RING, b0 = 1 + (i + 1) * RING
    for (let j = 0; j < RING; j++) { const j1 = (j + 1) % RING; idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export interface GlobeProps {
  regions: readonly Region[]
  civs: readonly Civilization[]
  relations: readonly CivPair[]
  focus: number | null
  onFocus: (id: number) => void
  hit: readonly Terrain[]
  help: readonly Terrain[]
  development: WorldStats
  crisisFailing: boolean
  reduced?: boolean
}

export default function Globe(props: GlobeProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef(props)
  live.current = props

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch {
      canvas.style.display = 'none'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 1.0, 4.3)
    camera.lookAt(0, 0, 0)
    scene.add(new THREE.AmbientLight(0x445566, 1.0))
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.1)
    sun.position.set(5, 3, 4)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x8fb7ff, 0.45)
    fill.position.set(-4, -2, -3)
    scene.add(fill)
    const disposables: { dispose: () => void }[] = []
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x }

    // stars (decorative; rendering only)
    const starPos = new Float32Array(700 * 3)
    for (let i = 0; i < 700; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(16 + Math.random() * 20, Math.acos(2 * Math.random() - 1), Math.random() * Math.PI * 2)
      starPos.set([v.x, v.y, v.z], i * 3)
    }
    const starGeo = keep(new THREE.BufferGeometry())
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    scene.add(new THREE.Points(starGeo, keep(new THREE.PointsMaterial({ color: 0xbcd6ff, size: 0.05 }))))
    const atmoMat = keep(new THREE.MeshBasicMaterial({ color: 0x7db8f5, transparent: true, opacity: 0.15, side: THREE.BackSide, depthWrite: false }))
    scene.add(new THREE.Mesh(keep(new THREE.SphereGeometry(1.14, 48, 32)), atmoMat))

    const grow = new THREE.Group()
    const tilt = new THREE.Group()
    tilt.rotation.z = -0.18
    grow.add(tilt)
    scene.add(grow)
    const world = new THREE.Group()
    tilt.add(world)
    world.add(new THREE.Mesh(keep(new THREE.SphereGeometry(R, 64, 48)), keep(new THREE.MeshStandardMaterial({ color: 0x0d2b4d, roughness: 0.55, metalness: 0.1 }))))

    // region patches
    const rim: THREE.Vector3[] = []
    const cap = keep(capGeometry(20, rim))
    const rimGeo = keep(new THREE.BufferGeometry().setFromPoints(rim))
    const patches = live.current.regions.map((_, id) => {
      const g = new THREE.Group()
      g.quaternion.setFromUnitVectors(Y, anchor(id))
      world.add(g)
      const mat = keep(new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }))
      const mesh = new THREE.Mesh(cap, mat)
      mesh.userData.regionId = id
      g.add(mesh)
      const lineMat = keep(new THREE.LineBasicMaterial({ color: 0x16324f, transparent: true, opacity: 0.55 }))
      g.add(new THREE.LineLoop(rimGeo, lineMat))
      return { id, g, mesh, mat, lineMat }
    })

    // civilization towers: a base, a shaft and a cap that rise with tier
    const baseGeo = keep(new THREE.CylinderGeometry(0.055, 0.07, 0.03, 10))
    baseGeo.translate(0, 0.015, 0)
    const shaftGeo = keep(new THREE.CylinderGeometry(0.03, 0.04, 1, 8))
    shaftGeo.translate(0, 0.5, 0)
    const capGeo = keep(new THREE.ConeGeometry(0.05, 0.07, 8))
    const towers = new Map<number, { g: THREE.Group; shaft: THREE.Mesh; top: THREE.Mesh; mat: THREE.MeshStandardMaterial; h: number }>()
    const syncTowers = () => {
      const civs = live.current.civs
      for (const [id, t] of towers) if (!civs.some((c) => c.id === id)) { world.remove(t.g); t.mat.dispose(); towers.delete(id) }
      for (const c of civs) {
        let t = towers.get(c.id)
        if (!t) {
          const g = new THREE.Group()
          g.quaternion.setFromUnitVectors(Y, anchor(c.home))
          g.position.copy(anchor(c.home).multiplyScalar(R * 1.004))
          const mat = new THREE.MeshStandardMaterial({ color: CIV_COLOR[c.archetype], roughness: 0.4, metalness: 0.25, emissive: new THREE.Color(CIV_COLOR[c.archetype]).multiplyScalar(0.25) })
          const shaft = new THREE.Mesh(shaftGeo, mat)
          const top = new THREE.Mesh(capGeo, mat)
          g.add(new THREE.Mesh(baseGeo, mat), shaft, top)
          g.scale.setScalar(0.001)
          world.add(g)
          t = { g, shaft, top, mat, h: 0.05 }
          towers.set(c.id, t)
        }
        t.h = 0.04 + 0.07 * c.tier
      }
    }

    // relation links
    const allyGeo = keep(new THREE.BufferGeometry()), rivalGeo = keep(new THREE.BufferGeometry())
    world.add(new THREE.LineSegments(allyGeo, keep(new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9 }))))
    world.add(new THREE.LineSegments(rivalGeo, keep(new THREE.LineBasicMaterial({ color: 0xff6b5a, transparent: true, opacity: 0.9 }))))
    const arc = (a: number, b: number) => {
      const pa = anchor(a), pb = anchor(b), pts: THREE.Vector3[] = []
      for (let i = 0; i <= 12; i++) {
        const p = pa.clone().lerp(pb, i / 12).normalize().multiplyScalar(R * (1.03 + 0.08 * Math.sin((Math.PI * i) / 12)))
        if (i) pts.push(pts[pts.length - 1].clone(), p); else pts.push(p)
      }
      return pts.slice(0, -1)
    }
    let relKey = ''
    const syncRelations = () => {
      const { relations, civs } = live.current
      const key = relations.map((r) => `${r.a}-${r.b}-${r.relation}`).join('|') + civs.map((c) => `${c.id}@${c.home}`).join(',')
      if (key === relKey) return
      relKey = key
      const home = (id: number) => civs.find((c) => c.id === id)?.home
      const pts = (rel: 'ally' | 'rival') => relations.filter((r) => r.relation === rel).flatMap((r) => { const a = home(r.a), b = home(r.b); return a === undefined || b === undefined ? [] : arc(a, b) })
      allyGeo.setFromPoints(pts('ally'))
      rivalGeo.setFromPoints(pts('rival'))
    }

    // picking and dragging
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
    let hovered: number | null = null
    let drag: { x: number; rot: number; moved: number } | null = null
    const pick = (ev: PointerEvent): number | null => {
      const r = canvas.getBoundingClientRect()
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(patches.map((p) => p.mesh), false)[0]
      return hit ? (hit.object.userData.regionId as number) : null
    }
    const onMove = (ev: PointerEvent) => {
      if (drag) { const dx = ev.clientX - drag.x; drag.moved = Math.max(drag.moved, Math.abs(dx)); world.rotation.y = drag.rot + dx * 0.01; return }
      hovered = pick(ev)
      canvas.style.cursor = hovered !== null ? 'pointer' : 'grab'
    }
    const onDown = (ev: PointerEvent) => { drag = { x: ev.clientX, rot: world.rotation.y, moved: 0 }; canvas.setPointerCapture?.(ev.pointerId) }
    const onUp = (ev: PointerEvent) => {
      const d = drag
      drag = null
      if (d && d.moved < 6) { const id = pick(ev); if (id !== null) live.current.onFocus(id) }
    }
    const onLeave = () => { hovered = null }
    const onKey = (ev: KeyboardEvent) => {
      const n = live.current.regions.length, cur = live.current.focus ?? -1
      let next: number | null = null
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (cur + 1) % n
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (cur - 1 + n) % n
      if (next !== null) { ev.preventDefault(); live.current.onFocus(next) }
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('keydown', onKey)

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => live.current.reduced || mq.matches
    const resize = () => {
      const w = wrap.clientWidth || 320, h = wrap.clientHeight || 300
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    const tmp = new THREE.Color()
    let raf = 0, t = 0, last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (document.visibilityState === 'hidden') return
      t += dt
      const p = live.current
      const rm = reduced()
      const k = rm ? 1 : Math.min(1, dt * 3)
      const dev = p.development.vitality + p.development.prosperity + p.development.industry + p.development.knowledge
      grow.scale.setScalar(grow.scale.x + ((1 + Math.min(0.22, dev / 900)) - grow.scale.x) * (rm ? 1 : Math.min(1, dt * 2)))
      atmoMat.color.lerp(tmp.setHex(p.crisisFailing ? 0xff7a66 : 0x7db8f5), k)
      const pulse = rm ? 1 : 0.65 + 0.35 * Math.sin(t * 3)
      for (const pa of patches) {
        const r = p.regions[pa.id]
        if (!r) continue
        pa.mat.color.lerp(tmp.setHex(TERRAIN_COLOR[r.terrain]), k)
        const sel = p.focus === pa.id, hov = hovered === pa.id
        pa.mat.emissive.setHex(TERRAIN_COLOR[r.terrain]).multiplyScalar(sel ? 0.45 : hov ? 0.2 : 0.05)
        const isHit = p.hit.includes(r.terrain), isHelp = p.help.includes(r.terrain)
        pa.lineMat.color.setHex(sel ? 0xffd166 : isHit ? 0xff6b5a : isHelp ? 0x7fcf8f : hov ? 0x58a6ff : 0x16324f)
        pa.lineMat.opacity = sel ? 1 : isHit || isHelp ? 0.55 + 0.45 * pulse : hov ? 0.9 : 0.5
      }
      syncTowers()
      for (const tw of towers.values()) {
        tw.g.scale.setScalar(tw.g.scale.x + (1 - tw.g.scale.x) * k)
        tw.shaft.scale.y += (tw.h - tw.shaft.scale.y) * k
        tw.top.position.y = tw.shaft.scale.y + 0.03
      }
      syncRelations()
      if (!rm && !drag) world.rotation.y += dt * 0.1
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('keydown', onKey)
      for (const tw of towers.values()) tw.mat.dispose()
      for (const d of disposables) d.dispose()
      renderer.dispose()
    }
  }, [])

  const { regions, focus, civs } = props
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        data-testid="asc-globe"
        aria-label={`The world: ${regions.map((r) => `${REGION_NAMES[r.id]} ${TERRAIN[r.terrain].label}${civs.find((c) => c.home === r.id) ? ` (${civs.find((c) => c.home === r.id)!.name})` : ''}`).join('; ')}. Arrow keys select regions${focus !== null ? `; selected ${REGION_NAMES[focus]}` : ''}.`}
      />
    </div>
  )
}
