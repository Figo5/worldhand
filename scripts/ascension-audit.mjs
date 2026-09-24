// ASCENSION CORE-LOOP AUDIT — diagnostic only, says nothing about human fun.
//
// Plays the complete loop (stats, terrain, civilizations, passives, eras,
// crises, reserves, waiting, completion) with the documented bots in
// lib/ascension-bots.mjs over a fixed seed set, under two rule sets (v7 =
// before the core-loop correction, v8 = as shipped) and rule ablations, and
// audits sampled decisions. Worker threads split the work; the output is
// identical however many workers run.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/ascension-audit.mjs [seeds=1000] [--json out.json]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BOTS, RULESETS, ABLATIONS, SUBSETS, ROUND_CAP, drive, outlook, compose } from './lib/ascension-bots.mjs'
import { crisisWorld, evaluatePlay, runStatus, WORLD_STATS } from '../src/engine/ascension/ascension.ts'
import { CRISES, evaluateCrisis } from '../src/engine/ascension/crises.ts'
import { ARCHETYPES, ARCHETYPE_ORDER } from '../src/engine/ascension/civilizations.ts'

const count = (regions, ts) => regions.filter((r) => ts.includes(r.terrain)).length

/** One run, reduced to what the report needs. */
function record(seed, bot) {
  let plays = 0
  const atReady = [] // the face-now forecast margin when each crisis became ready
  const s = drive(seed, BOTS[bot].policy, (before, action, after) => {
    if (action.type === 'play') plays += 1
    if (after.crisis && !before.crisis) { const e = evaluateCrisis(after.era, crisisWorld(after)); atReady.push(e.resilience - e.pressure) }
  })
  return {
    seed, status: runStatus(s), round: s.round, plays, score: s.score, stats: s.stats,
    civs: s.civilizations.map((c) => [c.archetype, c.emergedRound]),
    crises: s.crises.map((c, i) => ({
      id: c.crisis, ready: c.round, faced: c.faced, result: c.result, margin: c.resilience - c.pressure, atReady: atReady[i],
      factors: Object.fromEntries([...c.pressures.map((f) => [f.label, -f.amount]), ...c.mitigations.map((f) => [f.label, f.amount])]),
    })),
    possible: ARCHETYPE_ORDER.filter((a) => s.regions.some((r) => ARCHETYPES[a].terrains.includes(r.terrain))),
    cold: count(s.regions, ['tundra', 'mountains']),
  }
}

/** At every play state of a run: which plays win under which objective. */
function decisions(seed, bot) {
  const c = { states: 0, pokerIsScore: 0, terrainChanges: 0, withCivs: 0, passivesChange: 0, pokerIsLongTerm: 0, atRisk: 0, pokerIsLongTermAtRisk: 0, longTermCost: [] }
  drive(seed, BOTS[bot].policy, (s, action) => {
    if (action.type !== 'play' && action.type !== 'discard') return
    const rs = SUBSETS.map((idx) => evaluatePlay(s, idx))
    const top = (f) => { const m = Math.max(...rs.map(f)); return rs.filter((r) => f(r) === m) }
    const maxScore = Math.max(...rs.map((r) => r.score))
    const agrees = (f) => top(f).some((r) => r.score === maxScore)
    c.states += 1
    if (agrees((r) => r.pokerScore)) c.pokerIsScore += 1
    if (!agrees((r) => r.score - r.landBonus)) c.terrainChanges += 1
    if (s.civilizations.length) { c.withCivs += 1; if (!agrees((r) => r.score - r.civBonus)) c.passivesChange += 1 }
    // long term = the crisis outlook after the play (stats and this era's reserves); does the best poker play also maximise it?
    const lt = (r) => outlook(s, Object.fromEntries(WORLD_STATS.map((k) => [k, s.stats[k] + r.statDeltas[k]])), s.score + r.score)
    const ltTop = top(lt), ltMax = lt(ltTop[0])
    const pokerBest = top((r) => r.pokerScore)
    const same = pokerBest.some((r) => lt(r) === ltMax)
    if (same) c.pokerIsLongTerm += 1
    if (outlook(s) < 10) { c.atRisk += 1; if (same) c.pokerIsLongTermAtRisk += 1; c.longTermCost.push(Math.max(...pokerBest.map((r) => r.pokerScore)) - Math.max(...ltTop.map((r) => r.pokerScore))) }
  })
  return c
}

