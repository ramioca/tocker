# 17 — Agentic-trading infrastructure: the stack, who covers each layer, and where Tocker fits (as of 2026-10-07)

**Why this exists.** VCs rejected the last competition slide because it graded Tocker against human-click tools (Axiom, fomo). This brief maps the actual agentic-trading vertical (rails, SDKs and platforms used to build or run on-chain trading agents) and recommends what goes on the Series A slide.

**Method and confidence.** I used WebSearch until the shared budget ran out (about 200 calls, so some names got less coverage than others). WebFetch could not resolve DNS for every host except github.com, so almost every fact below comes from search-result extracts. Tags:
- **(s)**: from a snippet; the page itself was not opened.
- **(v)**: the page was opened, for GitHub repos and this codebase.
- **?**: unverified or contradicted by another source.

Re-check every number before it goes in the deck. Searches I could not run: Nansen's own trading agent, pump.fun agent tooling, Senpi's 2026 funding, and Recall's 2026 activity.

---

## TL;DR
1. **Every rail Tocker uses is now a commodity.** Wallets, x402 payments, the data APIs, Jupiter and Base execution, BYO-key inference and 24/7 hosting each have two or more free or open substitutes. Coinbase alone ships wallet + x402 + trade + spend caps in one `npx awal` command (Feb 11 2026), and Bankr ships wallet + trade + a USDC-paid LLM gateway + x402.
2. **The retail full loop is close to closed, but only for listed assets.** Robinhood Agents (Sep 29 2026) covers account, model choice, third-party data, execution and approvals, with "Loops" for 24/7 coming. It is custodial, limited to listed stocks, options and crypto, and its activity feed is private. **No one** combines long-tail on-chain tokens + *enforced* pre-trade token screening + hosted 24/7 + a public, verified, strategy-private record. That combination is Tocker's slot.
3. **Two things are genuinely Tocker's:**
   - enforced pre-trade *token* safety (10 hard gates plus a 0–100 score) on brand-new launches;
   - a public, tamper-evident per-agent track record that keeps the strategy private.

   Wallet policy engines (Coinbase, Privy, Turnkey, Lit, Sail) limit *how much* an agent spends and *where*. None of them knows whether a token is a honeypot.
4. **Calling Tocker "the infrastructure for agentic trading" is a liability today.** Tocker exposes no external API, SDK or MCP (all `src/app/api` routes are internal; checked (v)), so nobody else builds on it. The defensible infrastructure version is to *sell* the gates and score as a paid pre-trade check on x402, so other agents become customers.
5. **Slide picks:**
   - **Coinbase (Agentic Wallets + x402 + Coinbase for Agents):** rails and platform risk.
   - **Robinhood Agents:** the retail incumbent and proof of demand.
   - **Bankr:** the closest on-chain "infrastructure for trading agents" competitor.

   Senpi, Fere and Ask Gina go in a small "hosted agent apps" row. Nof1 is demand proof, not a competitor.

---

## 1. The stack of agentic trading

```
 LAYER                    JOB                                   WHO COVERS IT (Oct 2026)                                              TOCKER
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 9 Record / distribution  public, verifiable performance        Nof1 Alpha Arena · Recall · Wallet V benchmark · ERC-8004 ·            ★ own (feed, per-fill
                          → trust → users                       Solana Agent Registry · Virtuals aGDP · Robinhood (private feed)        receipts, strategy private)
 8 Strategy UX            plain-English goal → running agent    Robinhood Agents · Bankr · Senpi · Fere · Ask Gina · Bitget GetClaw ·   ★ own (builder form)
                                                                Almanak · Olas Polystrat
 7 Hosting / runtime      24/7 loop, scheduler, memory          OpenClaw (self-host, Railway templates) · ElizaOS · Virtuals GAME ·    ★ own (cron tick + 5-min
                                                                Olas Pearl · Senpi · Questflow · Sailor (local)                         exit engine)
 6 Safety                 (a) refuse bad TOKENS                 (a) data only, not enforced: GMGN risk fields, Deepnets, Plexa          ★ own (a): 10 hard gates
                          (b) bound ACTIONS / spend             (b) Coinbase session caps · Privy/Turnkey policy engines ·              + score floor; uses (b)
                          (c) verify INTENT                         Lit Vincent · Sail mandates · HL API wallets                       via Privy
                                                                (c) Nava escrow/Arbiter
 5 Inference              the model                             BYO key (OpenAI/Anthropic/OpenRouter) · x402/USDC routers: Bankr LLM    BYO key (pay-per-call
                                                                Gateway, Dreams Router, ClawRouter, Router402                          planned) — commodity
 4 Data / signals         paid per call                         Nansen · CMC · CoinGecko · Heurist Mesh · GMGN API · Cookie ·           consumes (x402, platform
                                                                discovery: x402 Bazaar / Agentic.Market / Binance b402                 wallet) — commodity
 3 Payment rail           agent pays per call                   x402 (Foundation: Coinbase, Cloudflare, Stripe, Visa…) ·               uses (Privy x402 client)
                                                                Solana Pay.sh · Stripe MPP
 2 Wallet & custody       keys + signing                        Coinbase Agentic Wallets/CDP · Privy (Stripe) · Turnkey · Crossmint ·  uses Privy — commodity
                                                                MoonPay Agents/OWS · Phantom MCP · Binance sub-accounts
 1 Execution toolkit      actions an agent can call             Solana Agent Kit · Coinbase AgentKit · Jupiter Skills/CLI/MCP ·         uses Jupiter + Base swaps
                                                                OKX OnchainOS/Trade Kit · Binance Skills/Agent OS · Bitget Agent Hub ·  — commodity
                                                                GMGN Agent API · Phantom MCP
 0 Venue / liquidity      where it fills                        Jupiter/Raydium/pump (SOL) · Uniswap/Aerodrome/0x (Base) ·              —
                                                                Hyperliquid · Polymarket · Kalshi-via-DFlow · Robinhood Chain · CEXs
```

