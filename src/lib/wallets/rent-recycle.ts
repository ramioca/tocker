/**
 * Rent recycling: the platform gets back the rent it fronted for agents' token accounts (W8).
 *
 * Since W8 the platform Solana wallet is the rent payer on every token account an agent's
 * sponsored swap opens (Jupiter Ultra's `payer`), about 0.0015 SOL each. Selling a token
 * down to zero leaves its account open and empty, and that rent sits in it for good — an
 * agent that trades fifty launches a week parks a quarter of a SOL of the platform's
 * money in dead accounts. Closing an empty account returns its lamports to whichever
 * address the close names; here that is the platform — and only for accounts whose rent
 * the platform is shown, on chain, to have paid ({@link readRentPayer}).
 *
 * That check is the point. Not every empty account is the platform's rent: a token
 * someone sent the agent opened its account on the sender's SOL, the agent-paid swap
 * fallback opened accounts on the agent's own SOL, and so did every trade before W8. That
 * rent is the owner's, and those accounts are left alone.
 *
 * {@link recycleAgentRent} closes a few of one agent's empty token accounts per call, in
 * one transaction the platform pays for (two signatures) and gains from (the rent), and
 * writes an audit row so the owner can see it. It is maintenance: called from the marks
 * tick, bounded, and it never throws.
 *
 * What is never closed:
 *  - the USDC account (the agent's cash; funding and every sell land there);
 *  - an account with any balance — the token program refuses that anyway, and it is
 *    checked here so the transaction is never built;
 *  - native SOL accounts (wSOL): closing one sends *all* its lamports, wrapped SOL
 *    included, to the destination, so a race with a swap that just wrapped SOL would
 *    move the agent's money to the platform;
 *  - frozen accounts, accounts with a close authority other than the agent, and
 *    Token-2022 accounts with transfer fees withheld (all of which fail to close);
 *  - any mint the agent holds a position in, and every account at all while the agent
 *    has traded in the last {@link RENT_RECYCLE_QUIET_MINUTES} minutes — a buy quoted
 *    against an account that exists would fail if the account were closed under it;
 *  - any account whose rent the platform did not pay, or whose payer cannot be read;
 *  - any account the raw bytes disagree about ({@link rawTokenAccountProblem}): the
 *    listing is `jsonParsed`, so right before signing every account is read again as raw
 *    bytes and checked from them — the mint (never wrapped SOL), the owner, a zero
 *    amount, `isNative` unset, the state, the close authority — and refused if it holds
 *    a single lamport more than its rent-exempt minimum. Closing sends *all* of an
 *    account's lamports to the platform, so an RPC that mislabels a wrapped-SOL account,
 *    or an account someone sent SOL to, must not be able to turn a close into a sweep.
 */
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SIGNATURE_FEE_LAMPORTS } from "./gas";
import { AGENT_TRANSFER_SIGNERS, latestBlockhashWithExpiry, missingSignatures, sameMessage, saneRentLamports } from "./solana-agent-transfer";
import { solanaRpcUrl } from "./solana-rpc";
import { SOLANA_USDC_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./solana-transfer";

/** Accounts one call closes by default — "a few per agent per tick". */
export const RENT_RECYCLE_DEFAULT_MAX_ACCOUNTS = 3;
/** Hard ceiling per transaction, whatever the caller asks: well inside one packet. */
export const RENT_RECYCLE_MAX_ACCOUNTS_PER_TX = 8;
/** No closing while the agent has traded this recently. */
export const RENT_RECYCLE_QUIET_MINUTES = 15;
/** How many of an account's most recent transactions are searched for the one that opened it. */
export const RENT_PAYER_LOOKBACK = 10;
/** An account found not to be the platform's rent is not looked up again for this long. */
const NOT_OURS_TTL_MS = 6 * 60 * 60_000;
/** SPL Token `CloseAccount` — the same discriminant on the legacy program and Token-2022. */
const CLOSE_ACCOUNT = 9;
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Wrapped SOL on the legacy program and on Token-2022. Never closed; see the header. */
const NATIVE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
]);

/**
 * Pure: the most the platform may lose to one recycle transaction — the two signatures.
 * The simulation shows it *gaining* the rent back, so its measured outflow is zero; this
 * bound exists so a transaction that somehow cost more is refused.
 */
