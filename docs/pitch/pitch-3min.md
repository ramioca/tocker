# Tocker — 3-minute pitch (short deck, v5)

~483 words, about 3:05 at 155 wpm. Sam is an illustrative composite, not a real user. [pause] marks a beat.
Reviewed over four rounds by VC-partner, design and code-level fact-check critics (Oct 7, 2026). Competition: 'An early category. A different approach.' Table vs ClawPump, Minara, Senpi, Fere AI, Ask Gina, HeyElsa with logos, best-at, traction (verified vs self-reported) and four marks; deep research and a VC fact-check pass on Oct 8, 2026 (research/26-competitors-deep). Alternative angles in docs/pitch/deck/competition-angles/.

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
Agentic trading is early: a handful of seed-stage teams, each genuinely good at one thing. Minara has real perps volume, ClawPump the deepest agent toolkit, Senpi turnkey Hyperliquid strategies. Our approach is different: the agent buys alpha per call, screens every token in code before it buys, and trades in public. Paying for inference in USDC is next.

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
- Competition cells, traction and funding — research/26-competitors-deep (Oct 8 2026; supersedes 22 and 25)

## Likely Q&A
1. **Traction?** Honest answer: private beta, agents start on paper. Bring real numbers (beta agents, paper/live fills, % of candidate buys vetoed by gates).
2. **20 bps vs $0.10 in code; Senpi charges 5 bps, Robinhood's agents are free.** Flat is the beta setting; 20 bps covers hosting, paid data and gates, still 5× under the 1% bots these traders pay today.
3. **Who pays for data? Unit economics?** Today the platform settles x402 calls; next, data bills to the agent's wallet and is shared per token across agents.
4. **Why "infrastructure" without a public API/SDK?** The gates and the per-fill score record are the product; next, we sell the pre-trade check over x402 to any Coinbase, Bankr or OpenClaw agent.
5. **What stops Nansen or GMGN adding gates?** Data is a commodity we buy from everyone (including Nansen); enforced gates plus a public, score-stamped record with private strategies is the loop.
6. **BlockRun conflict?** Disclose the founder's BlockRun role; any inference routing through it is at provider cost, and the user can always bring their own key.
7. **Bankr already pays x402 and sells USDC inference.** True, and we credit it: Bankr is wallet rails you command in chat. Tocker is the strategy agent on top, with gates that can veto a buy and a public fill record.
8. **ClawPump claims $225M+ volume and has x402 and USDC inference too.** Credit it: it's the best toolkit for agents that earn, with wallets, 130 MCP tools and gasless launches. Its rug check is an opt-in skill; ours is a veto in code before every buy. It helps agents earn; Tocker trades a person's strategy in public.
9. **"Private beta next to $2.6B of volume: why a Series A?"** Rivals' volume proves demand for agents that trade. None we found vetoes a buy on token-safety checks in code, and that is where retail loses money (research/02). Bring beta numbers: agents live, fills, and the share of candidate buys the gates vetoed.
10. **"Can I copy an agent?"** No, by design. Copying front-runs the leader and leaks the strategy. You follow an agent's public fills and launch your own; creator fee share is next.
11. **"USDC inference: ClawPump and Minara already have it."** Yes, so it sits in the last column. Today agents run on your own key; per-call USDC inference is next. The edge is in the first three columns.

## Know the field (keep off the slide)
- Senpi's public GitHub has a "volume generation engine" built for $5M a day of BTC round-trips (Apr 2026). It is unclear whether it ran, so treat its $411M as possibly inflated. Its Agents Arena was retired Jul–Aug 2026.
- Minara's 30-day Hyperliquid volume fell from ~$449M (about June) to ~$35M (about August). Some of it probably moved to Lighter, which DefiLlama counts only from Sep 8.
- Fere AI rebuilt itself on Oct 6, 2026 as a catalogue of fixed-strategy agents. Plain-English strategies and the chat agent are gone.
- HeyElsa's ELSA token fell ~90% from its January high; ~46% of wallets in one airdrop campaign had no on-chain activity.
- Ask Gina publishes no traction, and its backers are self-reported.
