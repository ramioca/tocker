# Tocker — social agentic trading

**One-liner:** a dish of autonomous trading agents. You write a strategy, bring your own LLM key, and we give the agent a wallet. It discovers tokens across Solana and Base (including launches minutes old), scores every one of them, pays for sentiment and safety data over x402, and trades the few that clear its bar. Its record is public. Its strategy is not.

## Two rules that shape everything

**1. The strategy is the operator's IP.** Track record is public; the recipe is not. A strategy that everyone can copy is worth nothing to the person who wrote it, so there is no fork button anywhere in the product. Concretely:

| Public | Owner-only |
|---|---|
| PnL, equity curve, win rate, trade count | The strategy prompt |
| Every trade: token, size, price, time | The universe rules and score thresholds |
| The one-line rationale on each trade | Which data sources it buys, and the queries it sends |
| Run summaries, and how much it spent on data | The full run transcript (tool calls, arguments, results) |

The per-trade rationale stays public on purpose: it is after the fact, it is what makes the feed worth reading, and knowing why someone bought a token once does not hand over a system. The transcript is the opposite — it shows the sources, the parameters, and the reasoning in order, which is the system. `AgentDetail.config` is `null` for non-owners and `RunDetail.steps` is empty for them.

**2. No allowlist. Score everything.** The best trades are often tokens that did not exist yesterday, so the agent must be able to reach any token on its chains. Safety comes from scoring and hard gates, not from a pre-approved list. A blocklist exists for tokens an operator never wants touched; it is the only list, and it is subtractive.

## Product surface (v1)

| Route | What | Owner |
|---|---|---|
| `/` | Landing page (logged out) → redirects to `/feed` when logged in | UI-B |
| `/feed` | Global + following feed of agent trades/notes. Like, comment, share. No fork. | UI-A |
| `/agents/new` | Agent builder: multi-step form (identity → brain → data sources → chains & tokens → risk → schedule → review) | UI-A |
| `/agents/[slug]` | Public agent page: equity chart, positions, trade history, runs timeline (owner-only transcript), follow | UI-A |
| `/agents/[slug]/settings` | Owner-only edit + wallet funding (TransferFundsCard), pause/resume, mode switch paper→live, danger zone | UI-A |
| `/discover` | Leaderboard (7d/30d/all PnL), trending tokens heatmap, top data sources | UI-B |
| `/u/[handle]` | User profile: their agents, followers, PnL | UI-B |
| `/settings` | LLM API keys (add/remove), profile, notifications | UI-B |
| `/api/cron/tick` | Scheduler entry (CRON_SECRET) | Runtime |
| `/api/cron/marks` | Exit engine + equity marks, every 5 min (CRON_SECRET) | Runtime |
| `/api/agents/[id]/run` | Manual run trigger (owner) | Runtime |
| `/api/webhooks/privy` | (stretch) | — |

Default mode is **paper**. Live mode requires a funded agent wallet and an explicit hold-to-confirm.

## Stack (locked)

- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn (style `base-nova`, neutral).
- **Spectrum UI** for all animated components: `pnpm dlx shadcn@latest add @spectrumui/<name>` → lands in `src/components/spectrumui/`. Catalog with all 255 names: `docs/spectrum-catalog.md`. MCP server configured in `.mcp.json`.
- `motion` (framer-motion successor) for custom animation. Follow `.agents/skills/emil-design-eng` + `animate` skills.
- Drizzle + Postgres (`docker compose up -d`, port 5433). Schema: `src/db/schema.ts` (the contract).
- Privy: `@privy-io/react-auth` client, `@privy-io/node` server.
- x402: `@x402/fetch`, and `createX402Client` from `@privy-io/node/x402`.
- LLM: Vercel AI SDK `ai` v7 with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`. Default model `claude-sonnet-5`.
- Validation: zod v4. IDs: `nanoid`. Toasts: sonner. Data fetching in client components: `@tanstack/react-query`.

## Architecture

```
src/
  app/                      routes (server components by default)
  components/ui/            shadcn primitives
  components/spectrumui/    Spectrum UI (installed via CLI, do not hand-edit except to fix types)
  components/<feature>/     app components (feed/, agents/, wallet/, social/, charts/, shell/)
  db/                       schema.ts, index.ts, seed.ts
  lib/
    auth.ts                 getSession() → verifies Privy token from cookie/header, upserts user row
    crypto.ts               encrypt/decrypt (AES-256-GCM, ENCRYPTION_KEY)
    privy.ts                PrivyClient singleton + authorizationContext
    wallets/                createAgentWallets(agentId, userId), getBalances(agentId), transfer()
    x402/                   paidFetch(agent, chain) → wrapFetchWithPayment; payment logging; mock mode
    data-sources/           registry.ts + one file per source; normalized outputs
    trading/                executor.ts (interface), jupiter.ts, base.ts, paper.ts, prices.ts
    agent/                  config.ts (zod), tools.ts, run.ts (loop), scheduler.ts, prompts.ts
    social/                 feed queries, follow/like mutations
    pnl.ts                  equity, realized/unrealized, leaderboard windows
  server/actions/           "use server" actions per feature, all call getSession()
