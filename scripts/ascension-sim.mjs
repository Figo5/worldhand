// ASCENSION SIMULATION (rules v10) — diagnostic only, never a CI gate.
//
// Plays N seeds with each bot (in parallel worker threads) and prints what the
// balance audit needs: completion, Resolve lost, where runs die, crisis
// margins, pacing, hand sizes, discards, early facing, Influence, content use.
//
//   node --import ./scripts/ts-resolve.mjs scripts/ascension-sim.mjs [seeds=200] [bots=all] [opts-json]
// opts: { omen: 0-8, pool: 'full'|'starter', origin: 'pangaea'|..., prefix: 'sim', patch: { "ERAS.0.hands": 8, ... }, json: 'out.json' }
// A patch sets engine table values by path (harness-only) — for tuning and ablations.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const TABLES = async () => ({
  ERAS: (await import('../src/engine/ascension/eras.ts')).ERAS,
  CRISES: (await import('../src/engine/ascension/crises.ts')).CRISES,
  ARCHETYPES: (await import('../src/engine/ascension/civilizations.ts')).ARCHETYPES,
  HAND_TABLE: (await import('../src/engine/ascension/scoring.ts')).HAND_TABLE,
  LEGENDARIES: (await import('../src/engine/ascension/legendaries.ts')).LEGENDARIES,
  TERRAIN: (await import('../src/engine/ascension/world.ts')).TERRAIN,
})
/** Ablations: switch one system off to see whether it matters (harness-only). */
const ABLATIONS = {
  full: () => {},
  'no-land': (t) => { for (const k of Object.keys(t.TERRAIN)) t.TERRAIN[k].stat = null },
  'no-passives': (t) => { for (const a of Object.values(t.ARCHETYPES)) a.passive.apply = () => {} },
  'no-reserves': (t) => { for (const e of t.ERAS) e.reserveRate = 1e12 },
  'no-strain': (t) => { for (const c of Object.values(t.CRISES)) c.pressures = c.pressures.filter((f) => f.kind !== 'strain' && f.kind !== 'spread') },
  'no-civ-in-crises': (t) => { for (const c of Object.values(t.CRISES)) c.mitigations = c.mitigations.filter((f) => !['civ', 'civTiers', 'civCount'].includes(f.kind)) },
  'no-era-rules': (t) => { for (const e of t.ERAS) e.rule = 'none' },
  'no-terrain-in-crises': (t) => { for (const c of Object.values(t.CRISES)) { c.pressures = c.pressures.filter((f) => f.kind !== 'terrain'); c.mitigations = c.mitigations.filter((f) => f.kind !== 'terrain') } },
}
export async function applyPatch(patch = {}) {
  const t = await TABLES()
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.')
    let o = t
    for (const k of keys.slice(0, -1)) { o = o[k]; if (o === undefined) throw new Error(`bad patch path ${path}`) }
    const last = keys[keys.length - 1]
    if (!(last in o)) throw new Error(`bad patch path ${path}`)
    o[last] = value
  }
}

