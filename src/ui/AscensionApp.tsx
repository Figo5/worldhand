// Ascension prototype screen: dev server only (App.tsx gates it behind
// import.meta.env.DEV, so production and portable builds drop it entirely).
// Deliberately plain: a seam for the engine, not a design pass.
// Saves nothing; selection lives here, not in engine state.
import { useMemo, useState } from 'react'
import {
  newAscensionGame, applyAscensionAction, evaluatePlay, landAffinity, projectRoundEnd, crisisWorld, actionCost, WORLD_STATS, WORLD_STAT_LABEL, TERRAIN, runStatus,
  type AscensionAction, type AscensionState, type WorldStats,
} from '../engine/ascension/ascension'
import { ARCHETYPES, emergenceThreshold } from '../engine/ascension/civilizations'
import { ERAS, ERA_BUDGET, canAdvance, eraRequirements, isComplete, requirementShortfall, type Era } from '../engine/ascension/eras'
import { CRISES, CRISIS_RULES, evaluateCrisis, type Factor } from '../engine/ascension/crises'
import { cardName } from '../engine/poker'

const eraLabel = (id: Era) => ERAS.find((e) => e.id === id)!.label
const last = <T,>(a: T[]) => a[a.length - 1]
const verdict = (c: { resilience: number; pressure: number }) => (c.resilience >= c.pressure ? `survive by ${c.resilience - c.pressure}` : `fail by ${c.pressure - c.resilience}`)
/** "+2 Vitality · +1 Industry" (non-zero gains, in stat order) */
const gains = (d: WorldStats) =>
  WORLD_STATS.filter((k) => d[k] !== 0).map((k) => `+${d[k]} ${WORLD_STAT_LABEL[k]}`).join(' · ')

/** Factor list component: two sections (pressures and mitigations) with data-testid */
function FactorTable({ pressures, mitigations }: { pressures: Factor[]; mitigations: Factor[] }) {
  return (
    <div className="factor-table">
      <div>
        <h4>Pressures (hurt)</h4>
        <ul>
          {pressures.map((f, i) => (
            <li key={i} data-testid="asc-factor" data-side="pressure" data-amount={f.amount} className={f.amount === 0 ? 'muted' : ''}>
              {f.label} {f.amount > 0 ? '+' : ''}
              {f.amount} ({f.detail})
            </li>
          ))}
        </ul>
        <p><strong>Total pressure: {pressures.reduce((n, f) => n + f.amount, 0)}</strong></p>
      </div>
      <div>
        <h4>Resilience (help)</h4>
        <ul>
          {mitigations.map((f, i) => (
            <li key={i} data-testid="asc-factor" data-side="mitigation" data-amount={f.amount} className={f.amount === 0 ? 'muted' : ''}>
              {f.label} {f.amount > 0 ? '+' : ''}
              {f.amount} ({f.detail})
            </li>
          ))}
        </ul>
        <p><strong>Total resilience: {mitigations.reduce((n, f) => n + f.amount, 0)}</strong></p>
      </div>
    </div>
  )
}

