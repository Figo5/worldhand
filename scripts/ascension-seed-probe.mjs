// Cross the play and Council policies on one difficult seed. This explores
// legal strategy combinations after a broad audit reports no single bot win.
import { BOTS, POOLS, drive } from './lib/asc-bots.mjs'

const seedText = process.argv[2]
const poolName = process.argv[3] ?? 'starter'
if (!seedText || !POOLS[poolName]) throw new Error('usage: ascension-seed-probe.mjs SEED [starter|full]')
const policies = ['poker-max', 'poker-dig', 'balanced', 'planner', 'planner-late', 'lean-V', 'lean-P', 'lean-I', 'lean-K', 'duo-IV', 'duo-PK', 'terrain', 'civ', 'sampler', 'sampler-poker']
const setup = { seedText, omen: 0, origin: 'pangaea', pool: POOLS[poolName] }
const wins = []
for (const play of policies) for (const council of policies) {
  const end = drive(setup, { play: BOTS[play].play, council: BOTS[council].council })
  if (end.phase === 'won') wins.push({ play, council, score: end.score, plays: end.plays })
}
console.log(`# ${seedText}, ${poolName} pool: ${wins.length}/${policies.length ** 2} legal policy combinations won`)
for (const win of wins) console.log(`${win.play.padEnd(13)} / ${win.council.padEnd(13)} score ${String(win.score).padStart(6)} plays ${win.plays}`)
