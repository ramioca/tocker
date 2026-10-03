## Rugs, insiders and extraction: how the game is rigged against retail

*Method note: source pages were blocked to direct fetch, so figures were checked against search extracts. Open the first three URLs before printing.*

### Headline stats (pitch-ready), ranked "how retail gets rugged"
1. **98.6% of pump.fun tokens collapsed below $1,000 liquidity.** Source: Solidus Labs, *2025 Rug Pull Report*, May 2025, https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance · high
2. **~94% of pump-and-dump pools were rugged by their own creator.** Source: Chainalysis, Feb 2025, https://www.chainalysis.com/blog/crypto-market-manipulation-wash-trading-pump-and-dump-2025/ · high
3. **Insiders and snipers held up to 96% of HAWK's supply.** Source: Bubblemaps, Dec 2024, https://blog.bubblemaps.io/hawk-anatomy-of-a-celebrity-rug/ · med
4. **86% of LIBRA traders sold at a loss, losing $251M.** Source: Nansen via The Block, Feb 2025, https://www.theblock.co/post/342266/traders-of-solana-based-libra-memecoin-lost-251-million-nansen · high
5. **Sandwich bots took $370M–$500M from Solana users in 16 months.** Source: sandwiched.me talk, Solana Accelerate, May 2025, https://solanacompass.com/learn/accelerate-25/scale-or-die-at-accelerate-2025-the-state-of-solana-mev · med
6. **Honeypots, sell taxes, mint and freeze abuse:** I found no defensible figure from 2025–26. Show no number for these.

### Supporting detail
- **Solidus Labs:** the study covered more than 7M pump.fun tokens (Jan 2024–Mar 2025, each with at least 5 trades). Only ~97,000 kept at least $1K of liquidity, and 1 − 97k/7M = 98.6%. Solidus labels this collapse as rug-pull or pump-and-dump patterns. On Raydium, 93% of 361,000 pools showed soft-rug signs, with a median rug of $2,832. Pump.fun replied that the report "lacks a basic understanding of meme coins."
- **Chainalysis:** 3.59% of the 2,063,519 tokens launched in 2024 (≈74k) showed pump-and-dump patterns. The pool creator rugged ~94% of those pools, and addresses the deployer had funded rugged the other 6%. Later data shared with CryptoPotato gives 89%/11% (date unverified).
- **LIBRA:** Nansen's 86% covers the 15,430 wallets with more than $1K of realized PnL. Separately, 8 linked wallets pulled more than $107M of liquidity (Cointelegraph, Feb 2025, https://cointelegraph.com/news/milei-libra-token-scandal-107m-rug-pull).
- **TRUMP:** Bubblemaps says a sniper turned $1M into $109M; the trader denies having inside information (The Block, Feb 2025, https://www.theblock.co/post/341664/crypto-analytics-platform-bubblemaps-claims-one-trader-turned-1-million-into-109-million-trading-trump-memecoin).
- **MELANIA:** the team "quietly sold" more than $30M of tokens (Bubblemaps via Decrypt, Apr 2025, https://decrypt.co/313866/melania-solana-meme-coin-dumps-bubblemaps).

**How the hard gates map to each attack.** Defaults: liquidity at least $15K, holders at least 150, age at least 30 min, top-10 share at most 60%, tax at most 5%.

| Attack | Gates that bite | What gets through |
|---|---|---|
| Launch-and-abandon | liquidity, holders, age | a slow bleed after entry; a pool pulled between the 5-minute exit checks |
| Creator dump | top-10, mint | a gradual dev sell-off |
| Snipers and bundlers | age, top-10, holders | supply split across many wallets (there is no funding-cluster check) |
| KOL or celebrity exit | top-10, sometimes | a coordinated shill followed by a dump |
| Honeypot or tax | honeypot, tax, sell simulation | a tax raised after entry; the sell simulation is paid and Base-only |
| Mint or freeze abuse | mint, freeze (an unknown answer blocks the buy) | mostly covered |
| Sandwich MEV | none | only reduced, by the $100 default trade size and Jupiter Ultra routing |
| Known bad tokens | blocklist | anything not on the list |

The exits cap losses on every row; they prevent none of them.

### Suggested slide copy
- "98.6% of pump.fun launches collapse. Tocker screens every one before it buys."
- "Creators rug. Snipers front-run. Bots sandwich. Retail pays."
- "Ten hard gates before every buy. Exits in code, every five minutes."

Spoken line: "Solidus Labs found that 98.6% of seven million pump.fun tokens collapsed, and Chainalysis found nine in ten pump-and-dumps are rugged by their creator. Tocker's agent runs ten gates before buying, and exits in code."

### Caveats / what not to claim
- **Don't call the 98.6% "scams".** It measures liquidity collapse, and most of those tokens were simply abandoned. Don't merge it with Chainalysis's 3.59%: the two studies use different definitions.
- **Never say Tocker "prevents rugs".** Slow rugs, KOL dumps, insider supply split across wallets and MEV all get past the gates.
- **Super-fresh mode drops the age gate.** Buying mints that are minutes old means lowering the 30-minute age gate, which is the cheapest anti-snipe filter.
- **The case figures are analysts' attributions.** The Bubblemaps and Nansen numbers are not court findings.
- **The authority gates matter less on pump.fun.** Pump.fun mints launch with mint and freeze authority revoked (not re-verified here), so these gates bite mainly elsewhere and on Base.
