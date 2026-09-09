# Worldhand — Independent Review

**Reviewer:** Independent subagent (Hermes), routed provider `ollama-cloud`, model `glm-5.3-flash` (delegation override confirmed — env shows Hermes delegated-child session; model identity per routing requirement).
**Date:** 2026-09-09 · **Repo:** `/Users/giofiore/Documents/Codex/worldhand`
**Scope:** poker/game-engine correctness, test gaps, security/persistence, browser acceptance. Implementation not overwritten; probe script used and deleted; only pre-existing fixes noted below.

## What the project actually is

**Not a poker-table app.** It is a deterministic planet-building card roguelike ("Balatro-like"): 12 regions, 8 epochs × 4 hands, 8-card hands dealt from a 52-card deck, suit-based plays (♠ Roots / ♥ Bloom / ♦ Sow / ♣ Tend), discards, market, laws, challenges. Poker hand evaluation is used as a flavor/stat mechanic (`lastHandResult` = best 5-of-8), not as a poker game. This satisfies the "poker/game-engine" brief only in the sense of card-engine correctness; reported here as a finding, not a blocker.

## Verified state (all commands run by me on the current tree)

- `npx tsc` → exit 0 (clean).
- `npx vitest run` → **21/21 tests pass** (`tests/engine.test.ts`).
- `npm run build` (tsc + vite build) → succeeds, dist ~207 kB JS.
- `node scripts/verify.mjs` (Playwright against vite preview on 5177) → passes: COUNTS regions=12/cards=8, play/discard transitions, advance, reload persistence, SAVE_BYTES=2513, VERDICT "The World Withers", ERRORS=[].
- Dev server (`vite --port 5178`) serves the app (HTTP 200) — confirmed live during review.
- No git repo present.

## Verified engine findings

### V1 — `playsLeft` is dead state (minor, verified)
`GameState.playsLeft` is set to `HAND_SIZE` on deal and initialized to 0 in `setupWorld`, but never decremented and never read anywhere (engine or UI). Either remove it or wire it up; as-is it's misleading in the save envelope.

### V2 — Withering loss cannot trigger organically (verified by probe)
`checkWithering` requires 5 **living** regions at stability ≤ 0. In a 40+ hand drain-everything run, the max dead-living count reached was **4** (final run ended via Flourishing -5 → "withered" by score, not by withering). Dormant regions are excluded, and the 8 starting alive regions decay −1/epoch while ♥ Q+ wakes more, making 5 simultaneous zero-stability living regions practically unreachable. **The only real loss path is the Flourishing ≤ target-at-epoch-8 score check** (plus Flourishing ≤ 0 never triggers early — see V3). So `WITHERING_LIMIT = 5` as documented in the header contract is effectively unreachable in normal play. Suggest either counting dormant regions, or removing/dialing down the constant so the rules text matches reality.

### V3 — "Flourishing ≤ 0 at an epoch boundary" loss rule not implemented (verified by probe)
Header comment (line 9) claims loss when Flourishing ≤ 0 at an epoch boundary. Probe shows Flourishing went to −5 mid-run and the game kept going all the way to epoch 8, ending only on the final-target check. Either implement the boundary check in `closeEpoch`/`afterLaw` or fix the comment. **This makes the game unwinnable-by-design only via the final-target rule, so difficulty is fine — but the documented rules and code disagree.**

### V4 — Poker evaluation is correct (verified by reading + test vectors)
`evaluate()` does exhaustive 5-of-N enumeration; `evalFive` handles wheel (A-2-3-4-5 → key[1]=5), straight-flush, quads/boat/two-pair ordering, kickers. Test vectors (royal > quads > boat; wheel detection; best-5-of-8) pass. One nit: no guard against `cards.length > 8` (unbounded O(n⁵) for large N), but HAND_SIZE is fixed at 8 so unreachable in practice.