**Reading it.** Layers 0–5 are crowded, and the companies in them are well funded and mostly free to use. Layers 6a, 8 and 9 are where retail outcomes are decided: what not to buy, what to do, and whether to trust it. They are thin. The exchanges and Coinbase are moving up into layer 8; Robinhood already sits there.

---

## 2. Player cards

Columns: **Layer** uses the stack numbers above. *n/f* = searched, not found.

### A. Rails (wallet · payments · discovery)
| Player | Layer | Chains | Pricing | Funding | Traction (date) | Status · source |
|---|---|---|---|---|---|---|
| **Coinbase Agentic Wallets** | 2, 3, 1, 6b | Balance/send on Base, Solana, Polygon; **trading Base mainnet only** | n/f; gasless on Base | Coinbase (public) | Launched Feb 11 2026. MPC wallet, session caps, per-tx limits, native x402, `npx awal` or MCP for Claude, Codex and Gemini | Live. [Coinpaprika](https://coinpaprika.com/news/coinbase-agentic-wallets-ai-agents-february-2026-launch/) (s); chain scope from [Eco](https://eco.com/support/en/articles/14845485-coinbase-agentic-wallets-explained) (s) |
| **Coinbase for Agents** | 1, 2, 8-lite | Coinbase account: spot + derivatives; equities, prediction markets and commodities "planned" | Exchange fees | — | Launched Jun 11 2026 as MCP + CLI for ChatGPT and Claude. **x402 payments and granular spending limits were "coming soon" at launch** | Live. [TechCrunch](https://techcrunch.com/2026/06/11/coinbase-debuts-mcp-for-agent-trading/) (s), [LetsDataScience](https://letsdatascience.com/news/coinbase-launches-agentic-trading-and-agent-wallets-198c42e5) (s), [SiliconANGLE](https://siliconangle.com/2026/06/11/coinbase-agents-lets-ai-assistants-trade-crypto-move-money/) (s) |
| **Coinbase AgentKit** | 1, 2 | EVM + Solana; Jupiter, Morpho, Pyth and others | Free (Apache-2.0) | — | 1.3k★, 841 forks. Docs: the framework "doesn't enforce spend caps or require human approval" | Live. [GitHub](https://github.com/coinbase/agentkit) (v) |
| **x402 / Bazaar / Agentic.Market** | 3, 4 | Base, Solana, Polygon and more | Protocol free; facilitators may charge | x402 Foundation (Linux Foundation); operational launch with 40 members Jul 14 2026 | Apr 21 2026: **165M tx, ~69k active agents, ~$50M cumulative**. Bazaar lists 10,000+ payable services (Aug 2026). **TRM Labs:** of 198.9M settlements / $52.7M, ~$25.6M looks commercial, and only **0.6–7.5% of that is from AI agents**. Solana carries ~65–70% of x402 volume | Live. [LetsDataScience](https://letsdatascience.com/news/coinbase-launches-agenticmarket-for-agent-payments-71cce7d9) (s), [CryptoBriefing](https://cryptobriefing.com/coinbase-slack-bot-micropayments-x402-usdc/) (s), [TRM Labs](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain) (s), [CryptoBriefing](https://cryptobriefing.com/solana-x402-market-share-dominance/) (s), [Solana Compass](https://solanacompass.com/news/linux-foundation-launches-x402-foundation-as-open-standards-body-for-ai-agent-payments) (s), [GitHub 6.7k★](https://github.com/x402-foundation/x402) (v) |
| **Privy (Stripe)**, Tocker's wallet | 2, 3, 6b | EVM + Solana | Usage-based, n/f | Acquired by Stripe Jun 2025 | Server wallets in TEEs; policy engine rejects a transaction before signing; pays Stripe x402 merchants | Live. [Privy docs](https://docs.privy.io/wallets/overview/solutions/agent-wallets) (s), [Privy blog](https://privy.io/blog/when-agentic-wallets-meet-real-merchants) (s) |
| **Turnkey** | 2, 6b | Multi | n/f | $30M Series A | "Agentic Payments" product; policies scoped by recipient, contract, chain and value; 100M+ policies created | Live. [Turnkey](https://turnkey.com/solutions/ai-agents) (s), [The Paypers](https://thepaypers.com/crypto-web3-and-cbdc/news/turnkey-launches-agentic-payments-infrastructure-for-ai-agent-onchain-transactions) (s) |
| **MoonPay Agents / Open Wallet Standard** | 2, 1, 3 | Cross-chain | n/f | MoonPay (private) | Feb 24 2026: non-custodial agent wallets via CLI, fiat on/off-ramp, swaps, recurring buys, x402. Open Wallet Standard (OWS) open-sourced Mar 2026 | Live. [The Block](https://www.theblock.co/post/391038/moonpay-launches-moonpay-agents-to-power-ai-driven-crypto-transactions) (s), [The Block](https://www.theblock.co/post/394609/moonpay-releases-wallet-standard-ai-agents) (s) |
| **Phantom MCP server** | 2, 1 | Solana + EVM; swaps and perps | **No fee on swaps via `buy_token` / `portfolio_rebalance`** | Phantom (private) | Each agent gets a new dedicated wallet; works with Claude and OpenClaw | Live. [Phantom docs](https://docs.phantom.com/phantom-mcp-server) (s) |
| Crossmint (GOAT, lobster.cash) | 2, 3 | 15+ chains | — | n/f | **GOAT SDK repo archived** ("no issues, PRs, or updates"); Alchemy: no code since mid-2025. Crossmint moved to lobster.cash agent payments (Feb 2026) | GOAT is dead. [GitHub](https://github.com/goat-sdk/goat) (v), [Alchemy](https://www.alchemy.com/blog/best-blockchain-infrastructure-for-ai-agents) (s), [Crossmint](https://www.crossmint.com/solutions/ai-agents) (s) |
| Lit Protocol Vincent | 2, 6b | EVM DeFi | n/f | n/f | User-revocable policies bound to "abilities" (swap, borrow, bridge) | Live. [Blockworks](https://blockworks.co/news/lit-protocol-vincent-ai-agents) (s) |

### B. Developer toolkits and data APIs (layers 1 and 4)
| Player | Layer | Chains | Pricing | Funding | Traction (date) | Status · source |
|---|---|---|---|---|---|---|
| **Solana Agent Kit (SendAI)** | 1 | Solana: Jupiter, Raydium, Drift and more | Free (Apache-2.0) | n/f | 1.7k★, 881 forks; 60+ actions. Tagged releases slowed, but Helius and Alchemy plugins added May 2026 | Live, maintenance pace. [GitHub](https://github.com/sendaifun/solana-agent-kit) (v), [Alchemy](https://www.alchemy.com/blog/how-to-build-solana-ai-agents-in-2026) (s) |
| **Jupiter agent tooling** | 1, 0 | Solana | API free; swap fees per Jupiter (Ultra fee n/f) | — | Official Skills (agentskills.io spec), CLI and MCP covering Ultra Swap, Trigger, Recurring, Perps, **Prediction Markets**, Price and Tokens. Third-party hosted Jupiter MCP is free with no auth | Live. [Jupiter docs](https://developers.jup.ag/docs/ai.md) (s), [Skills](https://developers.jup.ag/docs/ai/skills.md) (s), [junct-bot MCP](https://claudemarketplaces.com/mcp/junct-bot/jupiter-mcp) (s) |
| **GMGN Agent API + Skills** | 1, 4, 6a-data | SOL, BSC, Base, **Robinhood Chain** | Terminal charges 1%; API price n/f | n/f | Internal test from Mar 18 2026 (whitelist): K-lines, sniper, insider and bundle risk signals, TP/SL; keys stay local. GMGN did **$3.31B DEX volume in 30 days**: Robinhood Chain $1.53B, BSC $1.36B, Solana $0.22B (Sep 2026) | Beta? [MEXC](https://www.mexc.com/news/953362) (s), [Tapbit](https://www.tapbit.com/en/learn/article/gmgn-3-billion-month-robinhood-chain-ai-agents-20260907) (s) |
| **OKX OnchainOS + Agent Trade Kit** | 1, 2 | 60+ chains, 500+ DEXs; CEX spot, futures and options | Free tooling; trading fees | OKX | Launched Mar 3 2026; 80+ tools via MCP or CLI; every write needs explicit user approval | Live. [BlockEden](https://blockeden.xyz/blog/2026/03/07/okx-onchain-os-ai-agent-toolkit/) (s), [Unlock](https://unlock-bc.com/en/okx-launches-agent-trade-kit-for-ai-trading) (s) |
| **Binance Skills → Agent OS** | 1, 2, 3 | Binance CEX + Wallet; b402 x402 variant | Free tooling; trading fees | Binance | Skills Mar 3 and Mar 12 2026; **Agent OS Aug 20 2026** (MCP + Wallet Agentic Hub + x402 + Skill Hub; one sub-account per agent) | Live. [Finance Magnates](https://www.financemagnates.com/cryptocurrency/exchange/binance-creates-operating-system-for-agents-as-ai-trading-moves-beyond-apis/) (s), [The Paypers](https://thepaypers.com/crypto-web3-and-cbdc/news/binance-launches-agent-os-to-connect-ai-tools-to-trading) (s), [b402](https://developers.binance.com/en/docs/products/onchainpay-x402/b402-bazaar) (s) |
| **Bitget Agent Hub / GetAgent / GetClaw** | 1, 7, 8 | Bitget CEX | Free tooling | Bitget | Agent Hub Feb 2026 (MCP, REST, WS) plus Skills and CLI Mar 2026 ("OpenClaw trading in 3 min"). GetAgent 450k+ users; Messari counts ~460k across the AI stack (Apr 29 2026) | Live. [IT Brief](https://itbrief.com.au/story/bitget-says-460-000-users-adopted-its-ai-trading-tools) (s), [Bitget](https://www.bitget.com/blog/articles/bitget-agent-hub-ai-trading-upgrade) (s), [CFOtech](https://cfotech.news/story/bitget-unveils-getclaw-a-download-free-ai-trading-bot) (s) |
| **Heurist Mesh** | 4, 5 | Multi | API key, **x402 pay-per-use**, MCP | Token (HEU) | 30+ specialist crypto-analysis agents, registered under ERC-8004 | Live. [Heurist docs](https://docs.heurist.ai/heurist-mesh/overview) (s) |
| Cookie DAO | 4 | Multi | Token-gated API | Token | Snaps shut down Jan 2026 over X API policy; pivoting to agent-activity data | Pivoting. [CMC](https://coinmarketcap.com/fr/cmc-ai/cookie/latest-updates/) (s) |
| Kalshi / DFlow · Polymarket | 0, 1 | Kalshi as SPL tokens via DFlow (Solana); Polymarket CLOB | Venue fees | — | DFlow Prediction Markets API (Dec 2025); Phantom integrated Kalshi (Dec 2025). Polymarket has an official `agents` framework plus many third-party MCPs (oddsrail, 48-tool demwick). Quantish's Kalshi MCP is **winding down**. "AI = 30% of Polymarket wallet activity" ? | Live. [The Block](https://www.theblock.co/post/380983/kalshi-tokenizes-thousands-of-its-prediction-markets-using-solana) (s), [QuickNode](https://www.quicknode.com/guides/solana-development/3rd-party-integrations/kalshi-prediction-markets-with-dflow) (s), [oddsrail](https://mcpservers.org/servers/hmesutozsoy/oddsrail) (s), [Quantish](https://mcpservers.org/es/servers/joinquantish/kalshi-mcp) (s), [BlockEden](https://blockeden.xyz/blog/2026/01/25/prediction-markets-polymarket-kalshi-ai-agents/) (?) |
| Hyperliquid | 0, 2 | HyperCore / HyperEVM | Venue fees | — | API ("agent") wallets can trade without withdrawal rights; open interest above $10B by mid-2026 | Live. [CryptoBriefing](https://cryptobriefing.com/hyperliquid-default-liquidity-layer-ai-agents/) (s) |

### C. Inference paid in USDC (layer 5): Tocker's "planned" feature already exists
| Player | What | Source |
|---|---|---|
| **Bankr LLM Gateway** | OpenAI-compatible proxy; Claude, GPT and Gemini paid in USDC or USDT, pay-as-you-go with auto top-up. Fees an agent earns pay for its own compute. 30+ models on BNB Chain | [Bankr support](https://bankr-support.support.site/article/llm-gateway) (s), [BlockchainReporter](https://blockchainreporter.net/bankrbot-joins-bnb-chain-to-let-users-pay-for-30-ai-models-with-stablecoins/) (s) |
| Dreams Router (Daydreams) | Model router with x402 for the Vercel AI SDK, which is Tocker's SDK; EVM + Solana | [README](https://unpkg.com/@daydreamsai/ai-sdk-provider@0.1.5/README.md) (s) |
| ClawRouter (BlockRun) | One USDC wallet per OpenClaw agent; routes to the cheapest capable model; x402 on Base and Solana | [dev.co](https://dev.co/ai/frameworks/clawrouter) (s) |
| Router402 | OpenRouter-compatible, x402 on Base (HackMoney 2026 finalist) | [ETHGlobal](https://ethglobal.com/showcase/router402-b717q) (s) |

### D. Runtimes and frameworks (layer 7)
| Player | Notes | Status · source |
|---|---|---|
| **OpenClaw** | Self-hosted agent on cron with 17k+ skills; the default runtime for Senpi, Bitget, Bankr and Phantom integrations. Creator joined OpenAI Feb 14 2026 (acqui-hire; project stays open source). **230+ malicious "crypto trading" skills were uploaded to ClawHub from Jan 27**, and VirusTotal scanning was added in response | Live. [ClawKit](https://getclawkit.com/blog/openclaw-joins-openai) (s), [Panto](https://www.getpanto.ai/blog/openclaw-ai-platform-statistics) (s ?) |
| ElizaOS (ex-ai16z) | Framework is alive (19.6k★, 5.8k forks) and no longer accepts third-party plugins. Token migrated at 1:6; legacy AI16Z is ~99% off its high; class action filed Apr 2026 ? | Framework live; token is a cautionary tale. [GitHub](https://github.com/elizaOS/eliza) (v), [The Block](https://www.theblock.co/post/371639/eliza-labs-ai16z-elizaos-token-migration) (s), [DEXTools](https://www.dextools.io/tutorials/what-is-ai16z-elizaos-ai-agents-solana-guide-2026-pt) (s ?) |
| Virtuals (GAME, ACP, Butler) | Agent launchpad turned agent-commerce OS. **$479M aGDP, 18k+ agents, $1.16M cumulative agent revenue (Mar 2026)**. Butler got "native trading". Expanding to Robinhood Chain | Live. [BlockEden](https://blockeden.xyz/blog/2026/03/15/virtuals-protocol-agdp-479m-base-batches-003-ai-agents-robotics/) (s), [BlockEden](https://blockeden.xyz/blog/2026/05/09/virtuals-protocol-ai-economic-os-agdp-agent-platform/) (s) |
| Olas (Pearl, Polystrat) | Pearl is a local agent app store. **Polystrat trades Polymarket continuously**; Pearl Connect gives Claude Code a wallet (beta, Gnosis and Polygon) | Live. [IT Brief](https://itbrief.co.uk/story/olas-launches-pearl-connect-for-claude-coding-agents) (s) |
| Questflow | Multi-agent orchestration on CDP Wallets v2 + x402: 130k+ microtransactions, 30+ third-party agents | Live; 2026 traction n/f. [Coinbase case study](https://www.coinbase.com/developer-platform/discover/case-studies/questflow) (s) |
| Sail / Sailor | Safe + on-chain mandate; Sailor runs locally with Claude Code or Codex. 10 EVM chains including Robinhood Chain; no Solana | Tiny: Sailor 8★, Protocol 11★, last push Sep 11 2026. [GitHub](https://github.com/sail-money) (v); see 11-competition-deep.md |

### E. Hosted agent products for retail (layer 8, plus whatever layers each bundles)
| Player | Layers bundled | Chains / assets | Pricing | Funding | Traction (date) | Source |
|---|---|---|---|---|---|---|
| **Robinhood Agentic Trading → Robinhood Agents** | 2 (custodial agentic account), 1, 4 (Agent Apps), 5 (pick a model incl. OpenAI), 6b (cash-only, approvals on by default), 7 ("Loops" coming soon), 8 | US stocks and options (May 27 2026); crypto (from Jul–Aug 2026); in-app perps on 8 coins at up to 10x | **No extra cost** | HOOD (public) | **150k+ agentic accounts, ~30M agent tool calls/day** (Sep 2026). Robinhood Agents, Agent Apps and Loops announced Sep 29 2026 | [Robinhood](https://robinhood.com/us/en/newsroom/robinhood-is-now-open-to-agents/) (s), [Fortune](https://fortune.com/2026/09/29/robinhood-trading-agents-hood-openai-anthropic/) (s), [CMC Academy](https://coinmarketcap.com/academy/article/robinhood-adds-ai-agents-crypto-perps-at-hood-summit) (s), [CrowdfundInsider](https://www.crowdfundinsider.com/2026/08/298934-a-new-era-of-trading-robinhood-rolls-out-agentic-trading-for-users/) (s) |
| Robinhood Chain (context) | 0 | Arbitrum L2; 24/7 Stock Tokens (120+ countries, **not US**) | — | — | Mainnet Jul 1 2026 | [The Block](https://www.theblock.co/post/406918/robinhood-chain-goes-live-mainnet-alongside-24-7-tokenized-stocks-lighter-perps-planned-crypto-agentic-trading) (s) |
| **Bankr** | 2, 1, 3, 4 (x402), 5 (LLM Gateway), 7 (runtime, skills), 8 (chat) | Base, Solana, ETH, Arbitrum, Polygon, BNB; swaps, limit, stop, DCA, TWAP, perps, token launches | Bankr Club $20/mo in BNKR, or Max Mode LLM credits | BNKR fair-launch token | 0x case study: 12× trades, 8× volume in 6 months, "$35.8" total swap volume (the B-vs-M unit is **?**; notes 07 and 11 disagree). Launchpad $4.35B volume / $26M fees after 18 months (?) | [0x](https://0x.org/case-study/bankr) (s), [Alea](https://alearesearch.substack.com/p/bankr-ai-execution-layer) (s), [Bankr quick start](https://bankr-support.support.site/article/quick-start) (s), [Base AI-agent docs](https://docs.base.org/ai-agents) (s) |
| **Senpi** | 2, 1, 5, 7, 8 | Hyperliquid perps | n/f | $4M seed (Sep 2025) | Live since Jan 2026; **>$185M volume, 88% from autonomous agents** (s); launched with 31 tools on OpenClaw (Feb 24 2026) | [Chainwire](https://chainwire.org/2026/02/24/senpi-launches-the-first-personal-trading-agents-for-hyperliquid/) (s), [Emelia](https://emelia.io/hub/senpi-openclaw-trading) (s) |
| **Fere AI** | 2, 1, 5, 7, 8 | ETH, SOL, Base, Arbitrum, BNB, Polymarket | $29/mo Pro (note 11) | $1.3M seed led by Ethereal (Apr 23 2026) | 10M+ agent actions | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/23/3279629/0/en/fere-ai-raises-1-3m-to-put-a-self-improving-trading-agent-in-everyone-s-hands.html) (s) |
| Ask Gina | 2 (Privy), 5, 7 ("Recipes"), 8 | Polymarket, Hyperliquid, 12+ chains | Credit packs | Prelude, Coinbase Ventures | n/f | see 15-ask-gina.md |
| Almanak | 7, 8 (no-code quant swarm) | EVM DeFi | Vault fees | $8.4M (2025); TGE Dec 11 2025 | Claims TVL **>$120M** (alUSD ~$140M) vs DefiLlama ~$9.8M in note 07: **?** | [BitcoinWorld](https://bitcoinworld.co.in/almanak-token-listing-bybit-kraken/) (s), [MEXC](https://www.mexc.com/news/244901) (s ?) |
| Giza (ARMA) | 7, 8 (yield agents) | Base / EVM stablecoins | 10% of yield | $5.2M ? | $20M+ under agent management; ARMA $30M+ optimised, 100k+ txs | [KuCoin AMA](https://www.kucoin.com/blog/en-kucoin-ama-with-giza-giza-the-rise-of-non-custodial-algorithmic-agents-in-decentralized-finance) (s) |
| Theoriq (AlphaVault) | 7, 8 (vault) | EVM | Points → THQ | n/f | AlphaVault Dec 2025; external "Agent Arena" planned for H2 2026 | [The Block](https://www.theblock.co/post/381576/theoriq-launches-alphavault-with-ai-powered-active-management) (s), [ChainCatcher](https://www.chaincatcher.com/en/article/2232236) (s) |

### F. Track record and reputation (layer 9)
| Player | What | Traction · status · source |
|---|---|---|
| **Nof1 Alpha Arena** | Public real-money LLM benchmark on Hyperliquid, then US stocks | $15M co-led by SUI Group and Karatage (May 2026). Season 2 had **not appeared publicly as of Aug 6 2026** (?). [FinSMEs](https://www.finsmes.com/2026/05/nof1-raises-15m-in-funding.html) (s), [traderank](https://www.traderank.ai/blog/alpha-arena-alternatives-2026) (s ?) |
| Recall | On-chain agent competitions; RECALL token on Base (Oct 15 2025) | AlphaWave drew 1,000+ teams (2025); Eigen Arena (Dec 15 2025). **2026 activity n/f**. [Chainwire](https://chainwire.org/2025/12/15/recall-launches-first-verifiable-ai-agent-trading-competition-in-partnership-with-eigencloud/) (s), [The Defiant](https://thedefiant.io/news/press-releases/recall-announces-launch-of-erc-20-token-on-base-october-15) (s) |
| Wallet V benchmark | Cohort benchmark of user-configured LLM agents on Hyperliquid and Aster | Jun 2026: **688 agents; only 42% had PnL ≥ 0**. [Decrypt (PR)](https://decrypt.co/371141/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster) (s) |
| ERC-8004 / Solana Agent Registry | On-chain agent identity and reputation | ERC-8004 mainnet Jan 29 2026: 170k+ agents, but only 3–15% have a live endpoint and **59–91% of reviewers show coordinated Sybil behaviour**. [arXiv 2606.26028](https://www.alphaxiv.org/abs/2606.26028) (s). Solana Agent Registry Mar 3 2026, 9k agents at launch. [Solana](https://solana.com/agent-registry/what-is-agent-registry) (s) |
| Nava | Escrow plus intent verification ("Arbiter") before an agent's transaction settles | $8.3M seed led by Polychain (Apr 14 2026). [Fortune](https://fortune.com/2026/04/14/nava-seed-funding-ai-financial-agents/) (s) |

### G. Drop from the slide: dead, stalled or out of scope
- **GOAT SDK:** archived (v).
- **Quantish Kalshi MCP:** winding down (s).
- **Cookie Snaps:** shut down (s).
- **Wayfinder, Griffain, Hey Anon, Cod3x:** token-led "DeFAI" with no 2026 traction found.
- **ElizaOS:** a framework, not a competitor.
- **Sail:** sub-scale.
- **GIM (Grace Investment Machine):** $20M Series A on Jul 9 2026, but it builds capital-markets agentic investing in Beijing, not on-chain retail ([FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/grace-investment-machine-20m-series-a), s).
- **Axiom and fomo:** not agentic. Removed per the brief.

---

## 3. Coverage matrix: who closes the loop?
Key: Y = yes · P = partial · N = no · ? = not found.
- **Safety-token** = enforced refusal of bad *tokens* before buying.
- **Record** = a public, verifiable per-agent track record.
- **Long-tail** = can trade brand-new on-chain tokens.

| | Wallet | Exec | Data/call | Inference | Safety-token | Hosted 24/7 | Record | Retail no-code | Long-tail |
|---|---|---|---|---|---|---|---|---|---|
| **Tocker** | Y (Privy) | Y (Jupiter, Base) | Y (x402) | P (BYO key) | **Y (10 gates; sell-sim Base only)** | Y | **Y (strategy private)** | Y | Y (SOL, Base) |
| Robinhood Agents | Y (custodial) | Y | P (Agent Apps) | Y | N (listed assets; approvals) | P (Loops soon) | N (private feed) | Y | N |
| Coinbase for Agents + Agentic Wallets | Y | Y | P (x402 "soon" in CfA) | N (BYO agent) | N (spend caps only) | N | N | P (inside ChatGPT/Claude) | P (Base tokens) |
| Bankr | Y | Y | Y | Y (LLM Gateway) | N ? | P | P (public social commands) | P (chat) | Y |
| Senpi | Y | Y | ? | P | N (perps on listed markets) | Y | P (HL fills public) | Y | N |
| Fere AI | Y | Y | ? | Y | ? | Y | P | Y | P |
| Ask Gina | Y | Y | N ? | Y | N ? | Y | N | Y | P |
| Binance Agent OS / OKX / Bitget | Y (sub-acct) | Y | P | N (GetClaw: Y) | P (confirmations) | N (GetClaw: Y) | N | N (GetClaw: Y) | P (OKX DEX: Y) |
| GMGN Agent API | P (local keys) | Y | P | N | P (risk data, not enforced) | N | N | N | Y |
| Phantom MCP / MoonPay Agents | Y | Y | N / P | N | N | N | N | N | Y |
| Solana Agent Kit / AgentKit / OpenClaw | P | Y | via plugins | BYO | N | P (self-host) | N | N | Y |
| Virtuals / Olas Polystrat | Y | P / Y | Y (ACP) / P | Y | N | Y | P (aGDP) / ? | P | P |
| Nof1 / Recall / Wallet V | — | — | — | — | — | — | Y (contests and cohorts, not products) | — | — |

**Answer: is anyone covering the whole loop for retail?**
- **For listed assets, yes, nearly: Robinhood Agents.** It took 4 months to go from MCP access (May 27) to a hosted agent with model choice and third-party data (Sep 29). What's missing is 24/7 standing strategies (Loops is "coming soon"), long-tail tokens and a public record.
- **On-chain, no one closes the loop with safety.**
  - **Bankr** bundles the most rails (wallet, execution, x402, inference). It leaves strategy and autonomy to whatever agent the user plugs in, and I found no enforced token screening.
  - **Senpi** is a full hosted loop, but only for Hyperliquid perps on listed markets.
  - **Fere** and **Ask Gina** are hosted loops that are small or don't screen.
- The cell nobody fills: **long-tail tokens × enforced screening × hosted × public record.** That cell is Tocker's, and the matrix above is the evidence. Expect it to stay open for quarters, not years: GMGN already has the risk data, the distribution and an agent API.

---

## 4. Where Tocker is differentiated, and where it is only assembling rails

**Commodity (do not pitch these as moats):**

| Tocker component | Off-the-shelf substitute (Oct 2026) |
|---|---|
| Agent wallet on SOL + Base | Coinbase Agentic Wallets, Privy (which Tocker uses), Turnkey, MoonPay Agents, Phantom MCP |
| Pay-per-call data over x402 | Any x402 client; 10k+ Bazaar services; Coinbase, Binance and Solana Pay.sh rails. Agent-originated x402 volume is still tiny (TRM: 0.6–7.5% of commercial volume) |
| Inference: BYO key, then USDC pay-per-call | Bankr LLM Gateway, Dreams Router (same Vercel AI SDK), ClawRouter: **already shipped** |
| Execution via Jupiter / Base swaps | Jupiter Skills/MCP, Solana Agent Kit, AgentKit, Phantom MCP (**no swap fee**), OKX OnchainOS |
| Hosted 24/7 | OpenClaw on a Railway template, Senpi, Fere, GetClaw, Robinhood Loops (coming) |
| "One integration" | Coinbase `npx awal`; Bankr skill; Binance Agent OS (one MCP) |

**Genuinely differentiated (defensible if executed):**
1. **Enforced, token-level pre-trade safety on new launches.**
   - Gates in code refuse mint or freeze authority, honeypots and failed sell simulations; a 0–100 score floor applies on top.
   - Every other "safety" in the market sits on a different axis:
     - spend and permission bounds: Coinbase caps (granular limits "coming soon" at launch), Privy and Turnkey policies, Lit, Sail;
     - intent verification: Nava;
     - data the agent may ignore: GMGN, Deepnets.
   - AgentKit's own docs say it "doesn't enforce spend caps or require human approval."
   - Evidence that the need is real: 230+ malicious "crypto trading" skills on ClawHub; only 42% of 688 user-built LLM agents were flat or better (Wallet V); Alpha Arena losses (note 06).
   - Caveat for honesty: the sell-sim gate is Base-only, and gate providers can miss.
2. **Public, verified, strategy-private track record.** Benchmarks (Nof1, Recall, Wallet V) are contests or cohorts, not a product record. ERC-8004 reputation is mostly Sybil. Robinhood's feed is private. Tocker's frozen entry scores, per-fill receipts and rationale make each agent a credible, rankable asset without exposing the recipe.
3. **An opinionated, hosted discipline loop:** discover, score, buy data only for survivors, trade, then exits enforced in code every 5 minutes. The opinion is the product. Rails providers deliberately ship none.

**Honest verdict.** Tocker is an **application-layer safety + reputation product built on commodity rails**, not infrastructure. Today it has no external API, SDK or MCP (checked in the repo), so nobody can "integrate" it. The VC review already warned that "infrastructure" invites a comparison with Coinbase, Privy and Binance that Tocker loses on distribution.

Two coherent options:
- **(a) Reposition:** "the safety and track-record layer for agentic trading," or as a consumer product, "your strategy, run as an agent that refuses rugs, with a public record."
- **(b) Earn the infrastructure label:** ship the gates and score as a paid **pre-trade check** on x402 and MCP, listed on Bazaar / Agentic.Market. Every Coinbase, Bankr, Phantom or OpenClaw agent could then call "should I buy this token?" for a few cents. This is a small build (the scoring already exists), and it turns the rails players into distribution.

**Fee note.** The brief says "planned 20 bps", but the code still charges a $0.10 flat fee per fill (`src/lib/platform/fee.ts:24`, v), and the VC review called the mismatch "fatal in diligence". Price anchors in the agent rails are low: Phantom MCP charges no swap fee, and Robinhood agentic accounts cost nothing extra. Justify 20 bps by safety, hosting and record, not by execution.

---

## 5. Series A competition slide: recommendation

**Show three infrastructure-adjacent names, framed by role.** Leave out Axiom and fomo.

| Name | Role on slide | Key fact (source) | One-line framing |
|---|---|---|---|
| **Coinbase**: Agentic Wallets + x402 + Coinbase for Agents | **Rails we build on, and the platform risk** | Agentic Wallets Feb 11 2026; Coinbase for Agents Jun 11 2026; x402 had **165M tx, ~69k active agents, ~$50M cumulative** by Apr 21 2026 ([LetsDataScience](https://letsdatascience.com/news/coinbase-launches-agenticmarket-for-agent-payments-71cce7d9), s) | "Coinbase gives an agent a wallet and a way to pay. It doesn't tell the agent what not to buy. We do." |
| **Robinhood Agents** | **Retail incumbent and demand proof** | **150k+ agentic accounts, ~30M agent tool calls/day**; hosted Agents + Agent Apps launched Sep 29 2026 ([Fortune](https://fortune.com/2026/09/29/robinhood-trading-agents-hood-openai-anthropic/), s) | "Robinhood proved retail wants an agent account, but for listed assets inside a walled garden with a private record. Tocker is the on-chain, long-tail version with safety gates and a public record." |
| **Bankr** | **Closest on-chain competitor** | Wallet + swaps/limits/DCA + x402 + **LLM Gateway paid in USDC**; featured in Base's AI-agent docs; $20/mo Club ([Bankr](https://bankr-support.support.site/article/llm-gateway), s) | "Bankr arms any agent. Tocker disciplines it: gates before every buy, exits in code, and a record you can verify." |

- **Small second row, "hosted agent apps":** Senpi (Hyperliquid), Fere AI, Ask Gina.
- **Footnote, "demand proof":** Nof1 Alpha Arena ($15M) and the Wallet V cohort (42% flat or better).
- **Swap-in:** if the deck stays memecoin-specific, use **GMGN Agent API** instead of Bankr. It is the most direct threat in Tocker's asset class: long-tail SOL, BSC, Base and Robinhood Chain tokens, risk signals and execution, and $3.3B a month in volume.

**Visual: an honest 2×2 (not a self-graded checkmark grid).**
- **X axis:** *Bring your own agent (toolkit)* ↔ *Agent runs for you (hosted)*.
- **Y axis:** *Listed / major assets* ↔ *Long-tail new launches, screened*.

```
                    LONG-TAIL NEW LAUNCHES
                              │   ★ TOCKER (screened + public record)
     GMGN Agent API · Bankr   │   Fere AI
     Solana Agent Kit · Phantom MCP
 BRING-YOUR-OWN ──────────────┼────────────────────── HOSTED FOR YOU
     Coinbase for Agents      │   Robinhood Agents
     Binance / OKX / Bitget   │   Senpi (HL perps) · GetClaw
                    LISTED / MAJORS
```
Under the chart: "Rails we use: Privy (Stripe) wallets · x402 · Jupiter / Base DEXs."

**Slide copy options**
- "Everyone gave agents a wallet. Nobody taught them what not to buy."
- "Coinbase, Binance and Robinhood arm the agent. Tocker is the discipline and the record."
- Spoken: "In 2026 every exchange shipped agent rails. Coinbase gives your agent a wallet, Binance an operating system, Robinhood an account. None of them stops your agent buying a honeypot launched ten minutes ago, and none of them publishes a record you can verify. That's Tocker."

---

## 6. Threats, ranked
1. **Robinhood moves on-chain.** Crypto agentic accounts were in rollout by Jul–Aug 2026, Loops is coming, and Robinhood Chain has Stock Tokens and a GMGN presence. This collides directly with Tocker's planned tokenized-stocks expansion (non-US Stock Tokens) and owns retail distribution.
2. **Coinbase bundles upward.** Wallet + x402 + Agentic.Market + Coinbase for Agents, with granular limits promised. Adding token-risk screening from Base data would let the rails eat the app on Base.
3. **Bankr** makes the same "infrastructure for trading agents" pitch on-chain, with a token, an inference gateway, Base-docs distribution and a skills marketplace.
4. **GMGN** already sells long-tail risk data plus execution to agents at $3.3B a month. "Enforce the risk flags" is one product decision away.
5. **Exchange agent stacks** (Binance Agent OS, OKX OnchainOS with 500+ DEXs, Bitget GetClaw) are free, have huge user bases, and OKX already reaches DEX long-tail tokens.
6. **Price compression and DIY.** Phantom MCP charges no swap fee; OpenClaw + Jupiter skill + ClawRouter is a near-free self-hosted loop. ClawHub malware is the counter-argument for a curated, safe host.
7. **Narrative risk.** x402 "volume" is mostly not agents (TRM). Don't lean on x402 as demand proof; say "rails are standardised," not "agents are paying."

## 7. Caveats: what not to claim
- Not "the only full-loop agent platform." Robinhood (listed assets) and Senpi (Hyperliquid) run full loops. Claim the *on-chain long-tail + enforced screening + public record* combination.
- Not "infrastructure others build on" until there is a public API, MCP or x402 endpoint.
- Not "pay-per-call inference" as novel: Bankr, Dreams Router and ClawRouter already ship it.
- Bankr's 0x volume unit (B vs M) and Almanak's TVL ($120M vs ~$9.8M) are **conflicting**; don't quote them.
- "AI agents = 30% of Polymarket activity" has no primary source; skip it.
- Robinhood figures are Robinhood-reported. Senpi, Wallet V, Fere and Bitget figures are company press releases.
- Coinbase Agentic Wallets trade **only on Base mainnet**. Don't say "Coinbase agents trade Solana memecoins."
