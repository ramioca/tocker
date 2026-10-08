"""Tocker competition slide, built strictly in the Slides subset (flow layout, text >= 24px, no margin,
no pinned layers except the footer). Rival strip, then what all six do vs Tocker in three rows.
Run: python3 -I gen.py [out.html]  ->  refine/design/cmp11.html
Facts: docs/pitch/research/26-competitors-deep (README.md, proof-points.md). Every "all six" line must hold for
ClawPump, Minara, Senpi, Fere AI, Ask Gina and HeyElsa.
"""
import html
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/cmp11.html"

DATA = {
    "eyebrow": "Competition · Agentic trading",
    # Founder's original, kept as an option: "An early category. A different approach."
    "headline": "An early category. We bet the other way.",
    "field_label": "Six funded startups · largest disclosed round $4M",
    # (name, logo blob, best at; "invert" flips a light tile dark)
    "field": [
        ("ClawPump", "/_blob/0bc2d38756d41a19b0f4b42cae97ee97", "Agent toolkit"),
        ("Minara", "/_blob/03acbe489e6ea92d8d145a181c9dfa84", "Perps autopilot"),
        ("Senpi", "/_blob/ca68c6e24dedbf9baa8b126a87b00a6b", "Hyperliquid AI"),
        ("Fere AI", "/_blob/3f187fc91f8eb98029cad57c307f6fec", "Agent catalogue"),
        ("Ask Gina", "/_blob/dea59d96bd66d04b62a83f5f399fbaa9", "Polymarket chat", "invert"),
        ("HeyElsa", "/_blob/392c3ee86a193e8a1796ae2fe53d5a5b", "DeFi copilot"),
    ],
    "they_title": "What all six do",
    "tocker_logo": "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2",
    # (label, all six do, evidence (pre, number, post), Tocker lead, Tocker rest, proof)
    "rows": [
        ("Data", "Run on bundled data by default.",
         ("", "1,544", " AI agents piled into one token in an hour"),
         "Picks and buys data", " per call, on x402.",
         "Nansen · Deepnets · X sentiment · x402 Bazaar"),
        ("Safety", "Cap risk. No rug veto before the swap.",
         ("", "76%", " of new Solana DEX tokens in H1 2025 were rugs"),
         "Vetoes unsafe buys", " with 10 code gates.",
         "Honeypot, tax, authority, liquidity, holders and more"),
        ("Social", "Copy trading, or volume and earnings boards.",
         ("Copying a top memecoin wallet: ", "14% becomes 3%", ""),
         "Publishes every fill,", " never the strategy.",
         "Tx, slippage, fees and entry score on every trade"),
    ],
    "foot": ("Evidence: DXRG, arXiv 2609.05663 · SolRugDetector, arXiv 2603.24625 · Luo et al., WWW 2026. "
             "Rivals: docs, GitHub, X, Oct 2026."),
    "note": ("Agentic trading is early: six funded startups, the largest disclosed round four million. "
             "Good teams, with three shared defaults: bundled data, no rug veto before the swap, and copy trading "
             "or leaderboards. We bet the other way. Our agent picks and buys data per call, ten gates in code "
             "can veto any buy, and every fill is public."),
}

MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
TOCKER_AR = 2984 / 2472

LABEL_W = 150
THEY_W = 640
TOCK_W = 1664 - LABEL_W - THEY_W          # 874
PAD = 40
HEAD_H = 60
ROW_H = 118
TILE = 48


def esc(t):
    return html.escape(t, quote=False)


def mono(t, color=DIM):
    return (f'<p style="{MONO};font-size:24px;letter-spacing:3px;text-transform:uppercase;line-height:1.2;'
            f'color:{color};white-space:nowrap">{esc(t)}</p>')


def field_strip():
    tiles = ""
    for name, logo, best, *opt in DATA["field"]:
        filt = "grayscale(1) invert(1)" if "invert" in opt else "grayscale(1)"
        tiles += (f'<div style="flex:1;display:flex;flex-direction:row;align-items:center;gap:14px">'
                  f'<img src="{logo}" alt="{esc(name)} logo" style="width:{TILE}px;height:{TILE}px;border-radius:12px;'
                  f'border:1px solid {HAIR};object-fit:cover;filter:{filt};opacity:0.85">'
                  f'<div style="display:flex;flex-direction:column;gap:2px">'
                  f'<p style="font-size:26px;font-weight:600;letter-spacing:-0.3px;line-height:1.15;color:{FG};white-space:nowrap">{esc(name)}</p>'
                  f'<p style="font-size:24px;line-height:1.2;color:{DIM};white-space:nowrap">{esc(best)}</p></div></div>')
    return (f'<div style="display:flex;flex-direction:column;gap:18px">{mono(DATA["field_label"])}'
            f'<div style="display:flex;flex-direction:row;gap:16px">{tiles}</div></div>')


