# 19 — Agentic-trading startups: a deeper pass for the Series A competition slide (as of 2026-10-07)

**Scope.** This covers startups only. Robinhood, Binance, Coinbase, Bitget and Kraken are covered in note 16. It builds on notes 15, 16 and 17 and does not repeat what they established.

**Method.** WebSearch in extended mode, about 30 queries. WebFetch could not resolve arxiv.org or the product sites, so nearly every fact here comes from a search-result extract and is tagged **(s)**. **?** marks a claim that is conflicting or vendor-only. Check every number against its primary source before it goes in the deck.

---

## TL;DR

- **New since notes 16 and 17:**
  - **DXRG / DX Terminal Pro.** 3,505 user-funded LLM agents traded Base memecoins for 21 days, with about $20M of volume. DXRG then published two arXiv papers showing the agents had *no directional edge* and that "capital-agent reliability is an operating-layer property, not a model-only property." That is third-party evidence for Tocker's thesis that code should hold the veto and enforce the exits.
  - **GIM.** $20M Series A for multi-agent trading moving into live execution.
  - **Horizon Trade.** $2M pre-seed for plain-English strategy → backtest → auto-deploy, with 23k on the waitlist.
  - **Elastics.** $2M pre-seed for prediction-market agents.
  - **Nansen.** Still has fully autonomous trading on a "trust ladder" rather than shipping it.
