# DIY autonomous memecoin agent (Solana + Base), monthly cost as of October 2026

Research date: 2026-10-08. Method: WebSearch (extended mode for pricing pages). WebFetch and curl to vendor domains were blocked in this environment (DNS failure or proxy 403), so every figure below comes from search-engine extracts of the official pages where possible, otherwise from dated third-party trackers. Confidence is marked per line. **Verify on the live pages before the slide ships.**

Legend: **H** = official page or docs, consistent across sources · **M** = official but undated, or sources partly conflict · **L** = third-party only, stale, or contradictory.

---

## 1. Solana RPC + websockets

| Option | Price/mo | What you get | Conf. | Source |
|---|---|---|---|---|
| Helius Free | $0 | 1M credits, 10 RPC req/s. Too tight for 24/7 | H | https://www.helius.dev/docs/billing/plans |
| **Helius Developer** | **$49** | 10M credits, 50 req/s, staked connections; since 2026-04-07 Enhanced WSS `transactionSubscribe` (≤100 subs/conn), 150 WS connections | H | https://www.helius.dev/pricing · https://www.helius.dev/docs/billing/plans · https://www.helius.dev/blog/laserstream-websockets |
| **Helius Business** | **$499** | 100M credits, 200 req/s, mainnet LaserStream gRPC | H | same |
| Helius Professional | $999 | 200M credits, 500 req/s, data add-ons (5 TB = $400/mo) | H | same |
| Helius overage / metering | $5 per 1M credits | Standard call = 1 credit; DAS/gPA = 10; Enhanced Tx = 100; streaming = 20 credits/MB since 2026-04-07 (≈$100/TB) | H | https://www.helius.dev/docs/billing/credits · https://www.helius.dev/blog/laserstream-websockets |
| QuickNode Build | $49 ($42 annual in one listing, $34 in another) | 80M credits, 50 req/s, 10 endpoints, multichain endpoint covers Solana **and** Base | H (price), M (annual) | https://www.quicknode.com/pricing · https://www.quicknode.com/guides/quicknode-products/how-to-use-multichain-endpoint |
| QuickNode Accelerate / Scale / Business | $249 / $499 / $999 | 450M / 950M / 2B credits; 125 / 250 / 500 req/s | H | https://www.quicknode.com/pricing |
| Triton One Starter (shared) | $500 | Official page says front-ends only, **bots not allowed**. Dedicated from $2,900+. A third-party site (madeonsol, 2026-09-01) says shared from $100 (unverified) | M | https://www.triton.one/solana |

Pick: **Helius Developer $49** (minimal) → **Helius Business $499** (serious, LaserStream gRPC for low-latency new-pool detection).

## 2. Base (EVM) RPC

| Option | Price/mo | Notes | Conf. | Source |
|---|---|---|---|---|
| Alchemy Free | $0 | 30M CU/mo, 500 CU/s (~25 RPS). Tight | M | https://www.alchemy.com/pricing |
| **Alchemy Pay As You Go** | **$0 base + $0.525 per 1M CU** | Flat rate since the Sept 2026 docs change (was $0.45 → $0.40 tiered). 10,000 CU/s included; +5,000 CU/s blocks at $160/mo. eth_call = 26 CU, eth_getLogs = 60 CU | M (one aggregator still lists "$49" or "$5/mo + usage", which look wrong) | https://www.alchemy.com/pricing · https://www.alchemy.com/docs/reference/pay-as-you-go-pricing-faq · https://github.com/alchemyplatform/docs/pull/1615 |
| QuickNode Build | $49 | Same plan as Solana above, so one $49 plan can cover both chains | H | https://www.quicknode.com/pricing |

Usage estimate (assumption, not a price): minimal ~20M billable CU ≈ **$10/mo**; serious ~95M CU ≈ **$50/mo**. Reference arithmetic: 1M eth_call = 26M CU = $13.65.

