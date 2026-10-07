# Deploying Tocker to Vercel

## What you must decide first

| Decision | Why it matters |
|---|---|
| **Hobby or Pro** | Hobby works for a private test deploy, with three hard limits: cron jobs run **once per day maximum** (a 5-minute schedule *fails the deployment*), functions are capped at **60 seconds**, and Hobby teams **cannot connect to Git organization repositories** — the repo must be personal. `vercel.json` ships for **Pro**: a `crons` block and 300s functions. For Hobby, remove the `crons` block and lower every `maxDuration` to 60 (in `vercel.json` and the route files), and take scheduling from `.github/workflows/cron.yml`, which runs every 5 minutes on either plan. |
| **Postgres provider** | PGlite is a local file and cannot run on serverless — every write is lost when the instance recycles. `/api/health` returns 503 if production is still on PGlite. Use Neon (free tier is enough to start), Supabase, or Vercel Postgres. |
| **Shaders licence** | The `shaders` package is proprietary: free for personal and evaluation use, but **any public-facing deployment requires a Pro or Team licence** from shaders.com. The landing hero falls back to a static gradient when the shader is absent, so the site works either way. |

### One more thing about Hobby

Vercel's fair use guidelines restrict Hobby to **non-commercial personal use**. Commercial use is defined as any deployment used for the financial gain of anyone involved, including requesting payment from visitors or advertising a product for sale. A private pre-revenue test deploy of Tocker is fine; the moment it takes money or markets a paid product, it needs Pro.

### Agent runs and the 60-second cap

Every due agent runs inside the cron invocation that picked it up. With a real model and several tool calls a single run can take tens of seconds, so on a 60s function the batch has to stay small. `CRON_MAX_AGENTS` controls it and defaults to **5**; set it to `2` on Hobby if runs are timing out, and keep `maxDuration` at 300 in `vercel.json` and the route files on Pro. Past a few dozen active agents this belongs in a queue rather than a serverless function either way.

A **pay-per-use** run (section 5) is a different size: every model step is a quote, a signature and a paid request. **Do not set `INFERENCE_USDC` on a deployment where any function that runs an agent has less than 300 seconds.** The code cannot see the limit a function really has. It counts every clock of a paid run from one constant, 300 seconds (`RUN_ROUTE_MAX_DURATION_S` in `src/lib/agent/inference.ts`): a run is started only while 250 of those seconds remain, and it stops paying at 285. On a function the platform ends at 60 seconds the run would therefore still **start**, in the first 50 seconds like anywhere else, pay for steps, and be frozen by the platform mid-step, possibly with a payment signed; its run row stays `running` until the reaper fails it ten minutes later, nothing holds the agent or moves its next run, and once that row is reaped it starts and pays again, up to its daily limit. Three files run an agent and each says `export const maxDuration = 300` as a number, because Next reads that value from the source text and takes nothing else: `src/app/api/cron/tick/route.ts`, `src/app/api/agents/[id]/run/route.ts` and the agent page, `src/app/(client)/(app)/agents/[slug]/page.tsx` (its **Run now** is a server action, which takes the page's limit). `vercel.json` names 300 for the two route handlers as well. `src/lib/agent/invocation-limit.test.ts` reads all of them and fails when one says anything but 300, so lowering one for Hobby, as the paragraph above describes, fails `pnpm test`: that failure is the reminder that pay-per-use must stay off there. Pay-per-use needs Pro, Fluid compute and those 300 seconds.

## 1. Database

Create a Postgres database and copy its pooled connection string. On Neon: New Project → Connection string → **Pooled connection** (the `-pooler` host), and append `?sslmode=require`.

Migrations are in `drizzle/` and run automatically on deploy via the `vercel-build` script (`drizzle-kit migrate && next build`). To run them by hand:

```bash
DATABASE_URL="postgres://..." pnpm db:migrate
```

Migration `0011` changes a column's type rather than adding one: `llm_keys.provider` goes
from a Postgres enum to text. What that locks, and how to go back, is under "The
database" in "Model providers, in full".

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
| `SOLANA_RPC_URL` | Solana RPC, server-only. Use Helius or another provider — the public RPC is rate-limited. The browser never sees it; `/api/solana/blockhash` proxies the one call it needs. Pay-per-use thinking (section 5) reads wallets and reconciles payments through it, and refuses only an empty value: with the public endpoint set, payments are still signed. |
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
  From there it is sent to one place only: the host of the provider it was added under.
  That host is a constant in the code, and no setting, form or stored value can supply
  an address. Which hosts those are, and the one check that goes to a second host, are
  in "Model providers, in full" at the end of this document.
  Losing `ENCRYPTION_KEY` makes every saved key unreadable; leaking it together with the
  database exposes them. Keep it in Production only.
- *Text that could carry a key* is scrubbed (`src/lib/security/redact.ts`): a provider's
  refusal echoes the key it refused, an RPC client prints the node URL with the operator's key
  in it. Run and trade errors, transcript steps, notifications, tool results on their way to
  the model, and everything a model publishes go through it before anyone reads them, so rows
  stored earlier are covered too. It removes this deployment's own secret values and anything
  shaped like a credential. It does not recognise a bare wallet private key, which looks the
  same as a transaction signature. Some providers' keys have no shape to recognise either, so
  a run that fails also takes its own key out of the error by value before it is stored or
  sent, and so do the key check and the model list.
- *A key typed in the wrong place* is refused, not stored: the key's label and workspace id,
  agent names and taglines, profile names and bios, notes and comments.
- *A key pasted under the wrong provider* is refused before it is sent anywhere, wherever
  its first characters say whose it is. Where they do not, it is sent once to the provider
  that was chosen and is not saved when that provider turns it down. The exact rule and
  its limit are in "Model providers, in full".
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
across instances and survive a cold start. For the pay-per-use limits that is so far
proven on the single-connection test database only: the test that makes them race over
real connections is step 5 of stage 1 in section 5, to be run once before the first
paid run.

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
(`src/server/actions/users.ts`), which asks the key's own provider which models the key can
use when its owner opens the model picker. That action is owner-only, rate limited, and returns
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
  `paid_no_answer` row, or a `settled` row that carries its transaction id. The id gets
  onto a row in two ways and no other: the gateway's receipt names it (the id is checked
  to be this payment's own transaction, against the bytes the wallet signed, and the
  receipt has to say it settled), or the reconciler finds the payment on chain. A
  `settled` row with **no** transaction id is an answered step the gateway gave no such
  proof for. The ledger counts it as charged against every limit, which is the safe side
  for a cap; it is **not** taken out of P&L and not in the Money total until the
  reconciler has found the payment on chain and written its transaction id, because a
  public P&L adjusted on an assumption would read as a gain nobody made if the
  assumption were wrong. The same goes for `signed` and `unconfirmed` rows. Until then
  the amount reads as a few cents of loss, never as a gain; the Money page's Net is right
  throughout, since the amount is in the P&L or in the costs and never in both. A
  `not_charged` row (the reconciler proved the payment never landed; an answered step
  can end this way too, and its answer was then free) is never netted and never shown as
  paid. Max drawdown adds back the same proven payments and nothing else: a withdrawal
  still reads as a fall on that one figure, as it always has, and the equity line itself
  is the wallet's real balance, thinking included.

  **When** a proven payment is netted matters as much as whether. A P&L is measured
  between two marks of the book, and a mark is the wallet as it was read. The money
  leaves some seconds after the payment is signed, so a flow dated at the signature ran
  ahead of it: a mark read in between did not hold the fall yet, and the step's price
  read as a gain until the next mark. Two rules close that. A payment's flow is dated
  when its step was **resolved** (its answer and receipt arrived, or the reconciler
  reached its verdict), and never later than two minutes after the signature: a signed
  transfer has about a minute to land before its blockhash lapses, so by then it has
  landed or never will. And **no mark is written for a live
  pay-per-use agent while one of its paid steps is in flight**: signed in the last two
  minutes, and not resolved before the wallet was read. The equity line has no point
  there; a run's own last mark is taken after its last step has resolved (and is left
  out as well when that step was left without an outcome), and the marks pass comes
  round again in five minutes. So no mark stands between a payment leaving
  the wallet and its flow, and a step's price is not read as a gain, either at once or
  later, when that mark is where a 7-day or 30-day figure starts. A payment signed at or
  before the book's first live mark is never a flow at all. What this still takes on
  trust is under "Known limits" below.
