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

## 1. Database

Create a Postgres database and copy its pooled connection string. On Neon: New Project → Connection string → **Pooled connection** (the `-pooler` host), and append `?sslmode=require`.

Migrations are in `drizzle/` and run automatically on deploy via the `vercel-build` script (`drizzle-kit migrate && next build`). To run them by hand:

```bash
DATABASE_URL="postgres://..." pnpm db:migrate
```

Seed demo data into a staging database only. Never seed production.

## 2. Environment variables

Set these in Vercel → Project → Settings → Environment Variables, for Production and Preview.

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection string |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy dashboard → App ID |
| `PRIVY_APP_SECRET` | Privy dashboard → App Secret |
| `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Privy → Wallet infrastructure → Authorization keys |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — **generate once and never rotate**, it decrypts stored LLM keys |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` |
| `X402_MOCK` | `0` for real data payments, `1` to run on fixtures |
| `CRON_MAX_AGENTS` | Agents per cron invocation. Default 5; use 2 on Hobby. |
| `NEXT_PUBLIC_SHADER` | `off` disables the WebGPU landing hero and uses the static fallback |
| `LLM_MOCK` | unset (or `0`) |
| `SOLANA_RPC_URL` | A paid RPC. The public endpoint is rate-limited and will drop trades. |
| `BASE_RPC_URL` | Any Base RPC |
| `JUPITER_API_KEY` | Optional, raises Jupiter rate limits |

