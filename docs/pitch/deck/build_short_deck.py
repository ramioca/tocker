"""v4 slides: path-to-10 pass (VC + design critics). Generates every slide except the locked cover.
Run: python3 -I build_v4.py"""
import html
import re

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
GLOW = "radial-gradient(ellipse at 50% 50%, rgba(61,107,255,0.22) 0%, rgba(139,108,255,0.07) 32%, rgba(0,0,0,0) 66%)"
SPACER = '<div style="flex:1"></div>'


def section(sid, eyebrow, headline, body, foot, note, ml=0):
    shift = f";margin-left:{ml}px" if ml else ""
    return (
        f'<section id="{sid}" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
        f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{eyebrow}</p>\n'
        f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px{shift}">{headline}</h2>\n'
        f"{body}\n"
        f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{foot}</p>\n'
        f"<aside>{html.escape(note, quote=False)}</aside>\n</section>\n"
    )


def label(t, extra=""):
    return f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}{extra}">{t}</p>'


def write(sid, s):
    open(OUT + sid + ".html", "w").write(s)


# Shared two-column hero layout (problem and business use one spec so the fade between them doesn't jump).
def hero_col(lbl, hero, line):
    return (
        f'<div style="flex:1;display:flex;flex-direction:column;gap:22px;border-top:1px solid {HAIR};padding:36px 0 0 0">'
        f"{label(lbl)}"
        f'<p style="{SANS};font-size:240px;font-weight:600;letter-spacing:-11px;line-height:0.95;color:{FG};margin-left:-0.045em">{hero}</p>'
        f'<p style="font-size:34px;line-height:1.35;letter-spacing:-0.3px;color:{MID};width:784px">{line}</p>'
        "</div>"
    )


def two(a, b):
    return f'{SPACER}\n<div style="display:flex;flex-direction:row;gap:96px">{a}{b}</div>'


# ---------- problem ----------
write("problem", section(
    "problem", "The problem", "Traders lack edge. Agents lack rails.",
    two(hero_col("01 · No edge", "9 in 10",
                 "pump.fun traders lost money or made under $100 in 2024, with ~21,000 new tokens a day."),
        hero_col("02 · No rails", "20+",
                 "services to wire for one agent: wallets, RPCs, DEXs, paid data, LLMs. Then run it 24/7.")),
    "Dune wallet PnL, Aug 2024 (via The Defiant) · ~21,000/day: CoinGecko Research, 2024–26 avg · 20+: external services Tocker wires today",
    "Sam has two problems. No edge: in 2024, nine in ten pump.fun traders lost money or made under a hundred dollars, with twenty-one thousand new tokens a day. No rails: her own agent means wiring twenty-plus services, then running them around the clock. I know. I wired them.",
))


# ---------- solution ----------
def cell(t, hot=False):
    look = (f"background:{FG};color:#000000;border:1px solid {FG};font-weight:600" if hot
            else f"color:{FG};border:1px solid rgba(244,244,241,0.18)")
    return (f'<p style="flex:1 1 0;min-width:0;text-align:center;font-size:26px;padding:16px 10px;'
            f'border-radius:14px;white-space:nowrap;{look}">{t}</p>')


ARROW = f'<x-shape kind="arrow-right" style="width:20px;height:12px;background:{MID}"></x-shape>'


def venue(t, live):
    dot = (f'<div style="width:12px;height:12px;border-radius:50%;background:{FG}"></div>' if live
           else f'<div style="width:12px;height:12px;border-radius:50%;border:2px solid {DIM}"></div>')
    col = FG if live else MID
    return (f'<div style="display:flex;flex-direction:row;align-items:center;gap:10px;padding:8px 14px;border:1px solid {HAIR};border-radius:999px">'
            f'{dot}<p style="font-size:22px;color:{col};white-space:nowrap">{t}</p></div>')


def fix_col(lbl, title, line, extra=""):
    return (
        f'<div style="flex:1;display:flex;flex-direction:column;gap:18px;border-top:1px solid {HAIR};padding:32px 0 0 0">'
        f"{label(lbl)}"
        f'<p style="font-size:56px;font-weight:600;letter-spacing:-1.5px;line-height:1.05;color:{FG}">{title}</p>'
        f'<p style="font-size:30px;line-height:1.35;color:{MID};width:784px">{line}</p>{extra}</div>'
    )


venues = ('<div style="display:flex;flex-direction:row;gap:8px;padding:6px 0 0 0">'
          + venue("Solana", True) + venue("Base", True) + venue("Polymarket · next", False)
          + venue("Tokenized stocks · next", False) + "</div>")

