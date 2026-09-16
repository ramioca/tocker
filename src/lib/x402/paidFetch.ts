/**
 * The one and only place the app pays for data over x402.
 *
 * Flow for a real (non-mock) call:
 *   1. plain `fetch` — if the resource answers 200 it was free, we are done;
 *   2. on 402, parse the price *before* paying (v2 `PAYMENT-REQUIRED` header, or the
 *      v1 JSON body with `accepts[].maxAmountRequired`);
 *   3. check the price against the per-run budget (`risk.maxDataSpendUsdPerRun`);
 *   4. retry through `wrapFetchWithPayment(fetch, x402Client)`, signed by the
 *      **platform** wallet on the resource's network, with a per-payment cap;
 *   5. decode the `PAYMENT-RESPONSE` header and write an `x402_payments` row.
 *
 * ## Who pays (changed in W5)
 *
 * The platform pays for data, not the agent. The signer is the app-owned Privy server
 * wallet for the option's network (`src/lib/platform/wallets.ts`) — Base in practice.
 * An operator funds their agent to *trade*; sentiment and safety data is the platform's
 * cost of goods, recovered through the flat per-fill fee.
 *
 * Everything else about the call is unchanged and still per-agent: the per-run budget
 * (`risk.maxDataSpendUsdPerRun`), the per-payment spend cap, and the `x402_payments`
 * row keyed to the agent and the run. An agent no longer needs a wallet on the data
 * network at all — it needs one to *trade* on a chain, which is a different question.
 *
 * When the platform wallet is missing or cannot pay, the error names the wallet and its
 * address, so the run log says "top up the platform data wallet on base (0x…)" rather
 * than "402".
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
import type { Chain } from "@/server/types";
import {
  chainForNetwork,
  X402BudgetError,
  X402RequestError,
  type PaidRequest,
  type PaidResponse,
  type ParsedPaymentOption,
  type X402Context,
} from "./types";

type WrappedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Paid fetches are serialized per run. The AI SDK can fire several tool calls
 * from one step in parallel, and both the shared per-run budget and each
 * payment's spend cap would otherwise race. Chaining them is also what makes the
 * per-run data cap an actual ceiling rather than a best-effort check.
 */
const runChains = new Map<string, Promise<unknown>>();

function withRunLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = runChains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  runChains.set(
    key,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

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

/** The chains the platform holds wallets on, and therefore the ones a 402 can be paid on. */
const PAYABLE_CHAINS: ReadonlyArray<{ chain: Chain }> = [{ chain: "base" }, { chain: "solana" }];

/**
 * Picks the option we can actually pay: prefer one on the network the registry
 * expects, then any network the payer holds a wallet for, cheapest first.
 *
 * `payable` defaults to the platform's chains, which is the real answer now that the
 * platform signs every payment. It stays a parameter because "which wallets exist" is
 * still the question being asked, and passing a set makes the choice testable without
 * a database — an `AgentWalletRef[]` fits structurally.
 */
export function selectPaymentOption(
  options: ParsedPaymentOption[],
  preferredNetwork: string,
  payable: ReadonlyArray<{ chain: Chain }> = PAYABLE_CHAINS,
): ParsedPaymentOption | null {
  const affordable = options.filter((o) => {
    const chain = chainForNetwork(o.network);
    return chain !== null && payable.some((w) => w.chain === chain);
  });
  const pool = affordable.length > 0 ? affordable : options;
  if (pool.length === 0) return null;
  const exact = pool.filter((o) => o.network === preferredNetwork);
  const ranked = (exact.length > 0 ? exact : pool).slice().sort((a, b) => a.amountUsd - b.amountUsd);
  return ranked[0] ?? null;
}

/** A wallet that can sign an x402 payment. Today, always a platform wallet. */
interface PayingWallet {
  chain: Chain;
  walletId: string;
  address: string;
}

/**
 * The platform wallet that pays a 402 on this network, created on first use.
 *
 * Throws an {@link X402RequestError} that names the wallet: the operator reading a run
 * log needs to know *which* wallet to fund, and "no wallet for eip155:8453" does not
 * tell them that.
 */
async function payingWalletFor(network: string, sourceId: string): Promise<PayingWallet> {
  const chain = chainForNetwork(network);
  if (!chain) {
    throw new X402RequestError(
      `${sourceId} priced its 402 on ${network}, which the platform holds no wallet for (Base and Solana only).`,
      402,
    );
  }
  try {
    const { ensurePlatformWallet } = await import("@/lib/platform/wallets");
    const wallet = await ensurePlatformWallet(chain);
    return { chain, walletId: wallet.walletId, address: wallet.address };
  } catch (err) {
    throw new X402RequestError(
      `${sourceId} needs a payment on ${chain}, but the platform data wallet is unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
      402,
    );
  }
}

/** Anything that went wrong while paying, written so the fix is obvious. */
function payFailure(sourceId: string, wallet: PayingWallet, amountUsd: number, detail: string): X402RequestError {
  const broke = /insufficient|not enough|balance|funds|0x1 |exceeds/i.test(detail);
  return new X402RequestError(
    broke
      ? `Could not pay $${amountUsd.toFixed(4)} for ${sourceId}: the platform data wallet on ${wallet.chain} is out of USDC. Top up the platform data wallet at ${wallet.address}.`
      : `Could not pay $${amountUsd.toFixed(4)} for ${sourceId} from the platform data wallet on ${wallet.chain} (${wallet.address}): ${detail}`,
    402,
  );
}

/**
 * Builds a payment-enabled fetch for one wallet, with a hard per-payment USD cap.
 *
 * The cap is the whole point: `wrapFetchWithPayment` issues its own request and
 * pays whatever *that* 402 demands, so a resource that quotes cheap on the probe
 * and expensive on the paid retry (or an attacker-controlled URL reached through
 * the Bazaar tool) would otherwise drain the wallet. `createPaymentPayload`
 * enforces `maxAmountPerPayment` before signing, so anything above the quote is
 * rejected. A fresh client per call keeps that cap from racing across runs.
 */
async function buildPaidFetch(wallet: PayingWallet, capUsd: number): Promise<WrappedFetch> {
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
  (
    client as unknown as { setSpendControls(controls: { maxAmountPerPayment: string }): unknown }
  ).setSpendControls({ maxAmountPerPayment: `$${capUsd.toFixed(6)}` });
  return wrapFetchWithPayment(fetch, client);
}

/** Test seam: drops the per-run serialization chains. */
export function resetX402ClientCache(): void {
  runChains.clear();
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
 * Fetch a resource, paying from the platform wallet if the server asks for payment.
 * Throws {@link X402BudgetError} when the call would blow the per-run data budget.
 */
export async function paidFetch(ctx: X402Context, req: PaidRequest): Promise<PaidResponse> {
  if (isMockMode()) {
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

  // Live mode. Serialized per run so parallel tool calls cannot race the shared
  // budget or the per-payment cap. The payer is the platform wallet on the resource's
  // network; a missing or empty one is refused at the pay step below with a message
  // that names it — the agent never trades on fixture data.
  return withRunLock(ctx.runId ?? ctx.agentId, async () => {
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
      const option = selectPaymentOption(options, req.network);
      if (!option) throw new X402RequestError(`${req.sourceId} returned a 402 we cannot parse or pay`, 402);

      const remaining = ctx.budget.maxUsd - ctx.budget.spentUsd;
      if (option.amountUsd > remaining) throw new X402BudgetError(option.amountUsd, Math.max(0, remaining));

      // The platform pays. The agent's wallets are not consulted: they are for trading.
      const payWallet = await payingWalletFor(option.network, req.sourceId);

      // Pay at most the quote (+5% slack for rounding). A resource that reprices
      // upward on the paid retry is rejected by the client's spend control.
      const capUsd = Math.max(option.amountUsd * 1.05, 0.000001);
      const wrapped = await buildPaidFetch(payWallet, capUsd);
      let res: Response;
      try {
        res = await wrapped(req.url, buildInit(req, controller.signal));
      } catch (err) {
        // `wrapFetchWithPayment` throws when signing or settlement fails — an empty
        // platform wallet lands here, and the message has to name the wallet to top up.
        throw payFailure(req.sourceId, payWallet, option.amountUsd, err instanceof Error ? err.message : String(err));
      }
      if (res.status === 402) {
        // Paid and still refused: the facilitator did not see the money.
        throw payFailure(req.sourceId, payWallet, option.amountUsd, "the resource still answered 402 after payment");
      }
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
  });
}