### V5 — Determinism is genuine (verified)
Same seed → identical `GameState` (test asserts deep equality), and independent probes confirm reproducible worlds/chronicles. Deck reshuffle on empty uses `rngFor(s, 99)` salted by epoch/hand — deterministic. Hand uniqueness probe confirmed no duplicate cards in a dealt hand.

### V6 — Market card provenance edge (minor, untested)
`closeEpoch` pulls 3 market offers from `[...deckRest, ...discardPile]`, and remaining pool goes back to `deckRest`. If `deckRest + discardPile < 3`, fewer offers are made (loop guards on `rest.length > 0`) — safe. If deck is fully in-hand + discard at epoch end, market could silently be small. Not a bug, but worth a test case.

## Test gaps (verified — current suite is good but incomplete)

Existing 21 tests cover: determinism, poker eval vectors, contracts/constants, suit actions, epoch/advance flow, market, full-run termination, withering helper, challenge helpers, save round-trip, chronicle variety, legalActions. Gaps:
1. **No test that `checkWithering` ever fires from real play** — my probe shows it doesn't (V2); a test asserting the documented rule would have caught this.
2. **No test for Flourishing ≤ 0 boundary rule** (V3) — documented but unimplemented and untested.
3. **No test for deck exhaustion → reshuffle path** (`drawUp` reshuffle at line 178–184) — the discard-rebuild branch is never exercised by the suite.
4. **No test that enacting a law actually applies its modifier** (e.g. `decayDelta` changes next decay tick, `marketDiscount` changes `offerCost`).
5. **No test for `buyCard` with insufficient Seeds** or `enactLaw` with insufficient Seeds (throw paths).
6. **No save-load test through `saveGame`/`loadGame`** with a mocked localStorage (only raw JSON round-trip tested, not the envelope/migration path).

## Security / persistence

- **localStorage save system** (`src/ui/save.ts`): versioned envelope `{version, savedAt, state}`, forward-only migration, try/catch on parse. Sound for a local game. Note: this project's AGENTS.md precedent (Civicfolio) forbids localStorage for secrets — no secrets exist here, so acceptable, but if bankroll/purchases are ever added, move off localStorage.
- **No server, no network calls in app code, no secrets, no user input beyond seed text and card clicks.** Seed text is hashed with FNV-1a before use — never rendered dangerously (React escapes by default). XSS risk: none found.
- **No git repo** — nothing to review for history; also means no rollback safety for the implementer. Recommend `git init` + commit.
- `vite.config.ts` binds localhost only with strictPort 5177 — no exposure risk.

## Browser acceptance risks

- **Playwright verify script passes** (my run + coordinator's): menu → seeded run → play → discard → advance → reload persistence → verdict screen all work, no console/page errors. This is a strong acceptance signal.
- Only one viewport tested (1280×900); no mobile/narrow-width check. Cards are buttons, layout is flex — likely fine but unverified.
- `scripts/verify.mjs` uses `text=Begin New World` selectors — brittle to copy changes; consider data-testid attributes if UI copy is iterated.
- React 19 + Vite 8 + TS 7 are cutting-edge majors; build is currently green but no CI pins these — a fresh `npm install` could pull newer breaking majors since package.json uses `^` ranges. Recommend commit-locking via package-lock (already present) and a CI job.

## Unverified / deferred

- I did not hand-simulate the full 56-combination (8-choose-5) evaluation; relied on test vectors + code reading.
- I did not audit `scripts/spade-check.mjs`/`spade2.mjs` (dev-only utilities).
- Playwright `SAVE_BYTES 2513` matches a plausible save size; I did not byte-inspect the envelope.

## Summary for coordinator

App is **not** a poker-table app — it's the intended planet-roguelike and is in good shape: tsc clean, 21/21 tests green, build green, Playwright acceptance green. The two real engine-rule gaps (V2 withering unreachable, V3 flourish≤0 rule unimplemented) are documentation-vs-code mismatches rather than blockers, but should be resolved (implement or amend the header contract) before calling the engine "done." Suggest: git init, CI, add the missing deck-reshuffle and law-effect tests, remove dead `playsLeft`.