write("solution", section(
    "solution", "The solution", "Tocker is the edge and the rails.",
    '<div style="height:10px"></div>\n<div style="display:flex;flex-direction:row;align-items:center;gap:14px">'
    + cell("Plain-English strategy") + ARROW + cell("Your agent, any LLM") + ARROW
    + cell("Buys alpha via x402") + ARROW + cell("Ten gates can veto", True) + ARROW + cell("Trades, 24/7") + "</div>\n"
    + f'{SPACER}\n<div style="display:flex;flex-direction:row;gap:96px">'
    + fix_col("Fixes 01 · No edge", "Paid alpha + a code veto",
              "Smart-money, launch and sell-check data, paid per call. Ten hard gates, enforced in code before any buy.")
    + fix_col("Fixes 02 · No rails", "One integration",
              "Wallet, data, inference and execution, wired once and hosted 24/7. Bring your AI key, or pay in USDC (next).", venues)
    + "</div>",
    "Private beta on Solana and Base · x402 is backed by Visa, Mastercard, Stripe, Google and AWS (x402 Foundation, Linux Foundation, 2026)",
    "Tocker fixes both. The edge: paid smart-money, launch and sell-check data, and ten hard gates in code that can veto any buy. The rails: one integration for wallet, data, inference and execution, hosted 24/7 on your own AI key, with USDC per call next. Solana and Base today, Polymarket and tokenized stocks next.",
))

# ---------- product ----------
K = 1480 / 2400  # screenshot 2400x932 -> 1480 wide; card sits at (48,50)-(2352,882)
card_w, card_h = round(2304 * K), round(832 * K)
box_left = (1664 - card_w) // 2
img_l, img_t = -round(48 * K), -round(50 * K)
left_txt = box_left + round(114 * K) + img_l
right_txt = box_left + round(1092 * K) + img_l
write("product", section(
    "product", "Product", "Write a strategy. Your agent trades it.",
    f'{SPACER}\n<div style="position:relative;width:1664px;height:584px">'
    f'<div style="position:absolute;left:180px;top:-120px;width:1300px;height:800px;background:{GLOW}"></div>'
    f'<div style="position:absolute;left:{left_txt}px;top:0px">{label("01 · You write")}</div>'
    f'<div style="position:absolute;left:{right_txt}px;top:0px">{label("02 · Skips two, buys one")}</div>'
    f'<div style="position:absolute;left:{box_left}px;top:52px;width:{card_w}px;height:{card_h}px;overflow:hidden;border-radius:26px;border:1px solid {HAIR};background:#0a0a0b;box-shadow:0px 48px 120px rgba(0,0,0,0.55)">'
    f'<img src="/_blob/0f90af6b990bd102c618a57d6054bfbb" alt="Illustrative mock-up of a sample run. Strategy: Buy Solana memes with $1M+ liquidity when smart money is net buying and holders rise. Take 40%, stop at 15%. The agent night-shift scanned BONK (58, skipped) and POPCAT (49, skipped), below its floor of 62, and WIF (81, bought). WIF on Solana passes 10 of 10 hard gates and the agent buys $100, stop 15%, take 40%." style="position:absolute;left:{img_l}px;top:{img_t}px;width:1480px;height:{round(932 * K)}px">'
    "</div></div>",
    "Illustrative mock-up of a sample run. Every agent starts on paper and asks before it buys.",
    "Here's Sam's agent. One line of English: liquid Solana memes, smart money buying, holders rising, take forty, stop at fifteen. It skips BONK and POPCAT, below her floor. WIF scores eighty-one, clears all ten gates, and buys a hundred dollars, with exits set in code.",
    ml=-2,
))


# ---------- alpha ----------
def arow(lbl, q, who, price, last=False):
    bb = f";border-bottom:1px solid {HAIR}" if last else ""
    return (
        f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:40px;padding:22px 0;border-top:1px solid {HAIR}{bb}">'
        f'<p style="width:250px;{MONO};font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{DIM}">{lbl}</p>'
        f'<p style="flex:1;font-size:34px;letter-spacing:-0.5px;color:{FG}">{q}</p>'
        f'<p style="width:206px;font-size:26px;color:{MID}">{who}</p>'
        f'<p style="width:140px;text-align:right;{MONO};font-size:36px;letter-spacing:-1px;color:{FG};font-variant-numeric:tabular-nums">{price}</p></div>'
    )


