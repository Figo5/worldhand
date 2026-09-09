import { useCallback, useEffect, useState } from 'react'
import {
  newGame,
  applyAction,
  checkWithering,
  challengeMet,
  suitActionName,
  FLOURISH_TARGET,
  TOTAL_EPOCHS,
  HANDS_PER_EPOCH,
  STABILITY_MAX,
  type Action,
  type GameState,
  type Region,
} from './engine/worldhand'
import { cardName } from './engine/poker'
import { saveGame, loadGame, clearSave } from './ui/save'

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [seedText, setSeedText] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [targetRegion, setTargetRegion] = useState<number | undefined>(undefined)
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
      setState((s) => (s ? checkWithering(applyAction(s, a)) : s))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const start = useCallback(() => {
    const t = seedText.trim() || `world-${Date.now()}`
    setState(newGame(t))
    setSelected(null)
    setTargetRegion(undefined)
    setError('')
  }, [seedText])

  if (!state) {
    return (
      <main className="shell intro">
        <h1>Worldhand</h1>
        <p className="tagline">
          A deterministic planet-building card roguelike. Across 8 epochs of 4 hands you play
          an 8-card hand against a living world: ♠ Roots steadies regions, ♥ Bloom raises
          Flourishing, ♦ Sow gathers Seeds, ♣ Tend tends everything. Reach a Flourishing
          world before decay wins.
        </p>
        <div className="card panel">
          <label htmlFor="seed">Seed phrase — same seed, same world, same cards</label>
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
      </main>
    )
  }

  const awakened = state.regions.filter((r) => !r.dormant)
  const chOk = state.challenge ? challengeMet(state, state.challenge) : null
  const over = state.phase === 'game-over'

  const discardsLeft = state.discardsLeft
  const targetNeeded = selected !== null && state.hand[selected]?.s === 'S' && targetRegion === undefined
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Worldhand</h1>
          <span className="seed">
            seed: {state.seedText} · epoch {state.epoch}/{TOTAL_EPOCHS} · hand{' '}
            {Math.max(1, state.handInEpoch)}/{HANDS_PER_EPOCH}
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
        <div className="hud-item">🌱 Flourishing <strong>{state.flourishing}/{FLOURISH_TARGET}</strong></div>
        <div className="hud-item">🌰 Seeds <strong>{state.seeds}</strong></div>
        <div className="hud-item">🃏 Discards <strong>{state.discardsLeft}/3</strong></div>
        <div className="hud-item">🗺 Living <strong>{awakened.length}/12</strong></div>
        {state.challenge && (
          <div className={`hud-item ${chOk ? 'ok' : 'warn'}`} title="This epoch's challenge (resolution at epoch end)">
            ⚔ {state.challenge.desc} — {chOk ? 'on track' : 'behind'}
          </div>
        )}
      </section>

      {state.laws.length > 0 && (
        <section className="effects">
          {state.laws.map((l) => (
            <div key={l.id} className="effect-chip" title={l.desc}>⚖ {l.title}</div>
          ))}
        </section>
      )}

      {over ? (
        <section className={`panel verdict ${state.outcome === 'flourishing' ? 'win' : 'lose'}`}>
          <h2>{state.outcome === 'flourishing' ? '🌸 A Flourishing World' : '🍂 The World Withers'}</h2>
          <p>{state.outcomeReason}</p>
          <div className="row">
            <button className="primary" onClick={() => setState(newGame(state.seedText))}>Replay Same Seed</button>
            <button onClick={() => { clearSave(); setState(null) }}>Back to Menu</button>
          </div>
        </section>
      ) : state.phase === 'law' ? (
        <section className="panel">
          <h2>Enact a Law (pay with Seeds)</h2>
          <div className="row">
            {state.lawDraft.map((l) => (
              <button key={l.id} className="law-btn" disabled={state.seeds < l.cost} onClick={() => act({ type: 'enactLaw', lawId: l.id })}>
                <strong>{l.title} — {l.cost} Seeds</strong>
                <span>{l.desc}</span>
              </button>
            ))}
            <button onClick={() => act({ type: 'skipLaw' })}>Skip Law</button>
          </div>
        </section>
      ) : (
        <>
          <section className="regions">
            {state.regions.map((r) => (
              <RegionCard
                key={r.id}
                r={r}
                selected={targetRegion === r.id}
                onSelect={() => setTargetRegion(r.id)}
                playable={selected !== null && (state.hand[selected]?.s === 'S') && !r.dormant}
              />
            ))}
          </section>

          <section className="hand panel">
            <h2>
              Your hand of 8 — pick a card, then Play, Discard ({state.discardsLeft} left), or Advance
            </h2>
            <div className="hand-cards">
              {state.hand.map((c, i) => (
                <button
                  key={i}
                  className={`pcard-btn ${selected === i ? 'sel' : ''}`}
                  onClick={() => setSelected(i)}
                  title={suitActionName(c.s)}
                >
                  <span className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>{cardName(c)}</span>
                </button>
              ))}
            </div>
            <div className="row controls-row">
              <button
                className="primary"
                disabled={selected === null}
                onClick={() => {
                  if (selected === null) return
                  if (targetNeeded) { setError('♠ Roots needs a region target — click a region first.'); return }
                  act({ type: 'play', cardIdx: selected, regionId: targetRegion })
                  setSelected(null)
                  setTargetRegion(undefined)
                }}
              >
                Play {selected !== null ? suitActionName(state.hand[selected].s) : ''}
              </button>
              <button
                disabled={selected === null || state.discardsLeft <= 0}
                onClick={() => { if (selected !== null) { act({ type: 'discard', cardIdx: selected }); setSelected(null) } }}
              >
                Discard ({discardsLeft})
              </button>
              <button className="advance" onClick={() => { act({ type: 'advance' }); setSelected(null); setTargetRegion(undefined) }}>
                Advance → {state.handInEpoch < HANDS_PER_EPOCH ? `hand ${state.handInEpoch + 1}` : 'end of epoch'}
              </button>
            </div>
          </section>

          {state.market.length > 0 && (
            <section className="panel market">
              <h2>Market — buy cards into the deck (Seeds)</h2>
              <div className="row">
                {state.market.map((m, i) => {
                  const discount = state.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
                  const cost = Math.max(1, m.cost - discount)
                  return (
                    <button key={i} disabled={state.seeds < cost} onClick={() => act({ type: 'buyCard', offerIdx: i })}>
                      {cardName(m.card)} · {cost} 🌰
                    </button>
                  )
                })}
              </div>
            </section>
          )}

      {error && <p className="error">{error}</p>}
      {!error && selected !== null && state.hand[selected]?.s === 'S' && targetRegion === undefined && (
        <p className="hint">♠ Roots selected — click a living region above to target it, then Play.</p>
      )}
      {!error && selected !== null && state.hand[selected]?.s !== 'S' && (
        <p className="hint">♥ Bloom / ♦ Sow / ♣ Tend need no region target — press Play.</p>
      )}
        </>
      )}

      <section className="log">
        <h2>World Chronicle</h2>
        <ul>
          {state.log.slice(-12).map((l, i) => (
            <li key={i}><span className="street">{l.at}</span> {l.text}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function RegionCard({
  r,
  selected,
  onSelect,
  playable,
}: {
  r: Region
  selected: boolean
  onSelect: () => void
  playable: boolean
}) {
  const label = playable
    ? `Select ${r.name} as Roots target`
    : `${r.name} (${r.dormant ? 'dormant' : `stability ${r.stability}/${STABILITY_MAX}`})`
  return (
    <button
      type="button"
      className={`seat region region-btn ${r.dormant ? 'folded' : ''} ${selected ? 'sel' : ''} ${playable ? 'playable' : ''}`}
      onClick={playable ? onSelect : undefined}
      disabled={!playable}
      aria-pressed={selected}
      aria-label={label}
      title={playable ? 'Click to target this region with ♠ Roots' : playable ? label : 'Select a ♠ card to enable region targeting'}
    >
      <div className="seat-head">
        <strong>{r.name}</strong>
        <span className="muted">{r.terrain}</span>
      </div>
      {r.dormant ? (
        <span className="action allin">dormant — wake it with ♥ (Q+)</span>
      ) : (
        <div className="stab">
          <span className="stab-bar" title={`stability ${r.stability}/${STABILITY_MAX}`} aria-hidden="true">
            {Array.from({ length: STABILITY_MAX }, (_, i) => (
              <i key={i} className={i < r.stability ? 'on' : 'off'} />
            ))}
          </span>
          <span className="chips">{r.stability}/{STABILITY_MAX}</span>
        </div>
      )}
    </button>
  )
}