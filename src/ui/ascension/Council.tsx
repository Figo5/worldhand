// The Council between eras: the crisis's outcome, a free legendary (after
// some eras), the market, the deck, and the road ahead. Presentation only.
import { useMemo, useState } from 'react'
import { forecast, ownedCards, MIN_DECK } from '../../engine/ascension/ascension'
import { ERAS } from '../../engine/ascension/eras'
import { CRISES } from '../../engine/ascension/crises'
import { CARD_BY_ID, DECREE_BY_ID, type DecreeDef } from '../../engine/ascension/content'
import { LEGENDARIES } from '../../engine/ascension/legendaries'
import { ARCHETYPES, grownTier, TIER_LABEL } from '../../engine/ascension/civilizations'
import { rerollPrice, REMOVE_PRICE, SELL_REFUND } from '../../engine/ascension/council'
import { runMods } from '../../engine/ascension/rules'
import { landAffinity, REGION_NAMES, TERRAIN, SUIT_STAT, WORLD_STAT_LABEL } from '../../engine/ascension/world'
import { LEGENDARY_SLOTS, type AscensionAction, type AscensionState, type Offer } from '../../engine/ascension/state'
import type { Suit } from '../../engine/poker'
import { Panel, StatBars, fmt, signed, rankLabel, LegendaryChip, Pips } from './parts'
import { MAX_RESOLVE } from '../../engine/ascension/state'

const SUITS: { s: Suit; label: string }[] = [{ s: 'H', label: '♥ Hearts (Vitality)' }, { s: 'D', label: '♦ Diamonds (Prosperity)' }, { s: 'C', label: '♣ Clubs (Industry)' }, { s: 'S', label: '♠ Spades (Knowledge)' }]

export function CrisisResult({ state }: { state: AscensionState }) {
  const c = state.crises[state.crises.length - 1]
  if (!c) return null
  const ok = c.result === 'endured'
  return (
    <div className={`result-banner ${ok ? 'endured' : 'failed'}`} data-testid="asc-crisis-result" data-result={c.result}>
      <div className="eyebrow">{ERAS[c.era].label} crisis · {CRISES[c.crisis].label}</div>
      <div className={`word ${ok ? 'good' : 'bad'}`}>{c.prevented ? 'Turned aside' : ok ? (c.triumph ? 'Triumph' : 'Endured') : 'Failed'}</div>
      <div className="num">Resilience {c.resilience} against pressure {c.pressure} · margin <b className={c.margin >= 0 ? 'good' : 'bad'}>{signed(c.margin)}</b></div>
      {c.prevented && <p className="gold" style={{ margin: '6px 0 0' }}>The Sleeping God woke and turned the crisis aside.</p>}
      {c.scars.length > 0 && <p className="bad" style={{ margin: '6px 0 0' }}>Scars: {c.scars.join(' ')}</p>}
      <p className="muted" style={{ margin: '6px 0 0' }}>
        {c.influence > 0 ? <>+{c.influence} Influence{ok && c.handsLeft ? ` (${c.handsLeft} for unspent hands${c.triumph ? ', 3 for the triumph' : ''})` : ''}. </> : null}
        Resolve <Pips n={state.resolve} of={MAX_RESOLVE} />
      </p>
    </div>
  )
}

