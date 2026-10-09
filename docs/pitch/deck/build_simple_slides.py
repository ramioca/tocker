"""Simplified slides after pitch #2 ("too much text"): big numbers + one tagline each, a GTM slide without the
image, and a traction slide. Slides subset. Run: python3 -I simple.py <outdir> <notes.json>"""
import html, json, sys

OUT, NOTES = sys.argv[1], json.load(open(sys.argv[2]))
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:Geist, Arial, sans-serif"
FG, MID, DIM, HAIR = "#f4f4f1", "#a3a3a1", "#818180", "#f4f4f11f"
e = lambda t: html.escape(t, quote=False)


def section(sid, eyebrow, headline, body, foot=""):
    f = (f'  <p style="position:absolute; bottom:64px; left:128px; width:1664px; {SANS}; font-size:22px; line-height:1.35; '
         f'white-space:nowrap; color:{DIM}">{e(foot)}</p>\n') if foot else ""
    return (f'<section id="{sid}" data-transition="fade" style="display:flex; flex-direction:column; gap:28px; padding:128px 128px 160px; background:#000000">\n'
            f'  <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">{e(eyebrow)}</p>\n'
            f'  <h2 style="width:1664px; {SANS}; font-size:88px; font-weight:600; line-height:1.05; letter-spacing:-3px; color:{FG}">{e(headline)}</h2>\n'
            f'  <div style="flex:1"></div>\n{body}{f}'
            f'  <aside>{e(NOTES[sid])}</aside>\n</section>\n')


def bigs(items, size):
    cols = ""
    gap = 96 if len(items) == 2 else 64
    for num, tag in items:
        cols += (f'    <div style="display:flex; flex-direction:column; gap:24px; flex:1; padding:36px 0 0; border-top:1px solid {HAIR}">\n'
                 f'      <p style="{SANS}; font-size:{size}px; font-weight:600; line-height:0.95; letter-spacing:-{size // 22}px; white-space:nowrap; font-variant-numeric:tabular-nums; color:{FG}">{e(num)}</p>\n'
                 f'      <p style="{SANS}; font-size:36px; line-height:1.3; letter-spacing:-0.5px; color:{MID}">{e(tag)}</p>\n'
                 f'    </div>\n')
    return f'  <div style="display:flex; flex-direction:row; gap:{gap}px">\n{cols}  </div>\n'


SLIDES = {
    "problem": ("The problem", "Traders lack edge. Agents lack rails.",
                bigs([("94%", "of memecoin wallets made no profit in 90 days."),
                      ("$200", "a month and 20+ services to run your own agent.")], 240),
                "94%: 304,161 Solana memecoin wallets, fomo × Dune, 90 days to Aug 2026 · $200: list prices, Oct 2026"),
    "solution": ("The solution", "Tocker is the edge and the rails.",
                 bigs([("1 line", "of English launches your agent."),
                       ("10", "hard gates refuse unsafe buys."),
                       ("24/7", "hosted. Nothing to wire.")], 170), ""),
    "edge": ("The edge", "Edge starts with not losing.",
             bigs([("76%", "of new Solana tokens were rugs. Our gates refuse them."),
                   ("2–7¢", "per token for the data your thesis needs."),
                   ("0 of 30", "AI agents liquidated, against 43% of humans.")], 150),
             "76%: SolRugDetector, H1 2025 · 0 of 30: Aster Human vs AI, Season 1, Jan 2026 · 2–7¢: Tocker data registry"),
    "business": ("Business model", "Traders pay 1%. We charge 0.5%.",
                 bigs([("$940M", "paid to Solana trading bots in 2025."),
                       ("0.5%", "our fee per trade. Live today.")], 240),
                 "Solana Foundation 2025 recap (Blockworks) · 1% bots: Photon, Trojan, BonkBot"),
    "traction": ("Traction", "11 users. The path to $20K MRR.",
                 bigs([("11", "users in open beta."),
                       ("~$2", "in fees per user, a month."),
                       ("10K", "users × $2 a month = $20K MRR.")], 200),
                 ""),
}


def gtm():
    def row(k, big, tag):
        return (f'      <div style="display:flex; flex-direction:column; gap:12px; padding:24px 0 20px; border-top:1px solid {HAIR}">\n'
                f'        <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">{e(k)}</p>\n'
                f'        <p style="{SANS}; font-size:88px; font-weight:600; line-height:1; letter-spacing:-3px; white-space:nowrap; color:{FG}">{e(big)}</p>\n'
                f'        <p style="{SANS}; font-size:34px; line-height:1.3; letter-spacing:-0.5px; color:{MID}">{e(tag)}</p>\n'
                f'      </div>\n')

    def mkt(k, num, tag):
        return (f'      <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:26px 0; border-top:1px solid {HAIR}">\n'
                f'        <p style="width:92px; {MONO}; font-size:24px; letter-spacing:3px; text-transform:uppercase; color:{DIM}">{e(k)}</p>\n'
                f'        <p style="width:290px; {SANS}; font-size:88px; font-weight:600; line-height:1; letter-spacing:-3px; font-variant-numeric:tabular-nums; color:{FG}">{e(num)}</p>\n'
                f'        <p style="flex:1; {SANS}; font-size:32px; line-height:1.25; color:{MID}">{e(tag)}</p>\n'
                f'      </div>\n')
    left = (f'    <div style="display:flex; flex-direction:column; flex:1">\n'
            f'      <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{MID}; padding:0 0 18px">How we get users</p>\n'
            + row("01 · Bounty on Earn", "$5K", "The first autonomous trading competition. Best strategy wins.")
            + row("02 · X", "Ads + DMs", "Paid ads and cold DMs to traders on X.")
            + '    </div>\n')
    right = (f'    <div style="display:flex; flex-direction:column; flex:1">\n'
             f'      <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{MID}; padding:0 0 18px">Where we expand · yearly volume</p>\n'
             + mkt("Now", "$482B", "Solana memecoins")
             + mkt("Next", "$21.5B", "Polymarket")
             + mkt("Then", "$12.4B", "Tokenized stocks")
             + '    </div>\n')
    body = f'  <div style="display:flex; flex-direction:row; gap:96px; align-items:start">\n{left}{right}  </div>\n'
    return section("gtm", "Go-to-market", "Win traders. Then new markets.", body,
                   "$482B: Solana 2025 recap · $21.5B: Polymarket 2025, Keyrock × Dune · $12.4B: Solana tokenized stocks, 2026 to date")


for sid, (eb, h, body, foot) in SLIDES.items():
    open(f"{OUT}/{sid}.html", "w").write(section(sid, eb, h, body, foot))
open(f"{OUT}/gtm.html", "w").write(gtm())
print("ok")
