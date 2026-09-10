/**
 * The one and only place the app pays for data over x402.
 *
 * Flow for a real (non-mock) call:
 *   1. plain `fetch` — if the resource answers 200 it was free, we are done;
 *   2. on 402, parse the price *before* paying (v2 `PAYMENT-REQUIRED` header, or the
 *      v1 JSON body with `accepts[].maxAmountRequired`);
 *   3. check the price against the per-run budget (`risk.maxDataSpendUsdPerRun`);
 *   4. retry through `wrapFetchWithPayment(fetch, x402Client)` — one client per
 *      agent per chain, cached;
 *   5. decode the `PAYMENT-RESPONSE` header and write an `x402_payments` row.
 *
 * With `X402_MOCK=1` (the dev default) nothing is paid: the registry fixture is
 * returned and a `simulated: true` payment row is written at the registry price so
 * the UI, the budget and the run's `dataSpendUsd` all behave exactly as in live mode.
 */
import { nanoid } from "nanoid";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/fetch";
import { getDb, x402Payments } from "@/db";
import {
  chainForNetwork,
  X402BudgetError,
  X402RequestError,
  type AgentWalletRef,
  type PaidRequest,
  type PaidResponse,
  type ParsedPaymentOption,
  type X402Context,
} from "./types";

type WrappedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const clientCache = new Map<string, Promise<WrappedFetch>>();

/** Atomic-unit decimals per known payment asset. Everything else is assumed to be a 6-decimal stablecoin. */
const ASSET_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC on Base
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": 18, // USDC (BSC, 18dp)
  "0xce24439f2d9c6a2289f741120fe202248b666666": 18, // United Stables
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6, // USDC on Polygon
  epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v: 6, // USDC on Solana
};

export function isMockMode(): boolean {
  return process.env.X402_MOCK === "1";
}

function assetDecimals(asset: string): number {
  return ASSET_DECIMALS[asset.toLowerCase()] ?? 6;
}

function toUsd(amount: string, asset: string): number {
  const decimals = assetDecimals(asset);
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** decimals;
}

interface RawRequirement {
  scheme?: unknown;
  network?: unknown;
  asset?: unknown;
  payTo?: unknown;
  amount?: unknown;
  maxAmountRequired?: unknown;
}

function normalizeRequirement(raw: RawRequirement): ParsedPaymentOption | null {
  const scheme = typeof raw.scheme === "string" ? raw.scheme : "exact";
  const network = typeof raw.network === "string" ? raw.network : null;
  const asset = typeof raw.asset === "string" ? raw.asset : "";
  const payTo = typeof raw.payTo === "string" ? raw.payTo : "";
  const amountRaw = raw.amount ?? raw.maxAmountRequired;
  const amount = typeof amountRaw === "string" ? amountRaw : typeof amountRaw === "number" ? String(amountRaw) : null;
  if (!network || !amount) return null;
  return { scheme, network, asset, payTo, amount, amountUsd: toUsd(amount, asset) };
}

/**
 * Reads the payment options out of a 402 response without consuming its body twice.
 * Handles both x402 v2 (base64 `PAYMENT-REQUIRED` header) and v1 (JSON body).
 */
export async function parsePaymentOptions(res: Response): Promise<ParsedPaymentOption[]> {
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      const decoded: PaymentRequired = decodePaymentRequiredHeader(header);
      const options = decoded.accepts
        .map((a) => normalizeRequirement(a as unknown as RawRequirement))
        .filter((o): o is ParsedPaymentOption => o !== null);
      if (options.length > 0) return options;
    } catch {
      // fall through to the body
    }
  }
  try {
    const body: unknown = await res.clone().json();
    if (body && typeof body === "object" && Array.isArray((body as { accepts?: unknown }).accepts)) {
      return ((body as { accepts: RawRequirement[] }).accepts)
        .map(normalizeRequirement)
        .filter((o): o is ParsedPaymentOption => o !== null);
    }
  } catch {
    // not JSON
  }
  return [];
}

/**
 * Picks the option the agent can actually pay: prefer one on the network the
 * registry expects, then any network we hold a wallet for, cheapest first.
 */
export function selectPaymentOption(
  options: ParsedPaymentOption[],
  preferredNetwork: string,
  wallets: AgentWalletRef[],
): ParsedPaymentOption | null {
  const payable = options.filter((o) => {
    const chain = chainForNetwork(o.network);
    return chain !== null && wallets.some((w) => w.chain === chain);
  });
  const pool = payable.length > 0 ? payable : options;
  if (pool.length === 0) return null;
  const exact = pool.filter((o) => o.network === preferredNetwork);
  const ranked = (exact.length > 0 ? exact : pool).slice().sort((a, b) => a.amountUsd - b.amountUsd);
  return ranked[0] ?? null;
}

function walletFor(ctx: X402Context, network: string): AgentWalletRef | null {
  const chain = chainForNetwork(network);
  if (!chain) return null;
  const wallet = ctx.wallets.find((w) => w.chain === chain);
  if (!wallet) return null;
  if (wallet.walletId.startsWith("paper_")) return null;
  return wallet;
}

