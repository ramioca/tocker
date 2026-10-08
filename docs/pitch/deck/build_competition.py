"""Concept B: SPOTLIGHT MATRIX competition slide for Tocker.
Run: python3 -I gen.py   ->  refine/design/mat-b.html

All slide data lives in DATA below. Patched with VERIFIED cells from
docs/pitch/research/22-matrix-verified.md (as of 2026-10-08).
Cell marks:
  S = spotlight (the ONE cell where that company is genuinely best; label 2-3 words)
  Y = live (quiet grey check, optional short note)
  P = partial (quiet grey half-circle, short note)
  N = next / in progress (NEXT pill, note = what exists today)
  - = not found in public sources (never "no")
"""
import html

# ============================== DATA (patch here) ==============================
DATA = {
    "eyebrow": "Competition · agentic trading startups",
    "headline": "Each wins a column. We build the row.",
    "columns": [  # founder's order, then table stakes. w = column width (px); name col + widths + 48 = 1664
        {"key": "usdc", "title": "USDC inference", "sub": "Pays per model call", "w": 238},
        {"key": "x402", "title": "x402 alpha", "sub": "Premium data, per call", "w": 262},
        {"key": "gates", "title": "Filters & gates", "sub": "Screens before a buy", "w": 224},
        {"key": "social", "title": "Social trading", "sub": "Public record, follow", "w": 256},
        {"key": "auto", "title": "Autonomous 24/7", "sub": "Hosted, always on", "w": 252, "stakes": True},
    ],
    # Ordered so each spotlight lands in the next column: the diagonal is the story.
    "rows": [
        {"name": "Bankr", "fact": "$7M+ in wallets", "best": "agent payment rails",
         "cells": {"usdc": ("S", "USDC LLM gateway"), "x402": ("Y", "wallet pays x402"), "gates": ("-", ""),
                   "social": ("P", "leaderboard, X posts"), "auto": ("Y", "scheduled")}},
        {"name": "Nansen AI", "fact": "$75M Accel (2021)", "best": "smart-money data",
         "cells": {"usdc": ("-", ""), "x402": ("S", "Sells data via x402"), "gates": ("-", ""),
                   "social": ("P", "tracks smart money"), "auto": ("P", "approve each trade")}},
        {"name": "Parasol", "fact": "grant-funded", "best": "hands-off memecoin agents",
         "cells": {"usdc": ("-", ""), "x402": ("P", "dev SDK"), "gates": ("S", "6-layer rug filter"),
                   "social": ("P", "points board"), "auto": ("Y", "")}},
        {"name": "Senpi", "fact": "$4M seed", "best": "Hyperliquid agents in public",
         "cells": {"usdc": ("-", ""), "x402": ("-", ""), "gates": ("P", "score floors"),
                   "social": ("S", "Copy + Agents Arena"), "auto": ("Y", "")}},
        {"name": "Fere AI", "fact": "$1.3M seed", "best": "always-on, multichain",
         "cells": {"usdc": ("-", ""), "x402": ("-", ""), "gates": ("P", "entry/stop rules"),
                   "social": ("P", "copies traders"), "auto": ("S", "Self-improving 24/7")}},
    ],
    "tocker": {"name": "Tocker", "sub": "Private beta · Solana + Base",
               "cells": {"usdc": ("N", "BYO key now"), "x402": ("Y", "14 data sources"), "gates": ("Y", "10 hard gates"),
                         "social": ("Y", "Public fills, follow"), "auto": ("Y", "Hosted 24/7, opt-in")}},
    # differentiator: list of (text, emphasised?)
    "diff": [("None we found combines ", False), ("paid alpha", True), (", ", False), ("token gates", True),
             (" and ", False), ("a public record", True), (". ", False), ("Tocker does", True),
             (", with USDC inference next.", False)],
    "footer": ("Startups we found, Oct 2026 · Sources: bankr.bot, Benzinga, The Block, parasol.so, Chainwire,"
               " DefiLlama, GlobeNewswire · Also mapped: Minara, HeyElsa, Ask Gina"),
    "note": ("Each of these teams is best at one piece. Bankr already pays for inference in USDC; for us that's next. "
             "Nansen sells the best data, and we buy it. Parasol filters memecoins, Senpi trades in public, "
             "Fere runs around the clock. None we found combines them. Tocker does."),
}
# ==============================================================================

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/mat-b.html"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
FAINT = "rgba(244,244,241,0.28)"

PAD = 24                 # row inner padding (x)
NAME_W = 1664 - 2 * PAD - sum(c["w"] for c in DATA["columns"])
ROW_H = 71
TOCKER_H = 84
DIFF_PX = 31
esc = lambda s: html.escape(s, quote=False)
assert NAME_W >= 360, NAME_W


def glyph(ch, color, size=26):
    return (f'<p style="width:26px;flex:none;font-size:{size}px;line-height:1;color:{color};'
            f'text-align:left">{ch}</p>')


def half(color=MID, d=20, box=26):
    return (f'<div style="width:{box}px;flex:none;display:flex;align-items:center">'
            f'<div style="position:relative;width:{d}px;height:{d}px;border-radius:50%;border:2px solid {color};overflow:hidden">'
            f'<div style="position:absolute;left:0;top:0;width:{d // 2}px;height:{d}px;background:{color}"></div></div></div>')


def note(t, color=DIM, size=21):
    return f'<p style="font-size:{size}px;line-height:1.2;color:{color};white-space:nowrap">{esc(t)}</p>' if t else ""


