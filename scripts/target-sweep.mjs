// TARGET-CURVE CALIBRATION SWEEP — development seeds ONLY.
//
// Runs the frozen P2 "cheapest" and P0 "no-shop" policies at several values of
// TARGET_GROWTH and reports run depth. The held-out seed set is deliberately
// NOT touched here: a constant picked against held-out data is a constant
// fitted to its own test.
//
// TARGET_GROWTH is read from the environment by the engine only for this
// sweep; the shipped value is the literal in src/engine/worldhand.ts.
// Run: node --import ./scripts/ts-resolve.mjs scripts/target-sweep.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ENGINE = 'src/engine/worldhand.ts'
const original = readFileSync(ENGINE, 'utf8')
const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1.28, 1.32, 1.36, 1.40, 1.45]

console.log('TARGET_GROWTH sweep — development seeds (probe-*) only\n')
try {
  for (const g of CANDIDATES) {
    if (!/export const TARGET_GROWTH = [\d.]+/.test(original)) throw new Error('could not find TARGET_GROWTH')
    const patched = original.replace(/export const TARGET_GROWTH = [\d.]+/, `export const TARGET_GROWTH = ${g}`)
    writeFileSync(ENGINE, patched)
    const out = execFileSync('node', [
      '--import', './scripts/ts-resolve.mjs', 'scripts/difficulty-measure.mjs',
      '--set', 'dev', '--seeds', '20', '--cap', '60',
    ], { encoding: 'utf8' })
    const grab = (policy) => {
      const i = out.indexOf(`--- ${policy} ---`)
      const line = out.slice(i).split('\n').find((l) => l.startsWith('run depth')) ?? ''
      const m = /min (\d+).*median (\d+).*max (\d+)\s+mean ([\d.]+)/.exec(line)
      return m ? { min: +m[1], med: +m[2], max: +m[3], mean: +m[4] } : null
    }
    const capLine = out.split('\n').filter((l) => l.includes('NOT BOUNDED')).length
    // first epoch where the mean banked/target of P2 drops below 1.5 (tension starts)
    const p2 = out.slice(out.indexOf('--- P2 cheapest ---'))
    const tension = p2.split('\n')
      .map((l) => /^\s*(\d+) \|\s+\d+ \|\s+\d+ \|\s+([\d.]+) \|/.exec(l))
      .filter(Boolean).find((m) => Number(m[2]) < 1.5)
    const ns = grab('P0 no-shop'), ch = grab('P2 cheapest'), fo = grab('P3 focused')
    console.log(
      `g=${g.toFixed(2)}  no-shop med ${String(ns.med).padStart(2)}  |  cheapest min ${String(ch.min).padStart(2)} med ${String(ch.med).padStart(2)} max ${String(ch.max).padStart(2)} mean ${ch.mean.toFixed(1)}  |  ` +
      `focused med ${String(fo.med).padStart(2)} mean ${fo.mean.toFixed(1)}  |  tension from epoch ${tension ? tension[1] : '-'}  |  unbounded policies ${capLine}`,
    )
  }
} finally {
  writeFileSync(ENGINE, original)
  console.log('\n(engine restored to its committed TARGET_GROWTH)')
}
