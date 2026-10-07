import html
OUT = "competition.html"  # write next to the other slides
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"

# Row interior = 1664 - 2*PADX - 2 (border) = 1614
PADX = 24
W_NAME, W_FUND = 264, 310
WS = [226, 190, 220, 198, 206]  # USDC, x402, gates, social, autonomous
assert W_NAME + W_FUND + sum(WS) == 1664 - 2 * PADX - 2

def glyph(kind, scale=1.0):
    if kind == "y":
        return f'<p style="width:{round(28*scale)}px;flex:none;font-size:{round(30*scale)}px;line-height:1;color:{FG}">✓</p>'
    if kind == "n":
        return f'<p style="width:{round(28*scale)}px;flex:none;font-size:{round(28*scale)}px;line-height:1;color:{DIM}">—</p>'
    if kind == "p":  # half-filled circle drawn in CSS so it renders the same everywhere
        d = round(22 * scale)
        return (f'<div style="width:{round(28*scale)}px;flex:none;display:flex;flex-direction:row;align-items:center">'
                f'<div style="position:relative;width:{d}px;height:{d}px;border-radius:50%;border:2px solid {MID};overflow:hidden">'
                f'<div style="position:absolute;left:0px;top:0px;width:50%;height:100%;background:{MID}"></div></div></div>')
    if kind == "next":
        fs, pad, ls = (17, "5px 9px 4px", "1.5px") if scale == 1.0 else (15, "3px 7px 2px", "1.5px")
        return (f'<p style="{MONO};font-size:{fs}px;letter-spacing:{ls};text-transform:uppercase;color:{FG};flex:none;'
                f'padding:{pad};border:1px solid rgba(244,244,241,0.5);border-radius:999px;white-space:nowrap">Next</p>')
    return ""

def cell(w, m):
    kind, note = (m if isinstance(m, tuple) else (m, ""))
    if kind == "txt":
        inner = f'<p style="font-size:22px;line-height:1.2;color:{MID};white-space:nowrap">{note}</p>'
    else:
        n = f'<p style="font-size:20px;line-height:1.2;color:{DIM};white-space:nowrap">{note}</p>' if note else ""
        inner = glyph(kind) + n
    return f'<div style="width:{w}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:10px">{inner}</div>'

def name_cell(name, sub, hot=False):
    size, wt = ("32px", "600") if hot else ("25px", "500")
    return (f'<div style="width:{W_NAME}px;flex:none;display:flex;flex-direction:column;gap:2px">'
            f'<p style="font-size:{size};font-weight:{wt};letter-spacing:-0.4px;line-height:1.1;color:{FG}">{name}</p>'
            f'<p style="font-size:20px;line-height:1.15;color:{DIM};white-space:nowrap">{sub}</p></div>')

def fund_cell(t, hot=False):
    return (f'<div style="width:{W_FUND}px;flex:none"><p style="font-size:22px;line-height:1.25;color:{FG if hot else MID};'
            f'font-variant-numeric:tabular-nums;white-space:nowrap">{t}</p></div>')

def row(name, sub, marks, fund, hot=False, top=True):
    if hot:
        box = (f"border:1px solid rgba(244,244,241,0.5);border-radius:16px;background:rgba(244,244,241,0.05);"
               f"padding:0 {PADX}px;height:76px")
    else:
        box = f"border:1px solid transparent;border-top:1px solid {HAIR if top else 'transparent'};padding:0 {PADX}px;height:{ROWH}px"
    cells = "".join(cell(w, m) for w, m in zip(WS, marks))
    return (f'<div style="display:flex;flex-direction:row;align-items:center;{box}">'
            f'{name_cell(name, sub, hot)}{cells}{fund_cell(fund, hot)}</div>')

def head(title, d, w, ctx=False):
    return (f'<div style="width:{w}px;flex:none;display:flex;flex-direction:column;gap:4px;padding:0 14px 0 0">'
            f'<p style="font-size:24px;font-weight:600;letter-spacing:-0.3px;line-height:1.2;color:{MID if ctx else FG};white-space:nowrap">{title}</p>'
            f'<p style="font-size:20px;line-height:1.3;color:{DIM};white-space:nowrap">{d}</p></div>')