/** Builds (and caches) a payment-enabled fetch for one agent wallet. */
async function getPaidFetch(agentId: string, wallet: AgentWalletRef): Promise<WrappedFetch> {
  const key = `${agentId}:${wallet.chain}:${wallet.walletId}`;
  const cached = clientCache.get(key);
  if (cached) return cached;
  const created = (async (): Promise<WrappedFetch> => {
    // Dynamic imports: these modules pull in `server-only` / native deps and must not
    // be loaded in mock mode (or from unit tests and CLI scripts).
    const [{ privy, authorizationContext }, { createX402Client }, { wrapFetchWithPayment }] = await Promise.all([
      import("@/lib/privy"),
      import("@privy-io/node/x402"),
      import("@x402/fetch"),
    ]);
    const client = createX402Client(privy(), {
      walletId: wallet.walletId,
      address: wallet.address,
      authorizationContext: authorizationContext(),
    });
    return wrapFetchWithPayment(fetch, client);
  })();
  clientCache.set(key, created);
  created.catch(() => clientCache.delete(key));
  return created;
}

/** Test seam: drops every cached x402 client. */
export function resetX402ClientCache(): void {
  clientCache.clear();
}

async function recordPayment(input: {
  agentId: string;
  runId: string | null;
  sourceId: string;
  url: string;
  network: string;
  amountUsd: number;
  txHash: string | null;
  settled: boolean;
  simulated: boolean;
}): Promise<void> {
  const db = await getDb();
  await db.insert(x402Payments).values({
    id: nanoid(),
    agentId: input.agentId,
    runId: input.runId,
    sourceId: input.sourceId,
    url: input.url,
    network: input.network,
    amountUsd: input.amountUsd.toFixed(6),
    txHash: input.txHash,
    settled: input.settled,
    simulated: input.simulated,
  });
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function buildInit(req: PaidRequest, signal: AbortSignal): RequestInit {
  const method = req.method ?? (req.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { accept: "application/json", ...(req.headers ?? {}) };
  if (req.body !== undefined) headers["content-type"] = "application/json";
  return {
    method,
    headers,
    signal,
    ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
  };
}

/**
 * Fetch a resource, paying with the agent's wallet if the server asks for payment.
 * Throws {@link X402BudgetError} when the call would blow the per-run data budget.
 */
export async function paidFetch(ctx: X402Context, req: PaidRequest): Promise<PaidResponse> {
  const wallet = walletFor(ctx, req.network);
  const simulate = isMockMode() || wallet === null;

  if (simulate) {
    const price = req.priceUsd ?? 0;
    const remaining = ctx.budget.maxUsd - ctx.budget.spentUsd;
    if (price > remaining) throw new X402BudgetError(price, Math.max(0, remaining));
    ctx.budget.spentUsd += price;
    await recordPayment({
      agentId: ctx.agentId,
      runId: ctx.runId,
      sourceId: req.sourceId,
      url: req.url,
      network: req.network,
      amountUsd: price,
      txHash: null,
      settled: true,
      simulated: true,
    });
    return {
      data: req.fixture,
      amountUsd: price,
      network: req.network,
      txHash: null,
      settled: true,
      simulated: true,
      free: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);
  try {
    const probe = await fetch(req.url, buildInit(req, controller.signal));
    if (probe.status !== 402) {
      if (!probe.ok) {
        throw new X402RequestError(`${req.sourceId} responded ${probe.status}`, probe.status);
      }
      return {
        data: await readBody(probe),
        amountUsd: 0,
        network: req.network,
        txHash: null,
        settled: false,
        simulated: false,
        free: true,
      };
    }

    const options = await parsePaymentOptions(probe);
    const option = selectPaymentOption(options, req.network, ctx.wallets);
    if (!option) throw new X402RequestError(`${req.sourceId} returned a 402 we cannot parse or pay`, 402);

    const remaining = ctx.budget.maxUsd - ctx.budget.spentUsd;
    if (option.amountUsd > remaining) throw new X402BudgetError(option.amountUsd, Math.max(0, remaining));

    const payWallet = walletFor(ctx, option.network);
    if (!payWallet) throw new X402RequestError(`No agent wallet for network ${option.network}`, 402);

    const wrapped = await getPaidFetch(ctx.agentId, payWallet);
    const res = await wrapped(req.url, buildInit(req, controller.signal));
    if (!res.ok) throw new X402RequestError(`${req.sourceId} responded ${res.status} after payment`, res.status);

    let txHash: string | null = null;
    let settled = false;
    const responseHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    if (responseHeader) {
      try {
        const decoded = decodePaymentResponseHeader(responseHeader);
        txHash = decoded.transaction || null;
        settled = decoded.success;
      } catch {
        // keep the payment row, just without a tx hash
      }
    }

    ctx.budget.spentUsd += option.amountUsd;
    await recordPayment({
      agentId: ctx.agentId,
      runId: ctx.runId,
      sourceId: req.sourceId,
      url: req.url,
      network: option.network,
      amountUsd: option.amountUsd,
      txHash,
      settled,
      simulated: false,
    });

    return {
      data: await readBody(res),
      amountUsd: option.amountUsd,
      network: option.network,
      txHash,
      settled,
      simulated: false,
      free: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
