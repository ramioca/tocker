/**
 * Ledger against chain, for one agent wallet's pay-per-use thinking.
 *
 *   tsx --env-file-if-exists=.env scripts/inference-audit.ts <agent id | agent slug | wallet address> [--hours 24]
 *
 * Reads the wallet's own USDC account history through `SOLANA_RPC_URL`, picks out every
 * transfer to the pinned gateway, and sets them beside the `inference_payments` rows for
 * that wallet. It prints each difference and the two totals, to the micro-dollar:
 *
 *   on_chain_not_in_ledger            USDC went to the gateway and no row accounts for it
 *   ledger_charged_not_on_chain       a row says paid; no such transfer is in the history
 *   ledger_not_charged_but_on_chain   a row's amount was given back; the chain shows it paid
 *   amount_differs                    a row and its transfer disagree on the amount
 *   open                              a row still `signed` or `unconfirmed` (the cron settles these; one
 *                                     it could not settle in six hours is closed, says so here, and
 *                                     stays counted as charged until the chain is read for it)
 *   unproven                          a row answered and `settled` with no transaction id: the
 *                                     ledger counts it on the gateway's answer alone, so the chain
 *                                     is what says whether it was paid (the cron checks these too)
 *
 * READ-ONLY. It runs SELECTs and RPC reads, signs nothing, sends nothing and changes no
 * row; an admin decides what to do with what it prints. Exit code 0 when the ledger
 * equals the chain, 1 when anything differs, 2 when it could not tell.
 *
 * It reads whatever `DATABASE_URL` points at. With the embedded PGlite file, stop the dev
 * server first: that database is single-process.
 */
import { and, asc, eq, gte, or } from "drizzle-orm";
import { agents, getDb, inferencePayments, wallets } from "@/db";
import { databaseUrl } from "@/db/url";
import { dbErrorForLog } from "@/lib/security/redact";
import {
  compareLedgerWithChain,
  createSolanaChainReader,
  payerTokenAccount,
  readGatewayPayments,
} from "@/lib/x402/inference-reconcile";
import { INFERENCE_GATEWAY } from "@/lib/x402/inference-types";

const HOUR_MS = 3_600_000;
const USAGE = "usage: tsx --env-file-if-exists=.env scripts/inference-audit.ts <agent id | agent slug | wallet address> [--hours 24]";

function usd(units: bigint): string {
  const negative = units < BigInt(0);
  const abs = negative ? -units : units;
  const whole = abs / BigInt(1_000_000);
  const fraction = (abs % BigInt(1_000_000)).toString().padStart(6, "0");
  return `${negative ? "-" : ""}$${whole}.${fraction}`;
}

function parseArgs(argv: string[]): { target: string; hours: number } | null {
  let target: string | null = null;
  let hours = 24;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hours") {
      hours = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--hours=")) {
      hours = Number(arg.slice("--hours=".length));
    } else if (arg.startsWith("-")) {
      return null;
    } else if (target === null) {
      target = arg;
    } else {
      return null;
    }
  }
  if (!target || !Number.isFinite(hours) || hours <= 0 || hours > 24 * 31) return null;
  return { target, hours };
}

