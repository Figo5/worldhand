// Ascension persistence: run saves (setup + actions, validated by replay),
// the profile (schema, migration, normalization) and backups. Classic's
// save keys are never touched.
import { describe, it, expect, beforeEach } from 'vitest'
import { applyAction, newRun, runStatus, ASCENSION_RULES_VERSION } from '../src/engine/ascension/ascension'
import { evaluatePlay } from '../src/engine/ascension/scoring'
import { FULL_POOL } from '../src/engine/ascension/pool'
import { newProfile, loadProfile, learn, recordRun, poolOf, ACHIEVEMENTS, PROFILE_SCHEMA, HISTORY_LIMIT } from '../src/engine/ascension/profile'
import { MAX_OMEN } from '../src/engine/ascension/rules'
import type { AscensionAction, AscensionState, RunSetup } from '../src/engine/ascension/state'
import {
  saveRun, loadRun, readRun, encodeRun, clearRun, loadStoredProfile, saveProfile, exportBackup, importBackup, legacyKeys,
  RUN_KEY, PROFILE_KEY, LEGACY_PREFIX,
} from '../src/ui/ascension/storage'
import { saveGame } from '../src/ui/save'
import { newGame } from '../src/engine/worldhand'

class MemStorage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null }
  getItem(k: string): string | null { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}
const store = new MemStorage()
;(globalThis as unknown as { localStorage: MemStorage }).localStorage = store

const setup = (seedText = 'save-world'): RunSetup => ({ seedText, omen: 0, origin: 'pangaea', pool: FULL_POOL })
/** A greedy scripted run, recording its actions, stopping when `until` holds. */
function play(seedText: string, until: (s: AscensionState) => boolean = () => false) {
  const actions: AscensionAction[] = []
  let s = newRun(setup(seedText))
  const go = (a: AscensionAction) => { actions.push(a); s = applyAction(s, a) }
  for (let g = 0; g < 600 && s.phase !== 'won' && s.phase !== 'lost' && !until(s); g++) {
    const st = runStatus(s)
    if (st === 'council') {
      if (s.council!.legendaryChoice) go({ type: 'legendary', pick: 0 })
      else { const i = s.council!.offers.findIndex((o) => !o.sold && o.kind === 'card' && o.price <= s.influence); go(i >= 0 ? { type: 'buy', offer: i } : { type: 'leave' }) }
    } else if (st === 'crisis') go({ type: 'face' })
    else {
      let best = [0], v = -1
      for (let m = 1; m < 256; m++) {
        const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => m & (1 << i))
        if (idx.length > 5) continue
        const r = evaluatePlay(s, idx)
        if (r.score > v) { v = r.score; best = idx }
      }
      go({ type: 'play', cards: best })
    }
  }
  return { s, actions }
}

beforeEach(() => store.clear())

