"""Angle 2 competition slide: "Their products are our inputs."
Run: python3 -I gen.py  ->  refine/design/ang-2.html
"""
import html

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/ang-2.html"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
NUM = "font-variant-numeric:tabular-nums"

# Grid: a 300px tier-label column, then three 396px columns, 48px gutters.
# Columns start at x = 476, 920, 1364 on every tier (the Tocker band insets only its label).
LBL_W, COL_W, GAP = 300, 396, 48


def mono(t, size=24, color=DIM, extra=""):
    return f'<p style="{MONO};font-size:{size}px;letter-spacing:3px;text-transform:uppercase;color:{color};white-space:nowrap{extra}">{t}</p>'


def tier_label(lbl, sub, w=LBL_W):
    return (f'<div style="width:{w}px;flex:none;display:flex;flex-direction:column;gap:12px">'
            f'{mono(lbl, 24, DIM, ";letter-spacing:4px")}'
            f'<p style="font-size:24px;line-height:1.3;color:{MID}">{sub}</p></div>')


def supplier_col(lbl, rows):
    out = "".join(
        f'<div style="display:flex;flex-direction:row;align-items:baseline;justify-content:space-between;padding:6px 0;border-top:1px solid {HAIR}">'
        f'<p style="font-size:28px;letter-spacing:-0.3px;color:{FG}">{n}</p>'
        f'<p style="{MONO};font-size:22px;color:{MID};{NUM};white-space:nowrap">{t}</p></div>'
        for n, t in rows)
    return (f'<div style="width:{COL_W}px;flex:none;display:flex;flex-direction:column;gap:10px">'
            f'{mono(lbl)}<div style="display:flex;flex-direction:column">{out}</div></div>')


def row(children, gap=GAP, extra=""):
    return f'<div style="display:flex;flex-direction:row;gap:{gap}px{extra}">{"".join(children)}</div>'


def fact(big, small):
    return (f'<div style="width:{COL_W}px;flex:none;display:flex;flex-direction:column;gap:8px">'
            f'<p style="font-size:30px;font-weight:500;letter-spacing:-0.5px;line-height:1.15;color:{FG}">{big}</p>'
            f'<p style="font-size:22px;line-height:1.3;color:{MID}">{small}</p></div>')


def rival(lbl, names, line):
    return (f'<div style="width:{COL_W}px;flex:none;display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:1px solid {HAIR}">'
            f'{mono(lbl)}'
            f'<p style="font-size:30px;font-weight:500;letter-spacing:-0.5px;color:{FG};white-space:nowrap">{names}</p>'
            f'<p style="font-size:24px;line-height:1.3;color:{MID};white-space:nowrap">{line}</p></div>')


def stem():
    # Hairline plus a CSS-triangle arrowhead: the input flows down into the agent.
    return (f'<div style="width:{COL_W}px;flex:none;display:flex;flex-direction:column;align-items:center">'
            f'<div style="width:1px;height:18px;background:rgba(244,244,241,0.4)"></div>'
            f'<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;'
            f'border-top:8px solid rgba(244,244,241,0.5)"></div></div>')


nxt = (f'<span style="{MONO};font-size:20px;letter-spacing:2px;color:{FG};border:1px solid rgba(244,244,241,0.5);'
       f'border-radius:999px;padding:2px 10px;margin-left:10px">NEXT</span>')

top = row([
    tier_label("Inputs", "Paid per call. Two or more substitutes each."),
    supplier_col("Models", [("Anthropic · OpenAI", "your key"), ("BlockRun · Bankr", "USDC" + nxt)]),
    supplier_col('Data · <span style="text-transform:none">x402</span>', [("Nansen", "$0.050"), ("SolEnrich · Deepnets", "~$0.010")]),
    supplier_col("Rails", [("Privy", "wallets"), ("Jupiter", "swaps")]),
])