## 3. DEX routing / swap APIs

### Jupiter (Solana)
| Tier | Price/mo | Limits | Conf. |
|---|---|---|---|
| Free | $0 | 1 req/s (not viable 24/7) | M |
| **Developer** | **$25** | 25M credits/mo | M |
| **Launch** | **$100** | 50 req/s | M |
| Pro | $500 | 500M credits, 150 req/s (9,000/min), priority support; separate 100 RPS bucket for `/swap/v2/execute` | M |
| Overage | $1 per 1M credits | | M |

Sources: https://developers.jup.ag/pricing · https://developers.jup.ag/docs/portal/rate-limits. The older Portal page (https://dev.jup.ag/portal/rate-limit) lists Pro I/II/III at ~600/3,000/6,000 req/min and says it is being replaced; trust the new Developer Platform page.

**Ultra**: no separate paid tier. Ultra uses dynamic limits (base 50 req per 10 s, scaled by rolling 24h executed volume) and is now **superseded by Swap V2** (no longer maintained). Ultra charged a default **5–10 bps per swap** (0 bps pegged pairs). Swap V2 `/order` responses return a `feeBps` that "includes the Jupiter platform fee"; integrator referral fees are 50–255 bps (Jupiter keeps 20% under the Ultra docs). Exact V2 platform-fee level not published in what I found. Read `feeBps` from a test `/order` call. Sources: https://developers.jup.ag/docs/ultra/fees · https://developers.jup.ag/docs/ultra/add-fees-to-ultra · https://developers.jup.ag/docs/swap. Conf. M/L.

### 0x (Base)
- Free tier exists; free/starter integrators pay a **15 bps on-chain fee on selected tokens**. Standard **$1,000/mo + 0.15%**, Custom $2.5k+/mo. Page snapshot looks ~3 years stale. **Conf. L.** https://0x.org/pricing · https://0x.org/post/introducing-paid-plans-for-swap-api
- x402 pay-per-request for agents: **$0.01 per request in USDC**, no key. Conf. M. https://thedefiant.io/news/defi/0x-swap-api-ai-agents-usdc-payment-x402

### 1inch Business (Base)
- Free/Dev: 100k calls/mo, 60 req/min. Startup 1M calls, 10 rps; Professional 3M, 20 rps; Business 7M, 40 rps.
- Prices shown as $149/$299/$599 and $199/$399/$799 (unlabelled; likely annual vs monthly). Infra fees excluded.
- Pay-as-you-go: **from $0.00018 per call**, USDC on Base, $2 minimum deposit. No overage charges (429 instead). Projects >$10M swap volume moved to custom/rev-share.
- Conf. M (tiers) / L (which price is monthly). https://business.1inch.com/pricing · https://help.1inch.com/en/articles/12398075-pricing-and-subscriptions-faq

Pick: minimal **Jupiter Developer $25 + 1inch free/PAYG ~$0** ; serious **Jupiter Launch $100 + 1inch Startup $199 (monthly list, uncertain)** = $299. Per-swap on-chain fees (Jupiter platform fee, 0x 15 bps, priority fees/Jito tips, Base gas) are **trading costs, excluded** from the totals.

## 4. Token / market data

