// The end of a run: what happened, why, and what the world became. Also the
// Chronicle view (used during a run, at the end, and for past runs).
import { Suspense, lazy, useMemo, useState } from 'react'
import { chronicleByEra, isMajor, describe } from '../../engine/ascension/chronicle'
import { ERAS } from '../../engine/ascension/eras'
import { CRISES } from '../../engine/ascension/crises'
import { ARCHETYPES, TIER_LABEL, relations } from '../../engine/ascension/civilizations'
import { LEGENDARIES } from '../../engine/ascension/legendaries'
import { ORIGINS, REGION_NAMES, TERRAIN, landAffinity } from '../../engine/ascension/world'
import { OMENS } from '../../engine/ascension/rules'
import { CARD_BY_ID } from '../../engine/ascension/content'
import { ownedCards } from '../../engine/ascension/ascension'
import type { Achievement } from '../../engine/ascension/profile'
import type { AscensionState } from '../../engine/ascension/state'
import { Panel, StatBars, fmt, signed } from './parts'

const Globe = lazy(() => import('./Globe'))

export function ChronicleView({ state, majorOnly: initial = false }: { state: AscensionState; majorOnly?: boolean }) {
  const [majorOnly, setMajorOnly] = useState(initial)
  const groups = useMemo(() => chronicleByEra(state.chronicle, state.seed), [state.chronicle, state.seed])
  return (
    <div className="chron" data-testid="asc-chronicle">
      <label className="row" style={{ fontSize: '0.84rem', color: 'var(--muted)', marginBottom: 0 }}>
        <input type="checkbox" checked={majorOnly} onChange={(e) => setMajorOnly(e.target.checked)} style={{ width: 'auto', margin: 0 }} /> Important events only
      </label>
      {groups.map((g, i) => {
        const lines = g.lines.filter((l) => !majorOnly || l.major)
        if (!lines.length) return null
        return (
          <section className="chron-era" key={i}>
            <h3>The {ERAS[Math.min(g.era, ERAS.length - 1)].label} age</h3>
            <ol>{lines.map((l, j) => <li key={j} className={l.major ? 'major' : 'minor'}>{l.text}</li>)}</ol>
          </section>
        )
      })}
    </div>
  )
}

