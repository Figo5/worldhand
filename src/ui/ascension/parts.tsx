// Small presentational pieces shared by the Ascension screens. No game logic:
// every number comes from the engine.
import type { ReactNode } from 'react'
import { WORLD_STATS, WORLD_STAT_LABEL, SUIT_STAT, SUIT_SYMBOL, TERRAIN, REGION_NAMES, type WorldStat, type WorldStats } from '../../engine/ascension/world'
import { ARCHETYPES, TIER_LABEL, type Civilization, type CivPair } from '../../engine/ascension/civilizations'
import type { CrisisEvaluation, Factor } from '../../engine/ascension/crises'
import { CARD_BY_ID } from '../../engine/ascension/content'
import { LEGENDARIES } from '../../engine/ascension/legendaries'
import type { CardInst, LegendaryInst } from '../../engine/ascension/state'
import type { Region } from '../../engine/ascension/world'
import { LAND_CHIPS } from '../../engine/ascension/scoring'

export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
export const STAT_CLASS: Record<WorldStat, string> = { vitality: 'stat-v', prosperity: 'stat-p', industry: 'stat-i', knowledge: 'stat-k' }
export const STAT_COLOR: Record<WorldStat, string> = { vitality: 'var(--v)', prosperity: 'var(--p)', industry: 'var(--i)', knowledge: 'var(--k)' }
export const STAT_SYMBOL: Record<WorldStat, string> = { vitality: '♥', prosperity: '♦', industry: '♣', knowledge: '♠' }
export const rankLabel = (r: number) => (r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r))
export const cardText = (c: { r: number; s: CardInst['s'] }) => `${rankLabel(c.r)}${SUIT_SYMBOL[c.s]}`
export const cardAria = (c: CardInst) => {
  const def = c.kind ? CARD_BY_ID.get(c.kind) : undefined
  const names: Record<string, string> = { H: 'hearts', D: 'diamonds', C: 'clubs', S: 'spades' }
  return `${rankLabel(c.r)} of ${names[c.s]}, grows ${WORLD_STAT_LABEL[SUIT_STAT[c.s]]}${def ? `. ${def.name}: ${def.text}` : ''}${c.bonus ? `. Tempered +${c.bonus} chips` : ''}`
}

export function PlayingCard({ card, selected, scoring, kicker, onToggle, tabIndex }: {
  card: CardInst; selected: boolean; scoring: boolean; kicker: boolean; onToggle: () => void; tabIndex?: number
}) {
  const def = card.kind ? CARD_BY_ID.get(card.kind) : undefined
  const red = card.s === 'H' || card.s === 'D'
  const stat = SUIT_STAT[card.s]
  return (
    <button
      type="button"
      className={`pcard2 dealt ${red ? 'red' : 'blue'}${def ? ' world' : ''}${scoring ? ' scoring' : ''}${kicker ? ' kicker' : ''}`}
      aria-pressed={selected}
      aria-label={cardAria(card)}
      title={def ? `${def.name} — ${def.text}` : `${cardText(card)}: grows ${WORLD_STAT_LABEL[stat]}`}
      onClick={onToggle}
      tabIndex={tabIndex}
      data-testid="asc-card"
    >
      <span className="corner"><span className="rank">{rankLabel(card.r)}</span><i className="statdot" style={{ background: STAT_COLOR[stat] }} aria-hidden="true" /></span>
      <span className="suit" aria-hidden="true">{SUIT_SYMBOL[card.s]}</span>
      {def ? <span className="wc">{def.name}</span> : <span aria-hidden="true" />}
      {card.bonus ? <span className="temper">+{card.bonus}</span> : null}
    </button>
  )
}

