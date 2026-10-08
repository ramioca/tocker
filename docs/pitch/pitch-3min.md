# Tocker — 3-minute pitch (short deck, v5)

~378 words, about 2:20 at 160 wpm (the deck's speaker notes; trimmed Oct 8, 2026). The ~505-word, 3:10 version is kept below. Rewritten by a copywriter pass on Oct 8, 2026: the hook is the market (21,000 tokens a day); the founder's own losses to rugs, honeypots and emotion sit on the problem slide with the running cost (~$200 a month, a fee per swap, and 20+ services to wire); the product slide pays it off (an agent isn't emotional). [pause] marks a beat.
Reviewed over four rounds by VC-partner, design and code-level fact-check critics (Oct 7, 2026). Competition: 'An early category. We bet the other way.' (fallback: 'A different approach.'). Rival strip, then what all six do vs Tocker (data, safety, social), each with dated evidence. Copy, two design variants and a VC/fact critic merged on Oct 8, 2026 (research/26-competitors-deep), then rebuilt in the Slides subset (flow layout, text ≥24px, no overlays). Earlier full table: docs/pitch/deck/competition-angles/table_v9.png. Alternative angles in docs/pitch/deck/competition-angles/.

## cover
Twenty-one thousand tokens launch on pump.fun every day. Almost all collapse. Bots and insiders buy first. [pause] Retail isn't dumb. It's outgunned. I'm Rami, and Tocker is the infrastructure for safe agentic trading.

## problem
Over ninety days this year, ninety-four percent of Solana memecoin wallets made no profit. I've lost more than I'd like to admit to rugs, honeypots and my own emotions. And building your own agent? About two hundred dollars a month, and twenty-plus services to wire and babysit.

## solution
Tocker fixes both with one line of English. Your agent buys data per call, ten hard gates in code can veto any buy, and it runs hosted around the clock. Nothing to wire.

## product
Here's a sample run. The thesis: memes smart money is accumulating. The agent skips BONK and POPCAT. WIF scores eighty-one, clears all ten gates, and it buys a hundred dollars, exits in code. [pause] I was emotional. An agent isn't. It just follows your rules.

## alpha
Rules aren't edge, and neither is AI alone: four of six frontier models lost over thirty percent trading real money. So your agent buys answers per call over x402: who's buying, can I sell, is it a rug? About seven cents a token.

## business
Who pays? Traders already do: nine hundred forty million dollars last year to Solana bots and terminals, at one percent a trade. We'll charge half.

## competition
It's an early category with good teams, and we bet the other way. Most offer a chat box or a fixed bot. We give you one line of English and the dials, hosted 24/7. No keys at all; your agent even pays for its model in USDC. Every fill is public. The strategy never is.

## gtm
That public record is the growth loop: every trade posts with its score and markets itself, and followers launch their own. We start with Solana memecoins, four hundred eighty-two billion dollars last year, then Polymarket and tokenized stocks.

## team
Why me? I lead product and growth at BlockRun, the leading x402 gateway. I founded Sorbet, a neobank moving five million a month. And I shipped Tocker in under four weeks.

## thanks
We're in private beta on Solana and Base. Tomorrow, twenty-one thousand more tokens launch. You won't have to watch one. [pause] Touch grass. Your agent is trading for you. Thank you.

## Longer version (~505 words, about 3:10)
Same beats, with the full product thesis, the Alpha Arena date, the itemized $200 stack, and the configurability list on competition. Use it if the slot is a full three minutes.

- **cover:** Twenty-one thousand. That's how many tokens launch on pump.fun every day. Almost all collapse. Bots and insiders buy before you've read the name. [pause] Retail isn't dumb. It's outgunned. I'm Rami, and Tocker is the infrastructure for safe agentic trading: anyone can launch a trading agent, with the edge and the guardrails built in.
- **problem:** Today, traders have no edge. In the ninety days to August, ninety-four percent of Solana memecoin wallets made no profit. I've lost more than I'd like to admit to rug pulls, honeypots and, honestly, my own emotions. And agents have no rails. Helius, Jupiter, Nansen, Grok, Claude, a server: about two hundred dollars a month, a fee on every swap, and twenty-plus services you wire and babysit yourself. [pause]
- **solution:** With Tocker, it takes one line of English. The edge: your agent buys data per call, and ten hard gates in code can veto any buy. The rails: wallet, data, inference and execution in one integration, hosted around the clock. Nothing to wire, nothing to babysit.
- **product:** Here's a sample run. You write the thesis: Solana memes smart money is accumulating, holders growing every hour, X mindshare rising. Your agent skips BONK and POPCAT, below the floor. WIF scores eighty-one and clears all ten gates: a hundred-dollar buy, exits enforced in code. [pause] I was emotional. An agent isn't. No FOMO, no panic, no revenge trades. It just follows your rules.
- **alpha:** Rules aren't edge. Neither is AI alone. Last October, six frontier models traded real money; four lost over thirty percent. So your agent buys answers over x402, the pay-per-call standard. Can I actually sell this, or is it a honeypot? About seven cents a token on Solana.
- **business:** Who pays? Traders already do. Last year, Solana traders paid nine hundred forty million dollars to bots and terminals. That's our lane. They charge one percent a trade. We'll charge half, which covers the data and the gates.
- **competition:** An early category, with good teams. We bet the other way. Most offer a chat box or a fixed bot. We give you one line of English and the dials: gates, data, model, sizing, exits. It runs hosted, 24/7. No RPC, no data keys, no AI key: your agent pays for its model in USDC. We publish every fill, never the strategy.
- **gtm:** That public record is the growth loop. Each trade posts with its entry score, like WIF's eighty-one, so every trade markets itself. Followers launch their own agents; next, creators share the fees. We start with Solana memecoins, four hundred eighty-two billion dollars traded last year. Then Polymarket, then tokenized stocks.
- **team:** Why me? I lead product and growth at BlockRun, the leading x402 gateway, so I know these rails. I founded Sorbet, a neobank that raised a million dollars and transacts five million a month. I worked on AI at Deloitte. And I shipped Tocker in under four weeks.
- **thanks:** It's in private beta on Solana and Base. Tomorrow, another twenty-one thousand tokens launch. You won't have to watch a single one. [pause] Touch grass. Your agent is trading for you. Thank you.

## What's labelled planned (keep it that way until shipped)
- 50 bps fee: beta charges $0.10 flat per fill (`src/lib/platform/fee.ts`).
- Inference paid per call in USDC: LIVE behind a per-account switch (main #28 'Pay-per-use thinking', #29 eleven models). An agent with no LLM key buys each model step from BlockRun in USDC from its own Solana wallet; spend caps and a kill switch (INFERENCE_USDC) on the admin page. Disclose the founder's BlockRun role (Q&A 6).
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
- $482B Solana memecoin volume in 2025 (down ~10% YoY): Solana's 2025 recap, via Bitget/ChainCatcher (https://www.bitget.com/news/detail/12560605132683) and Coinpedia/TradingView — self-reported by Solana; same recap as the $940M bot-fee figure (research/04)
- ~$21.5B Polymarket volume in 2025: Keyrock x Dune report via Odaily (https://www.odaily.news/en/post/5208620); Sacra concurs (research/13). Other counts: ~$22.5B (Dune dashboard), ~$10.5B (DefiLlama DEX-only)
- $12.4B Solana tokenized-stock DEX volume, 2026 to date: CryptoBriefing (https://cryptobriefing.com/solana-tokenized-stocks-12-billion-dex-volume/). No calendar-2025 figure exists (xStocks launched 30 Jun 2025); Q2 2026 alone was $5.8B (SolanaCompass)
- Earlier run-rate figures, kept for Q&A: $5.2B Solana memecoins in the week to 26 Aug 2026 (Blockworks); $10.8B Polymarket in June 2026 (Portals)
- 94% of 304,161 Solana memecoin wallets made no profit over the 90 days to Aug 2026; median −$120 (fomo × Dune wallet data; say "made no profit", not "lost money") — research/28. Replaces the 2024 "9 in 10 pump.fun traders" stat.
- Competition cells, traction and funding — research/26-competitors-deep (Oct 8 2026; supersedes 22 and 25)
- Competition evidence (research/26-competitors-deep/proof-points.md):
  - DXRG (Barton et al., arXiv 2609.05663, Sep 2026): 3,505 user-funded AI agents on a shared 12-token Base market, 21 days. Herding: 1,544 of 3,454 active vaults bought the same token (FEET) within one hour on Mar 1; "neither fleet shows a directional edge".
  - SolRugDetector (Chen, Zheng et al., arXiv 2603.24625, Mar 2026): 76,469 of 100,063 new Solana DEX tokens in H1 2025 (76%) were labelled rug pulls.
  - Luo et al. (WWW 2026, arXiv 2601.08641): smart-money memecoin wallets averaged 14%; copiers about 3% after price impact.

- ~$200/mo lean stack for one agent (problem slide), list prices, Oct 2026: Helius Developer $49 · Jupiter Ultra $0/mo but 10 bps a swap (50 bps on tokens <24h old; Ultra is superseded by Swap V2) · Nansen Pro $69 (API credits extra) · Grok X search ~$20 (xAI X search ~$5 per 1k posts, ≈4k posts/mo assumed, plus Grok Fast tokens) · Claude API ~$40 (founder's estimate; cached prompts or a smaller model) · hosting $22 (Hetzner CX23 + managed Postgres) — research/27. A production-grade stack is ~$2.5k/mo. Gas and swap fees excluded.

## Likely Q&A
1. **Traction?** Honest answer: private beta, agents start on paper. Bring real numbers (beta agents, paper/live fills, % of candidate buys vetoed by gates).
2. **"50 bps vs $0.10 in code; Senpi charges 5 bps, Robinhood's agents are free."** Flat is the beta setting. 50 bps is in the band agents already charge: Fere AI takes 0.5% a trade, ClawPump's swap fee is 0.30–0.85%, and the bots take 1%. It's half the bots' fee, and it pays for the data, the gates and hosting. Senpi's 5 bps is on Hyperliquid perps, a different market. At $100 a trade the fee is 50¢, while data costs about 7–11¢ a token.
3. **Who pays for data? Unit economics?** Today the platform settles x402 calls; next, data bills to the agent's wallet and is shared per token across agents.
4. **Why "infrastructure" without a public API/SDK?** The gates and the per-fill score record are the product; next, we sell the pre-trade check over x402 to any Coinbase, Bankr or OpenClaw agent.
5. **What stops Nansen or GMGN adding gates?** Data is a commodity we buy from everyone (including Nansen); enforced gates plus a public, score-stamped record with private strategies is the loop.
6. **BlockRun conflict?** Disclose the founder's BlockRun role; any inference routing through it is at provider cost, and the user can always bring their own key.
7. **Bankr already pays x402 and sells USDC inference.** True, and we credit it: Bankr is wallet rails you command in chat. Tocker is the strategy agent on top, with gates that can veto a buy and a public fill record.
8. **ClawPump claims $225M+ volume and has x402 and USDC inference too.** Credit it: it's the best toolkit for agents that earn, with wallets, 130 MCP tools and gasless launches. Its rug check is an opt-in skill; ours is a veto in code before every buy. It helps agents earn; Tocker trades a person's strategy in public.
9. **"Private beta next to $2.6B of volume: why a Series A?"** Rivals' volume proves demand for agents that trade. None we found vetoes a buy on token-safety checks in code, and that is where retail loses money (research/02). Bring beta numbers: agents live, fills, and the share of candidate buys the gates vetoed.
10. **"Can I copy an agent?"** No, by design. Copying front-runs the leader and leaks the strategy. You follow an agent's public fills and launch your own; creator fee share is next.
11. **"USDC inference: ClawPump and Minara already have it."** So do we now: an agent with no key pays for its own model steps in USDC (pay-per-use, eleven models, switched on per account). It's table stakes, not the edge; the edge is data, safety and the public record.
12. **"DXRG also says no information source gave an edge, so why buy data?"** It tested in-house context and research sub-agents, not paid on-chain feeds, in a deliberately hostile market (a 2.3% fee per swap, 12 tokens). Its point is that agents on one feed herd: 1,544 piled into one token within an hour. The same paper finds that discipline lives in the tool, not the prompt. That is the design: the agent picks its own data, and gates and exits live in code.
13. **"76% rugs: whose number?"** SolRugDetector (arXiv, Mar 2026) labelled 76,469 of 100,063 tokens launched on Orca, Raydium and Meteora in H1 2025. Each study defines rugs differently, so don't add it to Solidus's 98.6% (liquidity collapse) or call either "scams".
14. **"Can the owner switch gates off?"** Some, yes: 7 of the 10 are on by default and owner-configurable (src/lib/agent/config.ts). Mint, freeze, liquidity, holders, age and top-10 also block when the data is unknown; honeypot, can't-sell and tax pass when it's missing. Don't say "unknown means no" for all ten.
15. **"You have a leaderboard too."** Yes, ranked by PnL with the score at entry. The difference is no copy trading and a private strategy, not the absence of ranking.

16. **"No API keys?"** None. Tocker holds the RPC, swap, data and X access, and an agent with no AI key pays for its model per step in USDC (BlockRun, from the agent's own wallet). Pay-per-use is switched on per account during the beta, so say "no keys needed", and know who has it on.
17. **"More configurable than whom?"** Concretely: strategy, score floor, liquidity/holder/age/tax thresholds, blocklist, up to 12 paid data sources, model, sizing (fixed $, % equity, volatility), exits, auto vs approve. Fere AI's catalogue agents let you tune only size, leverage, stop and take-profit; Senpi, Minara and Ask Gina also take plain-English strategies, so don't claim "the only".

## Know the field (keep off the slide)
- Senpi's public GitHub has a "volume generation engine" built for $5M a day of BTC round-trips (Apr 2026). It is unclear whether it ran, so treat its $411M as possibly inflated. Its Agents Arena was retired Jul–Aug 2026.
- Minara's 30-day Hyperliquid volume fell from ~$449M (about June) to ~$35M (about August). Some of it probably moved to Lighter, which DefiLlama counts only from Sep 8.
- Fere AI rebuilt itself on Oct 6, 2026 as a catalogue of fixed-strategy agents. Plain-English strategies and the chat agent are gone.
- HeyElsa's ELSA token fell ~90% from its January high; ~46% of wallets in one airdrop campaign had no on-chain activity.
- Ask Gina publishes no traction, and its backers are self-reported.
- All six lean on points, tokens or NFTs for growth: Senpi points, Minara Sparks, HeyElsa's ELSA, ClawPump's CLAW, Fere's $MONK (2025), Gina's Genesis NFT. Tocker's growth loop is the public fill feed.
- Traction for the record: Minara $2.63B and Senpi $411M all-time perps volume (DefiLlama); ClawPump $225M+ (self-reported); HeyElsa 945K+ wallets (self-reported); Fere 7,000+ daily users (self-reported).
