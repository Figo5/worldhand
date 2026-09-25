#!/usr/bin/env bash
# The Ascension release balance audit. Complete studies are kept on rerun.
set -euo pipefail
OUT=docs/development/experiments/ascension-release
mkdir -p "$OUT"
SIM=(node --import ./scripts/ts-resolve.mjs scripts/ascension-sim.mjs)
line_count() { if [ -f "$1" ]; then wc -l < "$1"; else echo 0; fi; }

if [ ! -s "$OUT/audit-1000-full.txt" ]; then
  "${SIM[@]}" 1000 all '{"prefix":"audit"}' > "$OUT/audit-1000-full.txt"
fi
if [ ! -s "$OUT/audit-1000-starter.txt" ]; then
  "${SIM[@]}" 1000 all '{"prefix":"audit","pool":"starter"}' > "$OUT/audit-1000-starter.txt"
fi
if [ ! -s "$OUT/seed-probe-553.txt" ]; then
  node --import ./scripts/ts-resolve.mjs scripts/ascension-seed-probe.mjs audit-553 starter > "$OUT/seed-probe-553.txt"
fi

if [ "$(line_count "$OUT/omens-250.txt")" -ne 63 ]; then
  : > "$OUT/omens-250.txt"
  for o in 0 1 2 3 4 5 6 7 8; do
    echo "== Omen $o (250 seeds)" >> "$OUT/omens-250.txt"
    "${SIM[@]}" 250 planner-late,arc-V,poker-dig,balanced,mediocre "{\"prefix\":\"omen\",\"omen\":$o}" | sed -n '3,8p' >> "$OUT/omens-250.txt"
  done
fi

if [ "$(line_count "$OUT/ablations-200.txt")" -ne 88 ]; then
  : > "$OUT/ablations-200.txt"
  for a in full no-reserves no-strain no-land no-terrain-in-crises no-passives no-civ-in-crises no-era-rules no-legendaries no-world-cards no-council; do
    echo "== $a (200 seeds)" >> "$OUT/ablations-200.txt"
    "${SIM[@]}" 200 planner-late,arc-V,poker-dig,balanced,mediocre,sampler "{\"prefix\":\"abl\",\"ablation\":\"$a\"}" | sed -n '3,9p' >> "$OUT/ablations-200.txt"
  done
fi

if [ ! -s "$OUT/legendary-lift-1000.txt" ]; then
  "${SIM[@]}" 1000 sampler,sampler-poker '{"prefix":"lift"}' > "$OUT/legendary-lift-1000.txt"
fi

if [ "$(line_count "$OUT/origins-200.txt")" -ne 30 ]; then
  : > "$OUT/origins-200.txt"
  for o in pangaea archipelago highlands verdant frontier; do
    echo "== $o (200 seeds)" >> "$OUT/origins-200.txt"
    "${SIM[@]}" 200 planner-late,balanced,arc-I,arc-K "{\"prefix\":\"origin\",\"origin\":\"$o\"}" | sed -n '3,7p' >> "$OUT/origins-200.txt"
  done
fi
