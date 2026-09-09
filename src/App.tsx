import { useCallback, useEffect, useState } from 'react'
import {
  newGame,
  applyAction,
  legalActions,
  type Action,
  type GameState,
  type Region,
} from './engine/worldhand'
import { cardName, type Card } from './engine/poker'
import { saveGame, loadGame, clearSave } from './ui/save'

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [seedText, setSeedText] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const existing = loadGame()
    if (existing) setState(existing)
  }, [])

  useEffect(() => {
    if (state) saveGame(state)
  }, [state])

  const act = useCallback((a: Action) => {
    try {
      setState((s) => (s ? applyAction(s, a) : s))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const start = useCallback(() => {
    const t = seedText.trim() || `world-${Date.now()}`
    setState(newGame(t))
    setError('')
  }, [seedText])

  if (!state) {
    return (
      <main className="shell intro">
        <h1>Worldhand</h1>
        <p className="tagline">
          A deterministic planet-building roguelike. Shape regions across epochs, raise wonders,
          and hold the world together — your 8-card hand decides how strong your actions are.
        </p>
        <div className="card panel">
          <label htmlFor="seed">Seed phrase (same seed = same world, same cards)</label>
          <input
            id="seed"
            placeholder="e.g. auralia-the-first"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />
          <div className="row">
            <button className="primary" onClick={start}>Begin New World</button>
            <button onClick={() => { const s = loadGame(); if (s) setState(s) }}>Load Saved World</button>
            <button className="danger" onClick={clearSave}>Clear Save</button>
          </div>
        </div>
        <p className="hint">
          Best 5-of-8 poker hand powers your World Actions — flushes fortify harder, straights
          raise wonders. No betting, no gambling: just civilization under a ticking clock.
        </p>
      </main>
    )
  }

  const wonders = state.regions.filter((r) => r.wonder).length
  const fractured = state.regions.filter((r) => r.fractured).length
  const over = state.phase === 'game-over'
  const actions = legalActions(state)

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Worldhand</h1>
          <span className="seed">
            seed: {state.seedText} · epoch {state.epoch}/15
          </span>
        </div>
        <div className="row">
          <button onClick={() => { if (state) { saveGame(state); setSaved(true); setTimeout(() => setSaved(false), 1500) } }}>
            {saved ? 'Saved ✓' : 'Save'}
          </button>
          <button onClick={() => { const s = loadGame(); if (s) setState(s) }}>Load</button>
          <button className="danger" onClick={() => { clearSave(); setState(null) }}>Quit</button>
        </div>
      </header>

      <section className="hud">
        <div className="hud-item">🪙 Order <strong>{state.order}</strong></div>
        <div className="hud-item">⚡ Actions <strong>{state.actionsLeft}</strong></div>
        <div className="hud-item">🏛 Wonders <strong>{wonders}/3</strong></div>
        <div className="hud-item">💔 Fractured <strong>{fractured}/3</strong></div>
        {state.bestHand && <div className="hud-item">🃏 Hand <strong>{state.bestHand.category}</strong></div>}
      </section>

      {state.laws.length > 0 && (
        <section className="effects">
          {state.laws.map((l) => (
            <div key={l.id} className="effect-chip" title={l.desc}>⚖ {l.title}</div>
          ))}
        </section>
      )}

      {over ? (
        <section className={`panel verdict ${state.outcome === 'won' ? 'win' : 'lose'}`}>
          <h2>{state.outcome === 'won' ? '🏆 The Worldhand Stands' : '💀 The Worldhand Crumbles'}</h2>
          <p>{state.outcomeReason}</p>
          <div className="row">
            <button className="primary" onClick={() => setState(newGame(state.seedText))}>Replay Same Seed</button>
            <button onClick={() => { clearSave(); setState(null) }}>Back to Menu</button>
          </div>
        </section>
      ) : state.phase === 'law' ? (
        <section className="panel">
          <h2>Enact a Law</h2>
          <div className="row">
            {state.lawDraft.map((l) => (
              <button key={l.id} className="law-btn" onClick={() => act({ type: 'enactLaw', lawId: l.id })}>
                <strong>{l.title}</strong>
                <span>{l.desc}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="regions">
            {state.regions.map((r) => (
              <RegionCard key={r.id} r={r} actions={actions} act={act} />
            ))}
          </section>

          <section className="hand">
            <h2>Your Hand of 8</h2>
            <div className="hand-cards">
              {state.hand.map((c, i) => (
                <span key={i} className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>{cardName(c)}</span>
              ))}
            </div>
          </section>

          {state.market.length > 0 && (
            <section className="panel market">
              <h2>Market — buy cards into the world deck</h2>
              <div className="row">
                {state.market.map((m, i) => (
                  <button key={i} onClick={() => act({ type: 'buyCard', offerIdx: i })}>
                    {cardName(m.card)} · {Math.max(1, m.cost - state.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0))} Order
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="controls">
            <div className="row">
              <button className="primary" onClick={() => act({ type: 'survey' })} disabled={!actions.some((a) => a.type === 'survey')}>
                Survey ({actions.some((a) => a.type === 'survey') ? '1⚡' : '—'})
              </button>
              <button onClick={() => act({ type: 'trade' })} disabled={!actions.some((a) => a.type === 'trade')}>
                Open Market
              </button>
              <button className="danger" onClick={() => act({ type: 'endActions' })}>End Actions</button>
            </div>
            {error && <p className="error">{error}</p>}
          </section>
        </>
      )}

      <section className="log">
        <h2>World Chronicle</h2>
        <ul>
          {state.log.slice(-12).map((l, i) => (
            <li key={i}><span className="street">E{l.epoch}</span> {l.text}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function RegionCard({
  r,
  actions,
  act,
}: {
  r: Region
  actions: Action[]
  act: (a: Action) => void
}) {
  const canProsper = actions.some((a) => a.type === 'prosper' && a.regionId === r.id)
  const canFortify = actions.some((a) => a.type === 'fortify' && a.regionId === r.id)
  const canWonder = actions.some((a) => a.type === 'wonder' && a.regionId === r.id)
  return (
    <div className={`seat region ${r.fractured ? 'folded' : ''} ${r.wonder ? 'wonder' : ''}`}>
      <div className="seat-head">
        <strong>{r.name}</strong>
        <span className="muted">{r.terrain}</span>
      </div>
      <div className="stab">
        {r.wonder && <span className="action">🏛 Wonder</span>}
        {!r.wonder && (
          <span className="stab-bar" title={`stability ${r.stability}/10`}>
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={i < r.stability ? 'on' : 'off'} />
            ))}
          </span>
        )}
        <span className="chips">{r.stability}/10</span>
      </div>
      {r.fractured && <span className="action allin">fractured</span>}
      <div className="row">
        {canProsper && <button onClick={() => act({ type: 'prosper', regionId: r.id })}>Prosper</button>}
        {canFortify && <button onClick={() => act({ type: 'fortify', regionId: r.id })}>{r.fractured ? 'Repair' : 'Fortify'}</button>}
        {canWonder && <button className="primary" onClick={() => act({ type: 'wonder', regionId: r.id })}>Wonder (12🪙)</button>}
      </div>
    </div>
  )
}

export type { Card }