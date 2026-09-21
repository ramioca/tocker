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
 *
 * ## Three things W7 changed, all of which only matter in real mode
 *
 * **Two timeouts, not one.** A free probe should give up quickly — it costs nothing and
 * a slow vendor should not eat the run's clock. The paid retry is a different animal: it
 * signs, hands the payload to a facilitator, and waits for an on-chain settlement whose
 * own `maxTimeoutSeconds` the vendors set to 300. Sharing one 10-second budget between
 * the two aborted payments that were already signed. See {@link PROBE_TIMEOUT_MS} and
 * {@link MIN_PAID_TIMEOUT_MS}.
 *
 * **A failed payment still costs money.** `wrapFetchWithPayment` signs, then settles,
 * then retries the request; a failure after the signature can still have moved USDC, and
 * a failure before it can still have burned the resource's rate limit. Either way the
 * model sees a soft `fail` (`tools.ts` turns the throw into one) and is free to call the
 * source again. So once a payload has been created, the amount is charged against
 * `ctx.budget` and written to `x402_payments` with `settled: false` — the run's data cap
 * is a cap on *attempts*, not on successes, and the Platform card's monthly spend stops
 * understating what was actually spent.
 *
 * **Two schemes had to be re-registered.** `@privy-io/node`'s `createX402Client` calls
 * `registerExactSvmScheme(client, { signer })`, and that function drops any scheme
 * options — `new ExactSvmScheme(config.signer)` with no second argument — so the Solana
 * path talks to the public `api.mainnet-beta.solana.com` instead of our Helius RPC, and
 * rate-limits under load. And a resource server may advertise an EIP-712 domain name
 * that does not match the token's own. Both are handled below, in
 * {@link registerVerifiedSchemes} and {@link correctEip712Domains}.
 */
import { nanoid } from "nanoid";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/fetch";
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

/**
 * How long a *free* probe may take. Nothing has been signed at this point, so giving up
 * is free; a vendor that cannot answer an unauthenticated GET in 20 seconds is a vendor
 * this run should move past.
 */
export const PROBE_TIMEOUT_MS = 20_000;

/**
 * The floor under the *paid* retry's timeout. `wrapFetchWithPayment` signs an
 * authorization, posts it, and waits while a facilitator submits and confirms a
 * transaction — every vendor probed for W7 advertises `maxTimeoutSeconds: 300` (30 for
 * CoinMarketCap). Aborting that mid-flight is the one abort that can cost money, so it
 * gets its own, much longer budget. A source may ask for more via
 * `PaidRequest.paidTimeoutMs`; it may not ask for less.
 */
export const MIN_PAID_TIMEOUT_MS = 25_000;

/**
 * EIP-712 domains read from the token contract itself rather than taken from whatever a
 * resource server claims.
 *
 * `@x402/evm` builds the EIP-3009 `TransferWithAuthorization` domain out of
 * `requirements.extra.name` / `.version` — the *server's* words — and signs with it
 * (`chunk-7KWSWAVE.mjs`, both the v1 and v2 schemes). When those disagree with the
 * token's real domain the signature is valid but useless: the facilitator recovers a
 * different signer and refuses with `ErrEip3009TokenNameMismatch`. No money moves, but
 * the call can never succeed, and no amount of retrying changes that.
 *
 * SentimentAlpha advertises `{ name: "USDC" }` for Base USDC. Read on Base mainnet
 * 2026-09-21: `name()` → `"USD Coin"`, `version()` → `"2"`,
 * `DOMAIN_SEPARATOR()` → `0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f`.
 *
 * This table is deliberately tiny and deliberately hand-verified. It is not a guess at
 * what a token is probably called: an asset goes in only after someone has called
 * `name()` on it, because the failure mode of guessing wrong is signing a domain that
 * lets a *different* contract's authorization through.
 */
const VERIFIED_EIP712_DOMAINS: Readonly<Record<string, { name: string; version: string }>> = {
  // USDC on Base (eip155:8453). Verified on-chain 2026-09-21.
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", version: "2" },
};

