# Worldhand "Ascension": repository assessment and modernization proposal

**Status:** analysis and proposal only. **REVIEW REQUIRED. Nothing is implemented.**
"Ascension" is a working codename. The repository, package, save namespace and
public product name are unchanged.

- **Analyzed revision:** `origin/main` @ `bb68a8f` (2026-09-22), in an isolated
  worktree. Engine and UI source are identical to local `HEAD` `51b7de5`.
- **Analysis date:** 2026-09-23.

---

## 1. Executive summary

1. **Worldhand today is a tight, deterministic poker roguelike with a world skin.**
   - The engine is roughly 1.6k lines of pure TypeScript with one scoring pipeline
     that preview and commit share.
   - It has a strict save gate, 211 passing tests, a portable single-file build and
     a bot-policy balance harness.
   - These are real assets. Nothing in the analysis justifies a rewrite.
2. **The game's own measurements show the gap the vision needs to close.** On
   held-out seeds, re-measured today:
   - Poker skill is worth about **11 epochs** of run depth.
   - Shopping at all is worth about **6–8 epochs**.
   - **Build coherence is worth only about 1.7 epochs.**
   - The first ~8 epochs are rarely in doubt.
3. **The "world" is mostly presentation.** Every seed produces the *same* planet.
   - Terrain and adjacency have no rules effect.
   - Stability only adds +1 Seed per region.
   - Three fixed region specializations are the only regional mechanic.
4. **The opportunity is not more content. It is making the world the build.**
   - Keep the poker hand as the readable input.
   - Make a procedural world, emergent civilizations and era crises the layer that
     decides which builds work.
   - Measurable goal in the existing harness: build coherence worth **≥3–4 epochs**,
     with **≥3 archetypes** within ±15% of each other's depth.
5. **Evolve in place.**
   - Freeze today's rules as **Classic**. Its 211 tests plus new golden-replay
     fixtures become the regression fence.
   - Extract four seams: named RNG streams, structured events, an effect
     interpreter and a content registry.
   - Build Ascension as a second ruleset on the same core.
   - Keep React, three.js and Vite. Wrap for desktop later.
6. **The first playable exists only to answer one question** (§14): does the world
   layer make decisions matter? Scope: 3 eras (3 Ages + a crisis each), 4 world stats,
   6 civ archetypes, 12 legendaries, ~30 world cards, 3 crises, template chronicle.
   - This question comes **before** any content scaling.
7. **Approval is needed** (§20) before the engine split, save or profile formats,
   the content pipeline, folder moves, and anything beyond the first playable.
   - The Phase 0 hygiene items (§13) are small and independent. They can go first.

---

## 2. Current architecture review

### 2.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict, `noUnused*`), TS 7 toolchain | `tsc` is type-check only (`noEmit`) |
| UI | React 19, no router, no state library | `useState` holds the whole `GameState` |
| 3D | three.js 0.186, imperative | Single component `Planet3D.tsx` |
| Build | Vite 8 (rolldown) + a custom single-file portable bundler | `scripts/build-portable.mjs` |
| Tests | Vitest 5 (node env) + Playwright scripts | Playwright scripts are ad-hoc, not a test runner |
| Hosting | Netlify static (`dist/`) | Also `dist-portable/worldhand.html` for `file://` |
| CI | **None** (no `.github/`) | Verification is manual/scripted |

### 2.2 Module map

```
src/engine/rng.ts          37  mulberry32 PRNG + FNV-1a hashSeed
src/engine/poker.ts       166  card model, 52-card deck, exact 1–5 card evaluator, category mult table
src/engine/worldhand.ts  1443  constants, types, ALL content tables, scoring pipeline (buildPlan),
                               reducer (applyAction), economy, epoch end, save validator
src/ui/save.ts            184  localStorage envelope, legacy preservation, export/import
src/App.tsx               856  every screen: title, HUD rail, hand, tabbed shop, planet panel, menus
src/components/Planet3D.tsx 612 three.js globe: 12 spherical-cap regions, icons, adjacency web
src/styles.css            896
tests/ (9 files)         3118  unit + contract tests (poker, determinism, economy bounds, saves, death)
scripts/ (34 + lib/)           Playwright QA, bot probes, screenshot capture; many target older rulesets
```

### 2.3 Game loop (as implemented)

```
newGame(seedText) → setupWorld(hashSeed) → startEpoch (deal 8)

select ─ toggleCard / clearSelection
       ─ discard (≤3/epoch) ────────────────► refill
       ─ play (≤4/epoch) → buildPlan → applyPlanEffects
            ├─ epochGrowth ≥ target ─► endEpoch  (early advance, +1 Seed per unused play)
            ├─ plays == 0 ───────────► endEpoch
            └─ otherwise ────────────► refill
endEpoch: miss → lives−1 (0 → game-over, no market)
          region stability decay → development +1 → worldLevel +1 → Seed income
          → roll 6 shelves (laws, projects, jokers, planets, consumables, vouchers) → market
market ─ buy* / boostWorld (1×/visit) / removeLaw ─ endMarket → epoch-end ─ closeEpoch → next epoch
```

- `applyAction(state, action) → state` is a pure reducer. It deep-clones per
  action and throws on illegal actions.
- The UI never computes rules. It renders `GameState` and `preview(state)`.

### 2.4 Scoring pipeline (`buildPlan`, shared by preview and commit)

```
pokerBase = round(rankSum × (CATEGORY_MULT[cat] + planetLevels[cat]))
Growth    = round((pokerBase × lawMult + lawFlat + projectFlat + worldLevelBonus + regionBonus)
                  × Π(1 + jokerMult_i + voucherJokerBonus) × Π consumable.xNext)
Seeds     = min(ceil(Growth / 4), 4 + epoch)       // income decoupled from score (v8 fix)
Target    = round(100 × 1.40^(epoch−1))             // geometric blinds
```

The **preview == commit** invariant is structural: there is one function, and tests
pin it. This is the most valuable design property in the codebase. Ascension must
keep it.

### 2.5 Data structures

- `GameState` is one flat object of about 35 fields: deck piles, hand, selection,
  six shop shelves, owned laws, projects, jokers, planet levels, consumables,
  vouchers, 12 regions, log and outcome.
- **Content is stored by value.** An owned joker is saved with its own `cost` and
  `mult`. Two consequences:
  - Rebalancing content does not reach existing saves.
  - `validateState` cannot vet it. Owned jokers, vouchers, planets and projects are
    only checked for being arrays, so a hand-edited save can carry a joker with
    `mult: 1e9`. Laws, by contrast, *are* checked against `MARKET_ITEMS` ids.
- The log is English prose (`{ at, text }`), grows without bound, and is saved.

### 2.6 Rendering

- React owns the DOM UI.
- `Planet3D` builds a three.js scene once per mount. It reads region state through
  refs and animates presentation only. The starfield uses `Math.random`, which is
  fine because it is not game state.
- WebGL failure hides the canvas. The accessible region legend stays usable.
- Reduced motion is honored, and there is a no-emoji audit script.
- Separation of logic and rendering is **already good**.

### 2.7 Save system

- **Format:** envelope `{ schema: 4, version: 8 (rules), savedAt, state }` in
  `localStorage["worldhand.save"]`. It auto-saves on every state change.
- **Philosophy:** strict reject-and-preserve.
  - Any version or structure mismatch is never migrated. The raw blob is copied to
    `worldhand.save.legacy.<ts>`.
  - Import goes through the same gate and never overwrites on rejection.
- **Consequence:** there have been 8 rules versions in 2 weeks, and every rules
  change orphans every in-progress run. That is acceptable for single runs. It is
  **not** acceptable for meta-progression, which does not exist yet.

