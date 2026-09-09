# Worldhand — Independent Review (v3, post-playtest-fix round)

**Reviewer:** Independent subagent (Hermes), delegated-child session. Routing metadata per required delegation override: **provider `ollama-cloud`, model `glm-5.3-flash`** (session-configured route; not the coordinator model `deepseek-v4-flash:0731`, no recursive delegation). All claims below cite tool outputs produced in this session.
**Date:** 2026-09-09 (13:00–13:40 EDT) · **Repo:** `/Users/giofiore/Documents/Codex/worldhand` · **HEAD at review start and end: `43c803f`** ("qa: refresh screenshots after target calibration"). Working tree had no source changes at review start (only screenshot PNG churn); the implementation worker's edits are already committed in the tree at `6f49ca8`, `8c1d73e`, `43c803f`. File mtimes show the last source edits landed ~34–49 min before my review began — the implementation worker had stabilized.
**Scope:** full test/build/QA battery, engine/UI/save/solver inspection, new independent Playwright probes for the save-rejection and lives-reach-zero paths. No engine/test/docs files modified by me; no tests weakened; no requirements rewritten. Two new review scripts added (§ 7). One long-standing pre-existing dev server was briefly killed and restarted unchanged (same `npm run dev` command, port 5177) — no state modified.

---

## 0. Verdict up front

**The engine lives/scoring/solver-targets contract is solid and verified. Two of the four assigned issues are fixed in the engine but their SAVE-side and SOLVER-side counterparts are NOT fully fixed in the current tree**, and the implementation worker's most recent commits (calibration) postdate the save-policy files by many commits, so I judged the worker done with save.ts/solve.mjs and documented precisely (no fixes applied — see § 5 for the decision).

| # | Issue | Status | One-line summary |
|---|---|---|---|
| 1 | Save/LOAD versioning + structural validation | **PARTIAL** | SAVE_VERSION=2 exists and legacy v1 is preserved-and-rejected, but there is **no structural validation** (missing lives / obsolete item ids / invalid phase / malformed cards load as a broken playable game), no UI message about a fresh run, and **Clear Save has no confirmation**. |
| 2 | solve.mjs policy | **FAIL (stale)** | score() **still contains drought/stability-era logic**; the documented policy text no longer matches the shipped targets (12-era comments); purchase policy is undocumented. |
| 3 | Lives contract | **PASS** | 3 lives, miss→−1, 0→withered, consistent across HUD/RULES/tests/engine. |
| 4 | Scoring communication | **PASS (with one doc gap)** | chips × mult is honest single-application; kickers-in-sum true but **undocumented**; base=sum×mult asserted in tests + independently re-verified. |

Corrected bounded-solver win rate (measured this session): **LOOK=30 → 16/30 (53%)** on shipped [45,110,360].

---

## 1. Verification battery (all run by me on this tree, this session)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **clean, exit 0** |
| Unit tests | `npx vitest run` | **70/70 passed** (2 files: poker + worldhand) |
| Build | `npm run build` | **green** (dist/assets/index-BXni0gEu.js 762 kB / gzip 205 kB; >500 kB chunk warning only) |
| Playwright QA | `node scripts/qa.mjs` | **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 and 480×800**, zero console/page errors (script fails on any error; `errors.length` gate confirmed by reading qa.mjs:74) |
| 3D planet | `node scripts/review-planet3d.mjs` | **PLANET3D CHECKS PASSED**, 0 pageerror/console-error lines at both viewports |
| Engine probes | `npx vite-node scripts/review-probe.mjs` | all assertions true; conservation 52 cards, 0 violations across 12 plays + 9 discards + 4 buys; `lives-zero-ends-withered: true`; `autoseeds-formula-10-growth: true` |
| Full-run UI | `node scripts/review-fullrun.mjs` | 3 epochs traversed to verdict, `errors: []` (known benign probe quirk: `data-testid="epoch-end"` phase shows "unknown" in the probe; Close/Continue fallback handles it, documented in PLAYTEST_HANDOFF) |
| Preview==commit | `node scripts/review-pvcommit.mjs` | `MATCH: true`, `category-match: true` |
| Two-viewport | `node scripts/review-browser.mjs` | both viewports pass, `errors: []`, quit-preserves-save `3421→3421 bytes` |
| Autosave | `node scripts/review-autosave.mjs` | PASSED (post-start/post-play/post-discard saves; quit preserves) |
| No-Drought | `node scripts/drought-legibility.mjs` | `NO-DROUGHT ASSERTION: PASSED` (3 seeds) |
| No-emoji | `python3 scripts/check-no-emoji.py` | PASSED |
| Dev server | `npm run dev` (port 5177) | HTTP 200 throughout browser checks |

## 2. Issue 1 — SAVE/LOAD versioning + structural validation: **PARTIAL**

**What IS fixed (verified in code + browser):**

- **SAVE_VERSION distinguishes the new engine.** `src/engine/worldhand.ts:31` → `SAVE_VERSION = 2`; fresh states are stamped `version: 2` (setupWorld). Envelope `{version, savedAt, state}` in `src/ui/save.ts`; `CURRENT_VERSION` re-exported. A same-version envelope round-trips (test `v2 state round-trips through JSON`).
- **Old-version saves are rejected AND preserved as recoverable legacy data.** `loadGame()` returns null for `env.version > CURRENT_VERSION` (forward-only) and for version < 2 via `migrate()` → `null` (save.ts:36–41: "v1 (old 8-epoch contract) is incompatible… discard stale v1 saves rather than guess a migration" — the *load* discards, not the storage). My browser probe wrote a v1 envelope (lives:2, Roots-era shape), reloaded: the intro menu stayed (no silent resurrection), and the raw localStorage envelope was **byte-preserved** (`env.version===1 && env.state.lives===2` still readable afterwards). "Load Saved World" on a legacy save returns the menu with error "No saved world found." — non-destructive.
- **Quit preserves progress.** `Quit` button (`src/App.tsx:135–141`) only `setState(null)`, never touches localStorage — my probe confirmed the save string is byte-identical before/after Quit; reload auto-loads via the mount `loadGame()` effect and the auto-save `useEffect` (App.tsx:61–63) persists every committed action.
- **Tests:** 70/70 green; lives serialization + envelope shape covered (`lives are serialized in the save envelope`, `v2 state round-trips through JSON`).

**What is NOT fixed (browser-verified, with the probe script kept at `scripts/review-save-lives-browser.mjs`):**

1. **No structural validation of the v2 state.** `loadGame()` checks only the envelope version; a version-2 envelope containing *any* garbage state loads verbatim (`return env.state`). Probe outcomes at 1280×800:
   - **missing lives** → game loads; HUD renders a literal empty value: `Lives /3` (broken UI, no error).
   - **invalid phase** (`phase:'epoch-99'`) → loads; the App falls to the select-branch rendering an empty game.
   - **obsolete market/law item id** (`laws:[{id:'deep-taproots'}]`, Roots/Tend/Sow/Grow/Study-era) → loads as a playable game; the chip renders with an empty label; a later plan would treat it as a law contributing 0 (silent reinterpretation).
   - **malformed card** (`hand:[{r:1,s:'Z'}]`) → `loadGame()` itself returns the state (no card validation), and **a pageerror `TypeError: Cannot read properties of undefined (reading 'split')` is thrown during render** (cardName reads `.split` on an undefined rank name); the game then renders as playable. The engine also accepts such cards at play time: `buildPlan([{r:1,s:'Z'}],[0],[])` → `valid:true, growth:1`; rank 1 → Growth 1; suit 'X' → Growth 5. There is no rank∈[2,14]/suit∈{S,H,D,C} guard anywhere in the load or scoring path.
   - **forward version** (`state.version:99` in a v2 envelope) → loads as playable (the envelope version is checked, the inner state version never is).
2. **No UI explanation that a fresh run is needed.** On a legacy/corrupt save the menu shows only the standard copy; nothing says the save was stale/incompatible or that a fresh run is needed (grep for fresh/stale/incompatible in src: only code comments in save.ts). The data being preserved does mitigate this (user can hand-recover), but the assigned UX requirement is unmet.
3. **Destructive reset has NO confirmation.** `Clear Save` calls `clearSave()` directly (App.tsx:109): my probe listened for a dialog — `clear-save guard observed: none`, and the save is destroyed immediately. Similarly, the game-over screen's **"Back to Menu" clears the save with no confirmation** (verified: localStorage emptied, no dialog). The assigned requirement "destructive reset requires confirmation" is unmet.

