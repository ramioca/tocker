"""Competition market map. Run: python3 -I build.py"""
import html

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/comp-map.html"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
TN = "font-variant-numeric:tabular-nums"

# (label, count, descriptor, [(name, tag, tier)])  tier 1 = brightest
SEGS = [
    ("On-chain spot", 11, "Our lane. Tokens on Solana and Base.", [
        ("Nansen AI", "", 1), ("Fere AI", "$1.3M", 1), ("Velvet", "$3.7M", 1),
        ("Donut", "pre-launch", 2), ("Parasol", "closest", 3),
    ]),
    ("Chat-to-trade", 7, "You prompt, it executes.", [
        ("Bankr", "x402 + USDC LLM", 1), ("HeyElsa", "$3M", 1), ("Ask Gina", "", 1),
        ("INFINIT", "", 2), ("Wayfinder", "", 2), ("Amadeus", "", 2),
    ]),
    ("Perps", 12, "Autonomous, mostly Hyperliquid.", [
        ("Senpi", "$4.5M", 1), ("Minara", "$2.6B vol", 1), ("PERPTools", "", 1), ("Based", "pre-launch", 2),
        ("Wallet V", "", 2), ("Cod3x", "", 2), ("HyperAgent", "", 2),
    ]),
    ("Prediction", 7, "Polymarket, Kalshi, sports.", [
        ("Polystrat", "$13.8M", 1), ("Billy Bets", "$1M", 1), ("Elastics", "", 2), ("Sides.trade", "", 2),
        ("Polytrader", "", 2), ("AIXBET", "", 2),
    ]),
    ("Social &amp; arenas", 6, "Agents compete in public.", [
        ("Nof1", "benchmark", 2), ("Virtuals", "", 2), ("Trader.ai", "", 2), ("Quote.Trade", "", 2),
    ]),
]
INCUMBENTS = ["Robinhood", "eToro", "Public", "Binance", "Coinbase", "Bitget", "Bybit", "Gemini"]
EDGES = [("USDC inference", True, "Bankr"), ("x402 alpha", False, "Bankr"),
         ("Advanced filters &amp; gates", False, "Parasol"), ("Social trading", False, "Senpi")]

COLW = 210
CARDW = 516


def name_row(n, tag, tier):
    color = FG if tier == 1 else MID
    w = 500 if tier == 1 else 400
    if tag == "closest":
        t = (f'<p style="{MONO};font-size:14px;letter-spacing:1.5px;text-transform:uppercase;color:{FG};flex:none;'
             f'padding:4px 8px 3px;border:1px solid rgba(244,244,241,0.5);border-radius:999px">Closest</p>')
        color, w = FG, 500
    elif tag:
        t = f'<p style="{MONO};font-size:{15 if len(tag) > 10 else 17}px;letter-spacing:-0.2px;color:{DIM};{TN};flex:none;white-space:nowrap">{tag}</p>'
    else:
        t = ""
    return (f'<div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;height:36px">'
            f'<p style="font-size:23px;font-weight:{w};letter-spacing:-0.3px;color:{color};white-space:nowrap">{n}</p>{t}</div>')


def seg_col(i, label, count, desc, names):
    rows = "".join(name_row(*n) for n in names)
    return (
        f'<div style="width:{COLW}px;flex:none;display:flex;flex-direction:column;border-top:1px solid {HAIR};padding:28px 0 0 0">'
        f'<p style="{MONO};font-size:17px;letter-spacing:2px;text-transform:uppercase;color:{DIM};{TN}">{count} found</p>'
        f'<p style="font-size:28px;font-weight:600;letter-spacing:-0.8px;line-height:1.15;color:{FG};padding:10px 0 8px 0;white-space:nowrap">{label}</p>'
        f'<p style="font-size:20px;line-height:1.3;color:{DIM};height:52px">{desc}</p>'
        f'<div style="display:flex;flex-direction:column;padding:18px 0 0 0">{rows}</div>'
        "</div>"
    )


