// ASCENSION DESIGN COMPARISON — diagnostic only. Runs chosen bots under
// candidate rule designs (patches of the engine's tables, harness-only) and
// prints completion, crisis survival and the shape of completed worlds, so
// alternatives can be compared on the same seeds before one is shipped.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/ascension-designs.mjs [seeds=300] '<designs json>' [bots,comma,separated]
// A design is { base?: 'v7' | 'v8', rules?: {reserveRate, gatherPerRound, graceRounds}, medieval?: {civilizations, stats, min, development},
//               plagueBase?: n, invasionV7?: true } — reserveRate null means no reserves. Example:
//   node --import ./scripts/ts-resolve.mjs scripts/ascension-designs.mjs 300 '{"v8":{},"all-four":{"medieval":{"stats":4,"min":50,"development":null}}}' balanced,prepared,lean-I
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { BOTS, RULESETS, drive, compose, withRules, withMedieval, withInvasion, withBase, invasionV7 } from './lib/ascension-bots.mjs'
import { runStatus } from '../src/engine/ascension/ascension.ts'

const design = (d) => compose(...[
  d.base && RULESETS[d.base].apply,
  d.rules && withRules(Object.fromEntries(Object.entries(d.rules).map(([k, v]) => [k, v ?? Infinity]))),
  d.medieval && withMedieval(Object.fromEntries(Object.entries(d.medieval).map(([k, v]) => [k, v ?? undefined]))),
  d.plagueBase && withBase(1, d.plagueBase),
  d.invasionV7 && withInvasion(invasionV7),
].filter(Boolean))

if (!isMainThread) {
  const { d, bot, seeds } = workerData
  const undo = design(d)()
  parentPort.postMessage(seeds.map((seed) => {
    const s = drive(seed, BOTS[bot].policy)
    return [runStatus(s), s.round, s.crises.map((c) => c.result[0]).join(''), Object.values(s.stats), s.crises.map((c) => c.resilience - c.pressure), s.crises.map((c) => c.faced - c.round - 1)]
  }))
  undo()
} else {
  const N = Number(process.argv[2] ?? 300)
  const designs = JSON.parse(process.argv[3] ?? '{"v7":{"base":"v7"},"v8":{}}')
  const bots = process.argv[4] ? process.argv[4].split(',') : Object.keys(BOTS)
  const seeds = Array.from({ length: N }, (_, i) => `audit-${i}`)
  const jobs = []
  for (const [name, d] of Object.entries(designs)) for (const bot of bots) for (let i = 0; i < N; i += 50) jobs.push({ name, d, bot, seeds: seeds.slice(i, i + 50) })
  const out = await new Promise((done, fail) => {
    const res = []; let next = 0, running = 0
    const go = () => {
      if (next >= jobs.length) { if (!running) done(res); return }
      const i = next++; running += 1
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: jobs[i] })
      w.once('message', (m) => { res[i] = m; w.terminate() }); w.once('error', fail); w.once('exit', () => { running -= 1; go() })
    }
    for (let k = 0; k < Math.max(1, availableParallelism() - 1); k++) go()
  })
  const table = {}
  jobs.forEach((j, i) => ((table[j.name] ??= {})[j.bot] ??= []).push(...out[i]))
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : '-' }
  console.log(`${N} seeds · complete% · Winter/Plague/Invasion survival % · median rounds · completed worlds' stats high→low (median) · median crisis margins · median rounds waited`)
  for (const name of Object.keys(designs)) {
    console.log(`\n== ${name} ${JSON.stringify(designs[name])}`)
    for (const bot of bots) {
      const rs = table[name][bot], d = rs.filter((r) => r[0] === 'complete')
      const at = (k, i) => med(rs.filter((r) => r[k].length > i).map((r) => r[k][i]))
      const surv = [0, 1, 2].map((i) => { const f = rs.filter((r) => r[2].length > i); return f.length ? Math.round((100 * f.filter((r) => r[2][i] === 's').length) / f.length) : '-' }).join('/')
      const shape = [0, 1, 2, 3].map((k) => med(d.map((r) => [...r[3]].sort((x, y) => y - x)[k]))).join('/')
      console.log(`  ${bot.padEnd(11)} ${String(Math.round((100 * d.length) / rs.length)).padStart(3)}%  ${surv.padEnd(11)} r${String(med(d.map((r) => r[1] - 1))).padEnd(3)} ${shape.padEnd(15)} margins ${[0, 1, 2].map((i) => at(4, i)).join('/').padEnd(12)} waited ${[0, 1, 2].map((i) => at(5, i)).join('/')}`)
    }
  }
}
