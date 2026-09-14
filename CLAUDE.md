# Tocker — conventions

Read `SPEC.md` first. `src/db/schema.ts` is the shared contract; add columns/tables freely, never rename without noting it in SPEC.md.

## Commands
- `docker compose up -d` — Postgres on :5433
- `pnpm db:push` — push schema (dev) · `pnpm db:generate` for migrations · `pnpm db:seed`
- `pnpm dev` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`
- `pnpm tick` — local scheduler loop
- Add Spectrum UI: `pnpm dlx shadcn@latest add @spectrumui/<name> -y` (names in `docs/spectrum-catalog.md`). Prefer Spectrum over hand-rolled components for anything animated.

## Rules

- **Strategy privacy.** `AgentDetail.config` is `null` and `RunDetail.steps` is `[]` for anyone who is not the owner. Never build a UI that renders another user's strategy prompt, universe rules, data-source list, or transcript. There is no fork feature; do not reintroduce one.
- **No allowlists.** Agents may trade any token that clears the hard gates and scores above `universe.minScore`. The only list is `universe.blocklist`, which is subtractive.
- Server components by default; `"use client"` only where hooks/motion are needed.
- Mutations are server actions in `src/server/actions/<feature>.ts`, each begins with `const session = await getSession()`.
- Money math with `number` only for display; persist via drizzle `numeric` (strings). Use `src/lib/money.ts` helpers.
- x402 calls only through `src/lib/x402/paidFetch.ts`. Trades only through `src/lib/trading/executor.ts`.
- Secrets never reach the client. LLM keys are decrypted only inside the run loop.
- zod v4 (`import { z } from "zod"`). AI SDK v7 (`generateText`, `tool`, `stepCountIs`).
- Follow `.agents/skills/emil-design-eng` for UI craft; use `tabular-nums` for numbers; dark theme is primary.
- Tests: vitest, colocated `*.test.ts` for pure logic.
- Don't edit files outside your workstream's ownership list without saying so in your final report.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
