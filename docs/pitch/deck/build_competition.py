"""Tocker competition slide: early category, strong players, a different approach.
Run: python3 -I gen.py [out.html]  ->  refine/design/tbl9.html
All copy and data live in DATA. Marks: Y live, P partial, N next, - not found.
Source of truth: /home/user/tocker/docs/pitch/research/26-competitors-deep/ (deep research, Oct 8 2026)
"""
import html
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/tbl9.html"

DATA = {
    "eyebrow": "Competition · Agentic trading",
    "headline": "An early category. A different approach.",
    "best_title": "Best at",
    "traction_title": "Traction",
    # the founder's four (inference last: rivals ship it, Tocker has it next); "|" splits a header
    "cols": [
        {"key": "x402", "title": "x402|alpha"},
        {"key": "gates", "title": "Filters|& gates"},
        {"key": "social", "title": "Social|trading"},
        {"key": "usdc", "title": "USDC|inference"},
    ],
    # sub = backers (Tocker: markets); tr = (figure, source); src "" = no source line
    "rows": [
        {"name": "Tocker", "logo": "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2", "sub": "Solana + Base",
         "best": "Paid alpha + hard gates, in public", "tr": ("Private beta", ""),
         "usdc": "N", "x402": "Y", "gates": "Y", "social": "Y"},
        {"name": "ClawPump", "logo": "/_blob/606b63ec1779ee82e35148ef101e17ed", "sub": "$250K Pump Fund · Colosseum",
         "best": "Agent wallets + token launches", "tr": ("$225M+ volume", "self-reported · Oct 2026"),
         "usdc": "Y", "x402": "Y", "gates": "P", "social": "P"},
        {"name": "Minara", "logo": "/_blob/03acbe489e6ea92d8d145a181c9dfa84", "sub": "Circle Ventures",
         "best": "AI CFO with perps autopilot", "tr": ("$2.6B perps volume", "DefiLlama · all-time"),
         "usdc": "Y", "x402": "P", "gates": "P", "social": "Y"},
        {"name": "Senpi", "logo": "/_blob/ca68c6e24dedbf9baa8b126a87b00a6b", "sub": "$4M seed · Lemniscap",
         "best": "Turnkey Hyperliquid strategies", "tr": ("$411M perps volume", "DefiLlama · all-time"),
         "usdc": "-", "x402": "-", "gates": "P", "social": "Y"},
        {"name": "Fere AI", "logo": "/_blob/3f187fc91f8eb98029cad57c307f6fec", "sub": "$1.3M seed · Ethereal",
         "best": "Ready-made 24/7 trading agents", "tr": ("7,000+ daily users", "self-reported · May 2026"),
         "usdc": "P", "x402": "-", "gates": "P", "social": "Y"},
        {"name": "Ask Gina", "logo": "/_blob/dea59d96bd66d04b62a83f5f399fbaa9", "sub": "Coinbase Ventures (per Gina)",
         "best": "Polymarket automations in chat", "tr": ("Not disclosed", ""),
         "usdc": "P", "x402": "-", "gates": "P", "social": "P"},
        {"name": "HeyElsa", "logo": "/_blob/392c3ee86a193e8a1796ae2fe53d5a5b", "sub": "$3M · M31",
         "best": "Chat-to-execute DeFi", "tr": ("945K+ wallets", "self-reported · Jan 2026"),
         "usdc": "-", "x402": "-", "gates": "P", "social": "P"},
    ],
    "legend": [("Y", "shipped"), ("P", "partial"), ("-", "not found")],
    "defs": ("x402 alpha = agent buys data per call · Gates = token-safety veto in code · "
             "Social = public trades, follow or copy · Inference = agent pays for its model in USDC"),
    "foot": ("Sources, Oct 2026: DefiLlama · company docs, GitHub and X · GlobeNewswire · Pump Fund · Colosseum. "
             "Funding under each rival."),
    "note": ("Agentic trading is early: a handful of seed-stage teams, each genuinely good at one thing. "
             "Minara has real perps volume, ClawPump the deepest agent toolkit, Senpi turnkey Hyperliquid "
             "strategies. Our approach is different: the agent buys alpha per call, screens every token in code "
             "before it buys, and trades in public. Paying for inference in USDC is next."),
}

# ---------- design tokens ----------
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
FAINT = "rgba(244,244,241,0.26)"
TOCKER_AR = 2984 / 2472

PADX = 24
INNER = 1664 - 2 * PADX
MW = 148                                      # four mark columns
W = {"name": 356, "best": 424}
W["tr"] = INNER - W["name"] - W["best"] - 4 * MW

HEAD_H = 54
ROW_H = 70
TOCK_H = 92
TILE = 44


def esc(t):
    return html.escape(t, quote=False)


def mark(kind, size=1.0):
    if kind == "Y":
        return f'<p style="font-size:{round(34 * size)}px;line-height:1;font-weight:500;color:{FG}">✓</p>'
    if kind == "P":
        d = round(26 * size)
        b = 2.5 if size == 1 else 2
        return (f'<div style="position:relative;width:{d}px;height:{d}px;border-radius:50%;border:{b}px solid {MID};overflow:hidden">'
                f'<div style="position:absolute;left:0px;top:0px;width:50%;height:100%;background:{MID}"></div></div>')
    if kind == "N":
        return (f'<p style="{MONO};font-size:17px;letter-spacing:2px;line-height:20px;color:{MID};padding:5px 10px 4px 12px;'
                f'border:1px solid rgba(244,244,241,0.22);border-radius:999px;white-space:nowrap">NEXT</p>')
    return f'<div style="width:{round(26 * size)}px;height:2px;background:{FAINT}"></div>'


