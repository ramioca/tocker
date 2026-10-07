# 20 — Consumer AI trading agents: the full map (as of 2026-10-07)

**Scope.** Every company or product I could find where an AI agent places trades for a retail user, either autonomously or after the user approves. Pure data and research tools, rule-only bots with no LLM agent, and developer-only SDKs are left out, except where an incumbent's rails matter; those are listed in §J and are not counted. Each product appears once, under its main segment. Where it also fits another segment, that is noted as "also: X".

**Method.** This builds on notes 15, 16, 17 and 19 and does not repeat their verification. I added about 45 extended-mode WebSearch queries. WebFetch failed with DNS errors on the sites I tried (finder.com, polycatalog.io), as it did in earlier notes. **So every fact in this note comes from a search-result extract and should be read as (s), whether or not the row says so.** **?** marks a figure that is conflicting or comes only from the vendor. **(p)** marks a fact I knew before this research and did not re-check here. "n/f" means not found.

**Status key.** Live · Beta (closed or invite-only) · Pre-launch · Stale (no 2026 activity found) · Dead/pivoted.

---

## Counts

| Segment | Counted | Of which live |
|---|---|---|
| A. On-chain spot / memecoin agents (Solana, Base, EVM) | 11 | 6 |
| B. Chat-to-trade / DeFAI concierge | 7 | 4 (+2 beta/early access) |
| C. Perps agents (Hyperliquid, Aster, Orderly, GMX) | 12 | 9 |
| D. Prediction-market agents (Polymarket, Kalshi, sports) | 7 | 4 |
| E. Copy, social and arena agent trading | 4 | 3 |
| F. Agent launchpads that trade | 2 | 2 |
| G. "AI hedge fund for retail" / TradFi agent apps (startups) | 7 | 4 |
| H. Incumbents: crypto exchanges ⚑ | 8 | 7 |
| I. Incumbents: brokers ⚑ | 7 | 6 |
| **Total counted** | **65** | |
| J. Wallet and agent rails (not counted) | 8 | |
| K. Dropped (dead, pivoted, advice-only, or no execution) | 21 | |

⚑ = incumbent.

---

## A. On-chain spot / memecoin agents (Tocker's lane)

