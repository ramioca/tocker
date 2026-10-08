"""Angle 1 competition slide: "The model isn't the edge. The layer is."
Left: the evidence (two numbers, one per clause of the headline).
Right: where each rival bets the edge lives, grouped by bet, ending on Tocker.
Run: python3 -I gen.py  ->  refine/design/ang-1.html
"""
import html

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/ang-1.html"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
TAB = "font-variant-numeric:tabular-nums"

LEFT_W = 500
GAP = 80
LBL_W = 176   # bet label column
NAME_W = 384  # names column


def label(t, extra=""):
    return (f'<p style="{MONO};font-size:22px;letter-spacing:4px;text-transform:uppercase;'
            f'color:{DIM};white-space:nowrap{extra}">{t}</p>')


def evidence(hero, caption, first=False):
    space = "padding-top:20px" if first else "padding-top:20px;margin-top:27px"
    return (
        f'<div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid {HAIR};{space}">'
        f'<p style="{SANS};font-size:112px;font-weight:600;letter-spacing:-4.5px;line-height:0.95;'
        f'color:{FG};white-space:nowrap;margin-left:-0.04em;{TAB}">{hero}</p>'
        f'<p style="font-size:24px;line-height:1.35;color:{MID}">{caption}</p>'
        '</div>'
    )


def row(bet, names, limit, first=False):
    top = f"border-top:1px solid {HAIR};"
    return (
        f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:24px;padding:10px 0;{top}">'
        f'<p style="width:{LBL_W}px;flex:none;{MONO};font-size:20px;letter-spacing:3px;text-transform:uppercase;color:{DIM};white-space:nowrap">{bet}</p>'
        f'<p style="width:{NAME_W}px;flex:none;font-size:28px;letter-spacing:-0.3px;color:{FG};white-space:nowrap">{names}</p>'
        f'<p style="flex:1;min-width:0;font-size:24px;color:{MID};white-space:nowrap">{limit}</p>'
        '</div>'
    )


NEXT = (f'<span style="{MONO};font-size:20px;letter-spacing:2px;color:{FG};border:1px solid rgba(244,244,241,0.5);'
        f'border-radius:999px;padding:1px 10px 2px;margin:0 10px 0 6px;vertical-align:2px">NEXT</span>')


def duty(word, text):
    return (
        '<div style="display:flex;flex-direction:row;align-items:baseline;gap:16px">'
        f'<p style="width:84px;flex:none;{MONO};font-size:20px;letter-spacing:3px;text-transform:uppercase;color:{DIM};white-space:nowrap">{word}</p>'
        f'<p style="font-size:24px;line-height:1.4;color:{FG};white-space:nowrap">{text}</p>'
        '</div>'
    )


def tocker_row():
    return (
        f'<div style="display:flex;flex-direction:row;align-items:flex-start;gap:24px;padding:18px 24px 20px;margin-top:12px;'
        f'border:1px solid rgba(244,244,241,0.5);border-radius:16px;background:rgba(244,244,241,0.05)">'
        f'<p style="width:{LBL_W - 24}px;flex:none;{MONO};font-size:20px;letter-spacing:3px;text-transform:uppercase;color:{FG};white-space:nowrap;padding-top:9px">The layer</p>'
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">'
        '<div style="display:flex;flex-direction:row;align-items:baseline;justify-content:space-between;padding-bottom:4px">'
        f'<p style="font-size:30px;font-weight:600;letter-spacing:-0.4px;color:{FG};white-space:nowrap">Tocker</p>'
        f'<p style="font-size:20px;color:{DIM};white-space:nowrap">Also betting here: Parasol (grant-funded)</p></div>'
        + duty("Rents", f'Any model, USDC per call{NEXT}<span style="color:{DIM}">·</span>  Alpha from 14 x402 sellers')
        + duty("Owns", f'Filters, 10 gates, exits in code  <span style="color:{DIM}">·</span>  Public record, private strategy')
        + '</div></div>'
    )


left = (
    f'<div style="width:{LEFT_W}px;flex:none;display:flex;flex-direction:column">'
    + label("The evidence", ";padding-bottom:18px")
    + evidence("0.05", "Correlation between an LLM&#8217;s benchmark rank and its trading return, across 21 models.", first=True)
    + evidence("57%&#8202;&#8594;&#8202;3%", "Fabricated sell rules once DXRG fixed the harness, not the model. 3,505 Base agents.")
    + '</div>'
)

right = (
    '<div style="flex:1;min-width:0;display:flex;flex-direction:column">'
    + label("Where each bets the edge lives", ";padding-bottom:18px")
    + row("Status quo", "Axiom · Trojan · DIY on Claude", "Pay 1% a trade, or build the layer yourself")
    + row("The model", "Fere AI · Ask Gina", "Model rank barely predicts return")
    + row("Their data", "Nansen AI", "One vendor; you approve every trade")
    + row("One venue", "Robinhood Agents · Senpi", "Only what that venue lists")
    + row("The rails", "Bankr · Coinbase for Agents", "A wallet that pays, not a strategy")
    + tocker_row()
    + '</div>'
)

body = (
    '<div style="flex:1"></div>'
    f'<div style="display:flex;flex-direction:row;gap:{GAP}px;align-items:flex-start">{left}{right}</div>'
    f'<p style="margin-top:4px;font-size:30px;letter-spacing:-0.3px;color:{MID};white-space:nowrap">If OpenAI or Coinbase ships agents, they ship parts we rent. <span style="color:{FG}">A track record can&#8217;t be shipped. It compounds.</span></p>'
)

FOOT = ("0.05: LiveTradeBench, arXiv 2511.03628 (Spearman, LMArena score vs return) · 57%&#8594;3%: DXRG, arXiv 2604.26091 "
        "· Rivals: public docs, Oct 2026")

NOTE = ("Everyone's racing on the model. But across twenty-one LLMs, benchmark rank barely predicted returns. "
        "DXRG fixed the harness, not the model, on thirty-five hundred Base agents: fabricated sell rules fell "
        "from fifty-seven percent to three. Rivals bet on a model, data, a venue or rails. We rent those, and own "
        "the layer. Coinbase can ship agents, not a track record.")

slide = (
    f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
    f'{label("Competition · Oct 2026").replace("font-size:22px", "font-size:24px")}\n'
    f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px;white-space:nowrap">The model isn&#8217;t the edge. The layer is.</h2>\n'
    f'{body}\n'
    f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{FOOT}</p>\n'
    f'<aside>{html.escape(NOTE, quote=False)}</aside>\n</section>\n'
)

open(OUT, "w").write(slide)
print("wrote", OUT, "| note words:", len(NOTE.split()), "| headline chars:", len("The model isn't the edge. The layer is."))
