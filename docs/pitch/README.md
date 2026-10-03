# Tocker — 3-minute pitch

**Deck:** https://claude.ai/artifact/HL3pTU2GpbzMdT1nvFbgBT (11 slides, 16:9). It is private until it is shared from the deck's Share menu, and it exports to PDF and PPTX from there.

The deck was built on 2026-10-03 from the research briefs in [`research/`](research/). It follows the landing page's v2 brand: near-black ground, the neon T, Geist with Geist Mono for figures, and the neon gradient on one word per headline.

## Fill in before presenting

| Slide | Placeholder |
|---|---|
| 1 Cover (speaker notes), 11 Close | `[name]`, `[Founder name] · [one-line background]` |
| 11 Close | `[N] on the waitlist` (the admin dashboard shows the count), `[N] agents on paper`, `[N] fills to date` |
| 11 Close | `Raising [$__] [pre-seed] to [...]` and the matching line in the notes |
| 7 Market | SOM assumptions: `[25k]` live agents × `[4]` fills a day × $0.10 = `[$3.7M]` |

## Check these before the deck goes out

During research the environment's network policy blocked page fetches. Every external figure below therefore came from **search-result excerpts of the cited pages**, not from reading the pages themselves. Click through each one before presenting.

| Slide | Figure as shown | Source | Confidence |
|---|---|---|---|
| Problem | 9 in 10 pump.fun traders lost money or made less than $100 | Dune wallet PnL, Aug 2024 (60% lost money, 4.7% made $0, 24% made <$100), via [The Defiant](https://thedefiant.io/news/defi/just-3-of-pump-fun-traders-have-made-over-usd1000) | med-high |
| Problem | 293 of 13.55M wallets realized $1M+ | Dune (Adam Tehc), Jan 2025, via [Cointelegraph](https://cointelegraph.com/news/pump-fun-crypto-traders-majority-do-not-realize-profits-dune-data). Decrypt has 294 of 13.4M. | high |
| Problem | 70% unprofitable in June 2025 | [CoinGecko Research](https://www.coingecko.com/research/publications/pump-fun-traders-are-making-a-comeback), 2026 | high |
| Why | 1 token every ~4 s, ~21,000 a day | CoinGecko Research, Jun 2026: 18.67M tokens from 14 Jan 2024 to 18 Jun 2026. ÷ 886 days is our own arithmetic. | med-high |
| Why | 98.6% of 7M+ tokens fell below $1,000 liquidity | [Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance), May 2025. This measures liquidity collapse, so don't call it "scams". | high |
| Why | 15,000+ launches a month sniped in the first block by deployer-funded wallets | [Pine Analytics](https://pineanalytics.substack.com/p/exit-liquidity-machines), 2025 (exact date unverified) | med |
| Why | 73–81% of crypto-app users likely lost money on bitcoin | [BIS](https://www.bis.org/publ/bisbull69.htm) Bulletin 69 (Feb 2023) and Working Paper 1049 (Nov 2022) | med-high |
| Why now | ~11× cheaper frontier tokens | OpenAI list prices: GPT-4 $30/$60 (Mar 2023) vs GPT-5 $1.25/$10 (Aug 2025), blended 3:1 input:output | high |
| Why now | x402 now a Linux Foundation standard backed by Visa, Stripe, Google, AWS | [Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol), 2 Apr 2026 | high |
| Why now | 120M+ accounts on Privy | [Privy blog](https://privy.io/blog/privy-at-stripe-sessions-building-for-stablecoins-and-agentic-commerce), 2026 (company-reported) | med |
| Why now | 4 of 6 frontier models lost 31–63% | Nof1 Alpha Arena S1, via [Blockworks](https://empire-blockworks.beehiiv.com/p/ai-trades-on-hyperliquid), Oct 2025 | med-high |
| Market | $940M to bots and terminals and $762M to launchpads on $108B traded; memecoins $482B of $1.5T DEX volume (2025) | Solana Foundation 2025 recap (data: Blockworks Research), via [Bitget](https://www.bitget.com/news/detail/12560605132683) and [MEXC](https://www.mexc.com/news/419019) | med-high |
| Model | 1% at Photon, Trojan, BonkBot; 0.75–1% at Axiom | [madeonsol](https://madeonsol.com/blog/gmgn-vs-photon), TYN Magazine, 2026 | high |
| GTM | fomo grew from 120K to 1.9M users | Decrypt citing TechCrunch (Nov 2025); Odaily (Sep 2026) | med |
| GTM | 50M+ views of Alpha Arena | Nof1, self-reported, via AI Weekly (May 2026) | med |

## Script (about 460 words, about 3 minutes)

These are the deck's speaker notes, one paragraph per slide.

1. **Cover.** Hi, I'm [name], and this is Tocker. You describe a trading strategy in plain English, and your own AI agent trades it around the clock, while you sleep, out in the open.
2. **Problem.** Memecoins are where retail trades on-chain, and retail gets crushed. On pump.fun, roughly nine in ten traders lost money or made less than a hundred dollars. Of 13.5 million wallets, 293 ever banked a million. And in June 2025, seven in ten were still unprofitable.
3. **Why they lose.** Four reasons. No alpha: pump.fun mints a new token every four seconds, and no human can screen that. Rugged: 98.6 percent of seven million tokens collapsed. Outrun: insiders snipe fifteen thousand launches a month in the very first block. And FOMO: retail buys the pump and rides it down.
4. **Solution.** So we built the opposite of FOMO: an agent with discipline. It sweeps every launch and scores each one. Ten hard gates refuse rugs before any score counts. It doesn't race snipers; it waits out the first thirty minutes. And its exits are code, not willpower.
5. **Product.** You write the strategy in plain English. The agent scores each launch against your floor, checks all ten gates, sizes the trade and sets its exits. It starts on paper, asks before every entry, and posts every fill publicly.
6. **Why now.** In the past year, agents got cheap enough to think, a standard way to pay, and wallets to hold money. But last fall, four of six frontier models lost 31 to 63 percent trading live. What they lack is discipline.
7. **Market.** In 2025, Solana traders paid 940 million dollars to trading bots and terminals, almost one percent of every trade, and 762 million more to launchpads. That's 1.7 billion dollars spent in one year, on one chain, just to trade memecoins.
8. **Business model.** We charge a flat ten cents a fill. Bots take one percent: on a hundred-dollar trade, that's a dollar versus our dime. It's flat on purpose, so we never want you to trade bigger. And users bring their own AI key.
9. **Competition.** Today, retail clicks every trade on terminals and Telegram bots, paying about one percent, or copies someone else's wallet and arrives late. AI agents are arriving, but none we've found runs your own strategy with enforced safety and a public record. That corner is ours.
10. **Go-to-market.** Distribution is built in: every fill is a public post with a verified record. fomo grew from 120 thousand to 1.9 million users on a feed of verified trades. We start with Solana launch traders and creators, then run seasons, agent versus agent, free on paper.
11. **Close.** We built and shipped this in under four weeks, on Solana and Base. We're raising [amount] to [goal]. Tocker: your agent trades while you sleep, out in the open. Thank you.

## Q&A prep

- **"Isn't pump.fun better for traders in 2026?"** CoinGecko shows the profitable share rising to 70–73% in Mar–Apr 2026. Over the same stretch, monthly active wallets fell about 65% (5.2M in May 2025 to 1.8M in Dec 2025), and the largest group of winners made $1–$500. The losers left.
- **"So 90% lose money?"** Say "lost money **or made under $100**" (Aug 2024). Outright losers were 50–70% depending on the month. Don't shorten the claim.
- **"Does Tocker stop rugs?"** No. It refuses tokens that fail the gates. Slow rugs, coordinated KOL dumps, insider supply spread across many wallets, and MEV can still get through. Exits cap the loss.
- **"Can it beat snipers?"** It doesn't try. By default it skips tokens under 30 minutes old and tokens whose top-10 holders own more than 60%. Super-fresh mode exists for operators who opt into it.
- **"Unit economics?"** Be ready for this one. Tocker pays for the x402 data. At default settings (96 runs a day, launch radar on every sweep, two paid reads per scored token), a default agent's typical data spend is about $8.80 a day. The most that agent pays in fees is about $2 a day. The levers are:
  - share data per token across agents
  - lower the default cadence
  - Pro tiers for cadence, agent count and premium data
  - pass data costs through
  - platform-side spend caps

  None of these are built yet. Details are in `research/05-business-model.md`.
- **"Isn't $0.10 cheaper than it needs to be?"** It beats 1% only on trades above $10. The pitch is aligned incentives, not price.
- **"GMGN opened an agent API (Mar–Apr 2026), and fomo raised a $75M Series B (Jun 2026)."** Their social layer is copy-trading, which can't coexist with a private strategy. Tocker's record is credible: entry scores are frozen and every fill has a receipt. Tocker also works with any model, because users bring their own key.
- **"Is the market shrinking?"** 2025 was the peak. In Q2 2026, Solana app revenue ran at about 43% of 2025's pace, and pump.fun at about 28%. Always say "in 2025", never "per year".

## Research briefs

| File | Topic |
|---|---|
| `research/01-retail-losses.md` | Retail P&L on pump.fun (the problem-slide anchor) |
| `research/02-rugs-insiders.md` | Rugs, insiders, MEV, and how the hard gates map to each |
| `research/03-why-retail-loses.md` | Behavior, speed and information: the four reasons |
| `research/04-market-size.md` | TAM / SAM / SOM, with the arithmetic |
| `research/05-business-model.md` | Competitor fees, revenue sensitivity, data cost per agent from the code |
| `research/06-why-now.md` | LLM costs, x402, agent wallets, Alpha Arena |
| `research/07-competition.md` | Landscape table, 2×2, the biggest threat |
| `research/08-gtm.md` | Comparable growth loops and a phased plan |
| `research/09-product-codebase.md` | Product facts with file:line references |
