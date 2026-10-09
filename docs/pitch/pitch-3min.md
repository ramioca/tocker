# Tocker — 3-minute pitch (short deck, v6)

~501 words over 11 slides, about 3:05 at 160 wpm. Reworked on Oct 8, 2026 after a pitch roast that pushed on three things: "what's the edge?", "the competitors are well established", and "performance". [pause] marks a beat.
- **Edge** (new slide, replaces the x402 "alpha" slide): not prediction but not losing, in three steps. Refuse the rugs (gates in code), pick by your thesis (paid data, cents a token), exit by rule. Evidence: research/29, code: research/30.
- **Proof** slide dropped (Oct 9): the gate audit and house cohort stay in Q&A 20 as the plan, not on a slide.
- **Competition** (Oct 9): a capability matrix, "Six good teams. Each covers a piece." Six AI startups vs Tocker on runs 24/7 on its own, your rules and guardrails, rug veto in code, picks and pays for its data (x402), pays for its AI in USDC. Cells from research/26 §7 Autonomy and the README matrix. Don't say rivals aren't 24/7: ClawPump, Minara (autopilot), Senpi and Fere all run 24/7. The moat answer is Q&A 22.
- **Pitch #2 feedback (Oct 9): too much text.** Problem, solution, edge and business are now big numbers with one tagline each. GTM drops the feed image: two acquisition channels (a $5K autonomous trading competition as a bounty on Earn; paid ads and cold DMs on X) and the expansion markets. New traction slide after GTM: 11 users, ~$2 in fees per user per day (founder's figures; ~$60 a month, so ~$660 MRR today), 334 users × $60 = $20K MRR. The GTM test is a Superteam Earn bounty. Team headline: "Done it before. Scaled fintech to $5M/mo.", with a Superteam Germany member badge under the founder (founder-supplied logo).
- **Stale facts fixed:** the 0.5% fee is live (main #53), the beta is open, and the solution slide no longer says "sell-check data" (Solana has no sell test).
Earlier competition designs: docs/pitch/deck/competition-angles/.

## cover
Twenty-one thousand tokens launch on pump.fun every day. Almost all collapse. Bots and insiders buy first. [pause] Retail isn't dumb. It's outgunned. I'm Rami, and Tocker is the infrastructure for safe agentic trading.

## problem
Over ninety days this year, ninety-four percent of Solana memecoin wallets made no profit. I've lost more than I'd like to admit to rugs, honeypots and my own emotions. And building your own agent? About two hundred dollars a month, and twenty-plus services to wire and babysit.

## solution
Tocker fixes both with one line of English. Ten hard gates in code refuse unsafe buys, your agent buys data per call, and it runs hosted around the clock. Nothing to wire.

## product
Here's a sample run. The thesis: memes smart money is accumulating. Your agent finds WIF. It scores eighty-one, clears all ten gates, and buys a hundred dollars, exits in code. [pause] I was emotional. An agent isn't. It just follows your rules.

## edge
So what's the edge? Not prediction: nobody has shown an AI that picks memecoin winners. It starts with not losing. Our gates refuse the rugs, and the AI can't override them. Then your thesis picks from what's left, with premium data most traders never buy: smart money, holder growth, bullish signals, for a few cents a token. And exits run by rule: in a live contest, none of thirty AI agents got liquidated. Forty-three percent of humans did.

## business
Who pays? Traders already do: nine hundred forty million dollars last year to Solana bots and terminals, at one percent a trade. We charge half, and it's live.

## competition
It's a crowded space, and these are good teams, but each covers a piece. HeyElsa and Ask Gina are mostly chat with execution. Fere runs preset bots you can't configure. Senpi and Minara run perps strategies on bundled data, with no rug veto. Tocker does all five: it runs on its own 24/7, under your rules and guardrails, vetoes rugs in code, picks and pays for its data over x402, and pays for its own model in USDC.

## gtm
We get users three ways. Bounties on Superteam Earn find our first testers. Then the first fully autonomous trading competition, five thousand dollars in prizes, best strategy wins. And X: KOLs, ambassadors and direct outreach. We start with Solana memecoins, four hundred eighty-two billion dollars traded last year, then Polymarket and tokenized stocks.

## traction
Where are we? Eleven users in open beta, each paying about two dollars a day in fees, so about sixty dollars a month. At that rate, three hundred thirty-four users gets us to twenty thousand dollars of MRR. The competition and X are how we get there.

## team
Why me? I've done this before. I founded Sorbet, a neobank that raised a million dollars and scaled to five million a month in volume. Today I lead product and growth at BlockRun, the leading x402 gateway. I'm a Superteam Germany member, I worked on AI at Deloitte, and I shipped Tocker in under four weeks.

## thanks
We're in open beta on Solana and Base. Tomorrow, twenty-one thousand more tokens launch. You won't have to watch one. [pause] Touch grass. Your agent is trading for you. Thank you.

## What's labelled planned (keep it that way until shipped)
- 50 bps fee: LIVE on main as 0.5% of each fill (#53, `src/lib/platform/fee.ts`), in place of the flat $0.10. SPEC.md on this branch still says $0.10.
- Pay-per-use AI ships switched off (`src/lib/x402/inference-types.ts`); "no keys" holds only where it is switched on.
- An outcome-fitted score is "next": today the score's weights are hand-set and have never been checked against results.
- Inference paid per call in USDC: LIVE behind a per-account switch (main #28 'Pay-per-use thinking', #29 eleven models). An agent with no LLM key buys each model step from BlockRun in USDC from its own Solana wallet; spend caps and a kill switch (INFERENCE_USDC) on the admin page. Disclose the founder's BlockRun role (Q&A 6).
- Polymarket and tokenized stocks: "next".
- Product slide is an illustrative mock-up of a sample run.

## Sources for spoken and on-slide claims
- 9 in 10 pump.fun traders (2024): Dune wallet PnL via The Defiant — research/01
- ~21,000 tokens/day (2024–26 average): CoinGecko Research — research/03
- 20+ external services: Tocker's own integrations (registry.ts, SPEC.md)
- Alpha Arena: four of six frontier models lost 31–63% (Oct 2025) — research/06
- x402 Foundation backers: Linux Foundation (2026) — research/06
- Per-call prices: src/lib/data-sources/*.ts. Per token on Solana: ~1.6¢ on default sources (X search + Deepnets), ~6.6¢ with Nansen on, so "2–7¢"; Base ~0.6¢ default, ~10.6¢ with Nansen — research/30 §7
- Edge slide: 76% (SolRugDetector, arXiv 2603.24625, 100,063 tokens, H1 2025); 0 of 30 AI agents liquidated vs 43% of humans, AI −4.5% vs humans −32% (Aster Human vs AI Season 1, Chainwire, 14 Jan 2026; perps, not memecoins) — research/29 A1, A3
- Competition "also shipping" line: Bankr, Nansen AI (autonomy still in paper trading), Wayfinder, Almanak (TVL ≈$446K), Cod3x (47 users), Robinhood Agents (150K agentic accounts, listed assets only; Fortune, 29 Sep 2026) — research/29 B. Make no claims about them beyond "shipping trading agents".
- Terminals (for Q&A): $940M = Solana bots and terminals, 2025 (The Block, Jan 2026); $4M = Senpi seed (Sep 2025); terminal features from their docs — research/29 B. The 94% on the problem slide is fomo-app wallet data via Dune (research/28), which is why the note can say "fomo's own wallet data".
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
1. **Traction?** 11 users in open beta, ~$2 in fees per user per day (founder's figures), so ~$60 a month each and ~$660 MRR today. $20K MRR needs ~334 users at that rate. Expect "how many are active daily, and is it you?": know the split. Also: open beta since sign-up opened (main #19, #36); every agent starts on paper with $10k. Bring real numbers (agents, paper vs live fills, the share of candidates the gates refused), and never show the leaderboard as performance: it ranks paper and live agents together today.
2. **"Senpi charges 5 bps, Robinhood's agents are free."** Our 0.5% is live (main #53) and sits in the band agents already charge: Fere AI takes 0.5% a trade, ClawPump's swap fee is 0.30–0.85%, and the bots take 1%. Senpi's 5 bps is on Hyperliquid perps, a different market. At $100 a trade the fee is 50¢; data costs ~2¢ a token on default sources, ~7¢ with Nansen. Careful on margins: the agent buys data for every token it scores, not just the ones it buys, so at the $5 daily data cap the fee only covers data above roughly $1,000 of trades per owner per day (research/30 §8). Don't claim the fee "pays for the data" yet.
3. **Who pays for data? Unit economics?** Today the platform settles x402 calls; next, data bills to the agent's wallet and is shared per token across agents.
4. **Why "infrastructure" without a public API/SDK?** The gates and the per-fill score record are the product; next, we sell the pre-trade check over x402 to any Coinbase, Bankr or OpenClaw agent.
5. **"What stops GMGN from doing this?"** Nothing stops them trying, and they're the biggest threat: GMGN already has an Agent API (Mar 2026) and open-source skills that trade from plain-English prompts with nearly our gate set (Sep 2026). Three answers. (a) Their business is ~1% on every click; an agent that refuses most tokens cuts their volume. (b) Their skills are developer kits that ask the user to confirm; ours is an unattended consumer agent whose gates the AI can't override. (c) We prove outcomes in public first, and if they ship an agent mode, our gate and score sell as an x402 pre-trade check to their agents too.
6. **BlockRun conflict?** Disclose the founder's BlockRun role; any inference routing through it is at provider cost, and the user can always bring their own key.
7. **Bankr already pays x402 and sells USDC inference.** True, and we credit it: Bankr is wallet rails you command in chat. Tocker is the strategy agent on top, with gates that can veto a buy and a public fill record.
8. **ClawPump claims $225M+ volume and has x402 and USDC inference too.** Credit it: it's the best toolkit for agents that earn, with wallets, 130 MCP tools and gasless launches. Its rug check is an opt-in skill; ours is a veto in code before every buy. It helps agents earn; Tocker trades a person's strategy in public.
9. **"Open beta next to $2.6B of volume: why a Series A?"** Rivals' volume proves demand for agents that trade. None of the AI startups vetoes a buy on token-safety checks in code by default; terminals do have checks (Banana Gun simulates a sell before every buy), but a human under FOMO can switch them off ("Degen mode"). Bring beta numbers: agents live, fills, and the share of candidates the gates refused.
10. **"Can I copy an agent?"** No, by design. Copying front-runs the leader and leaks the strategy. You follow an agent's public fills and launch your own; creator fee share is next.
11. **"USDC inference: ClawPump and Minara already have it."** So do we now: an agent with no key pays for its own model steps in USDC (pay-per-use, eleven models, switched on per account). It's table stakes, not the edge; the edge is data, safety and the public record.
12. **"DXRG also says no information source gave an edge, so why buy data?"** It tested in-house context and research sub-agents, not paid on-chain feeds, in a deliberately hostile market (a 2.3% fee per swap, 12 tokens). Its point is that agents on one feed herd: 1,544 piled into one token within an hour. The same paper finds that discipline lives in the tool, not the prompt. That is the design: the agent picks its own data, and gates and exits live in code.
13. **"76% rugs: whose number?"** SolRugDetector (arXiv, Mar 2026) labelled 76,469 of 100,063 tokens launched on Orca, Raydium and Meteora in H1 2025. Each study defines rugs differently, so don't add it to Solidus's 98.6% (liquidity collapse) or call either "scams".
14. **"Can the owner switch gates off?"** Some, yes: 7 of the 10 are on by default and owner-configurable (src/lib/agent/config.ts); honeypot and can't-sell are always on. Mint, freeze, liquidity, holders, age and top-10 also block when the data is unknown; honeypot, can't-sell and tax pass when it's missing. On Solana the sell test doesn't run (it's Base-only) and tax is assumed 0%. Don't say "unknown means no" for all ten. What's true: the AI can't loosen any gate.
15. **"You have a leaderboard too."** Yes, ranked by PnL with the score at entry. The difference is no copy trading and a private strategy, not the absence of ranking.

16. **"No API keys?"** None. Tocker holds the RPC, swap, data and X access, and an agent with no AI key pays for its model per step in USDC (BlockRun, from the agent's own wallet). Pay-per-use is switched on per account during the beta, so say "no keys needed", and know who has it on.
17. **"More configurable than whom?"** Concretely: strategy, score floor, liquidity/holder/age/tax thresholds, blocklist, up to 12 paid data sources, model, sizing (fixed $, % equity, volatility), exits, auto vs approve. Fere AI's catalogue agents let you tune only size, leverage, stop and take-profit; Senpi, Minara and Ask Gina also take plain-English strategies, so don't claim "the only".

18. **"What's the edge?"** Not prediction: nobody has shown an AI that picks memecoin winners after costs (copying smart money turns 14% into 3%; influencer calls are −6.5% after 30 days; ≥17% of pump.fun trades are wash trades). The edge is not losing, in three steps: refuse the rugs (76% of new Solana tokens), pick by your thesis with paid data, exit by rule (0 of 30 AI agents liquidated vs 43% of humans). Say "edge in the layer, not the model". Next: fit the score to outcomes across every agent's scored, bought and refused tokens, a dataset terminals don't have because they see trades, not decisions.
19. **"Aren't gates table stakes?"** Yes, the checks are: GMGN's open-source buy skill ships nearly the same list. What isn't: they run on every buy of an unattended agent, the AI can't override them, honeypot and can't-sell are always on, and every verdict is logged. Next gates go where rugs actually are: 79% are pump-and-dumps, so bundlers, snipers and dev selling; mint and freeze barely matter on pump.fun (research/29 A1).
20. **"Show me performance."** We don't have it yet, and we won't show a backtest or a best-agent screenshot. In 4 weeks: the gate audit (refused vs passed, share dead within 24h and 7d, against RugCheck alone and no filter, definitions published first). In 8 weeks: the house cohort, every agent shown net of fees, against gates-off, random entries with the same exits, and holding SOL. Claim fewer rugs and smaller drawdowns, not returns; four weeks of returns is noise.
21. **"Why not a backtest?"** Across 888 strategies, backtest Sharpe explained under 2.5% of live results (Wiecki et al., 2016), and the safety data we gate on (Jupiter, RugCheck, GoPlus) has no history, so only the gates could be replayed, not the agent.

22. **"What's your moat?"** Features get copied: gates, chat, wallets, execution are table stakes. What compounds: (1) outcome data, every token our agents score or refuse with its verdict and price (logged today in `token_score_history`), labelled with how it ended and used to tune the gates (next; terminals see trades, not the decision or the refusals); (2) a public record of every fill with its entry score, which can only be earned over time; (3) x402: one integration to every paid data source, and next, our gate and score sold per call to other agents, so rivals become customers. Be honest that (1) and (3) are next: today the score's weights are hand-set.

## Fix before claiming (product gaps, research/30)
- The prompt says the paid Deepnets check clears a gate; in code it never does (`prompts.ts` vs `tools.ts`).
- Honeypot passes when the data is missing; Solana has no sell test and no tax check.
- Paid data is bought even for tokens below the score floor, which drives the data cost.
- The leaderboard ranks paper and live agents together.

## Know the field (keep off the slide)
- Senpi's public GitHub has a "volume generation engine" built for $5M a day of BTC round-trips (Apr 2026). It is unclear whether it ran, so treat its $411M as possibly inflated. Its Agents Arena was retired Jul–Aug 2026.
- Minara's 30-day Hyperliquid volume fell from ~$449M (about June) to ~$35M (about August). Some of it probably moved to Lighter, which DefiLlama counts only from Sep 8.
- Fere AI rebuilt itself on Oct 6, 2026 as a catalogue of fixed-strategy agents. Plain-English strategies and the chat agent are gone.
- HeyElsa's ELSA token fell ~90% from its January high; ~46% of wallets in one airdrop campaign had no on-chain activity.
- Ask Gina publishes no traction, and its backers are self-reported.
- All six lean on points, tokens or NFTs for growth: Senpi points, Minara Sparks, HeyElsa's ELSA, ClawPump's CLAW, Fere's $MONK (2025), Gina's Genesis NFT. Tocker's growth loop is the public fill feed.
- Terminals (research/29 B): Axiom ≈$547M gross fees in 2025, no AI features. GMGN $145M fees over the trailing year, Agent API (Mar 2026), open-source plain-English trading skills (Sep 2026). fomo raised a $75M Series B at a $550M valuation (Jun 2026), 625K users, ~40% of terminal volume. Banana Gun simulates a sell before every buy and runs an anti-rug exit by default, both overridable in "Degen mode". BullX stopped trading on 1 Jun 2026.
- Traction for the record: Minara $2.63B and Senpi $411M all-time perps volume (DefiLlama); ClawPump $225M+ (self-reported); HeyElsa 945K+ wallets (self-reported); Fere 7,000+ daily users (self-reported).
