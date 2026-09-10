import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  newGame, applyAction, preview,
  PLAYS_PER_EPOCH, DISCARDS_PER_EPOCH, TOTAL_REGIONS,
  STABILITY_MAX, epochTarget, SURVIVAL_START, LAW_SLOTS, worldScore,
  SPECIALIZATION_LABEL, SPECIALIZATION_BASE, DEV_STEP, DEV_BONUS_CAP,
  specOfCategory, regionBonusOf,
  type Action, type GameState, type Region, type Law, type Specialization,
} from './engine/worldhand'
import { cardName, SUIT_NAMES } from './engine/poker'
import type { Suit } from './engine/poker'
import { saveGame, loadGame, loadGameDetailed, clearSave, listLegacySaves } from './ui/save'
import Planet3D from './components/Planet3D'

const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

/** Growth breakdown part formatting: +n for gains, plain n for 0/penalties. */
const fmtPart = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** The full region-inspector sentence for a specialized region: which poker
 *  category benefits, the CURRENT bonus, how development changes it, and
 *  whether the region is dormant (pays 0) or active. */
function specializationSentence(r: Region): string {
  if (!r.specialization) return ''
  const label = SPECIALIZATION_LABEL[r.specialization]
  const base = SPECIALIZATION_BASE[r.specialization]
  if (r.dormant) {
    return `Poker specialization: ${label} — dormant: contributes 0. When awake: +${base} Growth on exact ${label} hands, +1 per ${DEV_STEP} development up to +${DEV_BONUS_CAP}.`
  }
  const devShare = Math.min(DEV_BONUS_CAP, Math.floor(Math.max(0, r.development) / DEV_STEP))
  return `Poker specialization: ${label} — active: +${regionBonusOf(r)} Growth on exact ${label} hands (base +${base} + development ${r.development} → +${devShare} of the +${DEV_BONUS_CAP} cap; +1 per ${DEV_STEP} development).`
}

/** The market-offer note for a wake-* expansion whose target region carries a
 *  specialization: what poker category the purchase will boost, at what base
 *  bonus, and how development scales it. */