write("alpha", section(
    "alpha", '<span style="text-transform:none">x402</span> · Paid alpha', "The edge, bought one answer at a time.",
    f'{SPACER}\n<div style="display:flex;flex-direction:column">'
    + arow("Launches", "What just launched on Solana that isn’t junk?", "SolEnrich", "$0.012")
    + arow("Smart money", "Are proven wallets buying, or quietly selling?", "Nansen", "$0.050")
    + arow("Sentiment", "Is real chatter growing, or is it a paid shill?", "X via x402Atlas", "$0.006")
    + arow("Rug risk", "Are insiders and bundled wallets holding the supply?", "Deepnets", "$0.010")
    + arow("Sell check", "Can I actually sell my size, or is it a honeypot?", "Plexa", "$0.050", True)
    + f"</div>\n{SPACER}\n"
    + f'<p style="font-size:34px;letter-spacing:-0.5px;line-height:1.35;color:{MID};width:1664px">About <span style="color:{FG}">7¢</span> a token on Solana, <span style="color:{FG}">11¢</span> on Base, bought only after the free checks pass.</p>',
    "Per-call prices, Tocker data-source registry · SolEnrich priced per sweep · Rug risk: Solana · Sell check: Base · AI test: Alpha Arena S1 (Nof1), Oct 2025",
    "Can AI even trade? Last October, six frontier models traded real money; four lost over thirty percent. A raw model trades blind, so Sam's agent buys answers over x402, from what just launched to whether insiders hold the supply: seven to eleven cents a token, only on tokens that pass the free checks.",
))

# ---------- business ----------
write("business", section(
    "business", "Market and model", "Traders pay 1%. We’ll charge 0.2%.",
    two(hero_col("Market", "$1.7B", "paid by Solana traders in 2025. Our lane: the $940M that went to bots and terminals."),
        hero_col("Our fee · planned", "20 bps", "a trade: 20¢ on $100, where a 1% bot takes $1.<br>AI: your key, or USDC per call (next).")),
    "Solana Foundation 2025 recap (Blockworks): $940M bots + $762M launchpads · 1% bots: Photon, Trojan, BonkBot · Beta: $0.10 per fill",
    "Traders already pay. In 2025, Solana traders paid one point seven billion dollars in fees, nine hundred forty million of it to bots at one percent a trade. That's our lane. We plan to charge zero point two percent: twenty cents on a hundred dollars.",
))


# ---------- gtm ----------
def step(n, t, last=False, col=FG):
    bb = f";border-bottom:1px solid {HAIR}" if last else ""
    return (f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:32px;padding:14px 0;border-top:1px solid {HAIR}{bb}">'
            f'<p style="width:48px;{MONO};font-size:24px;color:{DIM}">{n}</p>'
            f'<p style="flex:1;font-size:34px;letter-spacing:-0.5px;color:{col}">{t}</p></div>')


def mkt(when, num, what):
    return (f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:20px">'
            f'<p style="width:92px;{MONO};font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{DIM}">{when}</p>'
            f'<p style="width:196px;{SANS};font-size:56px;font-weight:600;letter-spacing:-2px;line-height:1;color:{FG};font-variant-numeric:tabular-nums">{num}</p>'
            f'<p style="flex:1;font-size:26px;line-height:1.3;color:{MID}">{what}</p></div>')


write("gtm", section(
    "gtm", "Go-to-market", "Every trade markets itself.",
    f'{SPACER}\n<div style="position:relative;width:1664px;height:584px;display:flex;flex-direction:row">'
    f'<div style="position:absolute;left:786px;top:-158px;width:900px;height:900px;background:{GLOW}"></div>'
    f'<div style="position:absolute;left:896px;top:0px;width:768px;height:584px;overflow:hidden;border-radius:26px;border:1px solid {HAIR};background:#0a0a0c;box-shadow:0px 48px 120px rgba(0,0,0,0.55)">'
    '<img src="/_blob/8d38bced6bc09c4cdf36846d54e268be" alt="Tocker\'s public feed: agent trade posts, each with the token, size, entry score and a one-line rationale" style="position:absolute;left:20px;top:20px;width:728px;height:627px"></div>'
    '<div style="width:800px;display:flex;flex-direction:column;justify-content:space-between">'
    '<div style="display:flex;flex-direction:column">'
    + step("01", "Every fill posts with its entry score") + step("02", "Followers launch their own agent")
    + step("03", "Next, creators earn a share of the fees", True, MID)
    + "</div>"
    + f'<div style="display:flex;flex-direction:column;gap:16px;border-top:1px solid {HAIR};padding:20px 0 0 0">'
    + label("Where the agent trades · yearly volume")
    + mkt("Now", "$482B", "Solana memecoins, 2025")
    + mkt("Next", "$21.5B", "Polymarket, 2025")
    + mkt("Then", "$12.4B", "Solana tokenized stocks, 2026 to date")
    + "</div></div></div>",
    "Feed: in-app demo data · Memecoins: Solana 2025 recap · Polymarket: Keyrock/Dune, 2025 · Stocks: CryptoBriefing, Solana DEX volume, 2026 to date",
    "Every agent trades in public, so every trade markets itself. Each post shows the fill and its entry score, never the strategy. Followers launch their own; next, creators earn a fee share. Today that's memecoins: four hundred eighty-two billion dollars traded on Solana in 2025. Next Polymarket, twenty-one billion last year, then tokenized stocks, already twelve billion this year.",
    ml=-6,
))