if (!isMainThread) {
  const { kind, rules, ablation, bot, seeds } = workerData
  const restore = compose(RULESETS[rules].apply, ABLATIONS[ablation].apply)()
  const out = seeds.map((seed) => (kind === 'runs' ? record(seed, bot) : decisions(seed, bot)))
  restore()
  parentPort.postMessage(out)
} else {
  const N = Number(process.argv[2] ?? 1000)
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  const SEEDS = Array.from({ length: N }, (_, i) => `audit-${i}`)
  const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  const jobs = []
  for (const rules of Object.keys(RULESETS)) {
    for (const ablation of Object.keys(ABLATIONS)) for (const bot of Object.keys(BOTS)) for (const seeds of chunk(SEEDS, 100)) jobs.push({ kind: 'runs', rules, ablation, bot, seeds })
    for (const bot of ['balanced', 'score-max', 'planner', 'random']) for (const seeds of chunk(SEEDS.slice(0, Math.min(N, 200)), 20)) jobs.push({ kind: 'decisions', rules, ablation: 'full', bot, seeds })
  }
  const results = jobs.map(() => null)
  const t0 = Date.now()
  await new Promise((done, fail) => {
    let next = 0, running = 0
    const launch = () => {
      if (next >= jobs.length) { if (!running) done(); return }
      const i = next++; running += 1
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: jobs[i] })
      w.once('message', (m) => { results[i] = m; w.terminate() })
      w.once('error', fail)
      w.once('exit', () => { running -= 1; launch() })
    }
    for (let k = 0; k < Math.max(1, availableParallelism() - 1); k++) launch()
  })
  const runs = {}, dec = {} // runs[rules][ablation][bot], dec[rules][bot]
  jobs.forEach((j, i) => {
    if (j.kind === 'runs') (((runs[j.rules] ??= {})[j.ablation] ??= {})[j.bot] ??= []).push(...results[i])
    else ((dec[j.rules] ??= {})[j.bot] ??= []).push(...results[i])
  })
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ runs, dec }))
  report(N, runs, dec, (Date.now() - t0) / 1000)
}

