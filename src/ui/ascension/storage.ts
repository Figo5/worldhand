// Ascension persistence: the run save, the profile and settings, in their
// own localStorage namespace (worldhand.ascension.*), separate from Classic's
// `worldhand.save` keys. No engine logic here.
//
// A run is saved as its setup plus the actions taken (a few KB). Loading
// REPLAYS them through the engine, so a save is valid exactly when every
// action is legal under the current rules — the strongest check there is.
// Anything that cannot be loaded (a newer or older ruleset, corruption) is
// preserved verbatim under a timestamped legacy key, never erased or
// reinterpreted.
import { replay, ASCENSION_RULES_VERSION } from '../../engine/ascension/ascension'
import { CONTENT_VERSION } from '../../engine/ascension/content'
import { loadProfile, newProfile, type Profile } from '../../engine/ascension/profile'
import type { AscensionAction, AscensionState, RunSetup } from '../../engine/ascension/state'

export const RUN_KEY = 'worldhand.ascension.run'
export const PROFILE_KEY = 'worldhand.ascension.profile'
export const SETTINGS_KEY = 'worldhand.ascension.settings'
export const LEGACY_PREFIX = 'worldhand.ascension.legacy.'
export const RUN_SCHEMA = 1
const MAX_ACTIONS = 5000
const ACTION_TYPES = new Set(['play', 'discard', 'face', 'buy', 'reroll', 'remove', 'legendary', 'sell', 'leave'])

export interface RunSave {
  kind: 'worldhand-ascension-run'
  schema: number
  rules: number
  content: number
  savedAt: string
  setup: RunSetup
  actions: AscensionAction[]
}
export interface LoadedRun { setup: RunSetup; actions: AscensionAction[]; state: AscensionState }
export type RunRead = { ok: true; run: LoadedRun } | { ok: false; reason: string }

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
function get(key: string): string | null { try { return storage()?.getItem(key) ?? null } catch { return null } }
function set(key: string, value: string): boolean { try { storage()?.setItem(key, value); return !!storage() } catch { return false } }
function del(key: string): void { try { storage()?.removeItem(key) } catch { /* nothing to do */ } }

/** Keep an unreadable blob under a legacy key (idempotent: the same blob is kept once). */
export function preserveLegacy(raw: string, now = new Date()): string | null {
  const st = storage()
  if (!st) return null
  for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k?.startsWith(LEGACY_PREFIX) && st.getItem(k) === raw) return k }
  const key = `${LEGACY_PREFIX}${now.toISOString()}`
  return set(key, raw) ? key : null
}
export function legacyKeys(): string[] {
  const st = storage(), out: string[] = []
  if (!st) return out
  for (let i = 0; i < st.length; i++) { const k = st.key(i); if (k?.startsWith(LEGACY_PREFIX)) out.push(k) }
  return out.sort()
}