export function rentRecycleBudget(): number {
  return AGENT_TRANSFER_SIGNERS * SIGNATURE_FEE_LAMPORTS;
}

export interface TokenAccountSummary {
  address: string;
  /** The token program that owns the account: legacy SPL Token or Token-2022. */
  programId: string;
  mint: string;
  owner: string;
  /** Raw base-unit balance, as the RPC reports it. */
  amount: string;
  state: string;
  isNative: boolean;
  closeAuthority: string | null;
  /** Token-2022 transfer fees withheld in the account; "0" when none. Blocks a close. */
  withheldAmount: string;
  lamports: number;
}

interface ParsedTokenAccount {
  pubkey?: unknown;
  account?: {
    lamports?: unknown;
    owner?: unknown;
    data?: { parsed?: { info?: Record<string, unknown>; type?: unknown } };
  };
}

/**
 * Pure: `getTokenAccountsByOwner` (jsonParsed) → summaries. Rows the RPC could not
 * parse, or that are not token accounts, are dropped — a row we cannot read is a row we
 * do not close.
 */
export function parseTokenAccounts(value: unknown): TokenAccountSummary[] {
  if (!Array.isArray(value)) return [];
  const out: TokenAccountSummary[] = [];
  for (const row of value as ParsedTokenAccount[]) {
    const info = row?.account?.data?.parsed?.info;
    if (!info || row.account?.data?.parsed?.type !== "account") continue;
    const tokenAmount = info.tokenAmount as { amount?: unknown } | undefined;
    const extensions = Array.isArray(info.extensions) ? (info.extensions as Array<Record<string, unknown>>) : [];
    const fee = extensions.find((e) => e?.extension === "transferFeeAmount")?.state as
      | { withheldAmount?: unknown }
      | undefined;
    if (typeof row.pubkey !== "string" || typeof info.mint !== "string" || typeof info.owner !== "string") continue;
    if (typeof tokenAmount?.amount !== "string") continue;
    out.push({
      address: row.pubkey,
      programId: typeof row.account?.owner === "string" ? row.account.owner : "",
      mint: info.mint,
      owner: info.owner,
      amount: tokenAmount.amount,
      state: typeof info.state === "string" ? info.state : "unknown",
      isNative: info.isNative === true,
      closeAuthority: typeof info.closeAuthority === "string" ? info.closeAuthority : null,
      withheldAmount: fee?.withheldAmount === undefined ? "0" : String(fee.withheldAmount),
      lamports: typeof row.account?.lamports === "number" ? row.account.lamports : 0,
    });
  }
  return out;
}

/**
 * Pure: which of an agent's token accounts may be closed right now, most rent first,
 * at most `max` (and never more than {@link RENT_RECYCLE_MAX_ACCOUNTS_PER_TX}). See the
 * header for every rule; `heldMints` are mints the agent's book says it holds.
 */
export function closableTokenAccounts(
  accounts: readonly TokenAccountSummary[],
  input: { owner: string; heldMints?: ReadonlySet<string>; max: number },
): TokenAccountSummary[] {
  const programs = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
  const usdc = SOLANA_USDC_MINT.toBase58();
  const max = Math.max(0, Math.min(Math.floor(input.max), RENT_RECYCLE_MAX_ACCOUNTS_PER_TX));
  return accounts
    .filter(
      (a) =>
        programs.has(a.programId) &&
        a.owner === input.owner &&
        a.mint !== usdc &&
        !a.isNative &&
        !NATIVE_MINTS.has(a.mint) &&
        a.amount === "0" &&
        a.state === "initialized" &&
        (a.closeAuthority === null || a.closeAuthority === input.owner) &&
        a.withheldAmount === "0" &&
        !(input.heldMints?.has(a.mint) ?? false),
    )
    .sort((a, b) => b.lamports - a.lamports)
    .slice(0, max);
}

/** Pure: `CloseAccount` on the account's own token program: rent to `destination`, signed by `authority`. */
export function closeAccountInstruction(input: {
  account: string;
  destination: string;
  authority: string;
  programId: string;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(input.programId),
    keys: [
      { pubkey: new PublicKey(input.account), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.authority), isSigner: true, isWritable: false },
    ],
    // web3.js types this as Buffer; a Uint8Array is what it actually reads.
    data: Uint8Array.from([CLOSE_ACCOUNT]) as unknown as Buffer,
  });
}

