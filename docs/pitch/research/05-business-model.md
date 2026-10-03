## Business model: fee benchmarks and unit economics (2026-10-03)

### Headline stats (pitch-ready)
- **Trading bots charge 1% of every trade** — madeonsol 2026 (madeonsol.com/blog/gmgn-vs-photon); TYN Magazine 2026 (tynmagazine.com/?p=241390) · high
- **Axiom: $100M revenue ~4 months after launch** — The Block, ~May 2025, theblock.co/post/355676 · high
- **Axiom: ~$458M cumulative revenue; $84M in Q3 2026** — DefiLlama†, defillama.com/protocol/axiom · med (a Medium estimate says ~$390M by mid-2026)
- **Bots earned ~$100M in one week, ~20% of crypto revenue** (week to 2025-02-02) — Forklog, forklog.com/en/wp-json/wp/v2/posts/87326 · med
- **pump.fun: >$1.2B cumulative revenue** — BlockEden, 2026-04-12, blockeden.xyz/blog/2026/04/12/pumpswap-16b-volume-pumpfun-amm-raydium-solana-dex · med

### Competitor fee table
| Platform | Fee | Revenue |
|---|---|---|
| Axiom | 0.75–1%, tiered; 1% by default | above |
| Photon | 1% | $440.8M lifetime; $22.5M trailing yr† |
| BullX | 1% | $200.6M lifetime* |
| GMGN | 1% | sources conflict ($292M vs $55.9M), so omit |
| Padre (pump.fun "Terminal" since Oct 2025, per Cointelegraph) | ~1%, minus volume rebates | $25.4M trailing yr† |
| Trojan | 1% (0.9% with referral) | $194.8M lifetime* |
| BonkBot / Maestro | 1% | $110.7M* / not verified |
| Banana Gun | **0.5%** manual on ETH; 1% for snipes (c0xswain Substack) | $86.9M cumulative; Q1→Q3 2025 $12.4M→$3.1M† |
| pump.fun | bonding curve 1%; PumpSwap 0.30% incl. 0.05% creator fee (KuCoin Learn) | $322M in 2026 YTD (TheCurrencyAnalytics) |

\*From an undated X post (via CoinStats, c. mid-2025) putting Solana bots' lifetime fees at $1.44B. †DefiLlama figures read from search snippets.

**Verdict:** ~1% holds for everyone above except Axiom (0.75% at its top tier) and Banana Gun (0.5%). Tocker's $0.10 is cheaper than 1% only on clips above **$10**; the break-even clip is $13.33 against 0.75% and $20 against 0.5%. Sol Trading Bot is not verified.

### Revenue sensitivity
Annual revenue = live fills × $0.10 × 365. Paper fees are simulated, not cash (`platform/fees.ts:18-20`).

| Agents | 4 fills/day | 10 | 20 |
|---|---|---|---|
| 1k | $146k | $365k | $730k |
| 10k | $1.46M | $3.65M | $7.3M |
| 100k | $14.6M | $36.5M | $73M |

Matching Photon's $22.5M would take ~617k fills/day.

### Data cost per agent (from code) and margin framing
**Default agent:** 96 runs/day (`config.ts:135`), a $1/run data cap (`config.ts:116`), and 10 buys/day with exits not counted (`risk.ts:296-299`).

**Each run:**
- Buys the SolEnrich launch radar, $0.012 (`tools.ts:262-270`)
- Scores ≥5 tokens (`limits.ts:17`)
- Auto-buys Deepnets ($0.01) + X sentiment ($0.006) for each token without a confirmed blocker (`enrichment.ts:65-88`, `x-search.ts:34`)

| Estimate | Math | /run | /day |
|---|---|---|---|
| Best | radar only | $0.012 | $1.15 |
| Typical | 0.012 + 5×0.016 | $0.092 | $8.83 |
| Worst | $1 cap binds | $1.00 | $96 |

A default agent pays at most ~$2.00/day in fees (20 fills × $0.10). At typical data spend that is a **−342% data margin**. Break-even needs a $0.44 fee per fill. Hourly cadence alone would cut typical spend to $2.21/day.

**Framing:** "Revenue scales with fills and data cost scales with ticks, so next we buy data per token, not per agent." Today only sentiment is cached across agents (`tokens/index.ts:58`); the Deepnets read is bought per agent (`tools.ts:399-409`).

**Pricing levers:**
- **IN CODE:**
  - `PLATFORM_FEE_USD`, one global price (`fee.ts:24,48`)
  - Data cap and cadence, but set by the owner, not the platform (`config.ts:61,75`)
  - Forced radar (`tools.ts:263`)
- **PROPOSAL** (no billing code exists):
  - Pro tiers for cadence, agent count and premium data
  - Data pass-through to the agent's wallet (the design before 2026-09-16, `SPEC.md:91`)
  - Performance fee (needs legal review)
  - Platform-side data caps
  - A shared cache for the radar and Deepnets reads

### Suggested slide copy
1. "A dime a fill. The bots take 1%."
2. "$0.10 flat per trade: 10× cheaper than 1% bots on a $100 clip"
3. "Bots built a billion-dollar fee business at 1%. We charge a dime."

Spoken: "Trading bots take one percent of every trade. Tocker takes a flat ten cents a fill, a tenth of that on a hundred-dollar clip, and users bring their own AI."

### Caveats / what not to claim
- **Not "profitable per agent".** Typical data spend is about 4× the most an agent pays in fees.
- **"10× cheaper" needs "on a $100 clip".** On a $2 buy the fee is 5% (`prompts.ts:283-285`).
- **Gas is unquantified.** The platform also pays Solana gas, priority fees and swap-account rent (`jupiter.ts:21-26`).
- **Spend exposure:** owners can set up to $100/run (`config.ts:61`), runs can come every 5 min (`vercel.json`), and Bazaar pays any x402 URL (`bazaar.ts:36-54`). That is ≈$28.8k/day per agent in theory, all platform-paid. Cap it.
- **Re-verify † figures.** The sites were egress-blocked here.
- **Discard "BullX $2.29B fees"** (madeonsol): it is ~10× off every other source.
- **The category is off its peak.** pump.fun made under $25M in July 2025, −80% from January (Cointelegraph, Oct 2025).
