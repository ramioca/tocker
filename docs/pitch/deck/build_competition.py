"""Tocker competition slide, minimal: the field in one strip, then what they share vs what Tocker does.
Run: python3 -I gen.py [out.html]  ->  refine/design/cmp10.html
All copy lives in DATA. Every "field" line must hold for all six rivals (research/26-competitors-deep/README.md).
"""
import html
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/cmp10.html"

DATA = {
    "eyebrow": "Competition · Agentic trading",
    "headline": "An early category. A different approach.",
    "field_label": "Six funded startups · largest disclosed round $4M",
    "field": [
        ("ClawPump", "/_blob/606b63ec1779ee82e35148ef101e17ed", "Agent wallets + launches"),
        ("Minara", "/_blob/03acbe489e6ea92d8d145a181c9dfa84", "Perps autopilot"),
        ("Senpi", "/_blob/ca68c6e24dedbf9baa8b126a87b00a6b", "Hyperliquid strategies"),
        ("Fere AI", "/_blob/3f187fc91f8eb98029cad57c307f6fec", "Ready-made agents"),
        ("Ask Gina", "/_blob/dea59d96bd66d04b62a83f5f399fbaa9", "Polymarket in chat"),
        ("HeyElsa", "/_blob/392c3ee86a193e8a1796ae2fe53d5a5b", "Chat-to-execute DeFi"),
    ],
    "they_title": "What they share",
    "tocker_logo": "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2",
    # (label, what all six share, evidence (pre, number, post), what Tocker does, proof line)
    "rows": [
        ("Data", "Bundled data. Paid sources opt-in at best.",
         ("", "3,505", " AI agents on shared data: no directional edge"),
         "Buys premium alpha per call, over x402",
         "SolEnrich · Nansen · Deepnets · Plexa · X sentiment · 14 sources"),
        ("Safety", "Stop-losses. Rug checks opt-in at best.",
         ("", "76%", " of new Solana tokens in H1 2025 were rug pulls"),
         "10 hard gates in code can veto any buy",
         "Honeypot · mint · freeze · tax · liquidity · holders · age · unknown means no"),
        ("Social", "Copy trading, or a leaderboard.",
         ("Copying a winning memecoin wallet turns ", "14% into 3%", ""),
         "Every fill is public. The strategy is not.",
         "Tx, slippage and entry score on every fill · follow, then launch your own"),
    ],
    "foot": ("Evidence: DXRG, arXiv 2026 · SolRugDetector, arXiv 2026 · Luo et al., WWW 2026. "
             "Rivals: docs, GitHub, X, DefiLlama, Oct 2026."),
    "note": ("Agentic trading is early: six funded startups, the largest disclosed round four million. "
             "What they share is bundled data, stop-losses and copy trading, and the evidence is against all three. "
             "So the agent buys alpha per call, ten gates in code can veto any buy, and every fill is public "
             "while the strategy stays private."),
}

MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
TOCKER_AR = 2984 / 2472

LABEL_W = 168
THEY_W = 660
TOCK_W = 1664 - LABEL_W - THEY_W     # 836
ROW_H = 122
TILE = 52


def esc(t):
    return html.escape(t, quote=False)


def mono(t, color=DIM, size=18, extra=""):
    return (f'<p style="{MONO};font-size:{size}px;letter-spacing:2px;text-transform:uppercase;line-height:24px;'
            f'color:{color};white-space:nowrap;{extra}">{esc(t)}</p>')


def field_strip():
    tiles = ""
    for name, logo, best in DATA["field"]:
        tiles += (f'<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:row;align-items:center;gap:14px">'
                  f'<img src="{logo}" alt="{esc(name)} logo" style="width:{TILE}px;height:{TILE}px;border-radius:13px;'
                  f'border:1px solid {HAIR};object-fit:cover;flex:none">'
                  f'<div style="display:flex;flex-direction:column;gap:2px;min-width:0">'
                  f'<p style="font-size:24px;font-weight:600;letter-spacing:-0.3px;line-height:1.15;color:{FG};white-space:nowrap">{esc(name)}</p>'
                  f'<p style="font-size:17px;line-height:1.25;color:{DIM};white-space:nowrap">{esc(best)}</p></div></div>')
    return (f'<div style="display:flex;flex-direction:column;gap:18px">'
            f'{mono(DATA["field_label"])}'
            f'<div style="display:flex;flex-direction:row;gap:16px">{tiles}</div></div>')


def compare():
    # header
    head = (f'<div style="display:flex;flex-direction:row;align-items:center;height:72px">'
            f'<div style="width:{LABEL_W}px;flex:none"></div>'
            f'<div style="width:{THEY_W}px;flex:none">{mono(DATA["they_title"])}</div>'
            f'<div style="width:{TOCK_W}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:12px;'
            f'padding:0 32px">'
            f'<img src="{DATA["tocker_logo"]}" alt="Tocker T mark" style="width:{round(40 * TOCKER_AR)}px;height:40px;object-fit:contain">'
            f'<p style="font-size:30px;font-weight:600;letter-spacing:-0.5px;line-height:1;color:{FG}">Tocker</p></div></div>')
    rows = ""
    for i, (label, they, ev, us, proof) in enumerate(DATA["rows"]):
        pre, num, post = ev
        ev_html = (f'<p style="font-size:19px;line-height:1.25;color:{DIM};white-space:nowrap;font-variant-numeric:tabular-nums">'
                   f'{esc(pre)}<span style="color:{FG};font-weight:600">{esc(num)}</span>{esc(post)}</p>')
        top = f"border-top:1px solid {HAIR};"
        rows += (f'<div style="display:flex;flex-direction:row;align-items:stretch;height:{ROW_H}px">'
                 f'<div style="width:{LABEL_W}px;flex:none;display:flex;align-items:center;{top}">{mono(label, MID)}</div>'
                 f'<div style="width:{THEY_W}px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:10px;padding-right:32px;{top}">'
                 f'<p style="font-size:28px;line-height:1.2;letter-spacing:-0.3px;color:{MID};white-space:nowrap">{esc(they)}</p>{ev_html}</div>'
                 f'<div style="width:{TOCK_W}px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:8px;'
                 f'padding:0 32px;{"border-top:1px solid rgba(244,244,241,0.14);" if i else ""}">'
                 f'<p style="font-size:32px;line-height:1.2;letter-spacing:-0.5px;font-weight:500;color:{FG};white-space:nowrap">{esc(us)}</p>'
                 f'<p style="font-size:19px;line-height:1.25;color:{MID};white-space:nowrap">{esc(proof)}</p></div></div>')
    # Tocker column highlight: absolutely positioned box behind the right column (header + rows)
    box_h = 72 + ROW_H * len(DATA["rows"])
    hl = (f'<div style="position:absolute;left:{LABEL_W + THEY_W}px;top:0px;width:{TOCK_W}px;height:{box_h}px;'
          f'border:1px solid rgba(244,244,241,0.5);border-radius:20px;background:rgba(244,244,241,0.05)"></div>')
    end = (f'<div style="display:flex;flex-direction:row"><div style="width:{LABEL_W + THEY_W}px;flex:none;'
           f'border-top:1px solid {HAIR}"></div></div>')
    return (f'<div style="position:relative;display:flex;flex-direction:column">{hl}'
            f'<div style="position:relative;display:flex;flex-direction:column">{head}{rows}{end}</div></div>')


def build():
    body = (f'<div style="display:flex;flex-direction:column;gap:44px;margin-top:8px">'
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
