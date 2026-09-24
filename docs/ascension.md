# Worldhand Ascension — how to play

[Back to the project](../README.md) · [Classic rules](rules.md) · [Design and balance evidence](development/ascension-release.md)

Ascension is a roguelike campaign played with poker hands. You grow one world
through six ages. Every age ends in a crisis you can see coming, and every
crisis tests what you built. You win by enduring the final crisis. A run takes
about 25–40 minutes.

Open **[worldhand.netlify.app](https://worldhand.netlify.app/)**, choose
**Ascension**, then **New world**. Leave the seed empty for a random world, or
type one to share it: the same seed always deals the same world and cards.

## The loop in one minute

1. **Play poker hands.** Each era gives you a fixed number of **hands** and
   **discards**. Select 1–5 of your 8 cards and play them. Only the cards
   that make the hand **score**: a Pair's two cards, Two Pair's four, a
   Flush's five, a High Card's one. Score = chips × mult.
2. **Grow the world.** Every scoring card adds 1 to its suit's stat:
   ♥ **Vitality**, ♦ **Prosperity**, ♣ **Industry**, ♠ **Knowledge**.
3. **Watch peoples rise.** When a stat reaches a people's threshold and there
   is free land of its kind, a civilization appears on the globe.
4. **Face the crisis.** The crisis panel shows exactly what facing it now
   would do. Face it when you are ready: each unspent hand becomes Influence,
   and up to two carry into the next era.
   When your hands run out, you must face it.
5. **Endure or scar.** Endure and you move on. Fail and you lose one of three
   **Resolve**, and the crisis leaves a scar. At 0 Resolve the world falls.
   The final crisis must be endured.
6. **The Council.** Between eras, spend Influence on world cards, decrees and
   legendaries, then begin the next age.

Nothing is hidden. Every number on screen is the game's own calculation, and
the preview of a selected hand is exactly what playing it will do.

## Scoring a hand

| Hand | Base chips | Base mult |
|---|---|---|
| High Card | 5 | 1 |
| Pair | 10 | 2 |
| Two Pair | 20 | 2 |
| Three of a Kind | 30 | 3 |
| Straight | 30 | 4 |
| Flush | 35 | 4 |
| Full House | 40 | 4 |
| Four of a Kind | 60 | 7 |
| Straight Flush | 100 | 8 |

Straights and Flushes need exactly five cards; an Ace can be low (A-2-3-4-5).
To the base, add:

- **Card chips:** 2–10 count their face value, J/Q/K count 10, A counts 11.
- **Land:** each scoring card gains 1 chip for every region whose terrain
  favours its stat. Plains and coast favour Prosperity, forest favours
  Vitality, mountains favour Industry, and desert and tundra favour Knowledge.
- **World cards, the era's rule, civilizations, rivalries and legendaries,**
  in that order. The preview's "How this scores" lists each line.

Extra cards that do not score cost you nothing but are spent. That lets you
cycle cards you do not want, but a Pair played as two cards keeps three cards
in your hand for the next play. How many cards to play is a real decision.

## The six ages

| Age | Hands | Discards | Rule | Crisis (one per run, shown from the start) |
|---|---|---|---|---|
| Tribal | 7 | 4 | *Hunters and Gatherers*: High Card and Pair give their stats twice | Harsh Winter or Great Flood |
| Ancient | 8 | 4 | *Writing*: each ♠ scored +4 chips | Plague or Great Drought |
| Medieval | 8 | 4 | *Feudal Levies*: +1 mult per living civilization | Invasion or Great Schism |
| Industrial | 9 | 4 | *Steam Power*: each ♣ scored gives +1 more Industry | Choking Skies, Market Crash or Revolution |
| Information | 9 | 4 | *The Network*: +2 mult per allied or rival pair | Machine Awakening or Age of Noise |
| Stellar | 10 | 4 | *Escape Velocity*: Straights, Flushes and better ×1.5 | The Great Filter or The Void Storm |

## Crises

A crisis weighs **pressure** against **resilience**:

- **Pressure:** the crisis itself, threatening land (cold land in a winter,
  crowded coasts in a plague) and **strain**. Strain is one stat outrunning
  another, such as Industry above Vitality in a winter, or Prosperity above
  Knowledge in a plague. In conflict crises, rivalries add pressure too.
- **Resilience:** the stats it tests (the main one counts double), sheltering
  land, the civilizations it names, alliances, and **Reserves**. Reserves are
  this era's score divided by a rate that rises each age (150, 250, 350, 400,
  700, 800).