- **Runs.** The owner's run list shows what the ledger *counted as charged* for each
  pay-per-use run, written when the run ends. Counted is not confirmed: the figure
  includes steps whose payment is still being checked. When the reconciler proves a step
  was never charged it writes that run's figure again from the ledger (that one column,
  best effort); the sentence a run stored when it stopped is never rewritten. So the row
  never calls the amount paid, its note says counted is not confirmed, and after a step
  that got no answer it reads "up to" and does not say the step was paid for. Money is
  where the confirmed amount is.
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
   transfer of the quoted amount to the pinned account, one memo, nothing else. The
   signature is then recorded in the ledger, which is given 3 seconds to do it: if the
   ledger does not answer in that time nothing is sent, and the step stops as "The wallet
   did not sign" (`signature_failed`), so a database that is stalling shows up as that
   stop and counts toward the signature breaker (five such stops, from at least two
   accounts). The run's clock is read once more after that; if the paid request no
   longer fits before the deadline, nothing is sent. Either way a row can be left
   `signed` with no payment behind it; the reconciler gives it back.
6. The paid request is sent **once**. Whatever happens after that, no second payment is
   made for the step. From here the step counts as charged until the chain says
   otherwise. The gateway's word decides one thing only: an answered step's row gets a
   transaction id when a receipt names one that is this payment's own and says it
   settled, and gets none in every other case. An answered step is recorded `settled`
   and its answer is used. The one exception is an answer another model gave: it is
   never used and the run stops, and if the gateway also says it took no payment for it
   the row is left `unconfirmed` for the chain to decide. A step with no usable answer is
   recorded `paid_no_answer` on that same proof, and `unconfirmed` without it.
7. Every five minutes `/api/cron/inference` looks on chain, by memo, through
   `SOLANA_RPC_URL`, for every payment that is not proven: rows left `signed` or
   `unconfirmed`, and answered (`settled`) rows with no transaction id. Found: an open
   row becomes `paid_no_answer`, an answered row keeps `settled` and gets its
   transaction id. Proven unable to land: `not_charged`, and the amount goes back to its
   day's limits. Neither within six hours: the row stays counted as charged and is
   looked at again only now and then, until it is seven days old. After that nothing
   looks; `scripts/inference-audit.ts` (read-only) is how a person then finds out what
   the chain says about it. A pass is bounded: at most 25 rows, 150 RPC calls and one
   minute, open rows before answered ones. With `X402_MOCK=1` or an empty
   `SOLANA_RPC_URL` it reads no chain at all: it still gives back rows that were reserved
   and never signed, and still closes rows past six hours, but it proves nothing either
   way. The same pass watches
   for the one thing that must not exist, USDC that went from an agent to the gateway in
   the shape of a payment with no ledger row behind it, and throws the admin halt itself
   if it sees one.

### Every switch and cap

| What | Where it is set | Default | Notes |
|---|---|---|---|
| `INFERENCE_USDC` | environment | unset = **off** | `off`, `owner` (admins and invited ids), `on` (everyone). A deploy. |
| `INFERENCE_USDC_USER_IDS` | environment | empty | Read at `owner` only. |
| `INFERENCE_MAX_STEP_USD` | environment | `0.25` | Also the hard ceiling; a larger value is read as `0.25`. |
| `INFERENCE_OWNER_DAILY_USD` | environment | `25` | One account, one UTC day. |
| `INFERENCE_PLATFORM_DAILY_USD` | environment | `2` | Every agent together, one UTC day. `0` refuses everything. |
| **Admin halt** | database, from Settings → Admin | off | Read before every signature. No deploy. |
| Breaker pause | database, automatic | none | 3 steps paid (or maybe paid) with no answer, from 2 or more accounts, in 15 minutes: 30 minutes. 5 gateway failures or 5 signature failures, from 2 or more accounts, in 10 minutes: 15 minutes. Accounts, not agents, in all three: one owner's agents count as one account however many they are, so one account cannot pause everyone, and while only one account is switched on (stage 2) none of the three can trip. Any pin mismatch, from anyone: 30 minutes. Clears itself; an admin can end it early. |
| Per-step ceiling | code | the lower of the step cap and 2 × Tocker's own estimate + $0.002 | The estimate is made from the model's list price, not from the quote. |
| Per-run limit | the owner, per agent | what the builder suggests: about twice a typical run on the chosen model (`$0.15` on the default model, `$0.45` on Claude Haiku 4.5) | Range $0.05 to $2. |
| Per-day limit | the owner, per agent | what the builder suggests: every scheduled run with a quarter to spare, and at least `$3` | Range $0.50 to $50. The builder's form refuses a schedule whose estimate exceeds it. Whatever was saved, the limit itself is what is enforced, when each payment is reserved. |
| Requests per agent per day | code | 600 | |
| Runs started by hand, per account per day | code | 20 | Counted in the database. |
| Steps per run | code | the agent's own step limit, at most 20, plus one to wrap up | |
| Wallet floor | code | `$0.25` | A run does not start unless the wallet's Solana USDC, read from the chain, covers the run limit plus this plus the Tocker fees it owes. On a live agent **two** run limits plus this floor are also held back from buys: one for what the run in hand may still spend after the buy, one (with the floor) for what the check before the next run asks for. It still counts in the agent's cash and equity. Known gap: an agent that trades Solana **and** Base has one cash figure for both, so the hold-back comes off the total and a Solana buy can still spend the Solana USDC it was meant to protect; the agent is then held with "Add USDC to keep thinking" until USDC is added on Solana. |
| Time | code | no new step after 150 s; no signature with under 75 s left; 15 s for a quote (two free retries), 10 s for the signature, 3 s for the ledger to record it, 60 s for the paid request | The paid request has its own clock and is never cut off by the run's. |
| Schedule a new pay-per-use agent starts on | code | 60 minutes | Every step costs money. |

