import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isPglite } from "@/db";
import { encryptionConfigured } from "@/lib/security/llm-keys";

export const dynamic = "force-dynamic";

/**
 * Liveness, database check, and a live-trading readiness report.
 *
 * Public on purpose (an uptime monitor or the deploy pipeline hits it without
 * credentials), so the rule for what may appear here is strict: **booleans about
 * whether a variable is set, never a value, never a length, never a prefix**.
 * "ENCRYPTION_KEY is configured" tells an attacker nothing they could not learn
 * by watching whether the app works; "ENCRYPTION_KEY starts with xY" would be a
 * gift. Nothing below breaks that rule.
 *
 * `live.ready` answers the one question the deploy checklist actually asks: could
 * this deployment sign a real trade if an agent asked it to?
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unreachable" = "unreachable";
  let error: string | null = null;

  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    database = "ok";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const embedded = isPglite();
  const isProd = process.env.NODE_ENV === "production";
  // PGlite is a file on the function's ephemeral disk: it "works" and then silently
  // loses every write when the instance recycles. Never let that pass as healthy.
  const ok = database === "ok" && !(isProd && embedded);

  const mocks = {
    llm: process.env.LLM_MOCK === "1",
    x402: process.env.X402_MOCK !== "0",
    tokens: process.env.TOKENS_MOCK === "1",
  };

  const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
  const impersonation = Boolean(process.env.DEV_IMPERSONATE_USER_ID);

  /** Every condition the first-live-trade wizard also checks, minus the per-agent ones. */
  const live = {
    database: database === "ok" && !embedded,
    privy: privyConfigured,
    /** Agent wallets are owned by this key; without it the server cannot sign a trade. */
    walletAuthorizationKey: Boolean(process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim()),
    /** 32 raw bytes, base64. LLM keys at rest are unreadable without it. */
    encryptionKey: encryptionConfigured(),
    cronSecret: (process.env.CRON_SECRET?.trim().length ?? 0) >= 32,
    appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
    solanaRpc: Boolean(process.env.SOLANA_RPC_URL?.trim()),
    baseRpc: Boolean(process.env.BASE_RPC_URL?.trim()),
    /** Real data, real model, and no auth backdoor. */
    dataPaid: !mocks.x402,
    realModel: !mocks.llm,
    noImpersonation: !impersonation,
  };

  const blockers = Object.entries(live)
    .filter(([, value]) => value === false)
    .map(([key]) => key);

  return NextResponse.json(
    {
      ok,
      database,
      embedded,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      mocks,
      privyConfigured,
      impersonation,
      live: { ...live, ready: blockers.length === 0, blockers },
      ms: Date.now() - started,
      ...(error === null ? {} : { error }),
    },
    { status: ok ? 200 : 503 },
  );
}
