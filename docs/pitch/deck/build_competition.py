"""Tocker competition slide as a premium table.
Run: python3 -I gen.py  ->  refine/design/tbl.html
All copy and data live in DATA. Marks: Y live, P partial, N next, - not found.
Source of truth for cells: /home/user/tocker/docs/pitch/research/22-matrix-verified.md
"""
import html

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/tbl.html"

DATA = {
    "eyebrow": "Competition · AI trading agents",
    "headline": "Six agents trade. Only one buys alpha.",
    # edge = the founder's four, in his order; stake = table stakes (grey header)
    "cols": [
        {"key": "usdc", "title": "USDC inference", "kind": "edge"},
        {"key": "x402", "title": "x402 alpha", "kind": "edge"},
        {"key": "gates", "title": "Filters & gates", "kind": "edge"},
        {"key": "social", "title": "Social trading", "kind": "edge"},
        {"key": "auto", "title": "Autonomous 24/7", "kind": "stake"},
    ],
    "markets_title": "Markets",
    # "|" in a string = forced line break (Tocker row only; it is the taller hero row)
    "rows": [
        {"name": "Tocker", "logo": True, "line": "Plain-English strategy|→ your own agent",
         "usdc": ("N", "BYO key now"), "x402": ("Y", "14 data sources"), "gates": ("Y", "10 hard gates"),
         "social": ("Y", "public fills,|private strategy"), "auto": ("Y", "opt-in"),
         "markets": "Solana + Base, any token", "fact": "Private beta"},
        {"name": "Fere AI", "line": "Self-improving 24/7 agent",
         "usdc": ("-", ""), "x402": ("-", ""), "gates": ("P", "entry/stop rules"),
         "social": ("P", "copies fomo traders"), "auto": ("Y", ""),
         "markets": "5 chains + Polymarket", "fact": "$1.3M seed · Ethereal"},
        {"name": "Senpi", "line": "Hyperliquid agents + copy trading",
         "usdc": ("-", ""), "x402": ("-", ""), "gates": ("P", "score floors"),
         "social": ("Y", "copy + Arena"), "auto": ("Y", ""),
         "markets": "Hyperliquid perps", "fact": "$4M seed · Lemniscap"},
        {"name": "Ask Gina", "line": "Chat bets + scheduled Recipes",
         "usdc": ("-", ""), "x402": ("-", ""), "gates": ("-", ""),
         "social": ("-", ""), "auto": ("Y", "Recipes"),
         "markets": "Polymarket, HL, 12+ chains", "fact": "Coinbase Ventures"},
        {"name": "Minara", "line": "Perps autopilot + copy agents",
         "usdc": ("-", ""), "x402": ("-", ""), "gates": ("P", "forced TP/SL"),
         "social": ("Y", "copy wallets"), "auto": ("Y", "Autopilot"),
         "markets": "HL/Lighter perps + spot", "fact": "$2.6B cum. perps volume"},
        {"name": "HeyElsa", "line": "Chat-to-execute DeFi",
         "usdc": ("-", ""), "x402": ("-", "sells x402 APIs"), "gates": ("-", ""),
         "social": ("P", "volume arena"), "auto": ("P", "limit orders"),
         "markets": "Base + 15 chains", "fact": "$3M · M31"},
    ],
    # (grey lead, white claim, grey tail)
    "takeaway": ("None we found combines", "paid alpha, token gates and public trades.", "USDC inference is next."),
    "foot": ("Sources, Oct 2026 · Fere AI: GlobeNewswire · Senpi: DefiLlama, Chainwire · Ask Gina: askgina.ai · "
             "Minara: DefiLlama · HeyElsa: company blog · Tocker: product code"),
    "note": ("These are the agents closest to us. They all trade for you, and Senpi and Minara even let you "
             "copy traders. None does all three: buy alpha per call, screen every token, and trade in public. "
             "Tocker does. Bankr's wallet can pay x402 too, but it's rails, not a strategy agent with gates."),
}

# ---------- design tokens ----------
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "rgba(244,244,241,0.12)"
LOGO = "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2"  # 2984x2472 transparent PNG
LOGO_AR = 2984 / 2472

