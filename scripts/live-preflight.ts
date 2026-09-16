/**
 * Live-trading preflight. Run before funding anything:
 *
 *   pnpm preflight
 *
 * Proves, with your real credentials, that:
 *   1. every environment variable the live path needs is present and well-formed,
 *   2. the Privy authorization key parses,
 *   3. the server can create an agent wallet it owns,
 *   4. the server can sign for it without a user JWT,
 *   5. balances read,
 *   6. Jupiter Ultra will quote for that wallet,
 *   7. an x402 payment client builds, and
 *   8. the Privy app has at least one MFA method enabled, because Tocker refuses
 *      to put an agent live for an account with no second factor.
 *
 * Creates ONE throwaway Solana wallet named "petri preflight". Never sends a
 * transaction. Exit code 0 = GO, 1 = NO-GO.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { PrivyClient } from "@privy-io/node";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => console.log(`  ✗ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);

async function main() {
  console.log("\nPetri live preflight\n");
  let failures = 0;

  // 1. env — the same set `/api/health` reports as `live.*`.
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim();
  for (const [k, v] of [["NEXT_PUBLIC_PRIVY_APP_ID", appId], ["PRIVY_APP_SECRET", appSecret], ["PRIVY_AUTHORIZATION_PRIVATE_KEY", authKey]] as const) {
    if (v) ok(`${k} set`); else { bad(`${k} missing`); failures++; }
  }

  // ENCRYPTION_KEY has to decode to exactly 32 bytes or every stored LLM key is
  // unreadable — and the failure only shows up when an agent tries to think.
  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    bad("ENCRYPTION_KEY missing — stored LLM keys cannot be decrypted, so no agent can run");
    failures++;
  } else {
    const bytes = Buffer.from(encryptionKey, "base64").length;
    if (bytes === 32) ok("ENCRYPTION_KEY decodes to 32 bytes");
    else { bad(`ENCRYPTION_KEY decodes to ${bytes} bytes, needs 32 — \`openssl rand -base64 32\``); failures++; }
  }

  // CRON_SECRET protects the endpoint that spends the LLM key and can place trades.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    bad("CRON_SECRET missing — /api/cron/tick and /api/cron/marks refuse every request (503) without it");
    failures++;
  } else if (cronSecret.length < 32) {
    bad(`CRON_SECRET is ${cronSecret.length} chars; the cron routes refuse anything under 32 — \`openssl rand -hex 32\``);
    failures++;
  } else ok(`CRON_SECRET set (${cronSecret.length} chars)`);

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) { bad("DATABASE_URL missing"); failures++; }
  else if (dbUrl.startsWith("pglite://")) {
    bad("DATABASE_URL points at embedded PGlite — a file on an ephemeral disk. Every live trade it records is lost when the instance recycles.");
    failures++;
  } else ok("DATABASE_URL is a real Postgres connection string");

  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) warn("NEXT_PUBLIC_APP_URL unset — links in notifications will be relative");
  if (!process.env.SOLANA_RPC_URL?.trim()) warn("SOLANA_RPC_URL unset — the public endpoint is rate-limited and will drop trades");
  if (!process.env.BASE_RPC_URL?.trim()) warn("BASE_RPC_URL unset");
  if (process.env.DEV_IMPERSONATE_USER_ID) {
    bad("DEV_IMPERSONATE_USER_ID is set — remove it. It is ignored once Privy is configured, but it must not exist on a deployment that holds money.");
    failures++;
  }
  if (process.env.LLM_MOCK === "1") { bad("LLM_MOCK=1 — the agent will use the scripted model, not your key"); failures++; }
  if (process.env.X402_MOCK !== "0") { bad(`X402_MOCK=${process.env.X402_MOCK ?? "(unset → 1)"} — data calls return fixtures. Set X402_MOCK=0 before trading real money on them.`); failures++; }
  if (process.env.TOKENS_MOCK === "1") { bad("TOKENS_MOCK=1 — discovery and scoring read local fixtures"); failures++; }

  if (!appId || !appSecret || !authKey) return finish(failures);

  // 2. key parses → public key
  let publicKey: string;
  try {
    const priv = createPrivateKey({ key: Buffer.from(authKey.replace(/^wallet-auth:/, ""), "base64"), format: "der", type: "pkcs8" });
    publicKey = createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64");
    ok(`authorization key parses; public key ${publicKey.slice(0, 24)}… (compare with the dashboard)`);
  } catch (e) {
    bad(`authorization key does not parse as base64 PKCS8 P-256: ${(e as Error).message}`); return finish(failures + 1);
  }

  const privy = new PrivyClient({ appId, appSecret });
  const authorization_context = { authorization_private_keys: [authKey] };

  // 3. MFA must be available in the dashboard, or nobody can ever go live.
  try {
    const settings = await privy.apps().getSettings();
    const methods = settings.mfa_methods ?? [];
    if (methods.length > 0) ok(`Privy app has MFA enabled (${methods.join(", ")}) — operators can enrol a second factor`);
    else {
      bad("Privy app has NO MFA methods enabled. Tocker refuses live mode and withdrawals for an account with no second factor, so nobody could go live.");
      console.log("      Fix: dashboard.privy.io → your app → Authentication → Advanced → Multi-factor authentication → enable TOTP and/or Passkey.");
      failures++;
    }
  } catch (e) {
    bad(`could not read the Privy app settings: ${(e as Error).message}`); failures++;
  }

  // 4. create a wallet the key owns
  let walletId = "", address = "";
  try {
    const w = await privy.wallets().create({ chain_type: "solana", owner: { public_key: publicKey }, display_name: "petri preflight" });
    walletId = w.id; address = w.address;
    ok(`created Solana wallet ${walletId} → ${address}`);
  } catch (e) {
    bad(`wallet create failed: ${(e as Error).message}`); return finish(failures + 1);
  }

  // 5. sign without a user JWT
  try {
    const r = await privy.wallets().solana().signMessage(walletId, { message: Buffer.from("petri preflight").toString("base64"), authorization_context });
    if (r.signature) ok("server signed a message with the authorization key alone (this is what live trades need)");
    else { bad("signMessage returned no signature"); failures++; }
  } catch (e) {
    bad(`signMessage failed — the key is not accepted as this wallet's owner: ${(e as Error).message}`); failures++;
  }

  // 6. balances
  try {
    const b = await privy.wallets().balance.get(walletId, { chain: "solana", asset: ["usdc", "sol"] });
    ok(`balance read: ${b.balances.map((x) => `${x.asset} ${x.display_values?.usd ?? x.raw_value}`).join(", ") || "empty (new wallet)"}`);
  } catch (e) {
    bad(`balance read failed: ${(e as Error).message}`); failures++;
  }

  // 7. Jupiter quotes for this taker
  try {
    const url = `https://api.jup.ag/ultra/v1/order?inputMint=${USDC}&outputMint=${SOL}&amount=1000000&taker=${address}`;
    const res = await fetch(url, { headers: process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { requestId?: string; outAmount?: string; transaction?: string | null; error?: string; errorMessage?: string };
    if (body.requestId) ok(`Jupiter Ultra quoted 1 USDC → ${Number(body.outAmount ?? 0) / 1e9} SOL for this wallet (tx ${body.transaction ? "built" : "not built until funded"})`);
    else { bad(`Jupiter Ultra: ${body.error ?? body.errorMessage ?? `HTTP ${res.status}`}`); failures++; }
  } catch (e) {
    bad(`Jupiter unreachable: ${(e as Error).message}`); failures++;
  }

  // 8. x402 client builds
  try {
    const { createX402Client } = await import("@privy-io/node/x402");
    createX402Client(privy, { walletId, address, authorizationContext: authorization_context });
    ok("x402 payment client builds for this wallet");
  } catch (e) {
    bad(`x402 client failed: ${(e as Error).message}`); failures++;
  }

  console.log(`\nThrowaway wallet: ${address} (you can ignore it, or send it dust to test funding).`);
  return finish(failures);
}

function finish(failures: number) {
  console.log(
    failures === 0
      ? "\nGO — create a new agent in the app, then walk /agents/<slug>/live: it re-checks all of this per agent, plus funding, caps and your own MFA enrolment.\n"
      : `\nNO-GO — ${failures} check(s) failed. Fix those before funding anything.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