# One gathering bracket: each input column drops a stem onto a bus that delivers a single
# arrow into "Tocker" (x positions are relative to the 128px content edge).
COLS_X = [LBL_W + GAP + i * (COL_W + GAP) + COL_W // 2 for i in range(3)]   # 546, 990, 1434
ARROW_X = 113                                                              # over the "Tocker" wordmark
LINE = "rgba(244,244,241,0.4)"
bracket = "".join(
    f'<div style="position:absolute;left:{x}px;top:0;width:1px;height:12px;background:{LINE}"></div>' for x in COLS_X)
bracket += (f'<div style="position:absolute;left:{ARROW_X}px;top:12px;width:{COLS_X[-1] - ARROW_X + 1}px;height:1px;background:{LINE}"></div>'
            f'<div style="position:absolute;left:{ARROW_X}px;top:12px;bottom:8px;width:1px;background:{LINE}"></div>'
            f'<div style="position:absolute;left:{ARROW_X - 6}px;bottom:0;width:0;height:0;border-left:6.5px solid transparent;'
            f'border-right:6.5px solid transparent;border-top:9px solid rgba(244,244,241,0.6)"></div>')
stems = f'<div style="position:relative;height:38px;margin-top:4px">{bracket}</div>'

band = (
    f'<div style="display:flex;flex-direction:row;gap:{GAP}px;align-items:flex-start;padding:24px 32px;'
    f'border:1px solid rgba(244,244,241,0.5);background:rgba(244,244,241,0.05);border-radius:20px">'
    f'<div style="width:{LBL_W - 32}px;flex:none;display:flex;flex-direction:column;gap:6px">'
    f'<p style="font-size:52px;font-weight:600;letter-spacing:-1.5px;line-height:1;color:{FG}">Tocker</p>'
    f'<p style="font-size:22px;line-height:1.3;color:{MID};white-space:nowrap">the agent and its record</p></div>'
    + fact("Any Solana or Base token", "No allowlist. Code vetoes rugs.")
    + fact("Every fill public", "Score frozen. Strategy private.")
    + fact("Your rules, 24/7", "Sweeps new launches. Exits in code.")
    + "</div>"
)

bottom = row([
    tier_label("Other agents", "Who else owns the agent, and where each stops."),
    rival("One venue", "Robinhood · Binance · Senpi", "Safe, but only what the venue lists."),
    rival("No public record", "Nansen AI · Fere AI · Parasol", "Live on our chains today."),
    rival("Status quo", "Telegram bots", "You click, and pay ~1% a trade."),
])

close = (f'<p style="font-size:34px;letter-spacing:-0.5px;line-height:1.3;color:{MID};width:1664px">'
         f'Coinbase could rent every input here. <span style="color:{FG}">It can’t rent a track record.</span></p>')

SPACER = '<div style="flex:1"></div>'
body = (SPACER + f'<div style="display:flex;flex-direction:column">{top}{stems}{band}'
        f'<div style="height:30px"></div>{bottom}</div>' + SPACER + close)

foot = ("Prices: Tocker x402 registry · Rivals: Fortune, Reuters, Chainwire, The Block, GlobeNewswire, parasol.so · "
        "Bots: ~1% fee schedules · Rami leads product at BlockRun")

note = ("Models, data, wallets and swaps now sell by the call, with substitutes for each. "
        "Nansen sells us data at five cents a call; its own agent keeps no public record. "
        "Robinhood and Senpi stop at one venue. Value goes to whoever owns the agent and its record. "
        "If Coinbase ships an agent, it buys these inputs and starts at zero.")

section = (
    f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
    f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">Competition · Oct 2026</p>\n'
    f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px">Their products are our inputs.</h2>\n'
    f"{body}\n"
    f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{foot}</p>\n'
    f"<aside>{html.escape(note, quote=False)}</aside>\n</section>\n"
)

open(OUT, "w").write(section)
print("words in note:", len(note.split()))
