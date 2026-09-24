// Ascension prototype screen: dev server only (App.tsx gates it behind
// import.meta.env.DEV, so production and portable builds drop it entirely).
// Deliberately plain: a seam for the engine, not a design pass.
// Saves nothing; selection lives here, not in engine state.
import { useMemo, useState } from 'react'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, landAffinity, WORLD_STATS, WORLD_STAT_LABEL, TERRAIN, runStatus,
  type AscensionAction, type AscensionState, type WorldStats,
} from '../engine/ascension/ascension'
import { ARCHETYPES, emergenceThreshold } from '../engine/ascension/civilizations'
import { ERAS, eraRequirements, isComplete, type Era } from '../engine/ascension/eras'
import { CRISES, evaluateCrisis, type Factor } from '../engine/ascension/crises'
import { cardName } from '../engine/poker'

const eraLabel = (id: Era) => ERAS.find((e) => e.id === id)!.label
/** "+2 Vitality · +1 Industry" (non-zero gains, in stat order) */
const gains = (d: WorldStats) =>
  WORLD_STATS.filter((k) => d[k] !== 0).map((k) => `+${d[k]} ${WORLD_STAT_LABEL[k]}`).join(' · ')

/** Factor list component: two sections (pressures and mitigations) with data-testid */
function FactorTable({ pressures, mitigations }: { pressures: Factor[]; mitigations: Factor[] }) {
  return (
    <div className="factor-table">
      <div>
        <h4>Pressures (hurt)</h4>
        <ul>
          {pressures.map((f, i) => (
            <li key={i} data-testid="asc-factor" data-side="pressure" data-amount={f.amount} className={f.amount === 0 ? 'muted' : ''}>
              {f.label} {f.amount > 0 ? '+' : ''}
              {f.amount} ({f.detail})
            </li>
          ))}
        </ul>
        <p><strong>Total pressure: {pressures.reduce((n, f) => n + f.amount, 0)}</strong></p>
      </div>
      <div>
        <h4>Resilience (help)</h4>
        <ul>
          {mitigations.map((f, i) => (
            <li key={i} data-testid="asc-factor" data-side="mitigation" data-amount={f.amount} className={f.amount === 0 ? 'muted' : ''}>
              {f.label} {f.amount > 0 ? '+' : ''}
              {f.amount} ({f.detail})
            </li>
          ))}
        </ul>
        <p><strong>Total resilience: {mitigations.reduce((n, f) => n + f.amount, 0)}</strong></p>
      </div>
    </div>
  )
}