if (!isMainThread) {
  const { bot, seeds, opts } = workerData
  await applyPatch(opts.patch)
  if (opts.ablation) ABLATIONS[opts.ablation]?.(await TABLES())
  const { BOTS, POOLS, drive } = await import('./lib/asc-bots.mjs')
  const pool = { ...POOLS[opts.pool ?? 'full'] }
  if (opts.ablation === 'no-legendaries') pool.legendaries = []
  if (opts.ablation === 'no-world-cards') { pool.cards = []; pool.decrees = [] }
  const player = opts.ablation === 'no-council' ? { ...BOTS[bot], council: () => ({ type: 'leave' }) } : BOTS[bot]
  const { forecast } = await import('../src/engine/ascension/ascension.ts')
  const out = seeds.map((seedText) => {
    const setup = { seedText, omen: opts.omen ?? 0, origin: opts.origin ?? 'pangaea', pool }
    const sizes = [], scoringN = [], discardsByEra = [0, 0, 0, 0, 0, 0], faced = [], cats = {}
    let influenceIn = 0, prevInfluence = 0
    const offers = []
    const s = drive(setup, player, (b, a, n) => {
      if (a.type === 'legendary' && b.council.legendaryChoice) offers.push({ offered: b.council.legendaryChoice, taken: a.pick === null ? null : b.council.legendaryChoice[a.pick] })
      if (a.type === 'play') { sizes.push(a.cards.length); scoringN.push(n.lastPlay.scoring.length); cats[n.lastPlay.category] = (cats[n.lastPlay.category] ?? 0) + 1 }
      if (a.type === 'discard') discardsByEra[b.era] += 1
      if (a.type === 'face') faced.push(b.handsLeft)
      if (n.influence > b.influence) influenceIn += n.influence - b.influence
    })
    void prevInfluence; void forecast
    return {
      won: s.phase === 'won', era: s.era, resolve: s.resolve, score: s.score, plays: s.plays, discards: s.discards,
      crises: s.crises.map((c) => [c.crisis, c.result, c.margin, c.prevented]), sizes, scoringN, discardsByEra, faced,
      stats: Object.values(s.stats), civs: s.civilizations.map((c) => [c.archetype, c.tier]), fallen: s.fallen.length,
      legendaries: s.legendaries.map((l) => l.id), cards: [...s.hand, ...s.drawPile, ...s.discardPile].filter((c) => c.kind).map((c) => c.kind),
      influenceIn, cats, seedText, offers,
    }
  })
  parentPort.postMessage(out)
} else {
  const { BOTS } = await import('./lib/asc-bots.mjs')
  const bots = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : Object.keys(BOTS)
  const opts = JSON.parse(process.argv[4] ?? '{}')
  const seeds = opts.seedTexts ?? Array.from({ length: Number(process.argv[2] ?? 200) }, (_, i) => `${opts.prefix ?? 'sim'}-${i}`)
  const N = seeds.length
  const jobs = []
  for (const bot of bots) for (let i = 0; i < N; i += 100) jobs.push({ bot, seeds: seeds.slice(i, i + 100), opts })
  const t0 = Date.now()
  const res = await new Promise((done, fail) => {
    const out = []; let next = 0, running = 0
    const go = () => {
      if (next >= jobs.length) { if (!running) done(out); return }
      const i = next++; running += 1
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: jobs[i] })
      w.once('message', (m) => { out[i] = m; w.terminate() }); w.once('error', fail); w.once('exit', () => { running -= 1; go() })
    }
    for (let k = 0; k < Math.max(1, availableParallelism() - 1); k++) go()
  })
  const table = {}
  jobs.forEach((j, i) => (table[j.bot] ??= []).push(...res[i]))
  if (opts.json) writeFileSync(opts.json, JSON.stringify(table))
  const pct = (a, n) => `${Math.round((100 * a) / Math.max(1, n))}%`
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : '-' }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  console.log(`# Ascension v10 simulation — ${N} seeds × ${bots.length} bots, opts ${JSON.stringify(opts)} (${Math.round((Date.now() - t0) / 1000)}s)\n`)
  console.log('bot           win   resolve-lost  died-in-era T/A/M/I/Inf/S         fails/run  era survival %            median margin by era        score(med)  plays  cards/play  scoring/play  discards/era  faced early (hands left)')
  const ERAN = 6
  for (const bot of bots) {
    const rs = table[bot]
    const won = rs.filter((r) => r.won).length
    const died = Array(ERAN).fill(0)
    for (const r of rs) if (!r.won) died[r.era] += 1
    const fails = mean(rs.map((r) => r.crises.filter((c) => c[1] === 'failed').length))
    const surv = Array.from({ length: ERAN }, (_, e) => { const f = rs.filter((r) => r.crises.length > e); return f.length ? Math.round((100 * f.filter((r) => r.crises[e][1] === 'endured').length) / f.length) : '-' })
    const marg = Array.from({ length: ERAN }, (_, e) => med(rs.filter((r) => r.crises.length > e).map((r) => r.crises[e][2])))
    const faced = rs.flatMap((r) => r.faced)
    console.log(`${bot.padEnd(13)} ${pct(won, rs.length).padStart(4)}  ${mean(rs.map((r) => (r.won ? 3 : 3) - r.resolve)).toFixed(2).padStart(5)}         ${died.map((d) => pct(d, rs.length)).join('/').padEnd(30)} ${fails.toFixed(2).padStart(5)}      ${surv.join('/').padEnd(25)} ${marg.join('/').padEnd(27)} ${String(med(rs.map((r) => r.score))).padStart(9)}  ${String(med(rs.map((r) => r.plays))).padStart(5)}  ${mean(rs.flatMap((r) => r.sizes)).toFixed(2).padStart(10)}  ${mean(rs.flatMap((r) => r.scoringN)).toFixed(2).padStart(12)}  ${(mean(rs.map((r) => r.discards)) / 6).toFixed(2).padStart(12)}  ${pct(faced.filter((h) => h > 0).length, faced.length)} (${mean(faced.filter((h) => h > 0)).toFixed(1)})`)
  }
  // crisis failure table
  console.log('\n## Crisis failures (share of faced, all bots pooled)')
  const byCrisis = {}
  for (const bot of bots) for (const r of table[bot]) for (const c of r.crises) { const x = (byCrisis[c[0]] ??= { n: 0, f: 0, m: [] }); x.n++; if (c[1] === 'failed') x.f++; x.m.push(c[2]) }
  for (const [id, x] of Object.entries(byCrisis)) console.log(`  ${id.padEnd(15)} faced ${String(x.n).padStart(6)}  failed ${pct(x.f, x.n).padStart(4)}  median margin ${med(x.m)}`)
  // hand size distribution
  console.log('\n## Cards per play (share) and hand categories, all bots pooled')
  const size = [0, 0, 0, 0, 0, 0], cats = {}
  for (const bot of bots) for (const r of table[bot]) { for (const z of r.sizes) size[z]++; for (const [k, v] of Object.entries(r.cats)) cats[k] = (cats[k] ?? 0) + v }
  const tot = size.reduce((a, b) => a + b, 0)
  console.log('  sizes 1-5: ' + size.slice(1).map((n) => pct(n, tot)).join(' / '))
  console.log('  categories: ' + Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, tot)}`).join(', '))
  // seed difficulty
  const seedsWon = new Map(seeds.map((s) => [s, 0]))
  for (const bot of bots) for (const r of table[bot]) if (r.won) seedsWon.set(r.seedText, seedsWon.get(r.seedText) + 1)
  const none = [...seedsWon].filter(([, n]) => n === 0).map(([s]) => s)
  console.log(`\n## Seeds no bot wins: ${none.length}/${N}${none.length ? ` (${none.slice(0, 12).join(', ')}${none.length > 12 ? ', …' : ''})` : ''}`)
  // content
  const legs = {}, cardsOwned = {}, arche = {}
  for (const bot of bots) for (const r of table[bot]) { for (const l of r.legendaries) legs[l] = (legs[l] ?? 0) + 1; for (const c of r.cards) cardsOwned[c] = (cardsOwned[c] ?? 0) + 1; for (const [a] of r.civs) arche[a] = (arche[a] ?? 0) + 1 }
  const runs = bots.length * N
  console.log('\n## Legendaries held at the end (share of runs): ' + Object.entries(legs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, runs)}`).join(', '))
  console.log('## Living civilizations at the end (share of runs): ' + Object.entries(arche).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, runs)}`).join(', '))
  console.log('## World cards owned at the end (copies per run): ' + Object.entries(cardsOwned).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k} ${(v / runs).toFixed(2)}`).join(', '))
  const all = bots.flatMap((b) => table[b]), baseWin = all.filter((r) => r.won).length / all.length
  console.log(`## Legendary lift (win rate of runs ending with it vs all runs, ${pct(all.filter((r) => r.won).length, all.length)}): ` + Object.keys(legs).sort().map((k) => { const h = all.filter((r) => r.legendaries.includes(k)); return `${k} ${pct(h.filter((r) => r.won).length, h.length)} (n=${h.length})` }).join(', '))
  void baseWin
  // randomized comparison (meaningful for the sampler, which picks at random): of runs offered X, won when taken vs not taken
  const lift = {}
  for (const r of all) for (const o of r.offers ?? []) for (const id of o.offered) { const x = (lift[id] ??= { t: 0, tw: 0, n: 0, nw: 0 }); if (o.taken === id) { x.t++; if (r.won) x.tw++ } else { x.n++; if (r.won) x.nw++ } }
  console.log('## Legendary lift, offered-and-taken vs offered-and-declined (win %): ' + Object.keys(lift).sort().map((k) => { const x = lift[k]; return `${k} ${pct(x.tw, x.t)} vs ${pct(x.nw, x.n)} (${x.t}/${x.n})` }).join(', '))
  console.log('## Median civilizations (living/fallen), final stats high→low, Influence earned per run:')
  for (const bot of bots) {
    const rs = table[bot]
    const shape = [0, 1, 2, 3].map((i) => med(rs.map((r) => [...r.stats].sort((x, y) => y - x)[i]))).join('/')
    console.log(`  ${bot.padEnd(13)} civs ${med(rs.map((r) => r.civs.length))}/${med(rs.map((r) => r.fallen))}  stats ${shape.padEnd(15)} influence ${med(rs.map((r) => r.influenceIn))}`)
  }
}