Resilience ≥ pressure: **endured**. You gain the era's reward (4–6
Influence), 1 per unspent hand (and up to two unspent hands carry into the
next era), +3 for a **triumph** (margin at least a
quarter of the pressure), your Merchants' tiers, and **Treasury**:
1 per 8 Prosperity.

Resilience < pressure: **failed**. You lose one Resolve and take the scar,
which scales with the shortfall. A scar can lower stats, cut a civilization's
tier (tier 0 means it collapses), drown land into wasteland or dry it to
desert, or cost Influence. You still gain 2 Influence plus Treasury, and the
run goes on.

The crisis track shows all six crises from the start, with your world's
current margin against the next two. Plan for them: hands are few, and you
cannot prepare for everything.

## Civilizations

Eight peoples can arise; six are known from the start, and Mystics and
Mariners are discovered. The first civilization needs its stat at 5, the
second at 10, the third at 15, and so on. It also needs a free region of its
terrain.

| People | Needs | Lives on | Gift (Settlement → Kingdom → Empire scale it) |
|---|---|---|---|
| Nature Keepers | Vitality | forest | while Vitality ≥ Industry, each ♥ scored +3 chips per tier |
| Nomads | Vitality | plains, desert, tundra | +1 mult per tier for each suit scored beyond the first |
| Merchants | Prosperity | plains, coast | plays scoring 2+ ♦: +2 mult per tier; each era end +1 Influence per tier |
| Empire Builders | Industry | mountains | each ♣ scored +1 chip per tier per border of its home |
| Scholars | Knowledge | desert, tundra | each ♠ scored +1 chip per tier per 5 Knowledge |
| Technocrats | Industry and Knowledge | mountains, coast | plays scoring both ♣ and ♠: ×(1 + tier/4) |
| Mystics | Vitality and Knowledge | forest, desert | High Card, Pair and Two Pair: +3 mult per tier |
| Mariners | Prosperity and Vitality | coast | each ♦ or ♥ scored +1 chip per tier per coast |

At the dawn of an age, a civilization grows into a **Kingdom** (its stat at
20, from the Ancient age) and then an **Empire** (45, from the Industrial
age). Neighbouring civilizations become **allies** (+3 resilience in every
crisis) or **rivals** (+1 mult on every play, +5 pressure in conflict crises).
A collapsed people can rise again elsewhere.

## The Council

- **World cards** (3–7 Influence): playing cards with an effect, shuffled
  into your deck. They form poker hands like any card.
- **Decrees**: one-off acts. Reshape a region, raise a civilization a tier,
  move stat points, bank Reserves for the next crisis, gain two hands next
  era, turn your weakest cards into one suit.
- **Reroll** the market (1 Influence, +1 each time) and **remove** cards
  (3 Influence; a deck never goes below 24 cards).
- **Legendaries**: after the Tribal, Medieval and Information crises you
  choose one of three, free. After the Ancient and Industrial crises one is
  for sale. You hold at most four. Each changes a rule: hearts wild for
  Flushes, straights that wrap, a god that turns aside one failed crisis,
  a dragon that eats your weakest people and grows stronger.

The encyclopedia lists every card, decree, legendary, people, crisis and age.

## Progression

Finishing runs earns **achievements**, and each one unlocks content for later
runs: more world cards and decrees, legendaries, the Mystics and Mariners, and
four more **origins** (Archipelago, Highlands, Verdant, Frontier) that change
how the world is dealt. Unlocks add choices, never raw power.

Ascending unlocks the next **Omen**. Omens stack, each adding a rule:

1. **Lean Years** — one fewer discard every era.
2. **Harsh Lands** — more tundra and desert, fewer forests.
3. **Restless Peoples** — rivalries press every crisis; alliances give 2.
4. **Thin Council** — one fewer offer; rerolls cost 1 more.
5. **Pressing Crises** — +5% pressure.
6. **Deep Strain** — strain and inequality count 50% more.
7. **Fragile World** — begin with 2 Resolve.
8. **The Long Night** — one fewer hand in the last two ages; the final crisis
   gains +10 pressure per Resolve lost.

## Saving

Ascension autosaves after every action. Close the tab and **Continue** later.
Saves live in this browser, separate from Classic. **Settings → Export
backup** writes a file you can import on another device. An import is checked
first and never damages what is already there. A save made under different
rules is kept, not erased, and the game says why it cannot be resumed.

## Controls

- Click or tap cards, or press **1–8** to select them; **P** plays, **D**
  discards, **Esc** clears.
- **Sort** orders the hand by rank or suit.
- Arrow keys move between cards; on the globe, they walk the regions.
- Settings has a reduced-motion switch; the game also follows your system
  setting.
