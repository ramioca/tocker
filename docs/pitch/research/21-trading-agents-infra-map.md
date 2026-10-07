# 21 — Infrastructure for AI trading agents: the full map, by layer (as of 2026-10-07)

**Scope.** This note lists companies and projects that sell *infrastructure or developer/prosumer tooling* to people who build or run AI trading agents. It leaves out consumer agent apps (Robinhood Agents, Senpi's hosted app, Fere, Minara, Nansen AI, Ask Gina). Those are in notes 16 and 19. It extends notes 17 and 19 and does not redo them. Where an entry was already in note 17, the row says "n17" and only new facts are added.

**Method.** About 60 WebSearch queries in extended mode on 2026-10-07, plus notes 16, 17 and 19. No pages were opened in this pass.
- **(s)**: from a search snippet or extract. **Every row is (s) unless marked otherwise.**
- **(v)**: page opened in an earlier pass (note 17 GitHub checks).
- **?**: conflicting, vendor-only or unverified.
- **n/f**: searched, not found.

Funding is the latest disclosed round unless stated. Token-funded projects say "token." Re-check every number against the primary source before it goes in a deck.

---

## Counts

| Layer | Entries | Of which have a disclosed VC round or acquisition |
|---|---|---|
| A. SDK / agent kit / harness | 13 | 2 (Senpi $4.5M, Infinit $6M). The others are token-funded, corporate, open source or n/f |
| B. Wallet, policy and payment rail | 17 | 7 (Turnkey, Catena, Kite, Lit, Nava, AEON; Privy acquired by Stripe). The rest are corporate |
| C. Execution API / venue agent tooling | 18 | 1 (corporate venues aside; Bankr: small Coinbase Ventures cheque) |
| D. Data and signals for agents (x402 / MCP) | 17 | 3 (Cambrian, Allora, Heurist). Most of the rest are funded incumbents |
| E. Inference paid by the agent (x402 / USDC) | 8 | 0 found for the trading-specific routers |
| F. Strategy marketplace, vault and agent-fund platforms | 14 | 7 (Almanak, Giza, Theoriq, Glider, Infinit, ZyFAI ?, Wayfinder parent) |
| G. Benchmark, competition and arena | 18 | 2 (Nof1, Recall) |
| **Total** | **105 rows (~98 unique; Senpi, Infinit, Virtuals, Olas, Questflow and Bankr appear in two layers)** | |

**Headline patterns**
1. **Execution and wallets are owned by incumbents giving tools away.** Every top exchange now ships an agent MCP/CLI/skill pack: OKX (Mar 3), Binance (Skills Mar → Agent OS Aug 20), Bitget (Feb), Bybit (Mar 13 / Apr 22), Kraken (Mar 11), Coinbase (Jun 11) and Robinhood. All of them sit next to wallet launches from Coinbase (Feb 11), Phantom (Feb 18), Trust Wallet (Mar 26), Circle (May 11), Fireblocks (May 20) and MetaMask (Jun 8 / Aug 6). Tooling is free; revenue is the trading fee.
2. **Pay-per-call data is now standard.** Nansen, CoinGecko, CMC, Birdeye, Messari, Zerion, Elfa, GoPlus and SolEnrich all take x402. Prices run from $0.002 to $0.05 a call. Token-risk checks for agents already exist as paid APIs: GoPlus AI Agent Security API (Mar 27 2026), SolEnrich `enrich-token-full` at $0.004, and x402-seller's rug score at $0.03. So "sell Tocker's gates as an x402 pre-trade check" (note 17) has competitors on price. What it still lacks is a competitor that *enforces* the check.
3. **The money is in wallets and rails, not in trading-agent tools.** The largest disclosed rounds in this map are Turnkey ($30M B plus $12.5M), Catena ($30M A), Recall (~$42M total), Kite ($35M total) and Allora ($35M). In the trading-specific layers (A, C, E) almost nothing has a priced VC round. The routers and SDKs are open source, token-funded or corporate.
4. **Benchmarks keep finding no edge.** Prediction Arena: −16% to −31% on Kalshi over 57 days. Aster S1: AI −4.5% vs humans −32%. Wallet V: 42% of 688 agents flat or better. StockBench: most models fail to beat buy-and-hold. AMA: architecture matters more than the model. DXRG: no directional edge. That is consistent with Tocker's "the edge is in the scaffolding" thesis (note 19).

---

## A. SDK / agent kit / harness (13)

| Name | One-line | Chains | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Solana Agent Kit (SendAI)** | Open-source TS toolkit with 60+ Solana actions (Jupiter, Raydium, Drift…) | Solana | Live, maintenance pace; SendAI "evolving into an applied AI lab" | n/f (described as "backed by Solana Labs", no amount); SEND token | 1.7k★, 881 forks (v, n17) | [GitHub](https://github.com/sendaifun/solana-agent-kit) (v) · [Solana Compass](https://solanacompass.com/projects/sendai) |
| **Coinbase AgentKit** | Wallet + action framework for any agent; Mar 2026 "human-backed" variant with World + Cloudflare | EVM + Solana | Live; health disputed: last stable npm 0.10.4 on Dec 19 2025 (?) | Coinbase (corp) | ~1.28k★ (Aug 17 2026) | [GitHub](https://github.com/coinbase/agentkit) (v) · [Yahoo/Simply Wall St](https://finance.yahoo.com/news/coinbase-agentkit-targets-ai-transactions-080651355.html) |
| GOAT SDK (Crossmint) | Multi-chain agent toolkit | 15+ chains | **Archived** | n/a | — | [GitHub](https://github.com/goat-sdk/goat) (v) |
| **ElizaOS `plugin-auto-trader`** | Official Eliza trading plugin: LLM picks trending tokens, Jupiter swaps, honeypot + RugCheck checks, SL/TP, daily loss cap; defaults to paper | Solana | Beta (Python port 2.0.0a5, Mar 17 2026) | Eliza Labs (token; class action pending ?) | Framework 19.6k★ (v, n17) | [GitHub](https://github.com/elizaos-plugins/plugin-auto-trader) · [PyPI](https://pypi.org/project/elizaos-plugin-auto-trader/) |
| **OpenClaw trading skills / ClawHub** | Default self-hosted agent runtime; skills marketplace | Any | Live | Open source (creator to OpenAI, Feb 2026) | 13.7k+ skills, 311+ finance (Mar 2026). **341 to 1,184 malicious skills** reported (?) | [Aurpay](https://aurpay.net/aurspace/openclaw-ai-trading-skills-complete-guide-2026/) · [Infosecurity](https://www.infosecurity-magazine.com/news/malicious-crypto-trading-skills/) |
| **Hummingbot Condor** | Open-source harness: LLM OODA loop on top, deterministic executors and risk limits below; Hummingbot MCP + Skills | 50+ CEX/DEX incl. Hyperliquid | Live (MCP + Skills open-sourced Feb/Mar 2026) | Hummingbot Foundation (n/f) | Takes a 1 bps HL builder fee | [GitHub](https://github.com/hummingbot/condor) · [Blog](https://hummingbot.org/blog/introducing-condor-the-open-source-harness-for-trading-agents/) |
| **Virtuals GAME + ACP (Butler)** | Agent framework + agent-to-agent commerce; Butler trades Hyperliquid perps via ACP | Base, Solana, HL | Live | Token | aGDP ~$479M (vendor ?) (n17) | [Virtuals X](https://x.com/virtuals_io/status/2000194749597450680) · [ButlerLiquid](https://butlerliquid.com/) |
| **Daydreams / Lucid Agents** | Commerce SDK: agents that pay and sell over x402 + ERC-8004; Lucid no-code host | Base, Solana | Live | DREAMS token; VC n/f | n/f | [GitHub](https://github.com/daydreamsai/lucid-agents) |
| **Olas (Open Autonomy, Pearl)** | Framework + local agent app store; trader agents (Polystrat, Optimus) | Gnosis, Base, Polygon… | Live; Polystrat "maintenance mode" per Messari (?) | Token | **18.2M+ lifetime agent tx (Q2 2026)**; 834 DAA (Q1) | [Olas Q2](https://olas.network/blog/q2-2026) · [Messari](https://messari.io/project/autonolas) |
| **Senpi skills** | MIT repo of Hyperliquid strategy skills (scanner + config + SKILL.md) with two-phase trailing-stop exits; hosted MCP | Hyperliquid | Live (Senpi 2.0 waitlist) | $4.5M seed, Lemniscap, Sep 2025 (n19) | 80+ templates | [GitHub](https://github.com/Senpi-ai/senpi-skills) |
| Polymarket `agents` | Official Python framework for LLM agents on Polymarket | Polygon | **Archived May 11 2026 (?)** | — | — | [GitHub](https://github.com/Polymarket/agents/) |
| Community pump.fun skills (pumpclaw, Pumpfun MCP, PumpApi Agent) | Skills/MCPs to buy, sell and launch on pump.fun; work with Claude Code, Codex, OpenClaw | Solana | Live, unaudited | — | n/f | [awesome-solana-ai PR](https://github.com/solana-foundation/awesome-solana-ai/pull/126) · [PumpApi](https://github.com/PumpApi-io/PumpApi-Agent) |
| Infinit (ADA framework) | Build and deploy DeFi agents; one-click strategies | EVM | Live | $6M seed (Electric Capital et al.), Sep 2024 | n/f | [Cypherhunter](https://www.cypherhunter.com/en/e/infinit-labs-raised-funding-2024-09-12/) · [Tracxn](https://tracxn.com/d/companies/infinit/__F-I-a7Jef3ENygWMkUfLh3JGlUeuQBNjK1xeKT98BIs) |

---

## B. Wallet, policy and payment rail (17)

| Name | One-line | Chains | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Coinbase Agentic Wallets** (n17) | MPC agent wallet, session caps, native x402, `npx awal` | Base, Solana, Polygon; **trades Base only** | Live Feb 11 2026 | Coinbase (corp) | x402 100M agentic tx on Base in 9 months (Chainalysis, Jun 2026) | [Coinbase](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets) · [CryptoBriefing](https://cryptobriefing.com/coinbase-x402-protocol-100m-transactions-base/) |
| **Privy (Stripe)**, Tocker's wallet (n17) | TEE server wallets + off-chain policy engine; AWS AgentCore Payments launch partner (May 2026) | EVM + Solana | Live | Acquired by Stripe Jun 2025 | 120M+ accounts, 2,000+ teams, $15B+/mo volume (platform-wide) | [Genfinity](https://genfinity.io/2026/06/16/privy-stablecoin-wallet-engine-stripe-aws-deel-majority/) · [Stripe](https://stripe.com/newsroom/news/aws-stripe-agentcore-privy) |
| **Turnkey** | Verifiable-cloud key infrastructure; agent wallets + policies | Multi | Live | **$30M Series B led by Bain Capital Crypto (Jun 2025)** + $12.5M strategic (~May 2026); $65M+ total. *Corrects n17, which said "Series A"* | 50M+ wallets | [The Block](https://www.theblock.co/post/357445/former-coinbase-employees-raise-30-million-series-b-crypto-infrastructure-startup-turnkey) · [CryptoBriefing](https://cryptobriefing.com/turnkey-verifiable-cloud-infrastructure-crypto-wallets/) |
| **MetaMask Agent Wallet** | Self-custodial agent wallet: swaps, perps, prediction markets, LP; Guard Mode (limits, allowlists, Blockaid) vs Beast Mode | EVM (12 networks) | Early access Jun 8 2026; **GA Aug 6 2026** | Consensys | $10k/mo loss coverage (n16) | [CoinDesk](https://www.coindesk.com/tech/2026/06/08/metamask-launches-ai-agent-wallet-with-built-in-security-for-crypto-trades) · [CryptoBriefing](https://cryptobriefing.com/metamask-launches-ai-agent-wallet-for-automated-onchain-trading/) |
| **Phantom MCP server** | Agent gets its own Phantom wallet; sign, swap, transfer; no swap fee (n17) | Solana, ETH, BTC, Sui | **Preview, Feb 18 2026** | Phantom (private) | n/f | [CryptoAdventure](https://cryptoadventure.com/phantom-launches-mcp-server-that-lets-ai-agents-sign-and-swap/) · [Phantom docs](https://docs.phantom.com/phantom-mcp-server) |
| **Trust Wallet Agent Kit (TWAK)** | Swaps, DCA and limit orders by agents in two modes: a dedicated agent wallet, or proposals the user approves | 25+ chains incl. Solana, BTC, TON, Tron | Live Mar 26 2026 | Trust Wallet (Binance/CZ) | Pitched at 220M users | [Trust Wallet](https://trustwallet.com/blog/company/introducing-the-trust-wallet-agent-kit-twak-your-ai-agent-can-now-act-on-crypto) · [CMC Academy](https://coinmarketcap.com/academy/article/trust-wallet-launches-ai-toolkit-to-execute-crypto-trades-automatically) |
| **Lit Protocol Vincent** | User-revocable agent wallets bound to "abilities" (Uniswap swap, Aave, deBridge); Vincent DCA app | EVM | Live | $15.2M over 2 rounds (Series A Sep 2022; Tracxn); LITKEY token | **7,000+ Vincent wallets; $500k+ USDC deposited** (Lit blog) | [Lit Spark](https://spark.litprotocol.com/vincent-yield-rewards-airdrop/) · [Tracxn](https://tracxn.com/d/companies/lit-protocol/__VE8Ekeva4-wkXX1Aph2JMaYUnoS-fhyJoA2XT6EbyJQ) |
| MoonPay Agents / Open Wallet Standard (n17) | Non-custodial CLI agent wallets, ramps, swaps, x402; pump.fun sniper skill guide (Jul 2026) | Cross-chain | Live Feb 24 2026 | MoonPay (private) | n/f | [The Block](https://www.theblock.co/post/391038/moonpay-launches-moonpay-agents-to-power-ai-driven-crypto-transactions) · [MoonPay](https://support.moonpay.com/en/articles/629129-automating-the-pump-fun-hunt-a-guide-to-the-ai-memecoin-sniper) |
| **Circle Agent Stack** | CLI, Agent Wallets (global/per-service caps, allowlists, sessions), Agent Marketplace, Nanopayments | EVM (Base, Arb, ETH, Polygon); Arc testnet | Live May 11 2026 | Circle (public) | n/f | [BusinessWire](https://www.businesswire.com/news/home/20260511078086/en/Circle-Launches-AI-Infrastructure-to-Power-the-Agentic-Economy) |
| **Fireblocks Agentic Payments Suite** | Agentic Wallets for fintechs' users (policy engine, x402/MPP); Dynamic as wallet layer | Multi | Live May 20 2026 | Fireblocks (private; acquired Dynamic 2025) | Joined x402 Foundation | [PR Newswire](https://www.prnewswire.com/news-releases/fireblocks-joins-x402-foundation-launches-agentic-payments-suite-302777251.html) |
| Crossmint / lobster.cash | Agent USDC wallet + virtual Visa/Mastercard; smart-contract limits; TEE signer; CLI (Apr 8) | Solana (x402), EVM | Live; Mastercard Agent Pay integration *announced* Apr 16 2026 | n/f this pass | n/f | [PR Newswire](https://www.prnewswire.com/news-releases/lobstercash-partners-with-mastercard-to-enable-secure-ai-agent-payments-for-all-existing-card-holders-302743740.html) |
| Openfort | TEE backend wallets + 4337/7702 session keys (contract, method, cap, window); claims 200ms signing | EVM + Solana | Live | n/f | Vendor-only claims | [Openfort](https://www.openfort.io/solutions/ai-agents) |
| **Catena Labs** | Governance layer for agent transactions (limits, recipients, audit); filed for a national trust bank charter | — | Building | **$30M Series A co-led by a16z crypto + Acrew (May 20 2026)**; $18M seed (2025) | n/f | [The Block](https://www.theblock.co/post/402029/catena-labs-lands-30-million-series-a-files-for-national-trust-bank-charter-to-underpin-agentic-finance) |
| **Kite AI** | Agent payment L1 + Agent Passport (identity + spend limits) + agent app store; x402-native | Kite Chain (Avalanche-based) | Kite Chain + Passport launched Apr 30 2026 | $18M Series A, PayPal Ventures + General Catalyst (Sep 2025) + Coinbase Ventures; **$35M total** | PayPal/Shopify pilots | [GlobeNewswire](https://www.globenewswire.com/news-release/2026/04/30/3285380/0/en/kite-launches-kite-chain-and-kite-agent-passport-enabling-autonomous-ai-agent-payments.html) · [PYMNTS](https://www.pymnts.com/news/investment-tracker/2025/paypal-backed-kite-raises-18-million-for-agentic-web/) |
| Nava (n17, n19) | Escrow + "Arbiter" intent check before an agent tx settles | EVM | Live | $8.3M seed, Polychain + Archetype (Apr 14 2026) | n/f | [Fortune](https://fortune.com/2026/04/14/nava-seed-funding-ai-financial-agents/) |
| Merit Systems (AgentCash, x402scan) | x402/MPP client wallet + MCP; reference x402 explorer | Base, Solana | Live | "a16z crypto backing" (directory only, ?) | n/f | [Merit](https://merit.systems/about) · [GitHub](https://github.com/Merit-Systems/x402scan) |
| AEON | Settlement layer for agent-to-agent interactions | BNB / multi | Building | $8M pre-seed led by YZi Labs (May 18 2026) | n/f | [The Block](https://www.theblock.co/news/deals/2026-05-18-aeon-raises-8-million-yzi-labs-401601) |

*Searched, nothing agent-specific found:* Para, Dynamic (now under Fireblocks), Squads, Safe.

---

## C. Execution API / venue agent tooling (18)

| Name | One-line | Chains / venue | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **GMGN Agent API + OpenAPI skills** (n17) | Long-tail token data (K-lines, insider/bundle/sniper risk) + swaps; Ed25519 keys stay local | SOL, BSC, Base, Robinhood Chain | Whitelist beta Mar 2026 → free self-serve keys by May 13 2026; **429s and BSC signing bugs open Sep 2026** | n/f | GMGN $3.31B DEX volume / 30d (Sep 2026, n17) | [GitHub](https://github.com/GMGNAI/gmgn-skills) · [GMGN X](https://x.com/gmgnai/status/2054772025584238956) · [Issues](https://github.com/GMGNAI/gmgn-skills/issues) |
| **Jupiter agent tooling** (n17) | Skills repo (Swap, Perps, Trigger, Recurring, Prediction Markets…), `jup` CLI (pre-v1 alpha), MCP | Solana | Live | — | n/f | [Skills](https://developers.jup.ag/docs/ai/skills) · [CLI](https://developers.jup.ag/docs/ai/cli) · [GitHub](https://github.com/jup-ag/agent-skills) |
| **OKX OnchainOS + Agent Trade Kit** (n17) | AI Skills, MCP and REST for on-chain + CEX; 500+ DEXs | 60+ chains | Live Mar 3 2026 | OKX (corp) | **1.2B API calls/day, ~$300M daily volume (platform-wide, not agent-only)** | [CoinDesk](https://www.coindesk.com/tech/2026/03/03/okx-jumps-into-ai-agent-race-with-new-onchainos-toolkit) · [Blockhead](https://www.blockhead.co/2026/03/03/okx-builds-ai-agent-infrastructure-into-developer-platform/) |
| **Binance Agent OS** (n17) | MCP + Wallet Agentic Hub + Binance x402 + Skill Hub; one isolated sub-account per agent, no withdrawal scope | Binance CEX + Wallet | Live Aug 20 2026 | Binance (corp) | Adoption n/f | [CryptoTimes](https://www.cryptotimes.io/2026/08/21/binance-launches-ai-trading-platform-agent-os/) · [crypto.news](https://crypto.news/binance-agent-os-ai-trading-safeguards/) |
| **Bitget Agent Hub / GetClaw** (n17) | MCP, CLI, SDK, Skills (9 modules / 58 tools); GetClaw gets its own trading account | Bitget CEX | Live Feb 2026 (upgraded Mar) | Bitget (corp) | **1M+ users made AI trades, $1.2B+ cumulative (GetAgent + GetClaw)** | [GitHub](https://github.com/Bitget-AI/agent_hub) · [Bitget Academy](https://www.bitget.com/academy/bitget-getagent-playbook-introduction-ai-trading-strategies) |
| **Bybit AI Skills + MCP** | Zero-install skill for ChatGPT, Claude, OpenClaw and others (253 endpoints); official MCP for multi-agent trading | Bybit CEX | Skills Mar 13 2026; MCP Apr 22 2026 | Bybit (corp) | n/f | [Chainwire](https://chainwire.org/2026/03/13/bybit-launches-ai-skills-powering-ai-agents-for-crypto-trading-with-zero-setup-253-api-endpoints-and-growing/) · [CoinCodex](https://coincodex.com/article/84158/bybit-introduces-mcp-protocol/) |
| **Kraken CLI** | Open-source Rust single-binary execution engine with built-in MCP; paper mode needs no account | Kraken spot + futures | Live Mar 11 2026 (v0.3.2 Apr) | Kraken (corp) | 134–151 commands | [Kraken blog](https://blog.kraken.com/news/industry-news/announcing-the-kraken-cli) |
| Coinbase for Agents (n17) | MCP/CLI so ChatGPT and Claude trade a Coinbase account | Coinbase | Live Jun 11 2026 | Coinbase (corp) | — | [TechCrunch](https://techcrunch.com/2026/06/11/coinbase-debuts-mcp-for-agent-trading/) |
| Robinhood Agentic Trading MCP (n16) | Brokerage MCP for outside agents (infra side of Robinhood Agents) | Stocks, options, crypto | Live (crypto Jul 2026) | HOOD (public) | 150k+ agentic accounts (n17) | [Genfinity](https://genfinity.io/2026/07/21/robinhood-agentic-trading-crypto-ai-agents/) |
| Crypto.com "Agent Key" | Scoped API key for OpenClaw agents; weekly limits, manual confirmation | Crypto.com | Live | corp | n/f | [Aurpay](https://aurpay.net/aurspace/openclaw-ai-trading-skills-complete-guide-2026/) |
| **Hyperliquid API ("agent") wallets + builder codes** | Trade-only keys (no withdrawals); apps earn up to 10 bps (perps) / 100 bps (spot) per fill | HyperCore | Live | — | **176+ builders, $40M+ builder-code revenue (?)** | [Dexly](https://dexly.trade/learn/hyperliquid-trading-bots) · [Dwellir](https://www.dwellir.com/blog/build-hyperliquid-trading-app-builder-codes) |
| **Uniswap AI (skills + plugins)** | 7 skills launched Feb 20–21 2026 (swap-integration via Trading API…); now dca-bot, copy-trade, pay-with-any-token (x402) | EVM | Live | Uniswap Labs | n/f | [GitHub](https://github.com/Uniswap/uniswap-ai) · [Coinfomania](https://coinfomania.com/uniswap-launches-seven-ai-agent-skills-for-onchain-trading/) |
| **LI.FI API for Agentic Commerce** | Hosted MCP (15+ tools), skills, CLI; cross-chain swaps and bridges | 58 chains incl. Solana, BTC, Sui | Live Mar 2026 | LI.FI (private) | "1,000+ partners" (vendor) | [LI.FI](https://li.fi/knowledge-hub/introducing-li-fis-api-for-agentic-commerce) · [Docs](https://docs.li.fi/agents/overview) |
| **Bankr** (n17, n19) | Agent wallet + swaps/limits/DCA/perps API + x402 Cloud (5% fee) + CLI; most-covered OpenClaw trading skill | Base, Solana, ETH, Arb, Polygon, BNB | Live | Small Coinbase Ventures cheque; BNKR token | $7M+ AUM in Bankr wallets | [Benzinga](https://www.benzinga.com/pressreleases/26/04/51637575/bankr-launches-x402-cloud-on-402-day-as-x402-protocol-joins-the-linux-foundation) |
| PumpPortal | Third-party pump.fun + Raydium trading API; free data WebSocket; local signing; MCP | Solana | Live | n/f | n/f | [PumpPortal FAQ](https://pumpportal.fun/FAQ/) · [QuickNode](https://www.quicknode.com/builders-guide/tools/pumpportal-by-pumpportal-team) |
| Drift SDKs | TS/Python/Rust SDKs used by agents (e.g. RoboNet + Allora perp agent, 2025); **no official agent kit**. Exploit and relaunch reported (?) | Solana | ? | — | — | [Drift docs](https://docs.drift.trade/developers) · [RoboNet](https://medium.com/robonet/robonet-drift-allora-launching-the-first-perp-trading-agent-on-the-robonet-agent-framework-4534700d2d28) |
| Kalshi / DFlow + MCPs (n17) | DFlow tokenises Kalshi on Solana; third-party Kalshi MCPs (BrainDAO; kalshi-mcp.com with 51 tools) | Solana / Kalshi | Live; Quantish winding down | — | n/f | [Solana](https://solana.com/news/dflow-prediction-markets-api) · [BrainDAO](https://github.com/BrainDAO/mcp-kalshi) |
| Polymarket builder program | Builder-fee registry for third-party routers (0.5% per fill per one listing, ?) | Polygon | Live | Polymarket | n/f | [polbots](https://polbots.com/) |

---

## D. Data and signals for agents (x402 / MCP) (17)

| Name | One-line | Chains | Status | Funding | Traction / price | Source |
|---|---|---|---|---|---|---|
| **Nansen API (x402)** | Pro-tier endpoints pay-per-call without an account (Smart Money, screeners) | Pays on Base, Solana, Monad | Live (Apr 2026) | Nansen (incumbent) | **$0.01 basic / $0.05 premium per call** | [Nansen docs](https://docs.nansen.ai/getting-started/agentic-payments/x402-payments) · [CrowdfundInsider](https://www.crowdfundinsider.com/2026/04/274494-blockchain-analytics-firm-nansen-enhances-onchain-data-access-with-pay-per-call-model/) |
| **SolEnrich** | Solana wallet/token enrichment, whale tracking, memecoin "trenches-to-exit" signals; MCP; ERC-8004 registered | Solana data; pays on Solana/Base or Stripe | Live, indie (0xSardius) | n/f | 38–47 endpoints; token-full w/ rug detection **$0.004** | [GitHub](https://github.com/0xSardius/solenrich) · [Site](https://www.solenrich.com/) |
| **Birdeye Data (x402)** | Full REST API pay-per-request (no WebSocket) | Pays on Base/Solana | Live | Birdeye (private) | **$0.003/request** | [Birdeye](https://birdeye.so/data-api/blog/detail/introducing-x402-on-birdeye-data-pay-per-request-api-access) |
| **CoinGecko (x402)** | Price, liquidity, trending pools with no API key | Base | Live | private | ~$0.01/call (?) | [Coinbase](https://www.coinbase.com/developer-platform/discover/launches/coingecko-x402) |
| **CoinMarketCap MCP + x402** | Keyless read-only MCP + x402 API | Base | Live Mar 2 2026 | Binance-owned | $0.01/call | [CMC MCP](https://coinmarketcap.com/api/mcp/) · [CMC X](https://x.com/CoinMarketCap/status/2028516398612586920) |
| Messari (x402) | Data layer opened to agents per call | — | Live | Messari | n/f | [Messari](https://messari.io/report/x402-how-messari-is-opening-its-data-layer-to-autonomous-agents) |
| Zerion API (x402) | Wallet, portfolio, PnL for agents; swaps need a key | Multi | Live | Zerion | n/f | [GitHub](https://github.com/tchaps6/zerion-ai) |
| **Elfa AI (x402)** | Social and market-intel signals; "x402 Auto" LLM analysis with trade signals | Pays on Base, Arb, Polygon, Avax, Solana | Live (Smart Stats sunset Oct 28 2026) | n/f | 1,000 RPM on x402 | [Elfa docs](https://docs.elfa.ai/auto/x402/) |
| **GoPlus AI Agent Security API** | x402 pay-as-you-go: token security, malicious address, tx simulation, rug detection, prompt-injection checks | 40–50+ chains | Live Mar 27 2026 | GoPlus (GPS token) | n/f | [GoPlus X](https://x.com/GoPlusSecurity/status/2037461345902465180) · [TradingView](https://www.tradingview.com/news/coinmarketcal:96e84edc4094b:0-goplus-security-ai-agent-security-api-27-march-2026/) |
| x402-seller (rug score) | Honeypot score + liquidity-drain detector for trading agents; public self-graded record | Base, Solana | Live, indie | — | rug score $0.03, launch radar $0.08 (n16) | [GitHub](https://github.com/wyattpalm2-eng/x402-seller) |
| **Cambrian** | Data API → "verifiable" oracle: lending, DEX liquidity, sentiment for institutions and agents | Base, Solana + EVM | Private beta | **$6M seed co-led by Franklin Templeton + Polychain (Jun 24 2026)**; $11.9M total | 320k DEX pools monitored; TrueNorth only production user | [The Block](https://www.theblock.co/news/deals/2026-06-24-a16z-csx-backed-cambrian-seed-round-blockchain-data-oracle-network-406028) |
| **Heurist Mesh** (n17) | 30+ crypto-analysis agents via MCP, API key or x402 | Multi | Live | $2M pre-seed (Amber et al., Nov 2024); HEU token | Deep Research 1 USDC/query (n18) | [Heurist](https://www.heurist.ai/blog/decentralized-ai-cloud-heurist-raises-2m) |
| **Allora Network** | Decentralised ML price, volatility and liquidity forecasts (5m–24h) as on-chain feeds; Cobot trading tool (May 18 2026) | Ethereum, Cosmos, TRON | Live | **$35M (Polychain, Framework; 2024)**; site claims $68M (?) | Quack AI Q402 agents use feeds (Jun 2026) | [BusinessWire](https://www.businesswire.com/news/home/20240624366383/en/Allora-Labs-Brings-Total-Funding-to-35-Million-With-Latest-Strategic-Round) · [CMC](https://coinmarketcap.com/cmc-ai/allora/latest-updates/) |
| Helius for Agents | Claude Code plugin, MCP, CLI, skills; agents can self-sign-up for keys | Solana | Live | Helius (private) | n/f | [Helius](https://www.helius.dev/blog/helius-for-agents) |
| Moralis MCP | Wallet activity and token metrics via MCP | EVM + Solana | Live | private | n/f | [awesome-crypto-mcp](https://github.com/verixiaapps/awesome-crypto-mcp) |
| Agent402.tools | 500+ pay-per-call tools and reports for agents (x402/MPP), self-hostable | Multi | Live, indie | — | n/f | [GitHub](https://github.com/MikeyPetrillo/Agent402) |
| Cookie DAO (n17) | Agent-activity data after Snaps shut down | Multi | Pivoting | Token | — | [CMC](https://coinmarketcap.com/fr/cmc-ai/cookie/latest-updates/) |

---

## E. Inference paid by the agent (x402 / USDC) (8)

| Name | One-line | Chains | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **BlockRun / ClawRouter** (n17) | Wallet-auth LLM router for OpenClaw; local routing to the cheapest capable model; provider cost +5% | Base, Solana | Live; Base Batch 003 (12 of 1,175 applicants); AWS AgentCore Payments launch partner (Aug 2026) | **No round found** | 66–79 models (varies by version) | [GitHub](https://github.com/BlockRunAI/ClawRouter) · [ChainCatcher](https://www.chaincatcher.com/en/article/2257565) |
| **Bankr LLM Gateway** (n17) | OpenAI-compatible; paid in USDC/USDT from the agent's trading fees | Base, BNB | Live | see C | 30+ models | [Bankr](https://bankr-support.support.site/article/llm-gateway) |
| **Dreams Router (Daydreams)** (n17) | x402 inference for the Vercel AI SDK (Tocker's SDK); "V2 gearing up for relaunch" (early 2026) | Base, Solana | Relaunching (?) | DREAMS token | n/f | [GitHub](https://github.com/daydreamsai/daydreams) · [X](https://x.com/daydreamsagents/status/2019202022776664395) |
| **Venice (x402)** | Private inference; pay per request from a Base wallet, no account; official client; Solana community kit | Base (+Solana community) | Live | VVV/DIEM token | n/f | [GitHub](https://github.com/veniceai/x402-client) · [Docs](https://docs.venice.ai/overview/about-venice) |
| OpenGradient | x402-native TEE inference with on-chain attestation (verifiable output) | — | Live | n/f | n/f | [OpenGradient](https://www.opengradient.ai/blog/x402-opengradient-upgrade-trustless-verifiable-inference) |
| Hyperbolic (x402) | Serverless inference over x402 (2025 announcement) | Base | Live? | n/f | — | [X](https://x.com/hyperbolic_labs/status/1919858876926611706) |
| OpenModels | Chat Completions over x402, 27 models; from 0.1 USDC | Base, Solana | Live (Jul 2026) | n/f | — | [Alephant](https://blog.alephant.io/x402-ai-inference-openmodels-pay-per-call-2026/) |
| Router402 (n17) | OpenRouter-compatible x402 router (HackMoney 2026 finalist) | Base | Hackathon | — | — | [ETHGlobal](https://ethglobal.com/showcase/router402-b717q) |

---

## F. Strategy marketplace, vault and agent-fund platforms (14)

| Name | One-line | Chains | Status | Funding | Traction | Source |
|---|---|---|---|---|---|---|
| **Almanak** (n19) | Build DeFi strategies with coding agents; funds stay in the user's Safe; curated "Treasury" vaults | EVM | Live | ~$8.45M (Aug 2025) | DefiLlama TVL ≈ **$446K** (Oct 2026); Treasury filled $5M → $10M caps in <24h (undated ?) | [Almanak](https://almanak.co/) · [DefiLlama](https://defillama.com/protocol/almanak) |
| **Giza** (n19) | Yield agents (ARMA/Pulse retired Mar 2026) → single "Giza Agent" | Base / EVM | Relaunched Feb 26 2026 | $8.2M over 2 rounds (Tracxn) | "$1.5B routed" (vendor) | [Abstract Horizon](https://www.abstracthorizon.xyz/en/article/giza-agents) · [CryptoBriefing](https://cryptobriefing.com/giza-tech-returns-arma-pulse-funds/) |
| **Wayfinder (Paths)** | Omnichain agent "shells" + Paths: a staked marketplace of agent skills/strategies (creators earn fees, get slashed for bad paths); SDK v0.9.0 with backtesting (Mar 2026) | Omnichain | Paths live Jun 4 2026 | PROMPT token; parent Parallel ~$85M total (Paradigm et al.); Wayfinder-only n/f | 7.6M PROMPT staked in Paths | [CMC](https://coinmarketcap.com/cmc-ai/wayfinder/latest-updates/) · [Tiger Research](https://reports.tiger-research.com/p/wayfinder-eng) |
| **Theoriq (AlphaVault)** | Allocator agent across curated yield strategies; ETH vault + Gold Vault | EVM | Live Dec 5 2025; THQ TGE Dec 2025 | ~$10.2M (seed $4M + seed+ $6.2M; Hack VC, Foresight); "$12M total" (?) | n/f | [Chainwire](https://chainwire.org/2025/12/05/theoriq-launches-alphavault-with-ai-powered-active-management/) · [RootData](https://www.rootdata.com/projects/detail/Theoriq?k=NDM0Mw%3D%3D) |
| **Sail (sail.money / Sailor)** (n17) | Self-custodial Safe + signed on-chain mandate; Sailor runs strategies locally from Claude Code/Codex. *Not Sail Research ($80M inference startup)* | 10 EVM chains | Beta; tiny | n/f | Sailor 8★ (v, n17) | [Sail](https://sail.money/) · [npm](https://www.npmjs.com/package/@sail.money/sailor) |
| **Glider** | Orchestration API for automated on-chain portfolios, embeddable in wallets and agents | EVM | Live | **$4M led by a16z CSX (Apr 2025)**, Coinbase Ventures, Uniswap Ventures | n/f | [BusinessWire](https://www.businesswire.com/news/home/20250415391753/en/Glider-Raises-$4-Million-Strategic-Funding-Round-Led-by-a16z-CSX-to-Transform-Crypto-Portfolio-Management) |
| ZyFAI | Autonomous self-custodial yield agents | Base, Sonic, Arb | Live | ~$2–3M (token sale vs seed, ?) | $12.4M AUM; "$200M moved" (vendor) | [ZyFAI](https://www.zyf.ai/) · [Dropstab](https://dropstab.com/coins/zyfi/fundraising) |
| **Taoshi Vanta (Bittensor SN8)** | Decentralised prop-trading network: miners submit signals, scored on Sortino/Omega; Vanta Trading funds top traders (simulated, up to $2.5M); signals sold via Request Network and the Glitch copy-SaaS | Bittensor; signals for CEX/HL | Live; Vanta Trading Feb 2026; Kraken listed SN8 (Jul 2026) | Subnet token | 10% max drawdown elimination | [PR Newswire](https://www.prnewswire.com/news-releases/taoshi-announces-vanta-trading-a-new-decentralized-prop-trading-evaluation-platform-302686852.html) · [Kraken](https://blog.kraken.com/product/asset-listings/sn8-is-available-for-trading) |
| **Virtuals ACP / Agent marketplace** | Agent-to-agent job marketplace; Butler routes HL trades to ACP agents; "Arena" for trading agents (2026, ?) | Base, Solana | Live | Token | $1.16M cumulative agent revenue (Mar 2026, n17) | [MEXC Learn](https://www.mexc.com/learn/article/what-is-virtuals-protocol-virtual-x402-agent-commerce-protocol-and-ai-agent-economy/1) |
| Olas Mech Marketplace | Agents hire agents (prediction tools for traders); 15% fee burned | EVM | Live | Token | Mech ~2.5M tx (Q1 2026) | [Olas Q1](https://olas.network/blog/olas-q1-2026-roundup) |
| Questflow | "AI finance agent" funds you can follow; CDP wallets + x402; ran an agents-vs-humans arena | Base | Live | n/f | Claims a top-5% Q2 agent with Sharpe 2.4 (vendor) | [Questflow blog](https://blog.questflow.ai/p/we-just-put-ai-agents-and-human-traders) |
| Infinit | One-click DeFi strategies by agents (see A) | EVM | Live | $6M seed (2024) | n/f | see A |
| x402 Bazaar / Agentic.Market (n17) | Discovery marketplaces for pay-per-call services (data, tools) | Base, Solana | Live | Coinbase | 10k+ services (Aug 2026) | [n17] |
| Senpi skills marketplace | Open skills marketplace + Arena of live user strategies; "build your own, not a catalog" pivot (PR #368) | Hyperliquid | Live | see A | $30M+ Arena notional (n19) | [PR #368](https://github.com/Senpi-ai/senpi-skills/pull/368) |

---

## G. Benchmark, competition and arena (18)

| Name | One-line | Venue | Status | Funding | Result / traction | Source |
|---|---|---|---|---|---|---|
| **Nof1 Alpha Arena** | Real-money LLM trading benchmark | HL crypto (S1), US equities (S1.5) | S1 Oct–Nov 2025; S1.5 won by Grok 4.20; **no public S2 as of Aug 2026** | **$15M co-led by SUI Group + Karatage (May 15 2026)** | S1: Qwen3 Max +22.3%, most models lost | [Forklog](https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/) · [TradeRank](https://www.traderank.ai/blog/alpha-arena-alternatives-2026) |
| **Recall** | On-chain agent competition and skill-market network; AgentRank | Base (RECALL) | Live; 2026 activity mostly roadmap | **~$42M total incl. $30M Series A** (Multicoin, USV, Coinbase Ventures) | ~1M users, 2.1M forecasts across 9 contests; Eigen Arena Dec 2025 | [Messari](https://messari.io/project/recall-network) · [Chainwire](https://chainwire.org/2025/12/15/recall-launches-first-verifiable-ai-agent-trading-competition-in-partnership-with-eigencloud/) |
| **DXRG / DX Terminal Pro** (n19) | User-funded LLM agents in a sealed Base memecoin market; two arXiv papers | Base (Uniswap v4); HL (DXAP) | Run Feb 24 2026 (21d) | No VC found | **3,505 agents, ~$20M volume; no directional edge** | [arXiv 2604.26091](https://arxiv.org/abs/2604.26091) · [arXiv 2609.05663](https://arxiv.org/pdf/2609.05663) |
| **Wallet V benchmark** (n19) | Cohort of user-configured LLM agents | HL, Aster | Jun 15 2026 | Virgo Group incubation | 688 agents; 42% PnL ≥ 0 | [Bitcoin.com](https://news.bitcoin.com/wallet-v-launches-public-performance-benchmark-for-ai-trading-agents-on-hyperliquid-and-aster/) |
| **Aster "Human vs AI"** | Live exchange competition: 30 AI agents vs human traders | Aster | S1 ended Jan 14 2026; S2 $150k pool (results n/f) | Aster (exchange) | **AI −4.48% vs humans −32.22%; 0 of 30 AI liquidated vs 43% of humans** | [Chainwire](https://chainwire.org/2026/01/14/aster-human-vs-ai-live-trading-competition-season-1-concludes/) |
| **Prediction Arena** (arXiv) | Frontier models with $10k each trading live on Kalshi + Polymarket for 57 days | Kalshi, Polymarket | Jan 12 – Mar 9 2026 | Academic | **Kalshi −16.0% to −30.8%; Polymarket avg −1.1%** | [arXiv 2604.07355](https://arxiv.org/abs/2604.07355) |
| Senpi Arena / Predators | Public board of live user agents | HL | Live | see A | $30M+ notional (n19) | [Senpi](https://senpi.ai/) |
| Questflow arena | Agents and humans in one competition | — | Q2 2026 | n/f | vendor claims | [Questflow](https://blog.questflow.ai/p/we-just-put-ai-agents-and-human-traders) |
| TradeRank.ai | 18 models, $10k simulated each, crypto + US equities; seasonal | Simulated | Live (S9, Oct 2026) | n/f | Model names unverifiable (?) | [TradeRank](https://www.traderank.ai/) |
| TradingArena.ai | Frontier LLMs paper-trading $10k accounts | Simulated | Live | n/f | — | [TradingArena](https://www.tradingarena.ai/leaderboard) |
| AI Trader Arena | Shared rules, explicit costs, inspectable artifacts | Mixed | Live | n/f | — | [AI Trader Arena](https://www.aitraderarena.com/) |
| Quote.Trade Alpha League | Humans, bots and AI agents on one DEX | Quote.Trade | Through Dec 31 2026 | n/f | — | [Manila Times/GNW](https://www.manilatimes.net/2026/09/30/tmt-newswire/globenewswire/quotetrade-launches-v6-of-ai-native-crypto-dark-pool-dex-announces-alpha-league-trading-competition-at-korea-blockchain-week/2435554) |
| Liquidity Arena 2026 (Kaggle) | AI quant competition by LiquidityTech | — | Jul 15 – Aug 15 2026 | — | — | [Kaggle](https://www.kaggle.com/competitions/liquidity-arena-ai-quant-trading-competition) |
| LiveTradeBench (UIUC) | Live data; 21 LLMs on US stocks + Polymarket | Live/paper | Nov 2025 | Academic | LMArena score vs return Spearman **0.054** | [arXiv 2511.03628](https://www.arxiv.org/pdf/2511.03628) |
| Agent Market Arena (AMA) | Lifelong multi-market benchmark of agent *frameworks* | Live | Oct 2025 (v2) | Academic | Architecture matters more than the model | [arXiv 2510.11695](https://arxiv.org/abs/2510.11695) |
| StockBench | Daily sequential stock trading (Mar–Jul 2025 data) | Backtest | ICLR 2026 (rev. Mar 2 2026) | Academic | Most models fail to beat buy-and-hold | [arXiv 2510.02209](https://arxiv.org/abs/2510.02209) |
| AI-Trader | Agents in real-time markets | Live | Dec 2025 | Academic | n/f | [arXiv 2512.10971](https://arxiv.org/pdf/2512.10971) |
| Foresight Arena / KalshiBench | On-chain forecasting benchmark; calibration via Kalshi | Prediction markets | 2025–26 | Academic | — | [arXiv 2605.00420](https://arxiv.org/pdf/2605.00420) · [arXiv 2512.16030](https://arxiv.org/pdf/2512.16030) |

---

## Corrections and conflicts surfaced in this pass
- **Turnkey's $30M was a Series B** (Jun 2025, Bain Capital Crypto), not a Series A as note 17 says. A $12.5M strategic round followed (~May 2026).
- **MetaMask Agent Wallet** opened to everyone on **Aug 6 2026**; Jun 8 was early access.
- **Phantom MCP** is still a *preview* npm package (Feb 18 2026). No GA found.
- **GMGN Agent API** is now self-serve with free keys (May 2026), not whitelist-only as note 17 implies. Rate-limit and BSC signing issues were still open in Sep 2026.
- **"Sail funding"** results are Sail *Research* ($80M, Sequoia/Kleiner; inference). That company is unrelated to sail.money.
- **Polymarket `agents`** may be archived (May 2026, secondary source).
- **x402 scale:** 100M agentic tx on Base in 9 months and $24.2M 30-day volume (Chainalysis, Jun 2026) vs "165M tx / 69k agents / $50M" (Apr 2026, secondary). Agentic.Market "480k transacting agents" (?). Allium puts genuine agent commerce on Solana at ~$1.6M/month. Use none of these as demand proof.

## Searched, not found
Funding for BlockRun, Daydreams, SendAI, Senpi (2026), GMGN, Venice, OpenGradient, Crossmint (this pass), Merit (beyond a directory mention); Gate/KuCoin agent MCPs; an official Drift agent kit; an official RugCheck or Webacy x402 endpoint; Kaito agent API; Nof1 Season 2 results; Recall 2026 contest results; agent-specific usage for Privy, OKX OnchainOS or Binance Agent OS.