/** The Solana wallet to audit: an agent's, found by its id or slug, or the address as given. */
async function resolveWallet(target: string): Promise<{ address: string; label: string } | null> {
  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(or(eq(agents.id, target), eq(agents.slug, target)))
    .limit(1);
  const [wallet] = await db
    .select({ address: wallets.address, agentId: wallets.agentId })
    .from(wallets)
    .where(and(eq(wallets.chain, "solana"), eq(wallets.kind, "agent_server"), agent ? eq(wallets.agentId, agent.id) : eq(wallets.address, target)))
    .limit(1);
  if (wallet) return { address: wallet.address, label: agent ? `agent ${agent.slug}` : `agent ${wallet.agentId ?? "(deleted)"}` };
  if (agent) return null;
  // Not a wallet this database knows. The ledger outlives agents, so an address is still worth auditing.
  return payerTokenAccount(target, INFERENCE_GATEWAY.solana.asset) ? { address: target, label: "a wallet this database has no agent for" } : null;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(USAGE);
    return 2;
  }
  if (process.env.X402_MOCK === "1") {
    console.error("X402_MOCK=1: mock mode pays nothing and reads no chain, so there is nothing to audit. Unset it to audit real payments.");
    return 2;
  }
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) {
    console.error("SOLANA_RPC_URL is not set. The audit reads the chain through your own endpoint only, never a public one.");
    return 2;
  }
  if (databaseUrl()?.startsWith("pglite://") || !databaseUrl()) {
    console.log("! The database is the embedded PGlite file: this is a local ledger, not the deployment's.\n");
  }

  const wallet = await resolveWallet(args.target);
  if (!wallet) {
    console.error(`No Solana agent wallet found for "${args.target}", and it is not a Solana address.`);
    return 2;
  }

  const now = new Date();
  const since = new Date(now.getTime() - args.hours * HOUR_MS);
  // Both sides are read from a little before the window. A payment lands within a
  // minute or two of its row being written, so a pair that straddles the start of the
  // window is still seen whole; a transfer from before the window with no row in hand
  // belongs to an older row and is left out below.
  const edge = new Date(since.getTime() - 10 * 60_000);
  const db = await getDb();
  const rows = await db
    .select({
      id: inferencePayments.id,
      status: inferencePayments.status,
      quotedUsd: inferencePayments.quotedUsd,
      settledUsd: inferencePayments.settledUsd,
      memo: inferencePayments.memo,
      txHash: inferencePayments.txHash,
      resolvedAt: inferencePayments.resolvedAt,
      createdAt: inferencePayments.createdAt,
    })
    .from(inferencePayments)
    .where(and(eq(inferencePayments.payerAddress, wallet.address), eq(inferencePayments.chain, "solana"), gte(inferencePayments.createdAt, edge)))
    .orderBy(asc(inferencePayments.createdAt));

  // A row's own memo finds its payment whatever time the chain put on it.
  const memos = rows.flatMap((row) => (row.memo ? [row.memo] : []));
  const chain = await readGatewayPayments(createSolanaChainReader(rpcUrl), wallet.address, edge, { memos });
  const sinceSec = Math.floor(since.getTime() / 1000);
  const payments = chain.payments.filter(
    (payment) =>
      payment.blockTime === null ||
      payment.blockTime >= sinceSec ||
      rows.some((row) => (row.memo !== null && payment.memoText.includes(row.memo)) || row.txHash === payment.signature),
  );
  const result = compareLedgerWithChain(rows, payments);

  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);

  console.log(`Wallet   ${wallet.address}  (${wallet.label})`);
  console.log(`Gateway  ${INFERENCE_GATEWAY.solana.name}, pay-to ${INFERENCE_GATEWAY.solana.payTo.join(", ")}`);
  console.log(`Window   ${since.toISOString()} to ${now.toISOString()}  (${args.hours} h)`);
  console.log(`Ledger   ${rows.length} rows${rows.length ? `: ${[...byStatus].map(([status, count]) => `${count} ${status}`).join(", ")}` : ""}`);
  console.log(`Chain    ${payments.length} transfers to the gateway, from ${chain.transactionsRead} transactions read`);
  console.log("");
  console.log(`Ledger says charged   ${usd(result.ledgerChargedUnits)}`);
  console.log(`Chain says paid       ${usd(result.chainPaidUnits)}`);
  console.log(`Difference            ${usd(result.chainPaidUnits - result.ledgerChargedUnits)}`);
  console.log("");

  if (result.differences.length === 0) {
    console.log("No differences.");
  } else {
    console.log(`${result.differences.length} difference${result.differences.length === 1 ? "" : "s"}:`);
    for (const difference of result.differences) {
      console.log(`  ${difference.kind.padEnd(32)} row ${difference.rowId ?? "-"}  tx ${difference.signature ?? "-"}`);
      console.log(`  ${"".padEnd(32)} ${difference.detail}`);
    }
  }

  if (!chain.complete) {
    console.log("\n! The wallet's history could not be read completely for this window (the node returned none, it was too long, or the node would not return a transaction).");
    console.log("  What is listed above is real, but absence of a difference is not proven. Try a shorter --hours, or another endpoint if it returned nothing.");
    return 2;
  }
  return result.differences.length === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // A driver's own message is the statement and its parameters, and an RPC client's can
    // carry the endpoint: neither is printed as it came.
    console.error(dbErrorForLog(err));
    process.exit(2);
  });