def next_pill():
    return (f'<p style="{MONO};font-size:17px;letter-spacing:1.5px;text-transform:uppercase;color:{FG};flex:none;'
            f'padding:6px 10px 5px;border:1px solid rgba(244,244,241,0.5);border-radius:999px;white-space:nowrap">Next</p>')


def cell(w, mark, text, hero=False):
    if mark == "S":
        inner = (f'<p data-pill="1" style="font-size:21px;font-weight:500;letter-spacing:-0.2px;line-height:1;color:{FG};'
                 f'padding:11px 14px 12px;border:1px solid {FG};border-radius:999px;white-space:nowrap;margin-left:-2px">{esc(text)}</p>')
    elif mark == "Y":
        inner = glyph("✓", FG if hero else MID) + (note(text, FG, 23) if hero else note(text))
    elif mark == "P":
        inner = half() + note(text)
    elif mark == "N":
        inner = next_pill() + note(text, MID if hero else DIM, 21)
    else:
        inner = glyph("—", FAINT, 24)
    return (f'<div data-cell="1" style="width:{w}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:10px">'
            f'{inner}</div>')


def name_block(name, line, fact="", hero=False):
    size = 36 if hero else 30
    sub = (f'<p style="font-size:21px;line-height:1.15;color:{MID};white-space:nowrap">{esc(line)}</p>' if hero else
           f'<p style="font-size:21px;line-height:1.15;color:{DIM};white-space:nowrap">Best at '
           f'<span style="color:{MID}">{esc(line)}</span></p>')
    fact_html = (f'<p style="font-size:20px;line-height:1;color:{DIM};white-space:nowrap">{esc(fact)}</p>' if fact else "")
    return (f'<div data-cell="1" style="width:{NAME_W}px;flex:none;display:flex;flex-direction:column;gap:6px">'
            f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:14px">'
            f'<p style="font-size:{size}px;font-weight:600;letter-spacing:-0.6px;line-height:1;color:{FG};white-space:nowrap">{esc(name)}</p>'
            f'{fact_html}</div>{sub}</div>')


def header():
    items = (("✓", "live", MID), ("half", "partial", MID), ("—", "not found", FAINT))
    legend = (f'<div style="width:{NAME_W}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:18px">'
              + "".join(
                  f'<div style="display:flex;flex-direction:row;align-items:center;gap:8px">'
                  + (half(MID, 16, 16) if g == "half" else f'<p style="font-size:20px;line-height:1;color:{c}">{g}</p>')
                  + f'<p style="font-size:20px;line-height:1;color:{DIM};white-space:nowrap">{t}</p></div>'
                  for g, t, c in items)
              + "</div>")
    cols = ""
    for c in DATA["columns"]:
        tc = MID if c.get("stakes") else FG
        cols += (f'<div style="width:{c["w"]}px;flex:none;display:flex;flex-direction:column;gap:6px">'
                 f'<p style="font-size:25px;font-weight:600;letter-spacing:-0.4px;line-height:1.1;color:{tc};white-space:nowrap">{esc(c["title"])}</p>'
                 f'<p style="font-size:20px;line-height:1.2;color:{DIM};white-space:nowrap">{esc(c["sub"])}</p></div>')
    return (f'<div style="display:flex;flex-direction:row;align-items:flex-end;padding:0 {PAD}px 14px">'
            f'{legend}{cols}</div>')


def row(r):
    cells = "".join(cell(c["w"], *r["cells"][c["key"]]) for c in DATA["columns"])
    return (f'<div style="display:flex;flex-direction:row;align-items:center;height:{ROW_H}px;padding:0 {PAD}px;'
            f'border-top:1px solid {HAIR}">{name_block(r["name"], r["best"], r.get("fact", ""))}{cells}</div>')


def tocker_row(t):
    cells = "".join(cell(c["w"], *t["cells"][c["key"]], hero=True) for c in DATA["columns"])
    return (f'<div style="display:flex;flex-direction:row;align-items:center;height:{TOCKER_H}px;padding:0 {PAD - 1}px;'
            f'border:1px solid rgba(244,244,241,0.5);border-radius:18px;background:rgba(244,244,241,0.05)">'
            f'{name_block(t["name"], t["sub"], hero=True)}{cells}</div>')


def diff_line():
    parts = "".join(f'<span style="color:{FG if hot else MID}">{esc(t)}</span>' for t, hot in DATA["diff"])
    return (f'<p style="font-size:{DIFF_PX}px;letter-spacing:-0.5px;line-height:1.3;color:{MID};white-space:nowrap;'
            f'padding:0 0 0 {PAD}px">{parts}</p>')


def build():
    rows = "".join(row(r) for r in DATA["rows"])
    matrix = (f'<div style="display:flex;flex-direction:column;margin-top:22px">{header()}{rows}'
              f'<div style="height:1px;background:{HAIR};margin:0 0 10px"></div>'
              f'{tocker_row(DATA["tocker"])}</div>')
    body = f'{matrix}\n{diff_line()}'
    return (
        f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};font-variant-numeric:tabular-nums;padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
        f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{esc(DATA["eyebrow"])}</p>\n'
        f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px;white-space:nowrap;margin-left:-5px">{esc(DATA["headline"])}</h2>\n'
        f"{body}\n"
        f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{esc(DATA["footer"])}</p>\n'
        f'<aside>{esc(DATA["note"])}</aside>\n</section>\n'
    )


if __name__ == "__main__":
    s = build()
    open(OUT, "w").write(s)
    print("wrote", OUT, len(s), "bytes; name col:", NAME_W, "; note words:", len(DATA["note"].split()),
          "; headline chars:", len(DATA["headline"]))
