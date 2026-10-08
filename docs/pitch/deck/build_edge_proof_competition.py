"""Pitch-roast rework: edge, proof and competition slides, in the Slides subset (flow layout, text >= 24px,
footer pinned at bottom:64px). Facts: docs/pitch/research/29-edge-competition-performance.md and
30-edge-code-audit.md. Run: python3 -I gen.py <outdir>  ->  <outdir>/{edge,proof,competition}.html
"""
import html
import sys

OUT = sys.argv[1]
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:Geist, Arial, sans-serif"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
HAIR = "#f4f4f11f"
LOGO = "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2"


def e(t):
    return html.escape(t, quote=False)


def section(sid, eyebrow, headline, body, foot, note):
    return (
        f'<section id="{sid}" data-transition="fade" style="display:flex; flex-direction:column; gap:28px; padding:128px 128px 160px; background:#000000">\n'
        f'  <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">{e(eyebrow)}</p>\n'
        f'  <h2 style="width:1664px; {SANS}; font-size:88px; font-weight:600; line-height:1.05; letter-spacing:-3px; color:{FG}">{e(headline)}</h2>\n'
        f'  <div style="flex:1"></div>\n{body}\n'
        f'  <p style="position:absolute; bottom:64px; left:128px; width:1664px; {SANS}; font-size:22px; line-height:1.35; white-space:nowrap; color:{DIM}">{e(foot)}</p>\n'
        f'  <aside>{e(note)}</aside>\n</section>\n')


def mono(t, color=DIM, ls=4):
    return f'<p style="{MONO}; font-size:24px; line-height:30px; letter-spacing:{ls}px; text-transform:uppercase; white-space:nowrap; color:{color}">{e(t)}</p>'


# ---------------------------------------------------------------- edge
EDGE = {
    "eyebrow": "The edge",
    "headline": "Edge starts with not losing.",
    "cols": [
        ("01 · Refuse the rugs", "76%",
         "of new Solana tokens in H1 2025 were rugs. Ten gates in code check every buy. The AI can't override them."),
        ("02 · Pick by your thesis", "2–7¢",
         "a token on Solana for smart-money, rug-risk and X data, bought per call. Your thesis decides what to buy."),
        ("03 · Exit by rule", "0 of 30",
         "AI agents were liquidated in Aster's live contest, against 43% of humans. Stops and targets run in code."),
    ],
    "line": "Nobody has shown an AI that picks memecoin winners. We start where the evidence is.",
    "foot": "76%: SolRugDetector, arXiv 2603.24625, 100,063 tokens · 0 of 30: Aster Human vs AI, Season 1, Jan 2026 · 2–7¢: Tocker data registry, Oct 2026",
    "note": ("So what's the edge? Not prediction. Nobody has shown an AI that picks memecoin winners. "
             "The edge starts with not losing. Seventy-six percent of new Solana tokens were rugs; ten gates in code "
             "refuse unsafe buys, and the AI can't override them. Your thesis picks from what's left, with data at a "
             "few cents a token. And exits run by rule. In a live contest, none of thirty AI agents got liquidated. "
             "Forty-three percent of humans did."),
}


def edge():
    cols = ""
    for label, big, body in EDGE["cols"]:
        cols += (f'    <div style="display:flex; flex-direction:column; gap:20px; flex:1; padding:32px 0 0; border-top:1px solid {HAIR}">\n'
                 f'      {mono(label)}\n'
                 f'      <p style="{SANS}; font-size:150px; font-weight:600; line-height:0.95; letter-spacing:-7px; white-space:nowrap; font-variant-numeric:tabular-nums; color:{FG}">{e(big)}</p>\n'
                 f'      <p style="{SANS}; font-size:30px; line-height:1.35; letter-spacing:-0.2px; color:{MID}">{e(body)}</p>\n'
                 f'    </div>\n')
    body = (f'  <div style="display:flex; flex-direction:row; gap:64px">\n{cols}  </div>\n'
            f'  <div style="height:16px"></div>\n'
            f'  <p style="width:1664px; {SANS}; font-size:34px; line-height:1.35; letter-spacing:-0.5px; color:{FG}">{e(EDGE["line"])}</p>')
    return section("edge", EDGE["eyebrow"], EDGE["headline"], body, EDGE["foot"], EDGE["note"])


