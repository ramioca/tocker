# 22 — Competition matrix, verified cell by cell (as of 2026-10-08)

**Scope.** This checks the draft matrix in the comp brief, one cell at a time. It covers Tocker plus 8 startups. It builds on notes 15, 16, 17, 19, 20 and 21.

**Method.**
- I ran about 30 WebSearch queries in extended mode.
- WebFetch and curl could not reach the product sites: parasol.so returned a DNS error, and the egress proxy answered 403 to CONNECT. **So every web-sourced cell is (s), from a search snippet only.** Check it on the live page before the deck ships.
- I checked Tocker's own cells against the code in this repo.

**Marks.** Y = live · P = partial (with a note) · N = next, not built · — = not found (not the same as "no").

**Columns.**
- **USDC inf.** The agent or user pays for LLM inference per call in USDC.
- **x402 alpha.** The agent *buys* premium data per call over x402. Selling x402 data does not count; it goes in a footnote instead.
- **Gates.** Token screening is enforced before a buy.
- **Social.** A public verified record, or following or copying other traders or agents.
- **Auto.** The agent trades without a click per trade.

## Verified matrix

| Row | Best at (≤6 words) | USDC inf. | x402 alpha | Gates | Social | Auto | Market | Fact |
|---|---|---|---|---|---|---|---|---|
| **Tocker** | Paid alpha + code gates, in public | N (BYO key) | Y (14 sources) | Y (10 hard gates) | Y (public fills, follow) | Y (opt-in; default asks) | Solana + Base tokens | Private beta, no traction |
| Parasol | Hands-off memecoin agents, rug-filtered | — | P (dev SDK pays) | Y (6-layer filter) | P (points leaderboard) | Y | Solana memecoins | Solana Foundation grant via Superteam UK; no VC |
| Bankr | Rails for self-sustaining agents | Y (LLM Gateway) | Y (wallet pays x402) | — | P (leaderboard, X posts) | Y (scheduled automations) | Base, Solana, 4 EVM; spot + perps | $7M+ held in Bankr wallets (self-reported) |
| Senpi | Hyperliquid agents, copy trading, Arena | — | — | P (signal score floors) | Y (copy + Arena) | Y | Hyperliquid perps | $4M seed led by Lemniscap (Sep 2025) |
| Nansen AI | Smart-money data, 500M+ labels | — | — ¹ | — | P (tracks smart money) | P (approve each trade) | Solana + Base spot; HL perps | $75M led by Accel at $750M (Dec 2021) |
| Fere AI | Self-improving 24/7 agent, Polymarket too | — | — | P (user entry/stop rules) | P (copies fomo traders) | Y | 5 chains + Polymarket | $1.3M seed led by Ethereal (Apr 2026) |
| Minara | Perps autopilot with forced TP/SL | — | — | P (forced TP/SL) | Y (copy wallets, strategy board) | Y (Autopilot) | HL/Lighter perps + spot | $2.6B cumulative perps volume (DefiLlama) |
| HeyElsa | Chat-to-execute DeFi on Base | — | — ¹ | — | P (volume arena) | P (limit orders) | Base + 15 chains | $3M led by M31 (Jun 2025) |
| Ask Gina | Chat Polymarket bets + scheduled Recipes | — | — | — | — | Y (Recipes) | Polymarket, HL, 12+ chains | Coinbase Ventures + Prelude (amount undisclosed) |

