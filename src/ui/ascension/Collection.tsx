// The encyclopedia: every world card, decree, legendary, people, crisis, era
// and Omen — unlocked ones in full, locked ones with how to earn them.
import { useState } from 'react'
import { WORLD_CARDS, DECREES, CARD_BY_ID, DECREE_BY_ID } from '../../engine/ascension/content'
import { LEGENDARIES, LEGENDARY_ORDER } from '../../engine/ascension/legendaries'
import { ARCHETYPES, ARCHETYPE_ORDER, RELATION_TEXT, TIER_GROWTH, EMERGENCE_STEP } from '../../engine/ascension/civilizations'
import { CRISES, CRISIS_ORDER } from '../../engine/ascension/crises'
import { ERAS } from '../../engine/ascension/eras'
import { OMENS } from '../../engine/ascension/rules'
import { ORIGINS, ORIGIN_ORDER, SUIT_STAT, WORLD_STAT_LABEL, TERRAIN } from '../../engine/ascension/world'
import { ACHIEVEMENTS, type Profile } from '../../engine/ascension/profile'
import { Panel, rankLabel } from './parts'

type Tab = 'cards' | 'decrees' | 'legendaries' | 'peoples' | 'crises' | 'eras' | 'origins' | 'omens' | 'achievements'
const TABS: { id: Tab; label: string }[] = [
  { id: 'cards', label: 'World cards' }, { id: 'decrees', label: 'Decrees' }, { id: 'legendaries', label: 'Legendaries' }, { id: 'peoples', label: 'Peoples' },
  { id: 'crises', label: 'Crises' }, { id: 'eras', label: 'Eras' }, { id: 'origins', label: 'Origins' }, { id: 'omens', label: 'Omens' }, { id: 'achievements', label: 'Achievements' },
]
const unlockedBy = (kind: 'cards' | 'decrees' | 'legendaries' | 'archetypes' | 'origins', id: string) =>
  ACHIEVEMENTS.find((a) => (a.unlocks[kind] as string[] | undefined)?.includes(id))

