"""Competition + moat slide (Slides subset: flow layout, text >= 24px, footer pinned).
Run: python3 -I moat.py <out.html>
Facts: research/26, 29 (crowd), 30 (what the code logs today: token_score_history; outcome labels are next)."""
import html, re, sys

OUT = sys.argv[1]
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:Geist, Arial, sans-serif"
FG, MID, DIM, HAIR = "#f4f4f1", "#a3a3a1", "#818180", "#f4f4f11f"
LOGO = "/_blob/41da4bfef67a2f6a83cfa7cf3015ecf2"
e = lambda t: html.escape(t, quote=False)

CROWD = ["ClawPump", "Minara", "Senpi", "Fere AI", "Ask Gina", "HeyElsa",
         "Bankr", "Nansen AI", "Wayfinder", "Almanak", "Cod3x", "Robinhood Agents"]
MOAT = [
    ("01 · Outcome data", "Every token we score or refuse, and how it ended.",
     "Logged today. Next, it tunes the gates. Rivals see trades, not decisions."),
    ("02 · Public record", "Every fill public, with its entry score, from day one.",
     "A track record can't be copied. It has to be earned, trade by trade."),
    ("03 · x402 position", "One integration to every paid data source.",
     "Next, our gate and score sell per call to any agent, rivals included."),
]
LOOP = ["More agents", "more outcomes", "safer gates", "a better public record", "more agents"]
NOTE = ("This space is crowded: twelve teams ship AI trading agents, Robinhood included. An LLM, a wallet and execution "
        "are table stakes, and features get copied. Our moat is what compounds. Outcome data: every token our agents "
        "score or refuse, and what happened next, which tunes our gates. A public record that can only be earned over "
        "time. And x402: one integration to every data source, and next, our safety check sold to other agents.")
FOOT = "Crowd: rivals' docs, GitHub, X, Fortune (Robinhood Agents, 29 Sep 2026), Oct 2026 · Outcome labels and the per-call gate are next"


def build():
    names = " · ".join(n.replace(" ", " ") for n in CROWD)
    crowd = (f'  <div style="display:flex; flex-direction:column; gap:14px; padding:28px 0 0; border-top:1px solid {HAIR}">\n'
             f'    <p style="{MONO}; font-size:24px; line-height:30px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">12 teams ship AI trading agents</p>\n'
             f'    <p style="width:1664px; {SANS}; font-size:28px; line-height:1.3; letter-spacing:-0.3px; white-space:nowrap; color:{MID}">{e(names)}</p>\n'
             f'    <p style="{SANS}; font-size:30px; line-height:1.3; color:{FG}">Table stakes: an LLM, a wallet, execution. <span style="color:{DIM}">Anyone can ship that.</span></p>\n'
             f'  </div>\n')
    cols = ""
    for i, (label, lead, sub) in enumerate(MOAT):
        sep = f"; border-left:1px solid #f4f4f129; padding-left:40px" if i else ""
        cols += (f'      <div style="display:flex; flex-direction:column; gap:14px; flex:1{sep}">\n'
                 f'        <p style="{MONO}; font-size:24px; line-height:30px; letter-spacing:4px; text-transform:uppercase; white-space:nowrap; color:{MID}">{e(label)}</p>\n'
                 f'        <p style="{SANS}; font-size:34px; font-weight:600; line-height:1.18; letter-spacing:-0.8px; color:{FG}">{e(lead)}</p>\n'
                 f'        <p style="{SANS}; font-size:26px; line-height:1.35; color:{MID}">{e(sub)}</p>\n'
                 f'      </div>\n')
    loop = f' <span style="color:{DIM}">→</span> '.join(e(x) for x in LOOP)
    box = (f'  <div style="display:flex; flex-direction:column; gap:22px; padding:26px 40px 28px; background:#f4f4f10d; border:1px solid #f4f4f180; border-radius:20px">\n'
           f'    <div style="display:flex; flex-direction:row; gap:12px; align-items:center">\n'
           f'      <img src="{LOGO}" alt="Tocker T mark" style="width:35px; height:29px; object-fit:contain">\n'
           f'      <p style="{SANS}; font-size:30px; font-weight:600; line-height:1; letter-spacing:-0.5px; color:{FG}">Tocker\'s moat: what compounds</p>\n'
           f'    </div>\n'
           f'    <div style="display:flex; flex-direction:row; gap:40px">\n{cols}    </div>\n'
                      f'  </div>\n')
    s = (f'<section id="competition" data-transition="fade" style="display:flex; flex-direction:column; gap:28px; padding:128px 128px 160px; background:#000000">\n'
         f'  <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">Competition · Moat</p>\n'
         f'  <h2 style="width:1664px; {SANS}; font-size:88px; font-weight:600; line-height:1.05; letter-spacing:-3px; color:{FG}">Crowded space. Our moat compounds.</h2>\n'
         f'  <div style="flex:1"></div>\n{crowd}{box}'
         f'  <p style="position:absolute; bottom:64px; left:128px; width:1664px; {SANS}; font-size:22px; line-height:1.35; white-space:nowrap; color:{DIM}">{e(FOOT)}</p>\n'
         f'  <aside>{e(NOTE)}</aside>\n</section>\n')
    open(OUT, "w").write(s)
    print("note words", len(NOTE.split()), "| <24:", [x for x in re.findall(r"font-size:(\d+)px", s) if int(x) < 22])


build()