¹ Nansen and HeyElsa **sell** x402 data (Nansen $0.01–0.05 a call; HeyElsa's DeFi APIs). Their own agents do not buy it. Add a footnote if the slide needs to credit them.

## Sources per cell

### Tocker (code, this repo)
- **USDC inf. = N.** The models are BYO-key providers (`src/lib/agent/models.ts:8`). The key is decrypted per run (`src/lib/agent/run.ts:56-68`), and keys live in `/settings` (`SPEC.md:31`). I found no USDC or x402 inference path in `src/lib`.
- **x402 = Y.** There are 14 registry entries (`src/lib/data-sources/registry.ts:51-66`), including X search, Deepnets, Nansen, Plexa, SolEnrich, gate402 and Bazaar. `score_token` buys them per call (`src/lib/agent/tools.ts:337`).
  - **Caveat:** the *platform* wallet settles every x402 payment. "Sentiment and safety data is the platform's cost of goods" (`SPEC.md:170`). The agent's own wallet does not pay.
- **Gates = Y.** `hardGates()` has 10 checks: blocklist, mint, freeze, honeypot, cannot_sell, tax, liquidity, holders, age and top-10 (`src/lib/tokens/score.ts:260-321`). The buy is refused in `riskGuard` (`src/lib/trading/risk.ts:162`), and the score must also clear minScore (`risk.ts:181`).
- **Social = Y.** The global and following feed (`SPEC.md:25`) and follow (`SPEC.md:27`). Public trade receipts (`SPEC.md:166`). A leaderboard (`SPEC.md:235`). Copy-trading is deliberately out (`SPEC.md:243`).
- **Auto = Y.** The modes are `auto|approve` (`src/lib/agent/config.ts:72`). **The default is `approve`** (`config.ts:134`), and runs are every 15 minutes (`config.ts:135`).
- **Market.** Solana + Base (`SPEC.md:3`).

### Parasol
All Parasol sources are vendor-only.
- **x402 = P.** "ParasolDEX handles x402 payments so your AI agents can access paid APIs." This is a developer SDK that imports the `moltydex` package. I found no evidence that Parasol's hosted agents buy data. https://parasol.so/developers (s)
- **Gates = Y.** A "6-layer manipulation filter" runs before scoring. The pages list different checks. https://parasol.so/whitepaper (s) · https://parasol.so/vs/axiom (s)
- **Social = P.** The leaderboard ranks users by points, which come from trades, logins, referrals and quests. Copy trading is "Planned". https://parasol.so/leaderboard (s) · https://parasol.so/vs/axiom (s)
- **Auto = Y and Market.** Autonomous Solana memecoin agents, in paper or live mode, with a Turnkey MPC wallet. https://parasol.so/whitepaper (s)
- **Fact.** The SDK was funded by a Solana Foundation grant via Superteam UK, and I found no grantor announcement. The company self-reports $19K of volume in week one. https://parasol.so/blog (s) · https://parasol.so/blog/build-solana-trading-bot-no-code (s)

### Bankr
- **USDC inf. = Y.** The LLM Gateway serves Claude, GPT, Gemini and others, paid "with ETH, USDC, or token launch fees" and metered per request. https://bankr-support.support.site/article/llm-gateway (s) · https://www.valuethemarkets.com/cryptocurrency/news/bankrs-llm-gateway-revolutionizes-ai-payments-with-cryptocurrency (s)
- **x402 = Y.** `bankr x402 call <url>` and `x402 search`. The Bankr wallet pays without manual signing. https://docs.bankr.bot/cli/ (s) · https://docs.bankr.bot/x402-cloud/overview/ (s)
- **Social = P.** A Top-50 trader leaderboard, with a score that combines BNKR holdings, launches and PnL. Commands are public on X. https://bankr.bot/terminal/leaderboard (s)
- **Auto = Y.** Limit, stop, DCA, TWAP and "scheduled agent commands" fire with the user offline. https://bankr-support.support.site/article/automations (s)
- **Market.** Base, Solana, ETH, Arbitrum, Polygon and BNB, plus perps via Avantis. https://bankr-support.support.site/article/automations (s) · note 20
- **Fact.** 3M+ messages and $7M+ in wallets, from the Bankr year-1 recap. Funding was a "small" Coinbase Ventures cheque. https://www.benzinga.com/pressreleases/26/04/51637575/bankr-launches-x402-cloud-on-402-day-as-x402-protocol-joins-the-linux-foundation (s) · https://messari.io/project/bankr (s)

### Senpi
- **Gates = P.** The scanners' "hard gates run first" and set a minScore floor, but these screen perp signals on listed markets, not token safety. https://github.com/Senpi-ai/senpi-skills/pull/805 (s)
- **Social = Y.** One-tap copying of ranked traders, and a public Agents Arena. https://resources.senpi.ai/learn/what-is-senpi (s)
- **Auto = Y and Market.** Personal autonomous agents on Hyperliquid perps across crypto, equities and commodities. https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/ (s)
- **Fact.** A $4M seed, Sep 16 2025. Every database says $4M, and one newsletter says it was upsized to $4.4M. https://defillama.com/raises/lemniscap (s) · https://finder.techleap.nl/news/feed/senpi-raises-4m-for-crypto-wallet (s)

### Nansen AI
- **Social = P.** "Follow the Smart Money" watchlists and alerts. There is no copy button; copy-trading exists only as an API recipe. https://support.nansen.ai/hc/en-us/articles/25012095465369-Follow-The-Smart-Money (s) · https://docs.nansen.ai/getting-started/use-case-templates/complex-use-cases/use-case-4-copytrading-top-performing-wallets (s)
- **Auto = P.** The user confirms every trade. In July 2026 the CEO said autonomous agents are still held in backtesting and paper trading. https://www.theblock.co/post/386116/nansen-rolls-out-integrated-ai-trading-solana-base (s) · https://www.crowdfundinsider.com/2026/07/294283-ai-trading-agents-may-outperform-human-traders-soon-according-to-blockchain-industry-exec/ (s)
- **Market.** Solana + Base via Jupiter, OKX and LI.FI; Hyperliquid perps since June 2026. Same sources as Auto.
- **USDC inf. = —.** The agent runs on subscription AI credits. Whether its endpoint is payable over x402 is unconfirmed. https://docs.nansen.ai/getting-started/credits (s)
- **Fact.** $75M led by Accel at a $750M valuation, with a16z participating. a16z led the earlier $12M Series A. https://www.theblock.co/post/127747/data-startup-nansen-secures-fresh-funding-at-750-million-valuation (s)

### Fere AI
- **Gates = P.** User entry and exit rules, plus stop-loss controls. I found no contract-level token screening. https://www.producthunt.com/products/fere-ai (s)
- **Social = P.** "Copy-trades 30+ of the top fomo-leaderboard traders and KOLs." There is also a points leaderboard. https://www.fereai.xyz/ (s)
- **Auto = Y, Market and Fact.** A 24/7 agent with its own wallet; ETH, SOL, Base, Arbitrum, BNB and Polymarket; $1.3M led by Ethereal, Apr 23 2026. https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html (s)
- I could not re-find the "7,000+ daily users" figure this pass, so don't quote it.

### Minara
- **Gates = P.** Autopilot enforces TP/SL and preset risk limits. https://minara.ai/docs/trade/trading-autopilot (s, note 16)
- **Social = Y.** Copy Agents mirror chosen wallets. The strategy marketplace has track records and a "Leaderboard / Most Consistent" ranking. https://minara.ai/why-minara/wallet-tracking-and-copy-trade (s) · https://minara.ai/home (s)
- **Auto = Y.** "Runs without manual approval for each trade." Minara Harness, launched Sep 8–9 2026, trades 24/7 within user limits. https://minara.ai/doc/terms-of-use.pdf (s) · https://www.kucoin.com/news/flash/minara-ai-launches-new-financial-ai-agent-minara-harness-for-24-7-investment-research-and-trading (s)
- **Market.** Hyperliquid and Lighter perps, plus spot copy swaps. Same sources.
- **Fact.** $2.628B cumulative perp volume and $35M over 30 days. An earlier snapshot showed $2.404B. https://defillama.com/protocol/minara-ai-perps (s)

### HeyElsa
- **Social = P.** The weekly Base Trading Arena ranks the top 100 by *volume*, not PnL, on a public Dune dashboard. https://app.heyelsa.ai/base-trading-arena/terms-and-conditions (s)
- **Auto = P.** Limit orders trigger automatically, and auto-rebalancing needs the Elsa smart wallet. https://www.heyelsa.ai/ (s) · https://zerion.io/blog/guide-to-heyelsa-what-it-is-how-it-works-and-more/ (s)
- **x402 footnote.** HeyElsa *sells* pay-per-call DeFi APIs. https://x402.heyelsa.ai/ (s)
- **Market.** Base, and 15+ chains per the x402 site. Same sources.
- **Fact.** $3M led by M31, with Coinbase Ventures' Base Ecosystem Fund. Also $300M+ volume at the end of 2025 (vendor figure). https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/ (s)

### Ask Gina
- **Auto = Y.** Recipes run prompts on a schedule or on data events, and the homepage says "autonomous trading strategies." https://docs.askgina.ai/predictions-mcp/introduction (s) · https://askgina.ai/ (s)
- **Market.** Polymarket, Hyperliquid and 12+ chains. Same sources.
- **Social = —.** The only leaderboard found tracks Farcaster engagement, not trading.
- **Fact.** Backed by Prelude and Coinbase Ventures; the amount is undisclosed. The founder's earlier company, TokenAnalyst, was acquired by Coinbase. https://polymart.app/ask-gina (s) · https://www.sidshekhar.com/ (s)

## Changes from the draft

- **Tocker**
  - **Best at** was "All four". USDC inference is N, so that claim is false.
  - **Auto** gets the note "default asks".
  - **The differentiator "pays its own way" is wrong.** The platform wallet pays for data (`SPEC.md:170`), and inference uses the operator's own key.
  - **"The only…" is also false.** Bankr ships both USDC inference and x402 buying.
- **Parasol**
  - **x402** goes from — to P, for the dev SDK.
  - **Social** goes from — to P, for the points leaderboard.
- **Bankr**
  - **x402** was credited to x402 Cloud, which is *selling*. The Y now rests on the wallet paying via `x402 call`.
  - **Gates:** still none found.
  - **Social** note changes to "leaderboard".
  - **Auto** goes from P to Y, for scheduled agent commands.
- **Senpi**
  - **Gates** note changes from "exit rules" (not pre-buy) to "signal score floors".
  - **Social** adds copy trading.
  - **Fact** changes from $4.5M to $4M.
- **Nansen**
  - **x402** goes from P to —. It sells x402 data; it doesn't buy any.
  - **Social** goes from — to P, for smart-money tracking.
  - **Fact:** $500M is a CEO claim, so I replaced it with the round. Note 20 says the $75M round was "a16z-led"; it was led by Accel.
- **Fere**
  - **Social** goes from — to P, for copying fomo traders.
- **Minara**
  - **x402** goes from ? to —.
  - **Social** goes from P to Y, for copy wallets plus the strategy board.
- **HeyElsa**
  - **x402** goes from ? to —, with the seller footnote.
  - **Social** note changes to "volume arena".
- **Ask Gina**
  - **Auto** goes from P to Y, for Recipes, so it matches Bankr.

## Rows to drop

- **Ask Gina.** No traction, no round size, and a Polymarket concierge. It is the weakest row.
- **HeyElsa.** A volume-incentive token project drifting to developer tooling. An on-chain sample found 46% of 500 campaign wallets inactive (note 19 and the search above).
- **Keep Parasol, but label it "grant-funded, small".** It is the closest feature match, but every claim is self-reported.
