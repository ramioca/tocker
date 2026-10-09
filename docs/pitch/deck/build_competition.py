"""Competition matrix: six AI trading startups vs Tocker on five capabilities (Slides subset).
Cells from docs/pitch/research/26-competitors-deep (README matrix + per-company §7 Autonomy), Oct 2026.
Marks: Y = yes, P = partly / opt-in, N = no or not found. Run: python3 -I matrix.py <out.html>"""
import html, re, sys

OUT = sys.argv[1]
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:Geist, Arial, sans-serif"
FG, MID, DIM, HAIR = "#f4f4f1", "#a3a3a1", "#818180", "#f4f4f11f"
e = lambda t: html.escape(t, quote=False)

COLS = [("Runs 24/7", "on its own"), ("Your rules", "and guardrails"), ("Rug veto", "in code"),
        ("Picks its data", "pays per call, x402"), ("Pays for its AI", "in USDC")]
ROWS = [
    ("ClawPump", "/_blob/0bc2d38756d41a19b0f4b42cae97ee97", "Agent toolkit", "YYPPY", ""),
    ("Minara", "/_blob/03acbe489e6ea92d8d145a181c9dfa84", "Chat + perps autopilot", "YYNPY", ""),
    ("Senpi", "/_blob/ca68c6e24dedbf9baa8b126a87b00a6b", "Hyperliquid perps agents", "YYNNN", ""),
    ("Fere AI", "/_blob/3f187fc91f8eb98029cad57c307f6fec", "Preset bots, fixed rules", "YNPNP", ""),
    ("Ask Gina", "/_blob/dea59d96bd66d04b62a83f5f399fbaa9", "Chat + Polymarket recipes", "PPNNP", "invert"),
    ("HeyElsa", "/_blob/392c3ee86a193e8a1796ae2fe53d5a5b", "Chat copilot", "NNNNN", ""),
]
TOCKER = ("Tocker", "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2", "Your agent, your rules", "YYYYY")
NAME_W, COL_W, ROW_H = 544, 224, 62
NOTE = ("It's a crowded space, and these are good teams, but each covers a piece. HeyElsa and Ask Gina are mostly chat "
        "with execution. Fere runs preset bots you can't configure. Senpi and Minara run perps strategies on bundled data, "
        "with no rug veto. Tocker does all five: it runs on its own 24/7, under your rules and guardrails, vetoes rugs in "
        "code, picks and pays for its data over x402, and pays for its own model in USDC.")
FOOT = "● yes · ○ partly or opt-in · — no · Rivals: docs, GitHub, X, Oct 2026 · Tocker: USDC AI payments on per account"


def mark(m, strong=False):
    if m == "Y":
        c = FG if strong else MID
        return f'<div style="width:18px; height:18px; display:flex; flex-direction:column; background:{c}; border-radius:256px"></div>'
    if m == "P":
        return f'<div style="width:18px; height:18px; display:flex; flex-direction:column; border:2px solid {MID}; border-radius:256px"></div>'
    return f'<p style="{SANS}; font-size:26px; line-height:1; color:#5c5c5b">—</p>'


def row(name, logo, what, marks, opt="", tocker=False):
    filt = "" if tocker else ("; filter:grayscale(1) invert(1); opacity:0.85" if opt == "invert" else "; filter:grayscale(1); opacity:0.85")
    fit = "contain" if tocker else "cover"
    name_c = FG
    what_c = MID if tocker else DIM
    cells = "".join(
        f'<div style="width:{COL_W}px; display:flex; flex-direction:row; justify-content:center; align-items:center; flex:0 0 auto">{mark(m, tocker)}</div>'
        for m in marks)
    style = (f"height:{ROW_H + 10 if tocker else ROW_H}px; display:flex; flex-direction:row; align-items:center; "
             + (f"background:#f4f4f10d; border:1px solid #f4f4f180; border-radius:16px" if tocker else f"border-top:1px solid {HAIR}"))
    pad = "padding:0 0 0 20px; " if tocker else ""
    return (f'    <div style="{style}">\n'
            f'      <div style="width:{NAME_W}px; {pad}display:flex; flex-direction:row; gap:16px; align-items:center; flex:0 0 auto">\n'
            f'        <img src="{logo}" alt="{e(name)} logo" style="width:40px; height:40px; border-radius:10px; object-fit:{fit}{filt}">\n'
            f'        <p style="width:150px; {SANS}; font-size:28px; font-weight:600; letter-spacing:-0.3px; white-space:nowrap; color:{name_c}">{e(name)}</p>\n'
            f'        <p style="{SANS}; font-size:24px; white-space:nowrap; color:{what_c}">{e(what)}</p>\n'
            f'      </div>\n      {cells}\n    </div>\n')


def build():
    head = "".join(
        f'<div style="width:{COL_W}px; display:flex; flex-direction:column; align-items:center; gap:2px; flex:0 0 auto">'
        f'<p style="{SANS}; font-size:26px; font-weight:600; letter-spacing:-0.3px; white-space:nowrap; color:{FG}">{e(a)}</p>'
        f'<p style="{SANS}; font-size:24px; white-space:nowrap; color:{DIM}">{e(b)}</p></div>'
        for a, b in COLS)
    rows = "".join(row(*r) for r in ROWS)
    body = (f'  <div style="display:flex; flex-direction:column">\n'
            f'    <div style="display:flex; flex-direction:row; align-items:end; padding:0 0 16px">\n'
            f'      <div style="width:{NAME_W}px; flex:0 0 auto"><p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">Six funded startups</p></div>\n'
            f'      {head}\n    </div>\n{rows}'
            f'    <div style="height:12px; border-top:1px solid {HAIR}"></div>\n'
            f'{row(*TOCKER, tocker=True)}  </div>\n')
    s = (f'<section id="competition" data-transition="fade" style="display:flex; flex-direction:column; gap:28px; padding:128px 128px 160px; background:#000000">\n'
         f'  <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">Competition · AI trading startups</p>\n'
         f'  <h2 style="width:1664px; {SANS}; font-size:88px; font-weight:600; line-height:1.05; letter-spacing:-3px; color:{FG}">Six good teams. Each covers a piece.</h2>\n'
         f'  <div style="flex:1"></div>\n{body}'
         f'  <p style="position:absolute; bottom:64px; left:128px; width:1664px; {SANS}; font-size:22px; line-height:1.35; white-space:nowrap; color:{DIM}">{e(FOOT)}</p>\n'
         f'  <aside>{e(NOTE)}</aside>\n</section>\n')
    open(OUT, "w").write(s)
    print("note words", len(NOTE.split()))


build()
