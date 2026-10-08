"""Tocker competition slide: early category, strong players, a different approach.
Run: python3 -I gen.py  ->  refine/design/tbl8.html
All copy and data live in DATA. Marks: Y live, P partial, N next, - not found.
Source of truth for cells and 'Best at': /home/user/tocker/docs/pitch/research/22-matrix-verified.md
(ClawPump: research/25-clawpump.md)
"""
import html
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else \
    "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/tbl8.html"

DATA = {
    "eyebrow": "Competition · Agentic trading",
    "headline": "An early category. A different approach.",
    "best_title": "Best at",
    # the founder's four, in his order
    "cols": [
        {"key": "usdc", "title": "USDC inference"},
        {"key": "x402", "title": "x402 alpha"},
        {"key": "gates", "title": "Filters & gates"},
        {"key": "social", "title": "Social trading"},
    ],
    "rows": [
        {"name": "Tocker", "logo": True, "fact": "Private beta",
         "best": "Paid alpha + hard gates, in public",
         "usdc": "N", "x402": "Y", "gates": "Y", "social": "Y"},
        {"name": "ClawPump", "fact": "Pump Fund · Colosseum",
         "best": "Agent wallets + token launches",
         "usdc": "P", "x402": "Y", "gates": "P", "social": "-"},
        {"name": "Fere AI", "fact": "$1.3M seed · Ethereal",
         "best": "Self-improving 24/7 agent",
         "usdc": "-", "x402": "-", "gates": "P", "social": "P"},
        {"name": "Senpi", "fact": "$4M seed · Lemniscap",
         "best": "Copy trading + public Arena",
         "usdc": "-", "x402": "-", "gates": "P", "social": "Y"},
        {"name": "Ask Gina", "fact": "Coinbase Ventures",
         "best": "Chat bets on Polymarket",
         "usdc": "-", "x402": "-", "gates": "-", "social": "-"},
        {"name": "Minara", "fact": "$2.6B perps volume",
         "best": "Perps autopilot, forced TP/SL",
         "usdc": "-", "x402": "-", "gates": "P", "social": "Y"},
        {"name": "HeyElsa", "fact": "$3M · M31",
         "best": "Chat-to-execute DeFi on Base",
         "usdc": "-", "x402": "-", "gates": "-", "social": "P"},
    ],
    "legend": [("Y", "live"), ("P", "partial"), ("-", "not found")],
    "foot": ("Sources, Oct 2026: clawpump.tech, Pump Fund · GlobeNewswire · DefiLlama, Chainwire · "
             "askgina.ai · HeyElsa blog · Tocker code"),
    "note": ("Agentic trading is a brand-new category: a handful of seed-stage teams, each genuinely good at "
             "one thing. ClawPump at agent wallets and launches, Senpi at copy trading, Minara at disciplined perps. "
             "Our approach is different: one agent that buys alpha per call, screens every token in code, and "
             "trades in public."),
}

# ---------- design tokens ----------
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
FAINT = "rgba(244,244,241,0.26)"
LOGO = "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2"  # 2984x2472 transparent PNG
LOGO_AR = 2984 / 2472

PADX = 28
INNER = 1664 - 2 * PADX
W = {"name": 330, "best": 480}
MW = (INNER - W["name"] - W["best"]) // 4      # four mark columns
W["name"] += INNER - W["name"] - W["best"] - 4 * MW

HEAD_H = 40
ROW_H = 72
TOCK_H = 100
LOGO_H = 56


def esc(t):
    return html.escape(t, quote=False)


def mark(kind, size=1.0):
    if kind == "Y":
        return f'<p style="font-size:{round(36 * size)}px;line-height:1;font-weight:500;color:{FG}">✓</p>'
    if kind == "P":
        d = round(28 * size)
        b = 2.5 if size == 1 else 2
        return (f'<div style="position:relative;width:{d}px;height:{d}px;border-radius:50%;border:{b}px solid {MID};overflow:hidden">'
                f'<div style="position:absolute;left:0px;top:0px;width:50%;height:100%;background:{MID}"></div></div>')
    if kind == "N":
        return (f'<p style="{MONO};font-size:19px;letter-spacing:2px;line-height:20px;color:{FG};padding:8px 14px 7px 16px;'
                f'border:1.5px solid rgba(244,244,241,0.4);border-radius:999px;white-space:nowrap">NEXT</p>')
    return f'<div style="width:{round(28 * size)}px;height:2px;background:{FAINT}"></div>'


