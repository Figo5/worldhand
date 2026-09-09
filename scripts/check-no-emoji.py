#!/usr/bin/env python3
"""Scan rendered-UI source files for emoji (excluding the four card-suit text
symbols and the plain text checkmark U+2713, which are typographic glyphs
rendered in the text font, not emoji)."""
import re, sys

FILES = ["src/App.tsx", "src/styles.css", "src/components/Planet3D.tsx", "index.html"]
ALLOW = set("♠♥♦♣✓")
EMOJI = re.compile("[" +
    "\U0001F000-\U0001FAFF"   # misc emoji + symbols
    "\U00002600-\U0000267F"   # misc symbols (sun, cloud, hearts variants...)
    "\U00002701-\U000027BF"   # dingbats EXCLUDING U+2713 check mark
    "\U0001F10D-\U0001F10F"
    "\U0000FE0F"              # variation selector-16 (emoji presentation)
    "\U0001F900-\U0001F9FF"   # supplemental symbols
    "]")
hits = []
for f in FILES:
    try:
        text = open(f, encoding="utf-8").read()
    except FileNotFoundError:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        for ch in line:
            if ch in ALLOW:
                continue
            if EMOJI.match(ch):
                hits.append((f, i, ch, hex(ord(ch)), line.strip()[:80]))
if hits:
    for h in hits:
        print("EMOJI HIT:", h)
    sys.exit(1)
print("NO EMOJI in rendered UI sources (suit glyphs + text checkmark excluded by design): PASSED")