describe('Ascension run saves', () => {
  it('save and load mid-run: the exact state comes back', () => {
    const { s, actions } = play('mid-run', (x) => x.plays >= 5)
    expect(saveRun(setup('mid-run'), actions)).toBe(true)
    const { run, rejected } = loadRun()
    expect(rejected).toBeNull()
    expect(run!.state).toEqual(s)
    expect(run!.actions).toEqual(actions)
  })

  it('save and load when the crisis must be faced (no hands left), at the Council, with civilizations, cards and legendaries', () => {
    const atCrisis = play('crisis-ready', (x) => runStatus(x) === 'crisis')
    expect(runStatus(atCrisis.s)).toBe('crisis')
    saveRun(setup('crisis-ready'), atCrisis.actions)
    expect(loadRun().run!.state).toEqual(atCrisis.s)

    const rich = play('rich-world', (x) => x.legendaries.length > 0 && x.civilizations.length > 0 && x.era >= 2 && runStatus(x) === 'playing')
    expect(rich.s.legendaries.length).toBeGreaterThan(0)
    expect(rich.s.civilizations.length).toBeGreaterThan(0)
    saveRun(setup('rich-world'), rich.actions)
    const back = loadRun().run!.state
    expect(back).toEqual(rich.s)
    const council = play('council-save', (x) => runStatus(x) === 'council')
    saveRun(setup('council-save'), council.actions)
    expect(loadRun().run!.state.council).toEqual(council.s.council)
  })

  it('finished runs (won or lost) load as finished', () => {
    for (const seed of ['end-a', 'end-b', 'end-c']) {
      const { s, actions } = play(seed)
      expect(['won', 'lost']).toContain(s.phase)
      saveRun(setup(seed), actions)
      expect(loadRun().run!.state.phase).toBe(s.phase)
    }
    // a failed run: face every crisis at once
    const lost: AscensionAction[] = []
    let s = newRun(setup('fail-fast'))
    while (s.phase !== 'lost') { const a: AscensionAction = runStatus(s) === 'council' ? { type: 'leave' } : { type: 'face' }; lost.push(a); s = applyAction(s, a) }
    saveRun(setup('fail-fast'), lost)
    expect(loadRun().run!.state).toEqual(s)
  })

  it('refuses malformed saves, keeps them as legacy, and names the reason', () => {
    const bad: [string, RegExp][] = [
      ['not json', /not valid JSON/],
      ['[]', /not an object/],
      ['{"kind":"something-else"}', /not a Worldhand Ascension run/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 99, rules: ASCENSION_RULES_VERSION, content: 1, setup: setup(), actions: [] }), /unsupported run save layout/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 1, rules: 9, content: 1, setup: setup(), actions: [] }), /rules 9/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 1, rules: ASCENSION_RULES_VERSION, content: 1, setup: setup(), actions: [{ type: 'cheat' }] }), /unknown action/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 1, rules: ASCENSION_RULES_VERSION, content: 1, setup: setup(), actions: [{ type: 'leave' }] }), /does not replay/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 1, rules: ASCENSION_RULES_VERSION, content: 1, setup: { ...setup(), omen: 99 }, actions: [] }), /does not replay.*omen/],
      [JSON.stringify({ kind: 'worldhand-ascension-run', schema: 1, rules: ASCENSION_RULES_VERSION, content: 1, setup: { ...setup(), pool: { ...FULL_POOL, cards: ['hacked'] } }, actions: [] }), /unknown card/],
    ]
    for (const [raw, why] of bad) {
      store.clear()
      expect(readRun(raw)).toMatchObject({ ok: false })
      store.setItem(RUN_KEY, raw)
      const { run, rejected } = loadRun()
      expect(run).toBeNull()
      expect(rejected!.reason).toMatch(why)
      expect(rejected!.legacyKey).toMatch(new RegExp(`^${LEGACY_PREFIX}`))
      expect(store.getItem(rejected!.legacyKey!)).toBe(raw) // preserved verbatim
      expect(store.getItem(RUN_KEY)).toBeNull()
    }
  })

  it('an old-rules save is preserved, never erased, and stays preserved once', () => {
    const raw = encodeRun(setup(), []).replace(`"rules":${ASCENSION_RULES_VERSION}`, '"rules":9')
    store.setItem(RUN_KEY, raw)
    const first = loadRun()
    store.setItem(RUN_KEY, raw)
    const second = loadRun()
    expect(second.rejected!.legacyKey).toBe(first.rejected!.legacyKey)
    expect(legacyKeys()).toHaveLength(1)
  })

  it('lives in its own namespace: Classic saves are untouched and Classic legacy keys are never matched', () => {
    saveGame(newGame('classic-world'))
    const classic = store.getItem('worldhand.save')
    const { actions } = play('namespaced', (x) => x.plays >= 3)
    saveRun(setup('namespaced'), actions)
    clearRun()
    expect(store.getItem('worldhand.save')).toBe(classic)
    expect(RUN_KEY.startsWith('worldhand.save')).toBe(false)
    expect(PROFILE_KEY.startsWith('worldhand.save')).toBe(false)
    expect(LEGACY_PREFIX.startsWith('worldhand.save')).toBe(false)
  })
})

