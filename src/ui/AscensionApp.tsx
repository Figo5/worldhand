// Ascension prototype screen: dev server only (App.tsx gates it behind
// import.meta.env.DEV, so production and portable builds drop it entirely).
// Deliberately plain: a seam for the engine, not a design pass.
// Saves nothing; selection lives here, not in engine state.
import { useMemo, useState } from 'react'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, landAffinity, WORLD_STATS, WORLD_STAT_LABEL, TERRAIN,
  type AscensionAction, type AscensionState, type WorldStats,
} from '../engine/ascension/ascension'
import { ARCHETYPES, emergenceThreshold } from '../engine/ascension/civilizations'
import { cardName } from '../engine/poker'

/** "+2 Vitality · +1 Industry" (non-zero gains, in stat order) */
const gains = (d: WorldStats) =>
  WORLD_STATS.filter((k) => d[k] !== 0).map((k) => `+${d[k]} ${WORLD_STAT_LABEL[k]}`).join(' · ')

export default function AscensionApp({ onExit }: { onExit: () => void }) {
  const [seedText, setSeedText] = useState('')
  const [game, setGame] = useState<AscensionState | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const affinity = useMemo(() => (game ? landAffinity(game.regions) : null), [game])
  const preview = useMemo(() => {
    if (!game || selected.length === 0) return null
    try { return evaluatePlay(game, selected) } catch { return null }
  }, [game, selected])

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
        <p className="muted">Development build only. Seeded world and deal; played suits grow four world stats, the land pays a bonus for the stats its terrain favours, civilizations emerge at round ends, and each one then adds a passive bonus to plays. Nothing is saved.</p>
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
