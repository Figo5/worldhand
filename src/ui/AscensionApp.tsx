// Ascension prototype screen: dev server only (App.tsx gates it behind
// import.meta.env.DEV, so production and portable builds drop it entirely).
// Deliberately plain: a seam for the engine skeleton, not a design pass.
// Saves nothing; selection lives here, not in engine state.
import { useMemo, useState } from 'react'
import {
  newAscensionGame, applyAscensionAction, scorePlay,
  type AscensionAction, type AscensionState,
} from '../engine/ascension/ascension'
import { cardName } from '../engine/poker'

export default function AscensionApp({ onExit }: { onExit: () => void }) {
  const [seedText, setSeedText] = useState('')
  const [game, setGame] = useState<AscensionState | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const preview = useMemo(() => {
    if (!game || selected.length === 0) return null
    try { return scorePlay(game.hand, selected) } catch { return null }
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
        <p className="muted">Development build only. Engine skeleton: seeded deal, play, discard, rounds. Nothing is saved.</p>
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
            {preview ? `${preview.label}: ${preview.chips} chips × ${preview.mult} mult = ${preview.score}` : 'Select 1–5 cards.'}
          </p>
          <div className="row">
            <button className="primary" data-testid="asc-play" disabled={!preview} onClick={() => act({ type: 'play', cards: selected })}>Play</button>
            <button data-testid="asc-discard" disabled={selected.length === 0 || game.discardsLeft <= 0} onClick={() => act({ type: 'discard', cards: selected })}>Discard</button>
            <button data-testid="asc-clear" disabled={selected.length === 0} onClick={() => { setSelected([]); setError('') }}>Clear</button>
          </div>
          {game.lastPlay && (
            <p className="muted" data-testid="asc-last">
              Last play: {game.lastPlay.label} ({game.lastPlay.cards.map(cardName).join(' ')}) for {game.lastPlay.score}
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