describe('Ascension profile', () => {
  it('a new profile unlocks only the starter content', () => {
    const p = newProfile()
    expect(p.schema).toBe(PROFILE_SCHEMA)
    expect(poolOf(p).cards.length).toBeLessThan(FULL_POOL.cards.length)
    expect(p.maxOmen).toBe(0)
    expect(p.unlocked.origins).toEqual(['pangaea'])
  })

  it('every non-starter card, decree, legendary, people and origin is earned by some achievement', () => {
    const p = newProfile()
    const unlockable = {
      cards: FULL_POOL.cards.filter((c) => !p.unlocked.cards.includes(c)),
      decrees: FULL_POOL.decrees.filter((c) => !p.unlocked.decrees.includes(c)),
      legendaries: FULL_POOL.legendaries.filter((c) => !p.unlocked.legendaries.includes(c)),
      archetypes: FULL_POOL.archetypes.filter((c) => !p.unlocked.archetypes.includes(c)),
      origins: ['archipelago', 'highlands', 'verdant', 'frontier'],
    }
    for (const [k, ids] of Object.entries(unlockable)) {
      for (const id of ids) expect(ACHIEVEMENTS.some((a) => (a.unlocks[k as keyof typeof a.unlocks] as string[] | undefined)?.includes(id)), `${k} ${id}`).toBe(true)
    }
  })

  it('learning from a run earns achievements and unlocks; recording a win opens the next Omen', () => {
    const { s, actions } = play('learner')
    const { profile, earned } = learn(newProfile(), s)
    expect(earned.map((a) => a.id)).toContain('first-history')
    expect(profile.unlocked.cards).toContain('lighthouse')
    expect(learn(profile, s).earned).toEqual([]) // once only
    const rec = recordRun(profile, s, '2026-09-24T00:00:00.000Z', actions)
    expect(rec.stats.runs).toBe(1)
    expect(rec.history[0]).toMatchObject({ seedText: 'learner', result: s.phase })
    if (s.phase === 'won') expect(rec.maxOmen).toBe(1)
    const won = { ...s, phase: 'won' as const, setup: { ...s.setup, omen: MAX_OMEN } }
    expect(recordRun(newProfile(), won, 'x', []).maxOmen).toBe(MAX_OMEN)
    // history is capped
    let p = newProfile()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) p = recordRun(p, s, `t${i}`, [])
    expect(p.history).toHaveLength(HISTORY_LIMIT)
  })

  it('loading normalizes: unknown ids dropped, starter content restored, numbers clamped; newer schemas refused', () => {
    const raw = { ...newProfile(), unlocked: { cards: ['lighthouse', 'retired-card', 42], decrees: [], legendaries: ['starseed', 'nope'], archetypes: ['mystics'], origins: ['mars', 'verdant'] }, maxOmen: 99, stats: { runs: -3, wins: 'x' } }
    const res = loadProfile(JSON.parse(JSON.stringify(raw)))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.profile.unlocked.cards).toContain('lighthouse')
    expect(res.profile.unlocked.cards).not.toContain('retired-card')
    expect(res.profile.unlocked.cards).toEqual(expect.arrayContaining(newProfile().unlocked.cards))
    expect(res.profile.unlocked.legendaries).toContain('starseed')
    expect(res.profile.unlocked.origins).toEqual(['pangaea', 'verdant'])
    expect(res.profile.maxOmen).toBe(MAX_OMEN)
    expect(res.profile.stats.runs).toBe(0)
    expect(loadProfile({ ...newProfile(), schema: PROFILE_SCHEMA + 1 })).toMatchObject({ ok: false })
    expect(loadProfile({ kind: 'other' })).toMatchObject({ ok: false })
    expect(loadProfile(null)).toMatchObject({ ok: false })
  })

  it('an unreadable stored profile is preserved and replaced by a fresh one', () => {
    store.setItem(PROFILE_KEY, '{"kind":"worldhand-ascension-profile","schema":999}')
    const { profile, notice } = loadStoredProfile()
    expect(profile).toEqual(newProfile())
    expect(notice).toMatch(/newer version/)
    expect(legacyKeys()).toHaveLength(1)
    const p = { ...newProfile(), maxOmen: 3 }
    saveProfile(p)
    expect(loadStoredProfile().profile.maxOmen).toBe(3)
  })
})

describe('Ascension backups', () => {
  it('export → import on another device restores the profile and the run; a bad part changes nothing', () => {
    const { s, actions } = play('backup', (x) => x.plays >= 6)
    saveRun(setup('backup'), actions)
    saveProfile({ ...newProfile(), maxOmen: 2 })
    const file = exportBackup()
    store.clear()
    const res = importBackup(file)
    expect(res.ok).toBe(true)
    expect(loadRun().run!.state).toEqual(s)
    expect(loadStoredProfile().profile.maxOmen).toBe(2)
    // a backup whose run does not replay is refused whole
    const broken = JSON.parse(file)
    broken.run.actions = [{ type: 'leave' }]
    broken.profile.maxOmen = 7
    expect(importBackup(JSON.stringify(broken)).ok).toBe(false)
    expect(loadStoredProfile().profile.maxOmen).toBe(2)
    expect(loadRun().run!.state).toEqual(s)
    expect(importBackup('garbage').ok).toBe(false)
    expect(importBackup('{"kind":"x"}').ok).toBe(false)
  })
})