PADX = 22                       # row inner padding; Tocker box and plain rows share it so columns align
INNER = 1664 - 2 * PADX
GUTTER = 24                     # extra air between the four edge columns and the table-stakes column
W = {"name": 330, "usdc": 200, "x402": 200, "gates": 200, "social": 200, "auto": 210}
W["markets"] = INNER - sum(W.values()) - GUTTER

HEAD_H = 46                     # header row (30 line + 16 below)
ROW_H = 77                      # competitor row
L1, L2, GAP = 36, 24, 2         # primary line (names, marks) · secondary line (one-liners, notes)
T1 = 42                         # Tocker primary line (name, marks)
LOGO_H = 72                     # Tocker mark spans the name + one-liner block
TOCK_H = 114                    # Tocker row (primary + 2 secondary lines + padding)


def esc(t):
    return html.escape(t, quote=False)


def lines(t):
    parts = t.split("|")
    if len(parts) == 1:
        return esc(t)
    return "".join(f'<span style="display:block">{esc(x)}</span>' for x in parts)


def mark(kind, stake):
    c_live = DIM if stake else FG
    c_part = DIM if stake else MID
    if kind == "Y":
        return f'<p style="font-size:36px;line-height:{L1}px;font-weight:500;color:{c_live}">✓</p>'
    if kind == "P":
        return (f'<div style="position:relative;width:30px;height:30px;border-radius:50%;border:2.5px solid {c_part};overflow:hidden">'
                f'<div style="position:absolute;left:0px;top:0px;width:50%;height:100%;background:{c_part}"></div></div>')
    if kind == "N":
        return (f'<p style="{MONO};font-size:20px;letter-spacing:2px;line-height:20px;color:{MID};padding:7px 13px 6px 15px;'
                f'border:1.5px solid rgba(244,244,241,0.3);border-radius:999px;white-space:nowrap">NEXT</p>')
    return '<div style="width:30px;height:2px;background:rgba(244,244,241,0.3)"></div>'


def mark_cell(key, row, hero, h1):
    kind, note = row[key]
    stake = next(c for c in DATA["cols"] if c["key"] == key)["kind"] == "stake"
    ncol = MID if hero else DIM
    note_html = (f'<p style="font-size:20px;line-height:{L2}px;color:{ncol};white-space:nowrap;text-align:center">{lines(note)}</p>'
                 if note else "")
    return (f'<div style="width:{W[key]}px;flex:none;display:flex;flex-direction:column;align-items:center;gap:{GAP}px">'
            f'<div style="height:{h1}px;display:flex;align-items:center;justify-content:center">{mark(kind, stake)}</div>'
            f'{note_html}</div>')


def name_cell(row, hero, h1):
    if hero:
        lw = round(LOGO_H * LOGO_AR)
        block = T1 + GAP + 2 * L2
        return (f'<div style="width:{W["name"]}px;flex:none;display:flex;flex-direction:row;align-items:center;gap:16px;height:{block}px">'
                f'<img src="{LOGO}" alt="Tocker T mark" style="width:{lw}px;height:{LOGO_H}px;object-fit:contain;margin-left:-6px">'
                f'<div style="display:flex;flex-direction:column;gap:{GAP}px">'
                f'<p style="font-size:34px;font-weight:600;letter-spacing:-0.6px;line-height:{T1}px;color:{FG};white-space:nowrap">{esc(row["name"])}</p>'
                f'<p style="font-size:20px;line-height:{L2}px;color:{MID};white-space:nowrap">{lines(row["line"])}</p></div></div>')
    top = (f'<p style="height:{h1}px;font-size:30px;font-weight:600;letter-spacing:-0.5px;line-height:{h1}px;'
           f'color:{FG};white-space:nowrap">{esc(row["name"])}</p>')
    return (f'<div style="width:{W["name"]}px;flex:none;display:flex;flex-direction:column;gap:{GAP}px">{top}'
            f'<p style="font-size:20px;line-height:{L2}px;color:{DIM};white-space:nowrap">{lines(row["line"])}</p></div>')


