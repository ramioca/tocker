# Tocker — 3-minute pitch (short deck, v5)

~483 words, about 3:05 at 155 wpm. Sam is an illustrative composite, not a real user. [pause] marks a beat.
Reviewed over four rounds by VC-partner, design and code-level fact-check critics (Oct 7, 2026). Competition: three camps of agentic-trading startups (chat-to-trade, perps agents, agent kits) vs Tocker's full stack (USDC inference next, x402 alpha, advanced filters & gates, social trading).

## cover
Three a.m. A trader, call her Sam, sees a new token trending. She buys. Minutes later, it's worth nothing. The wallets that bought first? Insiders. [pause] Sam isn't dumb. She's outgunned. I'm Rami, and this is Tocker: the infrastructure for agentic trading.

## problem
Sam has two problems. No edge: in 2024, nine in ten pump.fun traders lost money or made under a hundred dollars, with twenty-one thousand new tokens a day. No rails: her own agent means wiring twenty-plus services, then running them around the clock. I know. I wired them.

## solution
Tocker fixes both. The edge: paid smart-money, launch and sell-check data, and ten hard gates in code that can veto any buy. The rails: one integration for wallet, data, inference and execution, hosted 24/7 on your own AI key, with USDC per call next. Solana and Base today, Polymarket and tokenized stocks next.

## product
Here's Sam's agent. One line of English: liquid Solana memes, smart money buying, holders rising, take forty, stop at fifteen. It skips BONK and POPCAT, below her floor. WIF scores eighty-one, clears all ten gates, and buys a hundred dollars, with exits set in code.

## alpha
Can AI even trade? Last October, six frontier models traded real money; four lost over thirty percent. A raw model trades blind, so Sam's agent buys answers over x402, from what just launched to whether insiders hold the supply: seven to eleven cents a token, only on tokens that pass the free checks.

## business
Traders already pay. In 2025, Solana traders paid one point seven billion dollars in fees, nine hundred forty million of it to bots at one percent a trade. That's our lane. We plan to charge zero point two percent: twenty cents on a hundred dollars.

## competition
Three camps of funded startups are building trading agents. Chat-to-trade apps like Nansen and Bankr wait for your prompt. Perps agents like Senpi are autonomous, but on one venue. Agent kits hand you parts to wire yourself. Tocker is the full stack, hosted 24/7: USDC inference next, x402 alpha, advanced filters, and social trading.

## gtm
Every agent trades in public, so every trade markets itself. Each post shows the fill and its entry score, never the strategy. Followers launch their own; next, creators earn a fee share. Today that's memecoins, five billion dollars a week on Solana at the August peak. Next Polymarket, then tokenized stocks.

## team
Why me? I lead product and growth at BlockRun, the leading x402 gateway, so I know these rails. I founded Sorbet, a neobank that raised a million dollars and moves five million a month. I worked on AI at Deloitte's Omnia. And I shipped Tocker in under four weeks.

## thanks
Tocker is in private beta on Solana and Base. [pause] Back to Sam. Same token. Same three a.m. This time she's asleep, and her agent said no. [pause] Tocker. Your agent trades while you sleep. Thank you.

## What's labelled planned (keep it that way until shipped)
- 20 bps fee: beta charges $0.10 flat per fill (`src/lib/platform/fee.ts`).
- Inference paid per call in USDC: today agents run on the owner's key (Anthropic, OpenAI, OpenRouter).
- Polymarket and tokenized stocks: "next".
- Product slide is an illustrative mock-up of a sample run.

## Sources for spoken and on-slide claims
- 9 in 10 pump.fun traders (2024): Dune wallet PnL via The Defiant — research/01
- ~21,000 tokens/day (2024–26 average): CoinGecko Research — research/03
- 20+ external services: Tocker's own integrations (registry.ts, SPEC.md)
- Alpha Arena: four of six frontier models lost 31–63% (Oct 2025) — research/06
- x402 Foundation backers: Linux Foundation (2026) — research/06
- Per-call prices: src/lib/data-sources/*.ts; ~7¢ Solana / ~11¢ Base per token — research/12, enrichment.ts
- $1.7B = $940M bots/terminals + $762M launchpads (2025): Solana Foundation recap, Blockworks Research — research/04
- $5.2B Solana memecoins in a week (to 26 Aug 2026): Blockworks — research/18
- $10.8B Polymarket, June 2026: Portals — research/13
- $5.8B Solana tokenized-stock volume, Q2 2026: SolanaCompass — research/14
- Competition facts and placements — research/16, research/17

## Likely Q&A
1. **Traction?** Honest answer: private beta, agents start on paper. Bring real numbers (beta agents, paper/live fills, % of candidate buys vetoed by gates).
2. **20 bps vs $0.10 in code; Senpi charges 5 bps, Robinhood's agents are free.** Flat is the beta setting; 20 bps covers hosting, paid data and gates, still 5× under the 1% bots these traders pay today.
3. **Who pays for data? Unit economics?** Today the platform settles x402 calls; next, data bills to the agent's wallet and is shared per token across agents.
4. **Why "infrastructure" without a public API/SDK?** The gates and the per-fill score record are the product; next, we sell the pre-trade check over x402 to any Coinbase, Bankr or OpenClaw agent.
5. **What stops Nansen or GMGN adding gates?** Data is a commodity we buy from everyone (including Nansen); enforced gates plus a public, score-stamped record with private strategies is the loop.
6. **BlockRun conflict?** Disclose the founder's BlockRun role; any inference routing through it is at provider cost, and the user can always bring their own key.