### 2.8 Procedural generation

- The seed drives the initial shuffle, reshuffles and per-epoch shop rolls.
- The seed does **not** drive the world. Region names, terrains, positions,
  adjacency and specializations are hard-coded and identical every run.
- RNG substreams are derived as `seed + epoch·2654435761 + salt`. This is
  deterministic and adequate for now, but see §4 on stream isolation.

### 2.9 Modding and extensibility points

| Extension point today | Assessment |
|---|---|
| Content arrays (`JOKERS`, `PLANET_CARDS`, `CONSUMABLES`, `VOUCHERS`, `MARKET_ITEMS`, `WORLD_PROJECTS`) | Easy to add numbers, but every new *behavior* needs engine edits |
| Joker `condition` enum + the `fires` boolean chain in `buildPlan` | Hard-coded switch. Does not scale past ~20 jokers |
| Law optional numeric fields (`growthMult`, `growthFlat`, `handSize`, `decayDelta`, `extraSeedsPerEpoch`, `marketDiscount`, `wakeRegionId`) | **A proto effect vocabulary.** Worth generalizing (§8.1) |
| Mod loading, localization, content ids in saves | None |

### 2.10 Underused systems worth repurposing

| System | Today | Repurpose as |
|---|---|---|
| `Region.adjacency` (12-node graph) | Drawn as a web on the globe. No rules effect | Civ contact, rivalry, trade routes, spread of plague and religion. Adjacency-synergy cards (the Luck Be a Landlord lesson) |
| `Region.terrain` (6 types) | Colour and icons only | Drives civ emergence, card affinities, crisis vulnerability. Generated per seed |
| `stability` + decay + Mycorrhiza | +1 Seed per healthy region | The world **Order** stat and civ collapse trigger |
| `development` (uncapped, bonus capped at +4) | Drives globe icons and 3 specializations | Civ tiers (Settlement → Kingdom → Empire) |
| World Level (+1/epoch, boostable) | A single number and the largest passive income source | Replaced by **Era** progression |
| World Projects (repeatable sinks) | Seed sinks | **Wonders**: region-bound, one per region, feed legacy |
| Lives (3) | Balatro lives | Kept. Framed as world resilience |
| `log` | English strings | Typed **Chronicle** events feeding narrative, history viewer and legacy |
| Obsolete `drought` mechanic + `drought-legibility.mjs` | Removed in an earlier ruleset | Prototype for the crisis system (it was already a "world pressure" idea) |
| `scripts/lib/candidates.mjs` + P0–P4 policies | Balance probes | Foundation of the balance harness (§17) |
| Portable single-file build | Offline distribution | Keep. Good for itch.io, demos and jams |

---

## 3. Baseline verification results

All runs used an isolated worktree at `origin/main` `bb68a8f`, with Node 26.8.1,
npm 11.19.0 and `npm ci`. The worktree was left clean afterwards.

| Check | Command | Result |
|---|---|---|
| Unit/contract tests | `npm test` | **PASS**: 9 files, **211/211** tests, 0 skipped, 356 ms |
| Production build | `npm run build` | **PASS**: tsc clean. JS 800.85 kB (214.84 kB gzip), CSS 19.73 kB (5.11 kB gzip). Warning: chunk > 500 kB (pre-existing, cosmetic) |
| Portable build | `npm run build:portable` | **PASS**: `dist-portable/worldhand.html`, 0.78 MB single file. Same chunk warning |
| Portable browser QA | `node scripts/qa-portable.mjs` | **PASS 9/9**: file:// load, keyboard, shop, reload, full run to game-over, 1280 & 480 widths, export, import |
| Dev-server browser QA | `node scripts/qa.mjs` (vite on :5177) | **PASS**: 1280×800 and 480×800 |
| Legacy verify script | `node scripts/verify.mjs` | **FAIL (pre-existing, stale script)**: `.pcard-btn` `title` is null. Targets a pre-v3 suit-era UI. Also needs `--host 127.0.0.1` on macOS |
| Legacy sweep script | `node scripts/balance-sweep.mjs` | **FAIL (pre-existing, stale script)**: imports `EPOCH_TARGETS`, which no longer exists |
| Balance harness | `scripts/difficulty-measure.mjs` (**local-only, untracked**, copied into the worktree for the run) | **Ran, 4.3 s.** Held-out means: weak play 3.0 · no-shop 8.6 · scattered 14.5 · cheapest 14.1 · focused 16.2. 0/400 runs hit the epoch cap |

**Balance baseline drift.** `docs/rules.md` publishes these held-out means:
no-shop 8.8, scattered 15.1, cheapest 15.4, focused 16.4. Today's run measures
8.6, 14.5, 14.1 and 16.2.

