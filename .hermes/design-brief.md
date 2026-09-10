# Worldhand UI overhaul — Celestial Card Table

## Surface
Primary: Operate. The player repeatedly makes card selections and needs immediate feedback. Secondary: Explore for the planet and Compare for shop offers.

## Composition
- Play screen: compact top run rail (epoch/target, lives, Seeds, actions), persistent compact owned-Joker strip, main two-column table.
- Left column: hand as the dominant object; selection preview directly above controls; Play/Discard controls adjacent and obvious.
- Right column: Three.js planet in an art-directed framed observatory window, with only contextual World Level/World Score and a compact expandable context line.
- Menu/settings/chronicle/quit remain accessible through one compact command button, not a permanent panel wall.
- Shop: dedicated screen with one tabbed offer board: Laws & World, Jokers, Planets, Consumables, Vouchers. One offer-card row at a time; Seeds/slots and Continue persist in the header/footer. No stacked full inventories.

## Visual system
- Deep ink-blue table (#081523/#0d2133), warm ivory (#f5eddc), muted gold (#d6ae58), rust/red and ocean blue for functional states.
- Typography: display serif/oldstyle for game title and section labels (Georgia fallback), readable system sans for controls/numerals.
- Crisp 1px borders, shallow paper/card shadows, small 4–8px radii only; no glassmorphism, purple gradients, excessive glow, or decorative pills.
- Card faces remain cream with strong suit colors and thick selected outline; joker strip uses small illustrated typographic marks rather than emoji.
- Motion is short and purposeful: selected card lift, score pulse, purchase/epoch transition; no perpetual bounce. Reduced motion disables transitions and Three.js rotation.

## Acceptance invariants
- No engine changes, scoring/targets/economy/randomness/progression/save compatibility unchanged.
- Main view immediately answers target, hand/category/score, next action, world growth.
- Shop keeps every purchasing capability and clearly handles affordability, full slots, queued consumables, Continue.
- 1280x800 and 480x800: no horizontal overflow; keyboard/focus/contrast/reduced motion preserved.
