"""Tocker competition slide, variant B ("accentuate"): the field in one tight strip, then three bands where
what the rivals share is set quiet on the left and Tocker's difference is the hero on the right.
Run: python3 -I gen.py [out.html]  ->  refine/design/cmp-m.html
All copy lives in DATA. Every "they share" line must hold for all six rivals (research/26-competitors-deep/README.md).
"""
import html
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/cmp-m.html"

DATA = {
    "eyebrow": "Competition · Agentic trading",
    # Founder's original, kept as an option: "An early category. A different approach."
    "headline": "An early category. We bet the other way.",
    "field_label": "Six funded startups · largest disclosed round $4M",
    "field": [
        ("ClawPump", "/_blob/0bc2d38756d41a19b0f4b42cae97ee97", "Agent wallets + launches"),
        ("Minara", "/_blob/03acbe489e6ea92d8d145a181c9dfa84", "AI CFO, perps autopilot"),
        ("Senpi", "/_blob/ca68c6e24dedbf9baa8b126a87b00a6b", "AI quant for Hyperliquid"),
        ("Fere AI", "/_blob/3f187fc91f8eb98029cad57c307f6fec", "Pick-and-fund agents"),
        ("Ask Gina", "/_blob/dea59d96bd66d04b62a83f5f399fbaa9", "Polymarket automations", "invert"),
        ("HeyElsa", "/_blob/392c3ee86a193e8a1796ae2fe53d5a5b", "Chat-to-execute DeFi"),
    ],
    "they_title": "What all six do",
    "tocker_logo": "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2",
    # (label, what all six do, evidence (pre, number, post), Tocker lead, Tocker rest, proof line)
    # Facts: 14 x402 registry entries from 12 providers plus Bazaar (any listed x402 API); 10 hard gates in
    # src/lib/tokens/score.ts (unknown blocks for mint, freeze, liquidity, holders, age, top-10 only, so the
    # slide does not claim "unknown means no"); public receipts per SPEC trade_receipts.
    "rows": [
        ("Data", "Run on bundled data by default.",
         ("", "1,544", " AI agents piled into the same token within an hour"),
         "Picks and buys data", " per call, over x402.",
         "X sentiment · Deepnets rug risk · Nansen smart money · x402 Bazaar"),
        ("Safety", "Cap risk, but no rug veto before the swap.",
         ("", "76%", " of new Solana DEX tokens in H1 2025 flagged as rugs"),
         "Vetoes unsafe buys", " with 10 gates in code.",
         "Mint · freeze · honeypot · can't-sell · tax · liquidity · holders · age · top-10 · blocklist"),
        ("Social", "Let users copy traders, or rank by volume or earnings.",
         ("Copying a winning memecoin wallet turns ", "14% into 3%", ""),
         "Publishes every fill,", " never the strategy.",
         "Tx hash · slippage · fees · entry score. Follow, then launch your own."),
    ],
    "foot": ("Evidence: DXRG, arXiv 2609.05663 · SolRugDetector, arXiv 2603.24625 · Luo et al., WWW 2026. "
             "Rivals: docs, GitHub, X, DefiLlama, Oct 2026."),
    "note": ("Agentic trading is early: six funded startups, the largest disclosed round four million. "
             "Good teams, with three shared defaults: bundled data, no rug veto before the swap, and copy trading "
             "or volume leaderboards. We bet the other way. Our agent picks and buys data per call, ten gates in "
             "code can veto any buy, and every fill is public."),
}

MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
TOCKER_AR = 2984 / 2472

LABEL_W = 128
THEY_W = 576
BOX_W = 1664 - LABEL_W - THEY_W     # 960
BOX_PAD = 44
HEAD_H = 64
ROW_H = 130
TILE = 44


def esc(t):
    return html.escape(t, quote=False)


def mono(t, color=DIM, size=18, extra=""):
    return (f'<p style="{MONO};font-size:{size}px;letter-spacing:2px;text-transform:uppercase;line-height:24px;'
            f'color:{color};white-space:nowrap;{extra}">{esc(t)}</p>')


def field_strip():
    tiles = ""
    for name, logo, best, *opt in DATA["field"]:
        filt = "grayscale(1) invert(1)" if "invert" in opt else "grayscale(1)"
        tiles += (f'<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:row;align-items:center;gap:12px">'
                  f'<img src="{logo}" alt="{esc(name)} logo" style="width:{TILE}px;height:{TILE}px;border-radius:11px;'
                  f'border:1px solid {HAIR};object-fit:cover;flex:none;filter:{filt};opacity:0.85">'
                  f'<div style="display:flex;flex-direction:column;gap:1px;min-width:0">'
                  f'<p style="font-size:22px;font-weight:600;letter-spacing:-0.3px;line-height:1.15;color:{FG};white-space:nowrap">{esc(name)}</p>'
                  f'<p style="font-size:17px;line-height:1.25;color:{DIM};white-space:nowrap">{esc(best)}</p></div></div>')
    return (f'<div style="display:flex;flex-direction:column;gap:16px">'
            f'{mono(DATA["field_label"])}'
            f'<div style="display:flex;flex-direction:row;gap:16px">{tiles}</div></div>')


