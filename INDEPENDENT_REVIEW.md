# Worldhand — Independent Review (v2, post-correction)

**Reviewer:** Independent subagent (Hermes), delegated-child session. Execution metadata per required routing: provider `ollama-cloud`, model `glm-5.3-flash` (the session's configured delegation override; all claims below come from tool outputs produced in this session).
**Date:** 2026-09-09 · **Repo:** `/Users/giofiore/Documents/Codex/worldhand` · HEAD at review start: `810b392` ("v2 core: 1-5 card poker plays, ResolutionPlan preview/commit, 12-region SVG planet map, discard refill, previewed Drought, market laws/upgrades/expansions, 3 escalating targets").
**Scope:** full test suite, engine/UI/save inspection, Playwright browser acceptance at 1280×800 and 480×800, all checklist items. No tests weakened; no requirements rewritten. One small safe UI fix applied after documenting the cause (§ Fix).

## 0. What changed since the last review

The implementation was corrected from the 8-epoch single-card contract to the v2 contract the brief asked for: **3 epochs × 4 plays**, **1–5 card selection scored as an exact poker selection**, **suit majority/tie-break acting suit**, **ResolutionPlan shared by preview and commit**, **discard 1–5 with refill**, **12-region SVG planet map with selection/adjacency**, **market of laws/upgrades/expansions**, **3 escalating targets (5→8→12 Flourishing; 14→22→30 stability sum)**, and the **previewed epoch-3 Drought**. `tests/engine.test.ts` (21 tests, v1 contract) was replaced by `tests/poker.test.ts` + `tests/worldhand.test.ts` (59 tests, v2 contract). This is a rewrite, not a weakening: the new suite covers the new contract.

## 1. Verified state (all commands run by me on the current tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` | **59/59 passed** (2 files: poker, worldhand) |
| `npm run build` | green, `dist/assets/index-*.js` 215 kB (gzip 68 kB) |
| Engine probes (`scripts/review-probe.mjs`, vite-node) | all checklist assertions pass (details below) |
| Browser acceptance (`scripts/review-browser.mjs`, Chromium) | all flows pass at 1280×800 **and** 480×800; `pageerror`/`console.error` = [] |
| Vite dev server on 127.0.0.1:5177 | running throughout; HTTP 200 |

## 2. Checklist verification (item by item)

### Multi-card poker selection — VERIFIED (engine + browser)
`toggleCard` builds a selection of 1–5 hand indices; 6th card throws ("at most 5 cards may be selected"); toggling off/on works (probe `multi-select-*: true`). Browser: clicking three cards leaves `.pcard-btn.sel` count = 3 at both viewports. Duplicates are structurally impossible (indexOf/splice toggle).

### Exact scoring-card/kicker behavior — VERIFIED
`evaluateSelection` scores the **exact** selection (not "best subset"): 1–4 cards yield only high/pair/two-pair/trips/quads with correct kicker keys; 5 cards get full `evalFive` with wheel (A-low → key[1]=5). Probe: KQJ kickers beat KQ10 (`compareHands > 0`); identical ranks different suits tie exactly (`=== 0`); 4-card A♠6♠7♠8♠ is NOT a straight/flush. Tests cover all 9 categories in strict precedence, wheel below 6-high, quads-without-kicker, and rejection of 0/6-card selections.

### Tie influence choice — VERIFIED (engine + browser)
`suitMajority` defaults ties to S,H,D,C order; an explicit `tieChoice` overrides it and is reported as `tiebreak-choice` in the plan. Plan-level effects follow the choice: same {5♥,6♦} selection builds a Flourishing plan with tieChoice 'H' and a Seeds plan with 'D'. Browser: selecting J♣+5♠ shows the tie row with four suit buttons; Play button label and log line reflect the chosen suit ("Play (High Card, S): Roots in Auralia: +4 stability").

### Refill / card conservation — VERIFIED
`cardConservation` (hand + deckRest + discardPile == 52) held with **zero violations** across a full chaotic run (12 plays, 9 discards, 2 market buys, all 3 epochs, terminated in game-over); the probe recorded exactly one running total, `[52]`. Deck exhaustion → reshuffle path exercised: forcing deck to 1 card refilled the hand to 8 deterministically. Market items are laws/upgrades, not cards — the invariant is correctly scoped to the 52-card deck.

### Preview equals commit — VERIFIED (engine + UI)
Engine probe: `preview(state)` vs committed `lastResolution` — identical category, suit, and effects arrays, and every effect actually applied (Flourishing/Seeds/stability deltas match, with caps). UI: preview panel summary amount ("Roots in Auralia: +4 stability") matches the committed log line ("Play (High Card, S): Roots in Auralia: +4 stability") — category and amount both match (`MATCH: true`). One shared pipeline (`buildPlan`) is used by both paths, per contract.

### Map selection / synergy — VERIFIED
SVG planet disc renders 12 regions (8 dormant shown as sleeping nodes) at both viewports. Clicking a region shows the detail panel (`data-testid="map-detail"`: name, terrain, stability 3/10, development, adjacency neighbors). Adjacency is symmetric (test). Focused region draws adjacency lines to neighbors. Synergy caveat: adjacency is **display/inspection only** — no play mechanic consumes it yet (see Limitations).

### Discard replacements — VERIFIED
Discard of 1–5 selected cards removes them, decrements the per-epoch budget once (3→2), and refills the hand to 8 (browser: `handAfter: 8`; the button label "Discard (2) (3)" → "Discard (2)"). Identical discard on identical seed reproduces the identical refilled hand (determinism probe). Budget exhausts after 3 and throws. 0- and 6-card discards throw.

### Market — VERIFIED
4 plays end the epoch into `market` phase with up to 3 distinct items (laws/upgrades/expansions). Buying "Communal Tending — 9 🌰" spent 9 Seeds, added the chip to the effects bar, and disabled the offer. Insufficient Seeds throws and the button is disabled in UI. Barter Routes discount wired through `marketCost`. Expansion item wakes its specified dormant region (test). `endMarket` → `closeEpoch` chain works.

### Previewed Drought — VERIFIED
Entering epoch 3 logs "— Epoch 3 begins. PREVIEWED CHALLENGE: Drought: every living region must hold stability 3+ at epoch 3's end —" and the HUD shows the Drought as at-risk/on-track live. Resolution: met → +2 Flourishing; missed → −2 and **immediate withered game-over** ("The epoch-3 challenge failed; the world could not recover") — verified in browser runs both ways (met in one seed path, failed in another).

### Quit preserving save / reload — VERIFIED (after noting one gap, below)
Quit button returns to menu **without touching localStorage** (verified: 3310-byte save intact before and after Quit in browser). Reload on the menu auto-loads the saved state via `loadGame()` in mount effect — HUD identical to pre-quit state. Save envelope is versioned v2; stale v1 saves are deliberately discarded by `migrate()` (documented, reasonable for a contract break). **Gap — see Issue A:** saving is manual-only; the auto-save effect the earlier build had is gone, so quitting without pressing Save loses progress since the last manual save.

### Three-epoch progression — VERIFIED
Full browser run traverses select → (4 plays) → market → epoch-end → epoch 2 → … → epoch 3 + Drought → verdict ("🍂 The World Withers — Final Flourishing 8 fell short of 12" / and a challenge-failed variant). Targets strictly escalate 5→8→12 Flourishing and 14→22→30 stability sum (test asserts monotonicity; HUD shows the current epoch's target). Engine full-run terminates in game-over within 3 epochs (< 200 guard steps). Withering (5 dead living regions) and Flourishing≤0-at-boundary loss paths both fire (probes + tests).

## 3. Issues found

### Issue A — No auto-save (minor, real) — NOT fixed
The mount effect only **loads**; nothing saves on state change. The Save button works and Quit preserves whatever was last saved, but any progress after the last manual Save is lost on quit/reload. The in-app tagline on the earlier build ("auto-saves after every action") is gone from the docs, but the playtest handoff still implies auto-save. Suggest a one-line `useEffect(() => { if (state) saveGame(state) }, [state])`. Left unfixed because save-frequency is a product decision (e.g. users may want save-scumming protection), but it should be made explicit.

### Issue B — `epoch-end` phase had no UI branch (BLOCKER — FIXED, see § Fix)
`endMarket` moves state to `phase: 'epoch-end'`, where the only legal action is `closeEpoch`, but App.tsx's conditional chain (`game-over | market | <select branch>`) rendered the select-phase branch with an empty hand and a permanently disabled Play button. The game was **unwinnable in the browser** past the first Continue — every run dead-ended after epoch 1. Engine tests passed because they drive `closeEpoch` directly. Root cause: UI conditional chain not updated when the `epoch-end` phase was added in v2.

### Issue C — cosmetic preview-parsing hazard in my first browser script (script bug, not app bug)
The preview panel shows both "+1 pts" (category points) and "+8 Seeds" (effect amount); a naive first-number regex mismatches. Re-verifying with the effect-amount regex confirmed preview==commit at the UI level. Recorded here so the coordinator doesn't misread the earlier "false" line.

### Issue D — minor code observations (documented, no action taken)
- `poker.ts` header comment still says "up to 7 cards" for `evaluate` (it now handles any ≥5; `evaluateSelection` is the 1–5 path). Cosmetic.
- `buildPlan` Roots targeting accepts `tieChoice` reused as a region id (`tieChoice as number`), which works because the UI never passes both, but the overload is fragile if a future UI wants both a tie suit and a region choice.
- `challengeFailed` is only reachable via Drought (epoch 3); epochs 1–2 have no challenge at all, so "challenge resolution" at those epoch ends is a no-op branch. Intentional per v2 contract, noting for completeness.

## 4. Fix applied (small, safe, documented cause)

**File:** `src/App.tsx` (+12 lines). **Cause:** Issue B. **Change:** added an explicit `state.phase === 'epoch-end'` branch rendering the epoch-closed summary (last three log lines for that epoch) and a "Continue → begin epoch N+1" button wired to the existing `closeEpoch` action. No engine code touched; no test changed. Verified after the fix: `tsc` clean, **59/59 tests still pass**, `npm run build` green, and full browser runs now traverse all 3 epochs to a verdict at both viewports with zero page errors.

## 5. Remaining limitations

1. **Adjacency/development are decorative** — map detail and adjacency lines render, but no play or market mechanic reads `region.adjacency` or `development` (only the dev-ring SVG does). Fine for the vertical slice; a listed extension point.
2. **No auto-save** (Issue A) — manual Save + auto-load-on-reload only.
3. **Balance is tight**: an all-single-card policy across seeds ends withered (Flourishing 8/12); reaching 12 likely requires multi-card hands (rank-sum magnitudes) and market upgrades. The win path was not personally achieved in browser play; engine tests don't assert a win is reachable either. Worth a human playtest.
4. **Only two viewports tested** (1280×800, 480×800). No horizontal overflow at either; smaller/landscape-phone sizes untested.
5. **Save migration is destructive for v1** (returns null) — correct choice given the contract break, but old saves silently vanish.
6. Playwright selectors rely on visible copy ("Begin New World", "Continue") and `data-testid="preview"`/`"play-btn"`/`"map-detail"`; copy changes could break the review scripts (kept in `scripts/review-*.mjs` for reruns).

## 6. Evidence artifacts

- `scripts/review-probe.mjs` — engine probes (selection, kickers, ties, preview==commit, conservation, refill determinism, escalation, withering, flourish-zero). Rerun: `npx vite-node scripts/review-probe.mjs`.
- `scripts/review-browser.mjs` — two-viewport acceptance matrix. Rerun: `node scripts/review-browser.mjs`.
- `scripts/review-fullrun.mjs`, `scripts/review-pvcommit.mjs` — full-run-to-verdict and UI-level preview==commit checks.
- `shots-review/` — menu, hand, multi-select, map, quit, reload, verdict screenshots for both viewports.
- One-off debug scripts were removed after use; the four above are retained (uncommitted — committer's call).

## 7. Verdict

The corrected v2 implementation satisfies every item on the review checklist at the engine level and, after the one UI fix for the `epoch-end` dead-end, in the real browser at both required viewports. 59/59 tests, clean tsc, green build, zero console/page errors. The only outstanding product-level concerns are the missing auto-save (Issue A), decorative adjacency/development mechanics, and balance/win-reachability, which need a human playtest rather than another test.
## 8. Follow-up fix round (2026-09-09, implementation session)

Both outstanding issues A (no auto-save) and limitation 1 (decorative adjacency/development) were fixed on this checkout (HEAD 810b392), with the fixes verified by real tool runs in this session.

**Auto-save (Issue A — FIXED).** `src/App.tsx`: added a `useEffect` on `[state]` that calls `saveGame(state)` whenever the state changes, so every committed state-changing action (play, discard, buy, end-market, epoch close, and even selection toggles) persists to the versioned localStorage envelope immediately. Quit semantics are unchanged (Quit still never clears the save; "Clear Save" remains the only destructive path). Duplicate rewards are structurally impossible: rewards are applied exactly once inside the engine's `applyAction` commit; saving the resulting state is a snapshot, not a re-application. The Save button remains as an explicit (idempotent) checkpoint.

**Adjacency/development mechanics (Limitation 1 — FIXED, small and deterministic).** `buildPlan`'s ♠ Roots branch in `src/engine/worldhand.ts` now: (a) targets gain `floor(development/3)` bonus stability (development deepens Roots); (b) adds a `{kind:'develop', amount:1}` effect to the target so each Roots play deepens the soil for future Roots plays (capped at 10 via the existing `applyPlanEffects` develop handler); (c) spreads `floor(gain/2)` stability to each **living** neighbor of the target via its `adjacency` list (dormant neighbors gain nothing). Preview and commit share this same `buildPlan` pipeline, so the preview shows the spread/development effects exactly. Everything is deterministic from state — no RNG touched, no other suit changed, no scope expansion beyond Roots.

**Verification this session:** `npx tsc --noEmit` clean; `npx vitest run` **64/64** (59 prior + 5 new focused tests: adjacency spread to living neighbors only, dormant-neighbor exclusion, development bonus, development growth on Roots play, develop-cap via `applyPlanEffects`); docs updated (RULES.md ♠ Roots section + new Saving section, README.md suits table + Saves, PLAYTEST_HANDOFF.md item 8 + boundaries + test count). Issue A and limitation 1 above are now historical.