| Name | What it does | Chains / venues | Status | Funding (amount · lead · date) | Traction (one number) | Source |
|---|---|---|---|---|---|---|
| **Nansen AI** | "Vibe trading": chat with an agent grounded in Nansen's data. The user approves each trade; autonomy is gated behind a "trust ladder" | Solana, Base (Jan 21 2026); Hyperliquid perps (Jun 2026). Routes via Jupiter, OKX DEX, LI.FI. Privy wallet | Live; autonomy not yet shipped | No new round. Historic $75M Series A led by a16z, Dec 2021 (p) | $500M+ traded through the feature (CEO claim ?) | [The Block](https://www.theblock.co/post/386116/nansen-rolls-out-integrated-ai-trading-solana-base) (s) |
| **Fere AI** | Self-improving agent with its own wallet that researches, enters, exits and monitors 24/7. Also: D | ETH, SOL, Base, Arbitrum, BNB, Polymarket | Live | $1.3M · Ethereal Ventures · Apr 23 2026 | 7,000+ daily users (vendor) | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html) (s) |
| **Donut** | "Agentic crypto browser": agents follow new tokens, trade, swap, bet and earn, with built-in risk screening | Multi-chain | Pre-launch? No 2026 launch found | $22M total: $7M pre-seed (Hongshan, BITKRAFT, Hack VC, May 2025) plus $15M seed (Nov 2025) | 160k waitlist | [Cointelegraph](https://cointelegraph.com/news/donut-7m-for-first-agentic-crypto-browser) (s), [Decrypt](https://decrypt.co/347204/ai-browsers-headed-crypto-donut-labs-22-million-build-first) (s) |
| **Velvet Capital** (Velvet Unicorn) | "DeFAI OS": a multi-agent system proposes transactions for the user to approve; autonomous 24/7 strategies from a prompt; 1,600+ Unicorn Skills | Base, ETH, BNB, Solana, Hyperliquid, Robinhood Chain and more | Live | $3.7M · YZi Labs · Jul 2025 | Claims 100k users and $200M volume, vs ~$5M TVL on DefiLlama ? | [Velvet blog](https://blog.velvet.capital/p/velvet-august-update-velvet-flash) (s) |
| **DX Terminal Pro** (DXRG) | Owners fund an agent with a natural-language strategy and sliders; the agent trades memecoins in a sealed market where owners cannot trade by hand. Also: C (DXAP on Hyperliquid, mostly paper) | Base (Uniswap v4) | 21-day event ended Mar 2026; "next chapter loading" | No VC round found; entry required an NFT | 3,505 agents, ~$20M volume | [PR Newswire](https://www.prnewswire.com/news-releases/dxrgai-announces-1-500-traders-just-handed-6-1m-to-ai-agents-to-trade-for-them-on-dx-terminal-pro-302698906.html) (s), [arXiv 2604.26091](https://arxiv.org/abs/2604.26091) (s) |
| **Parasol** | Autonomous Solana memecoin agents. A 6-layer rug filter, 8-dimension scoring, paper or live mode, Turnkey MPC non-custodial wallet; open-source Agent SDK and MCP server. **The closest feature match to Tocker** | Solana (Pump.fun, PumpSwap, Jupiter) | Live (small) | Solana Foundation grant via Superteam UK; no VC | Self-reported: $19k volume in week one | [parasol.so](https://parasol.so/whitepaper) (s) |
| **Slate** | "Vertical AI agent stack" that reads the user's alpha sources and autonomously executes on-chain flows from language commands | EVM? | ? (the careers page is ~1.5 years old) | Blockchain Capital-backed; amount n/f | n/f | [jobs.slate.ceo](https://jobs.slate.ceo/) (s) |
| **Glider** | Automated on-chain portfolios: fund with USDC, choose or copy a portfolio, auto-rebalance in a non-custodial smart wallet. **Automation, not an LLM agent.** Also: E | Base and other EVM | Live | $4M · a16z CSX (with Coinbase Ventures, Uniswap Ventures) · Apr 2025 | Fees 0.30% on automated trades (no usage figure) | [BusinessWire](https://www.businesswire.com/news/home/20250415391753/en/Glider-Raises-$4-Million-Strategic-Funding-Round-Led-by-a16z-CSX-to-Transform-Crypto-Portfolio-Management) (s) |
| SolBot | Personal AI agent that trades Solana memecoins to the user's strategy | Solana | Stale? A mobile app was due Q1 2026; not confirmed | n/f | n/f | [solbotai.org](https://solbotai.org/) (s) |
| AgentDesk | Solana memecoin agents that log trades on-chain | Solana | Fringe | n/f | n/f | [agentdesk.fun](https://agentdesk.fun/) (s, note 16) |
| Milo | Solana auto-trader | Solana | Closed beta | n/f | n/f | note 16 (s) |

## B. Chat-to-trade / DeFAI concierge (the user instructs, the agent executes; some automation)

| Name | What it does | Chains / venues | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Bankr** | Chat-to-trade on X and Farcaster, with limit, stop, DCA and TWAP orders, token launches, an LLM Gateway and x402 Cloud. Also: F | Base, Solana, ETH, Arbitrum, Polygon, BNB | Live | "Small" Coinbase Ventures investment plus a Polygon grant; BNKR token | $7M+ AUM in Bankr wallets (year-1 recap) | [Benzinga](https://www.benzinga.com/pressreleases/26/04/51637575/bankr-launches-x402-cloud-on-402-day-as-x402-protocol-joins-the-linux-foundation) (s) |
| **Ask Gina** (TYBB Labs) | Chat concierge plus "Recipes", scheduled code that runs 24/7. Also: D | Polymarket, Hyperliquid, 12+ chains; Privy | Live | Prelude, Coinbase Ventures; amount n/f | None published | [docs](https://docs.askgina.ai/predictions-mcp/introduction) (s), note 15 |
| **HeyElsa** | Chat-to-execute DeFi copilot; weekly Base trading arena; drifting toward developer tooling | Base and multi-chain | Live | $3M · M31 (with Coinbase Ventures' Base Ecosystem Fund) · Jun 2025; ELSA TGE Jan 2026 | $300M+ on-chain volume by end-2025 (vendor) | [Blog](https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/) (s) |
| **Virtuals App / Butler** | Personal AI in an iOS app: watches prices and signals, moves funds from a built-in wallet, and trades from chat (including group chats) inside user-set budgets and permissions. Butler also opens perps on X. Also: F | Base, Solana and others | Closed beta on iOS (Oct 2026) | Token-funded (VIRTUAL) | n/f; custody model not published | [crypto.news](https://crypto.news/virtuals-protocol-launches-ios-app-that-lets-personal-ai-execute-trades/) (s) |
| **INFINIT** | "Prompt-to-DeFi": a swarm of 18+ agents turns a plain-English strategy into a non-custodial multi-step workflow | EVM, BNB (Venus Flux, Apr 2026) | Early access | IN token; VC amount n/f | Claims 558k+ users ? | [X post](https://x.com/Infinit_Labs/status/2001623490709934463) (s), [blocmates](https://www.blocmates.com/articles/infinit-strategies-powering-the-evolution-of-agentic-finance) (s) |
| **Wayfinder** | Agent "shells" with transaction, perps and prediction agents; Paths strategy marketplace. Also: C, D | Omnichain | Live (Open Alpha) | PROMPT token | n/f | [Tiger Research](https://reports.tiger-research.com/p/wayfinder-eng) (s) |
| Amadeus Agent Hub | Find and run trading and DeFi agents through chat | Solana | ? | n/f | n/f | [thegrid.id](https://thegrid.id/discovery/productType/ai-agent-platform/on/solana) (s) |

## C. Perps agents

| Name | What it does | Venues | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Senpi** | Personal OpenClaw agents with 31 tools and memory; co-pilot or fully autonomous; 80+ open strategies; two-phase trailing-stop (DSL) exits; public Arena and "Predators" board. Also: E | Hyperliquid (crypto, equity, commodity perps) | Live | $4–4.5M · Lemniscap (with Coinbase Ventures' Base Ecosystem Fund) · Sep 2025 | >$100M volume (Feb 2026); $185M with 88% from agents (?) | [Chainwire](https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/) (s) |
| **Minara** | "Personal AI CFO": chat-to-trade plus Autopilot, rules-based perps with mandatory TP/SL. Also: B | Hyperliquid and on-chain | Live | Circle Ventures, SeaX; undisclosed · 2025 | $2.63B cumulative perps volume (DefiLlama) | [DefiLlama](https://defillama.com/protocol/minara-ai-perps) (s) |
| **PERPTools AI Arena** (DEXTools team) | No-code: choose a risk profile and leverage caps, describe the strategy, and the agent trades in about 5 minutes. Public agents can take capital from other users. Also: E | Orderly Network perps | Live; TGE late Q4 2026 | $8M across token rounds: $5M seed at $80M FDV (BigBrain, NEAR, Animoca, Sfermion, Shima; Sep/Oct 2026) plus $3M pre-seed (DEXTools Ventures, Orderly). Terms conflict ? | Points per agent trade (no volume figure) | [KuCoin](https://www.kucoin.com/news/flash/perptools-raises-8m-to-build-ai-native-perpetual-trading-infrastructure) (s), [Pulse2](https://pulse2.com/perptools-raises-5-million-seed-round-at-80-million-valuation/) (s) |
| **Wallet V** | Self-custody wallet; users configure agents with an LLM of their choice; public performance benchmark | Hyperliquid, Aster | Live | Virgo Group incubation (backers include Draper Dragon, OKX Ventures) | 688 agents, 42% with PnL ≥ 0 | [Bitcoin.com PR](https://news.bitcoin.com/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster/) (s) |
| **Cod3x** | AI perps terminal: launch agents, 130+ indicators; "Big Tony" agent | Hyperliquid, GMX v2 | Live, small | Conflicting: "$10.95M" (NEAR, Delphi, HashKey) vs "bootstrapped" ? | 47 active users, $1.2M under management | [PANews](https://panews.io/articles/019d510f-8cc0-7593-8658-e07ff2137803) (s) |
| **Based** | Hyperliquid "SuperApp" that plans personal AI agents to trade perps and prediction markets | Hyperliquid | Agents pre-launch | $11.5M Series A · Pantera (with Coinbase Ventures, Wintermute) · 2026 | n/f | [The Block](https://www.theblock.co/post/390809/hyperliquid-web3-based-funding-pantera) (s) |
| HyperAgent | Swiss, non-custodial AI trading bot using Hyperliquid agent wallets; 15-day trial | Hyperliquid | Live | n/f | n/f | [hyperagent.ch](https://hyperagent.ch/) (s) |
| Katoshi AI | No-code AI agents for Hyperliquid (founded 2024) | Hyperliquid | Live | n/f | n/f | [HypeChain](https://hypechain.app/bots/katoshi-ai/) (s) |
| Haipa | "Agentic trading for Hyperliquid" | Hyperliquid | Live? | n/f | n/f | [haipa.ai](https://www.haipa.ai/) (s) |
| Neyro · Dig Trade | Non-custodial agent builders that execute via Hyperliquid agent wallets | Hyperliquid and DEXs | Fringe | n/f | n/f | [cobo](https://www.cobo.com/post/agentic-wallet-hyperliquid-ai-trading) (s), [Dig Trade](https://viberliquid.up.railway.app/) (s) |
| CLAWSTER | Autonomous perps "skill" for OpenClaw agents | Aster (BSC) | Live (fringe) | n/f | n/f | [clawster.org](https://clawster.org/) (s) |
| AEGIS | AI trading on AsterDEX | Aster | Live? | n/f | n/f | [tradewithaegis.com](https://tradewithaegis.com/) (s) |

## D. Prediction-market agents

| Name | What it does | Venues | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Olas Polystrat** (Valory) | A self-custodied agent that the user owns; it scans markets, buys and monitors 24/7. Installed through the Pearl agent app store | Polymarket (Polygon) | Live since Feb 2026 | Valory/Olas: $13.8M led by 1kx, Feb 2025 (p) | 4,200+ trades in its first month | [IT Brief](https://itbrief.co.uk/story/olas-launches-pearl-connect-for-claude-coding-agents) (s), [CoinDesk](https://www.coindesk.com/tech/2026/03/15/ai-agents-are-quietly-rewriting-prediction-market-trading) (s) |
| **Elastics** | "AI-native OS for prediction markets": describe a position in plain English and the agent executes; auditable agents | Polymarket, Kalshi (?) | Private beta | $2M (€1.7M) pre-seed · Frst · May 2026 | n/f | [EU-Startups](https://www.eu-startups.com/2026/05/warsaw-based-elastics-raises-e1-7-million-to-build-ai-agents-for-prediction-markets/) (s) |
| **Billy Bets** | Autonomous AI sports-betting agent that places bets on on-chain sportsbooks, with its reasoning shown on-chain | On-chain sportsbooks (Virtuals agent) | Live | $1M pre-seed (Coinbase Ventures, CMS Holdings, Serge Ibaka) · 2025 | n/f | [Decrypt](https://decrypt.co/319598/ai-sports-betting-agent-billy-bets-crypto) (s) |
| Sides.trade | AI agent inside Telegram: search markets, place orders, run strategies, with auto TP/SL and copy trading; gas covered | Polymarket | Live (small) | n/f | ~249-subscriber alpha channel | [Polymart](https://polymart.app/sides-trade) (s) |
| Polytrader | AI assistant with research and automated strategies | Polymarket, Kalshi | Live? | n/f | n/f | [polymark.et](https://polymark.et/product/polytrader) (s) |
| AIXBET | Pool-based autonomous agent trading Polymarket; profits go to token stakers | Polymarket | ? | Token | Claims a 74% win rate (unverified) | [pm.wiki](https://pm.wiki/ko/projects/aixbet) (s) |
| Craft Agents | Named in Polymarket's PitchBook profile; nature unknown | Polymarket? | ? | ? | ? | [PitchBook](https://pitchbook.com/profiles/company/436089-07) (s) |

Public × Kalshi (§I), Fere (§A), Ask Gina (§B) and Wayfinder (§B) also trade prediction markets.

## E. Copy, social and arena agent trading

| Name | What it does | Venues | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Nof1 (Alpha Arena)** | Real-money LLM trading benchmark; a consumer "coding agents for markets" product is on the roadmap | Hyperliquid, then US stocks | Benchmark live; consumer product pre-launch; Season 2 not public as of Aug 2026 | $15M · SUI Group and Karatage · May 15 2026 | Only 6 of 32 model runs were profitable (Season 1) | [SaaS News](https://www.thesaasnews.com/news/nof1-raises-15m-in-funding/) (s) |
| **Trader.ai** | Arena of 40 live AI bots across six asset classes; copy-trading into the user's own broker account is "coming soon" | FX, crypto, commodities, equities, indices | Arena live; copy not yet | n/f | 40 live agents (Apr 27 2026) | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/27/3281722/0/en/trader-ai-launches-world-s-first-ai-trading-bots-arena-with-40-live-agents-across-six-asset-classes.html) (s) |
| Recall | On-chain agent trading competitions; RECALL token | Multi-chain | Stale in 2026 | Token | 1,000+ teams (2025) | [Chainwire](https://chainwire.org/2025/12/15/recall-launches-first-verifiable-ai-agent-trading-competition-in-partnership-with-eigencloud/) (s) |
| Quote.Trade | "AI-native" dark-pool DEX for humans, bots and agents, with an Alpha League trading competition | Own DEX | Live (V6, Sep 29 2026) | n/f | n/f | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/09/29/3371271/0/en/quote-trade-launches-v6-of-ai-native-crypto-dark-pool-dex-announces-alpha-league-trading-competition-at-korea-blockchain-week.html) (s) |

Copying or following agents is also offered by eToro, Public's agent marketplace and the BingX AI Arena (§H–I), and by Senpi, PERPTools and Glider (above).

## F. Agent launchpads that trade

| Name | What it does | Chains | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Virtuals Protocol** (GAME, ACP, EconomyOS) | Launch an agent with its own token and wallet; agents can raise capital, trade and share earnings. Most launchpad trading agents had "limited success" (Motley Fool) | Base, Solana (EconomyOS, Aug 24 2026), Robinhood Chain | Live | Token-funded | aGDP ~$479M (vendor ?), 18k+ agents | [BlockEden](https://blockeden.xyz/blog/2026/03/15/virtuals-protocol-agdp-479m-base-batches-003-ai-agents-robotics/) (s), [Nasdaq/Fool](https://www.nasdaq.com/articles/new-ai-agent-platform-could-send-solanas-price-higher-september-and-beyond) (s) |
| Griffain | Solana no-code agent launchpad | Solana | Live but dormant; token ~$8M market cap | Token | n/f | [CMC](https://coinmarketcap.com/cmc-ai/griffain/latest-updates/) (s) |

Bankr (token launches), DXRG and Billy Bets (a Virtuals agent) also sit in this segment.

## G. "AI hedge fund for retail" / TradFi agent apps (startups)

| Name | What it does | Venues | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **RockFlow (Bobby)** | In-app financial AI agent that covers research, strategy and order execution. The RockAlpha arena ran LLMs on real money | US stocks; licensed by the HK SFC | Live | "Tens of millions" · Ant Group · Dec 2025; earlier $10M Series A1 (May 2025) | n/f | [Pulse2](https://pulse2.com/rockflow-new-funding-secured-to-advance-ai-agent-technology-and-support-global-expansion) (s) |
| **GIM** (Grace Investment Machine) | 7-layer multi-agent trading system moving to live execution. **Institutional-leaning, not retail** | Multi-asset | Pre-live | $20M Series A · Hony Capital (with a US VC and IDG) · Jul 9 2026 | n/f | [FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/grace-investment-machine-20m-series-a) (s) |
| **Horizon Trade** | Plain-English idea → code → backtest → risk check → one-click deploy to the user's broker | Brokers (TradFi) | Pre-launch | $2M pre-seed · Entrée Capital · Jul 2026 | 23k+ waitlist | [Calcalist](https://www.calcalistech.com/ctechnews/article/r10d088vgx) (s) |
| **Alphio AI** | "Autonomous financial agent that executes your strategy": conditional automations in plain English, non-custodial execution on connected accounts, copy trading | Connected brokers | Live (iOS, Android) | n/f | n/f | [GlobalFintechSeries](https://globalfintechseries.com/trading/alphio-ai-innovates-retail-trading-with-an-ai-native-workspace-and-non-custodial-execution/) (s) |
| **Surmount AI** | Pre-built, custom or AI-generated strategies that execute on Alpaca, Robinhood, IBKR and others | US brokers | Live | $1M seed (Techstars) · Oct 2023 | 10k+ MAU (podcast claim) | [Tracxn](https://tracxn.com/d/companies/surmount-ai/__GPj-DDARNJ6xicoa845VHK67U40D5lJTimsQbfmioa0) (s) |
| VibeTrader | App that turns trading ideas into automated AI bots | Stocks | Live (updated Aug 2026) | n/f | n/f | [Google Play](https://play.google.com/store/apps/details?id=markets.vibetrader.app&hl=en_US) (s) |
| Spectre Intelligence (YC 2026) | "AI traders instead of human ones"; retail angle unclear | ? | ? | YC | n/f | [YC](https://www.ycombinator.com/companies/industry/investing) (s) |

## H. Incumbents: crypto exchanges ⚑

| Name | What it does | Status | Traction | Source |
|---|---|---|---|---|
| **Binance AI Pro** (+ Binance AI, Agent OS) | Plain-English strategies, choice of LLM, an isolated sub-account with no withdrawal rights; the user approves execution; paper trading | Beta since Mar 25; general rollout late Oct 2026; Binance AI free from Oct 5 | $9.99/mo; 45.7% of one day's activity was system-triggered | [Bitcoin.com](https://news.bitcoin.com/exchanges/binance-brings-vibe-coding-to-crypto-trading-strategies/) (s), [Cointribune](https://www.cointribune.com/en/binance-rolls-out-ai-pro-trading-agent-in-october-2026/) (s) |
| **Bitget GetAgent / GetClaw / Bitget AI** | Playbook strategies plus GetClaw, which trades autonomously in a dedicated agent account (Apr 6 2026); 58 AI tools | Live | 1M users and $1.2B volume across the AI suite (May 2026) | [Yellow](https://yellow.com/es/news/bitget-58-ai-tools-platform) (s), [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/06/3268287/0/en/Bitget-Gives-AI-Its-Own-Trading-Account-Advancing-Toward-an-Agent-Native-Exchange.html) (s) |
| **Coinbase for Agents** (+ Coinbase Advisor) | ChatGPT or Claude trades a real Coinbase account over MCP or CLI; Advisor is an SEC-registered AI adviser (Coinbase One) | Live (Jun 11 / Jun 17 2026) | n/f | [CoinDesk](https://www.coindesk.com/tech/2026/06/11/coinbase-launches-ai-agent-accounts-that-can-trade-and-spend-on-your-behalf) (s) |
| **Bybit AI + AI Sub-Account** | In-app conversational agent that places spot, futures and options trades (Sep 9 2026). The AI Sub-Account (May 20 2026) ring-fences agent funds with leverage and fund caps | Live | n/f | [Cryptowisser](https://www.cryptowisser.com/news/bybit-launches-built-in-ai-agent-that-trades-for-you/) (s), [Chainwire](https://chainwire.org/2026/05/20/bybit-launches-ai-sub-account-enabling-safer-ai-agent-trading-with-fund-isolation-and-permission-controls/) (s) |
| **Gemini Agentic Trading** | Bring any MCP model (Claude, ChatGPT) to trade a Gemini account; three starter Trading Skills; "first on a regulated US exchange" | Live (Apr 27 2026) | n/f | [The Block](https://theblock.co/post/399001/gemini-rolls-out-agentic-trading-allowing-ai-bots-to-directly-manage-crypto-exchange-trading-accounts) (s) |
| **Kraken** | App relaunched around AI agents that monitor and recommend; **the user must approve every trade** | Announced Jul 10 2026; relaunch reported, date n/f | n/f | [The Block](https://www.theblock.co/post/407899/kraken-to-relaunch-its-mobile-app-with-agentic-trading-and-advise-at-the-center) (s), [Cryptometer](https://www.cryptometer.io/news/kraken-relaunches-app-with-ai-agent-to-simplify-crypto-investing/) (s) |
| **BingX AI** (AI Master, AI Arena) | Strategy and copy suite; the AI Arena (Nov 2025) lets users copy LLM-model strategies | Live | n/f | [PR Newswire](https://tools.prnewswire.com/en-us/live/20813/release/20251107EN18600) (s) |
| **OKX** (Agent Trade Kit, OnchainOS, OKX AI marketplace) | Developer tooling only; every write needs user approval; no retail agent app found | Live (developer) | 80+ MCP tools | [CoinDesk](https://www.coindesk.com/tech/2026/03/03/okx-jumps-into-ai-agent-race-with-new-onchainos-toolkit) (s) |

## I. Incumbents: brokers ⚑

| Name | What it does | Status | Traction | Source |
|---|---|---|---|---|
| **Robinhood Agents / Agentic Trading** | In-app agents that build strategies and trade stocks, options and crypto from a pre-funded agent account; approval is on by default; "Loops" coming | Live (US); accounts rolling out over the weeks after Sep 30 | 150k+ agentic accounts; ~30M tool calls a day | [Fortune](https://fortune.com/2026/09/29/robinhood-trading-agents-hood-openai-anthropic/) (s) |
| **eToro** (Tori + agent portfolios) | Build or **copy** AI agents that trade 24/7, each in its own sub-account; Tori executes with approval in the app, WhatsApp and Telegram | Live (Jul 7 2026) | 3.81M funded accounts (company-wide) | [eToro IR](https://investors.etoro.com/news-releases/news-release-details/etoro-launches-new-app-ai-first-smart-and-social) (s) |
| **Public** (Agents, agent marketplace, Kalshi) | Plain-English agents turned into fixed rules that the user approves, then executed; a shareable marketplace (Aug 2026); Kalshi event contracts (Sep 24 2026) | Live | n/f | [Fortune](https://fortune.com/2026/09/24/public-ai-trading-agents-prediction-markets-kalshi-tie-up/) (s), [CryptoBriefing](https://cryptobriefing.com/public-ai-agents-marketplace-portfolios/) (s) |
| **Webull MCP** | ChatGPT, Claude or Cursor place, modify and cancel orders in plain language; order preview, size caps, read-only mode | Live (Apr 2026; announced Jun 11) | All US clients | [Nasdaq PR](https://www.nasdaq.com/press-release/webull-launches-model-context-protocol-enabling-investors-trade-through-ai-plain) (s) |
| **Moomoo API Skills** | Connect Claude or OpenAI agents that monitor and place orders from a chat command; US, CA, HK, SG and JP markets | Live (2026) | n/f | [Finance Magnates/TradingView](https://www.tradingview.com/news/financemagnates:879a0d3c7094b:0-moomoo-joins-the-agentic-investing-club-a-month-behind-etoro/) (s) |
| **Composer by SoFi** | AI builds rules-based strategies that then auto-execute. SoFi says it is *not* agentic | Live (SoFi acquisition, Jun 23 2026) | Composer raised $11.4–16.7M before the deal ? | [SoFi IR](https://investors.sofi.com/news/news-details/2026/Introducing-Composer-by-SoFi-AI-Powered-Investing-From-Idea-to-Execution/default.aspx) (s) |
| Interactive Brokers | Connectors let ChatGPT or Claude analyze and *draft* orders; reviews conflict on execution ? | Live (drafts) | n/f | [StockBrokers.com](https://www.stockbrokers.com/guides/ai-agent-brokers) (s) |

## J. Wallet and agent rails with consumer reach (not counted)

MetaMask Agent Wallet (early access Jun 8, full launch Aug 6 2026; Guard and Beast modes) · Phantom MCP · Trust Wallet Agent Kit (Mar 2026; DCA, limit and alert agents across 25+ chains) · Bitget Wallet agent beta (the user signs) · Coinbase Agentic Wallets · MoonPay Agents · TON Agentic Wallets (Apr 2026) · GMGN Agent API (custodial; data plus execution). Sources: [CoinDesk](https://www.coindesk.com/tech/2026/06/08/metamask-launches-ai-agent-wallet-with-built-in-security-for-crypto-trades) (s), [Bitcoin Magazine](https://bitcoinmagazine.com/news/trust-wallet-launches-agent-kit) (s), [Bitcoin.com](https://news.bitcoin.com/ton-tech-gives-telegram-bots-spending-power-with-new-agentic-wallet-standard/) (s), note 17.

## K. Dropped (with reason)

| Name | Reason |
|---|---|
| Hey Anon | Pivoted to a developer API, the Pandora prediction market and an AMM; no consumer trading agent |
| Orbit (SphereOne) · Axal · Spectral Syntax | No 2026 activity |
| Giza · Almanak · Theoriq AlphaVault · Mamo-style yield agents | Yield vaults, not trading |
| Omo | Self-trading showcase agent (not for users); went offline (Ledger N3XT paper, Sep 2026) |
| Pilly | Memecoin copilot (alerts, PnL); no autonomous execution found |
| Surf (asksurf) | Research and data; execution agents only "planned" |
| Kaito | Attention markets with Polymarket; no trading agent |
| Podium Markets (Ivy) · Astor · Tiger Brokers (TigerAI) · Kraken-style advisors | Advice only; the human executes |
| Pump.fun Mayhem | Protocol-run agent, not the user's |
| Hypernova · Trasia · Imperial · Vest · Pascal | Perps or prediction venues, not agents |
| Clanker | Token launcher, not a trading agent |
| MemeToro | Presale token marketing; no product evidence |
| GitHub frameworks (ai-hedge-fund, Vibe-Trading, Hyper-Alpha-Arena, BlockRun polymarket-agent, Polymarket `agents`) | Open-source, self-hosted, not consumer products |
| Nava · Morgan Stanley agent access | Safety rail; wealth-platform access for outside agents, not a retail agent |

---

## Takeaways

1. **The field is crowded at the edges and thin in Tocker's lane.** About 65 products, but only ~11 trade on-chain spot. The live, funded ones are Nansen (approve each trade), Fere, Velvet and Parasol (grant only). **Parasol is the closest feature match**: autonomous Solana memecoin agents with rug filters, paper or live mode, and MPC wallets. It is tiny and has no VC.
2. **Money is small and scattered.** The largest startup rounds were GIM ($20M, institutional), Donut ($22M, still unlaunched), Nof1 ($15M, benchmark), Based ($11.5M; agents not shipped), PERPTools ($8M token rounds) and RockFlow ("tens of millions", Ant Group). No consumer on-chain agent app has raised a Series A.
3. **Incumbents now cover the "agent account" pattern end to end:** eight exchanges and seven brokers. The common design is a ring-fenced sub-account, approval on by default and listed assets only. Copying agents is live at eToro and in Public's marketplace.
4. **Prediction markets are the fastest-filling niche.** Polystrat, Elastics, Fere, Gina, Public×Kalshi and Sides already trade them, so Tocker's Polymarket expansion would enter a contested market.

**Verify before quoting:** every row is a search extract; vendor traction figures especially (Fere, Senpi, Velvet, INFINIT, AIXBET); PERPTools' round terms; Cod3x funding; Kraken's relaunch date; and the (p) items (Nansen's 2021 round, Olas's 2025 round).