export default function AscensionApp({ onExit }: { onExit: () => void }) {
  const [seedText, setSeedText] = useState('')
  const [game, setGame] = useState<AscensionState | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [error, setError] = useState('')

  const affinity = useMemo(() => (game ? landAffinity(game.regions) : null), [game])
  const reqs = game ? eraRequirements(game.era, game.stats, game.civilizations) : []
  const status = game ? runStatus(game) : null
  const canPlay = status === 'playing' || status === 'ready'
  const preview = useMemo(() => {
    if (!game || selected.length === 0 || !canPlay) return null
    try { return evaluatePlay(game, selected) } catch { return null }
  }, [game, selected, canPlay])
  /** the current era's crisis if it were faced right now (exact once it is ready or has struck) */
  const faceNow = game && !isComplete(game.era) && status !== 'failed' ? evaluateCrisis(game.era, crisisWorld(game)) : null
  /** what this round's end would bring as things stand, and after the previewed play */
  const roundEnd = game && canPlay ? projectRoundEnd(game) : null
  const statsAfter = game && preview ? Object.fromEntries(WORLD_STATS.map((k) => [k, game.stats[k] + preview.statDeltas[k]])) as WorldStats : null
  const previewEnd = game && preview && statsAfter ? projectRoundEnd(game, statsAfter, game.score + preview.score, game.budget - actionCost({ type: 'play', cards: selected })) : null
  const previewFace = game && preview && statsAfter && status === 'ready' ? evaluateCrisis(game.era, crisisWorld(game, statsAfter, game.score + preview.score)) : null
  const eraScore = game && status !== 'failed' && !isComplete(game.era) ? crisisWorld(game).eraScore : 0
  const unit = ERA_BUDGET.unit
  const budgeted = unit !== 'none'
  const playCost = game && selected.length ? actionCost({ type: 'play', cards: selected }) : 0
  const discardCost = actionCost({ type: 'discard', cards: [0] })
  /** if this play spends the last of the budget: does the crisis strike (requirements met) or does the era lapse? */
  const spendsOut = game && preview && statsAfter && budgeted && game.budget - playCost <= 0
    ? (game.crisis || canAdvance(game.era, statsAfter, game.playsLeft === 1 && previewEnd?.civ ? [...game.civilizations, previewEnd.civ] : game.civilizations) ? 'strikes' : 'lapses')
    : null

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
        <p className="muted">Development build only. Seeded world and deal; played suits grow four world stats, the land pays a bonus for the stats its terrain favours, civilizations emerge at round ends and add passive bonuses. Each of three eras (Tribal, Ancient, Medieval) has a budget of cards to play and ends in a crisis: meeting the era's requirements makes it ready, you choose when to face it (it strikes when the cards run out), and it weighs your world and the era's score (as reserves) against it. Nothing is saved.</p>
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
            Seed {game.seedText} · Round {game.round} · Plays {game.playsLeft} · Discards {game.discardsLeft}{budgeted && !isComplete(game.era) ? <> · <strong data-testid="asc-budget-left" data-budget={game.budget}>{game.budget} {unit} left this era</strong></> : null} · Score <strong data-testid="asc-score">{game.score}</strong>
          </p>
          <p data-testid="asc-stats">
            {WORLD_STATS.map((k, i) => (
              <span key={k} data-stat={k} data-value={game.stats[k]}>{i > 0 ? ' · ' : ''}{WORLD_STAT_LABEL[k]} {game.stats[k]}</span>
            ))}
          </p>
          <div data-testid="asc-era" data-era={ERAS[game.era]?.id ?? 'complete'}>
            {status === 'failed' ? (
              <div data-testid="asc-failed">
                <h2>Run over</h2>
                {game.lapsed ? (
                  <p data-testid="asc-lapsed">The {ERAS[game.era].label} era ran out of {unit} before its requirements were met: {eraRequirements(game.era, game.stats, game.civilizations).filter((r) => !r.met).map((r) => `${r.label} ${r.have} / ${r.need}`).join(', ')}.</p>
                ) : (
                  <>
                    <p>{last(game.crises).label} was not survived (faced in round {last(game.crises).faced}): resilience {last(game.crises).resilience} vs pressure {last(game.crises).pressure}.</p>
                    <FactorTable pressures={last(game.crises).pressures} mitigations={last(game.crises).mitigations} />
                  </>
                )}
                <p>The world is kept below for inspection.</p>
              </div>
            ) : isComplete(game.era) ? (
              <div data-testid="asc-complete">
                <h2>First playable complete</h2>
                <p>The Medieval crisis was survived in round {last(game.eraLog).round} with score {game.score}. The world is kept below for inspection; no further plays.</p>
              </div>
            ) : (
              <>
                <p>Era: <strong>{ERAS[game.era].label}</strong> ({game.era + 1} of {ERAS.length}). Its crisis becomes ready at the first round end where the world has:</p>
                <ul>
                  {reqs.map((r) => (
                    <li key={r.key} data-testid="asc-req" data-key={r.key} data-met={r.met} data-have={r.have} data-need={r.need}>
                      {r.met ? '✓' : '✗'} {r.label}: {r.have} / {r.need}{r.key === 'development' ? ' (all four stats together, in any shape: one peak or spread out)' : ''}
                    </li>
                  ))}
                </ul>
                {budgeted && (
                  <div data-testid="asc-budget">
                    <p>
                      This era has <strong>{game.budget} {unit}</strong> left to spend. {unit === 'cards' ? `Each card played costs 1; a discard costs ${discardCost}.` : `A play costs 1; a discard costs ${discardCost}.`}
                      {ERA_BUDGET.carryOver ? ` Unspent ${unit} carry into the next era.` : ''} When they run out, the {CRISES[game.era].label} strikes if the requirements are met; otherwise the era lapses and the run is over.
                    </p>
                    <p data-testid="asc-budget-plan" data-shortfall={requirementShortfall(game.era, game.stats)} data-spare={game.budget - requirementShortfall(game.era, game.stats)}>
                      {game.crisis
                        ? `The requirements are met. Every ${unit === 'cards' ? 'card' : 'action'} you spend now preparing comes out of these ${game.budget}; face the crisis now and they carry into the next era.`
                        : requirementShortfall(game.era, game.stats) > game.budget
                          ? `Warning: the requirements still need about ${requirementShortfall(game.era, game.stats)} more stat points, more than the ${game.budget} ${unit} left. Spend on them only, or the era lapses.`
                          : `The requirements still need about ${requirementShortfall(game.era, game.stats)} more stat points${eraRequirements(game.era, game.stats, game.civilizations).some((r) => r.key === 'civilizations' && !r.met) ? ' (and civilizations)' : ''}, which leaves about ${game.budget - requirementShortfall(game.era, game.stats)} ${unit} to prepare for the crisis or bank.`}
                    </p>
                  </div>
                )}
                <p data-testid="asc-reserves" data-era-score={eraScore} data-reserves={Math.floor(Math.max(0, eraScore) / CRISIS_RULES.reserveRate)}>
                  Score matters: every {CRISIS_RULES.reserveRate} points scored this era add 1 Reserve to its crisis. This era: {eraScore} score → Reserves +{Math.floor(Math.max(0, eraScore) / CRISIS_RULES.reserveRate)}.
                </p>
                {status === 'playing' && (
                  <>
                    <p data-testid="asc-era-status">
                      {reqs.every((r) => r.met)
                        ? `All requirements met: at the end of this round the ${CRISES[game.era].label} becomes ready.`
                        : `Not yet: ${reqs.filter((r) => !r.met).map((r) => r.key === 'stats'
                          ? `${r.need - r.have} more stat${r.need - r.have > 1 ? 's' : ''} to ${ERAS[game.era].needs.min} (${WORLD_STATS.filter((k) => game.stats[k] < ERAS[game.era].needs.min).map((k) => `${WORLD_STAT_LABEL[k]} ${game.stats[k]}`).join(', ')})`
                          : r.key === 'development' ? `${r.need - r.have} more development` : `${r.need - r.have} more civilization${r.need - r.have > 1 ? 's' : ''}`).join('; ')}.`}
                      {' '}Once ready you choose when to face it{budgeted ? `; it strikes on its own when this era's ${unit} run out.` : `; each round end you let it wait adds +${CRISIS_RULES.gatherPerRound} pressure, and after ${CRISIS_RULES.graceRounds} it strikes on its own.`}
                    </p>
                    {roundEnd?.crisis && (
                      <div data-testid="asc-crisis-forecast">
                        <h3>Coming crisis</h3>
                        <p>{CRISES[game.era].label}: {CRISES[game.era].theme} It {CRISES[game.era].watch}.</p>
                        <p>If this round ended now{roundEnd.civ ? ` (${ARCHETYPES[roundEnd.civ.archetype].label} would emerge first)` : ''}{roundEnd.ready ? ' it would become ready and,' : ' and it were'} faced right away, it would find:</p>
                        <FactorTable pressures={roundEnd.crisis.pressures} mitigations={roundEnd.crisis.mitigations} />
                        <p data-testid="asc-forecast-verdict" data-margin={roundEnd.crisis.resilience - roundEnd.crisis.pressure}>resilience {roundEnd.crisis.resilience} vs pressure {roundEnd.crisis.pressure} → would {verdict(roundEnd.crisis)}</p>
                      </div>
                    )}
                  </>
                )}
                {(status === 'ready' || status === 'crisis') && faceNow && (
                  <div data-testid={status === 'ready' ? 'asc-crisis-ready' : 'asc-crisis'} data-crisis={faceNow.crisis} data-waited={crisisWorld(game).waited}>
                    <h2>{status === 'ready' ? `Crisis ready: ${faceNow.label}` : `Crisis: the ${faceNow.label} strikes`}</h2>
                    <p>{ERAS[game.era].label}'s requirements were met at the end of round {game.crisis!.round}. {CRISES[game.era].theme}</p>
                    <p data-testid="asc-crisis-timing">
                      {status === 'ready'
                        ? budgeted
                          ? `Face it now, or keep playing to prepare: each card you play costs 1 of the ${game.budget} ${unit} left (a discard ${discardCost}); when they run out it strikes on its own. Facing now carries them into the next era.`
                          : `Face it now, or keep playing to prepare: each round end you let it wait adds +${CRISIS_RULES.gatherPerRound} pressure (waited so far: ${crisisWorld(game).waited}), and it strikes on its own at the end of round ${game.crisis!.round + CRISIS_RULES.graceRounds}. Nothing else changes while you wait.`
                        : budgeted ? `This era's ${unit} ran out; it strikes. No plays until it is faced.` : `You let it wait ${crisisWorld(game).waited} round${crisisWorld(game).waited === 1 ? '' : 's'}; it struck on its own. No plays until it is faced.`}
                    </p>
                    <p>If faced now it would find:</p>
                    <FactorTable pressures={faceNow.pressures} mitigations={faceNow.mitigations} />
                    <p><strong data-testid="asc-face-verdict" data-margin={faceNow.resilience - faceNow.pressure}>resilience {faceNow.resilience} vs pressure {faceNow.pressure} → {faceNow.result === 'survived' ? `survives by ${faceNow.resilience - faceNow.pressure}` : `fails by ${faceNow.pressure - faceNow.resilience}`}</strong></p>
                    <button className="primary" data-testid="asc-resolve" onClick={() => act({ type: 'resolve' })}>{status === 'ready' ? 'Face the crisis now' : 'Face the crisis'}</button>
                  </div>
                )}
                <details data-testid="asc-crises-ahead">
                  <summary>Crises ahead, and what each one punishes</summary>
                  <ul>{CRISES.slice(game.era).map((c, i) => <li key={c.id}>{ERAS[game.era + i].label}: {c.label} — {c.watch}.</li>)}</ul>
                </details>
              </>
            )}
            {game.crises.length > 0 && <h3>History</h3>}
            {game.crises.length > 0 && (
              <ul data-testid="asc-crisis-log">
                {game.crises.map((c, i) => {
                  const mostHelp = c.mitigations.reduce((best, f) => f.amount > best.amount ? f : best)
                  const mostHurt = c.pressures.slice(1).reduce((worst, f) => f.amount > worst.amount ? f : worst, { label: '', amount: 0, detail: '' })
                  return (
                    <li key={i} data-result={c.result}>
                      Round {c.faced}: {c.label} — {c.result} (resilience {c.resilience} vs pressure {c.pressure}; ready since the end of round {c.round}, waited {c.faced - c.round - 1}){mostHelp.amount > 0 ? ` · helped most: ${mostHelp.label}` : ''}{mostHurt.amount > 0 ? ` · hurt most: ${mostHurt.label}` : ''}
                    </li>
                  )
                })}
              </ul>
            )}
            {game.eraLog.length > 0 && (
              <ul data-testid="asc-era-log">
                {game.eraLog.map((e) => (
                  <li key={e.from}>
                    Round {e.round}: {e.to ? `${eraLabel(e.from)} → ${eraLabel(e.to)}` : `${eraLabel(e.from)} completed`} with {e.civilizations} civilization{e.civilizations > 1 ? 's' : ''} and {WORLD_STATS.map((k) => `${WORLD_STAT_LABEL[k]} ${e.stats[k]}`).join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <details open data-testid="asc-world">
            <summary data-testid="asc-affinity">
              Land bonus per stat point: {WORLD_STATS.map((k) => `${WORLD_STAT_LABEL[k]} +${affinity![k]}`).join(' · ')}
            </summary>
            <ul>
              {game.regions.map((r) => (
                <li key={r.id} data-region={r.id} data-terrain={r.terrain}>
                  R{r.id} {TERRAIN[r.terrain].label} (favours {WORLD_STAT_LABEL[TERRAIN[r.terrain].stat]}) — borders {r.neighbors.map((n) => `R${n}`).join(', ')}
                  {game.civilizations.filter((c) => c.home === r.id).map((c) => ` — home of ${ARCHETYPES[c.archetype].label}`)}
                </li>
              ))}
            </ul>
          </details>
          <div data-testid="asc-civs">
            <p>
              Civilizations — next emerges at a round end once one reaches{' '}
              <span data-testid="asc-civ-next">{emergenceThreshold(game.civilizations.length)}</span> in its stat and has a free home on its terrain.
            </p>
            {roundEnd && (
              <p data-testid="asc-civ-projection" data-archetype={roundEnd.civ?.archetype ?? ''}>
                {roundEnd.civ
                  ? `As things stand, at this round end ${ARCHETYPES[roundEnd.civ.archetype].label} would emerge at R${roundEnd.civ.home} (${WORLD_STAT_LABEL[roundEnd.civ.reason.stat]} ${roundEnd.civ.reason.readiness} ≥ ${roundEnd.civ.reason.needed}).`
                  : 'As things stand, no civilization would emerge at this round end.'}
              </p>
            )}
            {game.civilizations.length === 0 ? <p className="muted">None yet.</p> : (
              <ul>
                {game.civilizations.map((c) => (
                  <li key={c.id} data-archetype={c.archetype} data-home={c.home}>
                    {ARCHETYPES[c.archetype].label} — home R{c.home} {TERRAIN[c.reason.terrain].label} — round {c.emergedRound}:{' '}
                    {WORLD_STAT_LABEL[c.reason.stat]} {c.reason.readiness} ≥ {c.reason.needed}, region fit {c.reason.regionFit}
                    <div data-testid="asc-civ-passive" data-archetype={c.archetype}>
                      <strong>{ARCHETYPES[c.archetype].passive.name}:</strong> {ARCHETYPES[c.archetype].passive.text}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canPlay && (
            <>
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
                {preview ? `${preview.label}: ${preview.chips} chips × ${preview.mult} mult = ${preview.pokerScore}` : 'Select 1–5 cards.'}
              </p>
              {preview && <p data-testid="asc-preview-stats" data-deltas={JSON.stringify(preview.statDeltas)}>World: {gains(preview.statDeltas)}</p>}
              {preview && preview.civBonuses.length > 0 && (
                <div data-testid="asc-preview-civs">
                  {preview.civBonuses.map((b) => (
                    <p key={b.civ} data-testid="asc-preview-civ" data-archetype={b.archetype} data-amount={b.amount}>
                      {ARCHETYPES[b.archetype].label} ({ARCHETYPES[b.archetype].passive.name}): +{b.amount} — {b.detail}
                    </p>
                  ))}
                </div>
              )}
              {preview && <p data-testid="asc-preview-total" data-land={preview.landBonus} data-civ={preview.civBonus} data-score={preview.score}>Land bonus +{preview.landBonus}{preview.landBonus ? ` (${WORLD_STATS.filter((k) => preview.statDeltas[k] && affinity![k]).map((k) => `${preview.statDeltas[k]} ${WORLD_STAT_LABEL[k]} × ${affinity![k]}`).join(' + ')})` : ''} · Civilizations +{preview.civBonus} → play adds {preview.score} (Reserves {Math.floor(Math.max(0, eraScore) / CRISIS_RULES.reserveRate)} → {Math.floor(Math.max(0, eraScore + preview.score) / CRISIS_RULES.reserveRate)})</p>}
              {preview && budgeted && (
                <p data-testid="asc-preview-cost" data-cost={playCost} data-after={game.budget - playCost} data-ends={spendsOut ?? ''}>
                  {playCost > game.budget
                    ? `Not enough ${unit} left: this play costs ${playCost}, ${game.budget} left.`
                    : `This play costs ${playCost} ${unit === 'cards' ? (playCost === 1 ? 'card' : 'cards') : unit}: ${game.budget} → ${game.budget - playCost} left.${spendsOut === 'strikes' ? ` It spends the last of them: the ${CRISES[game.era].label} strikes.` : spendsOut === 'lapses' ? ' It spends the last of them with the requirements unmet: the era would lapse and the run end.' : ''}`}
                </p>
              )}
              {previewFace && (
                <p data-testid="asc-preview-face" data-margin={previewFace.resilience - previewFace.pressure}>
                  Faced right after this play, the {previewFace.label} would find resilience {previewFace.resilience} vs pressure {previewFace.pressure}: would {verdict(previewFace)}.
                </p>
              )}
              {previewEnd?.crisis && (
                <p data-testid="asc-preview-crisis" data-ready={previewEnd.ready} data-forced={previewEnd.forced} data-margin={previewEnd.crisis.resilience - previewEnd.crisis.pressure}>
                  If the round ended after this play{game.playsLeft === 1 ? ' (it is the last of the round)' : ''}:{' '}
                  {previewEnd.civ ? `${ARCHETYPES[previewEnd.civ.archetype].label} would emerge; ` : ''}
                  {previewEnd.forced ? `the ${previewEnd.crisis.label} would strike on its own` : game.crisis ? `the ${previewEnd.crisis.label} would still be ready` : previewEnd.ready ? `${ERAS[game.era].label}'s requirements are met, so the ${previewEnd.crisis.label} becomes ready` : `${ERAS[game.era].label}'s requirements are not yet met`}
                  {' '}— faced then: resilience {previewEnd.crisis.resilience} vs pressure {previewEnd.crisis.pressure}, would {verdict(previewEnd.crisis)}.
                </p>
              )}
              <div className="row">
                <button className="primary" data-testid="asc-play" disabled={!preview || (budgeted && playCost > game.budget)} onClick={() => act({ type: 'play', cards: selected })}>Play{budgeted && preview ? ` (costs ${playCost})` : ''}</button>
                <button data-testid="asc-discard" disabled={selected.length === 0 || game.discardsLeft <= 0 || (budgeted && discardCost > game.budget)} onClick={() => act({ type: 'discard', cards: selected })}>Discard{budgeted && discardCost ? ` (costs ${discardCost})` : ''}</button>
                <button data-testid="asc-clear" disabled={selected.length === 0} onClick={() => { setSelected([]); setError('') }}>Clear</button>
              </div>
            </>
          )}
          {game.lastPlay && (
            <p className="muted" data-testid="asc-last" data-deltas={JSON.stringify(game.lastPlay.statDeltas)}>
              Last play: {game.lastPlay.label} ({game.lastPlay.cards.map(cardName).join(' ')}) for {game.lastPlay.pokerScore} + land {game.lastPlay.landBonus}{game.lastPlay.civBonus > 0 ? ` + civ ${game.lastPlay.civBonus}` : ''} = {game.lastPlay.score} · World: {gains(game.lastPlay.statDeltas)}
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  )
}