export default function Summary({ state, earned, onPlayAgain, onNewSeed, onMenu, onCopySeed, copied }: {
  state: AscensionState
  earned: Achievement[]
  onPlayAgain: () => void
  onNewSeed: () => void
  onMenu: () => void
  onCopySeed: () => void
  copied: boolean
}) {
  const won = state.phase === 'won'
  const last = state.crises[state.crises.length - 1]
  const lastEvent = state.chronicle[state.chronicle.length - 1]
  const reason = lastEvent?.t === 'end' ? lastEvent.reason : ''
  const rel = relations(state.civilizations, state.regions)
  const moments = state.chronicle.map((e, i) => ({ e, i })).filter(({ e }) => isMajor(e) && e.t !== 'genesis').slice(-8)
  const civHistory = (id: number) => state.chronicle.map((e, i) => ({ e, i })).filter(({ e }) => (e.t === 'civ' || e.t === 'tier' || e.t === 'fall') && e.civ === id).map(({ e, i }) => describe(e, state.seed, i))
  const worldCards = ownedCards(state).filter((c) => c.kind)
  const title = won ? 'The World Ascends' : state.era === ERAS.length - 1 && last?.result === 'failed' ? 'The World Did Not Ascend' : 'The World Falls'
  return (
    <div className="summary" data-testid="asc-summary" data-result={state.phase}>
      <section className={`summary-hero ${won ? 'won' : 'lost'}`}>
        <div className="eyebrow">{ORIGINS[state.setup.origin].label} · {state.setup.omen ? `Omen ${state.setup.omen}` : 'no Omen'} · seed “{state.setup.seedText}”</div>
        <h1 data-testid="asc-summary-title">{title}</h1>
        <p>{won ? `After ${state.plays} hands across ${ERAS.length} ages, it passed the final test.` : reason}</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="primary" data-testid="asc-play-again" onClick={onPlayAgain}>Play this seed again</button>
          <button className="gold-btn" data-testid="asc-new-seed" onClick={onNewSeed}>New world</button>
          <button onClick={onCopySeed} data-testid="asc-copy-seed">{copied ? 'Seed copied' : 'Copy seed'}</button>
          <button onClick={onMenu} data-testid="asc-to-menu">Main menu</button>
        </div>
      </section>
      {earned.length > 0 && (
        <div className="notice" data-testid="asc-earned">
          <b>Unlocked for your next runs:</b> {earned.map((a) => a.name).join(', ')}.
        </div>
      )}
      <div className="summary-grid">
        <Panel title="The run">
          <dl className="kv">
            <dt>Result</dt><dd className={won ? 'good' : 'bad'}>{won ? 'Ascended' : 'Lost'}</dd>
            <dt>Ages survived</dt><dd>{state.crises.filter((c) => c.result === 'endured').length} of {ERAS.length} crises endured · reached {ERAS[state.era].label}</dd>
            <dt>Score</dt><dd className="gold">{fmt(state.score)}</dd>
            <dt>Best hand</dt><dd>{state.bestPlay ? `${state.bestPlay.label} for ${fmt(state.bestPlay.score)} (${ERAS[state.bestPlay.era].label})` : '—'}</dd>
            <dt>Resolve left</dt><dd>{state.resolve}</dd>
            <dt>Hands / discards</dt><dd>{state.plays} / {state.discards}</dd>
            <dt>Civilizations</dt><dd>{state.civilizations.length} living, {state.fallen.length} fallen</dd>
            <dt>World cards</dt><dd>{worldCards.length ? [...new Set(worldCards.map((c) => CARD_BY_ID.get(c.kind!)?.name))].join(', ') : 'none'}</dd>
            {state.setup.omen > 0 && <><dt>Omens</dt><dd>{OMENS.filter((o) => o.level <= state.setup.omen).map((o) => o.name).join(', ')}</dd></>}
          </dl>
        </Panel>
        <Panel title="The final world">
          <div className="globe-box" style={{ height: 220 }}>
            <Suspense fallback={<div className="globe-fallback">Loading the globe…</div>}>
              <Globe regions={state.regions} civs={state.civilizations} relations={rel} focus={null} onFocus={() => {}} hit={[]} help={[]} development={state.stats} crisisFailing={!won} />
            </Suspense>
          </div>
          <div style={{ marginTop: 8 }}><StatBars stats={state.stats} affinity={landAffinity(state.regions)} /></div>
          <p className="muted" style={{ fontSize: '0.74rem', margin: '6px 0 0' }}>{state.regions.map((r) => `${REGION_NAMES[r.id]}: ${TERRAIN[r.terrain].label}`).join(' · ')}</p>
        </Panel>
      </div>
      <Panel title="The crises" testid="asc-summary-crises">
        <p className="summary-swipe">Swipe sideways to see each margin and scar →</p>
        <div className="crisis-table-scroll" role="region" aria-label="Crisis outcomes; scroll sideways for margins and scars" tabIndex={0}>
          <table className="crisis-table">
            <thead><tr><th>Age</th><th>Crisis</th><th>Result</th><th>Pressure</th><th>Resilience</th><th>Margin</th><th>Scars</th></tr></thead>
            <tbody>
              {state.crises.map((c) => (
                <tr key={c.era}>
                  <td>{ERAS[c.era].label}</td><td>{CRISES[c.crisis].label}</td>
                  <td className={c.result === 'endured' ? 'good' : 'bad'}>{c.prevented ? 'turned aside' : c.triumph ? 'triumph' : c.result}</td>
                  <td>{c.pressure}</td><td>{c.resilience}</td><td className={c.margin >= 0 ? 'good' : 'bad'}>{signed(c.margin)}</td>
                  <td className="muted">{c.scars.join(' ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!won && last && last.result === 'failed' && (
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            What broke it: {last.pressures.filter((f) => f.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 3).map((f) => `${f.label} ${f.amount}`).join(', ')} — against {last.mitigations.filter((f) => f.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 3).map((f) => `${f.label} ${f.amount}`).join(', ') || 'almost nothing'}.
          </p>
        )}
      </Panel>
      <div className="summary-grid">
        <Panel title="Civilizations and their histories">
          <div className="civs">
            {[...state.civilizations, ...state.fallen].map((c) => (
              <div className="civ" key={`${c.id}-${c.tier}`}>
                <span className="civ-head"><span className="civ-name">{c.name}</span><span className="tier">{c.tier ? TIER_LABEL[c.tier] : 'Fallen'}</span><span className="muted">{ARCHETYPES[c.archetype].label}</span></span>
                <span className="passive">{civHistory(c.id).join(' ')}</span>
              </div>
            ))}
            {state.civilizations.length + state.fallen.length === 0 && <p className="muted">No people ever rose in this world.</p>}
          </div>
        </Panel>
        <Panel title="Legendaries and great moments">
          {state.legendaries.length > 0 && <p style={{ fontSize: '0.84rem', margin: '0 0 8px' }}>{state.legendaries.map((l) => LEGENDARIES[l.id].name).join(', ')}</p>}
          <ol className="help-list">{moments.map(({ e, i }) => <li key={i}>{describe(e, state.seed, i)}</li>)}</ol>
        </Panel>
      </div>
      <Panel title="The Chronicle of this world">
        <ChronicleView state={state} majorOnly />
      </Panel>
    </div>
  )
}
