import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  newGame, applyAction, preview,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, TOTAL_EPOCHS, TOTAL_REGIONS,
  STABILITY_MAX, SEEDS_CAP, EPOCH_TARGETS, SURVIVAL_START, LAW_SLOTS,
  type Action, type GameState, type Region, type Law,
} from './engine/worldhand'
import { cardName, SUIT_NAMES } from './engine/poker'
import type { Suit } from './engine/poker'
import { saveGame, loadGame, clearSave } from './ui/save'
import Planet3D from './components/Planet3D'

const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

/** Growth breakdown part formatting: +n for gains, plain n for 0/penalties. */
const fmtPart = (n: number) => (n > 0 ? `+${n}` : `${n}`)

const KIND_LABEL: Record<Law['kind'], string> = {
  law: 'Law', upgrade: 'Upgrade', expansion: 'Expansion', cards: 'Cards',
}

const TERRAIN_LABELS: Record<string, string> = {
  meadow: 'Meadow',
  coast: 'Coast',
  highland: 'Highland',
  forest: 'Forest',
  steppe: 'Steppe',
  wetland: 'Wetland',
}

/** Arrow-key navigation across the hand: focus follows Left/Right/Up/Down
 *  between the card buttons; Enter/Space toggles via the buttons themselves. */
function handleHandKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.pcard-btn'))
  if (buttons.length === 0) return
  const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const next = ((idx < 0 ? 0 : idx + delta) + buttons.length) % buttons.length
  buttons[next].focus()
  e.preventDefault()
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [seedText, setSeedText] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [mapFocus, setMapFocus] = useState<number | null>(null)

  useEffect(() => {
    const existing = loadGame()
    if (existing) setState(existing)
  }, [])

  // Auto-save: every committed state-changing action persists immediately.
  // Selection toggles also trigger this (cheap, idempotent) so a quit or reload
  // never loses progress. Rewards are applied once inside the engine commit —
  // saving the resulting state cannot double-apply them, and the Save button
  // stays as an explicit no-op-safe checkpoint. Quit still never clears the save.
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

  const plan = useMemo(
    () => (state && state.phase === 'select' ? previewOf(state) : null),
    [state],
  )

  if (!state) {
    return (
      <main className="shell intro">
        <h1>Worldhand</h1>
        <p className="tagline">
          A deterministic planet-building card roguelike across three epochs. Each epoch you
          make <strong>4 plays</strong> from an 8-card hand: select 1–5 cards, score them as a
          poker hand, and bank one big <strong>Growth</strong> number toward the epoch target.
          Every play also earns <strong>Seeds</strong> — spend them in the market on upgrades,
          extra cards, and new regions to make the civilization smarter and the planet grow.
          Miss an epoch target and you lose a life; three misses and the world withers.
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
            <button onClick={() => { const s = loadGame(); if (s) setState(s); else setError('No saved world found.') }}>Load Saved World</button>
            <button className="danger" onClick={clearSave}>Clear Save</button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    )
  }

  const awakened = state.regions.filter((r) => !r.dormant)
  const over = state.phase === 'game-over'
  const target = EPOCH_TARGETS[state.epoch - 1]

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Worldhand</h1>
          <span className="seed">
            seed: {state.seedText} · epoch {state.epoch}/{TOTAL_EPOCHS}
          </span>
        </div>
        <div className="row">
          <button onClick={() => { saveGame(state); setSaved(true); setTimeout(() => setSaved(false), 1500) }}>
            {saved ? 'Saved' : 'Save'}
          </button>
          <button onClick={() => { const s = loadGame(); if (s) setState(s) }}>Load</button>
          <button
            className="danger"
            onClick={() => { /* quit keeps the save intact */ setState(null) }}
            title="Quit to menu — your save is kept and can be reloaded"
          >
            Quit
          </button>
        </div>
      </header>

      <section className="hud" aria-label="World status">
        <div className="hud-item" title="Flourishing now — this epoch's single Growth target is the bar to clear">
          <span className="hud-label">Flourishing</span>
          <strong>{state.flourishing}<span className="hud-of">/{target.need}</span></strong>
        </div>
        <div className="hud-item" title="Seeds — the market currency (cap 30)">
          <span className="hud-label">Seeds</span>
          <strong>{state.seeds}<span className="hud-of">/{SEEDS_CAP}</span></strong>
        </div>
        <div className="hud-item" title="Lives — a missed epoch target costs 1; 0 ends the run">
          <span className="hud-label">Lives</span>
          <strong>{state.lives}/{SURVIVAL_START}</strong>
        </div>
        <div className="hud-item" title="Plays left this epoch (4 per epoch)">
          <span className="hud-label">Plays</span>
          <strong>{state.playsLeft}/{PLAYS_PER_EPOCH}</strong>
        </div>
        <div className="hud-item" title="Discards left this epoch (3 per epoch)">
          <span className="hud-label">Discards</span>
          <strong>{state.discardsLeft}/{DISCARDS_PER_EPOCH}</strong>
        </div>
        <div className="hud-item" title="Living (awake) regions of 12">
          <span className="hud-label">Living regions</span>
          <strong>{awakened.length}/{TOTAL_REGIONS}</strong>
        </div>
      </section>

      {state.laws.length > 0 && (
        <section className="effects" aria-label="Owned laws and upgrades">
          {state.laws.map((l) => (
            <div key={l.id} className="effect-chip" title={l.desc}>
              <span className="effect-kind">{KIND_LABEL[l.kind] ?? l.kind}</span> {l.title}
            </div>
          ))}
        </section>
      )}

      {over ? (
        <section className={`panel verdict ${state.outcome === 'flourishing' ? 'win' : 'lose'}`}>
          <h2>{state.outcome === 'flourishing' ? 'A Flourishing World' : 'The World Withers'}</h2>
          <p>{state.outcomeReason}</p>
          <div className="row">
            <button className="primary" onClick={() => setState(newGame(state.seedText))}>Replay Same Seed</button>
            <button onClick={() => { clearSave(); setState(null) }}>Back to Menu</button>
          </div>
        </section>
      ) : state.phase === 'market' ? (
        <section className="panel market">
          <h2>Market — spend Seeds on upgrades, cards, and new regions</h2>
          <p className="muted market-slots">Slots used {state.laws.length}/{LAW_SLOTS} — buying is blocked at the cap until you remove an item.</p>
          <div className="row">
            {state.market.length === 0 && <p className="muted">Market is sold out this epoch.</p>}
            {state.market.map((m) => {
              const discount = state.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
              const cost = Math.max(1, m.cost - discount)
              return (
                <button key={m.id} className="market-btn" disabled={state.seeds < cost || state.laws.length >= LAW_SLOTS} onClick={() => act({ type: 'buy', itemId: m.id })}>
                  <strong>{m.title} — {cost} Seeds</strong>
                  <span>{m.desc}</span>
                  <span className="market-kind">{KIND_LABEL[m.kind] ?? m.kind}</span>
                </button>
              )
            })}
          </div>
          {state.laws.length > 0 && (
            <div className="row owned-row" role="group" aria-label="Owned laws and upgrades — remove to free a slot">
              <span className="muted">Owned:</span>
              {state.laws.map((l) => (
                <button key={l.id} className="remove-btn" title={`Remove ${l.title} (frees a slot; no refund)`} onClick={() => act({ type: 'removeLaw', lawId: l.id })}>
                  Remove {l.title}
                </button>
              ))}
            </div>
          )}
          <div className="row controls-row">
            <button className="advance" onClick={() => act({ type: 'endMarket' })}>
              Continue → close epoch {state.epoch}
            </button>
          </div>
        </section>
      ) : state.phase === 'epoch-end' ? (
        <section className="panel" data-testid="epoch-end">
          <h2>Epoch {state.epoch} closed</h2>
          <p>
            {state.log.filter((l) => l.at === `e${state.epoch}`).slice(-3).map((l) => l.text).join(' · ') || 'Epoch resolved.'}
          </p>
          <div className="row controls-row">
            <button className="advance" data-testid="close-epoch-btn" onClick={() => act({ type: 'closeEpoch' })}>
              Continue → begin epoch {state.epoch + 1}
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="game-grid">
            <PlanetPanel
              regions={state.regions}
              focus={mapFocus}
              onFocus={setMapFocus}
            />
            <div className="side">
              {plan && plan.valid && (
                <section className="panel preview" data-testid="preview">
                  <h2>Resolution preview</h2>
                  <p className="pv-line">
                    <span className={`pv-cat pv-cat-plain`}>{plan.categoryLabel}</span>
                    <span className="pv-pts">{plan.pokerBase} chips × {plan.mult} mult</span>
                    <span className="pv-dec">
                      {plan.cards.map((c) => cardName(c)).join(' ')}
                    </span>
                  </p>
                  <ul className="pv-cards">
                    {plan.cards.map((c, i) => <li key={i} className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>{cardName(c)}</li>)}
                  </ul>
                  <p className="pv-summary">{plan.summary}</p>
                </section>
              )}

              <section className="hand panel">
                <h2>
                  Hand — select 1–5 cards · {state.playsLeft} plays · {state.discardsLeft} discards left
                </h2>
                {plan && plan.valid ? (
                  <div className="growth-hero" data-testid="growth-hero" aria-live="polite">
                    <span className="growth-hero-label">Growth</span>
                    <span className="growth-hero-num">{plan.growth}</span>
                    <span className="growth-hero-chips" title="chips × mult — the poker base">
                      {plan.pokerBase} chips × {plan.mult} mult
                    </span>
                    <span className="growth-hero-breakdown" title="ordered breakdown: poker → laws">
                      {fmtPart(plan.growthParts.poker)} poker · {fmtPart(plan.growthParts.laws)} laws
                    </span>
                  </div>
                ) : (
                  <div className="growth-hero muted" data-testid="growth-hero">
                    <span className="growth-hero-label">Growth</span>
                    <span className="growth-hero-num">—</span>
                    <span className="growth-hero-breakdown">select 1–5 cards to bank Growth toward {target.need}</span>
                  </div>
                )}
                <div className="hand-cards" role="listbox" aria-label="Hand" onKeyDown={handleHandKeys}>
                  {state.hand.map((c, i) => {
                    const sel = state.selected.includes(i)
                    return (
                      <button
                        key={i}
                        role="option"
                        aria-selected={sel}
                        className={`pcard-btn ${sel ? 'sel' : ''}`}
                        data-card-name={cardName(c)}
                        onClick={() => act({ type: 'toggleCard', cardIdx: i })}
                      >
                        <span className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>
                          <span className="pcard-rank">{cardName(c)}</span>
                          <span className="pcard-sel-glyph" aria-hidden="true">✓</span>
                        </span>
                        <span className={`pcard-name ${sel ? 'on' : ''}`}>{SUIT_GLYPH[c.s]} {SUIT_NAMES[c.s].split(' ')[0]}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="hand-help">Arrow keys move between cards · Enter/Space toggles a card · select 1–5, then Play or Discard</p>
                <div className="row controls-row">
                  <button
                    className="primary"
                    disabled={!plan || !plan.valid}
                    data-testid="play-btn"
                    onClick={() => act({ type: 'play' })}
                  >
                    Play Hand {plan && plan.valid ? `— ${plan.categoryLabel}` : ''}
                  </button>
                  <button
                    disabled={state.selected.length < 1 || state.discardsLeft <= 0}
                    onClick={() => act({ type: 'discard', cardIdxs: [...state.selected] })}
                    title="Discard the selected cards (1–5) and refill the hand"
                  >
                    Discard {state.selected.length > 0 ? `(${state.selected.length})` : ''} ({state.discardsLeft})
                  </button>
                  <button disabled={state.selected.length === 0} onClick={() => act({ type: 'clearSelection' })}>
                    Clear
                  </button>
                </div>
              </section>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
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

function previewOf(s: GameState) {
  return preview(s)
}

/** The planet panel: 3D globe (primary) + accessible region legend + map-detail.
 *  The legend makes every region selectable without rotating the globe. */
function PlanetPanel({
  regions, focus, onFocus,
}: {
  regions: Region[]
  focus: number | null
  onFocus: (id: number) => void
}) {
  const focused = focus !== null ? regions[focus] : null
  const living = regions.filter((r) => !r.dormant)
  const totalDev = living.reduce((n, r) => n + r.development, 0)
  const devPotential = living.length * STABILITY_MAX
  return (
    <section className="panel planet" aria-label="Planet map">
      <h2>Planet — 12 regions</h2>
      <Planet3D regions={regions} focus={focus} onFocus={onFocus} />
      <p className="planet-growth" data-testid="planet-growth" aria-label="Planet growth — driven by living regions and their development">
        <span className="pg-frac">{totalDev}/{devPotential}</span>
        <span>development across {living.length} living regions — the planet grows with it</span>
      </p>
      <div className="region-legend" data-testid="region-legend" role="group" aria-label="All 12 regions — select one to inspect it on the globe">
        {regions.map((r) => {
          const isFocus = focus === r.id
          return (
            <button
              key={r.id}
              className={`region-btn ${isFocus ? 'sel' : ''} ${r.dormant ? 'dormant' : ''}`}
              aria-pressed={isFocus}
              aria-label={`${r.name}, ${r.terrain}, ${r.dormant ? 'dormant' : `stability ${r.stability} of ${STABILITY_MAX}, development ${r.development}`}. Press to inspect; adjacency ${r.adjacency.map((a) => regions[a].name).join(', ')}.`}
              title={`${r.name} — ${TERRAIN_LABELS[r.terrain] ?? r.terrain}${r.dormant ? ' (dormant)' : `, stability ${r.stability}/${STABILITY_MAX}, development ${r.development}`}`}
              onClick={() => onFocus(r.id)}
            >
              <i className={`sw sw-${r.terrain}`} aria-hidden="true" />
              <span className="region-btn-name">{r.name}</span>
              {isFocus && <span className="region-check" aria-hidden="true">✓</span>}
              {r.dormant && <span className="z" aria-hidden="true">z</span>}
            </button>
          )
        })}
      </div>
      <div className="map-legend" aria-hidden="true">
        <span><i className="sw sw-meadow" /> meadow</span>
        <span><i className="sw sw-coast" /> coast</span>
        <span><i className="sw sw-highland" /> highland</span>
        <span><i className="sw sw-forest" /> forest</span>
        <span><i className="sw sw-steppe" /> steppe</span>
        <span><i className="sw sw-wetland" /> wetland</span>
        <span><i className="sw sw-dev" /> development icons</span>
      </div>
      {focused && (
        <div className="map-detail" data-testid="map-detail">
          <strong>{focused.name}</strong> — {TERRAIN_LABELS[focused.terrain] ?? focused.terrain}
          {focused.dormant
            ? ' · dormant'
            : ` · stability ${focused.stability}/${STABILITY_MAX} · development ${focused.development}`}
          <div className="muted">neighbors: {focused.adjacency.map((a) => regions[a].name).join(', ')}</div>
        </div>
      )}
    </section>
  )
}