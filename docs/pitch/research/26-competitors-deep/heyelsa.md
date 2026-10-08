# HeyElsa (heyelsa.ai): verified profile, Oct 8, 2026

**Method.** WebFetch could not resolve heyelsa.ai, x402.heyelsa.ai, blog.heyelsa.ai, docs.heyelsa.ai, CoinMarketCap or Zerion (DNS errors), and curl through the proxy was refused. So every heyelsa.ai claim below comes from search-engine extracts, marked **(s)**. GitHub pages *were* reachable, so anything sourced to github.com/HeyElsa was read first-hand, marked **(gh)**. X post dates come from decoding the post IDs.

**Labels.** **Verified** = independent or primary first-hand. **Self-reported** = the company's own claim. **Third-party** = an aggregator or exchange explainer.

---

## 1. What it is
- **One sentence.** A chat-to-execute crypto "co-pilot": you type or speak an intent ("swap 100 USDC to ETH on Base", "open a 2x SOL long") and Elsa builds and runs the swaps, bridges, staking or perp orders.
- **Product surfaces:**
  - Web app (app.heyelsa.ai), with chat and voice.
  - Email-login MPC wallets: each user gets an EVM wallet plus a Solana "Elsa Smart Wallet", or connects their own wallet (s, docs.heyelsa.ai field guide).
  - An embeddable widget and SDK for dApps (s, docs).
  - **x402 pay-per-call DeFi API and MCP server**, live Dec 5, 2025 (X post 1996914985033760870).
  - OpenClaw / skills.sh agent skills (gh).
  - An agent-builder CLI, "aether-forge" (gh, May 2026).
- **Direction.** The homepage now says Elsa is "building infrastructure for autonomous agents—with x402 … and ERC-8004" (s).

