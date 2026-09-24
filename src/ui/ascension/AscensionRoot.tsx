// Ascension: the hub (new run, continue, encyclopedia, history, settings) and
// the run itself. Owns persistence: every committed action is autosaved (the
// save is the setup plus the action list), and the profile learns from every
// state. The engine decides everything; this file only routes.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyAction, newRun, replay, runStatus } from '../../engine/ascension/ascension'
import { ERAS } from '../../engine/ascension/eras'
import { CRISES } from '../../engine/ascension/crises'
import { OMENS, MAX_OMEN } from '../../engine/ascension/rules'
import { ORIGINS, ORIGIN_ORDER, REGION_NAMES, generateRegions, type OriginId } from '../../engine/ascension/world'
import { hashSeed } from '../../engine/rng'
import { learn, poolOf, recordRun, type Achievement, type Profile } from '../../engine/ascension/profile'
import type { AscensionAction, AscensionState, RunSetup } from '../../engine/ascension/state'
import RunScreen from './RunScreen'
import Council, { CrisisResult } from './Council'
import Summary, { ChronicleView } from './Summary'
import Collection from './Collection'
import { Factors, Panel, fmt } from './parts'
import {
  loadRun, saveRun, clearRun, loadStoredProfile, saveProfile, loadSettings, saveSettings, exportBackup, importBackup, legacyKeys,
  type LoadedRun, type Settings,
} from './storage'
import { MAX_RESOLVE } from '../../engine/ascension/state'
import './ascension.css'

const Globe = lazy(() => import('./Globe'))
const HUB_WORLD = generateRegions(hashSeed('worldhand'))

type Screen = 'hub' | 'setup' | 'run' | 'collection' | 'history' | 'help' | 'settings'
interface Run { setup: RunSetup; actions: AscensionAction[]; state: AscensionState }

/** A seed phrase for a new world (UI only: the engine never reads the clock). */
const freshSeed = () => {
  const a = ['amber', 'ashen', 'blue', 'bright', 'deep', 'first', 'golden', 'hollow', 'iron', 'last', 'quiet', 'red', 'silver', 'wild']
  const b = ['crown', 'dawn', 'ember', 'harbor', 'hearth', 'meadow', 'moon', 'river', 'root', 'spire', 'star', 'tide', 'vale', 'world']
  const n = Math.floor(Math.random() * a.length * b.length * 100)
  return `${a[n % a.length]}-${b[Math.floor(n / a.length) % b.length]}-${n % 97}`
}

export function HowToPlay() {
  return (
    <ol className="help-list" data-testid="asc-howto">
      <li><b>Play poker hands.</b> Each era gives a fixed number of <b>hands</b> and <b>discards</b>. Select 1–5 of your 8 cards. Only the cards that make the hand <b>score</b> (a Pair’s two cards, a Flush’s five): chips × mult = the score.</li>
      <li><b>Grow the world.</b> Every scoring card grows its suit’s stat: ♥ Vitality, ♦ Prosperity, ♣ Industry, ♠ Knowledge. Land that favours a stat adds chips to cards of that suit.</li>
      <li><b>Peoples rise.</b> When a stat reaches a people’s threshold and there is free land of its kind, a civilization appears. It adds a gift to your plays, grows into a Kingdom and an Empire in later ages, and becomes an ally or a rival of its neighbours.</li>
      <li><b>Face the crisis.</b> Every era ends in a crisis you can see from the start. Its forecast is exact: pressure (the crisis, the land, <i>strain</i> from one stat outrunning another) against resilience (the stats it tests, sheltering land, civilizations, and <b>Reserves</b> — this era’s score). Face it whenever you are ready; unspent hands become <b>Influence</b>. When the hands run out, you must face it.</li>
      <li><b>Endure or scar.</b> Endure it and you move on. Fail it and you lose one of three <b>Resolve</b> and the crisis leaves a scar (lost stats, a fallen people, drowned land). At 0 Resolve the world falls. The final crisis must be endured to ascend.</li>
      <li><b>The Council.</b> Between eras spend Influence on world cards (they join your deck), decrees (reshape the land, raise a people, move stats), rerolls and removing cards. After the Tribal, Medieval and Information crises a <b>legendary</b> is yours to choose: each one changes a rule.</li>
      <li><b>No move fixes everything.</b> Hands are few. A strong poker hand builds Reserves; the right suits build the stats a crisis tests; the right land and peoples compound. Plan for the crises ahead as well as this one — and decide which weakness you can afford.</li>
    </ol>
  )
}