export default function Council({ state, onAct }: { state: AscensionState; onAct: (a: AscensionAction) => string | null }) {
  const [error, setError] = useState('')
  const [target, setTarget] = useState<{ offer: number; def: DecreeDef } | null>(null)
  const [replaceFor, setReplaceFor] = useState<number | null>(null)
  const [showDeck, setShowDeck] = useState(false)
  const c = state.council!
  const m = runMods(state)
  const next = state.era + 1
  const nextEra = ERAS[next]
  const nextCrisis = CRISES[state.crisisTrack[next]]
  const outlook = useMemo(() => forecast(state, next), [state, next])
  const deck = useMemo(() => ownedCards(state).sort((a, b) => 'HDCS'.indexOf(a.s) - 'HDCS'.indexOf(b.s) || b.r - a.r || a.id - b.id), [state])
  const growing = state.civilizations.filter((civ) => grownTier(civ, state.stats, next) > civ.tier)
  const act = (a: AscensionAction) => { const e = onAct(a); setError(e ?? ''); if (!e) { setTarget(null); setReplaceFor(null) } return e }
  const buy = (i: number, o: Offer) => {
    if (o.kind === 'decree') {
      const def = DECREE_BY_ID.get(o.id)!
      if (def.target !== 'none') { setTarget({ offer: i, def }); return }
    }
    act({ type: 'buy', offer: i })
  }
  const bySuit = (s: Suit) => deck.filter((x) => x.s === s).length

  return (
    <div className="council" data-testid="asc-council">
      <header className="topbar">
        <div className="era"><b>The Council</b><span>between {ERAS[state.era].label} and {nextEra.label}</span></div>
        <span className="spacer" />
        <span className="meter gold"><b data-testid="asc-influence">{state.influence}</b><span>influence</span></span>
        <span className="meter"><Pips n={state.resolve} of={MAX_RESOLVE} /><span>resolve</span></span>
        <span className="meter"><b>{fmt(state.score)}</b><span>score</span></span>
        <button className="gold-btn" data-testid="asc-leave" onClick={() => act({ type: 'leave' })}>Begin the {nextEra.label} age →</button>
      </header>
      <CrisisResult state={state} />
      {error && <p className="error" role="alert" data-testid="asc-error">{error}</p>}
      <div className="council-grid">
        <div className="col">
          {c.legendaryChoice && (
            <Panel title="A legendary answers the world — choose one (free)" testid="asc-legend-choice">
              <div className="legend-picks">
                {c.legendaryChoice.map((id, i) => {
                  const d = LEGENDARIES[id]
                  return (
                    <div key={id} className="legend-pick" data-testid="asc-legend-offer">
                      <h4>{d.name}</h4>
                      <p>{d.text}</p>
                      <p className="lore">{d.lore}</p>
                      {state.legendaries.length >= LEGENDARY_SLOTS && replaceFor === i ? (
                        <div className="row">{state.legendaries.map((l, j) => <button key={l.id} onClick={() => act({ type: 'legendary', pick: i, replace: j })}>Give up {LEGENDARIES[l.id].name}</button>)}</div>
                      ) : (
                        <button className="gold-btn" onClick={() => (state.legendaries.length >= LEGENDARY_SLOTS ? setReplaceFor(i) : act({ type: 'legendary', pick: i }))}>Take it</button>
                      )}
                    </div>
                  )
                })}
              </div>
              <button className="ghost" style={{ marginTop: 8 }} onClick={() => act({ type: 'legendary', pick: null })}>Take none</button>
            </Panel>
          )}
          <Panel title="The market" testid="asc-market" right={<button data-testid="asc-reroll" disabled={state.influence < rerollPrice(c, m)} onClick={() => act({ type: 'reroll' })}>Reroll ({rerollPrice(c, m)})</button>}>
            <div className="offers">
              {c.offers.map((o, i) => {
                const card = o.kind === 'card' ? CARD_BY_ID.get(o.id) : undefined
                const dec = o.kind === 'decree' ? DECREE_BY_ID.get(o.id) : undefined
                const leg = o.kind === 'legendary' ? LEGENDARIES[o.id as keyof typeof LEGENDARIES] : undefined
                const name = card?.name ?? dec?.name ?? leg?.name ?? o.id
                const text = card?.text ?? dec?.text ?? leg?.text ?? ''
                const rarity = card?.rarity ?? dec?.rarity ?? 'rare'
                return (
                  <div key={`${o.id}-${i}`} className={`offer${o.sold ? ' sold' : ''}${leg ? ' legendary' : ''}`} data-testid="asc-offer" data-kind={o.kind}>
                    <div className="kind"><span>{o.kind === 'card' ? 'World card' : o.kind === 'decree' ? 'Decree' : 'Legendary'}</span><span className={`rarity-${rarity}`}>{rarity}</span></div>
                    <h4>{name}</h4>
                    {card && <span><span className={`mini-card${card.suit === 'H' || card.suit === 'D' ? ' red' : ''}`}>{rankLabel(card.rank)}{({ H: '♥', D: '♦', C: '♣', S: '♠' })[card.suit]}</span> <span className="muted" style={{ fontSize: '0.72rem' }}>grows {WORLD_STAT_LABEL[SUIT_STAT[card.suit]]}</span></span>}
                    <p>{text}</p>
                    <div className="row">
                      <span className="price">{o.price} ◈</span>
                      <span className="spacer" />
                      <button disabled={o.sold || state.influence < o.price} onClick={() => buy(i, o)} data-testid="asc-buy">{o.sold ? 'Bought' : 'Buy'}</button>
                    </div>
                  </div>
                )
              })}
            </div>
            {target && (
              <div className="notice" style={{ marginTop: 10 }} data-testid="asc-target">
                <b>{target.def.name}:</b> {target.def.text} Choose {target.def.target === 'region' ? 'a region' : target.def.target === 'civ' ? 'a civilization' : 'a suit'}:
                <div className="picker" style={{ marginTop: 6 }}>
                  {target.def.target === 'region' && state.regions.map((r) => {
                    const from = target.def.ops.find((op) => op.op === 'terraform')
                    const ok = from && from.op === 'terraform' ? from.from.includes(r.terrain) : true
                    return <button key={r.id} disabled={!ok} onClick={() => act({ type: 'buy', offer: target.offer, target: r.id })}>{REGION_NAMES[r.id]} <span className="muted">({TERRAIN[r.terrain].label})</span></button>
                  })}
                  {target.def.target === 'civ' && state.civilizations.map((civ) => <button key={civ.id} disabled={civ.tier >= 3} onClick={() => act({ type: 'buy', offer: target.offer, target: civ.id })}>{civ.name} <span className="muted">({TIER_LABEL[civ.tier]})</span></button>)}
                  {target.def.target === 'suit' && SUITS.map((x) => <button key={x.s} onClick={() => act({ type: 'buy', offer: target.offer, target: x.s })}>{x.label}</button>)}
                </div>
                <button className="ghost" onClick={() => setTarget(null)} style={{ marginTop: 6 }}>Cancel</button>
              </div>
            )}
          </Panel>
          <Panel title={`Your deck (${deck.length} cards)`} testid="asc-deck" right={<button onClick={() => setShowDeck(!showDeck)} aria-expanded={showDeck}>{showDeck ? 'Hide' : 'Show and thin'}</button>}>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>♥ {bySuit('H')} · ♦ {bySuit('D')} · ♣ {bySuit('C')} · ♠ {bySuit('S')} · world cards {deck.filter((x) => x.kind).length}. Removing a card costs {REMOVE_PRICE} Influence (never below {MIN_DECK} cards): a thinner deck draws what you want more often.</p>
            {showDeck && (
              <div className="deck-view" style={{ marginTop: 8 }}>
                {deck.map((x) => (
                  <span key={x.id} className={`deck-card${x.s === 'H' || x.s === 'D' ? ' red' : ''}${x.kind ? ' world' : ''}`} title={x.kind ? `${CARD_BY_ID.get(x.kind)?.name}: ${CARD_BY_ID.get(x.kind)?.text}` : undefined}>
                    {rankLabel(x.r)}{({ H: '♥', D: '♦', C: '♣', S: '♠' })[x.s]}{x.bonus ? `+${x.bonus}` : ''}
                    <button aria-label={`Remove ${rankLabel(x.r)} ${x.s}`} disabled={state.influence < REMOVE_PRICE || deck.length <= MIN_DECK} onClick={() => act({ type: 'remove', card: x.id })}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="col">
          <Panel title={`Next: the ${nextEra.label} age`} testid="asc-next-era">
            <p style={{ margin: '0 0 6px', fontSize: '0.84rem' }}><b className="gold">{nextEra.ruleName}.</b> {nextEra.ruleText}</p>
            <p style={{ margin: '0 0 6px', fontSize: '0.84rem' }}>{nextEra.hands + m.handsBonus + state.next.hands} hands, {nextEra.discards + m.discardsBonus + state.next.discards} discards. It ends in <b>{nextCrisis.label}</b>: {nextCrisis.watch}</p>
            <p style={{ margin: 0, fontSize: '0.84rem' }}>As your world stands now, it would be <b className={outlook.margin >= 0 ? 'good' : 'bad'}>{signed(outlook.margin)}</b> — before that era’s plays and Reserves.</p>
            {growing.length > 0 && <p className="gold" style={{ margin: '6px 0 0', fontSize: '0.82rem' }}>At the dawn: {growing.map((g) => `${g.name} grows into ${TIER_LABEL[g.tier + 1] === 'Empire' ? 'an' : 'a'} ${TIER_LABEL[g.tier + 1]}`).join('; ')}.</p>}
            {(state.next.hands > 0 || state.next.reserves > 0 || state.next.treaty) && <p className="good" style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>Decreed for next era: {[state.next.hands && `+${state.next.hands} hands`, state.next.reserves && `+${state.next.reserves} Reserves`, state.next.treaty && 'a peace treaty'].filter(Boolean).join(', ')}.</p>}
          </Panel>
          <Panel title="The world">
            <StatBars stats={state.stats} affinity={landAffinity(state.regions)} />
            <div className="civs" style={{ marginTop: 8 }}>
              {state.civilizations.map((civ) => <div key={civ.id} className="civ"><span className="civ-head"><span className="civ-name">{civ.name}</span><span className="tier">{TIER_LABEL[civ.tier]}</span><span className="muted">{ARCHETYPES[civ.archetype].label}</span></span></div>)}
            </div>
          </Panel>
          <Panel title={`Legendaries (${state.legendaries.length}/${LEGENDARY_SLOTS})`}>
            <div className="legend-strip">
              {state.legendaries.map((l, j) => (
                <span key={l.id} style={{ display: 'grid', gap: 4 }}>
                  <LegendaryChip inst={l} />
                  <button className="ghost" onClick={() => act({ type: 'sell', slot: j })}>Give up (+{SELL_REFUND})</button>
                </span>
              ))}
              {state.legendaries.length === 0 && <span className="muted" style={{ fontSize: '0.8rem' }}>None yet.</span>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