def markets_cell(row, hero, h1):
    fc = MID if hero else DIM
    return (f'<div style="width:{W["markets"]}px;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:{GAP}px">'
            f'<p style="height:{h1}px;font-size:20px;line-height:{h1}px;color:{MID};white-space:nowrap;text-align:right">{esc(row["markets"])}</p>'
            f'<p style="font-size:20px;line-height:{L2}px;color:{fc};white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums">{esc(row["fact"])}</p></div>')


def gut(c):
    return f'<div style="width:{GUTTER}px;flex:none"></div>' if c["key"] == "auto" else ""


def row_html(row, i):
    hero = bool(row.get("logo"))
    h1 = T1 if hero else L1
    cells = name_cell(row, hero, h1) + "".join(gut(c) + mark_cell(c["key"], row, hero, h1) for c in DATA["cols"]) + markets_cell(row, hero, h1)
    if hero:
        content = T1 + GAP + 2 * L2
        pt = (TOCK_H - 2 - content) // 2
        box = (f"height:{TOCK_H}px;padding:{pt}px {PADX - 1}px 0;border:1px solid rgba(244,244,241,0.5);border-radius:18px;"
               f"background:rgba(244,244,241,0.05)")
    else:
        content = L1 + GAP + L2
        pt = (ROW_H - content) // 2
        last = i == len(DATA["rows"]) - 1
        box = (f"height:{ROW_H}px;padding:{pt}px {PADX}px 0;"
               f"{'border-top:1px solid ' + HAIR + ';' if i > 1 else ''}"
               f"{'border-bottom:1px solid ' + HAIR if last else ''}")
    return f'<div style="display:flex;flex-direction:row;align-items:flex-start;{box}">{cells}</div>'


def legend():
    item = lambda m, t: (f'<div style="display:flex;flex-direction:row;align-items:center;gap:8px">{m}'
                         f'<p style="font-size:20px;line-height:24px;color:{DIM};white-space:nowrap">{t}</p></div>')
    ck = f'<p style="font-size:22px;line-height:22px;color:{MID}">✓</p>'
    pt = (f'<div style="position:relative;width:16px;height:16px;border-radius:50%;border:2px solid {MID};overflow:hidden">'
          f'<div style="position:absolute;left:0px;top:0px;width:50%;height:100%;background:{MID}"></div></div>')
    nf = '<div style="width:16px;height:2px;background:rgba(244,244,241,0.28)"></div>'
    return (f'<div style="display:flex;flex-direction:row;align-items:center;gap:20px">'
            f'{item(ck, "live")}{item(pt, "partial")}{item(nf, "not found")}</div>')


def header():
    cells = f'<div style="width:{W["name"]}px;flex:none"></div>'
    for c in DATA["cols"]:
        col = FG if c["kind"] == "edge" else DIM
        cells += gut(c) + (f'<div style="width:{W[c["key"]]}px;flex:none;display:flex;justify-content:center">'
                  f'<p style="font-size:24px;font-weight:600;letter-spacing:-0.3px;line-height:30px;color:{col};white-space:nowrap">{esc(c["title"])}</p></div>')
    cells += (f'<div style="width:{W["markets"]}px;flex:none;display:flex;justify-content:flex-end"><p style="font-size:24px;font-weight:600;letter-spacing:-0.3px;'
              f'line-height:30px;color:{DIM};white-space:nowrap">{esc(DATA["markets_title"])}</p></div>')
    return f'<div style="height:{HEAD_H}px;display:flex;flex-direction:row;align-items:flex-start;padding:0 {PADX}px">{cells}</div>'


def build():
    a, b, c = DATA["takeaway"]
    tail = f" {esc(c)}" if c else ""
    take = (f'<div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;padding:0 {PADX}px">'
            f'<p style="font-size:28px;line-height:36px;letter-spacing:-0.3px;color:{MID};white-space:nowrap">'
            f'{esc(a)} <span style="color:{FG}">{esc(b)}</span>{tail}</p>{legend()}</div>')
    body = (f'<div style="display:flex;flex-direction:column;gap:20px;margin-top:6px"><div style="display:flex;flex-direction:column">{header()}'
            + "".join(row_html(r, i) for i, r in enumerate(DATA["rows"]))
            + f'</div>{take}</div>')
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
          "| markets col:", W["markets"])


build()