- **No new rounds** in 2026 for Senpi, Bankr, Minara, HeyElsa, Almanak, Giza, Ask Gina or Wallet V. The only 2026 raise among the named consumer agents is Fere AI ($1.3M, April). **The money in this niche is small, seed-stage and still unconsolidated.**
- **Category stat for the slide.** Binance Research, citing Silicon Valley Bank data: **in 2025, 40¢ of every venture dollar invested in crypto companies went to companies also building AI, up from 18¢ in 2024** ([CoinDesk](https://www.coindesk.com/business/2026/04/18/ai-is-increasingly-eating-into-vc-fundings-and-here-is-how-crypto-firms-are-adapting) (s)). Supporting points:
  - Haun Ventures' $1B raise (May 2026) names "the agentic economy" as one of three priorities ([Decrypt](https://decrypt.co/366728/haun-ventures-raises-1-billion-fund-intersection-crypto-tech-ai-agents) (s)).
  - Base Batches 004 puts $100k each into 10 pre-seed teams building "AI agents, trading, payments" ([Decrypt](https://decrypt.co/375952/coinbase-base-ai-agents-startup-accelerator) (s)).
  - On Binance AI Pro, 45.7% of one day's activity was triggered by the system rather than users ([ANI/Binance Research](https://aninews.in/news/business/binance-research-ai-captures-80-of-q1-venture-funding-as-crypto-emerges-as-an-early-execution-layer20260424135202/) (s)).
- **Our own tally.** The rounds named below add up to about **$113M disclosed, across 13 agentic-trading startups, from mid-2025 to now**. No single startup has raised more than $22M. This is a hand count, not a published statistic. Label it "Tocker analysis."

---

## 1. Entrants and rounds missed by notes 16 and 17

| Company | What it is | Money · date | Traction | Relevance to Tocker | Source |
|---|---|---|---|---|---|
| **DXRG — DX Terminal Pro** | An "Onchain Agentic Market" on Base. Owners fund a vault, write a natural-language strategy and set 5 behavioral sliders. The agent trades memecoins inside a sealed market, and **owners cannot trade directly**. Since June 2026, DXAP has run user-created agents on Hyperliquid perps (mostly paper accounts) | No VC round found. Entry required an NFT | **3,505 user-funded agents, 5,000+ ETH deployed, ~$20M volume, 7.5M invocations, 99.9% settlement success** for policy-valid transactions. The 21-day run started Feb 24 2026. The Feb 27 press release said 1,500 traders and $6.1M, an earlier snapshot | **Closest in form to Tocker** (memecoins on Base, NL strategy, agent wallet), but it was a one-off game rather than a running product. Its research is the strongest outside validation of "gates and exits in code" | [PR Newswire](https://www.prnewswire.com/news-releases/dxrgai-announces-1-500-traders-just-handed-6-1m-to-ai-agents-to-trade-for-them-on-dx-terminal-pro-302698906.html) (s) · [arXiv 2604.26091](https://arxiv.org/abs/2604.26091) (s) · [DXRG blog](https://www.dxrg.ai/blogs/dx-terminal-pro) (s) |
| **GIM (Grace Investment Machine)** | "Visionary Machine," a 7-layer multi-agent capital-markets trading system. Its CogAlpha paper was accepted at ACL 2026 | **$20M Series A**, co-led by Hony Capital and an unnamed US VC, with IDG. Jul 9 2026. Third round in its first year | Pre-live: the money is for "live validation" | Institutional and multi-asset, not consumer on-chain. It shows that agentic trading attracts Series A money | [Morningstar/PRN](https://www.morningstar.com/news/pr-newswire/20260709cn01146/gim-raises-us20-million-series-a-as-agentic-investing-enters-live-execution) (s) · [FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/grace-investment-machine-20m-series-a) (s) |
| **Horizon Trade** | Describe an idea in plain language; it generates the code, backtests against years of data, checks risk, then deploys to trading platforms | **$2M pre-seed** from Entrée Capital, Jul 2026 | 23k+ waitlist; pre-launch | The same plain-English → agent pitch aimed at TradFi retail. No on-chain or token-safety angle | [Calcalist](https://www.calcalistech.com/ctechnews/article/r10d088vgx) (s) |
| **Elastics** (Warsaw) | An "AI-native OS for prediction markets," giving retail quant tools | **$2M (€1.7M) pre-seed** led by Frst, with ElevenLabs co-founders as angels, May 2026 | n/v | Competes for Tocker's planned Polymarket expansion | [Fintech.global](https://fintech.global/2026/05/06/elastics-raises-2m-pre-seed-for-ai-prediction-market-agents/) (s) · [EU-Startups](https://www.eu-startups.com/2026/05/warsaw-based-elastics-raises-e1-7-million-to-build-ai-agents-for-prediction-markets/) (s) |
| Nava | Escrow plus "Arbiter" that verifies agent transactions, with on-chain reasoning for each accept or reject | **$8.3M seed**, Polychain and Archetype, Apr 2026 | n/v | A safety rail (intent verification), not a trading app. Already in note 17 layer 6c; the amount is confirmed here | [Fortune](https://fortune.com/2026/04/14/nava-seed-funding-ai-financial-agents/) (s) |
| Nof1 | Alpha Arena benchmark plus its own finance models | **$15M**, co-led by SUI Group and Karatage, May 15 2026 | A consumer "coding agents for markets" product is still *roadmap* (Sep 28 update) | Demand proof and a future entrant | [SaaS News](https://www.thesaasnews.com/news/nof1-raises-15m-in-funding/) (s) · [CoinDesk](https://www.coindesk.com/tech/2026/05/15/wall-street-is-starting-to-notice-one-of-crypto-s-smartest-ai-bets) (s) |
| Virtuals on Solana (EconomyOS) | Agent creation with an on-chain identity and an agent-controlled wallet; agents can raise capital, trade and share earnings | Token-funded | The Motley Fool says most launchpad agents traded crypto, "nearly all of which experienced only limited success." Reported aGDP is ~$479M, a vendor figure denominated in VIRTUAL ? | An agent-launch/speculation venue, not a strategy product for users | [Nasdaq/Fool](https://www.nasdaq.com/articles/new-ai-agent-platform-could-send-solanas-price-higher-september-and-beyond) (s) · [bex.co](https://bex.co/blog/2026/04/21/agdp-agent-gdp-virtuals-protocol-ai-blockchain-valuation-primitive-tvl-displacement) (s, promotional) |

**Searched, nothing found:**
- an x402-native memecoin trading agent shipped as a product (only tutorials, e.g. [MadeOnSol](https://madeonsol.com/blog/solana-ai-agents) (s));
- a 2026 VC round for a Solana or Hyperliquid AI-trading-agent app. Hypernova ($3M, Lemniscap), Trasia ($1.75M, Multicoin) and Imperial ($1.5M, Foundation) are perp venues, not agents ([The Block](https://www.theblock.co/news/deals/2026-05-28-hyperliquid-prop-trading-platform-hypernova-crypto-funding-402923) (s), [Dealroom](https://dealroom.co/news/160410-imperial-raises-1-5m-seed-to-build-solana-perps-trading-stack/) (s));
- any 2026 launch of Donut ($22M raised, last news Nov 2025 ([Defiant](https://thedefiant.io/news/press-releases/donut-raises-22-million-in-6-months-announces-the-worlds-first-agentic-crypto-browser-built-for-traders) (s))).

---

## 2. Refreshed key facts (named set)

| Company | Latest funding (verified) | What actually ships (Oct 2026) | Best traction number | Change vs note 16 | Source |
|---|---|---|---|---|---|
| **Senpi** | $4.5M seed led by Lemniscap, with Coinbase Ventures' Base Ecosystem Fund, SuperLayer and Auros. Sep 2025; Tracxn says $4M. **No 2026 round** | Personal Hyperliquid agents (perps across crypto, equities, commodities), 80+ open-source strategies, two-phase trailing-stop exits; mobile and Telegram. Points program (2 per $1, Feb 1 to Sep 30 2026) → airdrop speculation | ">$100M volume" (Feb 2026 PR); **$30M+ notional in its public Agents Arena**; 10K+ Play Store downloads | Volume is points-incentivized. Treat it as subsidized | [Defiant PR](https://thedefiant.io/news/press-releases/senpi-launches-the-first-personal-trading-agents-for-hyperliquid) (s) · [GitHub](https://github.com/Senpi-ai/senpi-skills) (s) · [Points](https://senpi.ai/points) (s) |
| **Bankr** | No VC round found. Its own year-1 recap says "small investment from Coinbase Ventures, small Polygon grant, own revenue"; BNKR token | Chat-to-trade on X/Farcaster plus **x402 Cloud** (Apr 2 2026: deploy paid endpoints, 5% fee, USDC on Base), an LLM gateway and a CLI | 3M+ messages; **$7M+ AUM in Bankr wallets** (year-1 recap) | Moving toward x402 infrastructure, not strategy agents | [Benzinga](https://www.benzinga.com/pressreleases/26/04/51637575/bankr-launches-x402-cloud-on-402-day-as-x402-protocol-joins-the-linux-foundation) (s) · [Docs](https://docs.bankr.bot/x402-cloud/overview/) (s) |
| **Fere AI** | **$1.3M led by Ethereal Ventures**, with Galaxy Vision Hill and Kosmos. Apr 23 2026 | A 24/7 self-improving agent with its own wallet; ETH, SOL, Base, Arbitrum, BNB and Polymarket; "full execution audit" of why it traded | **7,000+ daily users; 10M+ "autonomous actions"** (vendor; "actions" ≠ trades). #2 on Product Hunt, May 17 | Unchanged. The closest consumer analogue on Solana + Base | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html) (s) · [Product Hunt](https://www.producthunt.com/products/fere-ai) (s) |
| **Nansen AI** | Nansen is a well-funded incumbent; no new round found | Chat trading on Solana + Base (Jan 21 2026) and Hyperliquid perps (Jun 9), embedded Privy wallet, routed via Jupiter, OKX and LI.FI. **The user confirms each trade.** Full autonomy is gated by the CEO's "trust ladder" | **$500M+ through its trading feature** (CEO claim, unverified); 500M+ labeled wallets | Biggest threat. Owns data and distribution. Its autonomy target was "Q4" of 2025 and has still not shipped | [The Block](https://www.theblock.co/post/409914/nansen-ceo-bets-on-ai-agents-to-overtake-human-traders-within-two-years) (s) · [Cointelegraph](https://cointelegraph.com/news/nansen-ai-agent-crypto-traders-autonomous-trading-q4) (s) · [CryptoTimes](https://www.cryptotimes.io/2026/02/12/exclusive-interview-nansens-ceo-alex-on-vibe-coding-agentic-trading-and-the-trust-ladder/) (s) |
| **Ask Gina** | Prelude and Coinbase Ventures; amount and date undisclosed. No 2026 round | Chat concierge plus "Recipes" (scheduled code); Polymarket (Polygon USDC), Hyperliquid, 12+ chains; Predictions MCP; 3M free credits a month | **No user or volume figures published.** A third-party listing flags limited track record and no public audit | Unchanged (see note 15) | [Docs](https://docs.askgina.ai/predictions-mcp/introduction) (s) · [Polymart](https://polymart.app/ask-gina) (s) |
| **Minara** | Circle Ventures and SeaX; early-stage VC Aug 2025, undisclosed (PitchBook). No 2026 round | "Personal AI CFO" with chat-to-trade plus **Autopilot**: rules-based perps with mandatory TP/SL | **$2.63B cumulative perps volume** (DefiLlama, per note 16) | Unchanged | [PitchBook](https://pitchbook.com/profiles/company/919676-44) (s) · [DefiLlama](https://defillama.com/protocol/minara-ai-perps) (note 16) |
| **HeyElsa** | $3M pre-seed + seed led by M31, with Coinbase Ventures' Base Ecosystem Fund. Jun 2025. No 2026 round | Chat-to-execute DeFi; ELSA token (TGE planned Jan 2026, not confirmed); 2026 developer tools (x402 micropayment portfolio tools, agent-builder CLI) | **$300M+ on-chain volume by end-2025** (vendor) | Drifting toward developer tooling | [Blog](https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/) (s) · [KuCoin](https://www.kucoin.com/news/flash/heyelsa-ai-agent-protocol-to-conduct-tge-in-january-2026) (s) |
| **Wallet V** | No round. An incubation project of Virgo Group (backers include Draper Dragon and OKX Ventures) | Self-custody wallet; users configure agents with any LLM on Hyperliquid and Aster perps | **688 agents; 42% had PnL ≥ 0; peak ROI per model −30% to +307%** (Jun 15 2026 benchmark) | Unchanged. Useful as evidence that most LLM agents lose | [Bitcoin.com PR](https://news.bitcoin.com/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster/) (s) |
| **Almanak** | ~$8.45M Aug 2025 (Tracxn: Series A; Dealroom: $10.1M total). No 2026 round | "AI swarm" of 18 agents for DeFi quant and yield vaults | **DefiLlama TVL ≈ $446K** (Oct 2026), vs the old "$25M" figure, which was a cap | Downgrade: effectively off the slide | [DefiLlama](https://defillama.com/protocol/almanak) (s) · [Tracxn](https://tracxn.com/d/companies/almanak/__Iun4gDoeUByryEakTYAVcPxD-Z4LFTqCJRu1i3IyUmk) (s) |
| **Giza** | $8.2M over 2 rounds (Tracxn); seed $2.2M May 2025 (PitchBook). No 2026 round | ARMA and Pulse retired; one "Giza Agent" launched Feb 26 2026; legacy funds returned to users by Mar 26 | "$1.5B moved" (vendor). No verifiable on-chain AUA for the new agent (OwnYourMind) | Yield, not trading. Off the slide | [Crypto Briefing](https://cryptobriefing.com/giza-tech-returns-arma-pulse-funds/) (s) · [OwnYourMind](https://ownyourmind.ai/projects/giza/) (s) |
| **Virtuals** | Token-funded | Agent launchpad; ACP and Revenue Network (Feb 2026); Solana EconomyOS (Aug 24 2026) | aGDP ~$479M (vendor ?); cumulative revenue ~$39.5M ? | A speculative agent-token venue, not a strategy product | see §1 |

---

## 3. Category-level framing (why now / validation)

Use **one** of these on the slide. They are ranked by how defensible they are.

1. **"40¢ of every crypto VC dollar in 2025 went to companies also building AI, up from 18¢ in 2024."** Binance Research citing SVB ([CoinDesk](https://www.coindesk.com/business/2026/04/18/ai-is-increasingly-eating-into-vc-fundings-and-here-is-how-crypto-firms-are-adapting) (s), [PYMNTS](https://www.pymnts.com/news/investment-tracker/2026/venture-capital-gravitates-to-crypto-ai-combo-projects/) (s)). This is the cleanest and most citable. Caveat: it measures crypto×AI broadly, not trading agents.
2. **Capital is forming around the thesis.** Haun's $1B (agentic economy is one of its three priorities), Base Batches 004 (AI agents + trading), Coinbase Ventures listing "onchain AI agents" as a focus ([f4.fund](https://f4.fund/firms/coinbase-ventures) (s)).
3. **Tocker analysis: about $113M disclosed into 13 agentic-trading startups since mid-2025, with the largest single round $22M.** The rounds counted: Donut 22, GIM 20, Nof1 15, Surf 15, Almanak 8.5, Nava 8.3, Giza 8.2, Senpi 4.5, Velvet 3.7, HeyElsa 3, Horizon 2, Elastics 2, Fere 1.3. Framed as "hot, but no one has broken out on-chain." Do not present it as a third-party statistic.
4. Demand-side figures, in case the slide needs one (all from note 16): Robinhood has 150k+ agentic accounts; Bitget has 1M+ users who have completed AI trades; on Binance AI Pro, 45.7% of one day's activity was system-triggered.

**Not usable:** the "AI agent funding" trackers (e.g. $6.1B in 2025, $6.32B in Q3 2026) are mostly enterprise agents, have unclear methodology and do not break out crypto ([aifunding.me](https://aifunding.me/ai-agent-funding) (s), [gravity.fast](https://gravity.fast/blog/ai-agent-funding-tracker-q3-2026/) (s)). DefiLlama's "$516M to AI crypto projects in 8 months of 2025" counts token projects ([Yahoo](https://finance.yahoo.com/news/ai-crypto-projects-raise-516m-120723470.html) (s)).

---

## 4. The honest narrative

**What the best-funded startups share:**
- **The market they trade.** Senpi, Minara, Wallet V and Cod3x are Hyperliquid perps only. Nansen trades on-chain spot but keeps a human click on every trade. Fere, Gina, Bankr and HeyElsa are chat-first, so the model or the user's click decides.
- **No hard veto in code before a buy on a brand-new token.** Their safety is about exits (Senpi's trailing-stop exits, Minara's TP/SL) or wallet spend caps. None of them refuses a honeypot or insider-bundled launch *in code*.
- **Proprietary or single-source data.** Nansen sells its own data. Nobody's agent buys from many vendors per call over x402, though Bankr and HeyElsa *sell* x402 endpoints.
- **Public records that are arenas or benchmarks** (Senpi Arena, Wallet V, DX Terminal, Nof1), not a per-agent verified record that a follower can subscribe to while the strategy stays private.

**Outside evidence that this matters.** DXRG ran the largest real-money LLM-agent experiment on Base memecoins: 3,505 agents and about $20M of volume. It concluded that reliability is "an operating-layer property, not a model-only property." Its harness changes cut fabricated sell rules from 57% to 3%, and in its follow-up paper neither fleet showed a directional edge ([arXiv 2604.26091](https://arxiv.org/abs/2604.26091) (s), [arXiv 2609.05663](https://arxiv.org/abs/2609.05663) (s)). Wallet V's benchmark found that 58% of LLM agents lost money. **The edge is in the scaffolding, meaning gates, data and exits in code, not in the model.** That is Tocker's design.

**Where they beat Tocker (say it before a VC does):**
- They all have live traction (Senpi >$100M volume, Minara $2.63B volume, Fere 7k DAU, Nansen $500M+). Tocker is in private beta with none.
- Perps on Hyperliquid have more agent liquidity and less rug risk than memecoins.
- Nansen owns the data Tocker rents, and runs on the same chains, the same Privy wallet stack and the same routers. If it ships autonomy plus gates, it is the most direct threat.
- Tokens and points (Senpi, Bankr, HeyElsa, Virtuals) buy distribution that Tocker does not have.

**One-sentence narrative (slide line):**
> "The well-funded agent apps either trade perps or keep a human on the button. Tocker is the only one where an autonomous agent trades the open on-chain market behind code-enforced token gates, buys its own data per call, and earns a public, verified record while its strategy stays private."

---

## 5. Recommended slide set (startups only; pair with Robinhood and Nansen from note 16)

| # | Company | One verified fact | Source |
|---|---|---|---|
| 1 | **Nansen AI** | Trading live on Solana + Base since Jan 21 2026. The user still confirms each trade; autonomy is waiting on a "trust ladder" | [The Block](https://www.theblock.co/post/386116/nansen-rolls-out-integrated-ai-trading-solana-base) (s) |
| 2 | **Senpi** | $4.5M seed led by Lemniscap with Coinbase Ventures' Base Ecosystem Fund; Hyperliquid-perps agents, $30M+ notional in Agents Arena | [Defiant](https://thedefiant.io/news/press-releases/senpi-launches-the-first-personal-trading-agents-for-hyperliquid) (s) |
| 3 | **Fere AI** | $1.3M led by Ethereal Ventures (Apr 2026); 7,000+ daily users (vendor) | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html) (s) |
| 4 | **Minara** | $2.63B cumulative Autopilot/perps volume (DefiLlama); Circle Ventures-backed | [DefiLlama](https://defillama.com/protocol/minara-ai-perps) (s) |
| 5 | **Bankr** | Launched x402 Cloud on Apr 2 2026: x402 rails plus chat trading; $7M+ AUM in its wallets | [Benzinga](https://www.benzinga.com/pressreleases/26/04/51637575/bankr-launches-x402-cloud-on-402-day-as-x402-protocol-joins-the-linux-foundation) (s) |
| 6 | **DX Terminal Pro (DXRG)** *or* **Ask Gina** | DXRG: 3,505 user-funded agents, ~$20M of volume on Base memecoins in 21 days, and its own paper found no directional edge. Gina: Coinbase Ventures-backed and live on Polymarket (Tocker's next market) | [arXiv](https://arxiv.org/abs/2604.26091) (s) · [Docs](https://docs.askgina.ai/predictions-mcp/introduction) (s) |

Dropped from the slide: Almanak (~$446K TVL), Giza (yield; legacy agents retired), Wallet V (benchmark only), HeyElsa (moving to dev tooling), Virtuals (speculative agent-token venue). Note them in a footnote.