# competition slide: generated separately by comp-a-work/gen.py (Series A comparison table)


# ---------- team ----------
def trow(logo, alt, t, s):
    return (f'<div style="display:flex;flex-direction:row;align-items:center;gap:36px;padding:40px 0;border-top:1px solid {HAIR}">'
            f'<img src="/_blob/{logo}" alt="{alt}" style="width:88px;height:88px;border-radius:20px;object-fit:cover;border:1px solid {HAIR}">'
            f'<div style="flex:1;display:flex;flex-direction:column;gap:10px">'
            f'<p style="font-size:40px;font-weight:500;letter-spacing:-0.5px;line-height:1.15;color:{FG}">{t}</p>'
            f'<p style="font-size:30px;line-height:1.3;color:{MID}">{s}</p></div></div>')


write("team", section(
    "team", "Team", "Shipped by an x402 and fintech operator.",
    f'{SPACER}\n<div style="display:flex;flex-direction:row;gap:96px;align-items:flex-end">'
    '<div style="width:448px;display:flex;flex-direction:column;gap:28px">'
    f'<img src="/_blob/6267b634bb7c763519614c99ac639862" alt="Portrait of Rami Djebari" style="width:448px;height:448px;border-radius:28px;object-fit:cover;border:1px solid {HAIR}">'
    '<div style="display:flex;flex-direction:column;gap:8px">'
    f'<p style="font-size:56px;font-weight:600;letter-spacing:-1.5px;line-height:1.05;color:{FG}">Rami Djebari</p>'
    f'<p style="font-size:30px;color:{MID}">Founder, Tocker</p></div></div>'
    '<div style="flex:1;display:flex;flex-direction:column">'
    + trow("645c45990ef87d1be936649a1f600aca", "BlockRun logo", "Product &amp; Growth Lead, BlockRun", "The leading x402 gateway")
    + trow("d965f9aa423f91f800a9ada66ef7722b", "Sorbet logo", "Founder &amp; CEO, Sorbet", "Neobank. Raised $1M, transacting $5M a month.")
    + trow("37e07f7c17a3f955571e65fe76aee2f6", "Deloitte logo", "Omnia AI, Deloitte", "Deloitte’s AI practice")
    + f'<p style="padding:17px 0 0 0;border-top:1px solid {HAIR};{MONO};font-size:24px;letter-spacing:3px;text-transform:uppercase;color:{DIM}">Superteam Germany · Tocker built in under 4 weeks</p>'
    + "</div></div>",
    "Tocker repo: 269 commits, 10 Sep – 3 Oct 2026 (GitHub API)",
    "Why me? I lead product and growth at BlockRun, the leading x402 gateway, so I know these rails. I founded Sorbet, a neobank that raised a million dollars and moves five million a month. I worked on AI at Deloitte's Omnia. And I shipped Tocker in under four weeks.",
    ml=-6,
))

# ---------- thanks ----------
write("thanks", (
    f'<section id="thanks" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px">\n'
    '<div style="position:absolute;left:560px;top:40px;width:800px;height:640px;background:radial-gradient(ellipse at 50% 50%, rgba(61,107,255,0.2) 0%, rgba(139,108,255,0.06) 32%, rgba(0,0,0,0) 66%)"></div>\n'
    '<img src="/_blob/eb48bae1d4d152b4534d7ba8e6207637" alt="Tocker\'s neon T mark" style="width:300px;height:252px;object-fit:contain">\n'
    f'<div style="display:flex;flex-direction:column;align-items:center;gap:28px">'
    f'<h1 style="{SANS};font-size:160px;font-weight:600;letter-spacing:-7px;line-height:1;color:{FG}">Thank you.</h1>'
    f'<p style="font-size:36px;letter-spacing:-0.5px;color:{MID}">Your agent trades while you sleep.</p></div>\n'
    f'<p style="{MONO};font-size:30px;letter-spacing:0.5px;color:{MID}">tocker.xyz</p>\n'
    "<aside>" + html.escape("Tocker is in private beta on Solana and Base. [pause] Back to Sam. Same token. Same three a.m. This time she's asleep, and her agent said no. [pause] Tocker. Your agent trades while you sleep. Thank you.", quote=False) + "</aside>\n</section>\n"
))

# ---------- cover: notes only (slide is locked) ----------
p = OUT + "cover.html"
s = open(p).read()
s = s.replace("I'm [name], and this is Tocker", "I'm Rami, and this is Tocker")
open(p, "w").write(s)
print("ok")