/**
 * Pure: the recycle transaction — one `CloseAccount` per account, authority = the agent,
 * rent to the platform, fee payer = the platform. Refuses anything but the two token
 * programs, the platform as the agent, and more accounts than one transaction takes.
 */
export function buildRentRecycleTransaction(input: {
  agent: string;
  feePayer: string;
  accounts: ReadonlyArray<{ address: string; programId: string }>;
  blockhash: string;
}): Uint8Array {
  const programs = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
  if (input.agent === input.feePayer) throw new Error("The platform fee payer cannot be the agent wallet.");
  if (input.accounts.length === 0) throw new Error("Nothing to close.");
  if (input.accounts.length > RENT_RECYCLE_MAX_ACCOUNTS_PER_TX) {
    throw new Error(`At most ${RENT_RECYCLE_MAX_ACCOUNTS_PER_TX} accounts per recycle transaction.`);
  }
  for (const account of input.accounts) {
    if (!programs.has(account.programId)) throw new Error(`${account.address} is not a token account.`);
  }
  const message = new TransactionMessage({
    payerKey: new PublicKey(input.feePayer),
    recentBlockhash: input.blockhash,
    instructions: input.accounts.map((account) =>
      closeAccountInstruction({
        account: account.address,
        destination: input.feePayer,
        authority: input.agent,
        programId: account.programId,
      }),
    ),
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

// ------------------------------------------------------------ the raw bytes

/** Bytes of the SPL token account layout — the whole legacy account, and the head of a Token-2022 one. */
const TOKEN_ACCOUNT_LAYOUT_BYTES = 165;
/** Token-2022's `AccountType` byte, right after the base layout: 2 is an account (1 is a mint). */
const TOKEN_2022_ACCOUNT_TYPE = 2;

/** One account as `getMultipleAccounts` (base64) returns it. */
export interface RawTokenAccount {
  address: string;
  /** The program that owns the account. */
  programId: string;
  lamports: number;
  data: Uint8Array;
}

/**
 * Pure: the band a live rent-exempt minimum for `dataLength` bytes may fall in — 4,000 to
 * 6,960 lamports a byte, the 128-byte account header included (mainnet: 5,080; the
 * long-standing figure: 6,960). An answer outside it is not trusted with a close.
 */
export function rentBandFor(dataLength: number): { min: number; max: number } {
  const bytes = Math.max(0, Math.floor(dataLength)) + 128;
  return { min: bytes * 4_000, max: bytes * 6_960 };
}

/**
 * Pure: why this account, read raw, must not be closed — or null when it may be.
 *
 * Everything is read from the bytes, not from the RPC's parse: the owning program is the
 * one the listing named and a token program; the account is a token account (Token-2022:
 * its account-type byte); its mint is the listed one and not wrapped SOL; its owner is
 * the agent; it holds no tokens; it is initialized (not frozen); `isNative` is unset; any
 * close authority is the agent; and its lamports are no more than `rentMinimumLamports`.
 */
export function rawTokenAccountProblem(
  raw: RawTokenAccount,
  expected: { mint: string; owner: string; programId: string; rentMinimumLamports: number },
): string | null {
  const programs = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
  if (!programs.has(raw.programId) || raw.programId !== expected.programId) return "not owned by the token program it was listed under";
  const d = raw.data;
  if (d.length < TOKEN_ACCOUNT_LAYOUT_BYTES) return "too short to be a token account";
  if (d.length > TOKEN_ACCOUNT_LAYOUT_BYTES && d[TOKEN_ACCOUNT_LAYOUT_BYTES] !== TOKEN_2022_ACCOUNT_TYPE) return "not a token account";
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const key = (at: number) => new PublicKey(d.subarray(at, at + 32)).toBase58();
  const mint = key(0);
  if (NATIVE_MINTS.has(mint)) return "a wrapped-SOL account";
  if (mint !== expected.mint) return "its mint is not the one it was listed with";
  if (key(32) !== expected.owner) return "not the agent's";
  if (view.getBigUint64(64, true) !== BigInt(0)) return "it holds tokens";
  if (d[108] !== 1) return "not an initialized, unfrozen account";
  if (view.getUint32(109, true) !== 0) return "a native (wrapped-SOL) account";
  const closeTag = view.getUint32(129, true);
  if (closeTag > 1) return "its close authority does not parse";
  if (closeTag === 1 && key(133) !== expected.owner) return "someone else can close it";
  if (!(Number.isFinite(raw.lamports) && raw.lamports >= 0)) return "its lamports do not parse";
  if (raw.lamports > expected.rentMinimumLamports) return `it holds ${raw.lamports} lamports, more than its ${expected.rentMinimumLamports} rent`;
  return null;
}

/** Pure: one `getMultipleAccounts` (base64) value → a raw account, or null when it does not exist or does not parse. */
export function parseRawAccount(address: string, value: unknown): RawTokenAccount | null {
  const v = value as { data?: unknown; lamports?: unknown; owner?: unknown } | null | undefined;
  if (!v || typeof v.owner !== "string" || typeof v.lamports !== "number") return null;
  const data = Array.isArray(v.data) && typeof v.data[0] === "string" && v.data[1] === "base64" ? v.data[0] : null;
  if (data === null) return null;
  return { address, programId: v.owner, lamports: v.lamports, data: Uint8Array.from(Buffer.from(data, "base64")) };
}

interface ParsedInstruction {
  programId?: unknown;
  parsed?: { type?: unknown; info?: Record<string, unknown> } | unknown;
}

/**
 * Pure: did this `getTransaction` (jsonParsed) result open `account`, and if so, who paid
 * its rent?
 *
 * "Opened here" is read from the balances: the account held nothing before this
 * transaction and something after. The payer is the `source` of the instruction that
 * created it — an associated-token-account `create`/`createIdempotent` naming it as
 * `account`, or a System `createAccount`/`createAccountWithSeed` naming it as
 * `newAccount` — at the top level or inside another program. `payer: null` when it was
 * opened here but no such instruction says by whom; a failed transaction opens nothing.
 */
export function creationRentPayer(tx: unknown, account: string): { created: boolean; payer: string | null } {
  const none = { created: false, payer: null };
  const t = tx as {
    meta?: { err?: unknown; preBalances?: unknown; postBalances?: unknown; innerInstructions?: unknown } | null;
    transaction?: { message?: { accountKeys?: unknown; instructions?: unknown } };
  } | null;
  if (!t?.meta || t.meta.err) return none;
  const rawKeys = t.transaction?.message?.accountKeys;
  const keys = Array.isArray(rawKeys)
    ? rawKeys.map((k: unknown) =>
        typeof k === "string" ? k : typeof (k as { pubkey?: unknown })?.pubkey === "string" ? (k as { pubkey: string }).pubkey : "",
      )
    : [];
  const index = keys.indexOf(account);
  const pre = t.meta.preBalances;
  const post = t.meta.postBalances;
  if (index < 0 || !Array.isArray(pre) || !Array.isArray(post)) return none;
  if (pre[index] !== 0 || typeof post[index] !== "number" || !(post[index] > 0)) return none;

  const top = Array.isArray(t.transaction?.message?.instructions) ? (t.transaction.message.instructions as ParsedInstruction[]) : [];
  const inner = Array.isArray(t.meta.innerInstructions)
    ? (t.meta.innerInstructions as Array<{ instructions?: unknown }>).flatMap((group) =>
        Array.isArray(group?.instructions) ? (group.instructions as ParsedInstruction[]) : [],
      )
    : [];
  for (const ix of [...top, ...inner]) {
    const parsed = ix?.parsed as { type?: unknown; info?: Record<string, unknown> } | undefined;
    const info = parsed && typeof parsed === "object" ? parsed.info : undefined;
    if (!info || typeof info.source !== "string") continue;
    const type = parsed?.type;
    if (ix.programId === ASSOCIATED_TOKEN_PROGRAM && (type === "create" || type === "createIdempotent") && info.account === account) {
      return { created: true, payer: info.source };
    }
    if (ix.programId === SYSTEM_PROGRAM && (type === "createAccount" || type === "createAccountWithSeed") && info.newAccount === account) {
      return { created: true, payer: info.source };
    }
  }
  return { created: true, payer: null };
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (HTTP ${res.status})`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Solana RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  if (body.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
  return body.result;
}

/**
 * Who paid the rent on a token account as it stands: the payer in the most recent
 * transaction that opened it (an account can be closed and opened again), searched over
 * its last {@link RENT_PAYER_LOOKBACK} transactions. Null when none of those opened it or
 * the opener does not say. Throws when the RPC does not answer — a caller must then
 * leave the account alone.
 */
export async function readRentPayer(account: string): Promise<string | null> {
  const signatures = await rpcCall<Array<{ signature?: unknown; err?: unknown }> | null>("getSignaturesForAddress", [
    account,
    { limit: RENT_PAYER_LOOKBACK, commitment: "confirmed" },
  ]);
  for (const entry of signatures ?? []) {
    if (entry?.err || typeof entry?.signature !== "string") continue;
    const tx = await rpcCall<unknown>("getTransaction", [
      entry.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    const found = creationRentPayer(tx, account);
    if (found.created) return found.payer;
  }
  return null;
}

/** The accounts, read raw in one call; null for one that does not exist or does not parse. */
async function readRawAccounts(addresses: readonly string[]): Promise<Map<string, RawTokenAccount | null>> {
  const result = await rpcCall<{ value?: unknown }>("getMultipleAccounts", [
    [...addresses],
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const values = Array.isArray(result?.value) ? (result.value as unknown[]) : [];
  return new Map(addresses.map((address, i) => [address, parseRawAccount(address, values[i])]));
}

/** The live rent-exempt minimum for `dataLength` bytes, or null when the answer is outside {@link rentBandFor}. */
async function rentMinimumFor(dataLength: number): Promise<number | null> {
  return saneRentLamports(Number(await rpcCall<number>("getMinimumBalanceForRentExemption", [dataLength])), rentBandFor(dataLength));
}

/**
 * The accounts that still pass {@link rawTokenAccountProblem} when read raw, with the raw
 * lamports (what closing them actually returns); the rest are named with the reason.
 */
async function verifiedRaw(
  accounts: readonly TokenAccountSummary[],
  owner: string,
): Promise<{ ok: TokenAccountSummary[]; refused: string[] }> {
  const raw = await readRawAccounts(accounts.map((a) => a.address));
  const rents = new Map<number, number | null>();
  const ok: TokenAccountSummary[] = [];
  const refused: string[] = [];
  for (const account of accounts) {
    const r = raw.get(account.address) ?? null;
    if (!r) {
      refused.push(`${account.address}: no longer readable`);
      continue;
    }
    if (!rents.has(r.data.length)) rents.set(r.data.length, await rentMinimumFor(r.data.length).catch(() => null));
    const rent = rents.get(r.data.length) ?? null;
    if (rent === null) {
      refused.push(`${account.address}: rent for ${r.data.length} bytes unreadable or out of band`);
      continue;
    }
    const problem = rawTokenAccountProblem(r, { mint: account.mint, owner, programId: account.programId, rentMinimumLamports: rent });
    if (problem) refused.push(`${account.address}: ${problem}`);
    else ok.push({ ...account, lamports: r.lamports });
  }
  return { ok, refused };
}

/** Accounts already found not to be the platform's rent, until when. Per process; a cache, not a record. */
const notOurs = new Map<string, number>();

function rememberNotOurs(address: string, now: number): void {
  if (notOurs.size > 5_000) notOurs.clear();
  notOurs.set(address, now + NOT_OURS_TTL_MS);
}

/** Pure: may this agent's accounts be touched now, given its most recent trade? */
export function recycleQuietEnough(lastTradeAt: Date | null, now: Date, quietMinutes = RENT_RECYCLE_QUIET_MINUTES): boolean {
  if (!lastTradeAt) return true;
  return now.getTime() - lastTradeAt.getTime() >= quietMinutes * 60_000;
}

/** Every token account an address owns, under both token programs. */
export async function readTokenAccounts(owner: string): Promise<TokenAccountSummary[]> {
  const read = async (programId: string) => {
    const res = await fetch(solanaRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Solana RPC getTokenAccountsByOwner failed (HTTP ${res.status})`);
    const body = (await res.json()) as { result?: { value?: unknown }; error?: { message?: string } };
    if (body.error) throw new Error(`Solana RPC getTokenAccountsByOwner failed: ${body.error.message ?? "unknown error"}`);
    return parseTokenAccounts(body.result?.value);
  };
  const [legacy, token2022] = await Promise.all([read(TOKEN_PROGRAM_ID.toBase58()), read(TOKEN_2022_PROGRAM_ID.toBase58())]);
  return [...legacy, ...token2022];
}

export interface RentRecycleResult {
  agentId: string;
  /** Accounts closed by a confirmed transaction. */
  closed: number;
  /** Rent those accounts held, now back in the platform wallet. */
  reclaimedLamports: number;
  signature: string | null;
  /** What happened, or why nothing did. Always set. */
  note: string;
}

/**
 * Close up to `maxAccounts` of one live agent's empty token accounts, rent to the
 * platform, in one platform-paid transaction. Never throws; every outcome is a note.
 */
export async function recycleAgentRent(
  agentId: string,
  options: { maxAccounts?: number; now?: Date } = {},
): Promise<RentRecycleResult> {
  const result = (note: string, extra: Partial<RentRecycleResult> = {}): RentRecycleResult => ({
    agentId,
    closed: 0,
    reclaimedLamports: 0,
    signature: null,
    note,
    ...extra,
  });
  const now = options.now ?? new Date();
  const max = options.maxAccounts ?? RENT_RECYCLE_DEFAULT_MAX_ACCOUNTS;
  if (max <= 0) return result("asked to close nothing");

  try {
    const { isPrivyConfigured } = await import("@/lib/privy");
    if (!isPrivyConfigured()) return result("Privy is not configured");

    const { and, desc, eq, gt } = await import("drizzle-orm");
    const { agents, getDb, positions, trades, wallets } = await import("@/db");
    const db = await getDb();
    const [agent] = await db
      .select({ mode: agents.mode, ownerId: agents.ownerId, name: agents.name })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return result("agent not found");
    if (agent.mode !== "live") return result("paper agent — no chain accounts");

    const [wallet] = await db
      .select({ id: wallets.id, address: wallets.address })
      .from(wallets)
      .where(and(eq(wallets.agentId, agentId), eq(wallets.chain, "solana"), eq(wallets.kind, "agent_server")))
      .limit(1);
    if (!wallet || wallet.id.startsWith("paper_")) return result("no real Solana wallet");

    const [lastTrade] = await db
      .select({ createdAt: trades.createdAt })
      .from(trades)
      .where(eq(trades.agentId, agentId))
      .orderBy(desc(trades.createdAt))
      .limit(1);
    if (!recycleQuietEnough(lastTrade?.createdAt ?? null, now)) return result("traded in the last few minutes — next pass");

    const held = await db
      .select({ tokenId: positions.tokenId })
      .from(positions)
      .where(and(eq(positions.agentId, agentId), gt(positions.amountToken, "0")));
    // Token ids are `solana:<mint>`; only the Solana ones can name an account here.
    const heldMints = new Set(held.map((p) => p.tokenId).filter((id) => id.startsWith("solana:")).map((id) => id.slice(7)));

    const { platformFeePayer } = await import("./solana-cosign");
    const platform = await platformFeePayer();
    if (platform.address === wallet.address) return result("the agent wallet is the platform wallet");

    // Every empty account the rules allow, then only those whose rent the platform paid.
    const candidates = closableTokenAccounts(await readTokenAccounts(wallet.address), {
      owner: wallet.address,
      heldMints,
      max: RENT_RECYCLE_MAX_ACCOUNTS_PER_TX,
    });
    if (candidates.length === 0) return result("no empty token accounts");
    const closable: TokenAccountSummary[] = [];
    let notPlatformRent = 0;
    for (const account of candidates) {
      if (closable.length >= Math.min(max, RENT_RECYCLE_MAX_ACCOUNTS_PER_TX)) break;
      if ((notOurs.get(account.address) ?? 0) > Date.now()) {
        notPlatformRent += 1;
        continue;
      }
      // An unreadable payer is not a "no" to remember, just not a "yes" today.
      const payer = await readRentPayer(account.address).catch(() => undefined);
      if (payer === platform.address) {
        closable.push(account);
      } else {
        notPlatformRent += 1;
        if (payer !== undefined) rememberNotOurs(account.address, Date.now());
      }
    }
    if (closable.length === 0) {
      return result(`${notPlatformRent} empty token account(s), none opened on Tocker's rent — left alone`);
    }

    // Read again, raw, right before signing: see `rawTokenAccountProblem`.
    const raw = await verifiedRaw(closable, wallet.address);
    if (raw.refused.length > 0) console.warn(`[rent-recycle] ${agentId}: left alone after the raw read — ${raw.refused.join("; ")}`);
    if (raw.ok.length === 0) return result(`${raw.refused.length} candidate(s) refused on the raw read — left alone`);
    closable.splice(0, closable.length, ...raw.ok);

    const { blockhash } = await latestBlockhashWithExpiry();
    const built = buildRentRecycleTransaction({
      agent: wallet.address,
      feePayer: platform.address,
      accounts: closable,
      blockhash,
    });

    const { sendAndConfirm, signAsServerWallet } = await import("./solana-cosign");
    const { cosignSponsored } = await import("./solana-sponsored");
    const agentSigned = await signAsServerWallet(wallet.id, Buffer.from(built).toString("base64"));
    if (!sameMessage(built, Buffer.from(agentSigned, "base64"))) return result("the agent's signature changed the transaction — not sent");

    // `cosignSponsored` looks twice on an over-budget reading: the platform pays for every
    // agent swap, and one landing between the balance read and the simulation would
    // otherwise read as this recycle costing it that swap.
    const signed = await cosignSponsored({
      transactionBase64: agentSigned,
      maxOutflowLamports: rentRecycleBudget(),
      purpose: "rent recycle",
    });
    const signedBytes = Buffer.from(signed, "base64");
    if (!sameMessage(built, signedBytes) || missingSignatures(signedBytes) !== 0) {
      return result("the co-signed transaction was altered or incomplete — not sent");
    }

    const sent = await sendAndConfirm(signed, 15_000);
    const reclaimed = closable.reduce((sum, a) => sum + a.lamports, 0);
    if (sent.status !== "confirmed") {
      return result(`recycle ${sent.signature} is ${sent.status}`, { signature: sent.signature });
    }
    console.info(
      `[rent-recycle] ${agentId}: closed ${closable.length} empty token account(s), ${reclaimed} lamports back to the platform (${sent.signature})`,
    );
    await auditRecycle({ agentId, ownerId: agent.ownerId, agentName: agent.name, closable, reclaimed, signature: sent.signature });
    return result(`closed ${closable.length} empty token account(s)`, {
      closed: closable.length,
      reclaimedLamports: reclaimed,
      signature: sent.signature,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[rent-recycle] ${agentId}: ${message}`);
    return result(`recycle failed: ${message}`);
  }
}

/**
 * The owner's record of a recycle. Only rent Tocker paid is ever recycled, so nothing of
 * theirs moved — but accounts in their agent's wallet were closed, and they should be
 * able to see that, and why. Recorded as `withdraw` with a `rent_recycle` reason, as the
 * fee sweep is: the audit enum has no closer kind. Never throws.
 */
async function auditRecycle(input: {
  agentId: string;
  ownerId: string;
  agentName: string;
  closable: readonly TokenAccountSummary[];
  reclaimed: number;
  signature: string;
}): Promise<void> {
  try {
    const { recordAudit } = await import("@/lib/security/audit");
    const n = input.closable.length;
    await recordAudit({
      userId: input.ownerId,
      kind: "withdraw",
      agentId: input.agentId,
      agentName: input.agentName,
      summary:
        `Closed ${n} empty token account${n === 1 ? "" : "s"} in ${input.agentName}'s Solana wallet that Tocker had opened for its trades; ` +
        `the ${(input.reclaimed / 1e9).toFixed(6)} SOL of rent Tocker paid for ${n === 1 ? "it" : "them"} went back to Tocker's fee wallet. None of your funds moved.`,
      metadata: {
        reason: "rent_recycle",
        chain: "solana",
        accounts: input.closable.map((a) => ({ address: a.address, mint: a.mint, lamports: a.lamports })),
        reclaimedLamports: input.reclaimed,
        txHash: input.signature,
      },
    });
  } catch {
    // `recordAudit` swallows its own failures; this guards the dynamic import.
  }
}
