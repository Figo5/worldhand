// ASCENSION FIRST-PLAYABLE AUDIT — diagnostic only, says nothing about human fun.
//
// Plays the complete current loop (stats, terrain, civilizations, passives,
// eras, crises, completion) with the documented bots in lib/ascension-bots.mjs
// over a fixed seed set, under rule ablations, and audits sampled decisions
// and crisis fairness. Worker threads split the work; results are identical
// however many workers run.
//
// Run: node --import ./scripts/ts-resolve.mjs scripts/ascension-audit.mjs [seeds=1000] [--json out.json]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { availableParallelism } from 'node:os'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BOTS, ABLATIONS, SUBSETS, ROUND_CAP, drive, crisisMargin } from './lib/ascension-bots.mjs'
import { evaluatePlay, projectRoundEnd, runStatus, WORLD_STATS } from '../src/engine/ascension/ascension.ts'
import { CRISES, evaluateCrisis } from '../src/engine/ascension/crises.ts'
import { ERAS, canAdvance } from '../src/engine/ascension/eras.ts'
import { ARCHETYPES, ARCHETYPE_ORDER } from '../src/engine/ascension/civilizations.ts'

const count = (regions, ts) => regions.filter((r) => ts.includes(r.terrain)).length

/** One run, reduced to what the report needs. */
function record(seed, bot) {
  let plays = 0
  const triggers = [] // per crisis: forecast before its triggering play, after the play (before emergence), and actual
  const civRounds = new Set(), crisisRounds = new Set()
  const s = drive(seed, BOTS[bot].policy, (before, action, after) => {
    if (action.type === 'play') plays += 1
    if (after.civilizations.length > before.civilizations.length) civRounds.add(before.round)
    if (after.crisis && !before.crisis) {
      crisisRounds.add(before.round)
      const f0 = evaluateCrisis(before.era, before)
      const f1 = evaluateCrisis(before.era, { ...before, stats: after.stats })
      const act = evaluateCrisis(after.era, after)
      triggers.push({
        before: f0.result, afterPlay: f1.result, actual: act.result,
        standing: projectRoundEnd(before).crisis.result, // the UI forecast before the play ("if this round ended now")
        previewed: projectRoundEnd(before, after.stats).crisis.result, // the UI preview of the triggering play
        byEmergence: !canAdvance(before.era, after.stats, before.civilizations),
        newCiv: after.civilizations.length > before.civilizations.length ? after.civilizations[after.civilizations.length - 1].archetype : null,
      })
    }
  })
  const lastRound = Math.min(s.round, ROUND_CAP)
  let quiet = 0, run = 0 // longest stretch of rounds with no civilization and no crisis
  for (let r = 1; r < lastRound; r++) { run = civRounds.has(r) || crisisRounds.has(r) ? 0 : run + 1; quiet = Math.max(quiet, run) }
  return {
    seed, status: runStatus(s), round: s.round, plays, score: s.score, stats: s.stats,
    civs: s.civilizations.map((c) => [c.archetype, c.emergedRound]),
    crises: s.crises.map((c, i) => ({
      id: c.crisis, round: c.round, result: c.result, margin: c.resilience - c.pressure,
      factors: Object.fromEntries([...c.pressures.map((f) => [f.label, -f.amount]), ...c.mitigations.map((f) => [f.label, f.amount])]),
      stats: c.result === 'survived' ? s.eraLog[i].stats : s.stats, trigger: triggers[i],
    })),
    quiet,
    possible: ARCHETYPE_ORDER.filter((a) => s.regions.some((r) => ARCHETYPES[a].terrains.includes(r.terrain))),
    land: { cold: count(s.regions, ['tundra', 'mountains']), fertile: count(s.regions, ['forest', 'plains']), crowded: count(s.regions, ['coast', 'plains']),
      isolated: count(s.regions, ['desert', 'tundra']), open: count(s.regions, ['plains', 'desert', 'coast']), mountains: count(s.regions, ['mountains']) },
  }
}

