/**
 * Live-trading preflight. Run before funding anything:
 *
 *   pnpm preflight
 *
 * Proves, with your real Privy credentials, that (1) the authorization key parses,
 * (2) the server can create an agent wallet it owns, (3) the server can sign for it
 * without a user JWT, (4) balances read, (5) Jupiter Ultra will quote for that
 * wallet, (6) an x402 payment client builds. Creates ONE throwaway Solana wallet
 * named "petri preflight". Never sends a transaction.
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

  // 1. env
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  const authKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim();
  for (const [k, v] of [["NEXT_PUBLIC_PRIVY_APP_ID", appId], ["PRIVY_APP_SECRET", appSecret], ["PRIVY_AUTHORIZATION_PRIVATE_KEY", authKey]] as const) {
    if (v) ok(`${k} set`); else { bad(`${k} missing`); failures++; }
  }
  if (process.env.DEV_IMPERSONATE_USER_ID) warn("DEV_IMPERSONATE_USER_ID is set — remove it, it is ignored once Privy is configured but it hides mistakes");
  if (process.env.LLM_MOCK === "1") warn("LLM_MOCK=1 — the agent will use the scripted model, not your key");
  if (process.env.X402_MOCK !== "0") warn(`X402_MOCK=${process.env.X402_MOCK ?? "(unset → 1)"} — data calls will be simulated; set X402_MOCK=0 for real x402 payments`);
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

  // 3. create a wallet the key owns
  let walletId = "", address = "";
  try {
    const w = await privy.wallets().create({ chain_type: "solana", owner: { public_key: publicKey }, display_name: "petri preflight" });
    walletId = w.id; address = w.address;
    ok(`created Solana wallet ${walletId} → ${address}`);
  } catch (e) {
    bad(`wallet create failed: ${(e as Error).message}`); return finish(failures + 1);
  }

  // 4. sign without a user JWT
  try {
    const r = await privy.wallets().solana().signMessage(walletId, { message: Buffer.from("petri preflight").toString("base64"), authorization_context });
    if (r.signature) ok("server signed a message with the authorization key alone (this is what live trades need)");
    else { bad("signMessage returned no signature"); failures++; }
  } catch (e) {
    bad(`signMessage failed — the key is not accepted as this wallet's owner: ${(e as Error).message}`); failures++;
  }

  // 5. balances
  try {
    const b = await privy.wallets().balance.get(walletId, { chain: "solana", asset: ["usdc", "sol"] });
    ok(`balance read: ${b.balances.map((x) => `${x.asset} ${x.display_values?.usd ?? x.raw_value}`).join(", ") || "empty (new wallet)"}`);
  } catch (e) {
    bad(`balance read failed: ${(e as Error).message}`); failures++;
  }

  // 6. Jupiter quotes for this taker
  try {
    const url = `https://api.jup.ag/ultra/v1/order?inputMint=${USDC}&outputMint=${SOL}&amount=1000000&taker=${address}`;
    const res = await fetch(url, { headers: process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as { requestId?: string; outAmount?: string; transaction?: string | null; error?: string; errorMessage?: string };
    if (body.requestId) ok(`Jupiter Ultra quoted 1 USDC → ${Number(body.outAmount ?? 0) / 1e9} SOL for this wallet (tx ${body.transaction ? "built" : "not built until funded"})`);
    else { bad(`Jupiter Ultra: ${body.error ?? body.errorMessage ?? `HTTP ${res.status}`}`); failures++; }
  } catch (e) {
    bad(`Jupiter unreachable: ${(e as Error).message}`); failures++;
  }

  // 7. x402 client builds
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
  console.log(failures === 0 ? "\nGO — create a new agent in the app; its wallets will be created the same way.\n" : `\nNO-GO — ${failures} check(s) failed. Fix those before funding anything.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
