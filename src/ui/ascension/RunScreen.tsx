// The in-era table: the hand and its preview, the world, and the crisis.
// Presentation only — every number comes from the engine, and every preview
// is the engine's own transition applied to a copy (one calculation path).
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { applyAction, forecast, eraEndInfluence, treasury, runStatus, HAND_INFLUENCE, HAND_CARRY, TRIUMPH_BONUS } from '../../engine/ascension/ascension'
import { evaluatePlay, evaluateDiscard, type Line, type PlayResult } from '../../engine/ascension/scoring'
import { ERAS, FINAL_ERA } from '../../engine/ascension/eras'
import { CRISES } from '../../engine/ascension/crises'
import { CARD_BY_ID } from '../../engine/ascension/content'
import { relations } from '../../engine/ascension/civilizations'
import { borders, runMods } from '../../engine/ascension/rules'
import { landAffinity, WORLD_STATS, WORLD_STAT_LABEL, TERRAIN, REGION_NAMES, type Terrain, type WorldStats } from '../../engine/ascension/world'
import { MAX_RESOLVE, LEGENDARY_SLOTS, type AscensionAction, type AscensionState } from '../../engine/ascension/state'
import { CivCard, Factors, LegendaryChip, Panel, Pips, PlayingCard, StatBars, Tug, Verdict, fmt, signed, STAT_CLASS, STAT_SYMBOL } from './parts'
import type { Settings } from './storage'

const Globe = lazy(() => import('./Globe'))

/** Terrains the current crisis punishes and rewards (for highlighting the map). */
export function crisisTerrains(state: AscensionState): { hit: Terrain[]; help: Terrain[] } {
  const c = CRISES[state.crisisTrack[state.era]]
  const pick = (fs: typeof c.pressures) => fs.flatMap((f) => (f.kind === 'terrain' ? [...f.terrains] : []))
  return { hit: pick(c.pressures), help: pick(c.mitigations) }
}

function lineText(l: Line): string {
  const bits: string[] = []
  if (l.chips) bits.push(`+${l.chips} chips`)
  if (l.mult) bits.push(`+${l.mult} mult`)
  if (l.xmult && l.xmult !== 1) bits.push(`×${l.xmult} mult`)
  if (l.stat) for (const k of WORLD_STATS) if (l.stat[k]) bits.push(`${signed(l.stat[k]!)} ${WORLD_STAT_LABEL[k]}`)
  if (l.influence) bits.push(`+${l.influence} Influence`)
  if (l.reserves) bits.push(`+${l.reserves} Reserves`)
  if (l.pressure) bits.push(`+${l.pressure} crisis pressure`)
  return bits.join(', ')
}