def left_block():
    head = (f'<div style="height:{HEAD_H}px;display:flex;flex-direction:row;align-items:center">'
            f'<div style="width:{LABEL_W}px;flex:none"></div>{mono(DATA["they_title"])}</div>')
    rows = ""
    n = len(DATA["rows"])
    for i, (label, they, ev, *_rest) in enumerate(DATA["rows"]):
        pre, num, post = ev
        bottom = f";border-bottom:1px solid {HAIR}" if i == n - 1 else ""
        rows += (f'<div style="height:{ROW_H}px;display:flex;flex-direction:row;align-items:center;'
                 f'border-top:1px solid {HAIR}{bottom}">'
                 f'<div style="width:{LABEL_W}px;flex:none">{mono(label, MID)}</div>'
                 f'<div style="width:{THEY_W}px;flex:none;display:flex;flex-direction:column;gap:8px">'
                 f'<p style="font-size:28px;line-height:1.2;letter-spacing:-0.3px;color:{MID};white-space:nowrap">{esc(they)}</p>'
                 f'<p style="font-size:24px;line-height:1.25;color:{DIM};white-space:nowrap;font-variant-numeric:tabular-nums">'
                 f'{esc(pre)}<span style="color:{FG};font-weight:600">{esc(num)}</span>{esc(post)}</p></div></div>')
    # a transparent top stroke matches the Tocker box's 1px border so the rows line up
    return (f'<div style="width:{LABEL_W + THEY_W}px;flex:none;display:flex;flex-direction:column;'
            f'border-top:1px solid transparent">{head}{rows}</div>')


def tocker_block():
    head = (f'<div style="height:{HEAD_H}px;display:flex;flex-direction:row;align-items:center;gap:12px;padding:0 {PAD}px">'
            f'<img src="{DATA["tocker_logo"]}" alt="Tocker T mark" style="width:{round(36 * TOCKER_AR)}px;height:36px;object-fit:contain">'
            f'<p style="font-size:30px;font-weight:600;letter-spacing:-0.5px;line-height:1;color:{FG}">Tocker</p></div>')
    rows = ""
    for label, they, ev, lead, rest, proof in DATA["rows"]:
        rows += (f'<div style="height:{ROW_H}px;display:flex;flex-direction:column;justify-content:center;gap:8px;'
                 f'padding:0 {PAD}px;border-top:1px solid rgba(244,244,241,0.16)">'
                 f'<p style="font-size:40px;line-height:1.1;letter-spacing:-1px;font-weight:500;color:{MID};white-space:nowrap">'
                 f'<span style="color:{FG};font-weight:600">{esc(lead)}</span>{esc(rest)}</p>'
                 f'<p style="font-size:24px;line-height:1.25;color:{MID};white-space:nowrap">{esc(proof)}</p></div>')
    return (f'<div style="width:{TOCK_W}px;flex:none;display:flex;flex-direction:column;'
            f'background:rgba(244,244,241,0.05);border:1px solid rgba(244,244,241,0.5);border-radius:20px">'
            f'{head}{rows}</div>')


def build():
    compare = f'<div style="display:flex;flex-direction:row;align-items:flex-start">{left_block()}{tocker_block()}</div>'
    s = (
        f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
        f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{esc(DATA["eyebrow"])}</p>\n'
        f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG}">{esc(DATA["headline"])}</h2>\n'
        f'<div style="flex:1"></div>\n'
        f'{field_strip()}\n'
        f'<div style="height:14px"></div>\n'
        f'{compare}\n'
        f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{esc(DATA["foot"])}</p>\n'
        f'<aside>{esc(DATA["note"])}</aside>\n</section>\n'
    )
    open(OUT, "w").write(s)
    small = [x for x in __import__("re").findall(r"font-size:(\d+)px", s) if int(x) < 24]
    print("wrote", OUT, "| note words:", len(DATA["note"].split()), "| headline chars:", len(DATA["headline"]),
          "| text <24px:", len(small), "| pinned:", s.count("position:absolute"), "| margin:", s.count("margin"))


build()