def spanner(t, w):
    return (f'<div style="width:{w}px;flex:none;padding:0 14px 0 0"><p style="{MONO};font-size:18px;letter-spacing:3px;text-transform:uppercase;color:{DIM};'
            f'padding:0 0 8px 0;border-bottom:1px solid {HAIR}">{t}</p></div>')

ROWH = 62
header = (
    f'<div style="display:flex;flex-direction:column;gap:10px;padding:0 {PADX+1}px 12px">'
    f'<div style="display:flex;flex-direction:row">'
    f'<div style="width:{W_NAME}px;flex:none"></div>'
    + spanner("The stack", sum(WS[:4])) + spanner("Table stakes", WS[4]) + spanner("&nbsp;", W_FUND)
    + '</div><div style="display:flex;flex-direction:row;align-items:flex-start">'
    + f'<div style="width:{W_NAME}px;flex:none"></div>'
    + head("USDC inference", "Pays per model call", WS[0])
    + head("x402 data", "Buys data per call", WS[1])
    + head("Filters &amp; gates", "Token checks in code", WS[2])
    + head("Social trading", "Public agent record", WS[3])
    + head("Autonomous", "Hosted, runs 24/7", WS[4], ctx=True)
    + head("Funding · traction", "Latest public figure", W_FUND, ctx=True)
    + "</div></div>"
)

rows = (
    row("Tocker", "Hosted agent · SOL, Base",
        [("next", "BYO key now"), "y", "y", "y", "y"], "Private beta", hot=True)
    + row("Bankr", "Chat + agent rails",
          [("y", "LLM gateway"), "y", "n", ("p", "public posts"), ("p", "automations")], "BNKR token · 234k holders", top=False)
    + row("Senpi", "Hyperliquid perps agents",
          ["n", "n", ("p", "exits only"), ("y", "Arena"), "y"], "$4M+ seed · $100M+ volume")
    + row("Fere AI", "24/7 agent · multichain",
          ["n", "n", ("p", "exits only"), "n", "y"], "$1.3M seed · 10M+ actions")
    + row("Nansen AI", "Chat-to-trade · SOL, Base",
          ["n", ("n", "own data"), "n", "n", ("next", "testing")], "$500M+ traded in 2026")
    + row("Ask Gina", "Chat + Recipes",
          ["n", "n", "n", "n", ("y", "Recipes")], "Coinbase Ventures-backed")
)

def legend_item(m, t):
    return (f'<div style="display:flex;flex-direction:row;align-items:center;gap:8px">{m}'
            f'<p style="font-size:18px;color:{DIM};white-space:nowrap">{t}</p></div>')

legend = (f'<div style="display:flex;flex-direction:row;align-items:center;gap:16px">'
          + legend_item(glyph("y", 0.75), "live")
          + legend_item(glyph("p", 0.75), "partial")
          + legend_item(glyph("next", 0.75), "in progress")
          + legend_item(glyph("n", 0.75), "not found")
          + "</div>")

takeaway = (f'<div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;padding:16px 0 0 0;border-top:1px solid {HAIR}">'
            f'<p style="font-size:28px;letter-spacing:-0.3px;line-height:1.3;color:{MID};white-space:nowrap">Bankr has the payment rails. Senpi has the arena. <span style="color:{FG}">None we found is building all four.</span></p>'
            f'{legend}</div>')

body = (
    '<div style="flex:1"></div>\n'
    f'<div style="display:flex;flex-direction:column;gap:14px"><div style="display:flex;flex-direction:column">{header}{rows}</div>\n'
    f'{takeaway}</div>'
)

foot = ("Sources, Oct 2026 · Bankr: docs, CoinMarketCap · Senpi: TFN, Chainwire · Fere: GlobeNewswire, Hunted · Nansen: The Block, Cryptonews · Gina: askgina.ai")
note = ("Here's who is building agentic trading. Each owns a piece: Bankr has the payment rails, Senpi a public arena, Nansen the data and real volume. None we found is building all four: USDC inference, which ships next, x402 data, advanced filters and gates, and social trading. That full stack, hosted 24/7, is Tocker.")
print(len(note.split()), "words")

s = (
    f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
    f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">Competition · agentic trading startups</p>\n'
    f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px;margin-left:-6px">Agents are crowded. The stack isn’t.</h2>\n'
    f"{body}\n"
    f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{foot}</p>\n'
    f"<aside>{html.escape(note, quote=False)}</aside>\n</section>\n"
)
open(OUT, "w").write(s)
print("ok")
