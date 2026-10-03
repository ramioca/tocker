# x402 alpha: what you get for what you pay

Every source is paid per call from the **platform** wallet (SPEC.md:170), capped per run by `risk.maxDataSpendUsdPerRun` (README.md:56). "Default" means it is in `DEFAULT_AGENT_CONFIG.dataSources` (src/lib/agent/config.ts:91): `x-search`, `cmc-quotes`, `deepnets-token-safety`.

## Per-source

| id · provider | $/call | net | agent gets | question it answers | how Tocker uses it | default |
|---|---|---|---|---|---|---|
| `x-search` · x402Atlas | **0.006** (x-search.ts:34) | Base | ≤20 tweets (text, author, followers, engagement) + sentiment/velocity −1..1 (x-search.ts:68-86) | "Is anyone talking about this?" | 1st choice for `sentiment` score (wt 15, reweights core) via `deep:true` (tokens/index.ts:72; score.ts:16,658) | yes |
| `sentimentalpha` | 0.01 (sentimentalpha.ts:54) | Base | sentiment score, narrative velocity, headline, watchlist (:70-80) | "Is the narrative accelerating or crowded?" | `sentiment` fallback (index.ts:72) | no, experimental |
| `otto-pulse` · Otto | 0.001 pulse / 0.003 recap (otto.ts:39-40) | Base | CT pulse or 4-6 sentence news recap | "What kind of market is it today?" | ad-hoc via `query_data_source` | no, experimental |
| `nansen-smart-money` · Nansen | **0.05** (nansen.ts:38) | Base (+Solana) | net USD flow from labelled funds/traders, 1h/24h/7d/30d, trader count (:71-96) | "Is smart money buying?" | `smartMoney` component, wt 10, flow vs pool depth (score.ts:59,621-641) | no |
| `plexa-pretrade` · Plexa | **0.05** (plexa.ts:38) | Base (+Solana pay) | sell sim at your size: verdict clear/avoid/unknown, exit liquidity, impact bps (:99-126) | "Can I actually sell?" | proven `avoid` → `cannot_sell` hard gate (score.ts:286); Base tokens only (index.ts:437) | no |
| `deepnets-token-safety` · Deepnets | 0.01 (token-intel.ts:56) | Solana | risk level, top-10 %, wallet-network %, mint/freeze, bundled, critical risks (:72-86) | "Is this a rug setup?" | `get_token_intel` tool, Solana (agent/tools.ts:595) | yes |
| `gate402-base-radar` · gate402 | 0.02 (gate402.ts:36) | Base | newest pre-screened Base pools; or RISING/FALLING + ACCUM/DISTRIB behind honeypot check (:79) | "What just launched on Base / is it accumulating?" | `paid_launches` discovery feed (discover.ts:228-231) | auto-swept by `scan_universe` (tools.ts:270) |
| `solenrich-launches` · SolEnrich | 0.012 launches / 0.004 token / 0.003 ask (solenrich.ts:46-48) | Solana | new launches, safest-first, risk 0-1; top-20 holders, HHI, slippage | "What just launched on Solana that isn't junk?" | `paid_launches` feed (Solana) | auto-swept; experimental |
| `cmc-quotes` / `cmc-dex-search` · CoinMarketCap | 0.01 each (coinmarketcap.ts:41,95) | Base | price, vol, mcap, 1h/24h/7d; DEX pair lookup | "What's the price / where does it trade?" | ad-hoc | quotes: yes |
| `agentdata` | ≤0.003 (agentdata.ts:48; README says 0.001–0.003) | Base | funding, vol, correlation, liquidation levels for majors (:23-29) | "Is the market levered/risk-on?" | ad-hoc | no |
| `dripmetrics-summary` / `-metric` | 0.25 / 0.05, execution-impact 0.25 (dripmetrics.ts:54,173,137-139) | Base | BTC/ETH/SOL order-flow regime; CVD, imbalance, impact | "What will my order cost; what regime?" | ad-hoc | no |
| `bazaar` | from resource's 402 (bazaar.ts:32) | any | anything from `search_data_sources` | long tail | ad-hoc | no |

## Alpha types (slide)

1. **Sentiment & narrative** — $0.001–0.01 · *Is anyone talking about it, and is talk accelerating?* · x402Atlas, SentimentAlpha, Otto
2. **Smart money** — $0.05 · *Are wallets with a track record on your side?* · Nansen
3. **Sell safety & rug risk** — $0.01–0.05 · *Can I exit at my size; is the mint/holder setup a trap?* · Plexa, Deepnets
4. **Fresh launches** — $0.012–0.02 · *What launched minutes ago, pre-filtered for junk?* · gate402, SolEnrich
5. **Market microstructure & macro** — $0.001–0.25 · *What regime is it and what will my fill cost?* · DripMetrics, AgentData, CoinMarketCap

## Full due diligence on one token (code prices)

- **Base:** sentiment 0.006 + smart money 0.05 + sell check 0.05 = **$0.106**; + gate402 momentum 0.02 = **$0.126**
- **Solana:** sentiment 0.006 + smart money 0.05 + Deepnets safety 0.01 = **$0.066** (no sell check on Solana, index.ts:437)

Web comparison (labelled):
- Nansen Pro: $69/mo monthly, $49/mo annual ([CostBench](https://www.costbench.com/software/onchain-analytics/nansen/)) → ≈1,380 x402 smart-money calls for one month's fee.
- LunarCrush API: Individual $90/mo, Builder $300/mo ([LunarCrush support](https://lunarcrush.com/support/how-much-does-lunarcrush-cost)) → $90 ≈ 15,000 x-search calls.
- Nansen Pro + LunarCrush Individual ≈ $159/mo ≈ **1,500 full Base due-diligence passes**, paid only on tokens that already cleared the free gates.

Pitch line: *A seat buys a month of dashboards; x402 buys one answer at a time, ~10¢ for a full check, only on tokens worth checking.*

## Drift to flag
- README.md:61 says x-search is $0.005; code is $0.006 (x-search.ts:6,34).
- `ENRICHMENT_PRICE_USD.deep = 0.01` (agent/enrichment.ts:29-34) is the sentimentalpha price; the default path costs $0.006.
- SPEC.md:190 says `deep` is "the only paid path in scoring". Not true any more: `smartMoney` and `sellCheck` exist (index.ts:83-88).
- SPEC.md:102,137 still list `token-intel-sol`, which was removed (registry.ts:24-30).