def incumbents():
    names = '<span style="color:rgba(244,244,241,0.25)"> · </span>'.join(INCUMBENTS)
    return (
        f'<div style="flex:none;margin-top:auto;display:flex;flex-direction:column;gap:10px;border-top:1px solid {HAIR};padding:20px 0 0 0">'
        f'<p style="{MONO};font-size:17px;letter-spacing:2px;text-transform:uppercase;color:{DIM};white-space:nowrap">Incumbents adding agent accounts · 15</p>'
        f'<p style="font-size:22px;color:{DIM};white-space:nowrap">{names}<span style="color:rgba(244,244,241,0.25)"> · </span>+7</p>'
        f'<p style="font-size:18px;color:{DIM};white-space:nowrap;padding:4px 0 0 0">Rails, not rivals: Coinbase Agentic Wallets · MetaMask · Phantom MCP · OpenClaw</p>'
        "</div>"
    )


def edge_row(i, t, nxt, who):
    tag = (f'<p style="{MONO};font-size:15px;letter-spacing:1.5px;text-transform:uppercase;color:{FG};flex:none;'
           f'padding:5px 10px 4px;border:1px solid rgba(244,244,241,0.5);border-radius:999px">Next</p>') if nxt else ""
    return (f'<div style="display:flex;flex-direction:row;align-items:center;gap:14px;height:62px;border-top:1px solid {HAIR}">'
            f'<p style="width:30px;flex:none;{MONO};font-size:18px;color:{DIM};{TN}">{i:02d}</p>'
            f'<p style="font-size:27px;font-weight:500;letter-spacing:-0.6px;color:{FG};white-space:nowrap">{t}</p>{tag}'
            f'<p style="margin-left:auto;flex:none;{MONO};font-size:16px;color:{DIM};white-space:nowrap">{who}</p></div>')


def card():
    rows = "".join(edge_row(i + 1, t, n, w) for i, (t, n, w) in enumerate(EDGES))
    return (
        f'<div style="width:{CARDW}px;flex:none;display:flex;flex-direction:column;border:1px solid rgba(244,244,241,0.5);'
        f'border-radius:24px;background:rgba(244,244,241,0.05);padding:28px 32px 30px">'
        f'<p style="{MONO};font-size:17px;letter-spacing:2px;text-transform:uppercase;color:{FG}">Tocker</p>'
        f'<p style="font-size:40px;font-weight:600;letter-spacing:-1.2px;line-height:1.1;color:{FG};padding:12px 0 10px 0">Only Tocker<br>has all four.</p>'
        f'<p style="{MONO};font-size:16px;color:{DIM};text-align:right;padding:0 0 8px 0">Who has a piece</p>'
        f'<div style="display:flex;flex-direction:column;border-bottom:1px solid {HAIR}">{rows}</div>'
        '<div style="flex:1"></div>'
        f'<p style="font-size:20px;line-height:1.35;color:{MID};padding:16px 0 0 0">Hosted 24/7. Any Solana or Base token, your strategy in plain English.</p>'
        f'<p style="{MONO};font-size:18px;letter-spacing:0.5px;color:{DIM};padding:14px 0 0 0;white-space:nowrap">Built on Privy · Jupiter · x402</p>'
        "</div>"
    )


cols = "".join(seg_col(i + 1, *s) for i, s in enumerate(SEGS))
body = (
    '<div style="height:20px;flex:none"></div>'
    '<div style="flex:1;min-height:0;display:flex;flex-direction:row;justify-content:space-between">'
    '<div style="flex:1;min-height:0;display:flex;flex-direction:column;padding:0 32px 0 0">'
    f'<div style="flex:1;display:flex;flex-direction:row;justify-content:space-between">{cols}</div>'
    f"{incumbents()}"
    "</div>"
    f"{card()}"
    "</div>"
)

FOOT = ("White = live &amp; funded · Columns are a sample · 7 TradFi apps not shown · Funding: The Block, Chainwire, GlobeNewswire, Decrypt, EU-Startups, DefiLlama")
NOTE = ("We mapped sixty-five products where an AI agent trades for you. Each startup owns a piece: Bankr has x402 "
        "and a USDC LLM gateway, Parasol has filters, Senpi has an arena. Nobody combines all four. Tocker does: USDC "
        "inference next, x402 alpha, advanced filters and gates, and social trading, hosted 24/7.")

sec = (
    f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
    f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">Competition · 65 products mapped</p>\n'
    f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px;margin-left:-6px">50 startups. None combines all four.</h2>\n'
    f"{body}\n"
    f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{FOOT}</p>\n'
    f"<aside>{html.escape(NOTE, quote=False)}</aside>\n</section>\n"
)
open(OUT, "w").write(sec)
print(len(NOTE.split()), "words in note;", sum(len(s[3]) for s in SEGS) + len(INCUMBENTS), "names")