| Option | Price/mo | Allowance | Conf. | Source |
|---|---|---|---|---|
| Birdeye Standard | $0 | free, limited | M | https://birdeye.so/data-api/pricing |
| **Birdeye Lite** | **$39** | 2.5M CU, 15 rps, overage $15/1M CU | M (official, undated) | same |
| Birdeye Starter | $99 | 8M CU, 15 rps, overage $12/1M | M | same |
| **Birdeye Premium** | **$199** | 20M CU, 50 rps, WebSocket (500 conns), overage $9.9/1M | M | same |
| Birdeye Business | $499 | 60M CU, 100 rps, WebSocket (2,000 conns) | M | same |
| CoinGecko Basic | $35 ($29 annual) | 100k credits, 300/min | M | https://www.coingecko.com/en/api/pricing |
| CoinGecko Analyst | $129 ($103 annual) | 500k credits, 500/min | M | same |
| CoinGecko Lite / Pro | $499 / $999 | 2M / 5M+ credits | M | same |
| CoinMarketCap Hobbyist / Startup / Standard / Pro | $29 / $79 / $299 / $699 (CMC Academy); CostBench shows exactly 12× these | | L (conflict) | https://coinmarketcap.com/academy/article/understanding-crypto-api-subscription-models-for-traders-in-2026 · https://costbench.com/software/blockchain-data-api/coinmarketcap-api/ |
| DexScreener API | **$0**, no key | ~300 req/min pairs, 60 req/min profiles/boosts (third-party; no official paid tier found) | M (free) / L (limits) | https://docs.dexscreener.com (not reachable; limits via https://github.com/opensvm/dexscreener-mcp-server) |

Pick: minimal **Birdeye Lite $39 + DexScreener $0**; serious **Birdeye Premium $199** (WebSocket price/trade streams on Solana + Base). CoinGecko Basic $35 optional.

## 5. Smart-money / on-chain intelligence

- **Nansen API**: Free (100 trial credits, then daily top-up to 10) and **Pro $69/mo monthly or $49/mo annual**; Pro gets 2,000 credits refilled monthly, 75 calls/s, 1,500/min. Extra "Flexi-Credits": Nansen Academy says **$10 per 1,000 credits** in one article and **$10 per 10,000** in another (conflict). x402 pay-per-call **from $0.01/query** in USDC on Base or Solana. Conf. M. https://docs.nansen.ai/getting-started/credits · https://academy.nansen.ai/articles/1287744-plans-and-pricing · https://nansen.ai/api
- **Arkham Intel API**: no public price. Access by application (intel.arkm.com/api, api@arkm.com); full API launched 2026-02-17. **Conf. L / price unknown.** https://info.arkm.com/announcements/the-new-arkham-api · https://api-guide.intel.arkm.com/

Pick: minimal **$0** (skip, or Nansen x402 ≈ $29/mo at 96 queries/day × $0.01); serious **Nansen Pro $69 + ~$100 credit top-ups (usage assumption)** ≈ $169.

## 6. Social sentiment: X API

- **Basic ($200/mo) and Pro ($5,000/mo) are legacy.** Pay-per-use became the default on **2026-02-06**; new developers can only choose pay-per-use or Enterprise. Basic subscribers auto-migrated from 2026-06-01; Pro deprecated (announced 2026-08-14, migrations after 2026-09-01; sources differ slightly). Enterprise reported at $42,000+/mo.
- Official pay-per-use rates (docs.x.com): **Post read $0.005 per resource returned**, **User read $0.010**, owned reads $0.001; cap **3M post reads per month**. Third-party guides say same resource re-read within a UTC day is charged once (unconfirmed).
- Conf. H (rates) / M (legacy-tier dates). https://docs.x.com/x-api/getting-started/pricing · https://www.medianama.com/2026/02/223-x-developer-api-pricing-pay-per-use-model/ · https://postproxy.dev/blog/x-api-pricing-2026/

Usage estimate (assumption): minimal **1,000 post reads/day → 30k/mo × $0.005 = $150**; serious **5,000/day → 150k/mo = $750**.

## 7. Token safety checks

- **RugCheck (Solana)**: API at api.rugcheck.xyz, key-based, returns 429 when throttled; **no published paid tiers or limits found** → treat as free. Conf. L. https://api.rugcheck.xyz/swagger (via https://apidog.com/blog/rugcheck-api/)
- **GoPlus Security (Base/EVM + Solana)**: Free 150K CU/mo (30K/day, 150 CU/min); **Test $199**, Beginner $399, Growth $799, Pro $1,899, Ultra $3,499, Enterprise custom. Docs elsewhere say free = 30 calls/min. Undated. Conf. M. https://www.gopluslabs.io/en/security-api · https://docs.gopluslabs.io/reference/support