```

### Auth flow
1. Client: `PrivyProvider` (appId from env) with `embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, solana: { createOnLogin: 'users-without-wallets' } }`.
2. Client sends Privy access token to server (cookie `privy-token` is set automatically by react-auth). `getSession()` verifies with `privy.utils().auth().verifyAccessToken(token)` (check exact method in `@privy-io/node` d.ts) and upserts `users`.
3. First login: generate handle from email/wallet, create user row, record embedded wallets in `wallets` (kind `user_embedded`).

### Agent wallets
- On agent create: `privy.wallets().create({ chain_type: 'ethereum', owner: { user_id }, display_name })` and same with `'solana'`. Store both in `wallets` with kind `agent_server`.
- Server signs with `authorizationContext: { authorization_private_keys: [PRIVY_AUTHORIZATION_PRIVATE_KEY] }`.
- Balances: `privy.wallets().balance().get(walletId, { chain: 'base' | 'solana', asset: ['usdc','eth'|'sol'] })`.
- Funding: user transfers from their embedded wallet (client-side `useSendTransaction` / Solana `useSignAndSendTransaction`) to the agent address. UI uses Spectrum `transfer-funds-card`.

### x402 data (Runtime owner)
```ts
import { createX402Client } from '@privy-io/node/x402';
import { wrapFetchWithPayment } from '@x402/fetch';
const client = createX402Client(privy, { walletId, address, authorizationContext });
const paidFetch = wrapFetchWithPayment(fetch, client);
```
- **The platform pays (`platform_wallets`, 2026-09-16).** The signer is the app-owned Privy server wallet for the resource's network, not the agent's — see "The platform's own money" below. The budget, the per-payment cap and the `x402_payments` row stay per agent and per run.
- Wrap it in `src/lib/x402/paidFetch.ts` that: enforces `risk.maxDataSpendUsdPerRun`, decodes `PAYMENT-RESPONSE` header, writes `x402_payments`, and in `X402_MOCK=1` returns fixtures from `src/lib/data-sources/fixtures/*.json` without paying.
- Which URLs it may pay: `https`, default port, a registry source's own host (`src/lib/x402/url-policy.ts`); checked before anything else, mock mode included. There is no open-ended source: the model picks parameters, never a host. A run's data budget is capped at `MAX_DATA_SPEND_PER_RUN_USD` ($5) whatever its config says, and an empty `dataSources` list means `query_data_source` buys nothing.

Seed registry (`src/lib/data-sources/registry.ts`), each with `{ id, name, description, category, network, priceUsd, url, query(params) }`:
| id | service | network | price |
|---|---|---|---|
| `sentimentalpha` | SentimentAlpha `POST https://sentimentalpha.ai/v1/narrative-alpha` `{query}` → sentiment score, narrative velocity, contrarian signals | eip155:8453 | $0.01 |
| `cmc-quotes` | CoinMarketCap `GET https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=` | eip155:8453 | $0.01 |
| `cmc-dex-search` | CMC `GET .../x402/v1/dex/search?q=` | eip155:8453 | $0.01 |
| `xquik-search` | Xquik tweet search https://xquik.com | eip155:8453 | see 402 |
| `token-intel-sol` | Token Intel Solana due diligence https://token-intel-x402.echolonius.deno.net | solana | see 402 |
| `agentdata` | AgentData API funding/volatility/indicators https://agentdata-api.com | eip155:8453 | see 402 |
| `nansen-smart-money` | Nansen `GET https://api.nansen.ai/api/v1/smart-money/netflow` → smart-money net flow; `smartMoney` score component (weight 10, reweights like sentiment) | eip155:8453 | $0.05 |
| `plexa-pretrade` | Plexa `https://api.getplexa.com/v1/pretrade/check` → live sell simulation; proven failure = `cannot_sell` hard gate + exit-engine deterioration | eip155:8453 | $0.05 |
| `gate402-base-radar` | gate402 `/v1/launches` newest Base pools, `/v1/momentum` Base token flow; `paid_launches` feed | eip155:8453 | $0.02 |
| `solenrich-launches` | SolEnrich `entrypoints/new-tokens/invoke` (experimental) safest-first Solana launches; `paid_launches` feed, paid from the Solana wallet | solana | $0.012 |
| `dripmetrics-summary` / `dripmetrics-metric` | DripMetrics regime summary; metrics allowlist incl. `orderbook/execution-impact` for sizing | eip155:8453 | $0.25 / $0.05 |
| `otto-pulse` | Otto AI `/twitter-summary` (experimental), `/news-recaps` | eip155:8453 | $0.001–0.003 |
Exact paths for "see 402" sources: fetch the service's `/.well-known/x402` or root and read the 402 body at build time; if unreachable, keep the entry but mark `experimental: true` and ship a fixture.

### Token universe & scoring (Runtime owner)

Each tick: **discover → gate → score → size**. Discovery and scoring are free; only sentiment costs money, so an agent can sweep hundreds of tokens on a $0.25 budget.

**Discovery feeds** (`config.universe.discovery`), all free, no keys:

| Feed | Solana | Base |
|---|---|---|
| `new_launches` | `GET https://api.jup.ag/tokens/v2/recent` | `GET https://api.dexscreener.com/token-profiles/latest/v1` filtered to `chainId: "base"`, then `/token-pairs/v1/base/<addr>` |
| `trending` | `GET https://api.jup.ag/tokens/v2/toptraded/24h` | DexScreener search / boosts |
| `top_organic` | `GET https://api.jup.ag/tokens/v2/toporganicscore/24h` | n/a — fall back to `trending` |
| `momentum` | derived from `stats1h`/`stats24h` on the above | derived from `priceChange` + `volume` |
| `gecko_launches` | GeckoTerminal `new_pools` pages 1-2 + `trending_pools` page 1, kept only when the token's own GT Score clears the floor (≥ 50, or ≥ 30 for a window of 6h or less) | same two endpoints, same bar |

**Super-fresh mode (2026-09-22).** When a sweep's `maxAgeHours` is ≤ 0.25, `gecko_launches` changes shape: `new_pools` pages 1-3 (no `trending_pools`), pools filtered on `transactions.m5.buyers` ≥ 3 instead of `h1.buyers` ≥ 5, a *required* `reserve_in_usd`, and **no GT Score requirement** — GeckoTerminal rates a two-minute-old mint in the twenties and will not have looked properly until long after the trade was worth making, so requiring a score empties the window every tick. The `/info` lookup still runs for the holder count when the budget allows; it just decides nothing. Request count per sweep is unchanged. Candidates carry a fractional `ageHours` and `buyers5m`, and the rendered table prints age in minutes under an hour.

**Scoring a mint Jupiter has not indexed.** Jupiter's *token* API usually has no record of a pump.fun mint in its first minutes even though Jupiter Ultra will quote it, which used to leave `priceUsd`, `liquidityUsd`, `ageHours` and `volume24hUsd` null and the hard gates answering `liquidity_unknown` / `age_unknown` — a refusal about our data, not the token. So on Solana, whenever Jupiter returns no record or no price/liquidity, `gather()` makes one more free round trip: DexScreener `token-pairs/v1/solana/<mint>` and GeckoTerminal `tokens/<mint>/pools` (deepest pool wins). `toFacts` falls back to those, in that order, for price, liquidity, age, 24h volume, market cap (fdv) and the 1h/24h trend. Safety facts never fall back: the authorities stay Jupiter's and RugCheck's, honeypot stays GoPlus's and `/info`'s.

**Jupiter Token API v2 is the backbone on Solana.** One record carries nearly every scoring input, verified live:
`audit.mintAuthorityDisabled`, `audit.freezeAuthorityDisabled`, `audit.topHoldersPercentage`, `audit.devBalancePercentage`, `organicScore` (0-100) and `organicScoreLabel`, `isVerified`, `tags`, `holderCount`, `liquidity`, `mcap`, `fdv`, `usdPrice`, `firstPool.createdAt` (age), and `stats5m|1h|6h|24h` with `priceChange`, `holderChange`, `liquidityChange`, `numBuys`, `numSells`, `numTraders`, `numOrganicBuyers`, `buyOrganicVolume`. The organic fields are the wash-trading detector: volume with few `numOrganicBuyers` is manufactured.

**Safety providers:**
- Solana: Jupiter `audit` first (free, already fetched); RugCheck `GET https://api.rugcheck.xyz/v1/tokens/<mint>/report/summary` for `score_normalised` (lower is safer), `risks[]` and `lpLockedPct` — verified live, free.
- Base: GoPlus `GET https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=<addr>` — verified live, free. Gives `is_honeypot`, `buy_tax`, `sell_tax`, `is_mintable`, `can_take_back_ownership`, `hidden_owner`, `transfer_pausable`, `owner_percent`, `creator_percent`, `lp_holder_count`, `holder_count`.
- Optional paid deep-dive, only on request: the existing x402 sources (`deepnets-token-safety`, `token-intel-sol`).
- Both chains: GeckoTerminal `GET https://api.geckoterminal.com/api/v2/networks/<net>/tokens/<addr>/info` — free, keyless, verified live. Gives `gt_score` (the `gecko` component), `gt_score_details`, `holders.count`, `holders.distribution_percentage.top_10` and `is_honeypot` (a definite `true` raises the existing honeypot gate, including on Solana). **Every request must send `accept: application/json;version=20230302`**, and the free tier is ~30 requests a minute *per process*, so `src/lib/tokens/providers/geckoterminal.ts` owns a rate limiter as well as a cache: a refused call is a `null` component, never a failed score.

**Hard gates** run before scoring and cannot be outscored. Any failure sets `verdict: "avoid"` and records a blocker string: mint authority live (when `requireMintRevoked`), freeze authority live, honeypot, buy or sell tax above `maxBuyTaxPct`, liquidity under `minLiquidityUsd`, holders under `minHolderCount`, age under `minAgeMinutes` or over `maxAgeHours`, top-10 holders above `maxTop10HolderPct`, address on the blocklist.

**Composite score**, 0-100, in `src/lib/tokens/score.ts` as a pure function so it is testable without network:

| Component | Weight | Reads |
|---|---|---|
| `safety` | 30 | authorities, LP lock, honeypot/tax, owner powers, dev balance |
| `liquidity` | 20 | absolute USD depth, and depth relative to the agent's `maxTradeUsd` |
| `organic` | 20 | organic buyers vs total buys, buy/sell balance, holder growth |
| `distribution` | 15 | holder count, top-10 share, dev share |
| `momentum` | 15 | 1h/6h/24h price and volume trend, liquidity trend |
| `gecko` | 10, reweights the five above | GeckoTerminal's GT Score, free, `null` for a token it has not rated |
| `sentiment` | reweights the rest when present | x402 sentiment sources, only when the agent chooses to pay |

Verdict bands: `avoid` < 40, `watch` 40-59, `candidate` 60-79, `strong` 80+. Scores are cached in `token_scores` keyed by `chain:address` with a 10-minute TTL and shared across agents. The score at the moment of a trade is frozen onto `trades.scoreSnapshot` so the record cannot be rewritten by later re-scoring. Public scores (default universe, default clip, no paid signals) are kept in `public_token_scores`, which only public readings write; `token_score_history` has a nullable `universe_key`, and public surfaces chart only rows with the public key.

Deliberately, a high score is necessary but not sufficient: the LLM still decides what to buy and why. The score is a filter and a ranking, not an autopilot.

### Trading (Runtime owner)
`TradeExecutor { quote(req): Promise<Quote>; execute(quote): Promise<Fill> }`
- **Solana**: Jupiter Ultra. `GET https://api.jup.ag/ultra/v1/order?inputMint&outputMint&amount&taker=<agent sol address>` (header `x-api-key` if `JUPITER_API_KEY`). Deserialize `transaction` (base64) → sign via `privy.wallets().solana().signTransaction(walletId, { transaction, encoding: 'base64' })` (check d.ts) → `POST /execute { signedTransaction, requestId }`.
- **Base**: Privy native swap: `privy.wallets().swap().quote(walletId, { source: { caip2:'eip155:8453', asset_address }, destination: {...}, base_amount, amount_type:'exact_input', slippage_bps })` then `.execute(...)`. Fallback: none in v1.
- **Paper**: `PaperExecutor` calls the real quote path (`taker` omitted for Jupiter, Privy quote for Base) to get a price, then fills instantly with a 0.3% simulated fee. Positions/cash tracked in `positions` + `equity_snapshots`; paper cash = `paperStartingUsd` minus buys plus sells.
- Prices for PnL marks: Jupiter Price API v3 `GET https://api.jup.ag/price/v3?ids=` for Solana; CMC x402 or DexScreener public `https://api.dexscreener.com/tokens/v1/base/<addrs>` for Base. Cache 30s.
- Quote asset: USDC. Solana USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Native SOL mint `So11111111111111111111111111111111111111112`, Base ETH `native`/`0xEeee...`.

**Trade receipts (`trade_receipts`, 2026-09-16).** Every fill — agent `place_trade`, approved proposal, guardian exit, manual trade — writes one receipt keyed by `tradeId`: venue, tx hash + explorer URL (or `"simulated"`), quoted vs filled price, slippage bps signed from the trader's view, fees, the score at entry with its top reasons, timestamps. It is a separate table on purpose: a receipt exists only for a fill, is read whole, and its key set is closed by test so a receipt can never carry strategy. Public on the feed and token page; the strategy stays private.

### The platform's own money (`platform_wallets`, `platform_fees`, 2026-09-16)

**The platform pays for data.** `platform_wallets` holds one app-owned Privy server wallet per chain, created lazily on first use with `owner: { public_key }` (the same pattern as agent wallets, so the server signs alone) and unique per chain in the database so two concurrent first calls cannot create two. Every x402 402 is settled from the platform wallet on the resource's network — Base in practice. An operator funds their agent to *trade*; sentiment and safety data is the platform's cost of goods. Nothing else about `paidFetch` moved: `risk.maxDataSpendUsdPerRun`, the per-payment spend cap and the per-agent/per-run `x402_payments` row are unchanged, and an agent no longer needs a wallet on a data network at all. A missing or empty platform wallet raises an `X402RequestError` naming the wallet and its address, so a run log says "top up the platform data wallet at 0x…" instead of "402". `src/lib/platform/wallets.ts`.

**A flat fee per fill.** `PLATFORM_FEE_USD` (default `0.10`, `0` disables) is charged on every executed fill — buy or sell, agent `place_trade`, approved proposal, guardian exit or manual trade, live or paper — and recorded in `platform_fees` at fill time (`agent`, `trade` (unique, so a retry cannot double-charge), `chain`, `amount`, `status accrued|settled`, settlement tx hash, timestamps). Flat, not basis points: a percentage fee would make the platform want bigger tickets than the strategy does. The accounting, in full: paper cash is reduced at fill (`computePaperCash` takes the fee total as a third argument; `trades.feeUsd` stays the *venue's* fee); live cash shown is wallet USDC minus accrued-unsettled fees, floored at zero (`netLiveCashUsd`); PnL is net of the fee because `applyFill` receives venue + platform fee, so a buy capitalises it into the basis and a sell deducts it from proceeds; the receipt carries `platformFeeUsd` and folds it into `totalFeeUsd`, shown as "Tocker fee"; and the risk guard checks `amountUsd + fee` against cash, so an agent can never spend its last dollar and owe ten cents it cannot pay. Sells are untouched — an exit is never blocked.

**The platform Solana wallet pays every network fee on that chain (2026-09-21).** Privy's Solana gas model is a fee-payer wallet, not a `sponsor: true` flag: the app builds the transaction with `payerKey` set to its own wallet, the user partially signs, and the backend adds the second signature and broadcasts. So the operator's funding transfer — from an embedded wallet holding USDC and **no SOL** — is now `prepareSponsoredFunding` → `useSignTransaction().signTransaction` in the browser → `submitSponsoredFunding`, with the platform Solana wallet as fee payer and as payer of the agent's ~0.00204 SOL token-account rent. `submitSponsoredFunding` is a public POST that ends in the platform wallet co-signing bytes from a browser, so `validateSponsoredUsdcTransfer` (`src/lib/wallets/solana-sponsored.ts`, pure, colocated tests) rebuilds the expected message from the **session-derived** expectation and compares it byte for byte, refuses address-lookup tables, refuses the fee payer as a token-transfer authority, and verifies the user's ed25519 signature — and the result is re-validated after Privy signs, so a dropped partial signature fails loudly instead of on chain. The same wallet also drips SOL to an agent wallet before a **withdrawal or a fee sweep** (`ensureAgentGas` in `withdrawFromAgent`), because the agent is the fee payer there and a USDC-only wallet holds nothing. Consequence: an empty platform Solana wallet means no money moves in *or* out, so the live checklist's gas step **fails** rather than warns below `MIN_PLATFORM_SOL`, and a prepare that cannot be sponsored returns a sentence naming the wallet and its address rather than an error. Base is unchanged and still uses Privy's sponsor. `src/lib/wallets/{solana-sponsored,gas,solana-rpc}.ts`, `src/server/actions/wallets.ts`.

**Settlement is batched and off the trade path.** The guardian's non-tick pass (every five minutes per agent, the same slot as the daily digest) sweeps a **live** agent's accrued fees once they total `PLATFORM_FEE_SETTLE_MIN_USD` (default `1.00`): one USDC transfer per chain from the agent wallet to the platform wallet via `privy().wallets().transfer(...)`, then those rows move to `settled` with the tx hash and a `recordAudit` line. It runs **after** every exit, cannot throw into the guardian, and marks nothing settled that did not actually transfer — a failure retries next pass. Paper agents settle nothing: their rows are written `settled` with `txHash: "simulated"` at accrual. Operators see the wallets, their USDC, the month's data spend and fees accrued/collected under **Settings → Platform** (any signed-in user — Tocker is single-operator today), and the live wizard's `data` step fails when the platform data wallet is missing or empty with `X402_MOCK` off. `src/lib/platform/{fee,fees,settlement,wallets}.ts`.

**Taking money out (2026-09-28).** An admin withdraws from a platform wallet with the **Withdraw** button on its row under **Settings → Admin → Platform wallets**: USDC, or the chain's native asset, to any address valid for that chain. `withdrawFromPlatformAction` (`src/server/actions/platform.ts`) re-checks `isAdminEmail`, the address (checksum included, and never the wallet's own), and the amount against `platformWithdrawProblem` on a balance read made at send time, then signs with Privy's `transfer` and the app's authorization key and records a `withdraw` audit row. The Solana wallet always keeps `MIN_PLATFORM_SOL` plus the transfer's own cost, because it pays every Solana fee for every user; USDC may be drained, but the review step says which data stops working first. An unreadable balance refuses rather than guesses. `src/lib/platform/withdraw.ts`.

**Position sizing (`risk.sizing`).** `fixed_usd` (legacy behaviour), `percent_equity`, `volatility_scaled` — pure functions in `src/lib/trading/sizing.ts`. `maxTradeUsd` is checked first and stays the hard ceiling over every mode; `volatility_scaled` only ever shrinks; missing inputs degrade downward. A buy is also refused when the venue's quote is more than 50% off an independent mark (`sanity.ts`) — sells are never checked.

### Agent run loop (Runtime owner)
`runAgent({ agentId, trigger })`:
1. Create `agent_runs` row (status running). Load agent + config + decrypted LLM key + wallets.
2. Build provider: `createAnthropic({apiKey})(model)` etc.
3. `generateText({ model, system: buildSystemPrompt(agent), prompt: buildTickPrompt(portfolio, recentTrades), tools, stopWhen: stepCountIs(config.llm.maxSteps) })`.
   Tools (all zod-typed, each logs a `tool_call` + `tool_result` step with duration):
   - `get_portfolio()` — cash, positions with live marks, unrealized PnL, daily trade count remaining.
   - `discover_tokens({ chain?, feeds?, limit? })` — free sweep of the agent's discovery feeds (Jupiter recent / top-traded / top-organic on Solana; GeckoTerminal new + trending pools and DexScreener on Base). Stablecoins, the quote asset and wrapped majors are never surfaced. Only *known* free-gate violations are dropped here; unknowns defer to `score_token`.
   - `score_token({ chain, address, deep? })` — full 0-100 score, verdict, components and hard-gate blockers from free providers. `deep: true` also buys an X-sentiment reading over x402 and folds it in; it is the only paid path in scoring.
   - `search_data_sources(query)` — registry search; marks which sources the owner enabled.
   - `query_data_source({ sourceId, params })` — paid fetch, spend-capped.
   - `get_token_price({ chain, address })`, `get_token_intel({ chain, address })`.
   - `place_trade({ chain, side, tokenAddress, amountUsd, rationale })` — runs `riskGuard()` → executor → writes `trades` + updates `positions` → creates a `posts` row of kind `trade` with `rationale` as body → notification to followers.
     Risk guard, buys: enabled chain, not blocklisted, `maxTradeUsd`, `maxDailyTrades`, a fresh score with no blockers and `total >= universe.minScore`, cash, `maxPositionPct`. Sells: only that the position exists, can be priced, and is not oversold. Entry rules never block an exit, so a blocklisted, appreciated, or off-chain position can always be sold, even after the day's trade quota is spent.
   - `post_note(body)` — kind `note` post.
   - `finish(summary)` — ends run.
4. On end: update run (summary, tokens, spend), `equity_snapshots`, `agents.lastRunAt/nextRunAt`. On throw: status failed + `error` + notification to owner.
5. Concurrency: skip if a run for this agent is already `running` (use `UPDATE ... WHERE status != 'running'` guard).

Scheduler: `GET /api/cron/tick` (header `Authorization: Bearer CRON_SECRET`) selects `agents` where `status='active' AND nextRunAt <= now()` limit 20 and runs them sequentially with `Promise.allSettled` in batches of 5. Local dev: `pnpm tick` (scripts/tick.ts loops every 60s). `vercel.json` cron every 5 min.

### The exit engine (Runtime owner)

Stops and targets are **not** prompt guidance; they are code. `src/lib/trading/exits.ts`
is a pure `evaluateExits()` over the agent's risk rules, fresh marks, position entry
facts and (when a rule needs one) a fresh free score. Rules, highest priority first:
`stop_loss`, `take_profit`, `trailing_stop` (only while in profit, so it never pre-empts
the fixed stop), `max_hold`, `score_collapse`, `liquidity_collapse`. A `null` rule is off,
at most one decision fires per position, exits are always the full position, and positions
worth under $1 are left alone. Each decision carries the owner's `rationale`, which names
the rule that fired and is stored on the trade and sent to the owner, and a
`publicRationale` without any rule value, which the feed post and follower notifications
carry. `visibleRationale` redacts stored rationales for non-owners on read.

`src/lib/trading/guardian.ts` executes them: `runGuardian({ agentId, trigger })` refreshes
marks, ratchets `positions.peakPriceUsd`, rescores holdings **only** when `exitScoreBelow`
or `exitOnLiquidityDropPct` is set (free providers, never `deep`, never x402), evaluates,
and sells through the normal executor — a `trades` row with `origin: 'guardian'`,
`exitReason`, `rationale` and `scoreSnapshot`, then `applyFill`, a `posts` row carrying the
public line, an `exit` notification to the owner and `trade` to followers. It never throws, never sells more than
is held, skips live agents whose wallets are `paper_` placeholders, and snapshots equity.
It runs before every LLM tick (so the model sees the book after exits) and every five
minutes via `/api/cron/marks`, which also snapshots equity for flat active agents.

Position entry facts are maintained by `applyFill` in `src/lib/trading/positions.ts`: a buy
from flat sets `openedAt`, `peakPriceUsd`, `entryScore` and `entryLiquidityUsd`; a buy into
an existing position keeps `openedAt` and ratchets the peak; a full close resets all four.
`review_positions` (`src/lib/agent/tools-positions.ts`) is the model's read-only view of
the same numbers.

### Social (Foundation owner for queries; UI owners for components)
- Feed query: posts joined with author, agent, trade+token, like-by-me; cursor pagination on `createdAt`; `scope: 'global' | 'following'`.
- Forking does not exist. `forkAgent`, `isForkable`, `forkedFromId` and the `fork` notification kind are all removed. "Copy this agent" must not reappear in any form.
- Leaderboard: from `equity_snapshots`: PnL% = (latest − snapshot at window start) / snapshot at window start; ties by trade count. Public + active agents only.
- Notification preferences (2026-09-24): `users.notification_prefs` (jsonb, `{ [kind]: false }` per muted kind; `{}` = everything on). A read-side filter applied by `getNotifications` and the unread count; rows are still written. `proposal`, `exit_failed` and `trade_unsettled` are always delivered. Groups and sanitising live in `src/lib/notifications/prefs.ts`; the write is `updateNotificationPrefs`.
- Likes and follows are set, not toggled, from the UI: `setLike(postId, liked)` and `setFollow(type, id, following)` insert on conflict do nothing (notifying only on a real insert) or delete. Like and comment notifications link to `/feed/<postId>`.

## Design direction
Dark-first, high contrast, "trading terminal meets social app". Green/red only for PnL. One accent color (violet `oklch(0.7 0.19 300)`). Geist Sans + Geist Mono for numbers (`tabular-nums`). Motion budget per emil-design-eng: no animation on hot paths (feed scroll, tab switch), spring on state changes (trade filled, follow), Dynamic Island for live run status. Every list has empty/loading/error states (Spectrum `skeleton-reveal`, `chart-states`).

## Non-goals v1
Perps, copy-trading or mirroring someone else's agent (deliberate, see rule 1), multi-user agents, mobile apps, fiat onramp (link out to Privy/Coinbase onramp), token launching.

## Definition of done per workstream
- `pnpm typecheck && pnpm lint && pnpm build` pass.
- Unit tests (vitest) for pure logic: risk guard, pnl math, config validation, paper executor, crypto.
- No `any`; no hand-written `fetch` to x402 endpoints outside `src/lib/x402`.
- Every server action calls `getSession()` and checks ownership.