- The conclusions still hold: poker skill dominates and build coherence is small.
- The published numbers pre-date commit `51b7de5` ("bound economy and enforce
  terminal death") or a harness change.
- Treat **today's numbers as the Ascension baseline**. Future phases must not
  regress Classic on them.

### 3.1 Repository-state findings

- **The balance harness the docs cite is not on GitHub.**
  - `scripts/difficulty-measure.mjs` is cited in `docs/rules.md`.
  - `scripts/target-sweep.mjs` is cited in a code comment at `worldhand.ts:100`.
  - Both exist only as untracked files in the local checkout, along with
    `playtest-v8.mjs`, `repro-runaway.mjs` and `.hermes/` measurements.
  - Recommend committing them (Phase 0).
- **The local checkout is 1 commit behind `origin/main`** and has modified
  `shots*/` PNGs that the incoming commit deletes. A plain `git pull` will stop
  until those are resolved.
- **No LICENSE file.** `package.json` says MIT and the README flags the gap. This
  must be decided before any commercial or open-source positioning (§19).

---

## 4. Technical debt report

Severity scale: **H** blocks Ascension, **M** should be fixed during the relevant
phase, **L** is hygiene.

| # | Sev | Finding | Evidence | Fix direction |
|---|---|---|---|---|
| D1 | H | God module: content, rules, economy, validation and the reducer all live in one 1443-line file | `worldhand.ts` | Extract seams incrementally behind a golden-replay fence (§9) |
| D2 | H | Content is hard-coded TS. New behavior needs engine edits (joker `fires` chain) | `buildPlan` L690–704 | Data-driven effect interpreter (§8.1) |
| D3 | H | Content is stored by value in saves, and owned jokers, vouchers and planets are not validated | `validateState` only checks `laws` and `market` ids | Store ids + a content hash. Resolve through the registry |
| D4 | H | No migration path at all. Fine for runs, fatal for meta-progression | `save.ts` contract | Keep strict runs. Add a separate, migratable **profile** store (§11) |
| D5 | M | The engine emits English prose (log, `summary`, error strings) | `s.log.push({text: ...})` throughout | Structured events + a presentation-layer formatter. Prerequisite for i18n |
| D6 | M | RNG substreams are additive (`seed + epoch·K + salt`). Every reshuffle within an epoch uses the same stream seed | `rngFor`, `drawUp` | Named hashed streams for **new** code only. Classic keeps its derivation to stay replay-identical |
| D7 | M | Engine errors are thrown inside a React `setState` updater, so `act()`'s try/catch cannot catch them. React re-throws during render, and there is no error boundary | `App.tsx` `act` | Compute next state outside the updater, or add an error boundary. *Found by reading the code, not reproduced. The UI pre-disables illegal actions today, so this is latent* |
| D8 | M | Every `loadGameDetailed()` call on an incompatible save writes *another* legacy copy. That includes the StrictMode double effect in dev and each "Load Saved World" click | `save.ts` `preserveLegacy` + `App.tsx` L121, L249 | Idempotent preserve (hash the blob) or move the key after preserving |
| D9 | L | Wake-region expansions occupy a law slot, but `removeLaw` frees the slot and the region stays awake. The slot cost is therefore illusory | `removeLaw` / `buy` | Design decision: expansions shouldn't be laws (Ascension replaces them anyway) |
| D10 | L | Stale text: title screen "across three epochs", rules.md joker values (says ×2 Flush; engine ×3.5), test names "Seeds accumulate without ceiling" (now capped), `buildPlan` doc "uncapped", `epoch // 1..3` | various | One doc/text pass |
| D11 | L | Dead code: `TOTAL_EPOCHS`, the `flourishing <= 0` death branch (Flourishing only increases), `CATEGORY_POINTS` (display only) | `worldhand.ts` | Delete when touched |
| D12 | L | About 20 of the 34 scripts target retired rulesets (`verify.mjs`, `balance-sweep.mjs`, `review-*`) | §3 | Move to `scripts/archive/` (**needs folder-move approval**) or delete |
| D13 | L | 801 kB single JS chunk (three.js) | build warning | Lazy-load `Planet3D` (dynamic import). Keep the portable build inlined |
| D14 | L | No CI, lint or formatter config | repo | GitHub Actions: `npm ci && npm test && npm run build` |
| D15 | L | `App.tsx` is an 856-line single component tree | `App.tsx` | Split into screens as Ascension adds them (not before) |

**Scalability and bottlenecks.**

- The engine does a full deep clone per action. That is trivially fast at this size:
  400 bot runs take 4.3 s.
- The bottleneck at 500 cards and 150 legendaries is **not performance**. It is
  D2 and D3: authoring behavior in code and storing content by value.
- The unbounded log in saves will grow linearly with run length. Cap it, or store it
  as compact events.

---

## 5. Opportunity and gap analysis

### 5.1 What the inspirations teach (without copying mechanics)

| Game | Core lesson | Worldhand equivalent |
|---|---|---|
| Balatro | A readable hand evaluator; order-sensitive multiplier shelf; an economy decoupled from score | **Already present.** Poker evaluator, 5-slot joker shelf, v8 capped income |
| Slay the Spire | Act structure with previewed bosses; path choice; relics as rule-benders | Eras with previewed **crises**; legendaries |
| Luck Be a Landlord | Spatial adjacency makes every addition interact with the board | The existing (unused) **adjacency graph** |
| Monster Train | Pick two clans at run start and their pairing defines the run | **Genesis draft** + first civilizations |
| Civ / world-sims | History as the reward: reading back what happened | Chronicle, legacy, shareable seeds |

**The differentiator:** a run *leaves a world behind*. The same seed gives the
same world and the same history, so it can be shared. The Legacy system turns
many runs into a mythology. None of the listed inspirations does this.

### 5.2 Gap analysis against the brief

| Vision element | Today | Gap | Size |
|---|---|---|---|
| World creation from cards | Fixed 12-region planet | Procedural terrain + Genesis draft | M |
| Civilizations with procedural traits | None | New system (uses adjacency, development, terrain) | L |
| Eras with pools, disasters, bosses | Unlimited identical epochs | Era structure + crisis bosses + a win condition | M |
| Roguelike challenges | Geometric blind only | Rule-changing crises driven by world state | M |
| World Prosperity multipliers | World Level flat bonus | 4-stat world model + aggregation + strain | M |
| Legendary cards (150+) | 9 jokers, hard-coded conditions | Effect interpreter + registry | L |
| Combo discovery | None | Discovery predicates over events + encyclopedia | M |
| Meta progression / ascension / legacy | None (no profile) | Profile store with migrations, unlock graph, A1–A20, pantheon | L |
| Procedural narrative | English log | Structured chronicle + seeded template grammar | M |
| Data-driven content / mods / i18n | None | Content packs + validator + locale files | L |
| Deterministic replay | Deterministic, but no action log | Save the action log, add a replay verifier | S |
| Balance methodology | 5 frozen bot policies, dev/held-out seeds | Generalize to archetypes, pick-rate and outlier analytics | M |
| **A win condition** | None (the run always ends in death) | Win at the end of Era 8, then Endless | S |

That last row matters commercially. Today every run ends in "The World Withers".
Players need a victory to chase before endless scoring.

---

## 6. Recommended vision

**Pillars.** Every feature must serve at least one.

1. **You play hands; the world remembers.** The poker hand stays the one readable
   input. Its consequences land in a persistent, visible world.
2. **The world is the build.** Terrain, civilizations and legendaries are the
   multiplier layer. Coherent worlds go deep, and incoherent ones are punished by
   crises they caused.
3. **Everything is bounded.** The v8 economy lessons are design law:
   - income is decoupled from score;
   - income grows linearly while blinds grow geometrically;
   - permanents are one-time;
   - repeat purchases cost superlinearly;
   - slots are finite.
4. **Every run is a shareable history.** The same seed and actions produce the same
   world, story and score, with no network and no generative-AI service.

### Alternatives considered for the core input

| Option | Description | Verdict |
|---|---|---|
| A. Poker + world as modifiers (**recommended**) | Keep the 52-card poker evaluator. Suits become Domains that push world stats. The world supplies multipliers and crises | Lowest risk. Reuses `poker.ts` and all scoring tests. Players already know it |
| B. Replace poker with tag-pattern cards | Cards carry tags, and "hands" are data-defined tag patterns | Maximum flexibility. Throws away legibility and the tested evaluator. Revisit only if A fails the first-playable gate |
| C. Re-add region placement per play | Choose a target region for every hand | The repo *already tried and removed* per-play region and suit decisions (rules v1–v2) as too fiddly. Placement is only allowed at the Genesis draft and via specific cards |

---

## 7. Core gameplay proposal

### 7.1 Run structure

```
World Genesis ─► Era 1 ─► Era 2 ─► … ─► Era 8 (Transcendent) ─► WIN ─► optional Endless
Era  = Age 1 (target) → Council → Age 2 (target) → Council → Age 3 = ERA CRISIS (boss) → Era reward
Age  = today's epoch: 4 plays, 3 discards, a target; a miss costs a life (3 lives)
```

- The first playable ships Eras 1–3 (Tribal, Ancient, Medieval) plus Endless.
- The Council is today's market, restructured.
- The target curve starts from today's tested geometric curve and is recalibrated
  per era with the harness.

### 7.2 Phase 1: World Genesis (about 30 seconds)

- The seed generates terrain for the 12 existing regions, weighted by the 6 current
  terrain types plus new ones such as volcanic, desert and tundra.
- Adjacency is kept: the globe layout is fixed and only its contents vary.
- The player drafts **3 of 5** seeded **Genesis cards**, for example:
  - Mountain Range
  - Great River
  - Volcanic Belt
  - Fertile Plains
  - Ancient Forest
  - Crystal Desert
  - Frozen Wastes
- Each Genesis card:
  - rewrites the terrain of 1–3 adjacent regions;
  - tilts one world stat;
  - adds 2 matching **world cards** to the deck.
- This is where terrain starts affecting everything downstream.

### 7.3 Playing hands (the input stays familiar)

- Select 1–5 of 8 cards and evaluate with the existing `poker.ts`: same categories,
  same chips × mult.
- **Suits become Domains.** They stay readable as four suits and are reskinned:

  | Suit | Domain | World stat it feeds |
  |---|---|---|
  | ♠ | Stone | **Order** (stability, law, infrastructure) |
  | ♥ | Life | **Nature** (biodiversity, food, ecosystems) |
  | ♦ | Trade | **Prosperity** (economy) |
  | ♣ | Lore | **Insight** (innovation and culture) |

  The brief lists five factors (economy, stability, biodiversity, innovation,
  culture). Innovation and culture are merged so each suit maps 1:1 to a stat.
  Culture can split out later if playtests want five.
- Each *scoring* card pushes its Domain's stat by a small amount. Suits matter
  without adding a decision per play, which was the lesson from rules v1–v2.
- **World cards** are the "500 standard cards" target. They are playing cards
  (Domain + Magnitude) with one keyword effect, sold at the Council and added to the
  deck. The deck size becomes variable, with a cap, so the 52-card conservation
  invariant becomes "deck = the owned card instances".
  - *Example:* "Great River ♥9: when scored, +1 Nature per coastal region adjacent
    to a civ."
  - Some world cards **evolve** when a condition is met (§7.8).

### 7.4 World Prosperity (the synergy multiplier)

```
Yield       = pokerBase → card effects → civ effects → legendary effects   (ordered pipeline, §8.2)
WorldMult   = 1 + α · geomean(Order, Nature, Prosperity, Insight) / scale   (breadth pays, diminishing)
Score       = round(Yield × WorldMult × consumables)
Strain[s]   = accumulates each Age when stat s > β · mean(stats)            (lopsidedness)
```

- **Commitment pays in Yield.** Civs and legendaries reward leaning into a Domain.
- **Breadth pays in WorldMult.** The geometric mean punishes a zero stat.
- **Lopsidedness accrues Strain.** Strain *selects and scales the next crisis*.
- That is the core tension: *how far do you lean before the world pushes back?*
- Thousands of synergies come from these systems interacting (stats × terrain ×
  civs × legendaries × crises), not from a hand-written combo table.

### 7.5 Phase 2: Civilizations

- **Emergence.**
  - At each Age end, every region whose terrain and local stats satisfy an
    archetype's spawn predicate may found a civ.
  - Limits: one civ per region and **at most 5 living civs**. This is the shelf,
    mirroring the 5 joker slots that measurably create choice.
- **Archetypes** are data, and the first playable ships 6:

  | Archetype | Terrain | Domain |
  |---|---|---|
  | Nomads | steppe | Life |
  | Merchants | coast | Trade |
  | Empire Builders | highland | Stone |
  | Pirates | coast | high Trade strain |
  | Cultists | any | Lore + an active crisis |
  | Technocrats | any | high Insight |

  Beast Tamers (forest, Life) is first in the vertical-slice queue.
- **Procedural traits.**
  - Each civ rolls 2 traits from a weighted pool (~20 in the first playable). The
    weights depend on terrain and era.
  - Each civ gets a seeded name from an archetype syllable grammar.
  - 7 archetypes × C(20,2) trait pairs × terrain gives thousands of distinct civs,
    and each trait is one effect entry.
  - *Example traits:* Seafaring (+mult on Flush while coastal), Zealous (×1.5 during
    crises, −Insight each Age), Hoarders (Council prices −1, Prosperity strain +1).
- **Lifecycle.**
  - Tier grows with the region's development (repurposed):
    Settlement → Kingdom → Empire.
  - Adjacent civs form Alliance or Rivalry from trait and archetype affinity. This is
    the first rules use of adjacency.
  - A civ collapses when its region's Order reaches 0 (repurposed stability). The
    ruin becomes a Legacy candidate.
- **The player cultivates civs and does not buy them.** At the Council you can:
  - **Patronize** a civ (tier up, escalating cost);
  - answer its **Demand** (a short conditional quest, e.g. "play two Trade flushes
    this Age");
  - or **Suppress** it.

  This is the concrete answer to "the world is the build". It is also different from
  Balatro's buy-a-joker loop.

### 7.6 Phase 3: Eras

| Era | New card tags | New civ tier / pressure | Crisis pool (examples) |
|---|---|---|---|
| Tribal | base Domains | Settlements; raids | Long Winter, Megafauna |
| Ancient | Bronze, Script | Kingdoms; rivalries | Great Flood, Plague of Kings |
| Medieval | Faith, Guild | Religions spread over adjacency | Black Plague, Holy War |
| Renaissance | Print, Navigation | Colonies (off-globe events) | Schism, Bank Collapse |
| Industrial | Steam, Coal | Empires; Nature strain doubles | Climate Collapse, World War |
| Information | Network, Silicon | Technocrat surge | Resource Exhaustion, AI Singularity |
| Space Age | Orbit | Off-world regions (a 13th "moon" slot) | Kessler Cascade, Dimensional Rift |
| Transcendent | Myth | Civs ascend or fall | Eldritch Invasion (composite of two highest strains) |

- Each era introduces new card pools, crises, opportunities, pressures and
  constraints.
- Era rewards: pick 1 of 3 **legendaries** after surviving the crisis. Legendaries
  are rare. Crises are the main source.

### 7.7 Phase 4: Crises (the bosses)

- A crisis is the 3rd Age of an era. It has a **rule modifier** and a **severity**.
  - `severity = base(era) + strain[axis]`: the crisis you get is partly the crisis
    you caused.
- The crisis is chosen from the era's pool, weighted by strain, and **revealed one
  Age ahead**. The player can prepare, as in Balatro's boss preview.

Examples (the first playable ships 3):

| Crisis | Driven by | Rule while active |
|---|---|---|
| Long Winter | low Nature | Life cards score half chips. Nomad civs are immune and gain a tier if they survive |
| Great Flood | Nature strain | Coastal regions' civs are inactive. Stone cards give +mult ("levees") |
| Plague of Kings | Prosperity strain | Each Trade card scored spreads "sick" to an adjacent civ (−1 tier at Age end unless an Order ≥ X card is played) |
| Climate Collapse | Order/Industry strain | Every Stone card scored adds Nature strain; stats decay each hand |
| AI Singularity | Insight strain | The highest-magnitude card in each hand is debuffed. Technocrats double or defect |
| Eldritch Invasion | composite | Two modifiers; a Cultist civ can be sacrificed to cancel one |

### 7.8 Legendary cards (the joker-equivalent)

- There are **5 slots**, kept from the tested shelf size.
- Each legendary has 1–2 **rule hooks** in the effect DSL, and at most one bespoke
  scripted hook when truly necessary.

| Legendary | Rule change |
|---|---|
| The World Tree | Life cards count as every Domain for flushes. Nature can't drop below the highest other stat |
| Eternal Dragon | At each Era end it devours the weakest civ. ×mult +0.5 per civ devoured (cap ×4) |
| The Sleeping God | Inert until a crisis begins. During crises every scoring card retriggers once |
| Titan Forge | Stone cards gain +1 magnitude permanently when scored (cap 16, a "Titan" rank) |
| Cosmic Library | The first Lore card each hand copies itself into the deck (deck cap applies) |
| Architect Moon | Straights may wrap (Q-K-A-2-3). Adjacency also links the regions opposite on the globe |

**Scaling to 150+.**

- Legendaries are data: triggers × predicates × ops (§8.1), plus tags.
- They carry rarity, era gating and **exclusivity tags** so the pool can't offer two
  that trivially combine into loops.

### 7.9 Combo discovery

Discovery is a **recognition layer, not a power source**. It names and records
emergent situations. It does not hardcode bonuses.

- **Discoveries:** data predicates over the event stream. *Example:* "a Flush while
  holding World Tree and a Beast-Tamer civ exists" reveals the named synergy
  *Wildhunt* in the encyclopedia.
- **Card evolutions:** a bounded power source. A world card evolves when a condition
  holds, e.g. Great River played 5× next to a Merchant civ becomes Trade Delta.
  Evolutions are one-way and one step deep in the first playable.
- **Rare world states:** e.g. all four stats above a threshold triggers a Golden Age
  event. A civ reaching Empire in every Domain triggers Hegemony.
- **Unlocked archetypes:** some civ archetypes and traits unlock in the profile the
  first time a discovery fires.

### 7.10 Meta-progression

- **Unlock graph** (profile). Unlocks come from discoveries and achievements, not a
  grind currency. Nodes include cards, civ archetypes, Genesis cards, relics,
  challenge variants, starting conditions and ascension levels.
- **Ascension levels A1–A20.** Each adds a *systemic* constraint and stacks:

  | Lvl | Constraint | Lvl | Constraint |
  |---|---|---|---|
  | A1 | Crises are no longer previewed | A11 | Discards cost 1 Seed |
  | A2 | Genesis draft is 3 of 4 | A12 | Stats drift 10% toward 0 each Age (entropy) |
  | A3 | Civs found with 1 trait | A13 | One civ is born Hostile and must be appeased or suppressed |
  | A4 | Strain accrues 25% faster | A14 | Crises always pick the highest-strain axis (no weighting luck) |
  | A5 | Council shelves show one fewer item | A15 | Legendaries cost a civ tier to accept |
  | A6 | One region starts Blighted (no civ until restored) | A16 | Each survived crisis leaves a permanent Scar rule |
  | A7 | Start with 2 lives | A17 | Eras 6–8 have double crises |
  | A8 | Legendary shelf has 4 slots | A18 | Legacy (pantheon) disabled |
  | A9 | Civ Demands expire faster and fail loudly (−tier) | A19 | Hand size 7 |
  | A10 | Rival civs actively raid allied neighbours | A20 | Final crisis is a composite of your two highest strains |

- **Legacy (pantheon).**
  - At run end the chronicle proposes candidates: the greatest civ, the fiercest
    crisis survived (it becomes a myth), the longest-held legendary (an artifact)
    and a hero.
  - The player enshrines **one**. The pantheon is capped at 20 and the oldest fade.
  - Future runs may deterministically surface enshrined legacy. The draw uses
    `hash(seed, pantheonSnapshot)`, so it is reproducible:
    - a fallen empire's ruins as a Genesis option;
    - a recurring religion as an available trait;
    - an artifact as a rare Council offer;
    - a remembered disaster, where the crisis pool entry arrives with a known
      counter.
  - **Shared and daily seeds run with Legacy off.** That keeps comparisons fair.

### 7.11 Procedural narrative

- The engine emits typed Chronicle events and never prose.
- A **Story compiler** (presentation layer) turns events into text with a small
  seeded template grammar. That is roughly a 100-line Tracery-like expander, with
  the stream `rng('story', eventIndex)`.
- Outputs:
  - era chapters;
  - dynasty lines per civ (founding, tiers, rivalries, collapse, rebirth);
  - **heroes**, named from a civ's grammar, emerging on a civ's record hand;
  - myths (crises survived) and religions (spread over adjacency).
- The narrative is fully deterministic from seed + actions. There is no external
  generative-AI dependency.

### 7.12 Economy and anti-degeneracy design

- **Carried forward from v8, all measured:**
  - capped per-play income;
  - linear income against geometric targets;
  - one-time permanents;
  - superlinear repeat prices;
  - one boost per visit;
  - finite shelves (5 legendaries, 5 civs, 2 consumables).
- **New rules:**
  - Stats aggregate by geometric mean, so there are diminishing returns and no
    single-stat runaway.
  - Strain feeds back into crises, so a dominant strategy summons its own counter.
  - Retriggers are capped per hand (a global cap plus a per-effect `limit`).
  - The deck size is capped.
  - Card evolutions are one step deep.
  - Scaling ops use `{per, cap}`. Nothing scales without a cap.
  - Numeric guard: any score ≥ 1e15 or non-finite is an **engine invariant
    violation**, and tests and bots fail on it.

---

## 8. System design documents (condensed)

### 8.1 Effect DSL (the scalability core)

The effect vocabulary is closed and data-only. The engine interprets it. There is
no arbitrary code in content. That keeps the game deterministic, validatable,
moddable and safe.

```ts
type EffectDef = { on: Trigger; if?: Pred; do: Op[]; limit?: number /* per hand or Age */ }

type Trigger =
  | 'hand.scoring' | 'card.scored' | 'card.held' | 'age.start' | 'age.end'
  | 'era.start' | 'crisis.start' | 'crisis.end' | 'civ.founded' | 'civ.collapsed'
  | 'council.open' | 'card.evolved'

type Pred =
  | { all: Pred[] } | { any: Pred[] } | { not: Pred }
  | { hand: HandCategory | HandCategory[] }
  | { domainCount: { domain: Domain; gte: number } }
  | { stat: { name: Stat; gte?: number; lte?: number } }
  | { strain: { name: Stat; gte: number } }
  | { civ: { archetype?: string; trait?: string; minTier?: number; count?: { gte: number } } }
  | { terrain: { is: string; adjacentToCiv?: boolean } }
  | { era: { gte?: EraId; lte?: EraId } } | { crisisActive: boolean | string }

type Num = number | { per: Counter; x: number; cap: number }   // bounded scaling only

type Op =
  | { chips: Num } | { mult: Num } | { xmult: Num }
  | { stat: Stat; delta: Num } | { strain: Stat; delta: Num }
  | { retrigger: 'card' | 'hand'; times: 1 | 2 }
  | { addCard: CardId } | { transformCard: CardId } | { destroyCard: 'self' }
  | { civTier: 'self' | 'adjacent'; delta: 1 | -1 }
  | { seeds: Num } | { emit: EventType }

// Rare bespoke hooks: registered in code by id, still pure and deterministic.
type ScriptedHook = { script: string /* key into a code registry */ }
```

- Classic's laws, jokers, planets and vouchers map onto a subset of this: `mult`,
  `xmult`, `chips`, `hand` and `handSize`.
- Porting Classic onto the interpreter is **optional**. It happens only if golden
  replays prove identical results (§12).

### 8.2 Scoring pipeline (extends `buildPlan`, same invariant)

The phases are fixed, and each emits a line item for the UI breakdown:

1. Evaluate hand (`poker.ts`).
2. Base chips × mult (category + planet-equivalent levels).
3. `card.scored` effects, left to right, including retriggers (capped).
4. `card.held` effects.
5. Civ effects (in region order).
6. Legendary effects (in shelf order, player-arrangeable; order matters, as in Balatro).
7. WorldMult.
8. Consumables.
9. Clamp and numeric guard.

**preview == commit** stays structural: one function, with the invariant test kept.

### 8.3 World simulation

- State: `regions[12]` (terrain, civ ref, development, order-local), `stats[4]`,
  `strain[4]`, `activeCrisis`.
- Ticks happen only at Age end. There is no real-time simulation, so it is cheap and
  deterministic.
- Tick order is documented and tested:
  1. stat drift;
  2. strain accrual;
  3. civ growth and collapse;
  4. relations (alliance or rivalry over adjacency);
  5. spawn checks;
  6. discoveries;
  7. crisis selection and preview.

### 8.4 RNG streams

```ts
stream(runSeed, name: 'genesis'|'deal'|'council'|'civ'|'trait'|'crisis'|'story'|'legacy', ...keys)
  = new Rng(hashSeed(`${runSeed}|${name}|${keys.join('|')}`))
```

- Streams are independent. Adding a shop shelf can never change the deal order,
  which today's additive derivation cannot guarantee.
- Classic keeps `rngFor` unchanged, so its seeds keep producing identical runs.

### 8.5 Chronicle events

```ts
type ChronicleEvent = { i: number; era: number; age: number; type: string; data: Record<string, string | number> }
```

- Events are append-only.
- They are stored compactly and capped per run (e.g. 2k events). Rollups are kept
  and the fine detail is dropped.
- They feed the story compiler, history viewer, run summary, discoveries and legacy.

---

## 9. Technical architecture proposal

### 9.1 Target layout

New code goes *beside* existing code. Moving existing files is a later, separately
approved step.

```
src/engine/rng.ts, poker.ts           KEEP as-is (shared core)
src/engine/worldhand.ts               KEEP = Classic ruleset (frozen; bug fixes only)
src/engine/core/streams.ts            NEW named RNG streams
src/engine/core/effects.ts            NEW effect interpreter (Pred/Op evaluation)
src/engine/core/events.ts             NEW chronicle event types
src/engine/ascension/                 NEW ruleset: state, reducer, pipeline, world tick, civs, crises
src/content/registry.ts, validate.ts  NEW content registry + runtime validator (shared by base + mods)
content/base/…json                    NEW Ascension base content pack (see §10)
src/narrative/                        NEW grammar expander + story compiler (presentation-side)
src/meta/                             NEW profile store, unlocks, legacy, migrations
src/ui/…                              screens split out as they're added (Classic UI untouched)
```

### 9.2 Principles

- **The engine stays pure.** No DOM, `Date` or `Math.random` under `src/engine/`.
  Enforce it with a test that greps the engine sources, following the precedent of
  `check-no-emoji.py`.
- **Ruleset boundary.** The menu picks Classic or Ascension. Each has its own
  `RULES_VERSION` and save key, so the two can never cross-load.
- **Deterministic replay.** Ascension run saves store `{seed, contentHash,
  rulesVersion, actions[], snapshot}`. A replay test re-derives the snapshot from the
  actions.
- **Storage adapter.** `StorageLike` has a localStorage implementation now and a
  filesystem one later (desktop wrapper, Steam Cloud). This is a small interface
  because two implementations are genuinely expected.
- **No new runtime dependencies** for the first playable. The validator, grammar and
  interpreter are all small.

### 9.3 Runtime and platform recommendation

- **Stay on the web stack.** Tests, determinism, the portable build and the bot
  harness all exist and run in Node.
- An engine port (Godot, Unity, LÖVE) would discard the strongest assets for
  rendering headroom this 2D-card-plus-one-globe game doesn't need.
- **Desktop:** a thin Tauri or Electron wrapper at Early Access for Steam and Steam
  Deck.
- **Mobile:** later via Capacitor, if pursued (§19).

---

## 10. Content architecture proposal

```
content/
  base/
    manifest.json        { id: "base", version, requires: [] }
    cards/*.json         world cards (Domain, magnitude, tags, effects, evolvesTo)
    genesis/*.json       Genesis cards
    legendaries/*.json
    civs/archetypes.json, civs/traits.json, civs/names/*.json (syllable grammars)
    eras/*.json, crises/*.json, events/*.json, relics/*.json
    discoveries/*.json, ascension/*.json, unlocks.json
    locales/en.json      all player-facing strings by key
  (mods/<id>/ — same layout, loaded after base; EA milestone)
```

- **Format.** Use JSON for Ascension content from day one. First-party content then
  exercises the mod path, and non-programmers can edit it.
  - TypeScript types are the schema of record.
  - `validate.ts` is a hand-written runtime validator covering required fields, id
    references, enum values, `Num` caps and exclusivity tags. It is shared by the
    build, the tests and the future mod loader.
- **IDs.** IDs are stable and namespaced (`base:great_river`). Saves reference ids
  only.
  - `contentHash` is a hash of the canonicalized loaded packs, recorded in run saves.
  - A mismatch is handled by the existing strict reject-and-preserve policy for
    runs.
- **Localization.** Content carries keys (`card.base.great_river.name`) and the
  engine emits events. Only `locales/*.json` holds prose. The story grammar is also
  per locale.
- **Authoring pipeline.** `npm run content:check` validates the packs and prints
  counts per type, orphan ids and missing locale keys. It runs in CI and tests.
- **Scale targets** are architecture targets, not first-playable goals. The same
  registry serves 30 cards or 500.
- **Classic content** stays in TypeScript and is untouched. Replacing Classic's
  content pipeline requires **Content Pipeline Replacement Approval**.

---

## 11. Data model proposal (Ascension)

```ts
interface AscensionRun {
  rules: { mode: 'ascension'; rulesVersion: number; contentHash: string; ascension: number; legacy: boolean }
  seed: number; seedText: string
  era: number; age: 1 | 2 | 3; phase: 'genesis' | 'select' | 'council' | 'era-reward' | 'won' | 'game-over'
  lives: number; seeds: number; playsLeft: number; discardsLeft: number
  world: {
    regions: { id: number; terrain: string; development: number; order: number; civ: number | null; blighted: boolean }[]
    stats: Record<Stat, number>; strain: Record<Stat, number>
    crisis: { id: string; severity: number; revealedAtAge: number } | null
  }
  civs: { uid: number; archetype: string; traits: string[]; name: string; region: number; tier: 1 | 2 | 3;
          relations: Record<number, -1 | 0 | 1>; founded: [era: number, age: number]; demand: DemandState | null }[]
  deck: { uid: number; def: string; magnitudeDelta: number; evolved: boolean }[]   // piles hold uids
  hand: number[]; drawPile: number[]; discardPile: number[]; selected: number[]
  legendaries: string[]            // ids, shelf order = trigger order
  consumables: string[]; relics: string[]
  council: Record<ShelfKind, string[]>; councilVisitBuys: string[]
  chronicle: ChronicleEvent[]
  nextUid: number
}

interface RunSave { schema: number; rulesVersion: number; contentHash: string; savedAt: string;
                    seedText: string; actions: Action[]; snapshot: AscensionRun }

interface Profile {                 // separate key, MIGRATABLE (unlike runs)
  schema: number                    // + ordered migration functions schema n → n+1, each unit-tested
  unlocks: string[]; discoveries: Record<string, { firstSeenRunSeed: string; at: string }>
  ascension: { maxCleared: number }; pantheon: LegacyEntry[]  // cap 20
  stats: { runs: number; wins: number; bestScore: number }
  settings: { reducedMotion?: boolean; locale: string }
}
```

**Save policy split.**

- **Runs** stay strict: reject and preserve, as today.
- **Profile** is migrated forward. It is never rejected wholesale, because losing
  meta-progression is unacceptable.
- The profile format needs **Save Data Migration Approval** before implementation.

---

## 12. Keep / Extend / Refactor / Replace matrix and preservation plan

| System | Decision | Rationale |
|---|---|---|
| `rng.ts` (mulberry32, hashSeed) | **Keep** | Correct, tested, tiny. Streams wrap it |
| `poker.ts` evaluator | **Keep** | Ascension's input. Already has exhaustive tests |
| `buildPlan` single pipeline + preview==commit | **Extend** | Becomes the phased pipeline (§8.2) for Ascension. Classic untouched |
| Pure reducer `applyAction` + `Action` union | **Keep** (pattern) | Ascension reuses the pattern with its own action set |
| v8 economy bounds | **Keep** (as design law) | Measured fixes for real runaway bugs |
| `worldhand.ts` Classic rules | **Keep frozen** | The regression fence. Bug fixes only, each with a rules bump as today |
| Content tables (TS arrays) | **Keep for Classic** / **Replace for Ascension** (JSON packs) | No forced migration of working content |
| Joker `fires` switch | **Keep in Classic**. Superseded by the effect DSL in Ascension | — |
| Save envelope + strict gate + export/import | **Keep** for runs. **Extend** with an action log + content hash | Proven safe |
| Profile/meta store | **New** (migratable) | Needs approval |
| `log` (English strings) | **Keep in Classic**. **Replace** with Chronicle events in Ascension | i18n and narrative |
| `App.tsx` | **Keep** for Classic. New screens as separate components | Avoid churn in working UI |
| `Planet3D.tsx` | **Extend** | Already renders engine region state. Add civ markers, crisis overlays, terrain from state. Lazy-load it |
| Accessibility, keyboard, reduced motion, no-emoji audit | **Keep** | Commercial quality floor |
| Portable single-file build | **Keep** | Distribution asset |
| `candidates.mjs` + P0–P4 policies + dev/held-out seed discipline | **Extend** | Balance harness (§17) |
| Stale scripts (`verify.mjs`, `balance-sweep.mjs`, many `review-*`) | **Archive or delete** | They fail on current code. Needs folder-move approval |
| World Level | **Replace** (in Ascension) with Eras | Largest passive-income source and a flat number |
| Wake-expansion laws | **Replace** (in Ascension) with Genesis and civ founding | They consume law slots illusorily (D9) |

**Preservation plan.**

1. **Before any refactor:** record **golden replays** for Classic. Use 200 seeds ×
   the 5 bot policies, and store the action logs plus a final-state hash.
   - Any engine change must keep every hash identical, or be a deliberate rules bump
     with a note.
2. The 211 tests, the portable QA and the harness numbers in §3 are the Classic
   acceptance bar in every phase.
3. Classic stays in the menu, and Classic saves keep their key and format.
4. Ascension ships behind a menu entry labelled "Ascension (prototype)" until the
   vertical slice.
5. No file moves, renames or save-format changes to Classic without the matching
   approval in §20.

---

## 13. Implementation phases (migration and implementation roadmap)

| Phase | Goal | Contents | Exit gate | Size |
|---|---|---|---|---|
| **0. Hygiene** | A trustworthy baseline | Commit `difficulty-measure.mjs` and `target-sweep.mjs`; update rules.md numbers to §3; add a GitHub Actions CI job (`test` + `build` + `build:portable`); fix D7 (error path) and D8 (legacy dup); fix D10 stale text; decide the LICENSE; add Classic golden replays | CI green; harness in repo; golden fixture committed | S |
| **1. Seams** | The Ascension core with zero Classic behavior change | `core/streams`, `core/events`, `core/effects` interpreter + table-driven tests; `content/registry` + `validate` + `content:check`; engine-purity test | Classic golden hashes identical; 211 tests pass; interpreter coverage ≥ 90% of ops/preds | M |
| **2. First playable** | Prove the loop (§14) | Ascension reducer, genesis, world tick, 6 civs, 3 crises, 12 legendaries, ~30 cards, template chronicle, run summary, minimal UI | FP success criteria (§14) | L |
| **Decision gate** | Continue / adjust / pivot the core loop (Option B?) | Bot + human playtest review | Human approval | — |
| **3. Vertical slice** | Commercial-quality slice (§15) | Polish, the missing screens, profile + unlocks (**migration approval**), A1–A5, legacy v1 | VS criteria | L |
| **4. EA production** | Content scale + platform | Content to EA targets, mods (data packs), localization pipeline, desktop wrapper, Steam | EA checklist (§16) | XL |

**Subsystem priorities.**

| Subsystem | Priority | Phase | Effort | Depends on |
|---|---|---|---|---|
| Golden replays + CI | P0 | 0 | S | — |
| Effect interpreter | P0 | 1 | M | streams, events |
| Content registry + validator | P0 | 1 | M | — |
| Named RNG streams / events | P0 | 1 | S | — |
| World stats + strain + WorldMult | P0 | 2 | M | interpreter |
| Civilizations (emergence, traits, tiers, relations) | P0 | 2 | L | world, content |
| Eras + crises | P0 | 2 | M | world |
| Legendaries | P0 | 2 | M | interpreter |
| Genesis draft + procedural terrain | P1 | 2 | S | streams |
| Chronicle + story compiler | P1 | 2 | M | events |
| Balance harness generalization | P1 | 2 | M | Ascension reducer |
| Run summary / history viewer | P1 | 2–3 | M | chronicle |
| Profile + migrations + unlocks | P1 | 3 | M | approval |
| Discoveries + encyclopedia | P2 | 3 | M | events, profile |
| Ascension levels | P2 | 3 | S each | interpreter |
| Legacy / pantheon | P2 | 3 | M | profile, chronicle |
| Replay viewer / seed sharing | P2 | 3 | S–M | action log |
| Localization pipeline | P2 | 4 | M | content keys |
| Mod loading (data packs) | P3 | 4 | M | registry |
| Desktop wrapper + Steam | P3 | 4 | M | storage adapter |

---

## 14. First playable scope (Phase 2)

**Single question:** *does making the world the build create meaningful decisions
without losing poker's legibility?*

| In scope | Amount |
|---|---|
| Eras | 3 (Tribal, Ancient, Medieval) × 3 Ages, with Age 3 as the crisis; then Endless |
| World | 12 regions (existing globe), 6 terrains, procedural assignment, 4 stats + strain |
| Genesis cards | 5 (draft 3) |
| Civ archetypes / traits | 6 / 20 |
| Crises | 3 (one per era; strain-weighted selection) |
| Legendaries | 12 |
| World cards | ~30 (plus the base 52 reskinned as Domains) |
| Council | cards, legendary (rare), patronize/suppress civ, 2 consumables |
| Narrative | Chronicle events + ~40 story templates + run summary page |
| UI | Minimal new screens; globe shows civs/crisis; breakdown shows pipeline phases |

**Out of scope:** profile, unlocks, legacy, ascension levels, localization, mods,
desktop and art polish.

**Success criteria.** All must hold on held-out seeds.

1. **Build coherence ≥ 3 epochs.** A focused-archetype policy beats the scattered
   policy by ≥ 3 Ages. Classic today: 1.7.
2. **≥ 3 archetype policies** have median depth within ±15% of each other. No
   single dominant civ or legendary.
3. **No invariant violations** in 2,000 fuzzed runs: finite scores, retrigger caps
   held, deck cap held, preview == commit.
4. Every legendary and crisis fires in ≥ 5% of bot runs where it is present.
5. **Human check.** 5 playtesters, 3 runs each, can explain *why* they won or lost in
   world terms (the think-aloud protocol from `docs/development/playtest-handoff.md`).
6. Classic is unchanged: golden hashes, 211 tests, portable QA.

---

## 15. Vertical slice scope (Phase 3)

- All 8 eras playable end-to-end with a **win** screen. Endless continues.
- About 80 world cards, 25 legendaries, 8 civ archetypes, 40 traits, 8 crises and
  20 events.
- Profile with migrations, an unlock graph (~30 nodes), discoveries and encyclopedia
  (~25), A1–A5, and legacy v1 (enshrine 1 of 4, pantheon 20).
- UX:
  - run summary;
  - civilization timeline;
  - event history browser;
  - card collection;
  - seed sharing (text code; Legacy off);
  - replay of a finished run from its action log (step and scrub).
- A presentation-quality art direction for cards and the globe (branch in §19).
- Balance report generated per build. Held-out metrics stable across two
  consecutive content drops.

---

## 16. Early Access content roadmap

| Drop | Cards | Legendaries | Civs / traits | Crises | Events | Relics | Bosses (named crises) | Ascension |
|---|---|---|---|---|---|---|---|---|
| EA launch | ~150 | ~40 | 12 / 60 | 16 | 40 | 25 | 8 | A1–A10 |
| EA update 1 | +60 | +20 | +4 / +20 | +6 | +20 | +20 | +4 | A11–A15 |
| EA update 2 | +80 | +30 | +6 / +30 | +10 | +20 | +25 | +4 | A16–A20 |
| 1.0 | 300+ | 100+ | 25+ / 120+ | 35+ | 100+ | 80+ | 20+ | 20 + challenge variants |
| Post-1.0 / mods | → 500+ | → 150+ | → 50+ | → 50+ | … | → 100+ | … | community packs |

**Rule for every drop:** each content drop ships only after the balance harness
shows no new dominant archetype. That is the gate for adding content, not the
content count.

---

## 17. Testing and balance strategy

### 17.1 Correctness (runs in CI on every push)

- **Unit, table-driven:** poker (existing), every `Pred` and `Op`, stat aggregation,
  strain, and the world-tick order.
- **Contract:** preview == commit, the 1:1 action → state transition, and the phase
  machine.
- **Property and fuzz:** a legal-action generator built by extending
  `candidates.mjs`. Random runs assert:
  - finite numbers;
  - caps held;
  - card conservation (as deck uids);
  - civ count ≤ 5;
  - no action accepted in the wrong phase.
- **Golden replays:** Classic (200 seeds × 5 policies) and Ascension (a smaller set,
  re-baselined deliberately on rules bumps).
- **Replay determinism:** save → replay the action log → identical snapshot, in Node
  and in a browser (Playwright).
- **Content:** `content:check` for schema, references, locale keys and exclusivity
  tags. Every legendary must fire at least once in N bot runs.
- **UI:** the existing `qa-portable.mjs` / `qa.mjs`, plus one smoke flow per new
  screen.

### 17.2 Balance (a harness run per build, reviewed by a human; not a CI gate)

Invariants gate CI. Balance numbers are *reported*, following the existing practice
("reported as measured, not band-forced").

- **Seed discipline** (kept): tune constants on the dev set, report on the held-out
  set, and never tune on held-out.
- **Deterministic bot policies:**
  - the existing P0–P4;
  - one focused policy per civ archetype;
  - one per legendary family;
  - "greedy-WorldMult" (breadth);
  - "max-lean" (strain maximizer).
- **Metrics:**
  - depth (median, IQR, win rate at era 8);
  - **pick rate** and **win-rate lift when picked vs. offered**, with Wilson
    intervals, for every card, legendary and civ;
  - archetype spread (the ±15% target);
  - Seeds unspent and shelf saturation (economy stress);
  - crisis kill-share (which crises end runs).
- **Degeneracy detectors:**
  - Infinite loops: any trigger chain exceeding its `limit`, or per-hand retriggers
    at the global cap, gets logged with seed and action index.
  - Runaway: score / target > 100 for 3 consecutive Ages.
  - Exponential: log(score) slope over Ages exceeding the target slope for 5+ Ages.
- **Synergy outliers:** pairwise co-occurrence lift of legendary × legendary and
  legendary × civ in top-decile runs compared with baseline. Pairs above a threshold
  get manual review and exclusivity tags if needed.
- **Mandatory-pick detector:** any item whose offered-but-skipped runs lose more than
  X% more often.
- **Human playtests** each phase, using the existing think-aloud handoff format.
  Bots measure bounds; humans measure fun.

---

## 18. Risk matrix

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | The world layer adds complexity without adding meaningful choice (the core design risk) | Med | **High** | First-playable gate with numeric + human criteria. Option B fallback. Keep Classic |
| R2 | Scope creep toward content volume before the loop is proven | High | High | Content counts gated by the harness (§16). Release-scope approvals |
| R3 | Multiplicative legendaries recreate v7-style runaway | Med | High | Bounded `Num`, retrigger caps, numeric guard, outlier detectors |
| R4 | Determinism breaks (stream coupling, iteration order, floats) | Low–Med | High | Named streams, integer or rounded stats, replay tests in Node + browser |
| R5 | Meta-progression lost to save incompatibility | Med (history: 8 rule versions in 2 weeks) | High | Profile separate + migratable. Runs stay strict |
| R6 | Legibility collapse: too many numbers per hand | Med | High | Phased breakdown UI, one hero number, clear "why" line items. Playtest criterion 5 |
| R7 | Classic regresses during the refactor | Low | Med | Golden replays + 211 tests + portable QA as the fence |
| R8 | Perceived as a Balatro clone | Med | Med | Lead marketing and UX with the world, history and legacy. Distinct vocabulary (Ages, Council, Legendaries, Domains) |
| R9 | Solo-developer bandwidth versus the L/XL phases | High | Med | Strict phase gates. The first playable is deliberately small |
| R10 | License ambiguity blocks commercial or OSS plans | Med | Med | Decide in Phase 0 |
| R11 | three.js performance and memory on low-end or mobile | Low–Med | Med | Lazy-load, a quality toggle, the 2D legend fallback that already exists |
| R12 | Retrofitting localization later is costly | Med | Med | Ascension is key-based from day one |

---

## 19. Open questions (treated as design branches)

| Question | Branches | Recommendation | Affects |
|---|---|---|---|
| Engine/runtime | Web stack · Godot · Unity | **Web stack** + desktop wrapper | Everything; §9.3 |
| Platforms | PC only · PC + Deck · + mobile · + console | **PC + Steam Deck first**. Keep the layout touch-safe (it already is at 480 px). Mobile post-1.0 | Input, UI density, wrapper |
| Community features | None · seed codes · daily seed + async leaderboard | **Seed codes** (free, offline) in VS. Daily/leaderboard needs a backend. Defer | Backend, anti-cheat (replays make verification possible) |
| Visual style | Pixel · illustrated cards · 2D HD · 3D hybrid | **Illustrated cards + existing 3D globe** (hybrid) | Art budget, card templates |
| Commercial vs open source | Commercial closed · open core · fully OSS | Undecided. **Resolve LICENSE first.** Open content format + closed art is a common middle path | License, mod policy |
| Distribution | Steam · itch · web demo · consoles | Steam (EA) + itch/web demo (the portable build) | Wrapper, storefront assets |
| Mod scope | None · data packs · scripted mods | **Data packs** (DSL only) at EA. Scripted mods only with a sandbox, post-1.0 | Registry, security |
| Online features | None · cloud save · telemetry (opt-in) | Steam Cloud via file storage. Opt-in local balance telemetry export only | Privacy, backend |
| Classic long-term | Keep as a mode · retire at VS | Keep until the Ascension VS beats it in playtests | Maintenance |

---

## 20. Approval gate

**Nothing below has been started.** Please approve, amend or reject each item.

| # | Decision requested | Unblocks |
|---|---|---|
| 1 | **Phase 0 hygiene**: commit the two local balance scripts; CI workflow; fix D7/D8/D10; Classic golden replays; update rules.md numbers | Trustworthy baseline |
| 2 | **LICENSE**: MIT as declared, or another | Commercial/OSS positioning |
| 3 | **Strategy**: Classic frozen + Ascension as a second ruleset on shared core (no rewrite) | Phase 1 |
| 4 | **Core-loop direction**: Option A (poker + world-as-build) vs B vs C (§6) | Phase 2 design |
| 5 | **Content format** for Ascension: JSON packs + runtime validator (Classic content untouched) | Phase 1 registry |
| 6 | **Phase 1 seams** (new files only, no Classic behavior change) | Phase 2 |
| 7 | **First-playable scope and success criteria** (§14) | Phase 2 |

**Explicitly deferred to later approvals:**

- **Architecture Refactor:** moving or splitting `worldhand.ts`, porting Classic onto
  the interpreter.
- **Save Data Migration:** profile format and migrations; any change to the Classic
  save envelope.
- **Content Pipeline Replacement:** moving Classic content to packs.
- **Large File/Directory Reorganization:** archiving stale scripts, `src/` restructure.
- **Release Scope:** anything beyond the approved first playable.
