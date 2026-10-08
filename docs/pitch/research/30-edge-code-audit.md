# 30 · Edge in the code: how Tocker filters and picks (origin/main 11ecbdd, 2026-10-08)

Code audit behind the pitch-roast answer. File refs are against origin/main.



## 1. Candidate sourcing
- **Solana:** Jupiter `recent`, `toptraded/24h`, `toporganicscore/24h`, up to 60 rows each (`src/lib/tokens/discover.ts:91,617-643`).
- **Base:** GeckoTerminal new and trending pools plus DexScreener; at most 24 tokens are enriched (`discover.ts:645-690`).
- **GeckoTerminal launches:** 3 pool pages per chain, at most 15 lookups per sweep. Kept only with a GT Score of 50+ (30+ under a 6h age window; no score bar under 15 minutes) (`discover.ts:356-375,457-463`).
- **Paid radar:** SolEnrich ($0.012) or gate402 ($0.02). It is added to every sweep and ignores the owner's settings (`src/lib/agent/tools.ts:386-389,417`).
- **Filtering:** clear blocklist, liquidity, holder and age failures are dropped (`discover.ts:200-237`); the model sees 30 rows.
- **Per tick:** at least 5 fresh tokens must be scored, within 20 model steps and at most 3 proposals (`src/lib/agent/limits.ts:9-19`).
- **Cadence:** every 15 minutes by default (5 minimum, or manual) (`src/lib/agent/config.ts:192`). The cron runs every 5 minutes and takes 5 agents per pass by default (`src/app/api/cron/tick/route.ts:57-59`).

## 2. Step 1: safety gates (`src/lib/tokens/score.ts:260-321`; defaults `config.ts:154-165`)
| Gate | Default | Owner sets? | Source | If data is missing |
|---|---|---|---|---|
| Mint revoked | on | on/off | Jupiter audit; GoPlus on Base | blocks |
| Freeze revoked | on | on/off | Jupiter audit; GoPlus on Base | blocks |
| Honeypot | always | no | GoPlus; GeckoTerminal only if certain | passes |
| Can't sell | always | no | Plexa paid test, **Base only** | passes |
| Tax | 5% max | yes | GoPlus; **Solana assumed 0%** (`score.ts:238`) | passes |
| Liquidity | $15k min | yes | Jupiter, DexScreener, GeckoTerminal | blocks |
| Holders | 150 min | yes | same | blocks |
| Age | 30 min min | yes | same | blocks |
| Top-10 share | 60% max | yes | same | blocks |
| Blocklist | empty | yes | owner | n/a |

- **Score floor:** a buy also needs a score of 62+ that is not rated "avoid" (`src/lib/trading/risk.ts:156-197`).
- **Deepnets:** the paid Deepnets safety read reaches the model only as text and never clears a gate (`tools.ts:637-648`). The prompt says it does (`src/lib/agent/prompts.ts:279-280`).

## 3. Step 2: selection
**Entry score** (`score.ts:50-60,716-794`): five weighted parts.
- **Safety (30):** RugCheck, mint and freeze authority, LP lock, developer share.
- **Liquidity (20):** pool depth, and depth relative to trade size.
- **Organic (20):** Jupiter's organic score, buy/sell balance, trader count; rough proxies on Base.
- **Distribution (15):** holders, top-10 share, developer share.
- **Momentum (15):** 1h, 6h and 24h price, volume, liquidity and holder trends.

Three extras take their weight out of the five when present: GT Score (10, free), X sentiment (15, paid), Nansen (10, paid). A missing part counts as 0. Scores on thin data are capped at 79 (`score.ts:730-766`). The weights are hand-set and have never been fitted to outcomes.

"Top reasons" on a receipt are simply the three highest raw part values (`src/lib/trading/receipt.ts:97-110`).

**The AI model's role.** Its prompt holds the strategy word for word, the thresholds, how the score works and the exit rules. Each tick adds the portfolio, the last 10 trades and how close each position is to an exit (`prompts.ts:196-449`). It has 11 tools.
- **The model chooses:** what to score, what to buy, the size up to the limit, extra sells, and the public rationale.
- **The code decides:** the candidate list, gates, score, paid purchases, risk limits, the quote sanity check (refuses a buy quoted more than 50% off market, `tools.ts:1094`), and exits.

**Paid data.** There are 13 sources (`src/lib/data-sources/registry.ts:56-70`). The main ones: X search ($0.006), Deepnets Solana safety ($0.01), Nansen smart money ($0.05), Plexa Base sell test ($0.05), CoinMarketCap ($0.01). New agents get X search, CoinMarketCap and Deepnets (`config.ts:148`).
- **Purchase:** after free scoring, paid data is bought automatically in this order: Deepnets or Plexa, then sentiment, then Nansen (`src/lib/agent/enrichment.ts:55-90`).
- **Skipped:** only tokens with a confirmed block. Tokens below the score floor are still enriched, even though the tool description says otherwise (`tools.ts:574`).
- **Ceilings:** the platform pays, up to $1 per run by default ($5 hard cap), $5 per owner per day and $100 platform-wide per day (`src/lib/x402/daily-budget.ts:21-23`; `src/lib/x402/paidFetch.ts:623-638`).