export default function AscensionApp({ onExit }: { onExit: () => void }) {
  const [seedText, setSeedText] = useState('')
  const [game, setGame] = useState<AscensionState | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const affinity = useMemo(() => (game ? landAffinity(game.regions) : null), [game])
  const reqs = game ? eraRequirements(game.era, game.stats, game.civilizations) : []
  const status = game ? runStatus(game) : null
  const preview = useMemo(() => {
    if (!game || selected.length === 0 || isComplete(game.era) || status !== 'playing') return null
    try { return evaluatePlay(game, selected) } catch { return null }
  }, [game, selected, status])
  const crisisEval = useMemo(() => {
    if (!game || isComplete(game.era)) return null
    try { return evaluateCrisis(game.era, game) } catch { return null }
  }, [game])

  const act = (a: AscensionAction) => {
    if (!game) return
    try {
      setGame(applyAscensionAction(game, a))
      setSelected([])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggle = (i: number) => {
    if (selected.includes(i)) setSelected(selected.filter((x) => x !== i))
    else if (selected.length >= 5) setError('select at most 5 cards')
    else { setSelected([...selected, i]); setError('') }
  }

  return (
    <main className="shell intro" data-testid="ascension-app">
      <header className="intro-head">
        <h1 className="game-title">Ascension prototype</h1>
        <p className="muted">Development build only. Seeded world and deal; played suits grow four world stats, the land pays a bonus for the stats its terrain favours, civilizations emerge at round ends and add passive bonuses, the world advances through three eras (Tribal, Ancient, Medieval) by meeting requirements at round ends, and each era ends in a crisis that tests the world before advancing. Nothing is saved.</p>
        <button data-testid="asc-exit" onClick={onExit}>Back to Classic</button>
      </header>

      {!game ? (
        <div className="card panel">
          <label htmlFor="asc-seed">Seed phrase</label>
          <input id="asc-seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder="random if empty" />
          <button className="primary" data-testid="asc-start" onClick={() => {
            setGame(newAscensionGame(seedText.trim() || `ascension-${Date.now()}`))
            setSelected([])
            setError('')
          }}>Start</button>
        </div>
      ) : (
        <div className="card panel">
          <p data-testid="asc-status">
            Seed {game.seedText} · Round {game.round} · Plays {game.playsLeft} · Discards {game.discardsLeft} · Score <strong data-testid="asc-score">{game.score}</strong>
          </p>
          <p data-testid="asc-stats">
            {WORLD_STATS.map((k, i) => (
              <span key={k} data-stat={k} data-value={game.stats[k]}>{i > 0 ? ' · ' : ''}{WORLD_STAT_LABEL[k]} {game.stats[k]}</span>
            ))}
          </p>
          <div data-testid="asc-era" data-era={ERAS[game.era]?.id ?? 'complete'}>
            {status === 'failed' ? (
              <div data-testid="asc-failed">
                <h2>Run over</h2>
                <p>{game.crises[game.crises.length - 1].label} was not survived at the end of round {game.crises[game.crises.length - 1].round}: resilience {game.crises[game.crises.length - 1].resilience} vs pressure {game.crises[game.crises.length - 1].pressure}.</p>
                <FactorTable pressures={game.crises[game.crises.length - 1].pressures} mitigations={game.crises[game.crises.length - 1].mitigations} />
                <p>The world is kept below for inspection.</p>
              </div>
            ) : status === 'crisis' ? (
              <div data-testid="asc-crisis" data-crisis={crisisEval?.crisis}>
                <h2>Crisis: {crisisEval?.label}</h2>
                <p>{ERAS[game.era].label} requirements met at the end of round {game.crisis?.round}.</p>
                <p>{CRISES[game.era].theme}</p>
                {crisisEval && <FactorTable pressures={crisisEval.pressures} mitigations={crisisEval.mitigations} />}
                {crisisEval && (
                  <p>
                    <strong>
                      resilience {crisisEval.resilience} vs pressure {crisisEval.pressure} →{' '}
                      {crisisEval.result === 'survived' ? `survives by ${crisisEval.resilience - crisisEval.pressure}` : `fails by ${crisisEval.pressure - crisisEval.resilience}`}
                    </strong>
                  </p>
                )}
                <button className="primary" data-testid="asc-resolve" onClick={() => act({ type: 'resolve' })}>Face the crisis</button>
              </div>
            ) : !isComplete(game.era) ? (
              <>
                <p>Era: <strong>{ERAS[game.era].label}</strong> ({game.era + 1} of {ERAS.length}). To advance, at a round end the world needs:</p>
                <ul>
                  {reqs.map((r) => (
                    <li key={r.key} data-testid="asc-req" data-key={r.key} data-met={r.met} data-have={r.have} data-need={r.need}>
                      {r.met ? '✓' : '✗'} {r.label}: {r.have} / {r.need}
                    </li>
                  ))}
                </ul>
                <p data-testid="asc-era-status">
                  {reqs.every((r) => r.met)
                    ? 'All requirements met: the world advances at the end of this round.'
                    : `Not yet: ${reqs.filter((r) => !r.met).map((r) => r.key === 'stats'
                      ? `${r.need - r.have} more stat${r.need - r.have > 1 ? 's' : ''} to ${ERAS[game.era].needs.min} (${WORLD_STATS.filter((k) => game.stats[k] < ERAS[game.era].needs.min).map((k) => `${WORLD_STAT_LABEL[k]} ${game.stats[k]}`).join(', ')})`
                      : `${r.need - r.have} more civilization${r.need - r.have > 1 ? 's' : ''}`).join('; ')}.`}
                </p>
                {crisisEval && (
                  <div data-testid="asc-crisis-forecast">
                    <h3>Coming crisis</h3>
                    <p>{CRISES[game.era].label}: {CRISES[game.era].theme}</p>
                    <p>It strikes at the round end where these requirements are met. If it struck now:</p>
                    <FactorTable pressures={crisisEval.pressures} mitigations={crisisEval.mitigations} />
                    <p>resilience {crisisEval.resilience} vs pressure {crisisEval.pressure} → would {crisisEval.result === 'survived' ? `survive by ${crisisEval.resilience - crisisEval.pressure}` : `fail by ${crisisEval.pressure - crisisEval.resilience}`}</p>
                  </div>
                )}
              </>
            ) : (
              <div data-testid="asc-complete">
                <h2>First playable complete</h2>
                <p>Medieval completed at the end of round {game.eraLog[game.eraLog.length - 1].round} with score {game.score}. The world is kept below for inspection; no further plays.</p>
              </div>
            )}
            {game.crises.length > 0 && (
              <ul data-testid="asc-crisis-log">
                {game.crises.map((c, i) => {
                  const mostHelp = c.mitigations.reduce((best, f) => f.amount > best.amount ? f : best)
                  const mostHurt = c.pressures.slice(1).reduce((worst, f) => f.amount > worst.amount ? f : worst, { label: '', amount: 0, detail: '' })
                  return (
                    <li key={i} data-result={c.result}>
                      End of round {c.round}: {c.label} — {c.result} (resilience {c.resilience} vs pressure {c.pressure}){mostHelp.amount > 0 ? ` · helped most: ${mostHelp.label}` : ''}{mostHurt.amount > 0 ? ` · hurt most: ${mostHurt.label}` : ''}
                    </li>
                  )
                })}
              </ul>
            )}
            {game.eraLog.length > 0 && (
              <ul data-testid="asc-era-log">
                {game.eraLog.map((e) => (
                  <li key={e.from}>
                    End of round {e.round}: {e.to ? `${eraLabel(e.from)} → ${eraLabel(e.to)}` : `${eraLabel(e.from)} completed`} with {e.civilizations} civilization{e.civilizations > 1 ? 's' : ''} and {WORLD_STATS.map((k) => `${WORLD_STAT_LABEL[k]} ${e.stats[k]}`).join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <details open data-testid="asc-world">
            <summary data-testid="asc-affinity">
              Land bonus per stat point: {WORLD_STATS.map((k) => `${WORLD_STAT_LABEL[k]} +${affinity![k]}`).join(' · ')}
            </summary>
            <ul>
              {game.regions.map((r) => (
                <li key={r.id} data-region={r.id} data-terrain={r.terrain}>
                  R{r.id} {TERRAIN[r.terrain].label} (favours {WORLD_STAT_LABEL[TERRAIN[r.terrain].stat]}) — borders {r.neighbors.map((n) => `R${n}`).join(', ')}
                  {game.civilizations.filter((c) => c.home === r.id).map((c) => ` — home of ${ARCHETYPES[c.archetype].label}`)}
                </li>
              ))}
            </ul>
          </details>
          <div data-testid="asc-civs">
            <p>
              Civilizations — next emerges at a round end once one reaches{' '}
              <span data-testid="asc-civ-next">{emergenceThreshold(game.civilizations.length)}</span> in its stat and has a free home on its terrain.
            </p>
            {game.civilizations.length === 0 ? <p className="muted">None yet.</p> : (
              <ul>
                {game.civilizations.map((c) => (
                  <li key={c.id} data-archetype={c.archetype} data-home={c.home}>
                    {ARCHETYPES[c.archetype].label} — home R{c.home} {TERRAIN[c.reason.terrain].label} — round {c.emergedRound}:{' '}
                    {WORLD_STAT_LABEL[c.reason.stat]} {c.reason.readiness} ≥ {c.reason.needed}, region fit {c.reason.regionFit}
                    <div data-testid="asc-civ-passive" data-archetype={c.archetype}>
                      <strong>{ARCHETYPES[c.archetype].passive.name}:</strong> {ARCHETYPES[c.archetype].passive.text}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {status === 'playing' && (
            <>
              <div className="hand-cards" role="listbox" aria-label="Hand">
                {game.hand.map((c, i) => (
                  <button key={i} role="option" aria-selected={selected.includes(i)}
                    className={`pcard-btn ${selected.includes(i) ? 'sel' : ''}`} onClick={() => toggle(i)}>
                    <span className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>
                      <span className="pcard-rank">{cardName(c)}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p data-testid="asc-preview">
                {preview ? `${preview.label}: ${preview.chips} chips × ${preview.mult} mult = ${preview.pokerScore}` : 'Select 1–5 cards.'}
              </p>
              {preview && <p data-testid="asc-preview-stats" data-deltas={JSON.stringify(preview.statDeltas)}>World: {gains(preview.statDeltas)}</p>}
              {preview && preview.civBonuses.length > 0 && (
                <div data-testid="asc-preview-civs">
                  {preview.civBonuses.map((b) => (
                    <p key={b.civ} data-testid="asc-preview-civ" data-archetype={b.archetype} data-amount={b.amount}>
                      {ARCHETYPES[b.archetype].label} ({ARCHETYPES[b.archetype].passive.name}): +{b.amount} — {b.detail}
                    </p>
                  ))}
                </div>
              )}
              {preview && <p data-testid="asc-preview-total" data-land={preview.landBonus} data-civ={preview.civBonus} data-score={preview.score}>Land bonus +{preview.landBonus} · Civilizations +{preview.civBonus} → play adds {preview.score}</p>}
              <div className="row">
                <button className="primary" data-testid="asc-play" disabled={!preview} onClick={() => act({ type: 'play', cards: selected })}>Play</button>
                <button data-testid="asc-discard" disabled={selected.length === 0 || game.discardsLeft <= 0} onClick={() => act({ type: 'discard', cards: selected })}>Discard</button>
                <button data-testid="asc-clear" disabled={selected.length === 0} onClick={() => { setSelected([]); setError('') }}>Clear</button>
              </div>
            </>
          )}
          {game.lastPlay && (
            <p className="muted" data-testid="asc-last" data-deltas={JSON.stringify(game.lastPlay.statDeltas)}>
              Last play: {game.lastPlay.label} ({game.lastPlay.cards.map(cardName).join(' ')}) for {game.lastPlay.pokerScore} + land {game.lastPlay.landBonus}{game.lastPlay.civBonus > 0 ? ` + civ ${game.lastPlay.civBonus}` : ''} = {game.lastPlay.score} · World: {gains(game.lastPlay.statDeltas)}
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