export default function Collection({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('cards')
  const lockNote = (kind: Parameters<typeof unlockedBy>[0], id: string) => { const a = unlockedBy(kind, id); return a ? `Locked — earn “${a.name}”: ${a.text}` : 'Locked' }
  const count = (xs: readonly string[], have: readonly string[]) => `${xs.filter((x) => have.includes(x)).length}/${xs.length}`
  return (
    <div className="hub" data-testid="asc-collection">
      <div className="hub-head"><h1>Encyclopedia</h1><span className="sub">Ascension</span><span className="spacer" /><button onClick={onBack} data-testid="asc-back">Back</button></div>
      <div className="coll-tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-pressed={tab === t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'cards' && (
        <Panel title={`World cards — ${count(WORLD_CARDS.map((c) => c.id), profile.unlocked.cards)} unlocked`}>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>Playing cards with an effect, bought at the Council and shuffled into your deck. They take part in poker hands like any card; their effect triggers when they score (or when held or discarded, if they say so).</p>
          <div className="coll-grid">
            {WORLD_CARDS.map((c) => {
              const open = profile.unlocked.cards.includes(c.id)
              return (
                <div key={c.id} className={`entry${open ? '' : ' locked'}`} data-testid="asc-entry">
                  <h4>{c.name} <span className="tag">{rankLabel(c.rank)}{({ H: '♥', D: '♦', C: '♣', S: '♠' })[c.suit]}</span></h4>
                  <span className={`rarity-${c.rarity}`} style={{ fontSize: '0.7rem' }}>{c.rarity} · grows {WORLD_STAT_LABEL[SUIT_STAT[c.suit]]} · from {ERAS[Math.min(c.era, 5)].label}</span>
                  <span>{c.text}</span>
                  <span className="row">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>
                  {!open && <span className="muted">{lockNote('cards', c.id)}</span>}
                </div>
              )
            })}
          </div>
        </Panel>
      )}
      {tab === 'decrees' && (
        <Panel title={`Decrees — ${count(DECREES.map((d) => d.id), profile.unlocked.decrees)} unlocked`}>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>One-off acts bought at the Council: reshape the land, raise a people, move stats, bank Reserves.</p>
          <div className="coll-grid">
            {DECREES.map((d) => {
              const open = profile.unlocked.decrees.includes(d.id)
              return <div key={d.id} className={`entry${open ? '' : ' locked'}`}><h4>{d.name}</h4><span className={`rarity-${d.rarity}`} style={{ fontSize: '0.7rem' }}>{d.rarity} · {d.price} Influence</span><span>{d.text}</span>{!open && <span className="muted">{lockNote('decrees', d.id)}</span>}</div>
            })}
          </div>
        </Panel>
      )}
      {tab === 'legendaries' && (
        <Panel title={`Legendaries — ${count([...LEGENDARY_ORDER], profile.unlocked.legendaries)} unlocked`}>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>World-defining relics that change a rule. You hold at most four. One is offered free after the Tribal, Medieval and Information crises; one is for sale after the Ancient and Industrial ones.</p>
          <div className="coll-grid">
            {LEGENDARY_ORDER.map((id) => {
              const d = LEGENDARIES[id], open = profile.unlocked.legendaries.includes(id)
              return <div key={id} className={`entry${open ? '' : ' locked'}`}><h4>{d.name}</h4><span>{d.text}</span><span className="muted" style={{ fontStyle: 'italic' }}>{d.lore}</span>{!open && <span className="muted">{lockNote('legendaries', id)}</span>}</div>
            })}
          </div>
        </Panel>
      )}
      {tab === 'peoples' && (
        <Panel title="Peoples">
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>
            After a play, a people rises when the stat it needs reaches its threshold ({EMERGENCE_STEP} for the first civilization, {EMERGENCE_STEP * 2} for the second, and so on) and it has free land of its kind. At the dawn of an era a civilization grows into a Kingdom (needs {TIER_GROWTH[0].readiness}, from the {ERAS[TIER_GROWTH[0].fromEra].label} age) and then an Empire (needs {TIER_GROWTH[1].readiness}, from the {ERAS[TIER_GROWTH[1].fromEra].label} age). Tiers scale its gifts. Neighbours become allies or rivals. {RELATION_TEXT.ally} {RELATION_TEXT.rival}
          </p>
          <div className="coll-grid">
            {ARCHETYPE_ORDER.map((a) => {
              const d = ARCHETYPES[a], open = profile.unlocked.archetypes.includes(a)
              return (
                <div key={a} className={`entry${open ? '' : ' locked'}`}>
                  <h4>{d.label}</h4>
                  <span className="muted">Needs {d.stats.map((s) => WORLD_STAT_LABEL[s]).join(' and ')} · lives on {d.terrains.map((t) => TERRAIN[t].label.toLowerCase()).join(', ')}</span>
                  <span><b>{d.passive.name}:</b> {d.passive.text(1)} (Kingdom: {d.passive.text(2).replace(/^.*?(\+|×)/, '$1')})</span>
                  <span className="muted" style={{ fontStyle: 'italic' }}>{d.lore}</span>
                  {!open && <span className="muted">{lockNote('archetypes', a)}</span>}
                </div>
              )
            })}
          </div>
        </Panel>
      )}
      {tab === 'crises' && (
        <Panel title={`Crises — ${count([...CRISIS_ORDER], profile.seen.crises)} met`}>
          <div className="coll-grid">
            {CRISIS_ORDER.map((id) => {
              const c = CRISES[id], era = ERAS.findIndex((e) => e.pool.includes(id))
              return <div key={id} className="entry"><h4>{c.label}</h4><span className="muted">{ERAS[era].label} age · {c.kind}{c.conflict ? ' · rivalries add pressure' : ''}</span><span>{c.watch}</span><span className="bad">If failed: {c.scarText}</span></div>
            })}
          </div>
        </Panel>
      )}
      {tab === 'eras' && (
        <Panel title="The six ages">
          <div className="coll-grid">
            {ERAS.map((e, i) => <div key={e.id} className="entry"><h4>{i + 1}. {e.label}</h4><span>{e.hands} hands · {e.discards} discards · 1 Reserve per {e.reserveRate} score</span><span><b className="gold">{e.ruleName}.</b> {e.ruleText}</span><span className="muted">Ends in: {e.pool.map((c) => CRISES[c].label).join(' or ')}</span><span className="muted" style={{ fontStyle: 'italic' }}>{e.theme}</span></div>)}
          </div>
        </Panel>
      )}
      {tab === 'origins' && (
        <Panel title="Origins">
          <div className="coll-grid">
            {ORIGIN_ORDER.map((o) => { const open = profile.unlocked.origins.includes(o); return <div key={o} className={`entry${open ? '' : ' locked'}`}><h4>{ORIGINS[o].label}</h4><span>{ORIGINS[o].text}</span>{!open && <span className="muted">{lockNote('origins', o)}</span>}</div> })}
          </div>
        </Panel>
      )}
      {tab === 'omens' && (
        <Panel title={`Omens — the difficulty ladder (unlocked up to ${profile.maxOmen})`}>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.84rem' }}>Omens stack: Omen 3 plays under Omens 1, 2 and 3. Ascend at your highest Omen to unlock the next.</p>
          <div className="coll-grid">
            {OMENS.map((o) => <div key={o.level} className={`entry${o.level <= profile.maxOmen ? '' : ' locked'}`}><h4>Omen {o.level}: {o.name}</h4><span>{o.text}</span></div>)}
          </div>
        </Panel>
      )}
      {tab === 'achievements' && (
        <Panel title={`Achievements — ${profile.achievements.length}/${ACHIEVEMENTS.length}`}>
          <div className="coll-grid">
            {ACHIEVEMENTS.map((a) => {
              const got = profile.achievements.includes(a.id)
              const what = [...(a.unlocks.cards ?? []).map((c) => CARD_BY_ID.get(c)?.name ?? c), ...(a.unlocks.decrees ?? []).map((d) => DECREE_BY_ID.get(d)?.name ?? d), ...(a.unlocks.legendaries ?? []).map((l) => LEGENDARIES[l].name), ...(a.unlocks.archetypes ?? []).map((x) => ARCHETYPES[x].label), ...(a.unlocks.origins ?? []).map((o) => ORIGINS[o].label)]
              return <div key={a.id} className={`entry${got ? '' : ' locked'}`} data-testid="asc-achievement" data-earned={got}><h4>{got ? '★ ' : ''}{a.name}</h4><span>{a.text}</span><span className="muted">Unlocks: {what.join(', ')}</span></div>
            })}
          </div>
        </Panel>
      )}
    </div>
  )
}