export default function RunScreen({ state, onAct, settings, onMenu, onChronicle, onHelp }: {
  state: AscensionState
  onAct: (a: AscensionAction) => string | null
  settings: Settings
  onMenu: () => void
  onChronicle: () => void
  onHelp: () => void
}) {
  const [sel, setSel] = useState<number[]>([])
  const [confirmFace, setConfirmFace] = useState(false)
  const [focusRegion, setFocusRegion] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'world' | 'civs' | 'regions'>('world')
  const [tipsHidden, setTipsHidden] = useState(false)
  const [sortBy, setSortBy] = useState<'deal' | 'rank' | 'suit'>('deal')
  const handRef = useRef<HTMLDivElement>(null)
  const status = runStatus(state)
  const canPlay = status === 'playing'
  // selections refer to hand positions: clear them whenever the hand changes
  const handKey = state.hand.map((c) => c.id).join(',')
  useEffect(() => { setSel([]); setConfirmFace(false) }, [handKey, state.era])

  const m = useMemo(() => runMods(state), [state])
  const affinity = useMemo(() => landAffinity(state.regions), [state.regions])
  const rel = useMemo(() => relations(state.civilizations, borders(state.regions, m)), [state.civilizations, state.regions, m])
  const now = useMemo(() => forecast(state), [state])
  const era = ERAS[state.era]
  const crisis = CRISES[state.crisisTrack[state.era]]
  const terr = useMemo(() => crisisTerrains(state), [state])

  // the preview: the engine's own evaluation, and its own transition on a copy
  const preview = useMemo(() => {
    if (!canPlay || sel.length === 0) return null
    try {
      const r: PlayResult = evaluatePlay(state, sel)
      const after = applyAction(state, { type: 'play', cards: sel })
      const newCiv = after.civilizations.find((c) => !state.civilizations.some((x) => x.id === c.id)) ?? null
      return { r, after, afterEv: forecast(after), newCiv }
    } catch { return null }
  }, [state, sel, canPlay])
  const discardPreview = useMemo(() => {
    if (!canPlay || sel.length === 0 || state.discardsLeft <= 0) return null
    try { return evaluateDiscard(state, sel) } catch { return null }
  }, [state, sel, canPlay])

  const act = (a: AscensionAction) => {
    const err = onAct(a)
    setError(err ?? '')
    if (!err) { setSel([]); setConfirmFace(false) }
  }
  const toggle = (i: number) => {
    if (!canPlay) return
    if (sel.includes(i)) setSel(sel.filter((x) => x !== i))
    else if (sel.length >= 5) setError('Select at most 5 cards.')
    else { setSel([...sel, i]); setError('') }
  }
  const onHandKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.pcard2'))
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = ((idx < 0 ? 0 : idx + (e.key === 'ArrowRight' ? 1 : -1)) + buttons.length) % buttons.length
      buttons[next]?.focus()
      e.preventDefault()
    }
  }
  // table shortcuts: P play, D discard, Escape clear (not while typing)
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') setSel([])
      if (canPlay && /^[1-8]$/.test(e.key) && order[Number(e.key) - 1] !== undefined) { e.preventDefault(); toggle(order[Number(e.key) - 1]) }
      if (!canPlay || sel.length === 0) return
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); act({ type: 'play', cards: sel }) }
      if ((e.key === 'd' || e.key === 'D') && state.discardsLeft > 0) { e.preventDefault(); act({ type: 'discard', cards: sel }) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  /** display order of the hand (selection always refers to real hand positions) */
  const order = state.hand.map((_, i) => i)
  if (sortBy === 'rank') order.sort((a, b) => state.hand[b].r - state.hand[a].r || 'SHDC'.indexOf(state.hand[a].s) - 'SHDC'.indexOf(state.hand[b].s))
  if (sortBy === 'suit') order.sort((a, b) => 'HDCS'.indexOf(state.hand[a].s) - 'HDCS'.indexOf(state.hand[b].s) || state.hand[b].r - state.hand[a].r)
  const scoringIds = new Set(preview ? preview.r.scoring.map((i) => state.hand[i]?.id) : [])
  const bank = eraEndInfluence(state, m) + treasury(state)
  const statsDelta: WorldStats | null = preview ? preview.r.statDeltas : null
  const failing = now.margin < 0
  const handsTotal = ERAS[state.era].hands + m.handsBonus
  const ahead = state.crisisTrack.map((id, e) => ({ id, e })).filter(({ e }) => e > state.era)

  const crisisPanel = (
    <section className={`crisis-card${failing ? '' : ' safe'}`} data-testid="asc-crisis" aria-live="polite">
      <div className="row">
        <span className="eyebrow">{era.label} crisis · {crisis.kind}</span>
        <span className="spacer" />
        <span className="pill" title="Crises are exact: this is what facing it now would do.">forecast</span>
      </div>
      <h2>{crisis.label}</h2>
      <p className="theme">{crisis.theme}</p>
      <p className="watch">{crisis.watch}</p>
      <div className="row">
        <span className="muted" style={{ fontSize: '0.78rem' }}>Faced now:</span>
        <Verdict margin={now.margin} />
        {preview && <span className="pill" data-testid="asc-verdict-after">after this play: <b className={preview.afterEv.margin >= 0 ? 'good' : 'bad'}>{signed(preview.afterEv.margin)}</b> ({signed(preview.afterEv.margin - now.margin)})</span>}
      </div>
      <Tug ev={now} />
      <Factors ev={now} />
      <p className="muted" style={{ fontSize: '0.76rem', margin: 0 }}>
        <b className="bad">If it fails:</b> −1 Resolve ({state.resolve - 1} left{state.resolve - 1 <= 0 ? ': the world falls' : ''}) and {crisis.scarText.charAt(0).toLowerCase() + crisis.scarText.slice(1)}
        {state.era === FINAL_ERA ? ' This is the final crisis: it must be endured to ascend.' : ''}
      </p>
      {!confirmFace ? (
        <button className="crisis-btn" data-testid="asc-face" onClick={() => (failing || state.handsLeft > 0 ? setConfirmFace(true) : act({ type: 'face' }))}>
          {status === 'crisis' ? `Face the ${crisis.label}` : `Face it now (${state.handsLeft} hand${state.handsLeft === 1 ? '' : 's'} left)`}
        </button>
      ) : (
        <div className="notice" role="alertdialog" aria-label="Confirm facing the crisis">
          {failing
            ? <>You would <b className="bad">fail by {-now.margin}</b>: lose 1 Resolve and take the scar.</>
            : <>You would <b className="good">endure it by {now.margin}</b>{state.era < FINAL_ERA ? <> and gain about <b className="gold">{bank + (now.margin >= Math.ceil(now.pressure / 4) ? TRIUMPH_BONUS : 0)} Influence</b> ({HAND_INFLUENCE * state.handsLeft} for unspent hands)</> : null}.</>}
          {state.handsLeft > 0 && (state.era < FINAL_ERA && !failing ? ` Up to ${HAND_CARRY} unspent hands carry into the next era; the rest are gone.` : ' Unplayed hands are gone once you face it.')}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="crisis-btn" data-testid="asc-face-confirm" onClick={() => act({ type: 'face' })}>Face it</button>
            <button onClick={() => setConfirmFace(false)}>Not yet</button>
          </div>
        </div>
      )}
    </section>
  )

  const trackPanel = (
    <Panel title="The crises ahead" testid="asc-track">
      <div className="track">
        {state.crisisTrack.map((id, e) => {
          const past = state.crises.find((c) => c.era === e)
          return (
            <div key={e} className={`track-step${e === state.era ? ' now' : ''}${past ? (past.result === 'endured' ? ' won' : ' lost') : ''}`} title={`${ERAS[e].label}: ${CRISES[id].label} — ${CRISES[id].watch}`}>
              <span className="muted">{ERAS[e].label}</span>
              <b className="track-name">{CRISES[id].label.replace(/^The /, '')}</b>
              <span className={`m ${past ? (past.result === 'endured' ? 'good' : 'bad') : ''}`}>{past ? (past.result === 'endured' ? `✓ ${signed(past.margin)}` : `✗ ${signed(past.margin)}`) : e === state.era ? 'now' : '·'}</span>
            </div>
          )
        })}
      </div>
      <div className="ahead" style={{ marginTop: 8 }}>
        {ahead.slice(0, 2).map(({ id, e }) => {
          const out = forecast(state, e)
          return (
            <div className="ahead-item" key={e} data-testid="asc-ahead">
              <b>{ERAS[e].label}: {CRISES[id].label}</b> — as your world stands now: <b className={out.margin >= 0 ? 'good' : 'bad'}>{signed(out.margin)}</b> (before that era's Reserves)
              <div className="muted">{CRISES[id].watch}</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )

  const worldPanel = (
    <Panel title="The world" testid="asc-world" right={<span className="muted" style={{ fontSize: '0.72rem' }}>{state.civilizations.length} civilization{state.civilizations.length === 1 ? '' : 's'}</span>}>
      <div className="tabs" role="tablist" aria-label="World views">
        {(['world', 'civs', 'regions'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'world' ? 'Globe' : t === 'civs' ? 'Civilizations' : 'Regions'}</button>
        ))}
      </div>
      {tab === 'world' && (
        <>
          <div className="globe-box" style={{ marginTop: 8 }}>
            <Suspense fallback={<div className="globe-fallback">Loading the globe…</div>}>
              <Globe regions={state.regions} civs={state.civilizations} relations={rel} focus={focusRegion} onFocus={setFocusRegion} hit={terr.hit} help={terr.help} development={state.stats} crisisFailing={failing} reduced={settings.motion === 'reduced'} />
            </Suspense>
            <span className="globe-note">Red: land the {crisis.label.toLowerCase()} strikes · Green: land that shelters</span>
          </div>
          {focusRegion !== null && (
            <p className="muted" style={{ fontSize: '0.78rem', margin: '6px 0 0' }} data-testid="asc-region-detail">
              <b>{REGION_NAMES[focusRegion]}</b> — {TERRAIN[state.regions[focusRegion].terrain].label}: {TERRAIN[state.regions[focusRegion].terrain].blurb}
              {state.civilizations.find((c) => c.home === focusRegion) ? ` Home of ${state.civilizations.find((c) => c.home === focusRegion)!.name}.` : ''}
            </p>
          )}
        </>
      )}
      {tab === 'civs' && (
        <div className="civs" style={{ marginTop: 8 }}>
          {state.civilizations.length === 0 && <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>No civilization yet. Peoples arise after a play once a stat reaches their threshold (the first at 5) and they have free land of their kind.</p>}
          {state.civilizations.map((c) => <CivCard key={c.id} civ={c} regions={state.regions} rel={rel} all={state.civilizations} fresh={preview?.newCiv?.id === c.id} />)}
          {state.fallen.length > 0 && <p className="muted" style={{ fontSize: '0.74rem', margin: 0 }}>Fallen: {state.fallen.map((f) => f.name).join(', ')}</p>}
        </div>
      )}
      {tab === 'regions' && (
        <div className="regions" style={{ marginTop: 8 }} role="list">
          {state.regions.map((r) => {
            const civ = state.civilizations.find((c) => c.home === r.id)
            const cls = terr.hit.includes(r.terrain) ? ' hit' : terr.help.includes(r.terrain) ? ' help' : ''
            return (
              <button role="listitem" key={r.id} className={`region${cls}`} aria-pressed={focusRegion === r.id} onClick={() => setFocusRegion(r.id)}
                aria-label={`${REGION_NAMES[r.id]}, ${TERRAIN[r.terrain].label}${civ ? `, home of ${civ.name}` : ''}${cls === ' hit' ? ', worsens this crisis' : cls === ' help' ? ', shelters against this crisis' : ''}`}>
                <b>{REGION_NAMES[r.id]}</b>
                <span className="t">{TERRAIN[r.terrain].label}{civ ? ` · ${civ.name}` : ''}</span>
              </button>
            )
          })}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <StatBars stats={state.stats} affinity={affinity} delta={statsDelta} />
      </div>
    </Panel>
  )

  const previewPanel = (
    <div className="preview" data-testid="asc-preview" aria-live="polite">
      {preview ? (
        <>
          <div className="headline">
            <span className="hand-name" data-testid="asc-preview-hand">{preview.r.label}</span>
            <span className="formula"><b className="chips">{fmt(preview.r.chips)}</b> chips × <b className="mult">{preview.r.mult}</b>{preview.r.xmult !== 1 ? ` × ${+preview.r.xmult.toFixed(2)}` : ''} mult</span>
            <span className="score" data-testid="asc-preview-score">{fmt(preview.r.score)}</span>
          </div>
          <div className="gains">
            {WORLD_STATS.filter((k) => preview.r.statDeltas[k]).map((k) => <span key={k} className={`gain ${STAT_CLASS[k]}`}>{STAT_SYMBOL[k]} {signed(preview.r.statDeltas[k])} {WORLD_STAT_LABEL[k]}</span>)}
            {preview.r.influence > 0 && <span className="gain gold">+{preview.r.influence} Influence</span>}
            {preview.r.reserves > 0 && <span className="gain good">+{preview.r.reserves} Reserves</span>}
            {preview.r.pressure > 0 && <span className="gain bad">+{preview.r.pressure} crisis pressure</span>}
            {preview.r.scoring.length < sel.length && <span className="gain muted">{sel.length - preview.r.scoring.length} card{sel.length - preview.r.scoring.length === 1 ? '' : 's'} won’t score</span>}
          </div>
          {preview.newCiv && <p className="gold" style={{ margin: 0, fontSize: '0.84rem' }} data-testid="asc-preview-civ">This play raises a civilization: <b>{preview.newCiv.name}</b> in {REGION_NAMES[preview.newCiv.home]}.</p>}
          <details>
            <summary className="muted" style={{ fontSize: '0.76rem', cursor: 'pointer' }}>How this scores</summary>
            <ul className="lines">{preview.r.lines.map((l, i) => <li key={i}><span><b>{l.label}</b> {l.detail}</span><span>{lineText(l)}</span></li>)}</ul>
          </details>
          {sel.some((i) => state.hand[i]?.kind) && (
            <div className="selected-cards">{sel.flatMap((i) => { const d = state.hand[i]?.kind ? CARD_BY_ID.get(state.hand[i].kind!) : undefined; return d ? [<span key={i}><b>{d.name}</b>: {d.text}</span>] : [] })}</div>
          )}
          {discardPreview && discardPreview.lines.length > 0 && <p className="muted" style={{ margin: 0, fontSize: '0.76rem' }}>Discarding these instead: {discardPreview.lines.map((l) => `${l.label} (${lineText(l)})`).join('; ')}</p>}
        </>
      ) : (
        <p className="empty">{canPlay ? 'Select 1–5 cards. Only the cards that make the poker hand score, and each scoring card grows its suit’s stat: ♥ Vitality, ♦ Prosperity, ♣ Industry, ♠ Knowledge.' : 'The hands have run out: face the crisis.'}</p>
      )}
    </div>
  )

  return (
    <div className="run">
      <header className="topbar" data-testid="asc-topbar">
        <div className="era"><b>{era.label}</b><span>Era {state.era + 1} of {ERAS.length}</span></div>
        <span className="rule" title={era.ruleText}>{era.ruleName}: {era.ruleText}</span>
        <span className="spacer" />
        <span className={`meter${state.handsLeft <= 1 ? ' low' : ''}`} title="Plays left this era"><b data-testid="asc-hands">{state.handsLeft}</b><span>hands /{handsTotal}</span></span>
        <span className="meter" title="Discards left this era"><b data-testid="asc-discards">{state.discardsLeft}</b><span>discards</span></span>
        <span className="meter" title="Each failed crisis costs one Resolve. At 0 the world falls."><Pips n={state.resolve} of={Math.max(MAX_RESOLVE, state.resolve)} /><span>resolve</span></span>
        <span className="meter gold" title="Influence: spent at the Council between eras"><b data-testid="asc-influence">{state.influence}</b><span>influence</span></span>
        <span className="meter" title="Total score. This era's score becomes Reserves against its crisis."><b data-testid="asc-score" key={state.score} className={state.score ? 'score-pop' : ''}>{fmt(state.score)}</b><span>score</span></span>
        <button className="ghost" onClick={onChronicle} data-testid="asc-open-chronicle">Chronicle</button>
        <button className="ghost" onClick={onHelp} aria-label="How to play">?</button>
        <button onClick={onMenu} data-testid="asc-menu">Menu</button>
      </header>

      {settings.tips && !tipsHidden && state.era === 0 && state.plays < 3 && (
        <div className="notice" role="note" data-testid="asc-tip">
          <b>How an era works.</b> You have {state.handsLeft} hands and {state.discardsLeft} discards. Play poker hands: the score feeds this era’s <b>Reserves</b> (1 per {runMods(state).crisis.reserveRate} score), and each scoring card grows its stat. When you are ready — or the hands run out — <b>face the crisis</b>. The forecast on the right is exact.
          <button className="ghost" onClick={() => setTipsHidden(true)} style={{ marginLeft: 8 }}>Got it</button>
        </div>
      )}

      <div className="run-grid">
        <div className="col col-world">{worldPanel}</div>
        <div className="col col-table">
          <section className="panel table-panel" data-testid="asc-table">
            <button type="button" className="crisis-strip" onClick={() => document.querySelector('[data-testid="asc-crisis"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span><b>{crisis.label}</b> faced now: <b className={failing ? 'bad' : 'good'}>{signed(now.margin)}</b>{preview ? <> → <b className={preview.afterEv.margin >= 0 ? 'good' : 'bad'}>{signed(preview.afterEv.margin)}</b></> : null}</span>
              <span className="muted">details and Face ↓</span>
            </button>
            {previewPanel}
            <div className="hand" ref={handRef} onKeyDown={onHandKeys} role="group" aria-label="Your hand">
              {order.map((i) => { const c = state.hand[i]; return (
                <PlayingCard key={c.id} card={c} selected={sel.includes(i)} scoring={scoringIds.has(c.id) && sel.includes(i)} kicker={!!preview && sel.includes(i) && !scoringIds.has(c.id)} onToggle={() => toggle(i)} />
              ) })}
            </div>
            <div className="hand-actions">
              <button className="primary" data-testid="asc-play" disabled={!canPlay || sel.length === 0} onClick={() => act({ type: 'play', cards: sel })}>Play{sel.length ? ` ${sel.length}` : ''}<span className="kbd">P</span></button>
              <button data-testid="asc-discard" disabled={!canPlay || sel.length === 0 || state.discardsLeft <= 0} onClick={() => act({ type: 'discard', cards: sel })}>Discard<span className="kbd">D</span></button>
              <button className="ghost" disabled={sel.length === 0} onClick={() => setSel([])}>Clear</button>
              <button className="ghost" data-testid="asc-sort" title="Sort the hand (keys 1–8 select cards in this order)" onClick={() => setSortBy(sortBy === 'deal' ? 'rank' : sortBy === 'rank' ? 'suit' : 'deal')}>Sort: {sortBy === 'deal' ? 'as dealt' : sortBy}</button>
              <span className="spacer" />
              <span className="hand-hint">Era score <b className="gold">{fmt(state.eraScore)}</b> → <b className="good">{now.mitigations.find((f) => f.label === 'Reserves')?.amount ?? 0}</b> Reserves</span>
            </div>
            {error && <p className="error" role="alert" data-testid="asc-error">{error}</p>}
            {state.lastPlay && !preview && (
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }} data-testid="asc-last-play">
                Last play: {state.lastPlay.label} for <b className="gold">{fmt(state.lastPlay.score)}</b>{WORLD_STATS.filter((k) => state.lastPlay!.statDeltas[k]).map((k) => ` · ${signed(state.lastPlay!.statDeltas[k])} ${WORLD_STAT_LABEL[k]}`).join('')}
              </p>
            )}
          </section>
          <Panel title={`Legendaries (${state.legendaries.length}/${LEGENDARY_SLOTS})`} testid="asc-legendaries">
            <div className="legend-strip">
              {state.legendaries.map((l) => <LegendaryChip key={l.id} inst={l} />)}
              {Array.from({ length: LEGENDARY_SLOTS - state.legendaries.length }, (_, i) => <span key={i} className="legend empty">empty</span>)}
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.74rem' }}>Legendaries are chosen at the Council after the Tribal, Medieval and Information crises, and sometimes sold there.</p>
          </Panel>
        </div>
        <div className="col col-crisis">
          {crisisPanel}
          {trackPanel}
        </div>
      </div>
    </div>
  )
}