**Strategy text** is pasted verbatim into the prompt and never parsed into rules (`prompts.ts:198-199`). It cannot loosen any gate.

## 4. Sizing and exits
- **Buy limits:** $100 per trade, 10 buys a day, 25% of equity per token, and cash for the trade plus the fee (`risk.ts:236-381`). Sells are never blocked.
- **Exits (`src/lib/trading/exits.ts:300-453`):** stop loss 15%, take profit 40%, score below 40, liquidity down 50%. Trailing stop and max hold are optional. Each exit sells the whole position.
- **Exit checks run every 5 minutes** and sell at market, so a fast crash can blow through the stop (`src/lib/agent/scheduler.ts:339`).
- **Approval mode is the default** (`config.ts:191`). Proposals expire after 60 minutes, and exits skip approval.

## 5. Performance infrastructure
- **Paper trading still exists:** every new agent starts on paper with $10k (`src/server/actions/agents.ts:245`).
- **No backtester, replay or evaluation harness.**
- **Per-agent metrics exist:** win rate, returns by entry-score band (`src/lib/analytics.ts:279`), drawdown and an equity curve.
- **Leaderboard caveat:** it ranks paper and live agents together (`src/server/queries/discover.ts:101`).

**Tables** (`src/db/schema.ts`):
- `agent_run_steps` (381): every tool call as JSON, including scores and refusals.
- `token_score_history` (592): score, blocks, price, liquidity and holders per scoring, but no agent ID.
- `trades` (433): fills, proposals, exits.

**Missing:** tokens dropped before scoring, and any later price for tokens nobody re-scored. Deleting an agent also erases its record.

**What we could measure:**
- **Blocked tokens that later rugged:** the blocks and starting price exist, but forward prices and a rug definition do not.
- **High vs low scores:** the same gap. On top of that, the AI chooses which tokens get scored, which skews the sample.
- **Realized PnL per agent:** this exists, net of fees. But paper and live are mixed, and data costs are left out.

## 6. Proof plans
- **(c) Shadow study (do first): about 4 days of work, then 2-4 weeks of data.** A cron job runs the existing discovery and scoring and logs every candidate, including dropped ones and why. A second job records each token's price at +1h, +6h, +24h and +7d.
- **(b) House agents: about 3 days, then 4-8 weeks.** Run 3-4 public agents with $200-500 of real money each, plus a mechanical "buy the top score" control and a hold-SOL baseline. Raise the owner's daily data cap first: one default agent spends about $9 a day.
- **(a) Historical backtest: 8-12 days, least faithful.** The pure scoring and exit code can be reused. But the safety data (Jupiter, RugCheck, GoPlus, GT Score) has no history, so inputs would have to be rebuilt from Dune and price candles. Only the gates can be tested faithfully, and the AI step not at all.

## 7. Differentiators and claim checks
**Genuine differentiators:**
- Most gates refuse a token when data is missing.
- Exits trigger on a collapsing score or a draining pool.
- An AI applies a written thesis on top of hard gates.
- Paid data is bought per call, with caps.
- Each trade gets a public receipt while the strategy stays private.

**Table stakes for Telegram bots:** stop-loss, take-profit, authority and liquidity filters. All inputs are public APIs.

**Claim checks:**
- **"10 hard gates":** the count holds, but the sell check is Base-only and off by default, and Solana has no tax check.
- **"Unknown blocks":** true for 6 of the 10 gates.
- **"7¢ Solana / 11¢ Base":** only with Nansen enabled (6.6¢ and 10.6¢). The defaults are about 1.6¢ and 0.6¢, plus the radar.
- **"Exits enforced in code":** true, but checked every 5 minutes at market price.
- **"Every fill public":** only for public agents. The rationales are written by the AI, and only the prompt stops them leaking the strategy.
- **"Private beta":** wrong. Sign-up is open and the landing page says "Open beta" (`src/components/liquid/hero.tsx:33`).

## 8. Deck facts to update (`docs/pitch/pitch-3min.md`)
- **Fee:** now live at 0.5% of each fill (`src/lib/platform/fee.ts:35`), not $0.10 flat.
- **Beta status:** "private beta" should be "open beta".
- **Paper trading:** still the default starting mode, even though the landing page dropped it.
- **Pay-per-use AI:** ships switched off (`src/lib/x402/inference-types.ts:540`), so "no keys at all" depends on the production setting.
- **Unit economics:** at the $5 daily data cap, the 0.5% fee breaks even only above about $1,000 of fills per owner per day.