export default function AscensionRoot({ onExit }: { onExit: () => void }) {
  const boot = useMemo(() => ({ ...loadStoredProfile(), saved: loadRun(), settings: loadSettings() }), [])
  const [profile, setProfile] = useState<Profile>(boot.profile)
  const [run, setRun] = useState<Run | null>(boot.saved.run)
  const [screen, setScreen] = useState<Screen>(boot.saved.run && boot.saved.run.state.phase !== 'won' && boot.saved.run.state.phase !== 'lost' ? 'run' : 'hub')
  const [settings, setSettings] = useState<Settings>(boot.settings)
  const [notice, setNotice] = useState<string | null>(boot.notice ?? (boot.saved.rejected ? `Your saved run could not be resumed: ${boot.saved.rejected.reason}.${boot.saved.rejected.legacyKey ? ` It was kept under ${boot.saved.rejected.legacyKey}.` : ''}` : null))
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [moment, setMoment] = useState<AscensionState | null>(null)
  const [dawn, setDawn] = useState<number | null>(null)
  const [chronicleOpen, setChronicleOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [earnedThisRun, setEarnedThisRun] = useState<Achievement[]>([])
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<AscensionState | null>(null)
  const [seedText, setSeedText] = useState('')
  const [origin, setOrigin] = useState<OriginId>('pangaea')
  const [omen, setOmen] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)
  const latest = useRef(run)
  latest.current = run
  const profileRef = useRef(profile)
  profileRef.current = profile
  const toastId = useRef(0)

  const toast = useCallback((text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
  }, [])

  const learnFrom = useCallback((s: AscensionState, actions: AscensionAction[], finished: boolean) => {
    const { profile: q, earned } = learn(profileRef.current, s)
    const r = finished ? recordRun(q, s, new Date().toISOString(), actions) : q
    saveProfile(r)
    profileRef.current = r
    setProfile(r)
    if (earned.length) {
      setEarnedThisRun((e) => [...e, ...earned])
      for (const a of earned) toast(`Achievement: ${a.name} — new content unlocked for your next runs.`)
    }
    return r
  }, [toast])

  /** Commit an action: engine transition, autosave, profile. Returns an error message or null. */
  const act = useCallback((a: AscensionAction): string | null => {
    const r = latest.current
    if (!r) return 'no run in progress'
    let next: AscensionState
    try { next = applyAction(r.state, a) } catch (e) { return e instanceof Error ? e.message : String(e) }
    const actions = [...r.actions, a]
    const nr = { setup: r.setup, actions, state: next }
    latest.current = nr
    setRun(nr)
    if (!saveRun(r.setup, actions)) toast('Could not save to this browser (storage is unavailable). Export a backup to keep your run.')
    const finished = next.phase === 'won' || next.phase === 'lost'
    learnFrom(next, actions, finished)
    for (const c of next.civilizations) if (!r.state.civilizations.some((x) => x.id === c.id)) toast(`A people rises: ${c.name} in ${REGION_NAMES[c.home]}.`)
    for (const c of next.fallen) if (!r.state.fallen.some((x) => x.id === c.id) && a.type !== 'face') toast(`${c.name} has fallen.`)
    if (a.type === 'face') setMoment(next)
    if (a.type === 'leave') setDawn(next.era)
    return null
  }, [learnFrom, toast])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setChronicleOpen(false); setHelpOpen(false) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  useEffect(() => { if (dawn === null) return; const t = setTimeout(() => setDawn(null), 2500); return () => clearTimeout(t) }, [dawn])

  const begin = (setup: RunSetup) => {
    const state = newRun(setup)
    const r = { setup, actions: [], state }
    latest.current = r
    setRun(r)
    saveRun(setup, [])
    setEarnedThisRun([])
    setMoment(null)
    setScreen('run')
    setDawn(0)
    learnFrom(state, [], false)
  }
  const startNew = () => {
    const allowedOmen = Math.min(omen, profile.maxOmen)
    begin({ seedText: seedText.trim() || freshSeed(), omen: allowedOmen, origin: profile.unlocked.origins.includes(origin) ? origin : 'pangaea', pool: poolOf(profile) })
  }
  const setSetting = (s: Settings) => { setSettings(s); saveSettings(s) }
  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `worldhand-ascension-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Backup exported.')
  }
  const doImport = async (file: File | undefined) => {
    if (!file) return
    const res = importBackup(await file.text())
    setNotice(res.message)
    if (res.profile) setProfile(res.profile)
    if (res.run) { setRun(res.run as LoadedRun); latest.current = res.run }
  }

  const motionClass = settings.motion === 'reduced' ? 'motion-reduced' : settings.motion === 'full' ? 'motion-full' : ''
  const inProgress = run && run.state.phase !== 'won' && run.state.phase !== 'lost'
  const s = run?.state

  // ---- the run --------------------------------------------------------------
  let body: React.ReactNode
  if (screen === 'run' && run && s) {
    if (s.phase === 'won' || s.phase === 'lost') {
      body = (
        <Summary
          state={s} earned={earnedThisRun} copied={copied}
          onPlayAgain={() => begin({ ...run.setup, pool: poolOf(profile) })}
          onNewSeed={() => { setSeedText(''); setScreen('setup') }}
          onMenu={() => setScreen('hub')}
          onCopySeed={() => { void navigator.clipboard?.writeText(run.setup.seedText).then(() => setCopied(true), () => setCopied(false)); setTimeout(() => setCopied(false), 2000) }}
        />
      )
    } else if (runStatus(s) === 'council') {
      body = <Council state={s} onAct={act} />
    } else {
      body = <RunScreen state={s} onAct={act} settings={settings} onMenu={() => setScreen('hub')} onChronicle={() => setChronicleOpen(true)} onHelp={() => setHelpOpen(true)} />
    }
  } else if (screen === 'collection') {
    body = <Collection profile={profile} onBack={() => setScreen('hub')} />
  } else if (screen === 'history') {
    body = (
      <div className="hub" data-testid="asc-history">
        <div className="hub-head"><h1>Past worlds</h1><span className="sub">the last {profile.history.length}</span><span className="spacer" /><button onClick={() => { setHistory(null); setScreen('hub') }}>Back</button></div>
        {history ? (
          <Panel title={`${history.setup.seedText} — ${history.phase === 'won' ? 'ascended' : 'fell'} in the ${ERAS[history.era].label} age`} right={<button onClick={() => setHistory(null)}>All runs</button>}>
            <ChronicleView state={history} />
          </Panel>
        ) : profile.history.length === 0 ? <p className="muted">No finished runs yet.</p> : (
          <div className="coll-grid">
            {profile.history.map((h, i) => (
              <div className="entry" key={i}>
                <h4>{h.seedText}</h4>
                <span className={h.result === 'won' ? 'good' : 'bad'}>{h.result === 'won' ? 'Ascended' : `Fell in the ${ERAS[Math.min(h.era, 5)].label} age`}</span>
                <span className="muted">{ORIGINS[h.origin].label}{h.omen ? ` · Omen ${h.omen}` : ''} · score {fmt(h.score)} · {h.civilizations} civilizations · {h.endedAt.slice(0, 10)}</span>
                <div className="row">
                  <button onClick={() => { try { setHistory(replay(h.replay.setup, h.replay.actions as AscensionAction[])) } catch { setNotice('That run was played under older rules and cannot be replayed.') } }}>Read its Chronicle</button>
                  <button className="ghost" onClick={() => { setSeedText(h.seedText); setOrigin(h.origin); setOmen(Math.min(h.omen, profile.maxOmen)); setScreen('setup') }}>Play this seed</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  } else if (screen === 'help') {
    body = (
      <div className="hub"><div className="hub-head"><h1>How to play</h1><span className="spacer" /><button onClick={() => setScreen('hub')}>Back</button></div><Panel><HowToPlay /></Panel></div>
    )
  } else if (screen === 'settings') {
    body = (
      <div className="hub" data-testid="asc-settings">
        <div className="hub-head"><h1>Settings</h1><span className="spacer" /><button onClick={() => setScreen('hub')}>Back</button></div>
        <Panel title="Motion">
          <div className="choice-row">
            {(['system', 'reduced', 'full'] as const).map((m) => (
              <button key={m} className="choice" aria-pressed={settings.motion === m} onClick={() => setSetting({ ...settings, motion: m })}>
                <b>{m === 'system' ? 'Follow the system' : m === 'reduced' ? 'Reduced' : 'Full'}</b>
                <small>{m === 'system' ? 'Use your device’s reduced-motion setting.' : m === 'reduced' ? 'No animations; the globe stops turning.' : 'All animations, even if the device asks for less.'}</small>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Guidance">
          <button className="choice" aria-pressed={settings.tips} onClick={() => setSetting({ ...settings, tips: !settings.tips })}><b>Show tips in the first era</b><small>{settings.tips ? 'On' : 'Off'}</small></button>
        </Panel>
        <Panel title="Your data">
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>Ascension saves in this browser only (your profile and the run in progress). Export a backup to move it to another device; importing checks it first and never damages what is here. Classic saves are separate and untouched.</p>
          <div className="row">
            <button onClick={doExport} data-testid="asc-export">Export backup</button>
            <button onClick={() => importRef.current?.click()} data-testid="asc-import">Import backup</button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden data-testid="asc-import-input" onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          {notice && <div className="notice" role="status" style={{ marginTop: 8 }} data-testid="asc-data-notice">{notice}</div>}
          {legacyKeys().length > 0 && <p className="muted" style={{ fontSize: '0.78rem' }}>{legacyKeys().length} unreadable Ascension save{legacyKeys().length === 1 ? ' is' : 's are'} preserved in this browser’s storage and can be recovered by hand.</p>}
        </Panel>
      </div>
    )
  } else if (screen === 'setup') {
    body = (
      <div className="hub" data-testid="asc-setup">
        <div className="hub-head"><h1>A new world</h1><span className="spacer" /><button onClick={() => setScreen('hub')}>Back</button></div>
        <Panel title="Seed">
          <label htmlFor="asc-seed">Same seed, same world, same cards. Leave empty for a new one.</label>
          <input id="asc-seed" data-testid="asc-seed" value={seedText} placeholder="e.g. first-dawn" maxLength={200} onChange={(e) => setSeedText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startNew()} />
        </Panel>
        <Panel title="Origin">
          <div className="choice-row">
            {ORIGIN_ORDER.map((o) => {
              const open = profile.unlocked.origins.includes(o)
              return <button key={o} className={`choice${open ? '' : ' locked'}`} disabled={!open} aria-pressed={origin === o} onClick={() => setOrigin(o)}><b>{ORIGINS[o].label}</b><small>{open ? ORIGINS[o].text : 'Locked — see the Encyclopedia'}</small></button>
            })}
          </div>
        </Panel>
        <Panel title="Omen (difficulty)">
          <div className="choice-row">
            <button className="choice" aria-pressed={omen === 0} onClick={() => setOmen(0)}><b>No Omen</b><small>The standard world.</small></button>
            {OMENS.map((o) => {
              const open = o.level <= profile.maxOmen
              return <button key={o.level} className={`choice${open ? '' : ' locked'}`} disabled={!open} aria-pressed={omen === o.level} onClick={() => setOmen(o.level)}><b>Omen {o.level}: {o.name}</b><small>{open ? `${o.text}${o.level > 1 ? ' Plus every Omen below.' : ''}` : `Ascend at Omen ${o.level - 1} to unlock.`}</small></button>
            })}
          </div>
          {profile.maxOmen === 0 && <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>Ascend once to unlock the first Omen. There are {MAX_OMEN}.</p>}
        </Panel>
        <div className="row"><button className="gold-btn" data-testid="asc-begin" onClick={startNew}>Begin</button></div>
      </div>
    )
  } else {
    body = (
      <div className="hub" data-testid="asc-hub">
        <div className="hub-head"><h1>Worldhand</h1><span className="sub">Ascension</span><span className="spacer" /><button className="ghost" onClick={onExit} data-testid="asc-exit">← All modes</button></div>
        {notice && <div className="notice" role="status">{notice} <button className="ghost" onClick={() => setNotice(null)}>Dismiss</button></div>}
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>Play poker hands to grow a world through six ages. Every scoring card shapes a stat; peoples rise on the land that suits them; every age ends in a crisis that tests what you built. You cannot fix every weakness — choose which ones you can survive.</p>
        <div className="hub-grid">
          <div className="hub-actions">
            {inProgress && s && (
              <button className="gold-btn" data-testid="asc-continue" onClick={() => setScreen('run')}>
                Continue: “{run!.setup.seedText}”
                <small>{runStatus(s) === 'council' ? 'At the Council' : `${ERAS[s.era].label} age, ${s.handsLeft} hands left`} · Resolve {s.resolve}/{MAX_RESOLVE} · score {fmt(s.score)} · next: {CRISES[s.crisisTrack[s.era]].label}</small>
              </button>
            )}
            {run && !inProgress && (
              <button onClick={() => setScreen('run')} data-testid="asc-last-summary">Last run: “{run.setup.seedText}” — {run.state.phase === 'won' ? 'ascended' : 'fell'}<small>See its summary</small></button>
            )}
            <button className="primary" data-testid="asc-new" onClick={() => { setSeedText(''); setScreen('setup') }}>New world<small>{inProgress ? 'Your current run stays saved until you begin a new one.' : 'Choose a seed, an origin and an Omen.'}</small></button>
            <button onClick={() => setScreen('collection')} data-testid="asc-open-collection">Encyclopedia<small>Cards, legendaries, peoples, crises and achievements</small></button>
            <button onClick={() => setScreen('history')} data-testid="asc-open-history">Past worlds<small>{profile.history.length ? `Read the chronicles of your last ${profile.history.length} runs` : 'Nothing yet'}</small></button>
            <button onClick={() => setScreen('help')}>How to play<small>The rules in one page</small></button>
            <button onClick={() => setScreen('settings')} data-testid="asc-open-settings">Settings and backups<small>Motion, tips, export and import</small></button>
          </div>
          <div className="col">
          <div className="hub-world" aria-hidden="true">
            <Suspense fallback={null}>
              <Globe regions={HUB_WORLD} civs={[]} relations={[]} focus={null} onFocus={() => {}} hit={[]} help={[]} development={{ vitality: 20, prosperity: 20, industry: 20, knowledge: 20 }} crisisFailing={false} reduced={settings.motion === 'reduced'} />
            </Suspense>
            <span className="caption">Twelve regions. Six ages. One world at a time.</span>
          </div>
          <Panel title="Your progress" testid="asc-progress">
            <div className="hub-stats">
              <div className="hub-stat"><b>{profile.stats.runs}</b><span>worlds finished</span></div>
              <div className="hub-stat"><b>{profile.stats.wins}</b><span>ascended</span></div>
              <div className="hub-stat"><b>{fmt(profile.stats.bestScore)}</b><span>best score</span></div>
              <div className="hub-stat"><b>{profile.maxOmen}</b><span>highest Omen unlocked</span></div>
              <div className="hub-stat"><b>{profile.achievements.length}</b><span>achievements</span></div>
              <div className="hub-stat"><b>{profile.unlocked.cards.length + profile.unlocked.decrees.length + profile.unlocked.legendaries.length}</b><span>cards, decrees and legendaries unlocked</span></div>
            </div>
          </Panel>
          </div>
        </div>
        {run && inProgress && confirmReset(run)}
      </div>
    )
  }

  function confirmReset(r: Run) {
    return <p className="muted" style={{ fontSize: '0.78rem', margin: 0 }}>Beginning a new world replaces the run in progress (“{r.setup.seedText}”). <button className="ghost" onClick={() => { clearRun(); setRun(null) }}>Abandon it now</button></p>
  }

  return (
    <div className={`asc ${motionClass}`}>
      {body}
      {moment && screen === 'run' && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="asc-moment-title" data-testid="asc-moment">
          <div className="modal">
            <h2 id="asc-moment-title">{CRISES[moment.crises[moment.crises.length - 1].crisis].label}</h2>
            <CrisisResult state={moment} />
            <Factors ev={moment.crises[moment.crises.length - 1]} />
            <button className="gold-btn" autoFocus data-testid="asc-moment-continue" onClick={() => setMoment(null)}>
              {moment.phase === 'won' ? 'See your world ascend' : moment.phase === 'lost' ? 'See what became of the world' : 'To the Council'}
            </button>
          </div>
        </div>
      )}
      {dawn !== null && screen === 'run' && s && runStatus(s) === 'playing' && (
        <div className="era-dawn" aria-hidden="true"><div><div className="eyebrow">Era {dawn + 1} of {ERAS.length}</div><h2>The {ERAS[dawn].label} Age</h2><p>{ERAS[dawn].ruleName}: {ERAS[dawn].ruleText}</p></div></div>
      )}
      {chronicleOpen && s && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Chronicle" onClick={(e) => { if (e.target === e.currentTarget) setChronicleOpen(false) }}>
          <div className="modal"><div className="row"><h2>The Chronicle</h2><span className="spacer" /><button autoFocus onClick={() => setChronicleOpen(false)}>Close</button></div><ChronicleView state={s} /></div>
        </div>
      )}
      {helpOpen && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false) }}>
          <div className="modal"><div className="row"><h2>How to play</h2><span className="spacer" /><button autoFocus onClick={() => setHelpOpen(false)}>Close</button></div><HowToPlay /></div>
        </div>
      )}
      <div className="toast-stack" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
      {s && screen === 'run' && s.phase !== 'won' && s.phase !== 'lost' && <span className="sr-only" aria-live="polite">{`${ERAS[s.era].label} age. ${s.handsLeft} hands left. Resolve ${s.resolve}.`}</span>}
    </div>
  )
}
