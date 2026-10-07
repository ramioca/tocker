# Deploying Tocker to Vercel

## What you must decide first

| Decision | Why it matters |
|---|---|
| **Hobby or Pro** | Hobby works for a private test deploy, with three hard limits: cron jobs run **once per day maximum** (a 5-minute schedule *fails the deployment*), functions are capped at **60 seconds**, and Hobby teams **cannot connect to Git organization repositories** — the repo must be personal. `vercel.json` ships Hobby-safe: no `crons` block, 60s functions. Scheduling comes from `.github/workflows/cron.yml` instead, which runs every 5 minutes on either plan. |
| **Postgres provider** | PGlite is a local file and cannot run on serverless — every write is lost when the instance recycles. `/api/health` returns 503 if production is still on PGlite. Use Neon (free tier is enough to start), Supabase, or Vercel Postgres. |
| **Shaders licence** | The `shaders` package is proprietary: free for personal and evaluation use, but **any public-facing deployment requires a Pro or Team licence** from shaders.com. The landing hero falls back to a static gradient when the shader is absent, so the site works either way. |

### One more thing about Hobby

Vercel's fair use guidelines restrict Hobby to **non-commercial personal use**. Commercial use is defined as any deployment used for the financial gain of anyone involved, including requesting payment from visitors or advertising a product for sale. A private pre-revenue test deploy of Tocker is fine; the moment it takes money or markets a paid product, it needs Pro.

### Agent runs and the 60-second cap

Every due agent runs inside the cron invocation that picked it up. With a real model and several tool calls a single run can take tens of seconds, so on a 60s function the batch has to stay small. `CRON_MAX_AGENTS` controls it and defaults to **5**; set it to `2` on Hobby if runs are timing out, and raise `maxDuration` back to 300 in `vercel.json` and the three route files once you are on Pro. Past a few dozen active agents this belongs in a queue rather than a serverless function either way.

A **pay-per-use** run (section 5) is a different size: every model step is a quote, a signature and a paid request, and a run is not started at all unless 250 seconds of its invocation remain. On a 60s function it therefore never starts; it simply stays due. Pay-per-use needs Pro, Fluid compute and the 300s `maxDuration` that `vercel.json` already names.

## 1. Database

Create a Postgres database and copy its pooled connection string. On Neon: New Project → Connection string → **Pooled connection** (the `-pooler` host), and append `?sslmode=require`.

Migrations are in `drizzle/` and run automatically on deploy via the `vercel-build` script (`drizzle-kit migrate && next build`). To run them by hand:

```bash
DATABASE_URL="postgres://..." pnpm db:migrate
```

Seed demo data into a staging database only. Never seed production.

## 2. Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for **Production only**.
A Preview deployment builds a branch's code, which may not have been reviewed, so it must
never be handed the production database, the Privy secrets or the wallet authorization
key. If you want working previews, give Preview its own database and its own Privy app.
`vercel-build` skips migrations on anything but a production build.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection string |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy dashboard → App ID |
| `PRIVY_APP_SECRET` | Privy dashboard → App Secret |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Privy → Wallet infrastructure → Authorization keys |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **generate once and never rotate**, it decrypts stored LLM keys |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app`, or the custom domain once it is attached. Share cards are built from it: unset, every page's `og:image` points at `http://localhost:3000` and a link to the site previews with no image. |
| `X402_MOCK` | `1` runs on fixtures. Anything else — including unset — means **real** payments; `isMockMode()` tests for exactly `"1"`. |
| `X402_OWNER_DAILY_USD` | The most one owner's agents may spend on platform-paid data in 24 hours. Default `5`. Counted from `x402_payments`, so it holds across instances. |
| `X402_PLATFORM_DAILY_USD` | The most all agents together may spend on platform-paid data in 24 hours. Default `100`. This is the ceiling on what the platform data wallets can lose in a day; `0` switches paid data off. |
| `CRON_MAX_AGENTS` | Agent *runs* per `/api/cron/tick` invocation. Default 5; use 2 on Hobby. It does not limit the exit engine: `/api/cron/marks` checks every agent holding a position, live books first, up to 200 a pass. |
| `LLM_MOCK` | unset (or `0`) |
| `SOLANA_RPC_URL` | Solana RPC, server-only. Use Helius or another provider — the public RPC is rate-limited. The browser never sees it; `/api/solana/blockhash` proxies the one call it needs. |
| `BASE_RPC_URL` | Any Base RPC |
| `JUPITER_API_KEY` | Optional, raises Jupiter rate limits |
| `PLATFORM_FEE_USD` | What each executed fill is charged. Default `0.10`; `0` switches the fee off entirely. A malformed value falls back to the default rather than going free. |
| `PLATFORM_FEE_SETTLE_MIN_USD` | How much an agent must owe before the guardian sweeps its fees on-chain. Default `1.00`. Lower means more transfers for the same money. |
| `INFERENCE_USDC` | Pay-per-use thinking (section 5). Unset, empty or anything unrecognised is **off**, and the app behaves exactly as it did before the feature existed. `owner` admits the people in `ADMIN_EMAILS` and the ids in the next row; `on` admits everyone. Do not set it before reading section 5. |
| `INFERENCE_USDC_USER_IDS` | With `INFERENCE_USDC=owner`: more accounts to admit, comma-separated user ids (`did:privy:…`). Default empty. |
| `INFERENCE_MAX_STEP_USD` | The most one model step may cost. Default `0.25`, which is also the ceiling: a larger value is read as `0.25`. |
| `INFERENCE_OWNER_DAILY_USD` | The most one account's agents may spend on thinking in a UTC day. Default `25`. Counted in `inference_budget_days`, so it holds across instances. |
| `INFERENCE_PLATFORM_DAILY_USD` | The most all agents together may spend on thinking in a UTC day. Default `2`, small on purpose; `0` refuses every payment. This is not Tocker's money (each agent's own wallet pays), it is the ceiling on what a fault could cost every user together in a day. |
| `ADMIN_EMAILS` | Who may open **Settings → Admin**: a comma-separated list of email addresses, trimmed and matched case-insensitively against the address on the user's row. Unset or blank means **nobody** — there is no bootstrap admin and no "first user wins", so `/settings/admin` 404s for everyone including you until this is set. The address must be one Privy actually linked at signup (a wallet-only account has no email and can never match). Admins see every user's counts, balances, fills and audit events; they do **not** see any strategy, universe rule, data-source list or run transcript, and there is no admin view that reaches one. |

