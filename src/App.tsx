import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  newGame, applyAction, checkWithering, preview,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, TOTAL_EPOCHS, TOTAL_REGIONS,
  STABILITY_MAX, SEEDS_CAP, EPOCH_TARGETS, UPCOMING_DROUGHT_EPOCH,
  SURVIVAL_START,
  type Action, type GameState, type Region,
} from './engine/worldhand'
import type { Suit } from './engine/poker'
import { cardName, SUIT_NAMES } from './engine/poker'
import { saveGame, loadGame, clearSave } from './ui/save'
import Planet3D from './components/Planet3D'

const SUIT_CLASS: Record<Suit, string> = { S: 'spade', H: 'heart', D: 'diamond', C: 'club' }
const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const CARD_ACTION: Record<Suit, string> = { S: 'Study', H: 'Grow', D: 'Mine', C: 'Settle' }

/** Growth breakdown part formatting: +n for gains, plain n for 0/penalties. */
const fmtPart = (n: number) => (n > 0 ? `+${n}` : `${n}`)

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
  const [tieChoice, setTieChoice] = useState<Suit | undefined>(undefined)
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
      setState((s) => (s ? checkWithering(applyAction(s, a)) : s))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const start = useCallback(() => {
    const t = seedText.trim() || `world-${Date.now()}`
    setState(newGame(t))
    setError('')
    setTieChoice(undefined)
  }, [seedText])

  const plan = useMemo(
    () => (state && state.phase === 'select' ? preview(state, tieChoice) : null),
    [state, tieChoice],
  )

  if (!state) {
    return (
      <main className="shell intro">
        <h1>Worldhand</h1>
        <p className="tagline">
          A deterministic planet-building card roguelike across three epochs. Each epoch you
          make <strong>4 plays</strong> from an 8-card hand — select 1–5 cards, score them as a
          poker hand, and the majority suit acts: ♠ Study develops regions, ♥ Grow banks
          Growth, ♦ Mine gathers Seeds, ♣ Settle steadies everything. Every play banks one
          <strong> Growth</strong> score toward escalating epoch targets. Survive the previewed
          epoch-3 Drought and grow a flourishing world.
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
            {saved ? 'Saved ✓' : 'Save'}
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
          <span className="hud-label">🌱 Flourishing</span>
          <strong>{state.flourishing}<span className="hud-of">/{target.need}</span></strong>
        </div>
        <div className="hud-item" title="Seeds — the currency for the market (cap 30)">
          <span className="hud-label">🌰 Seeds</span>
          <strong>{state.seeds}<span className="hud-of">/{SEEDS_CAP}</span></strong>
        </div>
        <div className="hud-item" title="Plays left this epoch (4 per epoch)">
          <span className="hud-label">▶ Plays</span>
          <strong>{state.playsLeft}/{PLAYS_PER_EPOCH}</strong>
        </div>
        <div className="hud-item" title="Discards left this epoch (3 per epoch)">
          <span className="hud-label">🗑 Discards</span>
          <strong>{state.discardsLeft}/{DISCARDS_PER_EPOCH}</strong>
        </div>
        <div className="hud-item" title="Living (awake) regions of 12">
          <span className="hud-label">🗺 Living regions</span>
          <strong>{awakened.length}/{TOTAL_REGIONS}</strong>
        </div>
        <div className="hud-item" title="Survival pool — a missed epoch-1/2 target costs 1; 0 ends the run">
          <span className="hud-label">❤ Survival</span>
          <strong>{state.survival}/{SURVIVAL_START}</strong>
        </div>
        {state.challenge ? (
          <div className={`hud-item ${planOrChallengeOk(state) ? 'ok' : 'warn'}`} title="This epoch's challenge — resolves at epoch end">
            <span className="hud-label">⚔ Drought</span>
            <strong>{planOrChallengeOk(state) ? 'on track' : 'at risk'}</strong>
            <span className="hud-note">{state.challenge.desc}</span>
          </div>
        ) : state.epoch < UPCOMING_DROUGHT_EPOCH ? (
          <div className="hud-item upcoming" title="Upcoming challenge — every living region must hold stability 3+ when it resolves">
            <span className="hud-label">⚔ Upcoming</span>
            <strong>Drought in epoch {UPCOMING_DROUGHT_EPOCH}</strong>
            <span className="hud-note">keep every living region at stability 3+</span>
          </div>
        ) : null}
      </section>

      {state.laws.length > 0 && (
        <section className="effects" aria-label="Owned laws and upgrades">
          {state.laws.map((l) => (
            <div key={l.id} className="effect-chip" title={l.desc}>
              {l.kind === 'law' ? '⚖' : l.kind === 'upgrade' ? '✦' : '🌍'} {l.title}
            </div>
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
      ) : state.phase === 'market' ? (
        <section className="panel market">
          <h2>Market — spend Seeds on laws, upgrades, and expansions</h2>
          <div className="row">
            {state.market.length === 0 && <p className="muted">Market is sold out this epoch.</p>}
            {state.market.map((m) => {
              const discount = state.laws.reduce((n, l) => n + (l.marketDiscount ?? 0), 0)
              const cost = Math.max(1, m.cost - discount)
              return (
                <button key={m.id} className="market-btn" disabled={state.seeds < cost} onClick={() => act({ type: 'buy', itemId: m.id })}>
                  <strong>{m.kind === 'law' ? '⚖' : m.kind === 'upgrade' ? '✦' : '🌍'} {m.title} — {cost} 🌰</strong>
                  <span>{m.desc}</span>
                </button>
              )
            })}
          </div>
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
                    <span className={`pv-cat ${SUIT_CLASS[plan.suit]}`}>{SUIT_GLYPH[plan.suit]} {plan.categoryLabel}</span>
                    <span className="pv-pts">+{plan.categoryPoints} pts</span>
                    <span className="pv-dec">
                      {plan.suitDecision === 'majority' ? 'suit by majority'
                        : plan.suitDecision === 'single' ? 'single card'
                        : plan.suitDecision === 'tiebreak-choice' ? 'suit by your tie choice'
                        : 'suit by tie (S,H,D,C order)'}
                    </span>
                  </p>
                  <ul className="pv-cards">
                    {plan.cards.map((c, i) => <li key={i} className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>{cardName(c)}</li>)}
                  </ul>
                  <p className="pv-summary">{plan.summary}</p>
                  {plan.suitDecision.startsWith('tiebreak') && (
                    <div className="row tie-row" role="group" aria-label="Tie-break suit choice">
                      <span className="muted">Tie — act as:</span>
                      {(['S', 'H', 'D', 'C'] as Suit[]).map((s) => (
                        <button
                          key={s}
                          className={`tie-btn ${tieChoice === s ? 'sel' : ''}`}
                          aria-pressed={tieChoice === s}
                          onClick={() => setTieChoice(s)}
                        >
                          {SUIT_GLYPH[s]} {SUIT_NAMES[s].split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section className="hand panel">
                <h2>
                  Hand of 8 — select 1–5 cards · {state.playsLeft} plays · {state.discardsLeft} discards left
                </h2>
                {plan && plan.valid ? (
                  <div className="growth-hero" data-testid="growth-hero" aria-live="polite">
                    <span className="growth-hero-label">Growth</span>
                    <span className="growth-hero-num">{plan.growth}</span>
                    <span className={`growth-hero-action ${SUIT_CLASS[plan.suit]}`}>
                      {SUIT_GLYPH[plan.suit]} {CARD_ACTION[plan.suit]}
                    </span>
                    <span className="growth-hero-breakdown" title="ordered breakdown: poker → region → laws → drought">
                      {fmtPart(plan.growthParts.poker)} poker · {fmtPart(plan.growthParts.region)} region · {fmtPart(plan.growthParts.laws)} laws · {fmtPart(plan.growthParts.drought)} drought
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
                        <span className={`pcard-name ${sel ? 'on' : ''}`}>{CARD_ACTION[c.s]}</span>
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
                    onClick={() => { act({ type: 'play', suitChoice: tieChoice }); setTieChoice(undefined) }}
                  >
                    Play {plan && plan.valid ? `${SUIT_GLYPH[plan.suit]} ${plan.categoryLabel}` : ''}
                  </button>
                  <button
                    disabled={state.selected.length < 1 || state.discardsLeft <= 0}
                    onClick={() => { act({ type: 'discard', cardIdxs: [...state.selected] }); setTieChoice(undefined) }}
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

function planOrChallengeOk(s: GameState): boolean {
  const living = s.regions.filter((r) => !r.dormant)
  if (s.challenge?.kind === 'drought') return living.every((r) => r.stability >= s.challenge!.need)
  if (s.challenge?.kind === 'stable5') return living.filter((r) => r.stability >= 5).length >= s.challenge!.need
  if (s.challenge?.kind === 'revealed') return living.length >= s.challenge!.need
  if (s.challenge?.kind === 'stabilitySum') return living.reduce((n, r) => n + r.stability, 0) >= s.challenge!.need
  return true
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
  return (
    <section className="panel planet" aria-label="Planet map">
      <h2>Planet — 12 regions</h2>
      <Planet3D regions={regions} focus={focus} onFocus={onFocus} />
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