/** At every play state of a run: which plays win under which objective. */
function decisions(seed, bot) {
  const c = { states: 0, pokerIsScore: 0, terrainChanges: 0, withCivs: 0, passivesChange: 0, atRisk: 0, crisisChanges: 0, crisisChangesAtRisk: 0,
    crisisCost: [], progressChanges: 0, fewerCards: 0, fewerCardsCost: [] }
  drive(seed, BOTS[bot].policy, (s, action) => {
    if (action.type !== 'play' && action.type !== 'discard') return
    const rs = SUBSETS.map((idx) => ({ r: evaluatePlay(s, idx), idx }))
    const after = (r) => Object.fromEntries(WORLD_STATS.map((k) => [k, s.stats[k] + r.statDeltas[k]]))
    const top = (f) => { const m = Math.max(...rs.map(f)); return rs.filter((x) => f(x) === m) }
    const maxScore = Math.max(...rs.map((x) => x.r.score))
    /** does picking the best play under `f` also give a best-score play? */
    const agrees = (f) => top(f).some((x) => x.r.score === maxScore)
    c.states += 1
    if (agrees((x) => x.r.pokerScore)) c.pokerIsScore += 1
    if (!agrees((x) => x.r.score - x.r.landBonus)) c.terrainChanges += 1
    if (s.civilizations.length) { c.withCivs += 1; if (!agrees((x) => x.r.score - x.r.civBonus)) c.passivesChange += 1 }
    const margin = (x) => crisisMargin(s, after(x.r))
    const risk = crisisMargin(s, s.stats) < 10
    const best = top(margin)
    if (!best.some((x) => x.r.score === maxScore)) {
      c.crisisChanges += 1
      if (risk) c.crisisChangesAtRisk += 1
      if (risk) c.crisisCost.push(maxScore - Math.max(...best.map((x) => x.r.score)))
    }
    if (risk) c.atRisk += 1
    const { stats: n, min } = ERAS[s.era].needs
    const progress = (x) => { const st = after(x.r); return WORLD_STATS.map((k) => Math.min(st[k], min)).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0) }
    if (!agrees(progress)) c.progressChanges += 1
    const scoreTop = top((x) => x.r.score)
    if (scoreTop.every((x) => x.idx.length < 5)) { c.fewerCards += 1; c.fewerCardsCost.push(maxScore - Math.max(...rs.filter((x) => x.idx.length === 5).map((x) => x.r.score))) }
  })
  return c
}

if (!isMainThread) {
  const { kind, ablation, bot, seeds } = workerData
  const restore = ABLATIONS[ablation].apply()
  const out = seeds.map((seed) => (kind === 'runs' ? record(seed, bot) : decisions(seed, bot)))
  restore()
  parentPort.postMessage(out)
} else {
  const N = Number(process.argv[2] ?? 1000)
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
  const SEEDS = Array.from({ length: N }, (_, i) => `audit-${i}`)
  const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
  const jobs = []
  for (const ablation of Object.keys(ABLATIONS)) for (const bot of Object.keys(BOTS)) for (const seeds of chunk(SEEDS, 100)) jobs.push({ kind: 'runs', ablation, bot, seeds })
  const DECISION_BOTS = ['balanced', 'score-max', 'prepared', 'random']
  for (const bot of DECISION_BOTS) for (const seeds of chunk(SEEDS.slice(0, Math.min(N, 200)), 20)) jobs.push({ kind: 'decisions', ablation: 'full', bot, seeds })

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
  const runs = {} // runs[ablation][bot] = records
  const dec = {}
  jobs.forEach((j, i) => {
    if (j.kind === 'runs') ((runs[j.ablation] ??= {})[j.bot] ??= []).push(...results[i])
    else (dec[j.bot] ??= []).push(...results[i])
  })
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ runs, dec }))
  report(N, runs, dec, (Date.now() - t0) / 1000)
}

