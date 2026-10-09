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


def bigs(items, size, weights=None):
    cols = ""
    gap = 96 if len(items) == 2 else 64
    for j, (num, tag) in enumerate(items):
        w = weights[j] if weights else 1
        cols += (f'    <div style="display:flex; flex-direction:column; gap:24px; flex:{w}; padding:36px 0 0; border-top:1px solid {HAIR}">\n'
                 f'      <p style="{SANS}; font-size:{size}px; font-weight:600; line-height:0.95; letter-spacing:-{size // 22}px; white-space:nowrap; font-variant-numeric:tabular-nums; color:{FG}">{e(num)}</p>\n'
                 f'      <p style="{SANS}; font-size:42px; line-height:1.25; letter-spacing:-0.6px; color:{MID}">{e(tag)}</p>\n'
                 f'    </div>\n')
    return f'  <div style="display:flex; flex-direction:row; gap:{gap}px">\n{cols}  </div>\n'


SLIDES = {
    "problem": ("The problem", "Traders lack edge. Agents lack rails.",
                bigs([("94%", "of memecoin wallets made no profit."),
                      ("$200", "a month and 20+ services to run your own agent.")], 180),
                "94%: 304,161 Solana memecoin wallets over 90 days to Aug 2026, fomo × Dune · $200: list prices, Oct 2026"),
    "solution": ("The solution", "Tocker is the edge and the rails.",
                 bigs([("1 line", "of English launches your agent."),
                       ("10", "hard gates refuse unsafe buys."),
                       ("24/7", "hosted. Nothing to wire.")], 180), ""),
    "edge": ("The edge", "Edge starts with not losing.",
             bigs([("76%", "of new tokens were rugs. Gates refuse them."),
                   ("2–7¢", "a token for premium data: smart money, holder growth, bullish signals."),
                   ("0/30", "AI agents liquidated, against 43% of humans.")], 180, [0.9, 1.3, 0.9]),
             "76%: SolRugDetector, H1 2025 · 0/30: Aster Human vs AI, Season 1, Jan 2026 · 2–7¢: Tocker data registry"),
    "business": ("Business model", "Traders pay 1%. We charge 0.5%.",
                 bigs([("$940M", "paid to Solana trading bots in 2025."),
                       ("0.5%", "our fee per trade. Live today.")], 180),
                 "Solana Foundation 2025 recap (Blockworks) · 1% bots: Photon, Trojan, BonkBot"),
    "traction": ("Traction", "11 users. 334 gets us to $20K MRR.",
                 bigs([("11", "users in open beta."),
                       ("~$2", "in fees per user, per day."),
                       ("334", "users × $60 a month = $20K.")], 180),
                 ""),
}