It also depends on things section 2 already asks for: `SOLANA_RPC_URL`, `X402_MOCK`
unset, the Privy authorization key, and an agent whose **wallet policy has been applied**
(Wallet budget card in the agent's settings): an agent with no policy is not allowed to
pay.

**The wallet's own limit must be at least the price of a step.** The policy refuses to
sign any USDC transfer above the limit it was written with: the agent's largest trade
size, which every save of the agent's settings writes into it again. The builder, the
settings form and the Wallet budget card all keep that at `$1` or more, well above the
`$0.25` a step may cost, but the server accepts any positive trade size.
A wallet whose limit is below the step ceiling (`INFERENCE_MAX_STEP_USD`) would refuse
to sign, so its run is not started at all: the check before a run holds the agent with
"The wallet's limit is below the price of a step" (`wallet_limit_low`), tells its owner
once, and backs off like any other hold an owner must fix, until the largest trade size
is raised. Nothing is quoted, reserved or signed for such an agent, so it adds nothing
to the signature breaker's count.

**`SOLANA_RPC_URL` must be your own provider's URL, and the code does not check that it
is.** The pay path refuses one thing only: an empty value (the agent is held with
"Waiting on the Solana network"). Any other value passes, including the public endpoint
`https://api.mainnet-beta.solana.com`, which is the value `.env.example` ships. With the
public endpoint set, payments **are** signed, and the wallet read before each run and
the reconciler after it then depend on a rate-limited node nobody answers for, which is
how payments end up unresolved. The admin card says so when the host is the public one
("SOLANA_RPC_URL is the public Solana endpoint"): under Caps always, and in its "Right
now" line once the switch is on. It never shows the URL itself, and it cannot tell a good
provider from a bad one. Checking the value is a step of stage 1 below.

The schema is one additive migration, `drizzle/0010_tearful_monster_badoon.sql`: three
new tables (`inference_payments`, `inference_budget_days`, `inference_control`) and nine
new columns on `agents` and `agent_runs`. Seven are nullable. Two are `NOT NULL` with a
constant default, `agents.inference_strikes` (`0`) and `agent_runs.inference_spend_usd`
(`0`), which is still additive: existing rows take the default and the old code never
writes either. It runs on deploy like the others. Ledger rows have no foreign keys and
are never deleted: the record of what a wallet paid outlives the agent, the run and the
account.

**The third cron.** `vercel.json` adds `/api/cron/inference` at `1-59/5 * * * *`, with a
300-second function entry, protected by `CRON_SECRET` like the other two. It starts no
run and pays for nothing: it reconciles, applies the breakers and looks again at held
agents. The fallback scheduler, `.github/workflows/cron.yml`, **calls it too**, as a third
step after marks and tick ("Settle pay-per-use payments"), and prints only the status
code. `pnpm tick` (the local loop) does **not**: it calls marks and tick only, so a local
or self-hosted deployment driven by it never reconciles and never lifts a hold. If that
is what drives yours, call the route yourself on the same five minutes:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/inference
```

**The payment packages are pinned to exact versions** in `package.json`: `@x402/core`,
`@x402/svm`, `@solana/kit`, `@solana/web3.js` and `@privy-io/node` carry no `^` (nor do
`@x402/fetch` and `@x402/evm`, which the paid-data path uses). The reason: the x402
client builds the payment, Privy signs it, and the pay path then decodes the signed
Solana transaction byte by byte before anything is sent (one USDC transfer of the quoted
amount, one memo, the pinned accounts, nothing else). A minor release that lays a
transaction out differently, or signs it differently, would either make that check
refuse every payment or, worse, pass something the check no longer reads correctly. So a
version of any of these changes only on purpose: bump it in a change of its own, run
`pnpm vitest run src/lib/x402`, and repeat stage 1 (the quotes and the signature test)
before the bump reaches production.

### Switching it on, in stages

Do not skip a stage, and do not move to the next one with an open question from the last.

**Stage 0. Merged, off.** `INFERENCE_USDC` is unset. Check that Settings → Admin →
Pay-per-use thinking reads "Switched off", that the builder offers no pay-per-use card,
and that `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app/api/cron/inference`
answers `"ok": true` with nothing to do. Nothing else about the app has changed.

**Stage 1. No money.** Still off.

1. **Check `SOLANA_RPC_URL` in production.** It must be your own provider's URL (Helius
   or another), not `https://api.mainnet-beta.solana.com` and not empty. Nothing in the
   code refuses the public endpoint (see above), so this is yours to check: look at the
   value in Vercel, and at Settings → Admin → Pay-per-use thinking, which must **not**
   say "SOLANA_RPC_URL is the public Solana endpoint" and must not say it is not set.
   `X402_MOCK` must be unset in production as well: with `X402_MOCK=1` no payment is
   ever real, the card reads "Mock mode", and the signature test below refuses to run.
2. `pnpm tsx scripts/inference-quote.ts <your agent's Solana wallet address>`. One unpaid
   request per model, each quote checked against the pins and against its cap. It cannot
   pay: it imports no wallet and no signer, and reads nothing from the environment, so
   it runs from any machine. The address is optional; with it, the "fee payer is not the
   agent" pin is checked against the real wallet. Exit code 1 if any model fails.
3. Settings → Admin → Pay-per-use thinking → **Test a signature (nothing is sent)**. The
   list offers only the Solana wallets of **your own** agents, and the server refuses any
   other: if it says none of your agents has one, build an agent of your own with Solana
   among its chains first. Use an unfunded one: what Privy signs is a real payment until
   its blockhash expires about a minute later, and an empty wallet cannot pay it whatever
   happens. Apply its wallet policy first (Wallet budget card), so the signature is made
   under the policy a paid run will meet. The test fetches a real quote, has Privy sign
   the payment, checks the signed bytes, and throws the result away. Expect six lines
   ending in "nothing was sent". This is the first time Privy is asked to sign an x402
   payment for an agent wallet: if the policy refuses, stop here.
4. Do steps 2 and 3 again some hours later. Two things will differ and both are
   expected: the fee payer alternates between two gateway addresses, and the same request
   is quoted a few micro-dollars apart.
5. **Run the spending limits against a real Postgres, once.** Every limit (per run, per
   agent, per account, the platform's day) is a conditional update inside one
   transaction, and so far that is proven on the test database only: PGlite, which has a
   single connection, so reservations made "at once" in the ordinary tests run one after
   another. That proves the arithmetic and not the row locking. The test that makes them
   genuinely race is written, is skipped in `pnpm test`, and has never been run:

   ```bash
   INFERENCE_CONCURRENCY_DATABASE_URL=<a Postgres you can throw away> pnpm vitest run src/lib/x402/inference-ledger.concurrency.test.ts
   ```

   Use the docker compose database or a scratch branch of your provider's, **not
   production**. It creates a schema of its own with a random name, builds the three
   ledger tables in it from the migration's own SQL, runs each race 25 times over ten
   connections, and drops the schema. All of it must pass. If a test fails, two servers
   can both take the last cent of a limit: stop here and do not go to stage 2.

Go on only when the RPC is your own, every model passes, the signature test passes and
the concurrency test passes.

**Stage 2. Owner only, a few dollars.**

1. Set `INFERENCE_USDC=owner`. Leave `INFERENCE_PLATFORM_DAILY_USD` at its default of
   `$2` (or set it to `2` so it is written down) and `INFERENCE_USDC_USER_IDS` empty.
   Optionally `INFERENCE_MAX_STEP_USD=0.05` for this stage. Redeploy.
2. On **one** agent of your own: choose Pay per use, keep the default model (Gemini 2.5
   Flash: about $0.07 a typical run by Tocker's estimate) and the two limits the builder
   suggests, and set execution mode to `approve`. Send its Solana wallet a few dollars of
   USDC ($3 is plenty). A **live** agent is the better subject: the one figure this
   feature changes in public is a live agent's P&L, and a paper agent, which pays in
   exactly the same way, shows nothing of it there.
3. Start **one run by hand**. Then wait ten minutes, so the reconciler has passed twice.
4. Check the ledger against the chain, to the micro-dollar:

   ```bash
   X402_MOCK=0 DATABASE_URL=<production connection string> SOLANA_RPC_URL=<your provider's URL> pnpm tsx scripts/inference-audit.ts <agent slug> --hours 24
   ```

   Written whole, and with no env file, on purpose. The script refuses to run in mock
   mode, and a local `.env` copied from `.env.example` carries `X402_MOCK=1`, the public
   RPC and a local database: an env file fills in whatever the shell leaves unset, so
   unsetting `X402_MOCK` in the shell does nothing, and a forgotten `DATABASE_URL` would
   audit the wrong ledger.
   The first argument is an agent's slug, its id, or a Solana wallet address; `--hours`
   takes up to 744. The connection string and the RPC URL are secrets: keep that line
   out of your shell history. It is read-only: it runs SELECTs and RPC reads and changes
   no row.

   Exit code 0 means the ledger equals the chain, and it prints `No differences.`; 1
   means it printed a difference; 2 means it could not tell (mock mode, no RPC, no such
   wallet, or a history the node would not return whole). A row still `signed` or
   `unconfirmed` is printed as `open`, and an answered row with no transaction id as
   `unproven`, and both count as differences: ten minutes after the run there should be
   neither. An `unproven` row "with no transfer found" is an answer the gateway may have
   given free; leave it to the reconciler, which calls it not charged only on its strict
   rule, and write it down for step 5.

   Then look at the three places the amount shows. On Solscan, the wallet's USDC fell by
   the audit's "Chain says paid". On Money, Costs → Thinking (pay per use) shows the same
   amount. And on a live agent, once the next mark has been taken (marks land every five
   minutes), **the agent's all-time P&L has not moved by what the run paid**: it is a
   cost on Money and not a loss on the card. If instead the P&L fell by the amount and
   Money says a payment "is still being confirmed on the chain", the rows have no
   transaction id yet: that is the receipt question of step 5, and the reconciler should
   have written the ids within those ten minutes.
5. **Write down**, because no code can know these until a payment has been made. At
   `owner`, and only at `owner`, the pay path writes one line to the function log for
   every paid response, which answers the first three:

   ```
   [inference] run <run id>: paid response <HTTP status> said <header>=<value> ...; read as <verdict>
   ```

   The headers are the ones the rules read, by name, with short cleaned values (an x402
   receipt is shown decoded, as `{success: ..., transaction: "..."}`); "nothing about the
   payment or the model" when there were none. The verdict is one of `this payment's
   transaction id, settled`, `not settled` or `no proof of settlement`. Find the lines by
   searching the Vercel function logs for `[inference] run`, and copy them out. They are
   under the function that ran the agent: `/api/cron/tick` for a scheduled run, and the
   agent's own page, `/agents/<slug>`, for a run started with **Run now** (that button is
   a server action, served by the page's function). Only a run started from the go-live
   wizard is under `/api/agents/[id]/run`.
   - the **receipt header**: which of `PAYMENT-RESPONSE`, `X-Payment-Response`,
     `X-Payment-Receipt` and `X-Payment-Settled` arrive on a paid answer, what is in
     them, and **how each line was read**. If every line reads `no proof of settlement`,
     every answered step waits for the reconciler before it is netted from P&L or shown
     in the Money total: workable for one agent, and a queue at scale, because a pass
     confirms at most 25 rows. Settle this before stage 3;
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
6. Two drills, while only your money is at stake. Do them in this order and do not skip
   the step between them: the check before a run looks at the halt **before** it looks
   at the wallet, so with the halt still on the second drill can never show its message.
   1. **The halt.** Start a run by hand and, while it is running, throw the admin halt
      (Settings → Admin → Pay-per-use thinking, type why, **Halt pay-per-use**). The
      next step must stop with nothing signed, and the agent must show "Pay-per-use is
      paused". You are told once.
   2. **Clear it and prove the agent pays again.** On the same card press **Clear the
      halt**, then **Yes, let payments resume**. (If the card answers "The reason
      changed since this page was loaded", it has redrawn itself with the reason as it
      now stands: read it and press the two buttons again.) Press **Run now** on the
      agent: a run started by hand is checked at once, whatever the hold says, so the
      hold lifts and the run pays. Do not go on until a run has paid again.
   3. **The empty wallet.** Withdraw the agent's USDC to your own wallet, then press
      **Run now**. No run starts, the agent is held with "Add USDC to keep thinking",
      and you are told once, not on every tick.
7. The 24-hour soak. **First send the wallet USDC again** ($3), press **Run now**, and
   confirm the hold has gone and the run paid: started with the halt on or the wallet
   empty, the agent sits held for the whole day, nothing is paid, and the audit passes
   on nothing. Check too that the card's "All agents" tile is not at its `$2` limit for
   the day. Then leave the agent on an hourly schedule for 24 hours (the schedule a new
   pay-per-use agent starts on) and, ten minutes after its last run, run the audit of
   step 4 again.

Go on only with all of these: the audit printing `No differences.` over a window that
really held payments (its `Ledger` line counts at least 50 rows for the 24 hours; an
hourly schedule makes about 22 runs a day, and far fewer rows than that means the agent
sat held); nothing left open on the admin card and no row marked "no verdict in time";
the live agent's P&L unmoved by what it paid; both drills seen; and every item in step
5 written down.

**Stage 3. A few invited owners.** Add their user ids to `INFERENCE_USDC_USER_IDS`,
comma-separated, and raise `INFERENCE_PLATFORM_DAILY_USD` to `25`. A user id is the
account's Privy DID (`did:privy:...`), the value of `users.id`. No admin table shows it,
they show handles: copy it from the Privy dashboard, or read it with
`select id from users where handle = '<their handle>';`. One week. Audit a few wallets
every day. Before this stage: correct the receipt and reroute rules if stage 2's log
lines showed the headers arrive differently from BlockRun's documentation, and leave the
payment packages at the versions stage 2 ran on (they are already pinned exactly; see
above). The concurrency test belongs to stage 1 and must already have passed. Two things
are new at this stage because a second account exists. The three breakers that count
accounts (steps with no answer, gateway failures, signature failures) can now trip, which
they could not with one account. And the scheduler's ceiling described under stage 4
already applies: at most five pay-per-use runs start in one pass, and the rest wait for
the next, so keep this stage to a handful of pay-per-use agents. Go on only with zero
ledger-and-chain differences across the week and unconfirmed payments under 1%.

**Stage 4. Everyone.**

1. **Before the switch: lift the scheduler's ceiling.** This is a code change, and
   `INFERENCE_USDC=on` is not set until it has shipped. As the code stands
   (`tickDueAgents` in `src/lib/agent/scheduler.ts`, whose comment has the detail), **at
   most five pay-per-use runs start in one pass of `/api/cron/tick`**: five every five
   minutes, sixty an hour, for the whole platform. A paid run is started only in the
   first fifty seconds of its invocation, and the second batch of five starts when the
   slowest run of the first has ended, which is nearly always later than that. A
   pay-per-use agent picked beyond those five is put off. It stays due and is picked
   first again next pass, but it has used one of this pass's slots (`CRON_MAX_AGENTS`; at
   its default of 5 a pass is a single batch and nobody is put off, so this bites as soon
   as that is raised). So a backlog of twenty such agents, from different owners, leaves
   no slot in a pass of twenty for an agent on a key until it drains, and above roughly
   sixty hourly pay-per-use agents it never drains: agents on a key, which is the
   existing product, stop being picked. Nothing is lost or paid twice by this, and it
   cannot be reached while only the owner is switched on. Change one of two things in
   `tickDueAgents`, with a test: take no more than five pay-per-use agents into a pass,
   so the other slots go to agents on a key; or run the pay-per-use batch alongside the
   first batch of key agents.
2. **Then the switch.** `INFERENCE_USDC=on`, and raise `INFERENCE_PLATFORM_DAILY_USD` by
   hand (`250` to begin with).

At `on` the landing page's FAQ changes two answers ("Which AI model runs it?" and "What
do I need to start?") to say an agent can pay per use: read them in
`src/components/liquid/defaults.ts` first. The per-response log line of stage 2 stops at
`on`. Nothing on the Money page depends on the switch: an owner who has never paid for a
step reads the Costs heading as it always was ("Three different bills, only one of which
we collect."), and an owner whose page has the Thinking line reads "Four different
bills".

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

The halt is not only yours to throw. The reconciler throws it (as `reconciler`) when it
finds USDC that went from an agent to the gateway in the shape of a payment with no
ledger row behind it, and the ledger throws it (as `ledger`) when a payment is reported
on a row whose amount was already given back. The reason names the transaction, and
what is found while the halt is on is added to that reason. Read all of it before
clearing: clearing tells the reconciler that the transactions the reason names have
been looked at, so those do not halt again, while one it never named still does. The
admin page does not redraw itself, so a clear says which reason the page was showing,
and the server compares that with the reason stored at that moment. If something was
added in between, the clear is refused ("The reason changed since this page was loaded.
Reload and read it before clearing."), the halt stays on and nothing is acknowledged:
the card draws itself again with the whole reason, and the two buttons are pressed again
over that. A transfer to the gateway that is **not** shaped like a payment (no memo, or
the wallet paid its own fee: an owner's own transfer to that address) halts nobody; it is
logged and that one agent is put on hold.

### Known limits, left as they are on purpose

Each of these is how the code behaves today, was looked at, and was left. None loses
money or pays twice.

- **Only the first batch of a pass runs pay-per-use agents.** At most five pay-per-use
  runs start in one pass of the tick cron, and the ones put off still use that pass's
  slots. It cannot be reached while only the owner is switched on, and lifting it is
  step 1 of stage 4, where it is described in full.
- **The hold-back is one figure for both chains.** A live pay-per-use agent keeps two
  run limits and the wallet floor out of its buys. An agent that trades Solana **and**
  Base has one cash figure for both, so that amount comes off the total and not off the
  Solana wallet that pays for the thinking: with `$2` on Solana and `$10` on Base, a `$2`
  buy on Solana still clears and empties the wallet the hold-back was meant to protect.
  The agent is then held with "Add USDC to keep thinking" at its next run although it
  holds USDC on Base, and its owner is told to add USDC on Solana. Closing it needs cash
  per chain in the risk guard, which is a change to every buy path. An agent that trades
  Solana alone does not have it, and the first-trade preset keeps a pay-per-use agent on
  Solana alone.
- **A schedule expected to cost more than the daily limit is refused by the form, and
  only by the form.** The builder and the agent's settings form will not save one (the
  estimate is made from list prices). The server makes no such check: a config that
  reaches it some other way with such a schedule is accepted, and the form then refuses
  every later save until the limit or the schedule is changed. The daily limit itself is
  enforced whatever was saved, when each payment is reserved, so such an agent stops for
  the day when it reaches it.
- **A payment that got no verdict in seven days stays as it is.** It remains counted as
  charged against the limits of the day it was reserved on and is shown as "could not be
  checked in time". If it did land, its amount stays in the agent's P&L as a loss and
  outside the Thinking total for good, because nothing nets a payment that is not
  proven. Only `scripts/inference-audit.ts` shows what the chain says about it, and no
  action in the app resolves such a row.
- **What the timing of a mark still takes on trust.** No mark is written while a paid
  step is in flight, and a payment's flow is dated when it was resolved (see P&L above).
  Both rest on a transfer that the gateway's receipt calls settled being visible to
  **your own** RPC node by the time the wallet is next read, and a run's last mark is
  read moments after its last step. If your node trails the gateway's by longer than
  that, the mark does not yet hold the last step's fall while its flow is already before
  it, and the agent's P&L reads that one step's price high until the next mark, five
  minutes at most. The same holds for an answered step with no receipt whose transfer
  lands after its answer. The "settle order" item of stage 2, step 5 is what shows
  whether this happens; if it does, the fix is to put a mark off for a few seconds after
  a step resolves, in `paidStepInFlight` (`src/lib/agent/portfolio.ts`). It also rests on
  the servers' clocks agreeing to well under a second.

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
  pass. (A cap below what a step may cost never gets as far as a signature: the run is
  not started. See "The wallet's own limit" above.) The stage 1 signature test is the
  first evidence; whether Privy rate-limits or bills per signature is unknown.
- **The reroute rule.** It discards an answer when the gateway's fallback headers say
  another model served it. Those headers are documented; none has been seen on a paid
  answer.
- **The receipt rule, and with it how soon a payment is netted.** Which headers a paid
  answer carries, and whether any of them names the payment's transaction, is known from
  documentation only. If none does, every answered step is recorded `settled` with no
  transaction id and is neither taken out of P&L nor shown in the Money total until the
  reconciler has found it on chain: minutes late for one agent, and a queue at scale (25
  rows a pass). Stage 2's log lines are what settle this.
- **That a transaction the gateway says it settled did land.** A transaction id taken
  from a receipt is checked to be this payment's own, which needs no chain. That the
  transaction landed is the gateway's word, and such a row is netted from P&L on it; the
  reconciler does not look those rows up. `scripts/inference-audit.ts` does, and prints
  `ledger_charged_not_on_chain` for one that is not there.
- **The reconciler against a real chain**, in particular its "not charged" verdict,
  which gives a cap back and is deliberately strict, and its confirming of answered rows.
- **The spending limits under real concurrency.** They are proven on the test database
  only, which has one connection. The test that makes reservations race against a real
  Postgres (`src/lib/x402/inference-ledger.concurrency.test.ts`, switched on by
  `INFERENCE_CONCURRENCY_DATABASE_URL`) is written and has never been executed. Running
  it once is step 5 of stage 1, and it must pass before stage 2.
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

## Model providers, in full

An agent on its owner's own API key thinks on one of the providers in the registry,
`src/lib/agent/providers.ts`. The registry is the only list of them. The chooser, the key
forms, the key check, the model picker, the run and the Money page's prices all read it,
and the database column that says whose a key is (`llm_keys.provider`) is plain text.
Nothing here needs an environment variable, and nothing here changes pay-per-use
thinking (section 5).

**What is switched on is one line.** The registry has a row for each of the nineteen
providers in the table below. `PROVIDER_IDS`, in the same file, lists the ones a key can
be added for. A provider that has a row and is not in that list is offered nowhere in the
app, and a key for it is refused. Anthropic, OpenAI and OpenRouter are the three the
product launched with. The other sixteen were added together on 2026-10-07, and **none
of the sixteen has yet been run with a real key**: read "What proven means here" below
before relying on one.

| Provider | Where its key is made | The host its key is sent to | Models in the picker |
|---|---|---|---|
| Anthropic | https://console.anthropic.com/settings/keys | `api.anthropic.com` | asked with the key |
| OpenAI | https://platform.openai.com/api-keys | `api.openai.com` | asked with the key |
| OpenRouter | https://openrouter.ai/keys | `openrouter.ai` | its public list |
| Google Gemini | https://aistudio.google.com/apikey | `generativelanguage.googleapis.com` | asked with the key |
| xAI | https://console.x.ai/team/default/api-keys | `api.x.ai` | asked with the key |
| DeepSeek | https://platform.deepseek.com/api_keys | `api.deepseek.com` | asked with the key |
| Mistral AI | https://console.mistral.ai/home?profile_dialog=api-keys | `api.mistral.ai` | asked with the key |
| Moonshot AI | https://platform.kimi.ai/console/api-keys | `api.moonshot.ai` | asked with the key |
| Z.AI | https://z.ai/manage-apikey/apikey-list | `api.z.ai` | built in |
| Groq | https://console.groq.com/keys | `api.groq.com` | asked with the key |
| Cerebras | https://cloud.cerebras.ai | `api.cerebras.ai` | its public list |
| Together AI | https://api.together.ai/settings/projects/~current/api-keys | `api.together.ai` | built in |
| Fireworks AI | https://app.fireworks.ai/settings/users/api-keys | `api.fireworks.ai` | asked with the key |
| DeepInfra | https://deepinfra.com/dash/api_keys | `api.deepinfra.com` | its public list |
| Vercel AI Gateway | https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys | `ai-gateway.vercel.sh` | its public list |
| Venice | https://venice.ai/settings/api | `api.venice.ai` | its public list |
| Nebius Token Factory | https://tokenfactory.nebius.com/project/api-keys | `api.tokenfactory.nebius.com` | asked with the key |
| Novita AI | https://novita.ai/settings/key-management | `api.novita.ai` | its public list |
| Hugging Face | https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained | `router.huggingface.co`, and `huggingface.co` for the token check alone | its public list |

"Asked with the key": the provider is asked which models this key can use
(`listKeyModels`). "Its public list": the provider publishes its catalogue and it is read
with **no key at all**, through a route only a signed-in user can call, and kept in
memory for an hour. "Built in": the provider has no list that says which models can call
tools, so the picker shows the registry's own rows. In every case any model id can also
be typed.

### Seven that were looked at and left out

| Provider | Why it is not offered |
|---|---|
| Cohere | Every account starts on a trial key that Cohere does not permit for production or commercial use, and a trial key cannot be told from a production one. On its newer models even a production key is held to trial limits, and production use means talking to its sales team. |
| MiniMax | Its official client is built on the Anthropic one and reads Anthropic's options, so it would have been sent a prompt-caching option that MiniMax does not document. |
| SambaNova | Its documentation could not be read (the site turns automated readers away), and it has no free request that says whether a key is good: a key could only be checked by paying for a completion. |
| Perplexity | Its tool calling needs a client release built on newer AI SDK internals than the ones installed. The release that matches never sends tools. Add it after `ai` is upgraded. |
| Alibaba Model Studio (Qwen) | Its API address is different for every workspace and region. A user would have to type a host as well as a key, and there is no user-supplied address anywhere in Tocker, on purpose. |
| NVIDIA NIM | No pay-as-you-go. Its free access is for prototyping only, and production use needs an enterprise licence. |
| Hyperbolic | Its serverless inference API has been retired. |

### Where a key can go

**A key only ever reaches its own provider's host.** Each row names one `https` origin,
a constant in the registry. Everything that sends a key reads it from there:

- **A run.** The provider is the one on the key's own row (`llm_keys.provider`), never
  something the agent's config or a request says. Its client is built with the registry's
  base URL passed in every time (`modelFor`, `src/lib/agent/providers-server.ts`). Several
  of these clients would otherwise read one from the environment (`OPENAI_BASE_URL`,
  `ANTHROPIC_BASE_URL`); with it passed in, no variable set on the deployment can move a
  user's key to another host. Every request the client then makes goes through a `fetch`
  that refuses any address off that origin and treats a redirect as an error.
- **The key check, the model list, and Anthropic's workspace lookup**, the only requests
  written by hand. All go through one guarded fetch (`providerFetch`,
  `src/lib/agent/providers-keys.ts`): the address is built from the registry's origin and
  a path written in the code, checked again to be on that origin, never followed through
  a redirect, never cached, and dropped after a few seconds. A key always travels in a
  header, never in an address.
- **No address comes from outside.** Not from a form, not from a stored row, not from a
  provider's answer. The one user-chosen string that reaches a request's address is the
  model id (Google's API takes it in the path), and a model id may not contain `..`.

One row has a second host, and it is said here rather than left to be found. A Hugging
Face token is used on `router.huggingface.co` (runs, and the public model list). The
router has no request that says whether a token is good, so when a token is added or
replaced it is checked once against `https://huggingface.co/api/whoami-v2`: the Hub, the
site that issued it. That host is a second constant on the row (`keyCheckOrigin`), only
the key check may use it, and no other row has one.

Three more things hold. An agent cannot be created or saved with a key of a different
provider from the one its config names, so a model id never reaches a host it means
nothing to. A saved key whose provider is no longer in `PROVIDER_IDS` is not used: the
run fails with "This key's provider is no longer supported. Add a key for another
provider and select it on the agent." and nothing is sent. And a key is still decrypted
in the same two places as before, the run loop and `listKeyModels`.

**A key pasted under the wrong provider is refused before it is sent.** The check
(`keyProblem`, in the registry) runs on the server when a key is added and when one is
replaced, before any request, and in the forms. It knows two things:

- **Whose a prefix is.** A key that starts the way another provider's keys do is refused
  with a sentence that says whose it looks like: `sk-ant-` (Anthropic), `sk-proj-`,
  `sk-svcacct-` and `sk-admin-` (OpenAI), `sk-or-` (OpenRouter), `AIza` and `AQ.`
  (Google), `xai-` (xAI), `gsk_` (Groq), `csk-` (Cerebras), `fw_` (Fireworks), `vck_`
  (Vercel), `sk_` (Novita), `hf_` (Hugging Face).
- **Who documents one.** Cerebras and Novita say every key of theirs starts with their
  prefix, so under those two a key without it is refused as well.

The limit of that check: it only works where a prefix belongs to one provider. A bare
`sk-` key (an older OpenAI key, a DeepSeek key) and a key with no prefix at all (Mistral,
Moonshot, Z.AI, Together, DeepInfra, Venice, Nebius) look like each other. Pasted under
the wrong one of those, such a key **is sent once**, to the provider that was chosen, in
the key check. That provider answers that it is not one of its keys and the key is not
saved. (If that provider cannot be reached at that moment, the key is saved as not
checked, and its first run fails.) No key is refused for its length or its characters,
because most providers publish neither.

**What a provider says to a bad key differs**, and the key check follows each one's own
rule. For most, HTTP 401. Google answers 400 with the reason `API_KEY_INVALID`. xAI
answers 400 "Incorrect API key". A public model list usually says nothing about a key,
so another free request is used: OpenRouter's key endpoint, Cerebras's list that needs a
key, Venice's rate limits, Novita's billing balance, Vercel's credits, Hugging Face's
`whoami-v2`. (DeepInfra's public list does answer 401 to a key it does not know, and is
its check.) Z.AI is checked on an endpoint its documentation does not list; only a 401
from it refuses a key. A refusal that is about the network and not the key (Groq's 403
"Access denied. Please check your network settings.") is never read as a bad key.
Whenever the answer cannot be read as a yes or a no, the key is saved and shown as not
checked, exactly as before.

**A provider's own words are cleaned twice.** `redactSecrets` removes anything shaped
like a credential, and now knows every prefix in the registry. Many of the new keys have
no shape at all, so a failed run also removes its own key by value, before that, from
the error it stores and sends (`keyScrubber`); the key check and the model list do the
same with what they return.

### What "proven" means here

For each of the sixteen, on 2026-10-07:

- **Its documentation** says its models call tools in a multi-step loop, and that anyone
  can make a key and pay as they go.
- **Its client package** is the official AI SDK one (or the generic OpenAI-compatible
  client, where the provider documents that format), at a release built on the same AI
  SDK internals as the installed `ai`.
- **Its live API** was sent a request with a made-up key, or with none, and what it
  answered is the rule the key check now follows. The exceptions: Groq refused the
  network that request came from before looking at any key, so its "bad key" answer was
  seen only through a third party's relay. And Venice's, Novita's and Hugging Face's
  model lists answer the same to any key, so their keys are checked on another request,
  and that request was not tried: what Venice's says to a bad key is from its
  documentation, and Novita's and Hugging Face's are taken to be the usual 401.
- **In tests**, with simulated responses and nothing leaving the machine: for every
  provider, a two-step conversation with one tool call through its real client, answered
  in that provider's own format (`src/lib/agent/providers-server.test.ts`), and its key
  check and model list (`src/lib/agent/providers-keys.test.ts`). The answers are written
  from each API's documented shape. They show what Tocker sends and where; they cannot
  show that the provider accepts it.

What that does **not** include:

- **No real key was used on any of the sixteen.** No run, no tool call, no model list
  read with a key. Each provider's first run with a real key is the proof, and you make
  it.
- **The agent's tools on each provider.** A run sends about ten tool definitions, one
  of them a free-form object and one with no parameters. Whether every provider accepts
  all of them is known from documentation only.
- **What comes back to a real key**: each list's real contents, the answer to a
  well-formed but revoked key, and how each provider words an empty balance.
- **Prices.** They were read that day and are list prices. They are what an estimate is
  made from, never what is charged.

To prove one: add a real key under it in Settings and see it accepted (not "could not be
checked"), open the model picker, then press **Run now** on a paper agent set to its
default model and read the transcript to the end. A run of several tool calls that
finishes is the proof for that provider and that model, and for nothing else.

### What an owner will meet, provider by provider

- **Google Gemini.** A free-tier key has low limits, and Google uses what a free-tier key
  sends to improve its products; a key with billing on has neither. The strategy is part
  of what is sent. Keys start `AIza` or, made since May 2026, `AQ.`; there are unresolved
  reports of `AQ.` keys being refused by Google. The agent's temperature setting is not
  sent (Google advises against lowering it on Gemini 3). Prepaid from $5.
- **xAI.** Stores API requests and responses for 30 days by default, and says it does
  not train on them. Prepaid: buy credits before the first run. Grok 4.5 and later
  always reason, so steps are slower and the reasoning is billed as output.
- **DeepSeek.** Prepaid top-up. Thinking is on by default and the API ignores a
  temperature while it is, so none is sent. Its keys start `sk-` like an older OpenAI
  key, so the two cannot be told apart before sending (see the limit above). Its prices
  are lower off-peak; the estimate uses the peak rate. Its data-handling terms were not
  reviewed.
- **Mistral AI.** A temperature above 1.5 is sent as 1.5. Its rate limits, free and
  paid, are shown only inside the account, so a 429 cannot be predicted; an agent on a
  schedule is likely to need pay-as-you-go turned on.
- **Moonshot AI (Kimi).** Use a key from `platform.kimi.ai`, the global platform; a key
  from its mainland-China platform does not work. An account that has only made the $1
  minimum recharge is held to 3 requests a minute and one at a time, too few for a run,
  until it has added $10 in total. No temperature is sent: Kimi models fix their own.
- **Z.AI.** Needs a pay-as-you-go balance; a GLM Coding Plan key is for a different
  endpoint and does not work here. An empty balance arrives as HTTP 429 and reads like a
  rate limit. A temperature above 1 is sent as 1.
- **Groq.** Refuses some networks outright, with HTTP 403 "Access denied. Please check
  your network settings.", before it looks at a key. It did so to the network this was
  researched from. Whether it accepts requests from your deployment is unknown until a
  key is added there: if it does not, the key is saved as "could not be checked" and
  every run on it fails with that message. The free plan allows 8,000 tokens a minute,
  less than one step needs; use the Developer plan. Limits are per organisation, so two
  agents ticking in the same minute on one key can meet a 429. Groq rejects a malformed
  tool call with HTTP 400, which ends that run.
- **Cerebras.** A key must start `csk-`. Every step is sent an output limit of 8,192
  tokens, because Cerebras counts a request's whole output allowance against the
  per-minute limit before it runs. The free trial allows 5 requests a minute; buy
  credits. It sells two models, and on one of them (`qwen-3.8-27b`, 150,000 tokens a
  minute) a long run comes close to the limit by itself.
- **Together AI.** No free tier: buy credits first. The host is `api.together.ai`, the
  one in Together's documentation.
- **Fireworks AI.** Model ids are long paths (`accounts/fireworks/models/glm-5p3`); cards
  and the Money page show the model's name. Its `-latest` aliases move to newer models
  without notice and are not offered.
- **DeepInfra.** Its own advice for tool calling is to avoid a system message, and a run
  sends one. How much that matters on current models is not known.
- **Vercel AI Gateway.** No temperature is sent for any model, because the gateway marks
  many of its models, the default among them, as taking none. The free tier covers only
  some models; the rest need credits on the Vercel team. A key is never empty: with an
  empty one the gateway's client would use the deployment's own Vercel identity and
  Tocker would pay, so an empty key is refused before any client is built.
- **Venice.** Venice puts its own system prompt in front of the agent's unless told not
  to; a run tells it not to. A key can carry its own spending cap and be refused (402)
  while the account has a balance.
- **Nebius Token Factory.** A card is required at sign-up. Only the global host is used.
  Nebius retires models on a schedule, so prefer the live list over a typed id.
- **Novita AI.** A key must start `sk_`. Every step is sent an output limit of 8,192
  tokens, because Novita's reference marks one as required. On a thinking model that
  limit includes the reasoning.
- **Hugging Face.** The token needs the permission "Make calls to Inference Providers".
  A model is served by whichever provider Hugging Face routes to, at that provider's
  price, and not every one of them supports tools; a typed id can pin one
  (`model:provider`). The estimate uses the highest price among the providers that do,
  so it is never low.

Three things are true of several of them. On the hosts that serve Kimi (Together,
Fireworks, DeepInfra, Venice, Nebius, Novita, Hugging Face) no temperature is sent for a
Kimi model. A model that always thinks bills its reasoning as output. And every one of
these companies reads the strategy and transcript of an agent that thinks on it, under
its own terms, as Anthropic or OpenAI does today.

**On the Money page**, an agent's model estimate is made at the list price on its own
provider's row. The same model id costs different amounts on different hosts, so the
price of another host is never borrowed: a model the registry does not list for that
provider, including one picked from a provider's live list, has no price, and the page
says so and leaves it out of the total. Prices go stale. Known today: Google's
`gemini-3.8-flash`, `3.7-flash` and `3.6-flash` list prices double on 2027-01-01, and
Mistral Large 4 is on a temporary sale (the row carries its list price). Correct a price
by editing the row.

### The packages

Twelve packages were added, each pinned to an exact version in `package.json` (no `^`):

| Package | Version | For |
|---|---|---|
| `@ai-sdk/google` | 4.0.67 | Google Gemini |
| `@ai-sdk/xai` | 4.0.57 | xAI |
| `@ai-sdk/deepseek` | 3.0.44 | DeepSeek |
| `@ai-sdk/groq` | 4.0.40 | Groq |
| `@ai-sdk/mistral` | 4.0.42 | Mistral AI |
| `@ai-sdk/cerebras` | 3.0.47 | Cerebras |
| `@ai-sdk/togetherai` | 3.0.48 | Together AI |
| `@ai-sdk/fireworks` | 3.0.50 | Fireworks AI |
| `@ai-sdk/deepinfra` | 3.0.47 | DeepInfra |
| `@ai-sdk/moonshotai` | 3.0.48 | Moonshot AI |
| `@ai-sdk/zai` | 3.0.9 | Z.AI |
| `@ai-sdk/openai-compatible` | 3.0.47 | Venice, Nebius, Novita, Hugging Face |

The Vercel AI Gateway needs none: its client comes with `ai`. Hugging Face's own package
is deliberately not used: it drops tool results between steps, so an agent's second step
would never see its first.

**Why exact.** Each of these depends on one exact version of the AI SDK's two internal
packages, and these releases are the ones built on the versions the installed `ai`
7.0.97 uses. A `^` would take today's latest of each, which is built on newer internals,
and the app would then run two copies of them. (`@ai-sdk/deepseek` is one patch ahead on
purpose and does bring a second copy: 3.0.44 is the first release that handles
DeepSeek's current model id.) `@ai-sdk/xai`'s latest is also a new major version that
removes an API. So change a version only on purpose, together with `ai`, in a change of
its own, and run `pnpm vitest run src/lib/agent/providers-server.test.ts` before it
ships. The versions of `@ai-sdk/anthropic`, `@ai-sdk/openai` and
`@openrouter/ai-sdk-provider` were not touched.

### The database

One migration, `drizzle/0011_lonely_ego.sql`, two statements: `llm_keys.provider` becomes
`text`, and the Postgres enum `llm_provider` is dropped. It runs with the others on a
production deploy (section 1). Saved keys keep their provider; nothing else in the table
changes. For the length of the first statement it holds an exclusive lock on `llm_keys`
and rewrites it: one small table, one row per saved key. The deployment still serving
while the new one builds keeps working against the changed column. Both the migration
and that were checked on an in-memory Postgres (PGlite), not on the production database.

The database no longer checks the column, so the code does: every place that reads a
provider from a form or a row asks the registry first (`isProvider`).

Going back is by hand, and only works while no key of a later provider has been saved.
Run the two statements in one transaction. Checked on the same in-memory Postgres, not
on production:

```sql
CREATE TYPE "public"."llm_provider" AS ENUM ('anthropic', 'openai', 'openrouter');
ALTER TABLE "llm_keys" ALTER COLUMN "provider" SET DATA TYPE "public"."llm_provider" USING "provider"::"public"."llm_provider";
```

With one row for any other provider the second statement fails ("invalid input value
for enum") and the column is left as it is.

### Adding or removing a provider

**Adding one** is a row in the registry and no migration: its id in `CATALOGUE_IDS` and
its row in `CATALOGUE`, with its one origin, its base URL, its key page, its prefixes
and its models. TypeScript then refuses to compile until the two server files have their
entry for it: how its client is built (`providers-server.ts`), and how its key is checked
and its models listed (`providers-keys.ts`). If its keys have a prefix, add the shape to
`src/lib/security/redact.ts`; a test fails until you do. Pin its package to an exact
version. Put its id in `PROVIDER_IDS` last, when it should be offered.

**Removing one** is taking its id out of `PROVIDER_IDS`. It disappears from the chooser,
no key can be added for it, and saved keys of that provider stop being used: their
agents' runs fail with the sentence above until the owner picks another provider and
key. The rows stay in `llm_keys` until their owners delete them. Leave the row in the
registry if the provider may come back.