// ---------------------------------------------------------------------------
function report(N, runs, dec, secs) {
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')
  const q = (a, p) => { if (!a.length) return '-'; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))] }
  const med = (a) => q(a, 0.5)
  const done = (rs) => rs.filter((r) => r.status === 'complete')
  const ABBR = { natureKeepers: 'NK', nomads: 'No', merchants: 'Me', empireBuilders: 'EB', scholars: 'Sc', technocrats: 'Te' }
  const topFactor = (c) => Object.entries(c.factors).filter(([, v]) => v < 0).slice(1).sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'thin defences'
  const table = (rows) => { const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length))); for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(w[i])).join('  ')) }
  const full = runs.full

  console.log(`# Ascension first-playable audit — ${N} seeds, ${Object.keys(BOTS).length} bots, ${Object.keys(ABLATIONS).length} rule sets, cap ${ROUND_CAP} rounds (${secs.toFixed(0)}s)\n`)
  console.log('## Bots'); for (const [n, b] of Object.entries(BOTS)) console.log(`  ${n.padEnd(12)} ${b.doc}`)

  console.log('\n## 1. Strategies (full rules)')
  table([['bot', 'complete', 'winter', 'plague', 'invasion', 'rounds p10/med/p90', 'plays', 'score med', 'V/P/I/K at completion', 'civs', 'top failure reasons'],
    ...Object.entries(full).map(([bot, rs]) => {
      const surv = (i) => { const f = rs.filter((r) => r.crises[i]); return pct(f.filter((r) => r.crises[i].result === 'survived').length, f.length) }
      const d = done(rs), why = {}
      for (const r of rs) if (r.status === 'failed') { const c = r.crises[r.crises.length - 1]; const k = `${c.id}: ${topFactor(c)}`; why[k] = (why[k] ?? 0) + 1 }
      return [bot, pct(d.length, rs.length), surv(0), surv(1), surv(2), `${q(d.map((r) => r.round - 1), 0.1)}/${med(d.map((r) => r.round - 1))}/${q(d.map((r) => r.round - 1), 0.9)}`,
        med(d.map((r) => r.plays)), med(rs.map((r) => r.score)), WORLD_STATS.map((k) => med(d.map((r) => r.stats[k]))).join('/'), med(d.map((r) => r.civs.length)),
        Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${pct(n, rs.length)}`).join('; ')]
    })])
  const stuck = Object.entries(full).map(([b, rs]) => [b, rs.filter((r) => !['complete', 'failed'].includes(r.status)).length]).filter(([, n]) => n)
  if (stuck.length) console.log(`  stuck at the cap: ${stuck.map(([b, n]) => `${b} ${n}`).join(', ')}`)

  console.log('\n## 2. Ablations: completion rate (and median rounds to complete) per rule set')
  const abl = Object.keys(ABLATIONS)
  table([['bot', ...abl], ...Object.keys(BOTS).map((bot) => [bot, ...abl.map((a) => { const rs = runs[a][bot], d = done(rs); return `${pct(d.length, rs.length)} (${med(d.map((r) => r.round - 1))})` })])])
  console.log('\n  median final score per rule set (all runs)')
  table([['bot', ...abl], ...Object.keys(BOTS).map((bot) => [bot, ...abl.map((a) => med(runs[a][bot].map((r) => r.score)))])])
  console.log('\n  crisis survival (winter/plague/invasion, % of those who faced it) per rule set')
  table([['bot', ...abl], ...Object.keys(BOTS).map((bot) => [bot, ...abl.map((a) => [0, 1, 2].map((i) => { const f = runs[a][bot].filter((r) => r.crises[i]); return f.length ? Math.round((100 * f.filter((r) => r.crises[i].result === 'survived').length) / f.length) : '-' }).join('/'))])])
  console.log('\n  civilization diversity: median civilizations at the end, and distinct archetype sets among completers')
  table([['bot', ...abl], ...Object.keys(BOTS).map((bot) => [bot, ...abl.map((a) => { const rs = runs[a][bot]; return `${med(rs.map((r) => r.civs.length))} civ, ${new Set(done(rs).map((r) => r.civs.map((c) => ABBR[c[0]]).sort().join(''))).size} sets` })])])

  const POOL = ['poker-max', 'score-max', 'balanced', 'prepared', 'civ-synergy']
  console.log(`\n## 3. Structure (full rules; "pooled" = the competent bots ${POOL.join(', ')})`)
  const pool = POOL.flatMap((b) => full[b])
  const completion = (rs) => pct(done(rs).length, rs.length)
  console.log('  completion by land (pooled; n = runs):')
  for (const [key, label, buckets] of [['cold', 'cold regions (tundra+mountains)', [[0, 2], [3, 4], [5, 6], [7, 8], [9, 12]]], ['open', 'open regions (plains+desert+coast)', [[0, 2], [3, 4], [5, 6], [7, 12]]], ['crowded', 'crowded regions (coast+plains)', [[0, 1], [2, 3], [4, 5], [6, 12]]]]) {
    console.log(`    ${label}: ` + buckets.map(([lo, hi]) => { const rs = pool.filter((r) => r.land[key] >= lo && r.land[key] <= hi); return `${lo}-${hi}: ${completion(rs)} (n ${rs.length})` }).join(' · '))
  }
  for (const bot of ['balanced', 'prepared', 'score-max']) {
    const rs = full[bot]
    console.log(`  ${bot}: completion by cold regions ` + [[0, 2], [3, 4], [5, 6], [7, 8], [9, 12]].map(([lo, hi]) => { const b = rs.filter((r) => r.land.cold >= lo && r.land.cold <= hi); return `${lo}-${hi} ${completion(b)} (n ${b.length})` }).join(' · '))
  }
  console.log('  civilization present at the Harsh Winter → survival rate (pooled; with vs without):')
  for (const a of Object.keys(ABBR)) {
    const faced = pool.filter((r) => r.crises[0])
    const has = (r) => r.civs.some(([x, round]) => x === a && round <= r.crises[0].round)
    const w = faced.filter(has), wo = faced.filter((r) => !has(r))
    const s = (rs) => pct(rs.filter((r) => r.crises[0].result === 'survived').length, rs.length)
    console.log(`    ${a.padEnd(15)} with ${s(w)} (n ${w.length}) · without ${s(wo)} (n ${wo.length})`)
  }
  console.log('  completion when the land offers an archetype no home at all vs when it does (pooled; causal: terrain decides this):')
  for (const a of Object.keys(ABBR)) {
    const no = pool.filter((r) => !r.possible.includes(a)), yes = pool.filter((r) => r.possible.includes(a))
    console.log(`    ${a.padEnd(15)} impossible ${completion(no)} (n ${no.length}) · possible ${completion(yes)} (n ${yes.length})`)
  }
  console.log('  completion when each civilization is present at the end vs absent (pooled; correlational):')
  for (const a of Object.keys(ABBR)) {
    const w = pool.filter((r) => r.civs.some(([x]) => x === a)), wo = pool.filter((r) => !r.civs.some(([x]) => x === a))
    console.log(`    ${a.padEnd(15)} with ${completion(w)} (n ${w.length}) · without ${completion(wo)} (n ${wo.length})`)
  }
  console.log('  among survivors of each crisis (pooled): the stat profile, and how often the strain was zero')
  for (const [i, c] of CRISES.entries()) {
    const sv = pool.filter((r) => r.crises[i]?.result === 'survived').map((r) => r.crises[i])
    const strainKey = ['Cleared forests', 'Trade outruns medicine', 'A lopsided realm'][i]
    console.log(`    ${c.label.padEnd(13)} n ${sv.length}: median V/P/I/K ${WORLD_STATS.map((k) => med(sv.map((x) => x.stats[k]))).join('/')}; strain 0 in ${pct(sv.filter((x) => x.factors[strainKey] === 0).length, sv.length)}; margin p10/med/p90 ${q(sv.map((x) => x.margin), 0.1)}/${med(sv.map((x) => x.margin))}/${q(sv.map((x) => x.margin), 0.9)}`)
  }
  console.log('  most common civilization sets at completion (pooled):')
  const sets = {}
  for (const r of done(pool)) { const k = r.civs.map((c) => ABBR[c[0]]).sort().join(' '); sets[k] = (sets[k] ?? 0) + 1 }
  console.log('    ' + Object.entries(sets).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `[${k}] ${pct(n, done(pool).length)}`).join(' · '))

  console.log('\n## 4. Decision value (sampled play states; "X changes the best play" = the best play without X is not a best-score play)')
  table([['states from', 'n', 'poker-best = score-best', 'terrain changes best', 'passives change best (with civs)', 'crisis-best ≠ score-best (all / when at risk)', 'score cost of the crisis-best play (med, at risk)', 'era-progress-best ≠ score-best', 'score-best play uses < 5 cards'],
    ...Object.entries(dec).map(([bot, cs]) => {
      const sum = (k) => cs.reduce((n, c) => n + c[k], 0), cat = (k) => cs.flatMap((c) => c[k])
      return [bot, sum('states'), pct(sum('pokerIsScore'), sum('states')), pct(sum('terrainChanges'), sum('states')), pct(sum('passivesChange'), sum('withCivs')),
        `${pct(sum('crisisChanges'), sum('states'))} / ${pct(sum('crisisChangesAtRisk'), sum('atRisk'))}`, med(cat('crisisCost')), pct(sum('progressChanges'), sum('states')), pct(sum('fewerCards'), sum('states'))]
    })])

  console.log('\n## 5. Crisis fairness (full rules)')
  const lostAll = Object.keys(full.balanced.map((r) => r.seed)).length ? full.balanced.map((r) => r.seed).filter((seed) => !Object.values(full).some((rs) => rs.find((r) => r.seed === seed).status === 'complete')) : []
  console.log(`  seeds no bot completes: ${lostAll.length}/${N}${lostAll.length ? ` (${lostAll.slice(0, 10).join(', ')}${lostAll.length > 10 ? ', …' : ''})` : ''}`)
  const prep = full.prepared
  console.log(`  prepared (forecast-reading) completes ${completion(prep)}; its failures: ${Object.entries(prep.filter((r) => r.status === 'failed').reduce((m, r) => { const c = r.crises[r.crises.length - 1]; const k = `${c.id} (${topFactor(c)}, margin ${c.margin})`; m[k] = (m[k] ?? 0) + 1; return m }, {})).map(([k, n]) => `${n}× ${k}`).join(', ') || 'none'}`)
  for (const [i, c] of CRISES.entries()) {
    const t = pool.filter((r) => r.crises[i]?.trigger).map((r) => r.crises[i])
    const flipPlay = t.filter((x) => x.trigger.before !== x.trigger.afterPlay).length
    const flipEmerge = t.filter((x) => x.trigger.afterPlay !== x.trigger.actual).length
    const emergeHurt = t.filter((x) => x.trigger.afterPlay === 'survived' && x.trigger.actual === 'failed')
    console.log(`  ${c.label.padEnd(13)} n ${t.length}: forecast shown before the triggering play ≠ outcome in ${pct(t.filter((x) => x.trigger.before !== x.trigger.actual).length, t.length)}` +
      ` (the play itself flips it ${pct(flipPlay, t.length)}; the round-end emergence flips it ${pct(flipEmerge, t.length)}, turning survival into failure ${pct(emergeHurt.length, t.length)}${emergeHurt.length ? ` — by ${Object.entries(emergeHurt.reduce((m, x) => { m[x.trigger.newCiv] = (m[x.trigger.newCiv] ?? 0) + 1; return m }, {})).map(([a, n]) => `${a} ${n}`).join(', ')}` : ''});` +
      ` struck because a civilization emerged: ${pct(t.filter((x) => x.trigger.byEmergence).length, t.length)}`)
    console.log(`  ${''.padEnd(13)} with the round-end projection: "if this round ended now" before the triggering play ≠ outcome ${pct(t.filter((x) => x.trigger.standing !== x.trigger.actual).length, t.length)}; the triggering play's preview ≠ outcome ${pct(t.filter((x) => x.trigger.previewed !== x.trigger.actual).length, t.length)}`)
  }
  for (const [i, c] of CRISES.entries()) {
    const m = Object.fromEntries(Object.entries(full).map(([b, rs]) => [b, rs.filter((r) => r.crises[i])]).filter(([, f]) => f.length))
    console.log(`  ${c.label.padEnd(13)} survival by bot: ${Object.entries(m).map(([b, f]) => `${b} ${Math.round((100 * f.filter((r) => r.crises[i].result === 'survived').length) / f.length)}%`).join(' · ')}`)
  }

  console.log('\n## 6. Pacing (full rules, completed runs)')
  table([['bot', 'Tribal rounds', 'Ancient rounds', 'Medieval rounds', 'plays/run', 'civs at Winter/Plague/Invasion', 'longest quiet stretch (rounds, med/p90)'],
    ...Object.entries(full).map(([bot, rs]) => {
      const d = done(rs)
      const dur = (i) => d.map((r) => r.crises[i].round - (i ? r.crises[i - 1].round : 0))
      const civAt = (i) => med(d.map((r) => r.civs.filter(([, round]) => round <= r.crises[i].round).length))
      return [bot, `${q(dur(0), 0.1)}/${med(dur(0))}/${q(dur(0), 0.9)}`, `${q(dur(1), 0.1)}/${med(dur(1))}/${q(dur(1), 0.9)}`, `${q(dur(2), 0.1)}/${med(dur(2))}/${q(dur(2), 0.9)}`,
        med(d.map((r) => r.plays)), `${civAt(0)}/${civAt(1)}/${civAt(2)}`, `${med(rs.map((r) => r.quiet))}/${q(rs.map((r) => r.quiet), 0.9)}`]
    })])
}