/**
 * Rewrite the EIP-712 domain on any requirement whose asset we have verified ourselves.
 *
 * Registered as an `x402Client` *policy*, which the client documents as "filter or
 * transform payment requirements" and applies after spend controls and before the
 * selector — so the object returned here is the one handed to the scheme's
 * `createPaymentPayload` (`@x402/core/client/index.mjs`, `selectPaymentRequirements`).
 * That is the last point at which the domain can be corrected without patching the
 * signer.
 *
 * Only EIP-3009 requirements are touched. Permit2 flows sign against the Permit2
 * contract's own domain, not the token's, so rewriting the token name there would be
 * meaningless at best; an explicit `assetTransferMethod` other than `eip3009` is left
 * exactly as the server wrote it.
 *
 * Pure and exported for the test: this is a signing-path change, and it is worth being
 * able to assert that it leaves unknown assets, Permit2 requirements and already-correct
 * servers untouched.
 */
export function correctEip712Domains(_x402Version: number, requirements: PaymentRequirements[]): PaymentRequirements[] {
  return requirements.map((requirement) => {
    const verified = VERIFIED_EIP712_DOMAINS[String(requirement.asset ?? "").toLowerCase()];
    if (!verified) return requirement;

    const extra: Record<string, unknown> = { ...(requirement.extra ?? {}) };
    const method = extra.assetTransferMethod;
    if (method !== undefined && method !== "eip3009") return requirement;
    if (extra.name === verified.name && extra.version === verified.version) return requirement;

    console.warn(
      `[x402] ${requirement.network} ${requirement.asset} advertised EIP-712 domain ` +
        `{ name: ${JSON.stringify(extra.name)}, version: ${JSON.stringify(extra.version)} }; ` +
        `signing with the token's own { name: ${JSON.stringify(verified.name)}, version: ${JSON.stringify(verified.version)} } instead.`,
    );
    return { ...requirement, extra: { ...extra, name: verified.name, version: verified.version } };
  });
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
 * The slice of `x402Client` this module drives. Named rather than cast inline so the
 * three things we do to Privy's client — cap it, re-register the Solana scheme, correct
 * a domain — are visible in one place.
 */
interface PayingClient {
  setSpendControls(controls: { maxAmountPerPayment: string }): unknown;
  register(network: string, scheme: unknown): unknown;
  registerV1(network: string, scheme: unknown): unknown;
  registerPolicy(policy: (x402Version: number, requirements: PaymentRequirements[]) => PaymentRequirements[]): unknown;
  onAfterPaymentCreation(hook: (context: unknown) => Promise<void>): unknown;
}

/**
 * Point the Solana scheme at our own RPC, and keep the v1 scheme alive while doing it.
 *
 * `registerExactSvmScheme` (`@x402/svm/exact/client`) constructs
 * `new ExactSvmScheme(config.signer)` and throws the `schemeOptions` away, so every
 * Solana payload it builds resolves its mint metadata and blockhash through
 * `createRpcClient(network, undefined)` → `https://api.mainnet-beta.solana.com`. The
 * public endpoint rate-limits hard, and a 429 while fetching a blockhash surfaces as an
 * unexplained payment failure. `SOLANA_RPC_URL` is already set in production (Helius).
 *
 * Re-registering replaces the entry for `solana:*` — and `solana` for v1 — rather than
 * adding one, so the v1 scheme has to be re-registered too or a v1 Solana 402 (Plexa and
 * SolEnrich both offer Solana; v1 servers exist) would find no client for its network
 * and throw. `ExactSvmSchemeV1` takes the same `{ rpcUrl }` config.
 *
 * Best-effort: a failure here leaves Privy's own registration in place, which still
 * pays, just over the public RPC. That is strictly better than refusing the call.
 */
async function registerVerifiedSchemes(client: PayingClient, wallet: PayingWallet): Promise<void> {
  if (wallet.chain !== "solana") return;
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) return;
  try {
    const [
      { createSolanaKitSigner },
      { authorizationContext, privy },
      { ExactSvmScheme },
      { ExactSvmSchemeV1 },
      { address },
    ] = await Promise.all([
      import("@privy-io/node/solana-kit"),
      import("@/lib/privy"),
      import("@x402/svm/exact/client"),
      import("@x402/svm/exact/v1/client"),
      import("@solana/kit"),
    ]);
    const signer = createSolanaKitSigner(privy(), {
      walletId: wallet.walletId,
      // `address()` is a base58 assertion, not a conversion: it throws on a malformed
      // address rather than handing the scheme something that fails later, mid-payment.
      address: address(wallet.address),
      authorizationContext: authorizationContext(),
    });
    client.register("solana:*", new ExactSvmScheme(signer, { rpcUrl }));
    client.registerV1("solana", new ExactSvmSchemeV1(signer, { rpcUrl }));
  } catch (err) {
    console.warn(
      "[x402] could not re-register the Solana scheme with SOLANA_RPC_URL; falling back to the public RPC:",
      err instanceof Error ? err.message : err,
    );
  }
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
 *
 * `onPaymentCreated` fires from the client's own `onAfterPaymentCreation` hook — the
 * moment a payload has been signed. Everything that goes wrong after that point is
 * charged to the run's budget, so the caller needs to know which side of the line a
 * failure fell on and cannot infer it from the exception.
 */
async function buildPaidFetch(
  wallet: PayingWallet,
  capUsd: number,
  onPaymentCreated: () => void,
): Promise<WrappedFetch> {
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
  const paying = client as unknown as PayingClient;
  paying.setSpendControls({ maxAmountPerPayment: `$${capUsd.toFixed(6)}` });
  await registerVerifiedSchemes(paying, wallet);
  paying.registerPolicy(correctEip712Domains);
  paying.onAfterPaymentCreation(async () => {
    onPaymentCreated();
  });
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
    // Two clocks. The probe's is short and cheap to lose; the paid retry's is long,
    // because aborting it is the one abort that can leave a signed authorization in
    // flight. `timeoutMs` on the request is the probe's; `paidTimeoutMs` raises (never
    // lowers) the retry's.
    const probeTimeoutMs = req.timeoutMs ?? PROBE_TIMEOUT_MS;
    const paidTimeoutMs = Math.max(MIN_PAID_TIMEOUT_MS, req.paidTimeoutMs ?? 0);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
    let paidTimer: ReturnType<typeof setTimeout> | null = null;
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

      // The probe is done; hand the paid retry its own, longer clock.
      clearTimeout(timeout);
      const paidController = new AbortController();
      paidTimer = setTimeout(() => paidController.abort(), paidTimeoutMs);

      let signed = false;
      const wrapped = await buildPaidFetch(payWallet, capUsd, () => {
        signed = true;
      });

      /**
       * Charge an attempt that got as far as a signature. Called on every failure path
       * below, exactly once, before the throw — a run that retries a flaky source must
       * not be able to re-pay past `maxDataSpendUsdPerRun`, and a payment that may have
       * settled must not be invisible on the Platform card.
       */
      const chargeFailedAttempt = async (): Promise<void> => {
        if (!signed) return;
        ctx.budget.spentUsd += option.amountUsd;
        await recordPayment({
          agentId: ctx.agentId,
          runId: ctx.runId,
          sourceId: req.sourceId,
          url: req.url,
          network: option.network,
          amountUsd: option.amountUsd,
          txHash: null,
          settled: false,
          simulated: false,
        });
      };

      let res: Response;
      try {
        res = await wrapped(req.url, buildInit(req, paidController.signal));
      } catch (err) {
        // `wrapFetchWithPayment` throws when signing or settlement fails — an empty
        // platform wallet lands here, and the message has to name the wallet to top up.
        await chargeFailedAttempt();
        throw payFailure(req.sourceId, payWallet, option.amountUsd, err instanceof Error ? err.message : String(err));
      }
      if (res.status === 402) {
        // Paid and still refused: the facilitator did not see the money.
        await chargeFailedAttempt();
        throw payFailure(req.sourceId, payWallet, option.amountUsd, "the resource still answered 402 after payment");
      }
      if (!res.ok) {
        // The payment settled and the resource then failed on its own terms. The money
        // is gone; the row says so, and the run's budget is decremented accordingly.
        await chargeFailedAttempt();
        throw new X402RequestError(`${req.sourceId} responded ${res.status} after payment`, res.status);
      }

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
      if (paidTimer) clearTimeout(paidTimer);
    }
  });
}