# ---------------------------------------------------------------- proof
PROOF = {
    "eyebrow": "Proof · the next six weeks",
    "headline": "We'll prove it in public.",
    "audit": ("01 · Gate audit · weeks 1–4",
              "Of the launches we refuse, how many die within a day?",
              [("A", "Tocker's ten gates"), ("B", "RugCheck alone"), ("C", "No filter")]),
    "cohort": ("02 · House agents · weeks 1–8",
               "Real money. Every agent shown.",
               [("A", "Tocker agents, gates on"), ("B", "Same strategies, gates off"),
                ("C", "Random entries, same exits"), ("D", "Just hold SOL")]),
    "line": "Every launch our agents see is logged with its gate verdict. Definitions are published before the data.",
    "foot": "Why not a backtest: across 888 trading strategies, backtest Sharpe explained under 2.5% of live performance (Wiecki et al., 2016).",
    "note": ("Claims aren't proof, so we'll prove it in public. Every launch our agents see gets logged with its gate "
             "verdict, and we check which ones died within a day, against RugCheck and against no filter. House agents "
             "trade real money, gates on and gates off, against random entries and just holding SOL. Every agent shown, "
             "net of fees."),
}


def proof():
    a_label, a_big, a_arms = PROOF["audit"]
    c_label, c_big, c_arms = PROOF["cohort"]

    def arms(items):
        rows = ""
        for i, (k, t) in enumerate(items):
            last = f"; border-bottom:1px solid {HAIR}" if i == len(items) - 1 else ""
            color = FG if i == 0 else MID
            rows += (f'        <div style="display:flex; flex-direction:row; gap:24px; align-items:baseline; padding:12px 0; border-top:1px solid {HAIR}{last}">\n'
                     f'          <p style="width:32px; {MONO}; font-size:24px; color:{DIM}">{k}</p>\n'
                     f'          <p style="flex:1; {SANS}; font-size:30px; letter-spacing:-0.3px; color:{color}">{e(t)}</p>\n'
                     f'        </div>\n')
        return f'      <div style="display:flex; flex-direction:column">\n{rows}      </div>\n'

    col = (f'display:flex; flex-direction:column; gap:22px; flex:1; padding:32px 0 0; border-top:1px solid {HAIR}')
    big = f'height:112px; {SANS}; font-size:48px; font-weight:600; line-height:1.12; letter-spacing:-1.5px; color:{FG}'
    body = (f'  <div style="display:flex; flex-direction:row; gap:96px; align-items:start">\n'
            f'    <div style="{col}">\n      {mono(a_label)}\n'
            f'      <p style="{big}">{e(a_big)}</p>\n{arms(a_arms)}    </div>\n'
            f'    <div style="{col}">\n      {mono(c_label)}\n'
            f'      <p style="{big}">{e(c_big)}</p>\n{arms(c_arms)}    </div>\n  </div>\n'
            f'  <div style="height:8px"></div>\n'
            f'  <p style="width:1664px; {SANS}; font-size:30px; line-height:1.35; color:{MID}">{e(PROOF["line"])}</p>')
    return section("proof", PROOF["eyebrow"], PROOF["headline"], body, PROOF["foot"], PROOF["note"])


# ---------------------------------------------------------------- competition
COMP = {
    "eyebrow": "Competition",
    "headline": "They sell speed. We sell discipline.",
    "groups": [
        ("Trading terminals", "Axiom · GMGN · fomo · Photon · Trojan", "$940M", "fees from Solana traders, 2025",
         "Speed, sniping, filters.", "Built for humans clicking fast. Safety checks you can switch off."),
        ("AI trading startups", "Minara · Senpi · HeyElsa · Fere\u00a0AI · Ask\u00a0Gina · ClawPump", "$4M", "largest disclosed round",
         "Chat copilots, perps autopilots, agent kits.", "Bundled data. Rug checks opt-in at\u00a0best."),
    ],
    "tocker": ("Your thesis, run 24/7 by an agent.", "0.5%", "a trade, half the 1% bots charge",
               ["Gates on every buy. The AI can't override them.", "Data bought per call, by the agent.",
                "Every fill public, never the strategy."]),
    "foot": "$940M: The Block, Jan 2026 (Solana bots and terminals) · $4M: Senpi seed, Sep 2025 · Products: rivals' docs, Oct 2026",
    "note": ("The terminals are big and good: Axiom, GMGN, fomo. They sell speed. The ninety-four percent on our problem "
             "slide comes from fomo's own wallet data. Speed doesn't fix losing. The AI startups are small and chat-first. "
             "We sell discipline: your thesis, run 24/7, with gates the AI can't override, and every fill in public, at half the fee."),
}

