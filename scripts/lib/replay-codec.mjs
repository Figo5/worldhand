// Compact text codec for Classic engine Actions + a stable state hash, shared
// by scripts/record-classic-replays.mjs and tests/classic-replays.test.ts.
//
//   t<i>  toggleCard      d<i.j.k>  discard      c  clearSelection   p  play
//   w     boostWorld      e         endMarket    x  closeEpoch
//   b:<id> buy   bp:<id> buyProject   bj:<id> buyJoker   bn:<id> buyPlanet
//   bc:<id> buyConsumable   bv:<id> buyVoucher   r:<id> removeLaw
import { hashSeed } from '../../src/engine/rng.ts'

const SIMPLE = { clearSelection: 'c', play: 'p', boostWorld: 'w', endMarket: 'e', closeEpoch: 'x' }
const BY_ID = {
  buy: ['b', 'itemId'], buyProject: ['bp', 'projectId'], buyJoker: ['bj', 'jokerId'],
  buyPlanet: ['bn', 'planetId'], buyConsumable: ['bc', 'consumableId'],
  buyVoucher: ['bv', 'voucherId'], removeLaw: ['r', 'lawId'],
}
const SIMPLE_BY_CODE = Object.fromEntries(Object.entries(SIMPLE).map(([t, c]) => [c, t]))
const BY_ID_CODE = Object.fromEntries(Object.entries(BY_ID).map(([t, [c, key]]) => [c, [t, key]]))

export const ACTION_TYPES = ['toggleCard', 'discard', ...Object.keys(SIMPLE), ...Object.keys(BY_ID)]

export function encodeAction(a) {
  if (a.type === 'toggleCard') return `t${a.cardIdx}`
  if (a.type === 'discard') return `d${a.cardIdxs.join('.')}`
  if (a.type in SIMPLE) return SIMPLE[a.type]
  if (a.type in BY_ID) { const [code, key] = BY_ID[a.type]; return `${code}:${a[key]}` }
  throw new Error(`cannot encode action ${JSON.stringify(a)}`)
}

export function decodeAction(code) {
  const colon = code.indexOf(':')
  if (colon >= 0) {
    const entry = BY_ID_CODE[code.slice(0, colon)]
    if (!entry) throw new Error(`bad action code "${code}"`)
    return { type: entry[0], [entry[1]]: code.slice(colon + 1) }
  }
  if (code in SIMPLE_BY_CODE) return { type: SIMPLE_BY_CODE[code] }
  if (code[0] === 't') return { type: 'toggleCard', cardIdx: Number(code.slice(1)) }
  if (code[0] === 'd') return { type: 'discard', cardIdxs: code.slice(1).split('.').map(Number) }
  throw new Error(`bad action code "${code}"`)
}

/** 8-hex FNV-1a of the full serialized state (log included). */
export function stateHash(s) {
  return hashSeed(JSON.stringify(s)).toString(16).padStart(8, '0')
}
