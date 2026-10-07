# 18: Memecoin market now, SolEnrich, multi-chain wiring cost, x402 inference (as of 2026-10-07)

**How to read the sourcing.** The agent proxy blocked every non-GitHub host I tried (coingecko.com, solenrich.com, theblock.co, blockworks.co, cryptobriefing.com, blockrun.ai, pay.sh, openrouter.ai, x402.org, defillama, dune, coinmarketcap). Two kinds of figure follow:
- **(s)**: taken from a WebSearch result snippet only. I did not read the page.
- **(v)**: I fetched and read the page (GitHub only).

Confidence: **high / med / low**. Check every (s) figure at the source before the deck goes out. I hit the 200-call search budget before finishing §4, so the gaps are listed at the end.

---

## 1. Memecoin market: trading value now

### Headline for the slide

> **"$5.2B of Solana memecoins traded in a single week."**
> Blockworks data, week ending 26 Aug 2026, via [Solana Compass](https://solanacompass.com/news/solana-memecoin-spot-volume-hits-52b-in-a-week-the-highest-reading-since-november-2025) and [Crypto Briefing](https://cryptobriefing.com/solana-reclaims-memecoin-volume-robinhood/) (s) · med-high. It was the highest weekly reading since Nov 2025. Solana carried ~85% of meme spot volume across five ecosystems that week.

This is the one to use. It comes from a named data provider (Blockworks), it is on-chain DEX volume (Tocker's actual venue) and it is recent. Two dated alternatives for a "now" feel:
- **"~$35B memecoin market"**: CoinGecko Meme category, ~6 Oct 2026, via [crypto.news](https://crypto.news/best-memecoins-to-buy-in-october-2026-five-names-and-their-limits/) / [Analytics Insight](https://www.analyticsinsight.net/meme-coin/memecoins-in-2026-understanding-their-risks-and-regulatory-landscape) (s) · med.
- **"~$9.6B of memecoins traded in 24h"**: 1 Oct 2026 ("top meme coins" mcap $60.88B, 24h volume $9,624,171,383), via [CoinGape](https://coingape.com/meme-coin/) (s) · low-med. This includes CEX volume and uses a broader category than CoinGecko's (its market cap is ~1.7× CoinGecko's), so don't put it next to the $35B.

*Spoken:* "Solana traders swapped five billion dollars of memecoins in a single week this summer."

### Market cap (category level)
| Figure | Date | Source | Conf. |
|---|---|---|---|
| ~$35B (DOGE ~$14.7–14.8B, SHIB ~$3.4B, PEPE ~$1.8B) | ~6 Oct 2026 | CoinGecko Meme category via [crypto.news](https://crypto.news/best-memecoins-to-buy-in-october-2026-five-names-and-their-limits/), [Analytics Insight](https://www.analyticsinsight.net/meme-coin/memecoins-in-2026-understanding-their-risks-and-regulatory-landscape) (s) | med |
| $31.2B, ~6,270 tokens, −4.7% 24h (DOGE $12.59B, SHIB $2.95B, M $2.53B, PUMP $1.65B, PEPE $1.41B) | 16 Sep 2026 | [CoinDCX](https://coindcx.com/blog/crypto-highlights/top-memes-coins/), CoinGecko data (s) | med |
| $30.6B | 25 Jun 2026 | CoinGecko via [CoinLaw](https://coinlaw.io/memecoin-statistics/) (s) | med |
| $60.88B mcap, $9.62B 24h volume (broader "top meme coins" set, CEX+DEX) | 1 Oct 2026 | [CoinGape](https://coingape.com/meme-coin/) (s) | low-med |
| For context: $150.6B peak (Dec 2024), ~$41B by Dec 2025 | — | see 04-market-size.md (CoinGecko 2025 report) | high |

Other undated CoinGecko snippets ($24.8B with $886M 24h volume; $27.82B) are stale cache. Ignore them.

### On-chain trading volume (DEX)
- **Solana memecoins: $5.2B in one week** (w/e 26 Aug 2026). Over the same week Robinhood Chain did **$389M** in memes, BNB **$412.4M** (5.8% of its $7.1B spot), and Base **$31.06M** (0.5% of its $6.55B spot). Solana total DEX volume that week was ~$21.2B, so memes were ~25% of it. Blockworks data via [Solana Compass](https://solanacompass.com/news/solana-memecoin-spot-volume-hits-52b-in-a-week-the-highest-reading-since-november-2025), [Crypto Briefing](https://cryptobriefing.com/solana-reclaims-memecoin-volume-robinhood/), [SolanaFloor](https://solanafloor.com/news/solana-reclaims-memecoin-volume-dominance-from-robinhood-and-bnb-chain-capturing-85-market-share) (s) · med-high.
  - **Base is not a memecoin venue.** It did $31M in memes against Solana's $5.2B. Don't sell Base on memes.
- **Late May 2026 trough: ~$1.8B a week**, so August was ~3× in under three months ([Crypto Briefing](https://cryptobriefing.com/solana-memecoin-volume-seven-month-high/), (s) · med).
- **Solana held 67% of all memecoin spot-DEX volume on 7 Sep 2026**, against Robinhood's 23% (Blockworks, via search, (s) · med). Another snippet describes this as "memes = 67% of Solana DEX volume". That reading is probably a misquote, so use the share-of-memes wording.
- **Major meme markets: ~$361M in 24h on 6 Oct 2026 (−23.8% d/d).** Solana $211M (58.5%), Robinhood $76.6M (21.2%), BNB $60.9M (16.9%) ([TokenPost](https://www.tokenpost.com/news/investing/26927), (s) · med). Earlier prints from the same series: $538M ([TokenPost](https://www.tokenpost.com/news/investing/24518)) and $448M ([TokenPost](https://www.tokenpost.com/news/investing/24701)) (s). **Early October is quieter than late August.** Only use the $5.2B figure with its date.
- **Solana 30-day DEX volume: $75.42B** (Sep 2026, [Analytics Insight](https://www.analyticsinsight.net/cryptocurrency-analytics-insight/why-memecoins-are-expanding-across-multiple-blockchain-networks), (s) · low-med). The same snippet says "$726.7M = 27.2% memecoins". That doesn't add up for 30 days and is probably a daily figure, so don't use it.
- **Solana daily DEX volume: $3.06B on 3 Oct 2026**, ahead of Ethereum, L2s and Hyperliquid ([CoinTurk](https://en.coin-turk.com/solana-tops-ethereum-l2s-and-hyperliquid-in-dex-volume-with-3-06-billion-daily-total/), (s) · med).
- **Robinhood Chain memecoins: ~79% of its DEX activity at launch** (mainnet 1 Jul 2026). It peaked at ~$443M of DEX volume in a day, and revenue later fell 83% ([Crypto Briefing](https://cryptobriefing.com/robinhood-chain-memecoin-trading-surge-collapse), [Crypto Briefing](https://cryptobriefing.com/robinhood-chain-revenue-falls-83-percent/), [The Block](https://theblock.co/post/409813/robinhood-chain-deposits-climb-volume-users-fade-memecoin-fueled-launch), (s) · med).

### pump.fun and launchpads
- **Lifetime revenue $1.23–1.26B by late Aug 2026.** That passes Hyperliquid's ~$1.19B, and pump.fun is the first Solana app over $1B ([KuCoin News](https://www.kucoin.com/news/flash/pump-fun-surpasses-hyperliquid-in-monthly-revenue-for-first-time-since-april-2025), [Crypto Briefing](https://cryptobriefing.com/pumpfun-surpasses-hyperliquid-monthly-revenue-2026/), (s) · med). The $1B crossing (Mar 2026) is high-confidence, per [The Block](https://www.theblock.co/post/393358/pump-fun-becomes-solanas-first-1b-revenue-platform).
- **30-day revenue $33.73M against Hyperliquid's $32.73M (9 Aug 2026).** It was the first time pump.fun led since Apr 2025. Total fees were $84.35M over the same 30 days (same sources, (s) · med).
- **Week of 3–9 Aug 2026: $10.03M fees** (first $10M week) on **$2.97B of volume** (PumpSwap $2.22B plus bonding curve $751.6M). 2.15B PUMP (~$5.02M) was bought back that week ([Parameter](https://parameter.io/pump-fun-pump-surges-33-as-platform-records-first-ever-10m-weekly-fee-milestone/), [AMBCrypto](https://ambcrypto.com/why-pump-funs-2-97b-volume-surge-faces-a-6-88b-pump-supply-test/), [crypto.news](https://crypto.news/pump-fun-fees-top-10m-as-revenue-overtakes-hyperliquid/), (s) · med).
- **Weekly revenue later hit $13.68M** (Aug 2026, highest since Feb 2026), with a trailing 30-day of $42–48M ([Crypto Briefing](https://cryptobriefing.com/pumpfun-daily-revenue-highest-since-september/), (s) · med).
- **Quarterly gross revenue (DefiLlama): Q1 2026 $287.1M, Q2 2026 ~$155M.** For comparison, Q3 2025 was $229.1M and Q4 2025 $245.6M ([DefiLlama](https://defillama.com/protocol/pump.fun), (s) · med). I found no Q3 2026 figure.
- **PumpSwap ran 67.4% of all Solana DEX volume on 23 Sep 2026** ([CoinPaprika](https://coinpaprika.com/education/dex-market-share-by-chain/), (s) · med).
- **38,526 pump.fun launches on 17 Sep 2026.** Daily counts held at 30k–38k+ through mid/late September (MemeFees data via search, (s) · low-med).
- **Don't use these:**
  - "PumpSwap $15B in September (19.2% of Solana)": an unverified social post ([CoinGabbar](https://www.coingabbar.com/en/pump-fun-price-prediction-why-pump-falls-3-8-despite-15b-dex) flags it).
  - "Bonding curve $1.06B + PumpSwap $3.06B in the week of 21–27 Sep": the source is an unofficial X newsletter ([@sapijiju](https://x.com/sapijiju/status/2094420414818648544)) whose post ID decodes to **31 Aug 2026**, so the week label is wrong.
  - "$97.57B cumulative / $2.61B last 30d": source unclear, and it conflicts with DefiLlama's >$150B cumulative.
  - "pump.fun 70.2% / LetsBonk 17.9% launchpad share on 7 Sep": the Bitget item is probably from **2025**, not 2026.

---

## 2. SolEnrich (solenrich.com)

**What it is.** A pay-per-call Solana on-chain intelligence API for AI agents. Site title: "SolEnrich: Trenches-to-Exit Intelligence for Solana Agents" ([solenrich.com](https://www.solenrich.com/), (s)). README one-liner: *"Solana onchain data enrichment agent. Accepts USDC micropayments via x402 and returns enriched wallet, token, and transaction data"*. It returns structured JSON for agents or natural-language briefings for LLMs ([GitHub README](https://github.com/0xSardius/solenrich), (v)).

**Our three endpoints: all three checked against the README (v), 7 Oct 2026**
| endpoint | price | README wording |
|---|---|---|
| `new-tokens` | **$0.012** | "Recently launched tokens, enriched + risk-scored, safest first" (Discovery) |
| `enrich-token-full` | **$0.004** | "+ Top 20 holders, HHI concentration, volatility metrics" |
| `query` | **$0.003** | "Plain English questions routed to the right enricher" |

- Our live probe (src/lib/data-sources/solenrich.ts, 21 Sep 2026) got an x402 **v2** 402. It offered Solana USDC `amount: "12000"` ($0.012) with a `feePayer`, and Base USDC as an alternative. Endpoints are POST-only.
- **The endpoint count keeps growing.** Counts by source:
  - GitHub repo description: "38 pay-per-call" (v).
  - Profile pin: 45 (v).
  - Site: "47 endpoints" (s).
  - Our `/.well-known/x402` probe: 44 paid entrypoints (Sep 2026).
  - README: **50 (49 paid + 1 free)** across Core, Premium, Comparison, Temporal, Discovery, Perps (8), Orchestration, Trenches (5), Collectibles, StonkFun (11), Intelligence Feed and NL (v).
  - On the slide, say **"40+ paid endpoints"**.
- **Price range: $0.002–$0.10 per call.** Payment is USDC over x402 on **Solana or Base**, or card via **Stripe**, with "no API keys or subscriptions" ([solenrich.com](https://www.solenrich.com/), (s)). Example prices from the README (v):
  - `enrich-wallet-light` $0.002
  - `exit-signal` $0.04
  - `smart-money-trenches` $0.05
  - `wallet-link-check` $0.03, added 3 Oct 2026 (commit log)
- **Trenches suite** ((s), via search of solenrich.com / GitHub):
  - `runner-scan`: buy-rate acceleration.
  - `smart-money-trenches`: proven-winner wallet buys.
  - `trenches-scan`: ranks memecoins by composite score into HIGH_CONFLUENCE / MODERATE / SINGLE_SIGNAL.
  - `exit-signal`: returns EXIT / DERISK / HOLD from sell pressure, buy-rate deceleration, volume fade, top-holder flow, liquidity trend and holder churn.
  - Also covers cross-venue perps structure (Jupiter, Adrena, Flash, Hyperliquid, dYdX).
- **Data sources:** Helius (DAS, RPC), DexScreener, Birdeye, Jupiter, DeFi Llama, Solana RPC, Hyperliquid, dYdX v4 (README, (v)).
- **MCP:** a streamable-HTTP endpoint at `https://api.solenrich.com/mcp` with 48 tools for Claude Desktop, Claude Code and Cursor (README, (v)). It is listed on [Glama](https://glama.ai/mcp/connectors/io.github.0xSardius/solenrich) and in the x402 Bazaar on [OpenSea tools](https://opensea.io/tools/x402-bazaar/base/7101652325057752559) (s).
- **Who is behind it: a solo builder, "Sardius" ([@0xSardius](https://github.com/0xSardius)).** GitHub bio: "Fullstack Onchain App Dev | AI Engineer | v0 Ambassador | Building Onchain Agentic Products". Alexandria, VA. Runs Web3 Consulting (web3consulting.dev). X: @0xSardius. 20 GitHub followers (v). I found no company, funding or team.
- **Timeline, from the commit log (v):**
  - 20 Feb 2026: initial commit.
  - 24 Feb: "Scaffold Lucid agent with Hono adapter" (built on Daydreams' Lucid agent kit).
  - 15 Mar: landing page.
  - **18 Mar 2026: "Bags submitted, post-launch hardening complete"**, its entry to the Bags Hackathon (bags.fm announced the hackathon in Mar 2026, [Business Wire](https://www.businesswire.com/news/home/20260320414386/en), (s)).
  - 19 Mar: remote MCP.
  - Still shipping daily: `stonk-creator` endpoint added 6 Oct 2026.
  - Repo: MIT, ~439 commits, 2 stars.
- **Token:** a $SE creator token trades on Bags at a **~$4K market cap** ([DexScreener](https://dexscreener.com/solana/677cppeokvo9tycybhqtixzivupdpxeigd3fspwubags), (s)). It's immaterial, so leave it out of the deck.
- **Risk note for diligence:** this is a one-person hackathon project, and response shapes are undocumented (the OpenAPI declares bare `object`). It sits behind `experimental: true` in our registry. Present it as "one of the x402 sources agents can buy", not as a partner.

**One-line slide description:** *SolEnrich: Solana on-chain intelligence sold per call over x402 (from $0.002). It returns new launches ranked safest-first, holder concentration, smart-money buys and exit signals.*

**The question it answers for an agent:** *"Of the tokens that launched in the last hour, which ones are safe enough to buy, and is it time to sell the one I hold?"*

---

## 3. Multi-chain wiring cost ("to trade across chains you must wire each one yourself")

### Crisp, citable stats
1. **Every chain has a different winning venue.** On 23 Sep 2026:
   - PumpSwap ran **67.4%** of Solana's DEX volume.
   - PancakeSwap ran **95.4%** of BNB Chain's.
   - Aerodrome ran **>50%** of Base's.
   - Uniswap led **nine** other chains.

   Source: [CoinPaprika, "DEX market share by chain"](https://coinpaprika.com/education/dex-market-share-by-chain/) (s) · med. An agent that wants the liquidity has to integrate a different venue on each chain.
2. **The market spans 461 chains and ~900–970 DEXs.** DefiLlama tracks **461 chains and 8,000+ protocols** (18 Aug 2026), and its DEX analytics cover **~890–970+ DEXs** ([DefiLlama](https://defillama.com/dexs/chains) via [Eco](https://eco.com/support/en/articles/14800367-defillama-free-tvl-and-defi-analytics) / [Datawallet](https://www.datawallet.com/crypto/defillama-explained), (s) · med). Liquidity is still concentrated: Ethereum, BNB and Solana hold ~76% of DEX volume and Base ~14% ([Coin Edition](https://coinedition.com/ethereum-bnb-chain-and-solana-capture-three-quarters-of-global-dex-volume/), CoinGecko data, (s), date not in snippet).
3. **Agencies quote $200k–$500k+ for a production multi-venue 24/7 trading system.** The same estimates put a prototype at $15k–$60k and an MVP with limited live trading at $60k–$200k. Timelines run 4–6 weeks for a simple single-exchange bot and **3–6 months** for an AI bot with multi-exchange execution and DeFi integration. The wording behind this: "each exchange has its API… the more exchanges the bot supports, the higher the development cost". Sources: agency blogs, e.g. [PixelPlex](https://pixelplex.io/blog/crypto-arbitrage-bot-development/), [Appinventiv](https://appinventiv.com/blog/crypto-trading-bot-development/), [Merehead](https://merehead.com/blog/crypto-trading-bot-development-company/), [Devtechnosys](https://devtechnosys.com/insights/develop-a-crypto-arbitrage-trading-bot/) (s) · low. These are vendor marketing ranges, and the snippet didn't pin each tier to one URL. Use them as "agencies quote…", never as a market fact.
4. **Retail alternative:** bot subscriptions run **$49–$299/month**. On Solana, Jito tips and priority fees "often eat 1–5% of trades" ([Coincub](https://coincub.com/blog/are-crypto-trading-bots-worth-it/), (s) · low).

### What "wiring each venue" means (the checklist an agent builder faces)
| Venue | Chain / gas | Keys & auth | Setup before the first trade | Source |
|---|---|---|---|---|
| Solana memecoins (PumpSwap, Jupiter, Raydium) | Solana · **SOL** gas + priority fees / Jito tips | ed25519 keypair, Solana RPC | SPL token accounts, router integration | CoinPaprika (s); Coincub (s) |
| Base tokens (Aerodrome, Uniswap) | Base · **ETH** gas | secp256k1 key, Base RPC | ERC-20 approvals per router | CoinPaprika (s) |
| **Robinhood Chain** stock tokens + memes | Arbitrum Orbit L2, **chain ID 4663**, **ETH** gas, own RPC `rpc.mainnet.chain.robinhood.com`, mainnet Jul 2026 | separate EVM network config | bridge in; **stock tokens not offered to US users** | [QuickNode](https://www.quicknode.com/guides/robinhood/what-is-robinhood-chain), [Chainstack](https://docs.chainstack.com/reference/robinhood-getting-started.md), [OrbitFlare](https://docs.orbitflare.com/robinhood-chain) (s); 14-tokenized-stocks.md |
| **xStocks** (tokenized US equities) | Solana SPL (also other chains) | Solana key | route via Jupiter/Raydium; 1:1 custodied shares | [Solana case study](https://solana.com/news/case-study-xstocks), [Bitquery](https://docs.bitquery.io/docs/blockchain/Solana/xstocks-api/) (s) |
| **Ondo Stocks** (ex-Ondo Global Markets) | Ethereum, BNB Chain, Solana | **separate Ondo API** with permissioning "as blockchain tokens analogous to API keys"; non-US | mint/redeem via API or contract | [Ondo docs](https://docs.ondo.finance/api-reference/overview), [Ondo blog](https://ondo.finance/blog/introducing-ondo-global-markets) (s) |
| **Polymarket** | Polygon, **chain ID 137** | private key, then **derive API key/secret/passphrase** (L1 to L2 auth), pick a signature type (EOA / Magic / proxy), set a **funder (proxy) address** | EOA wallets must **approve USDC and the CTF token for three exchange contracts** before trading. CLOB V2 (28 Apr 2026) moved collateral to pUSD | [py-clob-client README](https://github.com/Polymarket/py-clob-client) (v; the README predates V2); 13-polymarket.md |

**Slide-ready line (derived from the table, not a quoted stat):** *"Memecoins, stocks and prediction markets take 4 chains, 3 gas tokens, 2 key types and a separate order-book API with its own credentials and approvals. Every builder wires that by hand. Agencies quote $200k+ to build it."*

---

## 4. x402 inference: LLM calls paid per request in USDC

### BlockRun (blockrun.ai)
**Disclosure:** Tocker's founder leads product and growth at BlockRun (pitch-3min.md). Say so if the deck cites it.
- **What it is:** "The routing & payment layer for AI" ([blockrun.ai](https://blockrun.ai/), (s)); "The Discovery Layer for AI Agent Payments" ([awesome-blockrun](https://github.com/BlockRunAI/awesome-blockrun), (v)). It's an **accountless, OpenAI-compatible gateway** to frontier models (OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Moonshot, MiniMax), paid per request in **USDC over x402**.
  - Chains: **Base or Solana** (Solana recommended for new wallets), plus Circle's Arc.
  - The README also lists Polygon, Arbitrum, Optimism and Unichain.
- **How payment works** ([blockrun-llm-ts](https://github.com/BlockRunAI/blockrun-llm-ts), (v)): request, then 402 with a price, then the SDK signs a USDC transfer locally (EIP-712 on EVM or a Solana signature), then it retries with proof. The key never leaves the machine. npm: `@blockrun/llm`; Python and Go SDKs too.
- **Pricing:** per-token chat is provider cost plus a **flat $0.001 per request, with no margin**. Media and search carry 5% (awesome-blockrun, (v)). "$5 in USDC gets you thousands of requests" ([pay.sh listing](https://pay.sh/services/blockrun/blockrun), (s)).
- **Model count varies by page:** 86 models / 11 providers (README, (v)); 113 ([user.blockrun.ai](https://user.blockrun.ai/), (s)); 82 chat models in ClawRouter (v).
- **ClawRouter:** an open-source (MIT) local router that picks a model in <1ms, with **6.6k GitHub stars**. It claims to be "84% cheaper than pinning Claude Opus 5" on `auto` and 98% on `eco` ([GitHub](https://github.com/BlockRunAI/ClawRouter), (v)).
- **Partnerships:** Circle Alliance Partner, and launch partner for **Amazon Bedrock AgentCore Payments (GA Aug 2026)** (awesome-blockrun, (v), self-reported).
- **Traction:**
  - "**28.9M transactions settled on-chain as of 2026-10-02**, #1 in agent payments" ([blockrun.ai](https://blockrun.ai/), (s), self-reported).
  - x402 transaction volume **doubled in June 2026 vs May, "primarily driven by the AI inference routing service BlockRun"** ([HTX News](https://www.htx.com/news/june-transaction-volume-doubles-x402-ecosystem-continues-to-TkG3NGx4/), (s) · med).
  - The official x402 account posted that "BlockRun serves as the unified payment gateway…" ([x.com/x402](https://x.com/x402/status/2069030513722179918), 22 Jun 2026 decoded from post ID, (s)).

### Others (inference paid per call over x402)
- **Coinbase / x402 "upto" scheme:** usage-based pricing went live for "variable-cost services… such as LLM inference". Buyers authorize a ceiling and are charged actual usage. EVM only, gasless via the CDP facilitator ([Cointelegraph](https://cointelegraph.com/news/coinbase-x402-rolls-out-usage-based-pricing-agentic-ai), [Forklog](https://forklog.com/en/news/developers-of-x402-implement-usage-based-ai-computation-payments), (s), 2026, exact date not captured). The original x402 README already used "generating tokens from an LLM" as the `upto` example ([coinbase/x402](https://github.com/coinbase/x402), (v)). The repo has moved to the x402 Foundation.
- **Daydreams Router (V2):** "x402 LLM inference for agents" ([@daydreamsagents](https://x.com/daydreamsagents/status/2019202022776664395), 5 Feb 2026 decoded from post ID, (s)). SolEnrich itself is built on Daydreams' Lucid agent kit.
- **Heurist:** x402 is integrated into Heurist Mesh and Deep Research, at **1 USDC per Deep Research query** (via [Bitget "x402 Doers List"](https://www.bitget.com/news/detail/12560605038268), (s), date not captured).
- **OpenModels:** per-call inference in USDC with no account or API key. From 0.1 USDC, with a 10 USDC authorization ceiling per call (3 Jul 2026, [Alephant blog](https://blog.alephant.io/x402-ai-inference-openmodels-pay-per-call-2026/), (s)).
- **Router402:** an OpenRouter-compatible gateway on Base. Each call settles the previous call's exact cost in USDC ([router402.xyz](https://www.router402.xyz/), [ETHGlobal showcase](https://ethglobal.com/showcase/router402-b717q), (s)).
- **OpenRouter-over-x402 wrappers:** community wrappers, not official OpenRouter products: [0xshae/x402-openrouter-tutorial](https://github.com/0xshae/x402-openrouter-tutorial) ($0.001 per call), [ekailabs/x402-openrouter](https://github.com/ekailabs/x402-openrouter) and [oponfil/x402gate](https://github.com/oponfil/x402gate) (Base or Solana) (s). I found **no first-party OpenRouter x402 support**, so don't claim it.
- **Solana x402 Hackathon** (build 28 Oct–11 Nov 2025, winners 17 Nov 2025): winners included Agentx402 ("advanced AI model without subscription") and Galaksio (USDC for compute) ([solana.com/x402/hackathon](https://solana.com/x402/hackathon), (s)).
- **Ecosystem scale:** ~**75M x402 transactions and ~$24M** of volume in the trailing 30 days (late Sep 2026), from ~94k buyers to ~22k sellers ([MoneyCheck](https://moneycheck.com/x402-payments-protocol-gains-support-from-visa-mastercard-and-ripple/), (s) · low-med). Visa's Sheffield puts *adjusted* x402 volume at ~$19M ([The Defiant](https://thedefiant.io/converge/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m), (s)). Hyperbolic (GPU inference) is among the named x402 backers ([Wikipedia: X402](https://en.wikipedia.org/wiki/X402), (s)).

**Slide-ready line:** *"Inference is already an x402 purchase. BlockRun sells 80+ frontier models per call in USDC on Solana or Base, with no API key, and has settled 28.9M payments."* Disclose the founder's BlockRun role next to this line.

---

## Gaps / to verify before print
- Open the [CoinGecko Meme category](https://www.coingecko.com/en/categories/meme-token) live on pitch day and replace the ~$35B with the day's figure and its 24h volume.
- Ask Blockworks Research (or check its dashboard) for a **September 2026 monthly** Solana memecoin spot-volume total. None surfaced, and that is the cleanest "last 30 days" number.
- BlockRun's 28.9M transactions and Bedrock AgentCore partnership are self-reported. Cite x402scan or Dune if the deck needs independent proof.
- Search budget ran out before I could cover **Questflow**, the exact date of Coinbase's `upto` launch, and Heurist's x402 launch date.