## 3. Issue 2 — solve.mjs policy: **FAIL (stale drought-era code + undocumented policy)**

`scripts/solve.mjs` (last touched in `6f49ca8`'s era; commit for it: `6f49ca8`, earlier than the calibration commits) still contains, verbatim (lines 77–91):

```js
// Only two things decide the ending: final Flourishing >= 12, and the epoch-3
// drought (every living region at stability 3+). Score for exactly those.
const droughtRisk = after.epoch === 3 ? living(after).filter((r) => r.stability < 4).length : 0
const wakePenalty = after.epoch === 3 ? -60 * woke : 0.5 * woke
if (after.epoch === 3) {
  // Flourishing 12 is already banked long before here; epoch 3 is the drought.
  const shortfall = living(after).reduce((n, r) => n + Math.max(0, 3 - r.stability), 0)
  return -shortfall * 100 + wakePenalty - droughtRisk * 5 + df * 2 + stab * 1.5
}
return df * 10 + stab * 1.2 + ds * 0.4 + wakePenalty - droughtRisk * 2
```

- **Stale drought/stability-era logic: CONFIRMED.** The Drought and stability-driven loss were removed in `6f49ca8`; the current loss rule is lives-only (worldhand.ts:534–545, 578–595). The solver still (a) penalizes stability <4 at epoch 3 (`droughtRisk`), (b) penalizes a stability shortfall ×100 (`shortfall`), (c) treats waking a region in epoch 3 as a liability (−60/region) — none of which decides any outcome in the current engine, and (d) comments a target of 12 (the ladder is 45/110/360). The engine-level parts (`df`, `ds` on Growth/Seeds) are current-mechanics, so the probe still functions, but the score() is not "only the current mechanics" as assigned: it is a mix, and its stale terms distort the policy (e.g. it avoids expansions in epoch 3 for a drought reason that no longer exists).
- **candidateSubsets spans 1–5-card candidates: PASS.** `subsets(n)` enumerates every 1..5-card selection (mask loop, `s.length <= 5`), so with LOOK unset/exhaustive the search spans all poker-category candidates (pairs, flushes, straights, 3/4/5-card). Under a LOOK cap the space is truncated deterministically (shorts first + seeded sample) — bounded by design, not limited to 1–2 card combos by policy (LOOK=30 found flushes/straights in runs; exhaustive LOOK≥218 covers everything).
- **Discard policy: present and sensible** (playSeed lines 118–125): spends a discard when the best candidate's value is weak (`b.v < 6`) and dumps the cards the best play didn't want (up to 5). It works, though `v < 6` is a magic number with no doc comment.
- **Purchase policy: present but UNDOCUMENTED** (lines 127–139): fixed priority order canopy-choir → seed-vaults → barter-routes → mycorrhiza → open-canals → stone-masonry, greedy until funds/slots run out, `endMarket` after. No comment states the rationale (cheapest flat Growth per Seed first), no handling of card-additions/expansions (never bought), and LAW_SLOTS/removal is never exercised (buys just fail via throw-catch at the 5-slot cap).
- **Calibration seeds separate from evaluation seeds: NOT IMPLEMENTED.** The script has a single seed list (`probe-0..29`) used both as the calibration target sweep and the evaluation run; there is no seed split (e.g. calib-* vs eval-*), no separate flag, nothing in the code or docs.
- **"Human win-rate estimate" labeling: ABSENT in solve.mjs (PASS), but a variant exists in docs.** grep for "human win-rate"/"human win" across src/scripts/tests/docs: only `RULES.md:70` "**LOOK=30 is the bounded-human reference**". That is a policy-strength label ("bounded human-like reference"), not a win-rate estimate claim, and README:81 + PLAYTEST_HANDOFF:82 correctly say "bounded balance probe (win rate over 30 seeds)" / "bounded win rate". Strictly: nothing is labeled a "human win-rate estimate"; the label asked for ("bounded solver result") appears nowhere verbatim, though "bounded balance probe" and "bounded-human reference" carry the same meaning. I flag RULES.md's "bounded-human reference" as the one borderline phrase; a doc tweak to "bounded-solver reference" would fully align it.

**Corrected bounded-solver win rate (measured by me this session, current tree):**

| Policy | Wins /30 | Notes |
|---|---|---|
| `LOOK=30 npx vite-node scripts/solve.mjs` | **16/30 (53%)** | final F min 294 / median 372 / max 446 |
| LOOK=12 | 3/30 (10%) | final F min 246 / median 304 / max 390 |
| `--look=200` (near-exhaustive) | 30/30 (100%) | min 1018 / median 1269 / max 1761 |

The shipped [45,110,360] sits at 53% under the bounded reference — inside the intended 40–60% band, achieved without forcing (I did not retune anything; this is the reference method's own output). Because score() still carries stale terms, I also spot-checked that the number is stable in shape: the policy's epoch-3 drought/wake terms are inert for outcome purposes (stability never gates the win; waking adds Seed income only), so the 53% is a *bounded solver result* on the live mechanics, though the score needs cleaning to be an honest probe (see § 5 recommendation).

## 4. Issue 3 — Lives contract: **PASS (all four surfaces consistent)**

- **Engine:** `SURVIVAL_START = 3`/`LIVES_CAP = 3` (worldhand.ts:40,46); `state.lives` init 3 (setupWorld); miss on epoch 1/2 → `lives -= 1` + halved epoch income (endEpoch:536–545 + `marketIncome` line 565); `advanceToNextEpoch` → lives ≤ 0 ⇒ `game-over`/`withered`, reason "Out of lives… the world withers" (578–595). Epoch-3 miss costs no life (already terminal) — smallest coherent change (a pure rename of the old Survival pool; grep confirms `Survival` survives only in two comments).
- **HUD:** `Lives {state.lives}/{SURVIVAL_START}` with title "Lives — a missed epoch target costs 1; 0 ends the run" (App.tsx:154–157); intro copy "lose a life; three misses and the world withers".
- **RULES.md §Lives:** exactly the engine rule (3 lives, miss e1/e2 → −1 + halved income, 0 → withered, e3 miss terminal).
- **Tests:** dedicated `Balatro-style lives` describe block (worldhand.test.ts:252–360): starts 3; e1 miss → exactly 1 lost + halved log line; met → no loss; e2 miss → 2 left; 1+miss → 0 lives then boundary → withered, reason contains "lives"; 0-at-boundary → withered; e3 miss → no life cost; win = beat 360. All green in my run.
- **Actual outcome:** engine probe `lives-zero-ends-withered: true`; my independent probe (scripts/review-independent.mjs) drove 1 life + 2 missed targets → `lives===0` → market still opens → closeEpoch → `game-over`/`withered`, reason mentions lives. **The rule is the smallest coherent change** (no new mechanics — the former Survival pool with the same semantics, renamed and surfaced as Lives).

## 5. Issue 4 — Scoring communication: **PASS (display honest, one doc gap)**

- **Display is honest (no re-multiplication):** `buildPlan` computes `pokerBase = Math.round(sum × CATEGORY_MULT[category])` **once** (worldhand.ts:241–242); laws then apply on top: `growth = max(0, round(pokerBase × lawMult) + lawFlat)` (244–248). The UI pill shows `{plan.pokerBase} chips × {plan.mult} mult` (App.tsx:271–273, also in the preview `{plan.pokerBase} chips × {plan.mult} mult`) — pokerBase is the already-multiplied base, mult the category multiplier; nothing multiplies twice. The summary line matches (`Banks ${growth} Growth (${pokerBase} chips x ${mult} mult${laws})`). Verified live in review-pvcommit: `16 chips × 1 mult` for J♣5♠ (rankSum 16, high ×1) — exact.
- **Test asserts base = sum × mult consistency: PASS.** worldhand.test.ts:199–207 (`poker base = round(rankSum × CATEGORY_MULT[category])` for high and flush), and :220–224 (`growth == max(0, poker + laws)`). I re-verified independently across a 1–5-card × law-variant sweep: `growth == max(0, poker + laws)` and `pokerBase == round(rankSum × mult)` hold for every case, including straight-flush ×8.
- **Kickers contributing to the sum: TRUE but undocumented.** The full selection's rankSum feeds pokerBase (e.g. pair K+K with Q kicker: rankSum 38 → base 57; with T kicker: 36 → 54). poker.ts comments `kicker values` in the comparison key only; **neither RULES.md nor README says that non-scoring kickers still add chips to the Growth sum.** Minor doc gap — the math is visible on screen (rankSum × mult), but the rule text should say "kickers add their ranks to the sum".

## 6. Remaining problems (ranked)

1. **save.ts: no structural validation, no UI explanation, no confirm on destructive reset** (details § 2). Highest-impact: a corrupt-but-version-2 save renders a broken game with a pageerror (the `r:1,s:'Z'` hand crashes `cardName`). This is the only path where I could produce a real page error.
2. **solve.mjs score() stale drought/stability logic + undocumented purchase/discard rationale + no calibration/evaluation seed split** (§ 3). The 53% number remains trustworthy as a bounded solver result, but the script's scoring text/behavior contradicts the shipped contract and its doc.
3. **Kickers-in-sum not documented** in RULES.md (§ 5). One sentence.
4. Minor: `Back to Menu` on game-over clears the save without confirmation (same family as #1); `hasSave()` is dead code in the load path; `evaluate()` header comment in poker.ts still says "up to 7 cards" (cosmetic; unchanged since v2).

## 7. Bugs found and fix policy decision

Two real defects documented above (save structural validation; solve.mjs staleness). **I made no code/test/docs changes.** Reason: the last commits touching `src/ui/save.ts` (`810b392`) and `scripts/solve.mjs` (`6f49ca8`) are several commits older than the worker's latest calibration commits (`8c1d73e`, `43c803f`), which suggests the worker's attention has moved past those files — but the assignment says to make only a minimal safe fix *if the worker is clearly done*, and the concurrent-fix brief for this same tree makes "clearly done" unverifiable from the tree alone. The safe call per instructions: document precisely, fix nothing. Suggested minimal fixes when the worker signs off (not applied):

- **save.ts** (~20 lines): after `env.version === CURRENT_VERSION`, validate `state` before returning: `phase ∈ {select, market, epoch-end, game-over}`; `Number.isInteger(lives) && lives ≥ 0 && ≤ 3`; every `hand` card has `r ∈ 2..14` and `s ∈ {S,H,D,C}`; every owned/market law id ∈ `MARKET_ITEMS` ids; return null otherwise (leaving storage untouched preserves the recoverable legacy data). Add a one-line menu note when `hasSave()` is false but a legacy envelope exists, and a `confirm()` (or two-step button) on Clear Save / Back-to-Menu.
- **solve.mjs** (~30 lines): replace score() with current-mechanics scoring (`df × 10 + ds × 0.4 + seeds-cap-aware bonus`; drop droughtRisk/shortfall/wakePenalty/stab, update the "Flourishing >= 12" comment to 360); document the purchase order in a comment; add `CALIB_SEEDS`/`EVAL_SEEDS` lists (or `--calib`/`--eval` flags) so the calibration sweep and the reported win rate use disjoint seed sets; rename the RULES.md "bounded-human reference" phrase to "bounded-solver reference".

## 8. Honest assessment of the ruleset's coherence

**Coherent, for the first time in this repo's review history.** The current contract closes cleanly:

- One hero number (Growth = round(rankSum × category mult), + law mult/flat) drives the target, the Seeds economy, and the solver — one quantity, one pipeline, preview == commit both in engine tests and in the browser (`MATCH: true`).
- Loss and win are single-rule: 3 lives drain only on missed epoch-1/2 targets; the run ends at the epoch-3 boundary either way; no drought, no stability gate, no region choices. RULES.md, HUD, intro copy, tests, and engine agree on every number I checked ([45,110,360], lives 3, seeds cap 30, 4 plays/3 discards/epoch).
- The one thing I would not call fully coherent is the *tooling fringe*: the balance probe still reasons about a removed drought, and the save layer trusts its input. Neither changes what a player faces in a normal run; both should be cleaned before the next calibration pass so the 53% figure is computed by a script that matches the game it calibrates.

The 53% bounded win rate is in the intended band and brackets correctly (10% very-bounded / 100% near-exhaustive). I did not force the band; the shipped targets produce it under the reference method as-is.

## 9. Evidence artifacts (this session)

- `scripts/review-independent.mjs` — engine probes: lives-reach-zero outcome, growth/base consistency sweep, malformed-card behavior, save-shape.
- `scripts/review-save-lives-browser.mjs` — Playwright: legacy v1 save preserved+rejected, obsolete law id, missing lives/invalid phase/malformed card/forward-version loads, Quit byte-preserving save, reload auto-load, Clear Save guard, Back-to-Menu destructiveness. (Both scripts are review-only; they touch no game code.)
- Reruns: `npx vite-node scripts/review-independent.mjs`, `node scripts/review-save-lives-browser.mjs` (dev server on 5177 required).
- All pre-existing review scripts re-run and green (list in § 1).

— End of independent review v3.

---

## 10. Post-fix note (same day, implementation pass)

The four issues documented above were fixed in commit `d8eae6c` on this same tree:

1. **Save versioning/validation** — `SAVE_VERSION=3` + `SCHEMA_VERSION=3`, `validateState()` structural gate, incompatible saves preserved verbatim under `worldhand.save.legacy.<ts>` with a fresh-run explanation (`[data-testid=save-reject]`), two-step confirmation on Clear Save / Back-to-Menu. The § 7 suggested minimal fix was implemented in full (plus legacy-blob preservation, which the suggestion left out).
2. **solve.mjs** — fully rewritten: current-mechanics score, category-spanning 1–5-card candidates, discard evaluation, documented purchase order, disjoint CALIB (`probe-*`) / EVAL (`eval-*`) seed sets, "bounded solver result" wording. The recalibrated [30, 70, 320] measures LOOK=30: 83% (eval) / 80% (calib), LOOK=12: 3%/10%, exhaustive 100%.
3. **Lives** — the § 4 note that epoch-3 miss "costs no life" is now outdated by design: EVERY missed target (all three epochs) costs 1 life; the run ends only at 0 lives; the win check is separate. Regression-tested (3 misses → 0 lives).
4. **Scoring labels** — plan now carries `chips` (= rankSum, pre-mult) and the UI shows `chips × mult = base`; kickers' contribution is documented in RULES.md/README and pinned by a mutual-consistency test.

Suite: 87/87 tests, tsc/build/qa/review scripts green at commit time.

---

## 11. Independent re-verification on the stabilized tree (v4, this reviewer, post-fix)

**Routing metadata per required delegation override:** provider `ollama-cloud`, model `glm-5.3-flash` (session-configured; coordinator route `deepseek-v4-flash:0731` not inherited; no recursive delegation). All claims are tool outputs from this session.
**Re-verified at:** HEAD `98d67a4` ("qa: refresh screenshots on restored-target revision"), 2026-09-09 14:30–14:40 EDT. Working tree clean of source changes; the fix landed as `d8eae6c`, targets restored in `c148686`, coordinator verification/playtest in `51adee9`. My two review scripts (`scripts/review-independent.mjs`, `scripts/review-save-lives-browser.mjs`) were adapted by the worker to the v3 save shape (validateState calls, schema:3 envelopes, two-step-confirm probe) and committed — I re-ran the adapted versions and re-read their source to confirm the probes still assert the same properties (reject/not-loaded/preserved, two-step confirm, lives-zero outcome); the original pre-fix versions and their results remain in § 2 as the "before" evidence. Pre-existing review scripts were untouched by the worker except the one-line target string in `review-probe.mjs` (followed the engine's target restore `30,70,320 → 45,110,360`); `git diff 43c803f..HEAD` on qa/browser/fullrun/autosave/planet3d/pvcommit scripts is empty, and test deletions are exactly 11 lines (the two superseded lives tests + the v2 envelope describe-block, each replaced by a stronger v3 counterpart — no weakening).

### Battery on HEAD `98d67a4` (all run by me, this session)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` | **87/87 passed** (2 files) |
| `npm run build` | green (chunk-size warning only) |
| `node scripts/qa.mjs` | **PASSED 1280×800 + 480×800**, 0 console/page errors (grep for error lines: 0) |
| `node scripts/review-planet3d.mjs` | **PASSED**, 0 pageerror/console-error lines |
| `review-probe` (vite-node) | all assertions true, 0 fail lines |
| `review-fullrun` / `review-browser` / `review-autosave` / `review-pvcommit` / `drought-legibility` / `check-no-emoji` | all PASSED, `errors: []` |
| `scripts/review-independent.mjs` (v3-adapted) | **10/10** |
| `scripts/review-save-lives-browser.mjs` (v3-adapted) | **15/15**, `page errors: []`, `clear-save guard observed: two-step-confirm` |

### The four issues on the current tree

**Issue 1 — SAVE/LOAD: FIXED (verified in source, tests, and browser).**
- `SAVE_VERSION = 3` (engine-rules generation) + separate `SCHEMA_VERSION = 3` (envelope layout); `OBSOLETE_ITEM_IDS = ['deep-taproots','rich-soil','communal-tending','drought','stability-charter']` (worldhand.ts:49–51).
- `validateState()` (worldhand.ts:569–673) rejects, with plain-language reasons: (a) missing/non-numeric lives (`lives is missing or not a number`), out-of-range lives, and 0-lives-not-in-game-over phase inconsistency; (b) obsolete AND unknown item ids in `market`/`laws`; (c) invalid phase (not in `VALID_PHASES`) and invalid epoch/outcome; (d) malformed cards — non-integer rank outside 2..14 or suit outside S/H/D/C in any of hand/deckRest/discardPile — plus a 52-card conservation check; (e) old versions (`state.version !== 3`, envelope `schema`/`version` mismatch).
- **Legacy preservation:** `loadGameDetailed()` (save.ts:84–117) preserves the raw blob **byte-for-byte** under `worldhand.save.legacy.<ts>` (`preserveLegacy`, with a drop-oldest retry on quota) and returns `{state:null, rejectedReason, legacyKey}` — never erases, never partially migrates. Browser-verified: v1/legacy blobs and corrupt v2/v3 envelopes stay intact after load attempts; "Show preserved legacy blob" button exposes the raw JSON.
- **UI explains a fresh run is needed:** `[data-testid=save-reject]` panel with "Saved world is incompatible — a fresh run is needed", the reason, and the legacy key (App.tsx:103–124). Browser probe confirms it renders.
- **Quit preserves progress; destructive reset confirmed:** Quit touches nothing (byte-for-byte probe still passing); Clear Save and game-over Back-to-Menu are two-step in-UI confirm gates (step 1 keeps the save, Cancel keeps it, Confirm clears) — probe `two-step-confirm` passing.

**Issue 2 — solve.mjs policy: FIXED (verified in source and by fresh runs).**
- `score()` (solve.mjs:226–243) contains zero drought/stability terms — grep confirms; it scores Growth banked toward the current epoch target (with a reachability penalty), Seeds gained (discounted near cap), and life loss (−120/−400). Header states "current mechanics ONLY".
- `pokerCandidates()` (solve.mjs:111–199) spans deliberate 1–5-card category candidates: all 1–2 card selections plus pairs/trips/quads groups, two-pair/full-house combos, flushes (best + lowest same-suit 5), straights incl. ace-low wheel with suit preference, and best-rank 3/4/5-card fillers; `candidateSubsets` caps deterministically (candidates first, then seeded sample). Measured effect: LOOK=30 now evaluates real poker hands (the old bounded list could not).
- Discard policy: `maybeDiscard` dumps unwanted cards and keeps the refill only if the post-refill best beats the pre-discard best by +8 — sensible and documented.
- Purchase policy: documented priority order (canopy-choir → seed-vaults → barter-routes → open-canals → stone-masonry → fourth-counsel; expansions/mycorrhiza/fifth-counsel skipped with rationale) in the header (lines 27–38) and inline.
- Seeds disjoint: `CALIB_SEEDS` (probe-0..29, target sweeps) vs `EVAL_SEEDS` (eval-0..29, the reported result); `--set calib|eval` selects; default runs both and reports separately.
- Labeling: header says "NOT a human win-rate estimate: this is an automated BOUNDED SOLVER RESULT"; every run banner and output line says "bounded solver"; RULES.md §Balance is titled "bounded solver result — NOT a human win-rate estimate"; grep finds no surviving "bounded-human" phrasing and no "human win-rate estimate" label anywhere.

**Issue 3 — Lives contract: FIXED (uniform, exhaustible, consistent).**
- Engine: EVERY missed epoch target — 1, 2, and 3 — costs 1 life (endEpoch charges before the final verdict); the run ends only at 0 lives; the win check is separate ("flourishes … lives remaining: N"). The pre-fix epoch-3 free-miss is gone.
- Consistency: HUD tooltip "Lives — EVERY missed epoch target (all 3 epochs) costs 1; 0 ends the run" (App.tsx:193), intro copy (App.tsx:101), RULES.md §Lives, README, and the test suite all state the same rule.
- Tests: `the epoch-3 miss still costs its life (uniform contract, exercised through a real epoch-end)`, `missing the epoch-3 target ALSO costs 1 life (before the final verdict)`, and the regression `three misses across epochs 1–3 drain exactly 3 lives → 0` — the third test proves exhaustibility in ordinary play (previously impossible).
- My independent probe: 1 life + misses → 0 → boundary → game-over/withered with a lives reason. `review-fullrun` now ends "Out of lives (0): too many epoch targets missed" — an ordinary no-debt policy run can actually exhaust the pool.
- Smallest-coherent-change check: the rule is a uniform life cost with no new mechanics; the income-halving and boundary logic are unchanged in shape. Noted deviation from the pre-fix contract is deliberate and documented (uniform miss cost), not scope creep.

**Issue 4 — Scoring communication: FIXED.**
- The plan now carries `chips` (= rankSum, pre-multiplier) and `pokerBase` = `round(chips × mult)`; the UI/preview/log show `chips 17 x 2 mult = base 34` — the multiplication is shown as happening once (verified live: `Banks 37 Growth (chips 17 x 2 mult = base 34 +3 laws)`). No re-multiplication: `growthParts.poker === pokerBase` in every case.
- Kickers documented: RULES.md §"Kickers contribute (documented, non-standard)" spells out pair K+K+Q = 38 chips × 1.5 = 57 and that this is non-standard poker semantics.
- Test pins consistency: `plan chips/mult/base are mutually consistent: base = round(chips x mult) exactly (display can never drift from the formula)` (tests/worldhand.test.ts:220–239) across a multi-hand matrix; my independent sweep re-verifies `pokerBase === round(rankSum × mult)` and `growth === max(0, poker + laws)`.

### Corrected bounded-solver win rate (measured by me on HEAD `98d67a4`, authorized [45,110,360])

| Policy | eval-* (probe-*/calib in parens) |
|---|---|
| LOOK=30 | **16/30 (53%)** (20/30, 67%) — final F min 322 / median 360 / max 410 |
| LOOK=12 | 0/30 (0%) (1/30, 3%) |
| LOOK=250 (near-exhaustive) | 30/30 (100%) (30/30, 100%) — min 937/939, median 1224/1254, max 1871/1653 |

These are **bounded solver results** (machine heuristic, disjoint seed sets), not human win-rate estimates; I did not tune the heuristic or force any band. 53% sits inside the intended 40–60% band on the eval set as measured. The coordinator's HANDOFF (§ Coordinator verification, PLAYTEST_HANDOFF.md:79) records the same 53%/67% I measure.

### Remaining problems

1. **Stale solver table in RULES.md (doc-only, real).** RULES.md:104–108 still shows "LOOK=30 25/30 (83%) (24/30, 80%) … LOOK=12 1/30 (3%)" — numbers measured on the abandoned [30,70,320] ladder with the pre-restore code, and its "honest note" paragraph still discusses e3=320. The same stale numbers survive in PLAYTEST_HANDOFF.md:64 ("83%/80%") — a leftover from the pre-restore commit `d8eae6c`'s TASK C. PLAYTEST_HANDOFF's live Balance section (:22–25) carries the correct 53%/67%; **RULES.md's table contradicts both the restored ladder and my measurements.** Doc fix (worker/coordinator call, one table): replace with the 53% (eval) / 67% (calib), 0%/3% LOOK=12, 100% exhaustive numbers measured on [45,110,360]. Not edited by me — docs are the worker's in-flight lane.
2. Minor: `hasSave()` in save.ts remains dead code (the load path uses `loadGameDetailed`); cosmetic only.
3. Minor (pre-existing, unchanged): region development/stability remain presentation-only; the coordinator's playtest notes the planet "reads as decoration" — a design gap, not a correctness bug.

### Honest assessment of ruleset coherence

**The game now has a coherent ruleset, and this time the tooling agrees with the game.** One hero number (Growth = round(chips × mult) + laws) drives targets, Seeds, and the solver; loss is a single uniform rule (every missed target costs 1 life, 0 = withered); the win is a single check (final target while lives remain); the save layer refuses anything the engine cannot honor while keeping the old data recoverable; and the balance probe scores exactly the mechanics that exist. The four surfaces (HUD, docs, tests, engine) state the same numbers everywhere I checked. The only incoherence left is the stale RULES.md balance table (remaining problem 1) — it does not affect gameplay, but it is the one place a reader would learn a wrong win-rate number.

**Final status: all four issues verified FIXED on HEAD `98d67a4`. Battery: tsc clean, 87/87 tests, build green, qa 0 errors at both viewports, planet3d and all review scripts green, independent probes 10/10 + 15/15. Corrected bounded-solver result: 53% (eval) / 67% (calib) at LOOK=30 on the authorized [45,110,360].**

— End of independent review v4 (re-verification). § 1–9 above document the pre-fix state (HEAD `43c803f`) and remain the evidence baseline for what changed.

---

## 12. Independent review v5 addendum — the three playtest-defect fixes (2026-09-09, 15:16–15:50 EDT)

**Routing metadata per required delegation override:** provider `ollama-cloud`, model `glm-5.3-flash` (session-configured route; the coordinator's `deepseek-v4-flash:0731` was not inherited; no recursive delegation). Every claim below is a tool output produced in this session.

**Reviewed revision:** HEAD `9a5538d` ("fix: three playtest defects — Mycorrhiza decay, truthful Seed credit, final-epoch flow"), child of baseline `015a414`. I waited for the implementation worker to freeze its diff before judging: HEAD moved `015a414 → 9a5538d` at 15:16 EDT while I polled, and after the commit the only working-tree changes are screenshot PNGs plus my two reviewer-added probe scripts (`scripts/review-independent-v5.mjs`, `scripts/review-independent-v5-browser.mjs`). I made NO changes to source, tests, or docs. The worker's diff: `src/engine/worldhand.ts` (94 lines), `src/App.tsx` (14), `tests/fix-regressions.test.ts` (new, 363), `tests/worldhand.test.ts` (30), `RULES.md`/`README.md`/`PLAYTEST_HANDOFF.md`, `scripts/review-playtest-fixes.mjs` (new, 143), plus screenshot refreshes.

### Verdict up front — all three defects are genuinely FIXED

| # | Defect | Status | Key evidence |
|---|---|---|---|
| 1 | Mycorrhiza decay computed `stability − 2` | **FIXED** | `decay = max(0, 1 + decayDelta)`; decay 1 normally, exactly 0 with Mycorrhiza; income reads resulting stability |
| 2 | "Gains N Seeds" overstated vs the 30 cap | **FIXED** | one shared `seedCredit` contract; preview == committed balance == chronicle incl. `Credited/overflow` clause |
| 3 | Epoch-4 offer + useless market after the final hand | **FIXED** | final epoch resolves straight to the verdict exactly once; epochs 1–2 unchanged; reload inert |

Balance is unchanged (bounded solver re-measured below) — I make no balance claim either way.

### 1. Mycorrhiza decay — FIXED (verified in source and by execution)

- Source (`worldhand.ts`, `endEpoch`): `const decay = Math.max(0, 1 + decayDelta)`; loop skips dormant and `stability <= 0` regions and applies `stability = Math.max(0, stability - decay)`. So normal living-region decay is **exactly 1**; with Mycorrhiza (`decayDelta −1`) it is **exactly 0** — never `stability − 2`, never a gain. Dormant regions are never touched; 0-stability regions stay 0 (no resurrection, never negative).
- My independent engine probe (`scripts/review-independent-v5.mjs`, constructions of my own — different seeds/regions from the worker's tests): A1 baseline "living decay exactly 1, dormant frozen" PASS; A2 "every stability untouched with Mycorrhiza — an awake region set to 9 stays 9 (not 8, not 10)" PASS; A3 dormant/zero-stability well-defined PASS.
- **Regional Seed income follows the resulting state**: `income = laws income + count(living && stability > 0)`, then `seedCredit`. Probe A4: with Mycorrhiza, two stability-1 living regions survive → epoch-end income `+4 Seeds`; without it they decay to 0 → income `+2 Seeds` (both targets met so no halving). Decay genuinely feeds the economy.
- **Honest docs without a survival redesign**: RULES.md epoch-end now says decay is "not purely cosmetic — the income below counts only living regions with stability > 0, so decayed-out regions stop paying Seeds"; the market description reads "Regions decay 1 less each epoch (1 → 0: living regions stop decaying)". README/HANDOFF carry the same audit. The ruleset (lives, targets, scoring) is untouched.

### 2. Truthful Seed rewards — FIXED (one shared contract; no divergent arithmetic)

- Source: `seedCredit(seeds, amount) → { credited, overflow }` is the ONLY cap arithmetic (`credited = min(max(0, SEEDS_CAP − seeds), amount)`, `overflow = amount − credited`). `buildPlan(hand, sel, laws, seeds)` bakes nominal (`amount`), `credited`, `overflow` into the plan's seeds effect and its summary; `applyPlanEffects` banks exactly `e.credited` (the old separate `Math.min(SEEDS_CAP, …)` clamp is gone); `preview()` and the `play` commit both pass the live balance; the epoch-end income line uses the same `seedCredit`. Preview, committed plan and chronicle all read these same plan fields — there is no second arithmetic path. All other call sites I checked (`scripts/solve.mjs`, `balance-sweep.mjs`, `coord-playtest.mjs`) score via `applyAction('play')`, i.e. through the same contract; their old 3-arg `buildPlan` calls are balance-agnostic score probes (default `seeds = 0` ⇒ nominal-only), documented in the engine, and do not diverge from gameplay.
- **Worked examples executed end-to-end** (my probes B2–B5, two-pair 9-9-7-7 = chips 32 × 2 = 64 Growth ⇒ nominal 16):
  - balance 8 + nominal 16 → credited 16, **balance 24**, summary `Gains 16 Seeds.` (no overflow clause);
  - balance 24 + nominal 16 → credited 6, overflow 10, **balance 30**, identical text `Gains 16 Seeds (Credited 6; overflow 10)` in preview, committed plan and chronicle;
  - balance 30 + positive → credited 0, overflow 16, **balance stays 30**;
  - extra boundary: balance 29 + 16 → credited 1, overflow 15, balance 30.
- **Epoch-end income is truthful too** (probe B6 + worker tests): at cap, income +4 logs `Epoch end: +4 Seeds (Credited 0; overflow 4)`; a missed-target halved income at cap logs `Credited 0; overflow 2`; a partial case 28 → `+4 Seeds (Credited 2; overflow 2)`. Market purchase messages are spend-side (`−N Seeds`) and were never misleading; the HUD always shows the true balance `N/30`.
- **Real-browser proof (my own construction, isolated profile)**: crafted valid save, balance 27, a real Q-Q-9-9 two pair from the deck (chips 42 × 2 = 84 ⇒ nominal 21) → preview shows `Banks 84 Growth (chips 42 x 2 mult = base 84). Gains 21 Seeds (Credited 3; overflow 18).`; after Play the HUD reads `Seeds 30/30`, the chronicle echoes the identical sentence verbatim, and the saved state's `seeds` is exactly 30. Screenshots: `shots-review/v5-preview-credit.png`. The worker's `scripts/review-playtest-fixes.mjs` independently confirms its own case (balance 24, nominal 16 → `Credited 6; overflow 10`) at 1280 and 480 widths.

### 3. Final-epoch flow — FIXED (resolves exactly once; reload cannot duplicate)

- Source: `endEpoch` performs the target check, life deduction, truthful income, then `if (s.epoch >= TOTAL_EPOCHS) return advanceToNextEpoch(s)` — the run goes **straight to the verdict**; the market block is reached only for epochs 1–2 (unchanged `market → endMarket → epoch-end → closeEpoch` flow). `advanceToNextEpoch` still guards every terminal case; a game-over state ignores all actions (`applyAction` returns the state untouched at `phase === 'game-over'`).
- UI (`App.tsx`): the epoch-end button now branches — epochs 1–2 keep `Continue → begin epoch N+1`; at the final epoch it is **`View Results`** (`data-testid="view-results-btn"`), so "begin epoch 4" can no longer be advertised even for a legacy `epoch-end` state parked at epoch 3.
- **My independent engine probes (C1–C6)**: final miss with lives remaining → `game-over`/`withered` directly, `market` empty, exactly one "a life is lost" line and one "Epoch end: +" line; final win → flourishing verdict, no "epoch 4" string anywhere in log or reason; 0-lives final miss → withered exactly once; epochs 1–2 → market and epoch-end panels with `begin epoch 2` / `begin epoch 3` exactly as before; legacy `epoch-end@3` → verdict on `closeEpoch`; reload inertness → the finished state passes `validateState` and `play`/`closeEpoch`/`buy` all leave phase/outcome/seeds/lives/flourishing/log byte-identical (content equality; `applyAction` clones by design, so reference equality is not the right test — the worker's test makes the same choice).
- **My independent browser run (real UI, isolated profile, seed `v5-flow-run-xyz`)**: played a full 3-epoch run. Epochs 1 and 2 each opened the market, then the epoch-end panel with the correct `begin epoch 2` / `begin epoch 3` buttons. After the epoch-3 4th play the verdict appeared **directly**: zero `.market` panels, zero `[data-testid=epoch-end]` panels, and no "begin epoch 4" text anywhere in the page (run reached the zero-lives withered verdict because 12 weak single-card plays legitimately missed every target — the flow is what was under test). The settled save is byte-identical (state JSON) across a reload, the verdict text is unchanged, and the chronicle holds exactly one `e3` income line and at most one `e3` life-loss line — no duplicated rewards or deductions. Screenshots: `shots-review/v5-final-verdict.png`, `v5-verdict-after-reload.png`. The worker's script proves the same via a crafted winning `epoch-end@3` save ("View Results" → "A Flourishing World", reload-inert).

### Independent gate on the frozen revision (all run by me, this session, at HEAD `9a5538d`)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 |
| `npx vitest run` | **108/108 passed** (3 files) — was **87/87** at baseline `015a414`; +21 from the new `tests/fix-regressions.test.ts`. The 3 modified legacy assertions only re-express the superseded final-epoch flow (market-then-close → direct verdict) while KEEPING every life-cost/outcome assertion (`lives === 1`, `fell short`, `withered`, `out of lives`) — I diffed them line by line; nothing weakened. |
| `npm run build` | **green** (dist/assets/index-BozJ40cF.js 770.03 kB, gzip 207.48 kB; only the pre-existing >500 kB chunk warning) |
| `node scripts/qa.mjs` | **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 AND 480×800**, zero console/page errors (script fails on any error) |
| `node scripts/review-planet3d.mjs` | **PLANET3D CHECKS PASSED** (canvas mount + pixel sample, legend → map-detail, keyboard, reduced-motion rotation stop, raycast) at both viewports, zero errors |
| `node scripts/review-playtest-fixes.mjs` (worker's, run by me via `vite-node`) | **PASSED** — truthful clause in preview/HUD/chronicle, `View Results` → verdict, reload-inert, both viewports, zero errors |
| My `scripts/review-independent-v5.mjs` (engine) | **20/20 probes passed** |
| My `scripts/review-independent-v5-browser.mjs` (real UI, isolated storage) | **PASSED** (truthful credit `Credited 3; overflow 18` case, full final-epoch flow, reload non-duplication) — zero console/page errors |
| `review-probe` / `review-pvcommit` / `review-autosave` / `drought-legibility` / `review-independent` / `review-fullrun` / `review-browser` / `review-save-lives-browser` | all **PASSED** (`MATCH: true`, 10/10, 15/15, `errors: []` throughout) |
| `python3 scripts/check-no-emoji.py` | PASSED |
| Dev server | HTTP 200 at `127.0.0.1:5177` throughout; my browser probes used **isolated Playwright profiles / crafted localStorage keys**, so the user's real save was never touched |
| Bounded solver (economy-unchanged check) | LOOK=30 eval: **16/30 (53%)**, final F min 322 / median 360 / max 410 — identical to the documented baseline |

### Remaining honest issues

- Minor, non-blocking: the truthful `Credited/overflow` clause currently appears in the chronicle's epoch-end line even when nothing overflows (`Epoch end: +4 Seeds (Credited 4; overflow 0)`) — truthful but verbose; the per-play summary stays clean (`Gains N Seeds.`) when overflow is 0. A cosmetic asymmetry only; arithmetic agrees everywhere.
- The `mjs` review scripts must be run via `npx vite-node` (they import TS sources) — plain `node` fails with `ERR_MODULE_NOT_FOUND`. Purely operational.
- Pre-existing, out of scope for these three defects: the app bundle remains a single 770 kB chunk; world development still feeds only presentation. Neither was part of this pass.

**Bottom line: the three playtest defects are FIXED on HEAD `9a5538d`, each verified in source, by unit tests (87 → 108, none weakened), by my own independent engine + real-browser probes, and by the full QA battery at both viewports with zero errors. This is a statement about the three defects only — no balance claim is made.**

*Reviewer-added artifacts (this addendum): `scripts/review-independent-v5.mjs`, `scripts/review-independent-v5-browser.mjs`, screenshots `shots-review/v5-*.png`. No source/test/doc files were modified by me.*

*Record note (same session):* while this addendum was being written, the coordinator committed `b242b96` ("coord: independent verification addendum…") — a **PLAYTEST_HANDOFF.md-only** documentation commit. `git diff <HEAD> -- src tests RULES.md README.md scripts` is empty, so the reviewed game revision (`9a5538d`) is untouched by it; the coordinator's independently-run gate (recorded there: tsc clean, 108/108, build clean, qa PASS both viewports 0 errors, `review-playtest-fixes` PASSED, solver LOOK=30 eval 16/30 = 53%) **matches this addendum's numbers exactly**, providing a second, independent confirmation of all three fixes.

---

# Dated Addendum — Regional-bonus system v4 (independent finished-diff review)

**Reviewer:** Independent subagent (Hermes), delegated-child session. Routing metadata per required delegation override: **provider `ollama-cloud`, model `glm-5.3-flash`** (session-configured route; not the coordinator model `deepseek-v4-flash:0731`; no recursive delegation). All claims below cite tool outputs produced in this session.
**Date:** 2026-09-09 (15:20–16:30 EDT) · **Repo:** `/Users/giofiore/Documents/Codex/worldhand`
**Reviewed revision (frozen):** **`785556a`** — "feat: regional-bonus system (v4) — 3 fixed poker specializations drive small flat Growth bonuses". I **waited for the freeze** before reviewing: HEAD sat at baseline `f89d397` with a clean tree through my baseline survey (baseline gate re-run on `f89d397`: tsc clean, **108/108**), I observed the worker's edits accumulate (up to 40 dirty files), the feature commit land at 15:51 EDT, then confirmed source/test/docs stability (only 9 screenshot-PNG artifacts ever remained dirty; last PNG mtime 27 min before my gate). The baseline gate numbers were re-confirmed by checking out `f89d397` mid-session and re-running vitest (108/108), then returning to `785556a`.
**Scope discipline:** no source/test/doc files modified by me. My artifacts live outside the repo (`/tmp/rev-probe.mts`) plus this addendum. No global config touched; the dev server (port 5177) was left running as found.

## 0. Verdict up front

**The regional-bonus system is correctly implemented on the frozen revision, and its choices reconcile to the committed total.** All eight assigned verification points hold; the full gate is green. This is a correctness statement only — **no balance claim is made and the game is not called "balanced"**; the strategic-acceptance fixtures are labeled design fixtures (choice reversal demonstrated), not ordinary playtests, and the ordinary run still wins comfortably for a naive highest-Growth policy (a difficulty limitation, reported below, not fixed here).

| # | Point | Verdict | Evidence anchor |
|---|---|---|---|
| 1 | Mechanics (exact category, dormant 0, formula, constants, additive, once-after-laws, category never changed) | **HOLDS** | source diff + my independent 637-subset sweep + 7-category negative probe |
| 2 | Scoring contract (one shared buildPlan; parts reconcile exactly; dormant 0; truthful seedCredit; capped messaging + final-epoch flow preserved) | **HOLDS** | sweep reconcile failures = 0; dormant-commit probe; preview==commit test + my probes |
| 3 | Starting planet (not all three awake; deterministic map; named regions kept) | **HOLDS** | map probe across 3 different seeds |
| 4 | Shop (≥2 specializations via existing expansion mechanism at 12 Seeds; no new interface/economy; other prices unchanged) | **HOLDS** | MARKET_ITEMS price dump; browser purchase proof |
| 5 | Save (v4 bump; specialization validation; v3 rejected+preserved verbatim; quit/reset/reload intact; no reward duplication) | **HOLDS** | validateState probes; byte-for-byte legacy proof; reload-inert suites |
| 6 | UI (legend/inspector/shop offers/globe tooltip tell category+bonus+dev+dormant; globe identifies matching regions on preview with no clicks) | **HOLDS** | live preview screenshot + acceptance run |
| 7 | Strategic acceptance (two labeled fixtures, same cards+laws, genuine choice reversal; not claimed as ordinary playtest) | **HOLDS** | fixtures reproduced independently from source (build A vs B reversal, both) |
| 8 | Ordinary run (normal UI actions only; whether a bonus changed a selection — reported honestly) | **HOLDS** | full run: WIN F1225, bonus changed **1 of 12** selections (P10) |

## 1. Mechanics — HOLDS

- **Source** (`worldhand.ts`): `specOfCategory(category)` maps ONLY `pair→'pair'`, `two-pair→'twopair'`, `flush→'flush'` (everything else → null) — the single normalization point; `regionBonusOf(r) = SPECIALIZATION_BASE[r.specialization] + Math.min(DEV_BONUS_CAP, Math.floor(Math.max(0, r.development) / DEV_STEP))`; the buildPlan loop skips `r.dormant` and non-matching specializations and sums additively; `growth = Math.max(0, Math.round(pokerBase * lawMult) + lawFlat + regionsBonus)` — the law multiplier never re-multiplies the regional part; the category comes from the unchanged `evaluateSelection` (the bonus never alters it).
- **Constants exported exactly**: `PAIR_BASE=3, TWOPAIR_BASE=4, FLUSH_BASE=6, DEV_STEP=2, DEV_BONUS_CAP=4` (my probe printed them; also pinned by tests/regional-bonus.test.ts).
- **My independent negative probe** (Auralia=pair and Vantage=flush awake, dev 0): trips → regionsPart **0**; two-pair → **0**; full-house → **0**; quads → **0**; straight → **0** (for BOTH specs); flush → **6** (only the flush spec pays); straight-flush → **0**; exact pair → **3**. There is no hidden "contains a pair" path — matching is on the exact evaluated category.
- **No re-multiplication executed**: pair 39 poker under Open Canals → parts {poker 39, laws +8, regions 7} → growth **54** (re-multiplied would be 55). Canopy Choir +3 → {39, +3, 3} → 45 exactly once.
- **Sweep**: 637 legal 1–5-card subsets of a mixed 10-card hand with Open Canals + Canopy Choir owned and all three spec regions awake (dev 5/3/7): **0 reconcile failures** across categories high/pair/two-pair/flush/straight/straight-flush.

## 2. Scoring contract — HOLDS

- **One shared pipeline**: `preview(s)` = `buildPlan(s.hand, s.selected, s.laws, s.seeds, s.regions)` and the `play` commit calls the same `buildPlan` with the same live state (diff-verified; both call sites updated identically). `growthParts = { poker, laws, regions }`; **poker + laws + regions === growth** verified over my 637-subset sweep (0 failures) and by the worker's selection-sweep test.
- **Dormant = 0 through the full commit path** (my probe, not just buildPlan): Pellucid twopair dormant at dev 8 → preview regions part 0, committed growth 64, flourishing delta exactly 64.
- **Truthful seedCredit preserved**: plan effects still carry nominal `amount` + `credited` + `overflow`; `applyPlanEffects` banks exactly `credited`. My probes + worker tests: balance 24 + nominal 18 → credited 6 / overflow 12, committed seeds 30, identical clause in preview and chronicle; balance 30 + positive → credited 0 / overflow 14, balance unchanged. Capped-Seed messaging and the final-epoch flow (straight-to-verdict, `View Results`) are untouched — `review-playtest-fixes.mjs` and `review-independent-v5-browser.mjs` both still pass verbatim on the frozen revision.

## 3. Starting planet — HOLDS

- **Exact map (deterministic fixed data, printed from a live engine import, identical across 3 DIFFERENT seeds and across repeated same-seed calls; named regions kept; terrains untouched):**

| Region | id | Terrain | Specialization | Start state |
|---|---|---|---|---|
| Auralia | 0 | meadow | **pair** (base +3) | **AWAKE** |
| Veymark | 1 | coast | — | awake |
| Calder | 2 | highland | — | awake |
| Thessaly | 3 | forest | — | awake |
| Laguna | 4 | steppe | — | dormant |
| Ozurn | 5 | wetland | — | dormant |
| **Pellucid** | 6 | meadow | **twopair** (base +4) | **dormant** |
| Harrow | 7 | coast | — | dormant |
| Sequana | 8 | highland | — | dormant |
| Brumal | 9 | forest | — | dormant |
| Kestrel | 10 | steppe | — | dormant |
| **Vantage** | 11 | wetland | **flush** (base +6) | **dormant** |

- Exactly three specializations exist (`specd.length === 3` in tests + my map dump); the other nine regions are `null`. **Only the Pair region is awake at start** — the starting planet does NOT activate all three; TwoPair and Flush start dormant and are obtainable only via the shop.

## 4. Shop — HOLDS

- Two new expansion items at the **existing wake-\* convention (cost 12)**: `wake-pellucid` (wakeRegionId 6) and `wake-vantage` (wakeRegionId 11), `kind: 'expansion'` — the same mechanism as wake-laguna/wake-brumal (which are unchanged: 12 / regions 4, 9). No new interface, no new economy, no new currency: purchases go through the existing `buy` action and `LAW_SLOTS` shelf.
- **All existing prices otherwise unchanged** — my full price dump: mycorrhiza:6 seed-vaults:8 barter-routes:5 canopy-choir:10 stone-masonry:16 open-canals:14 fourth-counsel:12 fifth-counsel:18 wake-laguna:12 wake-brumal:12 (+ the two new 12s).
- **Browser-purchased** (worker's acceptance, re-run by me): the Wake Vantage offer advertised "Poker bonus when awake: +6 Growth on exact Flush hands, +1 per 2 development (cap +4); currently dormant."; buying it (30 → 18 Seeds) awakened exactly Vantage (id 11) and the flush bonus went live (+6 at dev 0, +7 at dev 2).
- Caveat (honest): the market deals 3 random offers per epoch from a 12-item pool, so a specialization wake is not guaranteed to appear in any given epoch — the mechanism exists and works, but availability is luck, as it already was for wake-laguna/brumal. The solver's documented buy policy still skips expansions entirely, so its bounded runs play with Auralia only.

## 5. Save — HOLDS

- `SAVE_VERSION = 4` (SCHEMA_VERSION stays 3 — layout unchanged, rules generation bumped). History comment updated.
- `validateState` now rejects any region whose `specialization` is not `null | 'pair' | 'twopair' | 'flush'` — my probes: `'quads'` rejected, `'high'` rejected, `'pairX'` rejected, **missing field rejected**, fresh v4 state accepted.
- **Old-version rejection + preservation proven byte-for-byte**: unit test crafts a real v3 envelope (version 3, specialization fields deleted) → `loadGameDetailed` returns null with a "version 3" reason, the original key untouched, and the raw blob preserved **verbatim** under `worldhand.save.legacy.<ts>`; browser proof (worker's script, re-run by me) shows the reject panel naming engine v3 vs v4 and the legacy key; my screenshot confirms the panel text verbatim including "The old save was NOT deleted or reinterpreted".
- **Quit / reset confirmation / reload intact**: qa.mjs (both viewports) exercises Save→Quit→menu→Load Saved World; Clear Save and Back-to-Menu confirm gates are untouched by the diff (no changes to those code paths); `review-save-lives-browser` 15/15, `review-autosave` PASS, `review-browser` PASS (`errors: []`, quit-preserves-save), no-emoji PASS.
- **Reload cannot duplicate rewards**: engine-level, rewards apply once inside the commit; the winning final state passes validateState and every action on it is inert (`review-playtest-fixes`, `review-independent-v5-browser`, and the new regional reload test all assert run-state byte-identity after reload on the frozen revision; all pass).

## 6. UI — HOLDS

Verified live (worker's acceptance run re-executed by me, isolated browser storage) and by screenshot inspection (`shots-review/regional-preview-match.png`):
- **Preview/breakdown**: Growth hero **71** with `+64 poker · 0 laws · +7 regions`; summary `Banks 71 Growth (chips 32 x 2 mult = base 64 +7 region). Gains 18 Seeds (Credited 6; overflow 12).` — parts reconcile on screen.
- **Region-match banner**: "Regional bonus active: Pellucid (Two Pair) +7 — highlighted on the globe."
- **Globe tooltip (no clicks)**: "Pellucid: Two Pair +7 Growth — gold rings mark the matching regions", rendered automatically whenever the previewed hand's exact category matches; the cropped globe screenshot shows the gold ring on the matching patch.
- **Legend badges**: Auralia carries a "Pair" badge; Pellucid "Two Pair" (gold, match-highlighted with glow when matching); Vantage "Flush" (dimmed while dormant); dormant z-mark suppressed on the matching dormant note. Tooltips give the full sentence (category, current bonus, development scaling +1/2 up to +4, dormant/active).
- **map-detail inspector**: "Poker specialization: Two Pair — active: +7 Growth on exact Two Pair hands (base +4 + development 6 → +3 of the +4 cap; +1 per 2 development)."
- **Shop offers**: both wake offers carry the exact poker-bonus note + dormant state (screenshot `regional-market-offers.png`).
- Commit echoes the preview verbatim in the chronicle (`Banks 71 Growth … +7 region`), HUD Seeds 30/30 after the capped credit.

## 7. Strategic acceptance — HOLDS (labeled design fixtures, genuine reversal)

The two fixtures are pinned in `tests/regional-bonus.test.ts` and clearly labeled "design tests, not ordinary playtests". I reproduced both **independently from source** (my own `/tmp` probe, same constructions re-derived):

- **Fixture 1 (pair vs two-pair, no laws)** — same 10 cards; pair `A♠A♥K♦Q♣J♥` = 64 chips × 1.5 = **96** and two-pair `A♠9♠9♥8♦8♣` = 48 × 2 = **96** — an exact tie without regions. Build A (awake maxed Pair region dev 8 → +7): pair **103** > twopair 96 → **PAIR favored**. Build B (awake maxed Two-Pair region dev 8 → +8, Pair dormant): pair 96 < twopair **104** → **TWO-PAIR favored — REVERSAL confirmed** (my probe printed `REVERSED=YES`; the flip is exactly the +8 bonus).
- **Fixture 2 (flush vs pair, Open Canals ×1.2 in BOTH builds)** — pair 96 → ×1.2 = **115**; flush 92 → ×1.2 = **110**; pair wins without regions. Build A: pair **122** > flush 110 → PAIR favored. Build B (awake maxed Flush region dev 8 → +10): flush 110+10 = **120** > pair 115 → **FLUSH favored — REVERSAL confirmed** (margin +5; the bonus is added after the law multiplier — flush is 120, not 142 — so the flip is purely the once-applied regional bonus).
- Both are correctly **not claimed** as ordinary playtest or human-performance evidence anywhere in the diff's docs.

## 8. Ordinary run — HOLDS (limitation reported honestly)

One full run, seed `regional-ordinary-1`, driven through the real UI only (every play = real preview + click; the engine import only READS the auto-saved state to enumerate candidates — read-only, isolated Playwright profile, user's real save untouched). Re-executed by me on the frozen revision: **WIN — Flourishing 1225 vs final target 360, lives 3/3, 0 console/page errors.** 12 plays, 4 buys (Fourth Counsel 12, Wake Laguna 12, Stone Masonry 16, Mycorrhiza Network 6), 0 discards.
- **A regional bonus DID change a real card selection — once (1 of 12 plays, P10 epoch 3):** holding 6♦6♣7♠K♣J♥(+4♠4♥), the no-regions best was the two-pair 6♦6♣4♠K♣4♥ (G=72), but awake Auralia's pair bonus made the pair 6♦6♣7♠K♣J♥ best (65 base +6 laws +4 region = **75**) — the chronicle line shows `base 65 +6 laws +4 region`. The other 11 plays the bonus padded the already-winning hand (e.g. P3 pair 60 → 63) without flipping the argmax.
- Verdict screenshot inspected: "A Flourishing World — The world flourishes at 1225 after 3 epochs (lives remaining: 3)."

## 9. Independent gate on the frozen revision (all run by me, this session, at HEAD `785556a`)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 (baseline `f89d397` also clean) |
| `npx vitest run` | **139/139 passed** (4 files) — was **108/108** at baseline `f89d397` (re-verified by me mid-session on a checkout of `f89d397`); +31 from the new `tests/regional-bonus.test.ts`. I diffed the 4 modified assertions in `tests/worldhand.test.ts` line by line: all four are pure version-pin updates (3→4) forced by the deliberate SAVE_VERSION bump — no existing assertion was weakened or deleted. |
| `npm run build` | **green** (dist/assets/index-iJFkLVup.js 775.31 kB, gzip 208.99 kB; only the pre-existing >500 kB chunk warning) |
| `node scripts/qa.mjs` | **ALL PLAYWRIGHT CHECKS PASSED at 1280×800 AND 480×800**, zero console/page errors (script throws on any error — gate confirmed at qa.mjs:74) |
| `node scripts/review-planet3d.mjs` | **PLANET3D CHECKS PASSED** (canvas mount + pixel sample, legend → map-detail, keyboard, reduced-motion rotation stop, raycast) both viewports, zero errors |
| `npx vite-node scripts/review-regional.mjs` (worker's new acceptance) | **REGIONAL BONUS CHECKS PASSED** — preview reconcile 64+0+7=71, banner/tooltip/legend-highlight, Wake Pellucid/Vantage offers with poker notes, Wake Vantage purchase awakens the right region+bonus, v3 blob byte-preserved |
| My independent engine probe (`/tmp/rev-probe.mts`, vite-node) | map determinism across different seeds, 637-subset reconcile sweep (0 failures), 7-category exact-match negatives, no-remultiplication arithmetic, dormant-commit-zero, validateState legality ×4, prices, reversal reproduction — **all as reported above** |
| Regression scripts re-run by me | review-probe ✓, review-pvcommit `MATCH: true` ✓, review-browser ✓ (`errors: []`), review-autosave ✓, drought-legibility ✓, review-fullrun ✓ (`errors: []`), review-save-lives-browser **15/15**, review-independent **10/10**, review-independent-v5 **20/20**, review-independent-v5-browser ✓, review-playtest-fixes ✓ |
| `python3 scripts/check-no-emoji.py` | PASSED |
| 4 modified review scripts | diffed individually: three are the forced `version: 3→4` envelope bump in crafted fixtures; one is a comment-only reword (`v2→v4 game`); **no probe removed, no assertion weakened** |
| Bounded solver (re-measured by me, LOOK=30, eval set; policy untouched) | **20/30 wins (67%)** — final F min 330 / median 366 / max 429 (baseline at `f89d397` was 16/30, 53%). Matches the worker's claim and RULES.md's post-v4 note; formula was not retuned (constants identical to declared). A bounded solver result, NOT a human-performance estimate. |
| Dev server / real save | HTTP 200 at 127.0.0.1:5177 throughout; all browser probes used isolated Playwright profiles / cleared-and-crafted localStorage keys — **the user's real save was never touched** (the in-app Hermes browser could not be used for a live drive because its real-profile mode requires a Chromium default browser and I must not change global config; the Playwright acceptance scripts cover the same gate against the same dev server) |

## 10. Remaining limitations (recorded, NOT fixed here)

- **Difficulty**: the naive highest-Growth policy still wins comfortably (F1225 vs 360; solver 67%). The regional bonus adds decision texture, not difficulty; no tuning was applied and none is claimed.
- **Shop availability**: 3-of-12 random offers per epoch mean a specialization wake can fail to appear in a given epoch (pre-existing randomness, unchanged); the solver's buy policy skips expansions, so bounded runs never wake Pellucid/Vantage.
- **Development is not targetable**: a specialization's bonus grows only passively (+1 per 2 epochs, cap +4); no way to invest in a specific region (deliberately out of scope).
- **The dormant-note banner** only appears while a matching hand is previewed; system explanation outside the select phase rests on the legend/inspector tooltips (minor legibility nit).
- One cosmetic carry-over from the previous pass: the epoch-end chronicle line always shows the `(Credited C; overflow O)` clause even when overflow is 0 — truthful but verbose (pre-existing, unchanged).

**Bottom line: on the frozen revision `785556a`, the regional-bonus system is correctly implemented — exact-category matching with dormant-zero, the declared constants and formula, additive once-after-laws application, an exact three-part reconciliation to the committed Growth, a deterministic three-region map with only Pair awake at start, two obtainable specializations at the existing 12-Seed expansion convention, a clean v4 save cut with verbatim legacy preservation, full preview-time UI legibility including a click-free globe highlight, and a demonstrated A-vs-B choice reversal in labeled design fixtures — and every choice reconciles to the committed total. The ordinary run shows the bonus can and did change one real selection (1 of 12). Gate fully green: tsc clean, 139/139 (from 108, nothing weakened), build clean, QA both viewports 0 errors, planet3d green, solver re-measured honestly at 20/30. No balance claim is made.**

*Reviewer artifacts (this addendum): `/tmp/rev-probe.mts` (independent engine probe, outside the repo) + this dated addendum. No source/test/doc files were modified by me.*