def name_cell(row, hero):
    if hero:
        logo = (f'<img src="{row["logo"]}" alt="Tocker T mark" style="width:{round(52 * TOCKER_AR)}px;height:52px;'
                f'object-fit:contain;margin-left:-6px;margin-right:-6px">')
    else:
        logo = (f'<img src="{row["logo"]}" alt="{esc(row["name"])} logo" style="width:{TILE}px;height:{TILE}px;'
                f'border-radius:11px;border:1px solid {HAIR};object-fit:cover">')
    txt = (f'<div style="display:flex;flex-direction:column;gap:3px">'
           f'<p style="font-size:{32 if hero else 27}px;font-weight:600;letter-spacing:-0.5px;line-height:1.1;color:{FG};white-space:nowrap">{esc(row["name"])}</p>'
           f'<p style="font-size:18px;line-height:1.2;color:{MID if hero else DIM};white-space:nowrap;font-variant-numeric:tabular-nums">{esc(row["sub"])}</p></div>')
    return (f'<div style="width:{W["name"]}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:16px">'
            f'{logo}{txt}</div>')


def best_cell(row, hero):
    return (f'<div style="width:{W["best"]}px;flex:none;display:flex;align-items:center">'
            f'<p style="font-size:26px;line-height:1.2;letter-spacing:-0.3px;font-weight:{500 if hero else 400};'
            f'color:{FG};white-space:nowrap">{esc(row["best"])}</p></div>')


def tr_cell(row, hero):
    fig, src = row["tr"]
    muted = fig in ("Not disclosed",)
    col = DIM if muted else FG
    srcp = (f'<p style="font-size:17px;line-height:1.2;color:{DIM};white-space:nowrap">{esc(src)}</p>' if src else "")
    return (f'<div style="width:{W["tr"]}px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:3px">'
            f'<p style="font-size:24px;line-height:1.15;letter-spacing:-0.2px;color:{col};white-space:nowrap;'
            f'font-variant-numeric:tabular-nums">{esc(fig)}</p>{srcp}</div>')


def mark_cell(key, row):
    return (f'<div style="width:{MW}px;flex:none;display:flex;align-items:center;justify-content:center">'
            f'{mark(row[key])}</div>')


def row_html(row, i):
    hero = i == 0
    cells = (name_cell(row, hero) + best_cell(row, hero) + tr_cell(row, hero)
             + "".join(mark_cell(c["key"], row) for c in DATA["cols"]))
    if hero:
        box = (f"height:{TOCK_H}px;padding:0 {PADX - 1}px;border:1px solid rgba(244,244,241,0.5);border-radius:18px;"
               f"background:rgba(244,244,241,0.05);margin-bottom:4px")
    else:
        last = i == len(DATA["rows"]) - 1
        box = (f"height:{ROW_H}px;padding:0 {PADX}px;"
               f"{'border-top:1px solid ' + HAIR + ';' if i > 1 else ''}"
               f"{'border-bottom:1px solid ' + HAIR if last else ''}")
    return f'<div style="display:flex;flex-direction:row;align-items:center;{box}">{cells}</div>'


def head_p(t, align="left"):
    lines = "".join(f'<span style="display:block">{esc(x)}</span>' for x in t.split("|"))
    return (f'<p style="{MONO};font-size:17px;letter-spacing:1px;text-transform:uppercase;line-height:22px;'
            f'color:{MID};white-space:nowrap;text-align:{align}">{lines}</p>')


def legend():
    items = ""
    for k, t in DATA["legend"]:
        items += (f'<div style="display:flex;flex-direction:row;align-items:center;gap:6px">'
                  f'<div style="width:20px;display:flex;justify-content:center">{mark(k, 0.62)}</div>'
                  f'<p style="font-size:17px;line-height:22px;color:{DIM};white-space:nowrap">{esc(t)}</p></div>')
    return f'<div style="display:flex;flex-direction:row;align-items:center;gap:16px">{items}</div>'


def header():
    cells = f'<div style="width:{W["name"]}px;flex:none">{legend()}</div>'
    cells += f'<div style="width:{W["best"]}px;flex:none">{head_p(DATA["best_title"])}</div>'
    cells += f'<div style="width:{W["tr"]}px;flex:none">{head_p(DATA["traction_title"])}</div>'
    for c in DATA["cols"]:
        cells += (f'<div style="width:{MW}px;flex:none;display:flex;justify-content:center">'
                  f'{head_p(c["title"], "center")}</div>')
    return (f'<div style="height:{HEAD_H}px;display:flex;flex-direction:row;align-items:flex-end;padding:0 {PADX}px 14px">'
            f'{cells}</div>')


def build():
    table = (f'<div style="display:flex;flex-direction:column">{header()}'
             + "".join(row_html(r, i) for i, r in enumerate(DATA["rows"])) + '</div>')
    defs = (f'<p style="font-size:17px;line-height:22px;color:{DIM};white-space:nowrap;padding:0 {PADX}px">'
            f'{esc(DATA["defs"])}</p>')
    body = f'<div style="display:flex;flex-direction:column;gap:14px;margin-top:2px">{table}{defs}</div>'
    s = (
        f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
        f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{esc(DATA["eyebrow"])}</p>\n'
        f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px">{esc(DATA["headline"])}</h2>\n'
        f'{body}\n'
        f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{esc(DATA["foot"])}</p>\n'
        f'<aside>{esc(DATA["note"])}</aside>\n</section>\n'
    )
    open(OUT, "w").write(s)
    print("wrote", OUT, "| note words:", len(DATA["note"].split()), "| headline chars:", len(DATA["headline"]),
          "| widths:", W, "mark col:", MW)


build()
