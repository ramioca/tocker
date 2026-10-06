import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isPglite } from "@/db";
import { mockDataRequested } from "@/lib/data";
import { authorizeCron } from "@/lib/security/cron";
import { encryptionConfigured } from "@/lib/security/llm-keys";

export const dynamic = "force-dynamic";

/**
 * Liveness, database check, and a live-trading readiness report.
 *
 * Two audiences. **Anyone** (an uptime monitor, the deploy pipeline) gets `ok`,
 * `database`, `embedded` and timing — enough to page someone, nothing more. The
 * **operator**, presenting `Authorization: Bearer $CRON_SECRET`, also gets the
 * configuration report: which secrets are unset, whether mocks or DEV_IMPERSONATE
 * are on, and the database's own error text. That report used to be public, and a
 * map of "which protections are off on this deploy" is reconnaissance, not health.
 *
 * Even the operator's view keeps the rule: **booleans about whether a variable is
 * set, never a value, never a length, never a prefix**. "ENCRYPTION_KEY is
 * configured" tells nobody anything; "ENCRYPTION_KEY starts with xY" would be a
 * gift. Nothing below breaks that rule.
 *
 * `live.ready` answers the one question the deploy checklist actually asks: could
 * this deployment sign a real trade if an agent asked it to?
 */
export async function GET(request: Request) {
  const started = Date.now();
  let database: "ok" | "unreachable" = "unreachable";
  let detail: string | null = null;

  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    database = "ok";
  } catch (e) {
    // The driver's text can name the host, the user and the database. Logged always,
    // returned only to the operator.
    detail = e instanceof Error ? e.message : String(e);
    console.error("[api/health] database check failed", e);
  }

  const embedded = isPglite();
  const isProd = process.env.NODE_ENV === "production";
  // PGlite is a file on the function's ephemeral disk: it "works" and then silently
  // loses every write when the instance recycles. Never let that pass as healthy.
  const ok = database === "ok" && !(isProd && embedded);

  const publicBody = {
    ok,
    database,
    embedded,
    ms: Date.now() - started,
    ...(database === "ok" ? {} : { error: "database unreachable" }),
  };
  // A misconfigured CRON_SECRET (unset/short) is a 503 from `authorizeCron`, which here
  // just means "no operator view" — the public answer is still the honest one.
  if (!authorizeCron(request.headers.get("authorization")).ok) {
    return NextResponse.json(publicBody, { status: ok ? 200 : 503 });
  }

  const mocks = {
    // Match the runtime: `isMockMode()` in paidFetch treats X402_MOCK as mock only
    // when it is exactly "1" (unset ⇒ real payments). Reporting `!== "0"` here would
    // tell the operator payments are simulated while real USDC moves.
    llm: process.env.LLM_MOCK === "1",
    x402: process.env.X402_MOCK === "1",
    tokens: process.env.TOKENS_MOCK === "1",
    // Whether the variable is set, not whether it takes effect: `withMock` ignores it
    // in a production build, and a live project that has it set is still misconfigured.
    data: mockDataRequested(),
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
    /** Real data, real model, real pages, and no auth backdoor. */
    dataPaid: !mocks.x402,
    realModel: !mocks.llm,
    noMockData: !mocks.data,
    noImpersonation: !impersonation,
  };

  const blockers = Object.entries(live)
    .filter(([, value]) => value === false)
    .map(([key]) => key);

  return NextResponse.json(
    {
      ...publicBody,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      // `?? null` does not catch the empty string, and Vercel sets this to "" on a
      // deploy that did not come from a push — so the field read as `""`, which is
      // neither a commit nor an honest "unknown".
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null,
      mocks,
      privyConfigured,
      impersonation,
      live: { ...live, ready: blockers.length === 0, blockers },
      ...(detail === null ? {} : { detail }),
    },
    { status: ok ? 200 : 503 },
  );
}