Pick: minimal **$0** (RugCheck + GoPlus free); serious **GoPlus Test $199** (free tier's 150 CU/min is a tight rate limit).

## 8. LLM inference

Assumption from the brief: one decision run every 15 min, 20k input + 2k output tokens per run.

- Runs/month = 4/h × 24 h × 30 d = **2,880** (2,920 on a 30.4-day month).
- Input = 2,880 × 20,000 = **57.6M tokens**; output = 2,880 × 2,000 = **5.76M tokens**.

| Model | $ in / out per 1M | Input cost | Output cost | **Total/mo** | Conf. | Source |
|---|---|---|---|---|---|---|
| **Claude Sonnet 5.5** | $2 / $10 | 57.6 × 2 = $115.20 | 5.76 × 10 = $57.60 | **$172.80** | H | Anthropic model table (cached 2026-10-06) · https://www.anthropic.com/claude/sonnet · https://platform.claude.com/docs/en/about-claude/pricing |
| Sonnet 5.5 + prompt cache (assume 15k of 20k is a stable prefix, 1h TTL kept warm by 15-min cadence) | cache read $0.20/1M | 15k×$0.20/1M + 5k×$2/1M = $0.013/run → $37.44 | $57.60 | **≈ $95** | M (caching ratio is an assumption) | same |
| Claude Sonnet 4.6 | $3 / $15 | $172.80 | $86.40 | $259.20 | H | same |
| GPT-5.1 / GPT-5 | $1.25 / $10 | $72.00 | $57.60 | $129.60 | M (aggregators) | https://benchlm.ai/openai/api-pricing |
| GPT-5 mini | $0.25 / $2 | $14.40 | $11.52 | $25.92 | M (economize.cloud verified vs OpenAI page 2026-10-06) | https://www.economize.cloud/resources/open-ai/pricing/gpt-5-mini/ |
| Claude Haiku 5.5 | $0.10 / $0.50 | $5.76 | $2.88 | $8.64 | H | Anthropic model table |

Caveat: on Sonnet 5.5 thinking is on by default (adaptive) and thinking tokens bill as output; if each run spends extra reasoning tokens, add $10/mo per extra 1k output tokens/run. Batch API (50% off) does not fit a live loop.

Pick: minimal **Sonnet 5.5 with caching ≈ $95**; serious **Sonnet 5.5 uncached ≈ $173**.

## 9. Hosting / compute + Postgres

| Option | Price/mo | Conf. | Source |
|---|---|---|---|
| **Hetzner CX23** (2 vCPU shared, DE/FI) | **€5.49 / US$6.49** after the 2026-06-15 increase (was €3.99); +€0.50 IPv4 likely | H | https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ |
| Hetzner CPX22 | €19.49 / US$22.99 (was €7.99) | H | same |
| DigitalOcean Basic Droplet 2 GB / 1 vCPU | $12 | M | https://www.digitalocean.com/pricing/droplets (via https://infratally.com/articles/digitalocean-droplet-pricing-guide-2026/) |
| **DigitalOcean Basic Droplet 4 GB / 2 vCPU** | **$24** | M | same |
| **DigitalOcean Managed PostgreSQL** (1 GB single node) | **$15 ($15.15)**; HA ≈ $60 | M | https://infratally.com/articles/digitalocean-managed-postgres-deep-dive/ |
| Supabase Pro | $25 base (+$10 compute credit covers Micro) | M | https://supabase.com/pricing (via https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) |
| Railway Hobby / Pro | $5 / $20 as usage credit; 1 vCPU + 1 GB 24/7 ≈ $30 of usage | M | https://temps.sh/blog/railway-pricing-2026 |

Pick: minimal **Hetzner CX23 $6.49 + DO managed PG $15 ≈ $22**; serious **DO 4 GB $24 + DO managed PG $15 ≈ $39**.

## 10. Wallet / key management

- **Turnkey**: Pay as You Go **$0.10/signature**, first 25/mo free, ≤1k wallets; **Pro $99/mo minimum + $0.05/signature** (can drop to $0.01), ≤2k wallets; Enterprise custom (down to $0.0015/sig). PAYG beats Pro below ~2,030 signatures/mo. Conf. H. https://www.turnkey.com/pricing
- **Privy**: Developer plan **free** with 50K signatures and $1M transaction volume per month; Core $299 (500–2,499 MAU), Scale $499; above 50K sigs / 10K MAU → $2,000 base + $0.01/sig. Server-wallet plan placement not explicit. Conf. M. https://www.privy.io/pricing
- Self-managed encrypted key on the server: $0 (operational risk).

Pick: minimal **$0** (Privy free tier or self-custody); serious **Turnkey PAYG at ~1,000 signatures/mo = (1,000 − 25) × $0.10 = $97.50**.

---

## Totals (per month, excludes per-swap on-chain fees, gas, priority fees, slippage)

| Component | Minimal (cheapest workable) | Serious (production) |
|---|---|---|
| Solana RPC | Helius Developer **$49** | Helius Business **$499** |
| Base RPC | Alchemy PAYG ~**$10** (est.) | Alchemy PAYG ~**$50** (est.) |
| Swap APIs | Jupiter Developer $25 + 1inch free = **$25** | Jupiter Launch $100 + 1inch Startup $199 = **$299** |
| Market data | Birdeye Lite $39 + DexScreener $0 = **$39** | Birdeye Premium **$199** |
| Smart money | skip **$0** | Nansen Pro $69 + ~$100 credits ≈ **$169** |
| X API | ~1k reads/day ≈ **$150** | ~5k reads/day ≈ **$750** |
| Token safety | RugCheck + GoPlus free **$0** | GoPlus Test **$199** |
| LLM | Sonnet 5.5 cached ≈ **$95** | Sonnet 5.5 uncached ≈ **$173** |
| Hosting + DB | Hetzner + DO PG ≈ **$22** | DO 4 GB + DO PG ≈ **$39** |
| Wallet | **$0** | Turnkey PAYG ≈ **$98** |
| **Total** | **≈ $390/mo** | **≈ $2,475/mo (~$2.5k)** |

Arithmetic: minimal 49+10+25+39+0+150+0+95+22+0 = 390. Serious 499+50+299+199+169+750+199+173+39+98 = 2,475.

Swing factors: X API usage scales linearly ($5 per 1k post reads); Helius Business is the single largest fixed line; a QuickNode Build ($49) plan can replace Helius Developer + Alchemy in the minimal stack (saves ~$10 but loses Helius staked sends / enhanced WSS).

## Slide lines

- **Serious (top 6):** `X API ~$750 · RPC $549 · Swap APIs $299 · Market data $199 · Token safety $199 · LLM ~$175 → ≈ $2.5k/mo`
- **Minimal:** `X API ~$150 · LLM ~$95 · RPC ~$59 · Data $39 · Swap API $25 · Hosting $22 → ≈ $390/mo`

## Uncertainty register

- Vendor pages not opened directly (network blocked); figures come from search extracts of official pages (Helius, QuickNode, Alchemy, Jupiter, Birdeye, Turnkey, Privy, Hetzner, docs.x.com) or third-party trackers.
- 0x pricing page snapshot appears years old; 1inch prices are not labelled monthly vs annual; CMC tier prices conflict 12×; Arkham API has no public price; RugCheck has no published limits; Nansen per-credit price conflicts 10×; Triton shared price conflicts ($500 official vs $100 third-party) and the official Starter tier bans bots.
- X, Alchemy, Nansen top-ups, Turnkey and LLM lines depend on usage assumptions stated above.