## 2. Launch and stage
- **Company start.** The company started in March 2024: the founder's role at Crunchbase is dated Mar 2024, and the X account was created Mar 2024 (s, iq.wiki).
- **Product launch.** ElsaAI was introduced in June 2024. The public soft launch was **Sep 16, 2024** (s, iq.wiki; this date is not confirmed on HeyElsa's own blog).
- **Status: live.**
  - The ELSA token TGE was **Jan 20, 2026** (s, ICO Drops / Bitrue).
  - ELSA listed on Binance Alpha (Jan 20), Bybit spot (Jan 20) and Coinbase (Jan 21, 2026) (s).
  - Hyperliquid spot and perps went live through chat on **Apr 6, 2026** (s, blockchainreporter.net, Apr 7).
  - Developer tooling shipped through 2026: terminal-chart (Mar 2026) and aether-forge (Apr–May 2026) (gh).
- **Team and entity:**
  - Founder and CEO Dhawal Shah is listed in Toronto/Vaughan, Canada. Co-founder and CTO Vetrichelvan Jeyapalpandy is in Bangalore, India.
  - The entity is Elsa AI Ltd. Its sole shareholder is Elsa AI Foundation (Panama), according to the HeyElsa MiCA whitepaper (s).
  - Headquarters are listed inconsistently: Crunchbase and VCBacked say San Francisco; PitchBook gives a BVI registered office.

## 3. Funding
| Date | Round | Amount | Lead | Others | Confidence |
|---|---|---|---|---|---|
| Jun 5, 2025 | Combined pre-seed + seed | **$3M** | **M31 Capital** | Coinbase Ventures' **Base Ecosystem Fund**, MH Ventures, Absoluta (Cap/Digital), 2Shares, Levitate Labs, plus angels | **Verified.** Company blog, DefiLlama raises (Jun 5, 2025), ChainCatcher/PANews, CryptoRank X post |
| Jan 2026 | Token (ELSA) TGE, airdrop, Bybit Launchpool (3M ELSA) | Not a priced equity round | — | 10.51% of supply allocated to investors | Third-party (ICO Drops, Bitget) |

**No newer equity round was found** in 2026 searches (CryptoRank, ICO Drops, Crunchbase, DefiLlama).

## 4. Traction
| Metric | Figure | Date | Source | Confidence |
|---|---|---|---|---|
| On-chain volume since launch | $20M+ | Jun 2025 | Funding blog | Self-reported |
| Lifetime volume | $168M+ | ~late 2025 | Zerion guide | Third-party, quoting the vendor |
| On-chain volume | **$300M+** | End of 2025 | 2025 year-end review via KuCoin/Phemex/Bitget news flashes | Self-reported |
| Homepage counters | **945K+ wallets · 18.9M+ prompts · $503M+ total volume** | Indexed ~Jan 2026 (search cache ~261 days old) | heyelsa.ai (s) | Self-reported |
| Similar counters | 931K wallets · 18.7M prompts | Jan 2026 | WEEX token guide | Third-party, quoting the vendor |
| BingX figure | 18.7M prompts · $439M volume | ~Jan 2026 | BingX explainer | Third-party; I could not trace its source |
| Founder post | 11M prompts · "$150M executed by agents" | ~Nov 2025 | LinkedIn repost | Self-reported |
| ELSA token holders | ~241K | mid-2026 | CoinMarketCap | Verified (on-chain), but these are token holders, not users |
| ELSA market cap | ~$10.9M at $0.0474 | Jul 28, 2026 | CryptoRank | Verified market data |
| ELSA price path | ATH ~$0.405–0.417 on Jan 22, 2026 → ATL ~$0.038 on Jun 24, 2026 (≈ −90%) | 2026 | CryptoRank, CoinMarketCap | Verified market data |

**Conflicts and caveats:**
- The volume figures are inconsistent: $300M at year-end against $503M on the homepage a few weeks later, and $439M from BingX. Definitions are unclear (on-chain versus "total", and whether bridges and perps count).
- **I found no DefiLlama protocol page and no Dune dashboard for usage.** BNB Chain's DappBay marks HeyElsa "Inactive / No Data".
- **Farming caveat.** Much activity was points-incentivised: Elsa Points (EP) were converted to ELSA, and the weekly Arena paid out on volume.
  - In a Jan 2026 airdrop dispute over the Wallchain "Quackers" mindshare campaign, **HeyElsa itself published data that ~46% of the campaign's wallets had zero on-chain activity**, and that active wallets had a median of 2 transactions over 1 day (s, MEXC news; CoinMarketCap updates).
  - This describes campaign participants, not all app users. Critics on CoinMarketCap also allege farmed volume and high swap fees; these allegations are unverified.

## 5. Markets and chains
- **Spot.** Swaps, bridges, staking, yield and limit orders (CoW Protocol). Most volume is on Base (s, Zerion).
- **Perps.** Hyperliquid, from Apr 6, 2026 (s).
- **Chains.** Base, Ethereum, Arbitrum, Optimism, Polygon, BSC, Avalanche, zkSync (x402 skill README, gh); Hyperliquid, Ink, Soneium (s, roundup); and Solana (smart wallet).
- **Polymarket.** Not live. Polymarket APIs are listed "coming soon" (elsa-openclaw README, gh, Feb 2026). The litepaper lists "prediction markets" as a feature.
- **Stocks.** None found. The docs mention "tokenized assets" only in portfolio suggestions.

## 6. Business model
- **Execution fees on swaps.** No published rate card was found. A homepage illustration shows a 0.17% fee line (s). Critics call the fees high (unverified).
- **x402 API, per call** in USDC or ELSA on Base: $0.001–$0.05 per call. Examples: get_balances $0.005, get_portfolio $0.01, swap quote $0.01, execute_swap $0.02. The limit-order price conflicts between sources ($0.02 vs $0.05) (gh README; s, x402 docs).
- **ELSA token.**
  - Holders get fee discounts and staking boosts.
  - 10% of platform fees are burned (s, CoinMarketCap explainer).
  - The MiCA whitepaper says ELSA can pay "execution and automation fees" and that subscription or usage fees "may" be charged.
- **Distribution incentives.** Points, airdrops (40% of supply for community and incentives) and the weekly ELSA-funded volume Arena.

## 7. Autonomy
- **Chat-to-execute.** The user states an intent; Elsa plans and prepares the transactions.
  - With a connected wallet, the user confirms each step.
  - With the Elsa smart wallet, Elsa executes (s, Zerion; CoinMarketCap calls it a "transaction assistant" where the user keeps final signing authority).
- **Automations that run without a click:** limit orders trigger automatically, and the yield optimizer "routes your assets automatically" (s).
- **Planned, not confirmed live:**
  - The litepaper lists "execute now / schedule / autopilot (bounded by policies)".
  - The roadmap lists autonomous TP/SL, hedging and rebalancing.
  - AgentOS (hosted third-party agents) is still listed as a future milestone in 2026 (s, MiCA whitepaper; CoinMarketCap roadmap).
- **What the user configures:** the intent and its parameters (size, slippage, leverage and TP on perps, limit price). For the x402 skill: per-call and daily budget caps, and execution is off by default (gh).

## 8. The four columns
| Column | Mark | Evidence | URL |
|---|---|---|---|
| **Agent-paid inference** | **N** | The consumer copilot shows no per-use LLM charge, credits or BYO key. An Oct 28, 2025 "vision" article proposed that the Copilot pay "a few cents" per premium AI action from a USDC session wallet (premium perp, copy and yield features first). That is unconfirmed as live. | https://x.com/HeyElsaAI/status/1983213478824333678 |
| **x402 alpha (buys data)** | **N** | No evidence that Elsa's agent buys third-party data per call. **Separately, HeyElsa *sells* x402 APIs** (live Dec 5, 2025; $0.001–$0.05 per call in USDC or ELSA on Base). | https://x.com/HeyElsaAI/status/1996914985033760870 · https://github.com/HeyElsa/elsa-x402-skills |
| **Token filters and gates** | **P** | User-set rules only: limit orders (CoW), and TP on perps orders. **No enforced pre-buy honeypot, rug or liquidity screening found.** Its "risk analysis" endpoint scores wallet behaviour, not token safety (gh README). | https://github.com/HeyElsa/elsa-openclaw · https://zerion.io/blog/guide-to-heyelsa-what-it-is-how-it-works-and-more/ |
| **Social trading** | **P** | The "Based Elsa Trading Arena" ranks the top 100 wallets weekly by **volume** (not PnL), on a public Dune dashboard, and pays tiered ELSA. Copy trading appears in the roadmap and litepaper; it is not confirmed live. | https://app.heyelsa.ai/base-trading-arena/terms-and-conditions |

## 9. Best at (≤6 words)
**Chat-to-execute DeFi with mass reach**. Alternative: "Plain-English DeFi execution, many chains."

## 10. Gap vs Tocker
A human-in-the-loop chat copilot with no enforced token-safety gates, no paid-data buying and no public PnL record. Its "social" is a volume-farming leaderboard.

## 11. One killer stat
**"945K+ wallets, $503M+ total volume" (heyelsa.ai homepage, ~Jan 2026; self-reported).**
- Pair it with the independent counterpoint: the ELSA token fell ~90% from its Jan 22, 2026 ATH to its Jun 24, 2026 low (CryptoRank, CoinMarketCap).
- If the slide must show only verified numbers, use the round instead: **$3M led by M31 Capital with Coinbase's Base Ecosystem Fund (Jun 5, 2025; DefiLlama).**

## 12. Logo
- **GitHub org: `HeyElsa`** (id 164865246). It is confirmed official:
  - The org's website field is heyelsa.ai.
  - Repos link to official subdomains: elsa-openclaw → x402.heyelsa.ai, aether-forge → forge.heyelsa.ai.
  - The org holds a "brand-assets" repo ("Elsa's Brand Assets") whose `Elsa_icons/Red_square_white_logo_512x512.png` is the same mark as the org avatar.
- **Avatar:** https://avatars.githubusercontent.com/u/164865246?v=4. It is a white, cute robot or astronaut face (two dot eyes, open smile, round "antenna" ring on the forehead, headphone-like side pods) on a solid red square.
- **Official 512px square logo:** https://raw.githubusercontent.com/HeyElsa/brand-assets/main/Elsa_icons/Red_square_white_logo_512x512.png
- **X: @HeyElsaAI.** I could not view the X avatar image (x.com, pbs.twimg.com and unavatar were blocked), so I cannot describe it first-hand. It most likely uses the same mark, but that is unverified.

---

## Sources
- https://blog.heyelsa.ai/heyelsa-raises-3m-to-build-ai-stack-for-crypto/ (s)
- https://defillama.com/raises/2shares (s; HeyElsa, Jun 5, 2025, $3M, lead M31)
- https://www.chaincatcher.com/en/article/2184733 (s)
- https://x.com/CryptoRank_VCs/status/1930648533692010690 (s)
- https://www.kucoin.com/news/flash/heyelsa-ai-agent-protocol-to-conduct-tge-in-january-2026 (s)
- https://phemex.com/news/article/heyelsa-to-launch-token-generation-event-in-january-2026-49160 (s)
- https://www.bitget.com/news/detail/12560605123620 (s)
- https://icodrops.com/heyelsa/ (s)
- https://www.heyelsa.ai/ (s; homepage counters)
- https://www.weex.com/wiki/article/introducing-heyelsa-complete-guide-to-elsa-and-airdrop-opportunities-43352 (s)
- https://bingx.com/ur/learn/article/what-is-heyelsa-elsa-ai-crypto-co-pilot (s)
- https://www.linkedin.com/in/rashmi-hegde-4246b94b/ (s; founder post repost)
- https://zerion.io/blog/guide-to-heyelsa-what-it-is-how-it-works-and-more/ (s)
- https://coinmarketcap.com/currencies/heyelsa/ (s)
- https://coinmarketcap.com/cmc-ai/heyelsa/latest-updates/ (s)
- https://cryptorank.io/price/heyelsa (s)
- https://www.mexc.com/news/515389 (s; airdrop dispute, 46% figure)
- https://dappbay.bnbchain.org/detail/heyelsa-ai (s)
- https://iq.wiki/wiki/heyelsa · https://iq.wiki/wiki/heyelsa/milestones (s)
- https://docs.heyelsa.ai/a-field-guide-to-heyelsa · https://docs.heyelsa.ai/heyelsa-mica-whitepaper (s)
- https://blog.heyelsa.ai/heyelsa-the-crypto-agent-layer-litepaper/ (s)
- https://blockchainreporter.net/heyelsa-integrates-hyperliquid-for-unified-spot-and-perps-trading-through-ai-conversation/ (s)
- https://x.com/HeyElsaAI/status/1996914985033760870 (s; x402 live, Dec 5, 2025)
- https://x.com/HeyElsaAI/status/1983213478824333678 (s; x402 vision, Oct 28, 2025)
- https://x402.heyelsa.ai/ · https://x402.heyelsa.ai/docs (s)
- https://app.heyelsa.ai/base-trading-arena/terms-and-conditions (s)
- https://www.crunchbase.com/organization/elsa-901f (s)
- https://www.vcbacked.co/company/heyelsa (s)
- https://ourcryptotalk.com/news/bybit-heyelsa-elsa-token-listing (s)
- https://github.com/HeyElsa (gh)
- https://github.com/HeyElsa/elsa-openclaw (gh)
- https://github.com/HeyElsa/elsa-x402-skills (gh)
- https://github.com/HeyElsa/brand-assets (gh)
- https://github.com/HeyElsa/aether-forge (gh)