def gtm():
    def row(k, big, tag):
        return (f'      <div style="display:flex; flex-direction:column; gap:12px; padding:24px 0 20px; border-top:1px solid {HAIR}">\n'
                f'        <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{DIM}">{e(k)}</p>\n'
                f'        <p style="{SANS}; font-size:96px; font-weight:600; line-height:1; letter-spacing:-4px; white-space:nowrap; color:{FG}">{e(big)}</p>\n'
                f'        <p style="{SANS}; font-size:36px; line-height:1.25; letter-spacing:-0.5px; color:{MID}">{e(tag)}</p>\n'
                f'      </div>\n')

    def mkt(k, num, tag):
        return (f'      <div style="display:flex; flex-direction:row; gap:28px; align-items:baseline; padding:30px 0; border-top:1px solid {HAIR}">\n'
                f'        <p style="width:92px; {MONO}; font-size:24px; letter-spacing:3px; text-transform:uppercase; color:{DIM}">{e(k)}</p>\n'
                f'        <p style="width:310px; {SANS}; font-size:96px; font-weight:600; line-height:1; letter-spacing:-4px; font-variant-numeric:tabular-nums; color:{FG}">{e(num)}</p>\n'
                f'        <p style="flex:1; {SANS}; font-size:36px; line-height:1.25; color:{MID}">{e(tag)}</p>\n'
                f'      </div>\n')
    head = lambda t: f'      <p style="{MONO}; font-size:24px; letter-spacing:4px; text-transform:uppercase; color:{MID}; padding:0 0 18px">{e(t)}</p>\n'
    left = ('    <div style="display:flex; flex-direction:column; flex:1">\n' + head("How we get users")
            + row("01 · Superteam Earn bounty", "$5K", "The first autonomous trading competition. Best strategy wins.")
            + row("02 · X", "Ads + DMs", "Paid ads and cold DMs to traders.")
            + '    </div>\n')
    right = ('    <div style="display:flex; flex-direction:column; flex:1">\n' + head("Markets we expand to · yearly volume")
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


def team():
    rows = [
        ("/_blob/645c45990ef87d1be936649a1f600aca", "BlockRun logo", "Product & Growth Lead, BlockRun", "The leading x402 gateway"),
        ("/_blob/d965f9aa423f91f800a9ada66ef7722b", "Sorbet logo", "Founder & CEO, Sorbet", "Neobank. Raised $1M, scaled to $5M in monthly volume."),
        ("/_blob/37e07f7c17a3f955571e65fe76aee2f6", "Deloitte logo", "Omnia AI, Deloitte", "Deloitte's AI practice"),
    ]
    items = ""
    for i, (src, alt, title, sub) in enumerate(rows):
        last = f"; border-bottom:1px solid {HAIR}" if i == len(rows) - 1 else ""
        items += (f'      <div style="display:flex; flex-direction:row; gap:32px; align-items:center; padding:30px 0; border-top:1px solid {HAIR}{last}">\n'
                  f'        <img src="{src}" alt="{alt}" style="width:80px; height:80px; border:1px solid {HAIR}; border-radius:18px; object-fit:cover">\n'
                  f'        <div style="display:flex; flex-direction:column; gap:6px; flex:1">\n'
                  f'          <p style="{SANS}; font-size:38px; font-weight:500; line-height:1.15; letter-spacing:-0.5px; color:{FG}">{e(title)}</p>\n'
                  f'          <p style="{SANS}; font-size:28px; line-height:1.3; color:{MID}">{e(sub)}</p>\n'
                  f'        </div>\n      </div>\n')
    left = (f'    <div style="width:448px; display:flex; flex-direction:column; gap:20px; flex:0 0 auto">\n'
            f'      <img src="/_blob/6267b634bb7c763519614c99ac639862" alt="Portrait of Rami Djebari" style="width:380px; height:380px; border:1px solid {HAIR}; border-radius:28px; object-fit:cover">\n'
            f'      <div style="display:flex; flex-direction:column; gap:6px">\n'
            f'        <p style="{SANS}; font-size:52px; font-weight:600; line-height:1.05; letter-spacing:-1.5px; color:{FG}">Rami Djebari</p>\n'
            f'        <p style="{SANS}; font-size:30px; color:{MID}">Founder, Tocker</p>\n'
            f'      </div>\n'
            f'      <div style="align-self:start; display:flex; flex-direction:row; gap:12px; align-items:center; padding:8px 20px 8px 8px; border:1px solid #f4f4f133; border-radius:256px; background:#f4f4f10d">\n'
            f'        <img src="/_blob/6c238e3b11b30be29586010c2bb766ad" alt="Superteam Germany logo" style="width:40px; height:40px; border-radius:256px; object-fit:cover">\n'
            f'        <p style="{SANS}; font-size:26px; font-weight:500; white-space:nowrap; color:{FG}">Superteam Germany member</p>\n'
            f'      </div>\n    </div>\n')
    right = f'    <div style="display:flex; flex-direction:column; flex:1">\n{items}    </div>\n'
    body = f'  <div style="display:flex; flex-direction:row; gap:96px; align-items:start">\n{left}{right}  </div>\n'
    return section("team", "Team", "Ex-founder. Scaled to $5M a month.", body)


open(f"{OUT}/team.html", "w").write(team())
