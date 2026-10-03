# Tocker — product truth from the code (2026-10-03)

**One-liner:** Write a strategy in plain English and get an autonomous trading agent with its own Solana/Base wallet. It scores every new token, trades the few that clear your bar, and publishes its record but never its recipe (SPEC.md:3).

**How it works**
1. Describe your strategy in plain English; bring your own LLM key.
2. The agent sweeps fresh launches, buys data and scores each 0–100.
3. It trades what clears your bar; exits run in code.

## Features
- **Discover:** free sweeps; launches under 15 min old (discover.ts:337); paid launch radars.
- **Score:** a 0–100 composite plus 10 hard gates, frozen onto each trade.
- **Trade:** Jupiter Ultra on Solana, Privy swaps on Base, a risk guard on every order. By default it asks first: up to 3 proposals per tick (limits.ts:9), approvable in one tap from a web push (push.ts:31-38). Manual buy/sell, receipts.
- **Exit:** 6 rules run in code: stop, take-profit, trailing stop, max hold, score collapse, liquidity collapse (exits.ts:122-129). The kill switch never blocks exits.
- **Social:** public feed, follows, 7d/30d/all leaderboard (pnl.ts:179), token pages. No fork.

## Numbers for slides
- **10 hard gates** (score.ts:260-321): blocklist, mint authority, freeze authority, honeypot, failed paid sell-check, tax, liquidity, holders, age, top-10 share.
- **5-min exit clock**, and a check before every tick (vercel.json:16-17; guardian.ts:4-7).
- **13 paid x402 sources** plus a Bazaar catch-all (registry.ts:51-66). **3 on by default**: X search $0.006, CMC quotes $0.01, Deepnets safety $0.01 (config.ts:91). $0.001–$0.25 per call.
- **2 chains**: Solana and Base (config.ts:9). The default agent trades Solana only (:92).
- **Weights** (score.ts:50-60): safety 30, liquidity 20, organic 20, distribution 15, momentum 15. When present, GT Score (10, free), sentiment (15, paid) and smart money (10, paid) take weight from those five.
- **Verdicts** (score.ts:85): avoid <40, watch 40–59, candidate 60–79, strong 80+. Thin data caps the score at 79 (:762-766).
- **Defaults** (config.ts): floor 62 (:97), $100 a trade (:111), 10 buys a day (:112), stop 15% (:117), take-profit 40% (:118), $1 of data per run (:116), every 15 min (:135), $15k min liquidity (:98), 30-min min age (:102), asks first (:134). Paper book $10k (schema.ts:209).
- **Fee:** $0.10 flat per fill, settled once $1 is owed (platform/fee.ts:24,27).

## Shipped
- **History:** 269 commits on `main`, 09-10 → 10-03 (GitHub API).
- **Milestones:**
  - 09-10: scaffold (named "Vibe"), run loop, feed, builder.
  - 09-11: privacy/no-fork.
  - 09-13: exit engine, approvals, manual trades, token pages.
  - 09-14: renamed Tocker; paid sources.
  - 09-16: platform-paid data, fee, audit log, kill switch, live wizard, admin.
  - 09-22: web push, Vercel Cron.
  - 09-23: Tocker pays all Solana gas.
  - 09-28: trade by name, admin withdraw, auto-deploy.
  - 10-01 to 10-03: landing rebuilds.
- **Deploy:** on Vercel; pushes to `main` deploy to production (DEPLOY.md:302-305). Domain tocker.xyz (.github/workflows/cron.yml:5). Every fallback-cron run since 09-21 has passed (64 in a row, GitHub Actions API), so production is up.
- **Paper vs live:** paper is the default (actions/agents.ts:162). Live needs a funded wallet, a checklist and a hold-to-confirm (DEPLOY.md:262-298). Live is founder-tested only (run.ts:260-261). The spec says "single-operator today" (SPEC.md:176).
- **Stretch and non-goals:** Privy webhooks are a stretch goal (SPEC.md:35). Non-goals: perps, copy-trading, multi-user agents, mobile apps, fiat onramp, token launching (SPEC.md:242-243).

## Traction
- **None in the repo.** The waitlist captures email, monthly volume (<$10k to $1M+), chains and style into `waitlist_signups` and emails the founder (api/waitlist/route.ts:19-90). The admin dashboard shows a waitlist count (headline-tiles.tsx:216), but no numbers are committed. Vercel Analytics is installed (app/layout.tsx:71).
- **Seed data is not traction:** 6 users, 10 agents and 30 days of seeded demo data (README.md:14). Landing figures are "illustrative samples" (liquid-landing.tsx:404-405).

## Business model and data exposure
- **Revenue:** $0.10 per fill (buy or sell, paper or live). Live fees are swept in batches (fee.ts:11-19). The fee is flat so the platform never wants bigger tickets.
- **Costs:** Tocker pays for all x402 data (paidFetch.ts:13-18) and all Solana gas (SPEC.md:174). Users pay for their own LLM.
- **Exposure (my arithmetic, not stated in the code):**
  - Every sweep buys a SolEnrich launch radar ($0.012) *even if no sources are configured* (tools.ts:262-270; discover.ts:735).
  - Each viable scored token adds Deepnets and X sentiment (enrichment.ts:84-88), with at least 5 scored per tick (limits.ts:17). ≈$0.09/tick ≈ $8.80/day per always-on default agent; ceiling $96/day.
  - Operators can raise the budget to $100 per run (config.ts:61), with no platform-wide cap.
  - Exit passes are free (guardian.ts:13-15).
  - Default fees max ≈ $2/day: data can exceed revenue.

## Public vs private
- **Public:** P&L, equity, win rate, every trade, the one-line rationale, run summaries and data spend.
- **Owner-only:** the prompt, thresholds, which sources the agent buys, the transcript and paid score components (SPEC.md:9-16; server/queries/visibility.ts:29-116).
- **Why no fork:** "A strategy that everyone can copy is worth nothing to the person who wrote it" (SPEC.md:7).

## Voice
- "Your agent trades while you sleep." (hero.tsx:51-53)
- "Follow agents, not tips." (feed.tsx:126)
- "Entry rules never block an exit… A guard that traps you is not a guard." (liquid-landing.tsx:332-335)
- Footer: "Agents that trade 24/7, out in the open." / "Private beta on Solana and Base. Every agent starts on paper." (:385-386)
- Tone: plain, risk-honest; dark, one violet accent.

**Stale docs:** README.md:56 says agents pay for data, DEPLOY.md:7 says there are no crons, and SPEC.md:115 quotes a $0.25 budget.
