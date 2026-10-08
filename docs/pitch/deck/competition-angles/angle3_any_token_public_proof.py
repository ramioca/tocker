"""Angle 3 competition slide: "Any token. Public proof. Private recipe."
Counter-positioning: each funded rival is kept from one promise by how it makes money.
Run: python3 -I gen.py  ->  refine/design/ang-3.html
"""
import html

OUT = "/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/refine/design/ang-3.html"
MONO = "font-family:'Geist Mono', 'Courier New', monospace"
SANS = "font-family:'Geist', Arial, sans-serif"
HAIR = "rgba(244,244,241,0.12)"
FG, MID, DIM = "#f4f4f1", "#a3a3a1", "#818180"
PAD = 32  # text inset from each column rule; the Tocker band uses the same inset so text lines up


def label(t, col=DIM, extra=""):
    return f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{col}{extra}">{t}</p>'


def two(a, b):
    """Balanced two-line copy with allowed tags only (no <br>)."""
    return f'{a}<span style="display:block">{b}</span>'


def column(n, promise, wont, because, who, num, cap):
    return (
        f'<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:space-between;'
        f'border-left:1px solid {HAIR};padding:4px {PAD}px 0 {PAD}px">'
        # top group: the promise and who won't offer it
        f'<div style="display:flex;flex-direction:column;gap:20px">'
        f'{label(f"{n} · {promise}")}'
        f'<p style="font-size:42px;font-weight:600;letter-spacing:-1.2px;line-height:1.08;color:{FG}">{wont}</p>'
        f'<p style="font-size:26px;line-height:1.32;letter-spacing:-0.2px;color:{MID};min-height:69px">{because}</p>'
        f'</div>'
        # bottom group: names + the strength we credit
        f'<div style="display:flex;flex-direction:column;gap:10px;padding-top:28px">'
        f'<p style="font-size:26px;line-height:1.3;color:{FG};white-space:nowrap">{who}</p>'
        f'<div style="display:flex;flex-direction:row;align-items:baseline;gap:14px">'
        f'<p style="font-size:36px;font-weight:600;letter-spacing:-1px;color:{FG};font-variant-numeric:tabular-nums;white-space:nowrap">{num}</p>'
        f'<p style="font-size:22px;color:{DIM};white-space:nowrap">{cap}</p>'
        f'</div></div>'
        f'</div>'
    )


def tcell(t):
    return (f'<div style="flex:1 1 0;min-width:0;padding:0 {PAD}px">'
            f'<p style="font-size:28px;line-height:1.25;letter-spacing:-0.3px;color:{FG}">{t}</p></div>')


cols = (
    column("01", "Any token",
           two("Venue agents won’t", "trade off-list."),
           two("Because a venue answers", "for every asset it lists."),
           f'Robinhood · Binance · Senpi <span style="color:{DIM}">$4M seed</span>',
           "150k+", "Robinhood agentic accounts")
    + column("02", "Public proof",
             two("Data apps won’t", "publish a record."),
             two("Because they sell data, not outcomes:", "you approve each trade."),
             f'Nansen AI <span style="color:{DIM}">same chains as us</span>',
             "$75M", "raised · 500M+ labeled wallets")
    + column("03", "Private recipe",
             two("Copy apps won’t", "hide the recipe."),
             two("Because every copied trade", "is their volume."),
             f'fomo · GMGN · Senpi <span style="color:{DIM}">copy trading</span>',
             "1.9M", "fomo users · $550M valuation")
)

band = (
    f'<div style="display:flex;flex-direction:column;gap:12px;border:1px solid rgba(244,244,241,0.5);'
    f'background:rgba(244,244,241,0.05);border-radius:20px;padding:20px 0 24px 0">'
    f'<p style="padding:0 {PAD}px;font-size:32px;font-weight:600;letter-spacing:-0.8px;color:{FG}">Tocker: all three, by design.</p>'
    f'<div style="display:flex;flex-direction:row">'
    + tcell("Any token past 10 hard gates.")
    + tcell("Every fill posted, entry score frozen.")
    + tcell("Strategy private. No copy button.")
    + '</div></div>'
)


def small(lbl, t, grow):
    size = "flex:0 0 66.6667%" if grow == 2 else "flex:1 1 0"
    return (f'<div style="{size};min-width:0;display:flex;flex-direction:row;align-items:baseline;gap:18px;padding:0 {PAD}px">'
            f'<p style="{MONO};font-size:22px;letter-spacing:3px;text-transform:uppercase;color:{DIM};white-space:nowrap">{lbl}</p>'
            f'<p style="font-size:24px;color:{MID};white-space:nowrap">{t}</p></div>')


bottom = (
    '<div style="display:flex;flex-direction:row">'
    + small("If Coinbase ships it", "It did: Coinbase for Agents trades only its listings.", 2)
    + small("Status quo", "You click every trade, at 1%.", 1)
    + '</div>'
)

body = (
    '<div style="flex:1"></div>\n'
    f'<div style="display:flex;flex-direction:row;align-items:stretch">{cols}</div>\n'
    f'{band}\n{bottom}'
)

eyebrow = "Competition · why rivals won’t follow"
headline = "Any token. Public proof. Private recipe."
foot = ("Oct 2026 · Robinhood: Fortune · Senpi: TFN · Nansen: The Block · fomo: VCA, Odaily · Coinbase: TechCrunch "
        "· Also mapped: Fere AI, Bankr, Minara, Parasol")
note = ("Three promises. Each funded rival gives one up because of how it earns. "
        "Robinhood's agents trade only what it lists. Nansen sells data and you approve each trade, so no agent has a record. "
        "fomo and GMGN earn when you copy. Coinbase already shipped agents; they trade its listings. We have all three by design.")

section = (
    f'<section id="competition" data-transition="fade" style="background:#000000;color:{FG};{SANS};padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">\n'
    f'<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{DIM}">{eyebrow}</p>\n'
    f'<h2 style="{SANS};font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{FG};width:1664px;white-space:nowrap">{headline}</h2>\n'
    f'{body}\n'
    f'<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{DIM};white-space:nowrap">{foot}</p>\n'
    f'<aside>{html.escape(note, quote=False)}</aside>\n</section>\n'
)

open(OUT, "w").write(section)
assert "<br" not in section
print("wrote", OUT, "| headline chars:", len(headline), "| note words:", len(note.split()))
