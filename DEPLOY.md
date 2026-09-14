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

**Never set `DEV_IMPERSONATE_USER_ID` in production.** It is ignored whenever Privy is configured, but it must not be there at all.

In Privy, add your production domain to the allowed origins, or logins will fail with a CORS error.

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