export function StatBars({ stats, affinity, delta, max }: { stats: WorldStats; affinity?: WorldStats; delta?: WorldStats | null; max?: number }) {
  const top = Math.max(20, max ?? 0, ...WORLD_STATS.map((k) => stats[k] + (delta?.[k] ?? 0)))
  return (
    <div className="stats" data-testid="asc-stats">
      {WORLD_STATS.map((k) => {
        const d = delta?.[k] ?? 0
        return (
          <div className="statrow" key={k}>
            <span className={`label ${STAT_CLASS[k]}`}>{STAT_SYMBOL[k]} {WORLD_STAT_LABEL[k]}</span>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${(100 * stats[k]) / top}%`, background: STAT_COLOR[k] }} />
              {d > 0 && <i className="plus" style={{ left: `${(100 * stats[k]) / top}%`, width: `${(100 * d) / top}%`, background: STAT_COLOR[k] }} />}
            </span>
            <span className="val" data-testid={`asc-stat-${k}`}>{stats[k]}{d ? <small className="good"> +{d}</small> : null}</span>
            {affinity && <span className="land" style={{ gridColumn: '2 / 4' }}>{affinity[k] ? `${affinity[k]} region${affinity[k] === 1 ? '' : 's'} favour it: +${LAND_CHIPS * affinity[k]} chips per ${STAT_SYMBOL[k]} scored` : 'no land favours it'}</span>}
          </div>
        )
      })}
    </div>
  )
}

export function Pips({ n, of }: { n: number; of: number }) {
  return <span className="pips" role="img" aria-label={`Resolve ${n} of ${of}`}>{Array.from({ length: of }, (_, i) => <i key={i} className={`pip${i < n ? ' on' : ''}`} />)}</span>
}

export function Tug({ ev }: { ev: Pick<CrisisEvaluation, 'pressure' | 'resilience'> }) {
  const total = Math.max(1, ev.pressure + ev.resilience)
  return (
    <>
      <div className="tug" role="img" aria-label={`Resilience ${ev.resilience} against pressure ${ev.pressure}`}>
        <span className="res" style={{ width: `${(100 * ev.resilience) / total}%` }} />
        <span className="pres" style={{ width: `${(100 * ev.pressure) / total}%` }} />
      </div>
      <div className="tug-labels"><span>Resilience {ev.resilience}</span><span>Pressure {ev.pressure}</span></div>
    </>
  )
}

export function Verdict({ margin, compact }: { margin: number; compact?: boolean }) {
  const ok = margin >= 0
  return (
    <span className="verdict" data-testid="asc-verdict" data-margin={margin}>
      <span className={`big ${ok ? 'good' : 'bad'}`}>{signed(margin)}</span>
      {!compact && <span className={ok ? 'good' : 'bad'}>{ok ? 'would be endured' : 'would fail'}</span>}
    </span>
  )
}

function FactorList({ title, factors, cls }: { title: string; factors: Factor[]; cls: string }) {
  return (
    <div>
      <div className={`head ${cls}`}>{title}</div>
      <ul>
        {factors.map((f, i) => (
          <li key={i} className={f.amount === 0 ? 'zero' : ''} title={f.detail}>
            <span>{f.label}</span><span className={cls}>{f.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
export function Factors({ ev }: { ev: CrisisEvaluation }) {
  return (
    <div className="factors" data-testid="asc-factors">
      <FactorList title="Pressure" factors={ev.pressures} cls="bad" />
      <FactorList title="Resilience" factors={ev.mitigations} cls="good" />
    </div>
  )
}

export function LegendaryChip({ inst }: { inst: LegendaryInst }) {
  const d = LEGENDARIES[inst.id]
  const state = inst.id === 'eternalDragon' && inst.counter ? ` (devoured ${inst.counter})` : inst.id === 'sleepingGod' ? (inst.awake ? ' (awake)' : ' (asleep)') : ''
  return (
    <span className="legend" data-testid="asc-legendary" title={`${d.name}: ${d.text}`}>
      <b>{d.name}{state}</b>
      <span>{d.text}</span>
    </span>
  )
}

export function CivCard({ civ, regions, rel, all, fresh }: { civ: Civilization; regions: readonly Region[]; rel: readonly CivPair[]; all: readonly Civilization[]; fresh?: boolean }) {
  const d = ARCHETYPES[civ.archetype]
  const home = regions[civ.home]
  const mine = rel.filter((r) => r.a === civ.id || r.b === civ.id)
  const other = (r: CivPair) => all.find((c) => c.id === (r.a === civ.id ? r.b : r.a))
  return (
    <div className={`civ${fresh ? ' new' : ''}`} data-testid="asc-civ">
      <div className="civ-head">
        <span className="civ-name">{civ.name}</span>
        <span className="tier">{TIER_LABEL[civ.tier]}</span>
        <span className="muted">{d.label} · {REGION_NAMES[home.id]} ({TERRAIN[home.terrain].label})</span>
      </div>
      <span className="passive"><b>{d.passive.name}:</b> {d.passive.text(civ.tier)}</span>
      {mine.length > 0 && (
        <span className="rel">
          {mine.map((r, i) => <span key={i} className={r.relation === 'ally' ? 'good' : 'bad'}>{i ? ' · ' : ''}{r.relation === 'ally' ? 'Allied with ' : 'Rival of '}{other(r)?.name}</span>)}
        </span>
      )}
    </div>
  )
}

export function Panel({ title, children, className, right, testid }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode; testid?: string }) {
  return (
    <section className={`panel ${className ?? ''}`} data-testid={testid}>
      {(title || right) && <div className="row" style={{ marginBottom: 6 }}>{title && <h3 style={{ margin: 0 }}>{title}</h3>}<span className="spacer" />{right}</div>}
      {children}
    </section>
  )
}