/** Validate and replay a run save. Never throws. */
export function readRun(raw: string): RunRead {
  let o: unknown
  try { o = JSON.parse(raw) } catch { return { ok: false, reason: 'the save is not valid JSON' } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, reason: 'the save is not an object' }
  const r = o as Partial<RunSave>
  if (r.kind !== 'worldhand-ascension-run') return { ok: false, reason: 'not a Worldhand Ascension run' }
  if (r.schema !== RUN_SCHEMA) return { ok: false, reason: `unsupported run save layout (schema ${String(r.schema)}; this build reads ${RUN_SCHEMA})` }
  if (r.rules !== ASCENSION_RULES_VERSION) return { ok: false, reason: `the run was played under Ascension rules ${String(r.rules)}; this build plays rules ${ASCENSION_RULES_VERSION}, so it cannot be resumed faithfully` }
  if (r.content !== CONTENT_VERSION) return { ok: false, reason: `the run used content version ${String(r.content)}; this build has ${CONTENT_VERSION}` }
  if (!Array.isArray(r.actions) || r.actions.length > MAX_ACTIONS) return { ok: false, reason: 'the save has no valid action list' }
  for (const a of r.actions) if (!a || typeof a !== 'object' || !ACTION_TYPES.has((a as { type?: string }).type ?? '')) return { ok: false, reason: 'the save contains an unknown action' }
  try {
    const state = replay(r.setup as RunSetup, r.actions)
    return { ok: true, run: { setup: r.setup as RunSetup, actions: r.actions, state } }
  } catch (e) {
    return { ok: false, reason: `the save does not replay under these rules: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function encodeRun(setup: RunSetup, actions: readonly AscensionAction[], now = new Date()): string {
  const env: RunSave = { kind: 'worldhand-ascension-run', schema: RUN_SCHEMA, rules: ASCENSION_RULES_VERSION, content: CONTENT_VERSION, savedAt: now.toISOString(), setup, actions: [...actions] }
  return JSON.stringify(env)
}
export function saveRun(setup: RunSetup, actions: readonly AscensionAction[]): boolean { return set(RUN_KEY, encodeRun(setup, actions)) }
export function hasRun(): boolean { return get(RUN_KEY) !== null }
export function clearRun(): void { del(RUN_KEY) }

/** The saved run, if any. An unreadable save is preserved as legacy and reported (the key is then cleared). */
export function loadRun(): { run: LoadedRun | null; rejected: { reason: string; legacyKey: string | null } | null } {
  const raw = get(RUN_KEY)
  if (raw === null) return { run: null, rejected: null }
  const res = readRun(raw)
  if (res.ok) return { run: res.run, rejected: null }
  const legacyKey = preserveLegacy(raw)
  if (legacyKey) del(RUN_KEY)
  return { run: null, rejected: { reason: res.reason, legacyKey } }
}

/** The profile (a fresh one if none). An unreadable profile is preserved as legacy and replaced by a fresh one. */
export function loadStoredProfile(): { profile: Profile; notice: string | null } {
  const raw = get(PROFILE_KEY)
  if (raw === null) return { profile: newProfile(), notice: null }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  const res = loadProfile(parsed)
  if (res.ok) {
    if (res.migrated) saveProfile(res.profile)
    return { profile: res.profile, notice: res.migrated ? 'Your Ascension profile was upgraded to this version.' : null }
  }
  const key = preserveLegacy(raw)
  return { profile: newProfile(), notice: `Your Ascension profile could not be read (${res.reason}). It was kept${key ? ` under ${key}` : ''} and a new profile was started.` }
}
export function saveProfile(p: Profile): boolean { return set(PROFILE_KEY, JSON.stringify(p)) }

export interface Settings { motion: 'system' | 'reduced' | 'full'; tips: boolean }
export const DEFAULT_SETTINGS: Settings = { motion: 'system', tips: true }
export function loadSettings(): Settings {
  try {
    const o = JSON.parse(get(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    return {
      motion: o.motion === 'reduced' || o.motion === 'full' ? o.motion : 'system',
      tips: typeof o.tips === 'boolean' ? o.tips : true,
    }
  } catch { return { ...DEFAULT_SETTINGS } }
}
export function saveSettings(s: Settings): void { set(SETTINGS_KEY, JSON.stringify(s)) }

/** One file carrying the profile and the current run (if any). */
export function exportBackup(now = new Date()): string {
  const run = get(RUN_KEY)
  return JSON.stringify({ kind: 'worldhand-ascension-backup', schema: 1, exportedAt: now.toISOString(), profile: JSON.parse(get(PROFILE_KEY) ?? 'null'), run: run ? JSON.parse(run) : null })
}
/** Install a backup. Each part is validated first; a part that fails is not
 *  written, and what is already on this device stays untouched. */
export function importBackup(raw: string): { ok: boolean; message: string; profile: Profile | null; run: LoadedRun | null } {
  let o: Record<string, unknown>
  try { o = JSON.parse(raw) as Record<string, unknown> } catch { return { ok: false, message: 'That file is not valid JSON.', profile: null, run: null } }
  if (!o || o.kind !== 'worldhand-ascension-backup') return { ok: false, message: 'That file is not a Worldhand Ascension backup.', profile: null, run: null }
  const p = o.profile === null || o.profile === undefined ? null : loadProfile(o.profile)
  if (p && !p.ok) return { ok: false, message: `The profile in that file cannot be used: ${p.reason}. Nothing was changed.`, profile: null, run: null }
  let run: LoadedRun | null = null
  if (o.run) {
    const r = readRun(JSON.stringify(o.run))
    if (!r.ok) return { ok: false, message: `The run in that file cannot be resumed: ${r.reason}. Nothing was changed.`, profile: null, run: null }
    run = r.run
  }
  if (p?.ok) saveProfile(p.profile)
  if (run) saveRun(run.setup, run.actions)
  return { ok: true, message: `Imported${p?.ok ? ' the profile' : ''}${p?.ok && run ? ' and' : ''}${run ? ' a run in progress' : ''}.`, profile: p?.ok ? p.profile : null, run }
}