Every one of these is checked by `pnpm preflight` and reported (as booleans only) under
`live` in `/api/health`. `TOKENS_MOCK` must also be unset or `0`.

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
| Authentication → Advanced → **Multi-factor authentication** | Enable at least one of **TOTP** or **Passkey** | Tocker refuses to switch an agent to live mode or process a withdrawal for an account with no enrolled second factor. With no method enabled at the app level there is nothing to enrol in, and *nobody on the deployment can ever go live*. `pnpm preflight` fails on this, and Settings → Security prints the exact path instead of showing a dead button. |
| Wallet infrastructure → **Authorization keys** | Create one, paste it into `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Agent server wallets are created with this key as their owner so the server can sign trades and x402 payments with no user session. `pnpm preflight` proves the whole chain before you fund anything. |
| Settings → **Allowed origins** | Add the production domain | Logins fail with a CORS error otherwise. |

## 2b. Security posture, and its limits

What ships, and exactly how far each control goes. None of it is implied; a person moving
real money should be able to read this and know what they are relying on.

**Security headers and CSP** — `src/proxy.ts` (Next 16's renamed Middleware) sets a
nonce-based CSP, HSTS (production TLS only), `frame-ancestors 'none'` plus `X-Frame-Options`,
`nosniff`, a strict referrer policy, a deny-by-default `Permissions-Policy`, and
`Cross-Origin-Opener-Policy`. The policy is built in `src/lib/security/headers.ts` and unit
tested. It deliberately allows `auth.privy.io` and `*.privy.io` in `frame-src`/`connect-src`
(Privy renders login and wallet UIs in an iframe — remove these and login silently does
nothing), `wasm-unsafe-eval` + `worker-src blob:` for the WebGPU shader, `https:` in
`img-src` because token logos and social avatars are arbitrary third-party URLs, and
`'unsafe-inline'` in `style-src` because `motion` writes inline style attributes. Setting a
per-request nonce opts routes into dynamic rendering; every route here already reads cookies
for the session, so nothing is lost.

**Rate limits** — `/api/me/*`, `/api/cron/*` and run triggers pass through an in-memory
token bucket, in the Proxy and again inside the cron handlers. **The serverless caveat, in
full:** the counters live in one process's heap. On Vercel each instance and each Proxy
invocation has its own copy, so the real ceiling is `limit × instances`, and a cold start
resets it to zero. This is a speed bump, not a quota — it stops a runaway client and raises
the cost of guessing `CRON_SECRET`; it does not stop a distributed attacker. Move the
buckets to Redis/Upstash behind the same `consume()` signature in
`src/lib/security/rate-limit.ts` before this matters.

**Audit log** — every sensitive action writes an append-only `audit_events` row with an IP
and user agent: withdrawals, spend-cap changes, live/paper switches, agent pauses, LLM key
add/rotate/revoke, kill-switch flips, MFA changes, the first-trade preset and manual runs.
Readable at Settings → Security. `recordAudit` never throws: losing the record of something
that happened is bad, but failing an operator's confirmed withdrawal because an audit insert
failed is worse.

**MFA gate** — checked server-side against Privy's API (`users()._get(...).mfa_methods`), so
a browser that claims to be enrolled is still refused. It verifies *enrolment*, not a fresh
challenge per action: Tocker's agent wallets are signed server-side with the app's
authorization key, so there is no user-side signing ceremony to attach a step-up to. It
stops an account protected by an email code alone from ever reaching live mode or a
withdrawal; it does not stop someone already holding a live session on the operator's
device. The hardening path is Privy's `mfa.enabled` / `mfa.disabled` webhooks plus a
per-action step-up.

**Kill switch** — a per-user `user_security.trading_paused` flag. `findDueAgents` excludes
every agent whose owner has it on, so `/api/cron/tick` opens nothing new and reports how many
it skipped as `pausedSkipped`. **`/api/cron/marks` is deliberately not filtered**: stop
losses, take profits and trailing stops keep firing while trading is paused, because a kill
switch that froze exits would trap the operator in every open position at exactly the moment
they decided something was wrong.

**LLM keys at rest** — verified, not assumed: `addLlmKey` stores `encryptSecret(key)` from
`src/lib/crypto.ts` (AES-256-GCM, `base64(iv|tag|ciphertext)`, keyed by `ENCRYPTION_KEY`).
`decryptSecret` is called in exactly one place in the app — `resolveModel` in
`src/lib/agent/run.ts`, inside the run loop. The plaintext never reaches a server component,
an action result, a run transcript or the browser. Only the last four characters are ever
rendered. Rotation keeps the key's id so agents pointed at it never lose a tick, and
overwrites the old ciphertext in place.

**Spend caps** — `maxTradeUsd`, `maxDailyTrades`, `maxPositionPct` and
`maxDataSpendUsdPerRun` are enforced by `riskGuard()` before any executor is reached, not
requested of the model in a prompt. **Not yet done:** an equivalent *Privy wallet policy*
attached to the agent's server wallets, which would cap spending below Tocker itself. The
SDK supports it (`privy.policies()`, `policy_ids` on a wallet), but a wrong policy bricks
trading, so it is left as the next hardening step rather than written blind. The live wizard
reports the caps it can prove and says which layer they live in.

## 2c. The first live trade

`pnpm preflight` checks the deployment. `/agents/<slug>/live` checks the *agent*, on the
server, every time it is opened or re-checked: database reachable and not PGlite, Privy
configured with an authorization key, second factor enrolled, real (not `paper_`) wallets on
every chain it trades, USDC above the $5 minimum plus native for gas, spend caps within the
cap the operator typed, a first-trade-shaped risk config (one chain, ≤ $2 a trade, one trade
a day, at least one exit rule), `X402_MOCK=0` with every configured source still in the
registry, and the kill switch off. A "first-trade preset" button clamps the agent into that
shape in one click.

A step is green only when it was checked and passed; "could not tell" is red. Going live is a
hold-to-confirm, and `goLiveAction` re-runs every check server-side before it agrees, so a
stale green checklist cannot be used to get past the gate. The last step runs one tick, streams
the run's steps, and ends in a receipt with the fill price, fees, an explorer link (Solscan /
Basescan) and a pause button.

## 3. Deploy

```bash
vercel login
vercel link
vercel --prod
```

Vercel auto-detects Next.js and pnpm. Nothing in `next.config.ts` needs changing.

## 4. Verify

```bash
curl https://your-app.vercel.app/api/health
```

Expect `{"ok":true,"database":"ok","embedded":false,...}`. If `embedded` is `true`, `DATABASE_URL` did not reach the function. Then check `privyConfigured: true` and `impersonation: false`.

Test a cron endpoint by hand before trusting the schedule:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/marks
```

## Notes

- Agent runs happen inside the request that triggers them. This is fine at demo scale. Past a few dozen active agents, move the run loop to a queue or a worker rather than a serverless function.
- The exit engine is the part that must never miss a beat. If you run crons on GitHub Actions, note that its scheduler can delay jobs under load; for real money, use Pro crons or a dedicated scheduler.
