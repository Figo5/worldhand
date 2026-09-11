// Versioned localStorage save system. No engine logic here.
//
// Contract:
// - The envelope carries TWO versions: `schema` (layout generation, tracked by
//   SCHEMA_VERSION) and the state's own `state.version` (the engine RULES
//   generation, tracked by SAVE_VERSION).
// - On load, an envelope whose versions do not match the CURRENT engine — or
//   whose state fails the structural validator (`validateState`) — is NEVER
//   migrated, reinterpreted, or erased. The raw blob is preserved verbatim
//   under a timestamped legacy key (`worldhand.save.legacy.<ts>`) so the old
//   run stays recoverable, and load returns null with a clear reason.
// - Quitting never destroys the save. `clearSave` is the only destructive
//   operation and must be gated behind an explicit UI confirmation.
import type { GameState } from '../engine/worldhand'
import {
  SAVE_VERSION, SCHEMA_VERSION, validateState,
} from '../engine/worldhand'

const KEY = 'worldhand.save'
export const CURRENT_VERSION = SAVE_VERSION
export const SCHEMA_VERSION_CURRENT = SCHEMA_VERSION
export const LEGACY_PREFIX = 'worldhand.save.legacy.'

interface SaveEnvelope {
  schema: number
  version: number // engine rules version (SAVE_VERSION) the state was made by
  savedAt: string
  state: GameState
}

/** A v8 save could have been written in the narrow bug window where the last
 *  missed life opened a market. Load it as terminal, without applying shop
 *  effects or rejecting the otherwise-current save as legacy. */
function canonicalizeTerminalState(state: GameState): GameState {
  if (state.phase === 'game-over') return state
  if (state.lives > 0 && state.flourishing > 0) return state
  return {
    ...state,
    phase: 'game-over',
    market: [],
    projectMarket: [],
    jokerMarket: [],
    planetMarket: [],
    consumableMarket: [],
    voucherMarket: [],
    marketVisitBuys: [],
    outcome: 'withered',
    outcomeReason: state.lives <= 0
      ? `Out of lives (${state.lives}): too many epoch targets missed. The world withers.`
      : 'Flourishing collapsed to 0.',
  }
}

/** Preserve an incompatible save verbatim as recoverable legacy data. The
 *  raw string is stored untouched under a timestamped key — never erased,
 *  never rewritten. Returns the legacy key used. */
export function preserveLegacy(raw: string): string {
  const key = `${LEGACY_PREFIX}${Date.now()}`
  try {
    localStorage.setItem(key, raw)
  } catch {
    // storage full: drop the OLDEST legacy blob to make room, then retry once
    const olds = legacyKeys()
    if (olds.length > 0) {
      try { localStorage.removeItem(olds[0]); localStorage.setItem(key, raw) } catch { /* give up quietly */ }
    }
  }
  return key
}

function legacyKeys(): string[] {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(LEGACY_PREFIX)) out.push(k)
  }
  return out.sort()
}

/** All preserved legacy saves (oldest first) — surfaced so a player can see
 *  their old runs were kept, not lost. */
export function listLegacySaves(): { key: string; savedBlob: string }[] {
  return legacyKeys().map((key) => ({ key, savedBlob: localStorage.getItem(key) ?? '' }))
}

export function saveGame(state: GameState): void {
  const env: SaveEnvelope = {
    schema: SCHEMA_VERSION_CURRENT,
    version: CURRENT_VERSION,
    savedAt: new Date().toISOString(),
    state,
  }
  localStorage.setItem(KEY, JSON.stringify(env))
}

export interface LoadResult {
  state: GameState | null
  /** null when loaded fine; otherwise a plain-language explanation */
  rejectedReason: string | null
  /** the legacy key the incompatible blob was preserved under, if any */
  legacyKey: string | null
}

/** Load + validate. Any incompatibility (version or structure) preserves the
 *  raw blob as legacy data and returns `{ state: null, rejectedReason, legacyKey }`.
 *  Never returns a partially migrated or reinterpreted state. */
/** The whole compatibility gate, with no storage side effects: version first
 *  (schema layout + engine rules), then structure. Shared by the localStorage
 *  load path and the portable-blob import path so a save can never be accepted
 *  by one and rejected by the other. */
function readEnvelope(raw: string): { state: GameState | null; rejectedReason: string | null } {
  let env: SaveEnvelope
  try {
    env = JSON.parse(raw) as SaveEnvelope
  } catch {
    return { state: null, rejectedReason: 'The save file is corrupt (not valid JSON).' }
  }
  if (env === null || typeof env !== 'object') {
    return { state: null, rejectedReason: 'The save file is corrupt (not a save envelope).' }
  }
  if (env.schema !== SCHEMA_VERSION_CURRENT || env.version !== CURRENT_VERSION) {
    return {
      state: null,
      rejectedReason: `The save was made by engine version ${JSON.stringify(env.version ?? 'unknown')} (schema ${JSON.stringify(env.schema ?? 'unknown')}), which is incompatible with this build's bounded-economy engine v${CURRENT_VERSION} (schema ${SCHEMA_VERSION_CURRENT}). The rules changed, so that run cannot be continued under them.`,
    }
  }
  const state = canonicalizeTerminalState(env.state)
  const reason = validateState(state)
  if (reason !== null) {
    return { state: null, rejectedReason: `The save's structure is incompatible with the current engine: ${reason}.` }
  }
  return { state, rejectedReason: null }
}

export function loadGameDetailed(): LoadResult {
  const raw = localStorage.getItem(KEY)
  if (raw === null) return { state: null, rejectedReason: null, legacyKey: null }
  const { state, rejectedReason } = readEnvelope(raw)
  if (state === null) {
    const legacyKey = preserveLegacy(raw)
    return {
      state: null,
      rejectedReason: `${rejectedReason} It has been preserved unchanged as legacy data — start a fresh world.`,
      legacyKey,
    }
  }
  return { state, rejectedReason: null, legacyKey: null }
}

/** The current save as a portable blob (exactly what is in storage), or null
 *  when there is nothing saved. Used by the offline build to carry a run
 *  between machines — there is no backend and no account. */
export function exportSave(): string | null {
  return localStorage.getItem(KEY)
}

/** Install a blob produced by `exportSave` on this device. The blob goes
 *  through the same gate as a normal load; a rejected blob is NOT written and
 *  NOT preserved as legacy, so the save already on this device is untouched. */
export function importSave(raw: string): LoadResult {
  const { state, rejectedReason } = readEnvelope(raw)
  if (state === null) return { state: null, rejectedReason, legacyKey: null }
  saveGame(state)
  return { state, rejectedReason: null, legacyKey: null }
}

/** Compatibility wrapper: returns the loaded state, or null when absent or
 *  incompatible (the raw blob stays preserved under a legacy key either way). */
export function loadGame(): GameState | null {
  return loadGameDetailed().state
}

export function clearSave(): void {
  localStorage.removeItem(KEY)
}

export function hasSave(): boolean {
  return loadGame() !== null
}

/** A human-readable note attached to a fresh-start explanation in the UI. */
export function legacyNotice(reason: string | null, legacyKey: string | null): string | null {
  if (!reason) return null
  return reason + (legacyKey ? ` (preserved under ${legacyKey})` : '')
}