NAME_H, STAT_H = 76, 128


def comp():
    cols = ""
    for label, names, stat, stat_l, good, gap in COMP["groups"]:
        cols += (f'    <div style="width:500px; display:flex; flex-direction:column; gap:20px; flex:0 0 auto; padding:32px 0 0; border-top:1px solid {HAIR}">\n'
                 f'      {mono(label)}\n'
                 f'      <p style="height:{NAME_H}px; {SANS}; font-size:28px; font-weight:500; line-height:1.3; letter-spacing:-0.3px; color:{FG}">{e(names)}</p>\n'
                 f'      <div style="height:{STAT_H}px; display:flex; flex-direction:column; gap:8px">\n'
                 f'        <p style="{SANS}; font-size:80px; font-weight:600; line-height:1; letter-spacing:-3px; font-variant-numeric:tabular-nums; color:{MID}">{e(stat)}</p>\n'
                 f'        <p style="{SANS}; font-size:24px; line-height:1.25; color:{DIM}">{e(stat_l)}</p>\n'
                 f'      </div>\n'
                 f'      <div style="display:flex; flex-direction:column; gap:14px; padding:20px 0 0; border-top:1px solid {HAIR}">\n'
                 f'        <p style="{SANS}; font-size:28px; line-height:1.3; color:{MID}"><span style="color:{DIM}">Good at </span>{e(good)}</p>\n'
                 f'        <p style="{SANS}; font-size:28px; line-height:1.3; color:{FG}"><span style="color:{DIM}">But </span>{e(gap)}</p>\n'
                 f'      </div>\n    </div>\n')
    tag, stat, stat_l, bullets = COMP["tocker"]
    lis = "".join(
        f'        <p style="{SANS}; font-size:30px; line-height:1.3; letter-spacing:-0.3px; color:{FG}">{e(b)}</p>\n' for b in bullets)
    tock = (f'    <div style="width:600px; display:flex; flex-direction:column; gap:20px; flex:0 0 auto; padding:31px 40px 36px; background:#f4f4f10d; border:1px solid #f4f4f180; border-radius:20px">\n'
            f'      <div style="height:30px; display:flex; flex-direction:row; gap:12px; align-items:center">\n'
            f'        <img src="{LOGO}" alt="Tocker T mark" style="width:35px; height:29px; object-fit:contain">\n'
            f'        <p style="{SANS}; font-size:30px; font-weight:600; line-height:1; letter-spacing:-0.5px; color:{FG}">Tocker</p>\n'
            f'      </div>\n'
            f'      <p style="height:{NAME_H}px; {SANS}; font-size:28px; font-weight:500; line-height:1.3; letter-spacing:-0.3px; color:{FG}">{e(tag)}</p>\n'
            f'      <div style="height:{STAT_H}px; display:flex; flex-direction:column; gap:8px">\n'
            f'        <p style="{SANS}; font-size:80px; font-weight:600; line-height:1; letter-spacing:-3px; font-variant-numeric:tabular-nums; color:{FG}">{e(stat)}</p>\n'
            f'        <p style="{SANS}; font-size:24px; line-height:1.25; color:{MID}">{e(stat_l)}</p>\n'
            f'      </div>\n'
            f'      <div style="display:flex; flex-direction:column; gap:14px; padding:20px 0 0; border-top:1px solid #f4f4f129">\n{lis}      </div>\n    </div>\n')
    body = f'  <div style="display:flex; flex-direction:row; gap:32px; align-items:start">\n{cols}{tock}  </div>'
    return section("competition", COMP["eyebrow"], COMP["headline"], body, COMP["foot"], COMP["note"])


for name, fn in (("edge", edge), ("proof", proof), ("competition", comp)):
    s = fn()
    open(f"{OUT}/{name}.html", "w").write(s)
    import re
    small = [x for x in re.findall(r"font-size:(\d+)px", s) if int(x) < 24 and int(x) != 22]
    print(name, "| <24px:", len(small), "| margin:", s.count("margin"), "| pinned:", s.count("position:absolute"))