Every one of these is checked by `pnpm preflight` and reported (as booleans only) under
`live` in `/api/health` — to a request carrying `Authorization: Bearer $CRON_SECRET`. Anonymous
callers get only `ok`/`database`. `TOKENS_MOCK` must also be unset or `0`.

**Never set `DEV_IMPERSONATE_USER_ID` in production.** It is ignored whenever Privy is configured, but it must not be there at all.

`CRON_SECRET` must be **at least 32 characters** — the cron routes compare it in constant
time and return `503` outright for a missing or too-short secret, so a placeholder value
fails loudly instead of silently protecting nothing.

`ENCRYPTION_KEY` must decode to **exactly 32 bytes**. It is the only thing standing between
the `llm_keys` table and the operator's provider bill; if it is wrong, every agent fails at
the moment it tries to think, which is a long way from where you would look.

In Privy, add your production domain to the allowed origins, or logins will fail with a CORS error.

## 2a. Privy dashboard settings you must change by hand

Two of these are not optional for a deployment that holds money.

| Where | What | Why |
|---|---|---|
| Authentication → Advanced → **Multi-factor authentication** | Optional: enable **TOTP** or **Passkey** if you want operators to be able to enrol one | A second factor is **optional** in Tocker: `secondFactorBlock` refuses nothing, and neither go-live nor a withdrawal requires enrolment. Enabling a method here only makes enrolment possible from Settings → Security, where it is recorded and shown. It still protects the Privy account itself. |
| Wallet infrastructure → **Authorization keys** | Create one, paste it into `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Agent server wallets are created with this key as their owner so the server can sign trades and x402 payments with no user session. `pnpm preflight` proves the whole chain before you fund anything. |
| Settings → **Allowed origins** | Add the production domain | Logins fail with a CORS error otherwise. |

## 2a-2. Who gets in

Sign-in is also sign-up, and who may do it is one switch in the Privy dashboard
(Users → Access control → allowlist). Nothing in this codebase decides who may sign in.

- **Allowlist off:** anyone can make an account with an email address or a wallet. This
  is what the landing page's **Get started** button assumes.
- **Allowlist on:** only the email addresses, phone numbers and wallets on the list get
  in. Everyone else is refused by Privy (`allowlist_rejected`), and the sign-in card
  words that refusal and points them at the founder's X account
  (`FOUNDER_X` in `src/lib/contact.ts`).

The landing page has no waitlist form any more. People who signed up on the old one are
still listed under **Settings → Admin → Earlier waitlist signups**, with whether an
account for that address exists yet, so they can be told the doors are open.

The sign-in methods drawn on the card come from `NEXT_PUBLIC_LOGIN_METHODS` (default
`email,wallet`). Keep it equal to what is switched on in the Privy dashboard: a method
listed there but off in Privy fails when pressed. Before adding `twitter`, note that X
shares no email address, so with the allowlist on a new X account can never match an
entry.

Leave Privy's CAPTCHA and HttpOnly-cookie modes off: the sign-in card renders no captcha
widget, and the server reads the `privy-token` cookie the client writes and renews.

## 2b. Security posture, and its limits

What ships, and exactly how far each control goes. None of it is implied; a person moving
real money should be able to read this and know what they are relying on.

**API keys, and a public repository** — the code is public; no key is in it, and none can be
read through it.

- *A user's LLM key* is encrypted before it is stored (AES-256-GCM, `src/lib/crypto.ts`) with
  `ENCRYPTION_KEY`, which exists only in the hosting environment. No query returns the
  encrypted column to a page or an action result: the owner sees the provider, the label and
  the last four characters, and nobody else sees that a key exists. It is decrypted in two
  places on the server (the run loop, and the owner's model list) and is never logged.
  Losing `ENCRYPTION_KEY` makes every saved key unreadable; leaking it together with the
  database exposes them. Keep it in Production only.
- *Text that could carry a key* is scrubbed (`src/lib/security/redact.ts`): a provider's
  refusal echoes the key it refused, an RPC client prints the node URL with the operator's key
  in it. Run and trade errors, transcript steps, notifications, tool results on their way to
  the model, and everything a model publishes go through it before anyone reads them, so rows
  stored earlier are covered too. It removes this deployment's own secret values and anything
  shaped like a credential. It does not recognise a bare wallet private key, which looks the
  same as a transaction signature.
- *A key typed in the wrong place* is refused, not stored: the key's label and workspace id,
  agent names and taglines, profile names and bios, notes and comments.
- *The repository itself* is checked by `pnpm test` (`src/lib/security/repo-secrets.test.ts`):
  no tracked env file but `.env.example`, no filled-in secret there, nothing shaped like a live
  credential in any tracked file. That is a second net. **Turn on GitHub's own, once**, under
  Settings, Code security: *Secret scanning* and *Push protection*, both free for a public
  repository. Push protection is the only control that stops a key before it is public; a key
  that has been pushed is burned and must be revoked, not just deleted.

**Security headers and CSP** — `src/proxy.ts` (Next 16's renamed Middleware) sets a
nonce-based CSP, HSTS (production TLS only), `frame-ancestors 'none'` plus `X-Frame-Options`,
`nosniff`, a strict referrer policy, a deny-by-default `Permissions-Policy`, and
`Cross-Origin-Opener-Policy`. The policy is built in `src/lib/security/headers.ts` and unit
tested. It deliberately allows `auth.privy.io` and `*.privy.io` in `frame-src`/`connect-src`
(Privy renders login and wallet UIs in an iframe — remove these and login silently does
nothing), `wasm-unsafe-eval` + `worker-src blob:` for the WebGPU shader, `https:` in
`img-src` because token logos and social avatars are arbitrary third-party URLs, and
`'unsafe-inline'` in `style-src` because `motion` writes inline style attributes.

The policy was **verified in a browser, not reasoned about**: loading it on the landing page,
the feed, agent settings and the live wizard turned up fifteen real violations on the settings
page alone — Base UI's slider emits its own inline `<script>` during SSR. The fix is upstream
of the CSP: the layout shared by the app and sign-in (`src/app/(client)/layout.tsx`) reads the
proxy's `x-nonce` request header and `Providers` wraps both trees in Base UI's `CSPProvider`,
so those tags are nonced too. (The providers are deliberately not in the root layout: the
landing page uses none of them.) Re-checked afterwards: zero violations on any of
those routes. If a future component starts emitting un-nonced inline script, it will show up
the same way — open the page and read the console. A nonce only works on a page rendered per
request, so the root layout calls `connection()`: every route, the landing page included, is
dynamic, and none can be prerendered at build time with scripts the CSP would then refuse.

**Rate limits** — `/api/me/*`, `/api/cron/*` and run triggers pass through an in-memory
token bucket, in the Proxy and again inside the cron handlers. **The serverless caveat, in
full:** the counters live in one process's heap. On Vercel each instance and each Proxy
invocation has its own copy, so the real ceiling is `limit × instances`, and a cold start
resets it to zero. This is a speed bump, not a quota — it stops a runaway client and raises
the cost of guessing `CRON_SECRET`; it does not stop a distributed attacker. Move the
buckets to Redis/Upstash behind the same `consume()` signature in
`src/lib/security/rate-limit.ts` before this matters.

The limits that guard money do not live there. The daily data ceilings are counted from
`x402_payments`, and every pay-per-use limit (per step, per run, per agent, per account,
the whole platform, runs started by hand) is a row in `inference_budget_days` or the
ledger itself, updated inside one transaction before anything is signed. Those hold
across instances and survive a cold start.

**Audit log** — every sensitive action writes an append-only `audit_events` row with an IP
and user agent: withdrawals, spend-cap changes, live/paper switches, agent pauses, LLM key
add/rotate/revoke, kill-switch flips, MFA changes, the first-trade preset and manual runs.
Readable at Settings → Security. `recordAudit` never throws: losing the record of something
that happened is bad, but failing an operator's confirmed withdrawal because an audit insert
failed is worse.

**Second factor** — optional, and the code says so: `getMfaStatus` reads enrolment from
Privy's API (`users()._get(...).mfa_methods`) and Settings → Security shows it, but
`secondFactorBlock` always returns `null` — neither go-live nor a withdrawal is refused for a
missing second factor (product decision, 2026-09-16). Enrolling one still protects the Privy
account. If you ever want a real gate, the path is Privy's `mfa.enabled` / `mfa.disabled`
webhooks plus a per-action step-up; there is no user-side signing ceremony to attach one to
today, because agent wallets are signed server-side with the app's authorization key.

**Kill switch** — a per-user `user_security.trading_paused` flag. `findDueAgents` excludes
every agent whose owner has it on, so `/api/cron/tick` opens nothing new and reports how many
it skipped as `pausedSkipped`. **`/api/cron/marks` is deliberately not filtered**: stop
losses, take profits and trailing stops keep firing while trading is paused, because a kill
switch that froze exits would trap the operator in every open position at exactly the moment
they decided something was wrong.

**LLM keys at rest** — verified, not assumed: `addLlmKey` stores `encryptSecret(key)` from
`src/lib/crypto.ts` (AES-256-GCM, `base64(iv|tag|ciphertext)`, keyed by `ENCRYPTION_KEY`).
`decryptSecret` is called for two purposes: in `src/lib/agent/run.ts`, inside the run loop
(`resolveModel`, and the workspace lookup beside it), and in `listKeyModels`
(`src/server/actions/users.ts`), which asks Anthropic or OpenAI which models a key can use
when its owner opens the model picker. That action is owner-only, rate limited, and returns
model ids and names. The plaintext never reaches a server component, an action result, a run
transcript or the browser. Only the last four characters are ever
rendered. Rotation keeps the key's id so agents pointed at it never lose a tick, and
overwrites the old ciphertext in place.

**Spend caps, in two layers** — the app layer is `riskGuard()`, which enforces
`maxTradeUsd`, `maxDailyTrades`, `maxPositionPct` and `maxDataSpendUsdPerRun` before any
executor is reached, not by asking the model in a prompt. Underneath it, the *wallet* layer
is a Privy policy attached to the agent's server wallets (`agents.walletBudget`, applied from
the Wallet budget card in agent settings): the wallet refuses to sign an over-cap USDC
transfer whatever this app asks for, so a bug in the run loop or a compromised route here
still has a floor under it. The live wizard requires **both** to sit at or under the per-trade
cap the operator typed, and a missing wallet policy is a hard fail for a first live trade.

## 2b-2. Before the first live trade

Everything in this section has to be true before an agent signs anything. The live
wizard (`/agents/<slug>/live`) re-checks all of it per agent, server-side, every time it
is opened — but the wizard can only *report* these; you have to do them.

### Privy dashboard

1. **Fee sponsorship → Sponsor gas fees**, for **Base**. Confirm the app is on Privy's
   **TEE execution** stack: sponsorship throws `"Sponsoring transactions is only supported
   for wallets on the TEE stack"` otherwise, and a Base funding transfer is the first
   thing that fails. This covers the *user's* Base transfers, not the agent's swaps — see
   "Gas, in full" below.

   **Solana does not use this, and no longer depends on the dashboard at all.** Privy's
   Solana gas model is a fee-payer wallet, not a flag: Tocker builds the funding
   transaction with the **platform Solana wallet** as `payerKey`, the user signs it in the
   browser, and the server adds the platform's signature and broadcasts
   (`prepareSponsoredFunding` / `submitSponsoredFunding`). So the one thing that makes
   Solana funding work is SOL in the platform Solana wallet — see the table below.
2. **Funding (card / exchange) is off.** The app config for
   `cmtzr2ruh05ik0cl08kr4yo1c` has no `funding_config` and reports
   `fiat_on_ramp_enabled: false`, so the "Buy USDC" button fails instantly no matter what
   the UI offers. Enable it in the dashboard, or deposit by sending USDC to the Receive
   address instead.
3. **MFA**: optional. Enrol one in Settings → Security if you want it; nothing blocks on it.

### Money to have in place

| Wallet | Asset | Amount | Why |
|---|---|---|---|
| Your Privy embedded **Solana** wallet | USDC | 10 | the test deposit |
| " | SOL | **0** | the platform Solana wallet is the fee payer on your funding transfer and pays the ~0.00204 SOL token-account rent. Hold SOL only if you want the self-paid fallback to work when the platform wallet is dry |
| Agent **Solana** wallet | USDC | 10 (transferred) | trading |
| " | SOL | 0 | Ultra goes gasless for an empty taker, and the platform wallet drips `GAS_DRIP_SOL` when it does not — including before a withdrawal or a fee sweep, which the agent pays for itself |
| **Platform Base** wallet | USDC | ~$5 | pays every 402 priced on `eip155:8453` |
| **Platform Solana** wallet | USDC | ~$5 | pays every 402 priced on Solana — `deepnets-token-safety` is in the default source list, so this is **not** optional |
| " | SOL | ~0.05 | **load-bearing for funding.** It is the fee payer on every user→agent Solana transfer, it opens agents' USDC token accounts, and it drips gas to them for trades, withdrawals and fee sweeps. x402 itself needs none: every Solana 402 names an `extra.feePayer`, so the facilitator pays |

**Create both platform wallets from Settings → Admin → Platform wallets** on the deployed
site. The button is idempotent (a unique index on `chain` makes a second press a read) and
the card then shows both addresses with their USDC *and* native balances, which sources
each one pays for, and the month's spend.

**Do not use `pnpm preflight` or `pnpm platform:wallets` for this.** Both write to
whatever `DATABASE_URL` points at, which from a laptop is the local PGlite file — they
will create a wallet, print an address, and look exactly like they succeeded, and USDC
sent there is somewhere no deployed agent can spend from. Both scripts now say so at the
top of their output. What they *are* for is proving your credentials can create and read
a wallet at all.

Which wallet pays is decided by the **resource's** network, not the agent's chain:
`paidFetch` picks the platform wallet for the CAIP-2 in the 402. The registry is the
authority — `dataChainsFor(config.dataSources)` in `src/lib/data-sources/registry.ts` is
what the readiness checklist and the Platform card both read, so a source changing network
moves the requirement on its own.

How much USDC: a run costs whatever the agent's `maxDataSpendUsdPerRun` allows — cents.
$20 covers a long while for a handful of agents. Note that since W7 a *failed* paid call
is also charged to the run budget and written to `x402_payments` with `settled: false`:
a payment can fail after the money moved, and a retrying model must not be able to re-pay
past the cap.

### Env vars

- **Set `JUPITER_API_KEY`.** It is unset in production today. Un-keyed Ultra answers 200
  under light load but 429s under any, and `fetchOrder` currently surfaces that as "no
  order for X" rather than a rate limit.
- **Verify `ADMIN_EMAILS` matches `users.email` as recorded at your first login.**
  `src/lib/auth.ts` writes the email from Privy's linked accounts at signup and never
  refreshes it. A mismatch means no Admin tab, no platform-wallet button, and a 404 with
  no explanation — the page is deliberately an existence oracle for nobody.
- **Leave unset in production:** `X402_MOCK`, `LLM_MOCK`, `TOKENS_MOCK`, `MOCK_DATA`.
  Only the literal `"1"` enables mock mode, so `X402_MOCK=0` and `X402_MOCK=false` both
  mean *real payments*. `MOCK_DATA` is ignored by any production build (it would hand
  every visitor the mock session), and `/api/health` still reports it to the operator as
  `mocks.data` and the blocker `noMockData`, so unset it rather than rely on that.
- **Check Vercel → Settings → Functions: Fluid compute must be enabled** before
  `maxDuration` can go to 300. Without it the build rejects the value, and with a 60s cap
  an agent run that takes longer is killed mid-flight.
- Already required and present: Privy ×3, `ENCRYPTION_KEY`, `CRON_SECRET` (≥32 chars),
  `SOLANA_RPC_URL`, `DATABASE_URL`, `PLATFORM_FEE_USD`, `CRON_MAX_AGENTS`,
  `NEXT_PUBLIC_APP_URL`.

`SOLANA_RPC_URL` now does one more job than it used to: `paidFetch` re-registers the x402
Solana scheme with it, because `@x402/svm`'s own `registerExactSvmScheme` drops the RPC
config and falls back to the public `api.mainnet-beta.solana.com`, which rate-limits.

### What to expect during the run

- The default `execution.mode` is **`approve`**. A tick produces a *proposal* with a TTL,
  on the agent page, the bell and the run island — not a fill. You approve it there. The
  readiness checklist's risk step names the mode explicitly so this is not a surprise.
- Before the real $10 withdrawal, do a **$0.01 withdrawal first**. Privy's docs say a
  wallet calling the transfer endpoint needs an explicit `transfer` rule in its policy,
  and the policy Tocker attaches does not have one yet.
- The first paid call to **SentimentAlpha** is the one to watch. Its 402 advertises
  `extra.name: "USDC"` for Base USDC, whose on-chain `name()` is `"USD Coin"` — the
  EIP-3009 signature lands under the wrong EIP-712 domain and the facilitator refuses it
  with `ErrEip3009TokenNameMismatch`. `paidFetch` now rewrites the domain to the token's
  own before signing, but that has never been proven against the live facilitator, so the
  source ships `experimental: true` and out of the defaults. One successful $0.01 call is
  all it takes to promote it. `x-search` ($0.006, correct domain) is the default sentiment
  source until then.
- Equity and PnL on the agent card and the public leaderboard are rebased at the
  paper→live flip by the `mode` column on `equity_snapshots`; a snapshot is skipped rather
  than written as zero when a live balance read fails.

## 2c. The first live trade

`pnpm preflight` checks the deployment. `/agents/<slug>/live` checks the *agent*, on the
server, every time it is opened or re-checked:

- database reachable and not PGlite; Privy configured with an authorization key; a second
  factor enrolled; the kill switch off;
- real (not `paper_`) wallets on every chain it trades, holding USDC above the $5 minimum;
- **gas**: a Solana agent needs the platform Solana wallet to hold ≥ `MIN_PLATFORM_SOL`,
  and the step **fails** without it however much SOL the agent itself holds. That wallet
  is the fee payer on the operator's own funding transfer, so an empty one means no USDC
  can get in and none can be withdrawn or swept back out; the agent's own SOL only covers
  its trades, which Ultra usually makes gasless anyway. Base-only agents skip it;
- spend caps within the cap you typed, at **both** layers — `riskGuard()` here and the
  Privy policy on the agent's own wallets;
- a first-trade-shaped risk config (one chain, ≤ $2 a trade, one trade a day, at least one
  exit rule), **and a simulation**: the real `riskGuard` run against the real balance for a
  `maxTradeUsd` buy, failing with the guard's own sentence. This is what catches a
  `maxPositionPct` the funded amount cannot satisfy — a $2 ticket is 20% of a $10 wallet,
  and a 10% cap rejects every buy while the rest of the checklist stays green. The step
  also states the agent's **execution mode**, because "ready" means the first tick can
  fill in `auto` and can only propose in `approve`;
- real x402 payments (`X402_MOCK` not `1`), every configured source still in the registry,
  and a funded platform wallet on **every chain those sources price on** — derived from
  the registry, not a constant, so an agent scoring Solana tokens is told about the Solana
  wallet before its first run rather than by a 402 in the log.

A "first-trade preset" button clamps the agent into that shape in one click, and re-applies
the Privy wallet policy at the new cap so the budget step does not then fail on the old one.

A step is green only when it was checked and passed; "could not tell" is red, with one
deliberate exception — a platform *balance* Privy refused to answer for is amber, not red,
because blocking a funded operator's test over a balance-endpoint hiccup costs more than
letting a paid call fail with an error that names the wallet to top up. A wallet that was
read and found empty is still red. Going live is a
hold-to-confirm, and `goLiveAction` re-runs every check server-side before it agrees, so a
stale green checklist cannot be used to get past the gate. The last step runs one tick, streams
the run's steps, and ends in a receipt with the fill price, fees, an explorer link (Solscan /
Basescan) and a pause button.

## 3. Deploy

The Vercel project is connected to `ramioca/tocker` (Settings → Git): **every push to
`main` deploys to production**, and every other branch gets a preview deployment. There
is nothing to run. To ship without a code change, use **Create Deployment** on the
project's Deployments page and pick `main`.

The manual path still works from a linked checkout, for a deploy Git cannot make:

```bash
vercel login
vercel link
vercel --prod
```

Vercel auto-detects Next.js and pnpm. Nothing in `next.config.ts` needs changing.

## 4. Verify

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/health
```

Expect `{"ok":true,"database":"ok","embedded":false,...}`. If `embedded` is `true`, `DATABASE_URL` did not reach the function. Then check `privyConfigured: true` and `impersonation: false`. Without the bearer the route answers only `ok`/`database` — the config report (which secrets are set, which mocks are on) is operator-only.

Test a cron endpoint by hand before trusting the schedule:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/marks
```

## 5. Pay-per-use thinking (ships switched off)

Read this whole section before setting `INFERENCE_USDC`. The feature was built without
making a single real payment: everything up to the signature is proven by tests and by
real unpaid quotes, and nothing after it is. You make the first paid run, by hand, in the
stages below.

### What it is, and who pays whom

An agent normally thinks on its owner's own LLM key, and the provider bills the owner.
That is unchanged, it is the default, and it is what the builder recommends.

An agent whose owner picks **Pay per use in USDC** (`config.llm.source = "usdc"`) has no
key. Each model step is one request to BlockRun, an OpenAI-compatible gateway
(`https://sol.blockrun.ai/api/v1/chat/completions`). The gateway answers `402` with a
price; the **agent's own Solana wallet** signs one USDC transfer of exactly that price to
BlockRun's treasury; BlockRun's fee payer pays the network fee and puts it on chain; the
answer comes back.

- **The agent's wallet pays BlockRun, directly.** Tocker's platform wallets are not in
  this path. Tocker fronts nothing, holds nothing, forwards nothing and adds no margin,
  so nobody ever owes Tocker for thinking and there is no float to fund.
- **What it costs Tocker** is one Privy signature per step, plus the unpaid quote request
  each step sends. What Privy charges for a signature, and whether it limits them, is one
  of the things stage 2 is for.
- **Solana only.** An agent with no Solana wallet is told to add Solana or use a key.
- **Paper and live agents alike.** A paper agent trades a notional and still pays for
  thinking in real USDC from its real wallet.
- **Privacy.** In this mode the agent's strategy and transcript are sent to BlockRun and
  the model provider it uses, and the unpaid quote request carries them too. The builder
  says so where the mode is chosen.
- **No refunds.** BlockRun's Solana gateway says of itself that non-streaming chat
  settles optimistically: the payment fires in parallel with the model call, so a `5xx`
  or an upstream parameter rejection after that point **is charged**. Tocker's runs are
  non-streaming. When that happens the run stops rather than pay again, and the step is
  listed for the owner under **Money → Costs → Thinking (pay per use)**, with its
  transaction when there is one. BlockRun's terms: "Payments are non-refundable once
  settled on-chain".

Where it shows:

- **Money.** A "Thinking (pay per use)" line and a per-agent column, read from the
  ledger; the steps that were signed for and got no answer; and, for comparison, what
  the same tokens would have cost at list price on the owner's own key. None of it
  appears for an owner who has never paid for a step. The figure counts only payments
  **proven** to have left the wallet (next point). What is counted as charged and not
  yet proven is said beside the figure, never inside it: "being checked against the
  chain" for the first six hours, "could not be checked in time" after that. An owner
  who has deleted every agent still sees what those agents paid.
- **P&L.** What a live agent paid for thinking is a money flow out of its book, like a
  withdrawal, so its P&L, its max drawdown and its place on the leaderboard do not read
  it as a trading loss. **A payment is netted only once it is proven**: a
  `paid_no_answer` row, or a `settled` row that carries its transaction id. A `settled`
  row with **no** transaction id is an answered step the gateway gave no proof of
  payment for. The ledger counts it as charged against every limit, which is the safe
  side for a cap; it is **not** taken out of P&L and not in the Money total until the
  reconciler has found the payment on chain and written its transaction id, because a
  public P&L adjusted on an assumption would read as a gain nobody made if the
  assumption were wrong. The same goes for `signed` and `unconfirmed` rows. Until then
  the amount reads as a few cents of loss, never as a gain; the Money page's Net is right
  throughout, since the amount is in the P&L or in the costs and never in both. A
  `not_charged` row (the reconciler proved the payment never landed) is never netted and
  never shown as paid.
- **Runs.** The owner's run list shows what each pay-per-use run was *counted at* when
  it ended. That figure is written once and is not rewritten if the chain later shows a
  payment never landed, so the row does not call it paid, and after a step that got no
  answer it reads "up to". Money is where the confirmed amount is.
- **Admin.** Settings → Admin → Pay-per-use thinking: today's counters against each cap,
  the rows still open (answered steps whose payment is unproven among them), what the
  breakers see, the halt, and the signature test. The signature test offers, and the
  server signs with, **only the wallets of the admin's own agents**: it has a wallet sign
  a real payment before throwing it away, and being an admin is no reason to make another
  account's wallet sign one.

### What stands between a fault and a wallet

In the order one step runs (`src/lib/x402/inference-fetch.ts`, reached only through
`paidFetch.ts`):

1. The request is checked: the one pinned URL, `POST`, the agent's own model, no
   streaming, `max_tokens` forced to 2048.
2. One unpaid request fetches the price. Nothing has been signed, so a failure here
   costs nothing.
3. The price is checked against **pins that are in code, never taken from the 402**:
   scheme `exact`, Solana mainnet, real USDC, BlockRun's published treasury
   (`AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA`), a fee payer that is not the agent.
   `upto` and `batch-settlement`, which the live 402s also offer, are never selected.
4. The amount is reserved in the ledger against every cap, in one transaction. A refusal
   means nothing is signed.
5. Privy signs. The signed bytes are decoded and checked **before sending**: one USDC
   transfer of the quoted amount to the pinned account, one memo, nothing else. The run's
   clock is read once more; if the paid request no longer fits before the deadline,
   nothing is sent.
6. The paid request is sent **once**. Whatever happens after that, no second payment is
   made for the step. From here the step counts as charged until the chain says
   otherwise. The gateway's word decides one thing only: an answered step's row gets a
   transaction id when a receipt names one that is this payment's own and says it
   settled, and gets none in every other case.
7. Every five minutes `/api/cron/inference` looks on chain, by memo, through
   `SOLANA_RPC_URL`, for every payment that is not proven: rows left `signed` or
   `unconfirmed`, and answered (`settled`) rows with no transaction id. Found: an open
   row becomes `paid_no_answer`, an answered row keeps `settled` and gets its
   transaction id. Proven unable to land: `not_charged`, and the amount goes back to its
   day's limits. Neither within six hours: the row stays counted as charged and is
   looked at again only now and then, until it is seven days old. After that nothing
   looks; `scripts/inference-audit.ts` (read-only) is how a person then finds out what
   the chain says about it.

### Every switch and cap

| What | Where it is set | Default | Notes |
|---|---|---|---|
| `INFERENCE_USDC` | environment | unset = **off** | `off`, `owner` (admins and invited ids), `on` (everyone). A deploy. |
| `INFERENCE_USDC_USER_IDS` | environment | empty | Read at `owner` only. |
| `INFERENCE_MAX_STEP_USD` | environment | `0.25` | Also the hard ceiling; a larger value is read as `0.25`. |
| `INFERENCE_OWNER_DAILY_USD` | environment | `25` | One account, one UTC day. |
| `INFERENCE_PLATFORM_DAILY_USD` | environment | `2` | Every agent together, one UTC day. `0` refuses everything. |
| **Admin halt** | database, from Settings → Admin | off | Read before every signature. No deploy. |
| Breaker pause | database, automatic | none | 3 steps paid (or maybe paid) with no answer, from 2 or more agents, in 15 minutes: 30 minutes. 5 gateway failures or 5 signature failures in 10 minutes: 15 minutes. Any pin mismatch: 30 minutes. Clears itself; an admin can end it early. |
| Per-step ceiling | code | the lower of the step cap and 2 × Tocker's own estimate + $0.002 | The estimate is made from the model's list price, not from the quote. |
| Per-run limit | the owner, per agent | what the builder suggests: about twice a typical run on the chosen model (`$0.15` on the default model, `$0.45` on Claude Haiku 4.5) | Range $0.05 to $2. |
| Per-day limit | the owner, per agent | what the builder suggests: every scheduled run with a quarter to spare, and at least `$3` | Range $0.50 to $50. The builder refuses a schedule whose estimate exceeds it. |
| Requests per agent per day | code | 600 | |
| Runs started by hand, per account per day | code | 20 | Counted in the database. |
| Steps per run | code | the agent's own step limit, at most 20, plus one to wrap up | |
| Wallet floor | code | `$0.25` | A run does not start unless the wallet's Solana USDC, read from the chain, covers the run limit plus this plus the Tocker fees it owes. On a live agent the run limit plus this floor is also held back from buys, so a trade cannot spend the next run's thinking. It still counts in the agent's cash and equity. |
| Time | code | no new step after 150 s; no signature with under 75 s left; 15 s for a quote (two free retries), 10 s for the signature, 60 s for the paid request | The paid request has its own clock and is never cut off by the run's. |
| Schedule a new pay-per-use agent starts on | code | 60 minutes | Every step costs money. |

It also depends on things section 2 already asks for: `SOLANA_RPC_URL` set to a real
provider (without it nothing is signed, because nothing could be checked), `X402_MOCK`
unset, the Privy authorization key, and an agent whose **wallet policy has been applied**
(Wallet budget card in the agent's settings): an agent with no policy is not allowed to
pay.

The schema is one additive migration, `drizzle/0010_tearful_monster_badoon.sql`: three
new tables (`inference_payments`, `inference_budget_days`, `inference_control`) and new
nullable columns on `agents` and `agent_runs`. It runs on deploy like the others. Ledger
rows have no foreign keys and are never deleted: the record of what a wallet paid
outlives the agent, the run and the account.

`vercel.json` adds a third cron, `/api/cron/inference` at `1-59/5 * * * *`, protected by
`CRON_SECRET` like the other two. **The fallback scheduler (`.github/workflows/cron.yml`)
and `pnpm tick` do not call it.** If either is what actually drives your deployment, add
the call before stage 2, or unresolved payments are never reconciled.

### Switching it on, in stages

Do not skip a stage, and do not move to the next one with an open question from the last.

**Stage 0. Merged, off.** `INFERENCE_USDC` is unset. Check that Settings → Admin →
Pay-per-use thinking reads "Switched off", that the builder offers no pay-per-use card,
and that `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/inference`
answers `"ok": true` with nothing to do. Nothing else about the app has changed.

**Stage 1. No money.** Still off.

1. `pnpm tsx scripts/inference-quote.ts <your agent's Solana wallet address>`. One unpaid
   request per model, each quote checked against the pins and against its cap. It cannot
   pay: it imports no wallet and no signer. Exit code 1 if any model fails.
2. Settings → Admin → Pay-per-use thinking → **Test a signature (nothing is sent)**, on
   the Solana wallet of one of **your own** agents. Use an unfunded one: what Privy signs
   is a real payment until its blockhash expires about a minute later, and an empty
   wallet cannot pay it whatever happens. Apply its wallet policy first (Wallet budget
   card), so the signature is made under the policy a paid run will meet. The test
   fetches a real quote, has Privy sign the payment, checks the signed bytes, and throws
   the result away. Expect six lines ending in "nothing was sent". This is the first
   time Privy is asked to sign an x402 payment for an agent wallet: if the policy
   refuses, stop here.
3. Do both again some hours later. Two things will differ and both are expected: the fee
   payer alternates between two gateway addresses, and the same request is quoted a few
   micro-dollars apart.

Go on only when every model passes and the signature test passes.

**Stage 2. Owner only, a few dollars.**

1. Set `INFERENCE_USDC=owner`. Leave `INFERENCE_PLATFORM_DAILY_USD` at its default of
   `$2` (or set it to `2` so it is written down) and `INFERENCE_USDC_USER_IDS` empty.
   Optionally `INFERENCE_MAX_STEP_USD=0.05` for this stage. Redeploy.
2. On **one** agent of your own: choose Pay per use, keep the default model (Gemini 2.5
   Flash: about $0.07 a typical run by Tocker's estimate) and the two limits the builder
   suggests, and set execution mode to `approve`. Send its Solana wallet a few dollars of
   USDC ($3 is plenty).
3. Start **one run by hand**. Then wait ten minutes, so the reconciler has passed twice.
4. Check the ledger against the chain, to the micro-dollar:

   ```bash
   tsx --env-file-if-exists=.env scripts/inference-audit.ts <agent slug> --hours 24
   ```

   with `DATABASE_URL` pointing at production and `SOLANA_RPC_URL` set. It is read-only.
   Exit code 0 means the ledger equals the chain; 1 means it printed a difference; 2
   means it could not tell. Also compare, by eye, the wallet's USDC on Solscan with the
   Thinking figure on the Money page. A `settled` row with no transaction hash is one the
   gateway answered without a receipt: the audit finds it by memo, and it is not proven
   until it does.
5. **Write down**, because no code can know these until a payment has been made:
   - the **receipt header**: which of `PAYMENT-RESPONSE`, `X-Payment-Response` and
     `X-Payment-Receipt` arrive on a paid answer, and what is in them;
   - the **settle order**: whether the USDC moves before the answer, alongside it or
     after (compare the transaction's time with the step's);
   - the **reroute headers** on an ordinary answer: `X-Fallback-Used`,
     `X-Fallback-Model`, `x-health-reroute`, `x-served-model`, `x-original-model`,
     `X-Settlement-Skipped`, and how the body's `model` is spelled. The rule that discards
     a rerouted answer reads these headers and has never seen a paid one;
   - **latencies**: quote, signature and paid request per step, and how many steps fit
     before the 150-second mark;
   - **Privy**: whether signatures are rate-limited, and what one costs on the invoice;
   - any `429` on the unpaid quote requests.
6. Two drills, while only your money is at stake. Throw the admin halt during a run: the
   next step must stop with nothing signed, and the agent must show "Pay-per-use is
   paused". Then empty the wallet: the agent must be held with "Add USDC to keep
   thinking" and you must be told once, not on every tick.
7. Put the agent on an hourly schedule for 24 hours and run the audit again.

Go on only with zero differences between ledger and chain, nothing stuck open on the
admin card, and every item in step 5 written down.

**Stage 3. A few invited owners.** Add their ids to `INFERENCE_USDC_USER_IDS` and raise
`INFERENCE_PLATFORM_DAILY_USD` to `25`. One week. Audit a few wallets every day. Before
this stage: correct the reroute rule if stage 2 showed the headers arrive differently
from BlockRun's documentation, pin exact versions of `@x402/core`, `@x402/svm`,
`@solana/kit`, `@solana/web3.js` and `@privy-io/node` (the pay path depends on their
transaction layout, and its tests refuse every payment if that changes), and run the
ledger's concurrency test against a real Postgres
(`src/lib/x402/inference-ledger.concurrency.test.ts`, with
`INFERENCE_CONCURRENCY_DATABASE_URL` set; it builds its own schema and drops it). Go on
only with zero ledger-and-chain differences across the week and unconfirmed payments
under 1%.

**Stage 4. Everyone.** `INFERENCE_USDC=on`, and raise `INFERENCE_PLATFORM_DAILY_USD` by
hand (`250` to begin with). At `on` the landing page's FAQ changes two answers ("Which AI
model runs it?" and "What do I need to start?") to say an agent can pay per use: read
them in `src/components/liquid/defaults.ts` first. The Money page's Costs heading still
says "Three different bills"; with pay-per-use there are four.

### How to stop it

1. **The admin halt, first.** Settings → Admin → Pay-per-use thinking: type why, press
   **Halt pay-per-use**. It is one database row read before every signature, so it stops
   the next step on every server at once, with no deploy. A payment already signed
   finishes and is recorded. Agents show "Pay-per-use is paused" and look again by
   themselves every 15 minutes; agents on a key are not touched.
2. **Then the environment switch.** Unset `INFERENCE_USDC` (or set it to `off`) and
   redeploy. This is second because a running function keeps the environment it was
   built with: until the new deployment is live, only the halt stops anything.
   `INFERENCE_PLATFORM_DAILY_USD=0` also refuses every payment, and is also a deploy.
3. **Leave the cron running.** `/api/cron/inference` pays for nothing; it is what
   settles the payments that were in flight when you stopped.
4. If the admin page itself is down, the halt is one statement:

   ```sql
   insert into inference_control (id, halted, halt_reason, updated_by)
   values ('global', true, 'halted by hand', 'sql')
   on conflict (id) do update
     set halted = true, halt_reason = excluded.halt_reason,
         updated_by = excluded.updated_by, updated_at = now();
   ```

Stopping refunds nothing, and nothing should be deleted: the ledger is the only record
of what each wallet paid. Clearing the halt is what lets payments move again, so clear it
only after the audit script agrees with the chain for the wallet you were worried about.

### What is NOT proven until real funds move

- **The paid round trip.** No payment has ever been made. Everything after the signature
  (the receipt headers, when settlement happens, what a paid answer looks like) comes
  from BlockRun's documentation and SDK source. Its documented test host did not answer
  on the day this was built, so there was no way to prove it without real funds.
- **What the gateway does with a payment when the model fails.** By its own
  documentation the Solana gateway can charge for a step that then fails (a `5xx`, or an
  upstream parameter rejection on non-streaming chat). Tocker treats every failure after
  the paid request left as "paid, or in doubt", never pays twice for it, and lets the
  chain decide. None of that has been seen happen.
- **Tool calling on the paid models.** A run is many tool-calling steps. Not one of the
  five offered models has been run with tools through this gateway, because that needs a
  payment; two of the five had no measured traffic on the gateway the day they were
  chosen.
- **Privy accepting the payment under the live wallet policy.** The policy denies a USDC
  transfer above the agent's cap and allows the rest, so a payment of a cent should
  pass. The stage 1 signature test is the first evidence; whether Privy rate-limits or
  bills per signature is unknown.
- **The reroute rule.** It discards an answer when the gateway's fallback headers say
  another model served it. Those headers are documented; none has been seen on a paid
  answer.
- **The reconciler against a real chain**, in particular its "not charged" verdict,
  which gives a cap back and is deliberately strict.
- **The reserve under real concurrency.** The test that runs twenty reservations at once
  against a real Postgres is written and has never been executed.
- **How many steps fit.** Each step adds a quote, a signature and a settlement to the
  model's own time. A run that reaches its time limit ends cleanly, but it may end
  before the model is done.
- **BlockRun's limit on unpaid quotes** from one address, with every agent's steps
  leaving from Tocker's servers.
- **BlockRun itself.** Its terms promise no uptime, allow prices to change and wallets to
  be blocked, and cap its liability at 30 days of what was paid. The company was
  incorporated in January 2026. If it goes away, every pay-per-use agent is held and its
  owner is told to switch to a key; nothing is lost but the service.

## Notes

- Agent runs happen inside the request that triggers them. This is fine at demo scale. Past a few dozen active agents, move the run loop to a queue or a worker rather than a serverless function.
- The exit engine is the part that must never miss a beat. If you run crons on GitHub Actions, note that its scheduler can delay jobs under load; for real money, use Pro crons or a dedicated scheduler.

## Gas, in full

Gas is paid by three different things depending on which transaction it is, and the app
used to say "gas is sponsored" for all of them. It is not one answer.

| Transaction | Who pays the network fee |
|---|---|
| Your funding transfer into an agent, **on Solana** | The **platform Solana wallet**, as the transaction's `payerKey`. The server builds it (`prepareSponsoredFunding`), you sign it in the browser with `signTransaction`, the server adds the platform's signature and broadcasts it (`submitSponsoredFunding`). No dashboard setting is involved. When the platform wallet cannot pay you are told so by name and address, and the transfer falls back to your own wallet — which then needs ~0.01 SOL |
| Your funding transfer into an agent, **on Base** | Privy's sponsor, via `sponsor: true` — **requires Fee sponsorship enabled for Base, funded, on the TEE stack** (2b-2). Unsponsored, it comes out of your own wallet |
| Withdrawal to an external address, from **your own** wallet | You. It is not Tocker's fee to pay, and a wallet with USDC and no SOL cannot make one — deposit ~0.01 SOL first |
| Withdrawal **from an agent wallet**, and the platform's fee sweep | The agent's own wallet, which is the fee payer on its outgoing transfer. A USDC-only agent holds no SOL, so `withdrawFromAgent` drips from the platform Solana wallet first and waits for it to confirm (`ensureAgentGas`). A platform wallet that cannot drip fails the withdrawal with its own sentence, and leaves fees accrued for the next sweep |
| The agent's **Solana swap** | Jupiter Ultra goes gasless when the taker holds under ~0.01 SOL and the order is not in manual-slippage mode. When it does not, the **platform Solana wallet** drips `GAS_DRIP_SOL` to the agent and the order is re-fetched (`ensureAgentGas`, `src/lib/wallets/gas.ts`). Privy's `sponsor: true` is not an option here: it only exists on `signAndSendTransaction`, which bypasses Jupiter's `/execute` |
| The agent's **Base swap** | Privy's swap API |
| A **pay-per-use thinking payment** (section 5) | The gateway's fee payer, named in its 402. The agent's Solana wallet signs a USDC transfer and needs USDC only, no SOL. A payment whose fee payer is the agent itself is refused before it is signed |
| An **x402 data payment** | Nobody on our side. Every Solana 402 probed for W7 carries `extra.feePayer` — the facilitator pays — and Base EIP-3009 authorizations are settled by the facilitator too. The platform wallets need USDC, not gas |
| Opening the agent's USDC **token account** on Solana | The platform Solana wallet, pre-created at `createAgentWallets` so your funding transfer never pays the ~0.00204 SOL rent |

The practical consequence: the **platform Solana wallet needs ~0.05 SOL** even though
nothing about x402 does — and it is the single point of failure for Solana money movement
in both directions, which is why the live checklist's gas step **fails** rather than warns
when it is under `MIN_PLATFORM_SOL`. That step reports exactly which of these the agent is
currently standing on, and the Platform card shows the native balance next to the USDC one
so it is visible before it runs out rather than after.