function wakeOfferNote(m: Law, regions: Region[]): string | null {
  if (m.kind !== 'expansion' || m.wakeRegionId === undefined) return null
  const r = regions[m.wakeRegionId]
  if (!r || !r.specialization) return null
  const label = SPECIALIZATION_LABEL[r.specialization]
  return `Poker bonus when awake: +${SPECIALIZATION_BASE[r.specialization]} Growth on exact ${label} hands, +1 per ${DEV_STEP} development (cap +${DEV_BONUS_CAP}); currently ${r.dormant ? 'dormant' : 'awake'}.`
}

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
  // Incompatible-save report: the load attempt's explanation + legacy key.
  const [rejected, setRejected] = useState<{ reason: string; legacyKey: string | null } | null>(null)
  // Confirmation gate for destructive actions (Clear Save / Back to Menu).
  const [confirmClear, setConfirmClear] = useState<null | 'clear' | 'back'>(null)

  useEffect(() => {
    const res = loadGameDetailed()
    if (res.state) setState(res.state)
    else if (res.rejectedReason) setRejected({ reason: res.rejectedReason, legacyKey: res.legacyKey })
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

  // GLOBE-VISIBLE ON PREVIEW: which AWAKE regions match the previewed hand's
  // exact category right now (drives the legend highlight, the globe glow and
  // the banner). Empty for high card / non-specialized categories.
  const matchingRegions = useMemo(
    () => (plan?.valid && state && plan.growthParts.regions > 0
      ? state.regions.filter((r) => !r.dormant && r.specialization !== null && r.specialization === specOfCategory(plan.category))
      : []),
    [plan, state],
  )
  const previewSpec = plan?.valid ? specOfCategory(plan.category) : null
  // a dormant specialization region whose spec MATCHES the previewed category
  // (wake targets — worth telling the player about even while it pays 0)
  const dormantMatching = useMemo(
    () => (previewSpec && state
      ? state.regions.filter((r) => r.dormant && r.specialization === previewSpec)
      : []),
    [previewSpec, state],
  )

  if (!state) {
    const legacyCount = listLegacySaves().length
    return (
      <main className="shell intro">
        <h1>Worldhand</h1>
        <p className="tagline">
          A deterministic planet-building card roguelike across three epochs. Each epoch you
          make <strong>4 plays</strong> from an 8-card hand: select 1–5 cards, score them as a
          poker hand, and bank one big <strong>Growth</strong> number toward the epoch target.
          Every play also earns <strong>Seeds</strong> — spend them in the market on upgrades,
          extra cards, and new regions to make the civilization smarter and the planet grow.
          Every missed epoch target costs a life; at 0 lives the world withers.
        </p>
        {rejected && (
          <div className="card panel save-reject" data-testid="save-reject" role="alert">
            <h2>Saved world is incompatible — a fresh run is needed</h2>
            <p>{rejected.reason}</p>
            {rejected.legacyKey && (
              <p className="muted">
                The old save was NOT deleted or reinterpreted: the original blob is preserved
                under the localStorage key <code>{rejected.legacyKey}</code>
                {legacyCount > 0 ? ` (${legacyCount} preserved legacy save${legacyCount > 1 ? 's' : ''} in total)` : ''}.
              </p>
            )}
            <button
              onClick={() => {
                if (rejected.legacyKey) {
                  const raw = localStorage.getItem(rejected.legacyKey)
                  if (raw) window.alert('Preserved legacy save blob (unchanged):\n\n' + raw.slice(0, 400))
                }
              }}
            >
              Show preserved legacy blob
            </button>
          </div>
        )}
        {!rejected && legacyCount > 0 && (
          <p className="muted">{legacyCount} legacy save{legacyCount > 1 ? 's' : ''} from older engine versions {legacyCount > 1 ? 'are' : 'is'} preserved in localStorage (recoverable, never erased).</p>
        )}
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
            <button onClick={() => { const res = loadGameDetailed(); if (res.state) { setState(res.state); setRejected(null) } else if (res.rejectedReason) setRejected({ reason: res.rejectedReason, legacyKey: res.legacyKey }); else setError('No saved world found.') }}>Load Saved World</button>
            {confirmClear !== 'clear' ? (
              <button className="danger" onClick={() => setConfirmClear('clear')}>Clear Save</button>
            ) : (
              <span className="confirm-row">
                <button className="danger" onClick={() => { clearSave(); setConfirmClear(null); setError('Save cleared.') }}>Confirm: Clear Save</button>
                <button onClick={() => setConfirmClear(null)}>Cancel</button>
              </span>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </main>
    )
  }

  const awakened = state.regions.filter((r) => !r.dormant)
  const over = state.phase === 'game-over'
  const targetNeed = epochTarget(state.epoch)

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Worldhand</h1>
          <span className="seed">
            seed: {state.seedText} · epoch {state.epoch}
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
        <div className="hud-item" title="Growth banked THIS epoch against this epoch's target — resets each epoch">
          <span className="hud-label">This epoch</span>
          <strong>{state.epochGrowth}<span className="hud-of">/{targetNeed}</span></strong>
        </div>
        <div className="hud-item" title="Lifetime Flourishing — the planet's total score, keeps growing across epochs">
          <span className="hud-label">Flourishing</span>
          <strong>{state.flourishing}</strong>
        </div>
        <div className="hud-item" title="Seeds — the market currency (uncapped)">
          <span className="hud-label">Seeds</span>
          <strong>{state.seeds}</strong>
        </div>
        <div className="hud-item" title="Lives — EVERY missed epoch target (all 3 epochs) costs 1; 0 ends the run">
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
        <div className="hud-item" title="World Level — the simplified worldbuilding number. Auto-grows +1/epoch; boost with Seeds. Each level above 1 = +2 Growth/play, +1 Seed/epoch, +5 World Score.">
          <span className="hud-label">World Level</span>
          <strong>{state.worldLevel}</strong>
        </div>
        <div className="hud-item" title="World Score — the run's goal: how good you made the world (World Level + jokers + planets + vouchers + laws + Flourishing)">
          <span className="hud-label">World Score</span>
          <strong>{worldScore(state)}</strong>
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
            {confirmClear !== 'back' ? (
              <button className="danger" onClick={() => setConfirmClear('back')}>Back to Menu</button>
            ) : (
              <span className="confirm-row">
                <button className="danger" onClick={() => { clearSave(); setState(null); setConfirmClear(null) }}>Confirm: Back to Menu (clears the finished run's save)</button>
                <button onClick={() => setConfirmClear(null)}>Cancel</button>
              </span>
            )}
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
              const specNote = wakeOfferNote(m, state.regions)
              return (
                <button key={m.id} className="market-btn" disabled={state.seeds < cost || state.laws.length >= LAW_SLOTS} onClick={() => act({ type: 'buy', itemId: m.id })}>
                  <strong>{m.title} — {cost} Seeds</strong>
                  <span>{m.desc}</span>
                  {specNote && <span className="market-spec-note">{specNote}</span>}
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
          <h3 className="market-subhead">World Projects — fund the world (repeatable, cost rises each time)</h3>
          <div className="row">
            {state.projectMarket.map((p) => {
              const owned = state.projects.filter((x) => x.id === p.id).length
              const cost = p.baseCost + owned * p.costGrowth
              return (
                <button key={p.id} className="market-btn" disabled={state.seeds < cost} onClick={() => act({ type: 'buyProject', projectId: p.id })}>
                  <strong>{p.title} — {cost} Seeds</strong>
                  <span>{p.desc}</span>
                  <span className="market-kind">project ×{owned}</span>
                </button>
              )
            })}
          </div>
          <h3 className="market-subhead">Jokers — build your engine (conditional multipliers)</h3>
          <div className="row">
            {state.jokerMarket.map((j) => (
              <button key={j.id} className="market-btn" disabled={state.seeds < j.cost} onClick={() => act({ type: 'buyJoker', jokerId: j.id })}>
                <strong>{j.title} — {j.cost} Seeds</strong>
                <span>{j.desc}</span>
                <span className="market-kind">joker</span>
              </button>
            ))}
          </div>
          <h3 className="market-subhead">Planet cards — raise a hand type's base mult</h3>
          <div className="row">
            {state.planetMarket.map((p) => (
              <button key={p.id} className="market-btn" disabled={state.seeds < p.cost} onClick={() => act({ type: 'buyPlanet', planetId: p.id })}>
                <strong>{p.title} — {p.cost} Seeds</strong>
                <span>{p.desc}</span>
                <span className="market-kind">planet</span>
              </button>
            ))}
          </div>
          <h3 className="market-subhead">Consumables — one-shot boosts</h3>
          <div className="row">
            {state.consumableMarket.map((c) => (
              <button key={c.id} className="market-btn" disabled={state.seeds < c.cost} onClick={() => act({ type: 'buyConsumable', consumableId: c.id })}>
                <strong>{c.title} — {c.cost} Seeds</strong>
                <span>{c.desc}</span>
                <span className="market-kind">consumable</span>
              </button>
            ))}
          </div>
          <h3 className="market-subhead">Vouchers — permanent globals</h3>
          <div className="row">
            {state.voucherMarket.map((v) => (
              <button key={v.id} className="market-btn" disabled={state.seeds < v.cost} onClick={() => act({ type: 'buyVoucher', voucherId: v.id })}>
                <strong>{v.title} — {v.cost} Seeds</strong>
                <span>{v.desc}</span>
                <span className="market-kind">voucher</span>
              </button>
            ))}
          </div>
          <h3 className="market-subhead">World Level — boost the world (cost {10 + (state.worldLevel - 1) * 5} Seeds)</h3>
          <div className="row">
            <button className="market-btn" disabled={state.seeds < 10 + (state.worldLevel - 1) * 5} onClick={() => act({ type: 'boostWorld' })}>
              <strong>Boost World Level — {10 + (state.worldLevel - 1) * 5} Seeds</strong>
              <span>+1 World Level (level {state.worldLevel} → {state.worldLevel + 1}): +2 Growth/play, +1 Seed/epoch, +5 World Score.</span>
              <span className="market-kind">world</span>
            </button>
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
              previewSpec={previewSpec}
              matchingIds={matchingRegions.map((r) => r.id)}
              previewActive={!!plan?.valid && state.phase === 'select'}
            />
            <div className="side">
              {plan && plan.valid && (
                <section className="panel preview" data-testid="preview">
                  <h2>Resolution preview</h2>
                  <p className="pv-line">
                    <span className={`pv-cat pv-cat-plain`}>{plan.categoryLabel}</span>
                    <span className="pv-pts">{plan.chips} chips × {plan.mult} mult = {plan.pokerBase} base</span>
                    <span className="pv-dec">
                      {plan.cards.map((c) => cardName(c)).join(' ')}
                    </span>
                  </p>
                  <ul className="pv-cards">
                    {plan.cards.map((c, i) => <li key={i} className={`pcard ${c.s === 'H' || c.s === 'D' ? 'red' : ''}`}>{cardName(c)}</li>)}
                  </ul>
                  <p className="pv-summary">{plan.summary}</p>
                  {plan.valid && state.epochGrowth + plan.growth >= targetNeed && (
                    <p className="pv-close-epoch" data-testid="pv-close-epoch" role="status">
                      This play reaches this epoch's target — the epoch closes immediately (unused plays and discards are forfeited).
                    </p>
                  )}
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
                    <span className="growth-hero-chips" title="chips = rank sum of ALL selected cards (kickers included); base = round(chips × mult) — shown as the full honest equation">
                      {plan.chips} chips × {plan.mult} mult = {plan.pokerBase} base
                    </span>
                    <span className="growth-hero-breakdown" title="ordered breakdown: poker → laws → regions (regional bonuses are added once, after laws)">
                      {fmtPart(plan.growthParts.poker)} poker · {fmtPart(plan.growthParts.laws)} laws · {fmtPart(plan.growthParts.regions)} regions
                    </span>
                  </div>
                ) : (
                  <div className="growth-hero muted" data-testid="growth-hero">
                    <span className="growth-hero-label">Growth</span>
                    <span className="growth-hero-num">—</span>
                    <span className="growth-hero-breakdown">select 1–5 cards to bank Growth toward this epoch's {targetNeed}</span>
                  </div>
                )}
                {plan?.valid && plan.growthParts.regions > 0 && (
                  <div className="region-match-banner" data-testid="region-match-banner" role="status">
                    Regional bonus active: {matchingRegions.map((r) => `${r.name} (${SPECIALIZATION_LABEL[r.specialization as Specialization]}) +${regionBonusOf(r)}`).join(', ')} — highlighted on the globe.
                  </div>
                )}
                {plan?.valid && plan.growthParts.regions === 0 && dormantMatching.length > 0 && (
                  <div className="region-match-banner muted-banner" data-testid="region-dormant-note" role="status">
                    {dormantMatching.map((r) => r.name).join(', ')} would boost this hand if awakened (Wake {dormantMatching.map((r) => r.name).join(' / Wake ')} in the market; dormant regions contribute 0).
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
 *  The legend makes every region selectable without rotating the globe, and
 *  now carries each region's poker specialization (badge + bonus) plus the
 *  preview-match highlight (which regions boost the current selection). */
function PlanetPanel({
  regions, focus, onFocus, previewSpec = null, matchingIds = [], previewActive = false,
}: {
  regions: Region[]
  focus: number | null
  onFocus: (id: number) => void
  previewSpec: Specialization | null
  matchingIds: number[]
  previewActive: boolean
}) {
  const focused = focus !== null ? regions[focus] : null
  const living = regions.filter((r) => !r.dormant)
  const totalDev = living.reduce((n, r) => n + r.development, 0)
  const devPotential = living.length * STABILITY_MAX
  return (
    <section className="panel planet" aria-label="Planet map">
      <h2>Planet — 12 regions</h2>
      <Planet3D regions={regions} focus={focus} onFocus={onFocus} previewSpec={previewSpec} matchingIds={matchingIds} previewActive={previewActive} />
      <p className="planet-growth" data-testid="planet-growth" aria-label="Planet growth — driven by living regions and their development">
        <span className="pg-frac">{totalDev}/{devPotential}</span>
        <span>development across {living.length} living regions — the planet grows with it</span>
      </p>
      <div className="region-legend" data-testid="region-legend" role="group" aria-label="All 12 regions — select one to inspect it on the globe">
        {regions.map((r) => {
          const isFocus = focus === r.id
          const specLabel = r.specialization ? SPECIALIZATION_LABEL[r.specialization] : null
          const isMatch = previewActive && matchingIds.includes(r.id)
          return (
            <button
              key={r.id}
              className={`region-btn ${isFocus ? 'sel' : ''} ${r.dormant ? 'dormant' : ''} ${isMatch ? 'spec-match' : ''}`}
              aria-pressed={isFocus}
              aria-label={`${r.name}, ${r.terrain}, ${r.dormant ? 'dormant' : `stability ${r.stability} of ${STABILITY_MAX}, development ${r.development}`}${specLabel ? `, ${specLabel} specialization: ${r.dormant ? 'dormant, contributes 0' : `+${regionBonusOf(r)} Growth on exact ${specLabel} hands`}` : ''}. Press to inspect; adjacency ${r.adjacency.map((a) => regions[a].name).join(', ')}.`}
              title={specLabel
                ? `${r.name} — ${TERRAIN_LABELS[r.terrain] ?? r.terrain}${r.dormant ? ' (dormant)' : ''} · ${specLabel} specialization · ${r.dormant ? 'dormant: contributes 0' : `active: +${regionBonusOf(r)} on exact ${specLabel} hands (development ${r.development}; +1 per ${DEV_STEP} up to +${DEV_BONUS_CAP})`}`
                : `${r.name} — ${TERRAIN_LABELS[r.terrain] ?? r.terrain}${r.dormant ? ' (dormant)' : `, stability ${r.stability}/${STABILITY_MAX}, development ${r.development}`}`}
              onClick={() => onFocus(r.id)}
            >
              <i className={`sw sw-${r.terrain}`} aria-hidden="true" />
              <span className="region-btn-name">{r.name}</span>
              {specLabel && <span className={`spec-badge ${r.dormant ? 'spec-badge-dormant' : ''}`} title={specializationSentence(r)}>{specLabel}</span>}
              {isMatch && <span className="spec-glow" aria-hidden="true" title="this region boosts the previewed hand" />}
              {isFocus && <span className="region-check" aria-hidden="true">✓</span>}
              {r.dormant && !isMatch && <span className="z" aria-hidden="true">z</span>}
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
          {focused.specialization && (
            <div className="map-detail-spec" data-testid="map-detail-spec">{specializationSentence(focused)}</div>
          )}
          <div className="muted">neighbors: {focused.adjacency.map((a) => regions[a].name).join(', ')}</div>
        </div>
      )}
    </section>
  )
}