def name_cell(row):
    hero = bool(row.get("logo"))
    txt = (f'<div style="display:flex;flex-direction:column;gap:4px">'
           f'<p style="font-size:{34 if hero else 30}px;font-weight:600;letter-spacing:-0.6px;line-height:1.1;color:{FG};white-space:nowrap">{esc(row["name"])}</p>'
           f'<p style="font-size:20px;line-height:1.2;color:{MID if hero else DIM};white-space:nowrap;font-variant-numeric:tabular-nums">{esc(row["fact"])}</p></div>')
    logo = ""
    if hero:
        logo = (f'<img src="{LOGO}" alt="Tocker T mark" style="width:{round(LOGO_H * LOGO_AR)}px;height:{LOGO_H}px;'
                f'object-fit:contain;margin-left:-4px">')
    return (f'<div style="width:{W["name"]}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:18px">'
            f'{logo}{txt}</div>')


def best_cell(row):
    hero = bool(row.get("logo"))
    return (f'<div style="width:{W["best"]}px;flex:none;display:flex;align-items:center">'
            f'<p style="font-size:28px;line-height:1.2;letter-spacing:-0.3px;font-weight:{500 if hero else 400};'
            f'color:{FG};white-space:nowrap">{esc(row["best"])}</p></div>')


def mark_cell(key, row):
    return (f'<div style="width:{MW}px;flex:none;display:flex;align-items:center;justify-content:center">'
            f'{mark(row[key])}</div>')


def row_html(row, i):
    hero = bool(row.get("logo"))
    cells = name_cell(row) + best_cell(row) + "".join(mark_cell(c["key"], row) for c in DATA["cols"])
    if hero:
        box = (f"height:{TOCK_H}px;padding:0 {PADX - 1}px;border:1px solid rgba(244,244,241,0.5);border-radius:18px;"
               f"background:rgba(244,244,241,0.05);margin-bottom:6px")
    else:
        last = i == len(DATA["rows"]) - 1
        box = (f"height:{ROW_H}px;padding:0 {PADX}px;"
               f"{'border-top:1px solid ' + HAIR + ';' if i > 1 else ''}"
               f"{'border-bottom:1px solid ' + HAIR if last else ''}")
    return f'<div style="display:flex;flex-direction:row;align-items:center;{box}">{cells}</div>'


def head_p(t, align="left"):
    return (f'<p style="{MONO};font-size:18px;letter-spacing:1px;text-transform:uppercase;line-height:24px;'
            f'color:{MID};white-space:nowrap;text-align:{align}">{esc(t)}</p>')


def legend():
    items = ""
    for k, t in DATA["legend"]:
        items += (f'<div style="display:flex;flex-direction:row;align-items:center;gap:6px">'
                  f'<div style="width:22px;display:flex;justify-content:center">{mark(k, 0.6)}</div>'
                  f'<p style="font-size:18px;line-height:24px;color:{DIM};white-space:nowrap">{esc(t)}</p></div>')
    return f'<div style="display:flex;flex-direction:row;align-items:center;gap:18px">{items}</div>'


def header():
    cells = f'<div style="width:{W["name"]}px;flex:none;display:flex;align-items:center;height:24px">{legend()}</div>'
    cells += f'<div style="width:{W["best"]}px;flex:none">{head_p(DATA["best_title"])}</div>'
    for c in DATA["cols"]:
        cells += (f'<div style="width:{MW}px;flex:none;display:flex;justify-content:center">'
                  f'{head_p(c["title"], "center")}</div>')
    return (f'<div style="height:{HEAD_H}px;display:flex;flex-direction:row;align-items:flex-start;padding:0 {PADX}px">'
            f'{cells}</div>')


def build():
    table = (f'<div style="display:flex;flex-direction:column">{header()}'
             + "".join(row_html(r, i) for i, r in enumerate(DATA["rows"])) + '</div>')
    body = f'<div style="display:flex;flex-direction:column;margin-top:14px">{table}</div>'
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