def compare():
    left_w = LABEL_W + THEY_W
    head = (f'<div style="display:flex;flex-direction:row;align-items:center;height:{HEAD_H}px">'
            f'<div style="width:{LABEL_W}px;flex:none"></div>'
            f'<div style="width:{THEY_W}px;flex:none">{mono(DATA["they_title"])}</div>'
            f'<div style="width:{BOX_W}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:12px;padding:0 {BOX_PAD}px">'
            f'<img src="{DATA["tocker_logo"]}" alt="Tocker T mark" style="width:{round(34 * TOCKER_AR)}px;height:34px;object-fit:contain">'
            f'<p style="font-size:28px;font-weight:600;letter-spacing:-0.5px;line-height:1;color:{FG}">Tocker</p></div></div>')
    rows = ""
    tock_l = left_w + BOX_PAD
    for i, (label, they, ev, lead, cont, proof) in enumerate(DATA["rows"]):
        pre, num, post = ev
        small = f"font-size:19px;line-height:1.3;white-space:nowrap;font-variant-numeric:tabular-nums"
        # two baseline-aligned lines per band: statement line, then evidence/proof line
        line1 = (f'<div style="display:flex;flex-direction:row;align-items:baseline">'
                 f'<div style="width:{LABEL_W}px;flex:none">{mono(label, MID)}</div>'
                 f'<p style="width:{THEY_W}px;flex:none;font-size:22px;line-height:1.25;letter-spacing:-0.2px;color:{DIM};white-space:nowrap">{esc(they)}</p>'
                 f'<p style="padding-left:{BOX_PAD}px;font-size:44px;line-height:1.1;letter-spacing:-1.4px;font-weight:600;color:{FG};white-space:nowrap;'
                 f'font-variant-numeric:tabular-nums">{esc(lead)}<span style="color:{MID};font-weight:500">{esc(cont)}</span></p></div>')
        line2 = (f'<div style="display:flex;flex-direction:row;align-items:baseline">'
                 f'<div style="width:{LABEL_W}px;flex:none"></div>'
                 f'<p style="width:{THEY_W}px;flex:none;{small};color:{DIM}">'
                 f'{esc(pre)}<span style="color:{FG};font-weight:600">{esc(num)}</span>{esc(post)}</p>'
                 f'<p style="padding-left:{BOX_PAD}px;{small};color:{MID}">{esc(proof)}</p></div>')
        rule = (f'<div style="position:absolute;left:0px;top:0px;width:{left_w}px;border-top:1px solid {HAIR}"></div>'
                + f'<div style="position:absolute;left:{left_w}px;top:0px;width:{BOX_W}px;border-top:1px solid rgba(244,244,241,0.14)"></div>')
        rows += (f'<div style="position:relative;display:flex;flex-direction:column;justify-content:center;gap:10px;height:{ROW_H}px">'
                 f'{rule}{line1}{line2}</div>')
    box_h = HEAD_H + ROW_H * len(DATA["rows"])
    hl = (f'<div style="position:absolute;left:{left_w}px;top:0px;width:{BOX_W}px;height:{box_h}px;'
          f'border:1px solid rgba(244,244,241,0.5);border-radius:20px;background:rgba(244,244,241,0.05)"></div>')
    end = (f'<div style="display:flex;flex-direction:row"><div style="width:{left_w}px;flex:none;'
           f'border-top:1px solid {HAIR}"></div></div>')
    return (f'<div style="position:relative;display:flex;flex-direction:column">{hl}'
            f'<div style="position:relative;display:flex;flex-direction:column">{head}{rows}{end}</div></div>')


def build():
    body = (f'<div style="display:flex;flex-direction:column;gap:48px;margin-top:12px">'
            f'{field_strip()}{compare()}</div>')
    s = (
        f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
        f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{esc(DATA["eyebrow"])}</p>\n'
        f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px">{esc(DATA["headline"])}</h2>\n'
        f'{body}\n'
        f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{esc(DATA["foot"])}</p>\n'
        f'<aside>{esc(DATA["note"])}</aside>\n</section>\n'
    )
    open(OUT, "w").write(s)
    print("wrote", OUT, "| note words:", len(DATA["note"].split()), "| headline chars:", len(DATA["headline"]))


build()