// ---------------------------------------------------------------------------
function report(N, runs, dec, secs) {
  const RS = Object.keys(RULESETS)
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-')
  const q = (a, p) => { if (!a.length) return '-'; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))] }
  const med = (a) => q(a, 0.5)
  const done = (rs) => rs.filter((r) => r.status === 'complete')
  const rate = (rs) => pct(done(rs).length, rs.length)
  const table = (rows) => { const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length))); for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(w[i])).join('  ')) }
  const surv = (rs, i) => { const f = rs.filter((r) => r.crises[i]); return f.length ? Math.round((100 * f.filter((r) => r.crises[i].result === 'survived').length) / f.length) : '-' }
  const why = (c) => Object.entries(c.factors).filter(([k, v]) => v < 0 && !['The winter', 'The plague', 'The invasion'].includes(k)).sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'thin defences'
  const spread = (st) => { const v = Object.values(st).sort((a, b) => b - a); return v[0] - v[3] }

  console.log(`# Ascension core-loop audit — ${N} seeds, ${Object.keys(BOTS).length} bots, rule sets ${RS.join(' vs ')}, ${Object.keys(ABLATIONS).length} ablations, cap ${ROUND_CAP} rounds (${secs.toFixed(0)}s)\n`)
  for (const r of RS) console.log(`  ${r}: ${RULESETS[r].doc}`)
  console.log('\n## Bots'); for (const [n, b] of Object.entries(BOTS)) console.log(`  ${n.padEnd(12)} [${b.family}] ${b.doc}`)

  console.log('\n## 1. Completion by strategy (full rules)')
  table([['bot', 'family', ...RS.flatMap((r) => [`${r} complete`, `${r} W/P/I %`, `${r} rounds`, `${r} top failure`])],
    ...Object.entries(BOTS).map(([bot, b]) => [bot, b.family, ...RS.flatMap((r) => {
      const rs = runs[r].full[bot], w = {}
      for (const x of rs) if (x.status === 'failed') { const c = x.crises[x.crises.length - 1]; const k = `${c.id}: ${why(c)}`; w[k] = (w[k] ?? 0) + 1 }
      const topW = Object.entries(w).sort((a, b) => b[1] - a[1])[0]
      return [rate(rs), [0, 1, 2].map((i) => surv(rs, i)).join('/'), med(done(rs).map((x) => x.round - 1)), topW ? `${topW[0]} (${pct(topW[1], rs.length)})` : '-']
    })])])

  console.log('\n## 2. Focused vs balanced: completion by family, and the spread of completed worlds (highest − lowest stat, median)')
  for (const r of RS) {
    const fams = {}
    for (const [bot, b] of Object.entries(BOTS)) (fams[b.family] ??= []).push(bot)
    console.log(`  ${r}: ` + Object.entries(fams).map(([f, bots]) => `[${f}] ${bots.map((b) => `${b} ${rate(runs[r].full[b])}`).join(', ')}`).join('  '))
    console.log(`  ${r}: spread of completed worlds: ` + Object.keys(BOTS).filter((b) => done(runs[r].full[b]).length >= 10).map((b) => `${b} ${med(done(runs[r].full[b]).map((x) => spread(x.stats)))}`).join(', '))
  }

  console.log('\n## 3. Ablations: completion rate (score contribution = full vs no-reserves; v7 has no reserves)')
  for (const r of RS) {
    console.log(`  ${r}`)
    table([['bot', ...Object.keys(ABLATIONS)], ...Object.keys(BOTS).map((bot) => [bot, ...Object.keys(ABLATIONS).map((a) => rate(runs[r][a][bot]))])])
  }

  console.log('\n## 4. Crisis failure distribution (share of all runs, all bots pooled, that ended at each crisis; top reasons)')
  for (const r of RS) {
    const pool = Object.values(runs[r].full).flat()
    const failed = pool.filter((x) => x.status === 'failed')
    console.log(`  ${r}: ` + CRISES.map((c) => { const f = failed.filter((x) => x.crises[x.crises.length - 1].id === c.id); const reasons = {}; for (const x of f) { const k = why(x.crises[x.crises.length - 1]); reasons[k] = (reasons[k] ?? 0) + 1 } return `${c.label} ${pct(f.length, pool.length)} (${Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${pct(n, f.length)}`).join(', ')})` }).join(' · ') + ` · unfinished at the cap ${pct(pool.filter((x) => ['playing', 'ready', 'crisis'].includes(x.status)).length, pool.length)}`)
  }
  const aware = ['patient', 'prepared', 'planner', 'lean-V', 'lean-P', 'lean-I', 'lean-K']
  for (const r of RS) {
    const faced = aware.flatMap((b) => runs[r].full[b]).flatMap((x) => x.crises)
    const waited = faced.filter((c) => c.faced > c.ready + 1)
    const losing = faced.filter((c) => c.atReady < 0)
    console.log(`  ${r}, forecast-reading bots: faced after waiting ${pct(waited.length, faced.length)}; losing when it became ready ${pct(losing.length, faced.length)}, of those survived ${pct(losing.filter((c) => c.result === 'survived').length, losing.length)}; median winning margin ${med(faced.filter((c) => c.result === 'survived').map((c) => c.margin))}`)
  }

  console.log('\n## 5. Decision value (sampled play states; long term = the crisis outlook after the play, reserves included)')
  table([['rules', 'states from', 'n', 'poker-best = score-best', 'terrain changes best', 'passives change best', 'poker-best is long-term-best (all / at risk)', 'poker points given up for the long-term-best play (med, at risk)'],
    ...RS.flatMap((r) => Object.entries(dec[r]).map(([bot, cs]) => {
      const sum = (k) => cs.reduce((n, c) => n + c[k], 0)
      return [r, bot, sum('states'), pct(sum('pokerIsScore'), sum('states')), pct(sum('terrainChanges'), sum('states')), pct(sum('passivesChange'), sum('withCivs')),
        `${pct(sum('pokerIsLongTerm'), sum('states'))} / ${pct(sum('pokerIsLongTermAtRisk'), sum('atRisk'))}`, med(cs.flatMap((c) => c.longTermCost))]
    }))])

  console.log('\n## 6. Fairness: seeds no bot completes; forecast-reading completion by cold regions')
  for (const r of RS) {
    const lost = Array.from({ length: N }, (_, i) => `audit-${i}`).filter((seed, i) => !Object.values(runs[r].full).some((rs) => rs[i].status === 'complete'))
    const pool = aware.flatMap((b) => runs[r].full[b])
    console.log(`  ${r}: seeds no bot completes ${lost.length}/${N}${lost.length ? ` (${lost.slice(0, 8).join(', ')}${lost.length > 8 ? ', …' : ''})` : ''}; forecast-reading completion ${rate(pool)}; by cold regions ` +
      [[0, 2], [3, 4], [5, 6], [7, 8], [9, 12]].map(([lo, hi]) => { const b = pool.filter((x) => x.cold >= lo && x.cold <= hi); return `${lo}-${hi} ${rate(b)}` }).join(' · '))
  }

  console.log('\n## 7. Pacing (full rules, completed runs, median): rounds in Tribal / Ancient / Medieval · plays per run')
  table([['bot', ...RS.map((r) => `${r} T/A/M · plays`)], ...Object.keys(BOTS).map((bot) => [bot, ...RS.map((r) => {
    const d = done(runs[r].full[bot])
    if (!d.length) return '-'
    const dur = (i) => med(d.map((x) => x.crises[i].faced - (i ? x.crises[i - 1].faced : 1)))
    return `${dur(0)}/${dur(1)}/${dur(2)} · ${med(d.map((x) => x.plays))}`
  })])])
}
