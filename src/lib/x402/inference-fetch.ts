/**
 * Pay-per-use thinking: the fetch an agent's model calls, and the only place an agent's
 * own wallet pays for inference. `paidFetch.ts` re-exports the public names, so the rule
 * "x402 only through paidFetch.ts" still has one door with two entries: data (the
 * platform's wallet) and inference (the agent's).
 *
 * ## One step, in order
 *
 *   a. guard     exact URL, POST, a JSON body under 1 MB whose `model` is the agent's,
 *                no stream, `max_tokens` forced, no caller header forwarded.
 *   b. time      nothing starts with less than `SIGN_MIN_REMAINING_MS` before the deadline.
 *   c. quote     one unpaid POST. Retried while free: network error, 429, 5xx.
 *   d. pin       the single `exact` USDC offer to the gateway's pay-to, under the step cap.
 *   e. reserve   `ledger.reserve`, all or nothing. A refusal means nothing is signed.
 *   f. sign      the agent's wallet, under `SIGN_TIMEOUT_MS`.
 *   g. verify    the signed bytes are read back and must be exactly the priced payment;
 *                then `ledger.markSigned` with the memo, blockhash and signature, under
 *                its own short clock; then the run's clock is read once more.
 *   h. pay       one paid POST, on its own clock, never the caller's.
 *   i. resolve   settle, or record that the step was paid for and not answered.
 *
 * Every way out that is not an answer sets `ctx.stop` and throws `InferenceStop`. Once a
 * run has stopped, this fetch refuses every later call, so nothing a caller does after a
 * stop (a retry, a second step) can start another payment.
 *
 * ## Why the x402 fetch wrapper is not used
 *
 * `wrapFetchWithPayment` would do c, f and h for us, and it is what the data path uses.
 * It is not used here because three things it does cannot be allowed on this path:
 *
 *  - it builds one `Request` and clones it, so the caller's abort signal reaches the paid
 *    request, and aborting that request is the one abort that loses a paid-for answer;
 *  - when a response hook reports "recovered" it signs a second payment and sends a
 *    third request, and a scheme may register such a hook without this file changing;
 *  - it sends whatever payload the client returns, including one a failure hook
 *    substituted after our own check threw.
 *
 * So the same client, scheme and header codec are driven directly: `x402Client` selects
 * and signs (the reserve sits in its `onBeforePaymentCreation` hook, where it sees the
 * exact requirement about to be signed), and the two sends are made here, where there is
 * exactly one line that can send a payment.
 *
 * ## What is and is not trusted
 *
 * The gateway's 402 is compared with constants and never obeyed. What the wallet is
 * asked to sign is checked before it is asked, and what will be sent is checked again
 * after, by `verifySignedPayment`.
 *
 * ## What the gateway's word decides once the payment has left
 *
 * Never whether a step counts as charged: from the moment the payment leaves it does,
 * until the chain says otherwise. What the gateway says decides only this:
 *
 *  - An answered step always ends in `ledger.settle`, and the answer goes back to the
 *    model. The gateway's receipt decides one field of that row, the proof. `txHash` is
 *    passed ONLY when a receipt gives a transaction id AND says the settlement
 *    succeeded. In every other answered case (no receipt, a receipt saying it did not
 *    settle, a receipt without an id) `txHash` is `null`. A `settled` row with no
 *    transaction id is a claim, not a fact: the reconciler checks it against the chain,
 *    and it is not counted in public P&L until it has.
 *  - "Gives a transaction id" is not taken on trust either. A Solana transaction's id is
 *    its fee payer's signature over the message, and we hold the message, so an id is
 *    kept only if it is that signature over the bytes we signed
 *    (`isPaymentTransactionId`). Receipts that name two different ids, or that say
 *    settled in one header and not settled in another, give no id.
 *  - An answer another model gave is never returned. If the gateway also says it took
 *    no payment, the row is left `unconfirmed` for the reconciler; otherwise it is
 *    settled under the rule above.
 *  - With no usable answer, a receipt that passes the same test (an id of this payment,
 *    said to have settled) makes the row `paid_no_answer` with that id. Anything less
 *    makes it `unconfirmed`, and the chain decides.
 *
 * What is left on the gateway's word alone is therefore one thing: that a transaction
 * it co-signed, and says it settled, did land. Rows with that id are the only ones the
 * reconciler has no need to look for.
 *
 * These rules were written from documentation: no paid response had been seen when they
 * were. While the switch is at `owner`, each paid response's payment and reroute headers
 * are logged with how they were read (`noteGatewayHeaders`), so the first real ones can
 * be compared with the rules before anyone else is let in.
 *
 * ## What the run can rely on
 *
 *  - `ctx.stop` is set on every stop, and a stopped run stays stopped.
 *  - An abort of the caller's signal is honoured until the payment leaves, and is
 *    reported as the stop `deadline`: the signal is the run's own clock. Once the paid
 *    request has been sent the signal is ignored and the answer, if one comes, is still
 *    returned.
 *  - The last thing before the payment leaves is a look at that clock. The ledger write
 *    before it (`markSigned`) is given `markSignedTimeoutMs` and no longer; if it has
 *    not answered by then, or it answered and the paid request no longer fits before the
 *    deadline, nothing is sent. Such a step can leave a row `signed` (or `reserved`)
 *    with nothing behind it. The reconciler gives both back: no money moved.
 *  - `ctx.spentUsd`, `ctx.requests` and `ctx.maxStepUsd` move when the paid request is
 *    about to leave: the ledger row is `signed` and the last look at the clock passed.
 *    From then the step counts as charged. They do not move for a free answer or for a
 *    step that stopped before that.
 *  - `ctx.maxStepMs` is the longest whole call so far: quote, signature and paid request.
 *  - `ctx.inFlight` is a promise from the reservation until the step's ledger row is
 *    where it will stay, and `null` otherwise. It never rejects. The one exception is a
 *    `markSigned` that did not answer in time: the step does not wait for it, so the run
 *    is not held by a ledger that has stopped answering.
 *  - With `INFERENCE_USDC` off the real path stops with `flag_off` before anything is
 *    sent. Mock mode does not ask: nothing real can happen in it.
 *
 * ## Mock mode (`X402_MOCK=1`)
 *
 * No network, no wallet, no RPC and no Privy are touched, and a paper wallet is fine.
 * `createInferenceFetch` still guards the request and applies every limit, prices the
 * step with `estimateStepUsd`, writes a `simulated` ledger row through
 * `ledger.reserve({ simulated: true })` (then `ledger.settle` on that row, only to fill
 * in the token counts a screen shows), and answers with a canned chat completion, or
 * with the caller's `mockAnswer`. The scripted model (`LLM_MOCK=1`) never calls a fetch,
 * so the run loop calls {@link simulateInferenceStep} once per model step instead: the
 * same limits, the same stops and the same row.
 */
import type { x402Client as X402Client } from "@x402/core/client";
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import type { TransactionPartialSigner } from "@solana/kit";
import { dbErrorForLog, redactSecrets } from "@/lib/security/redact";
import {
  guardInferenceBody,
  isPaymentTransactionId,
  isSolanaAddress,
  pinInferenceRequirement,
  readPaymentRequired,
  verifySignedPayment,
  type PinnedRequirement,
} from "./inference-pins";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  estimateStepUsd,
  HARD_STEP_CAP_USD,
  INFERENCE_GATEWAY,
  INFERENCE_STOPS,
  InferenceStop,
  inferenceFlags,
  isInferenceStopReason,
  MAX_RESPONSE_BYTES,
  PAID_TIMEOUT_MS,
  payPerUseModel,
  QUOTE_RETRIES,
  QUOTE_TIMEOUT_MS,
  roundUsd,
  SIGN_MIN_REMAINING_MS,
  SIGN_TIMEOUT_MS,
  stepCapUsd,
  type InferenceChain,
  type InferencePayContext,
  type InferenceReserveInput,
  type InferenceStopReason,
  type PayPerUseModel,
} from "./inference-types";
import { checkInferenceUrl } from "./url-policy";

// ---------- what a caller may vary ----------

/** The wallet's signing ability, and nothing else of it: it can sign a transaction, not send one. */
export type PaymentSigner = TransactionPartialSigner;

/** The clocks of one step, in milliseconds. Tests shorten them; nothing else should. */
export interface InferenceClocks {
  quoteTimeoutMs: number;
  quoteRetries: number;
  /** The pause before the first retry of an unpaid request; the second waits twice as long. */
  retryDelayMs: number;
  signTimeoutMs: number;
  /**
   * How long the ledger is given to record a signature (`markSigned`), the one wait
   * between the last look at the run's clock and the paid request. Past it nothing is sent.
   */
  markSignedTimeoutMs: number;
  paidTimeoutMs: number;
}

/**
 * A single-row update on a connection the reservation has just used. Three seconds is a
 * ledger in trouble, and a payment should not leave on the word of one.
 */
const MARK_SIGNED_TIMEOUT_MS = 3_000;

export const INFERENCE_CLOCKS: InferenceClocks = {
  quoteTimeoutMs: QUOTE_TIMEOUT_MS,
  quoteRetries: QUOTE_RETRIES,
  retryDelayMs: 500,
  signTimeoutMs: SIGN_TIMEOUT_MS,
  markSignedTimeoutMs: MARK_SIGNED_TIMEOUT_MS,
  paidTimeoutMs: PAID_TIMEOUT_MS,
};

/**
 * What must still be left before the deadline when the paid request leaves: its whole
 * clock, and this much after it for the ledger to record how it ended. Before
 * `markSigned` the same sum is asked for with that write's own clock on top, so a write
 * that answers in time never fails the second look.
 */
const RESOLVE_MARGIN_MS = 2_000;

/** An unpaid request is never held up longer than this by a `Retry-After`. */
const MAX_RETRY_WAIT_MS = 2_000;

/** How much of a gateway's error body is read to explain a refusal. */
const ERROR_BODY_BYTES = 4_000;

export type MockAnswer = (request: { seq: number; body: Record<string, unknown> }) => unknown | Promise<unknown>;

export interface InferenceFetchOptions {
  /**
   * Mock mode only: the chat completion (the JSON an OpenAI-compatible gateway would
   * return) to answer a request with, so a test can script a whole run through the real
   * provider. Ignored outside mock mode.
   */
  mockAnswer?: MockAnswer;
}

/** Everything outside this file a step touches. Production fills it in; tests replace parts. */
export interface InferenceFetchDeps {
  /** The network, for the two requests to the gateway. */
  fetch: typeof fetch;
  /** The agent wallet's signer. Production asks Privy; a test uses a key it made. */
  signerFor(payer: { walletId: string; address: string }): Promise<PaymentSigner>;
  now(): number;
  env: Record<string, string | undefined>;
  clocks: InferenceClocks;
  mockAnswer?: MockAnswer;
}

function isMock(env: Record<string, string | undefined>): boolean {
  return env.X402_MOCK === "1";
}

/**
 * The Privy signer for an agent's Solana wallet, built the way the data path builds the
 * platform's: the app's authorization key signs for a server wallet it owns. Imported
 * on first use, because `@/lib/privy` is `server-only` and must not load in mock mode,
 * in a unit test or in a script.
 */
async function privySigner(payer: { walletId: string; address: string }): Promise<PaymentSigner> {
  const [{ createSolanaKitSigner }, { authorizationContext, privy }, { address }] = await Promise.all([
    import("@privy-io/node/solana-kit"),
    import("@/lib/privy"),
    import("@solana/kit"),
  ]);
  return createSolanaKitSigner(privy(), {
    walletId: payer.walletId,
    // `address()` asserts base58; it throws here instead of failing later, mid-payment.
    address: address(payer.address),
    authorizationContext: authorizationContext(),
  });
}

function productionDeps(options: InferenceFetchOptions = {}): InferenceFetchDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    signerFor: privySigner,
    now: () => Date.now(),
    env: process.env,
    clocks: INFERENCE_CLOCKS,
    ...(options.mockAnswer ? { mockAnswer: options.mockAnswer } : {}),
  };
}

// ---------- text from outside ----------

/** Outside text, made safe to store, log, show or throw: secrets out, one line, short. */
function clean(text: unknown, max = 300): string {
  const raw = typeof text === "string" ? text : String(text);
  return redactSecrets(raw).replace(/\s+/g, " ").trim().slice(0, max);
}

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return clean(err);
  // A database error's own message is the statement and every bound parameter. If one
  // ever reaches this far it is described the way the rest of the app describes them.
  if (/^Failed query:/i.test(err.message)) return dbErrorForLog(err);
  const cause: unknown = (err as { cause?: unknown }).cause;
  const code = isRecord(cause) ? cause.code : undefined;
  return clean(`${err.name}: ${err.message}${typeof code === "string" ? ` (${code})` : ""}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usd(amount: number): string {
  return `$${amount.toFixed(6)}`;
}

// ---------- one run's state ----------

interface RunState {
  /** Requests this run has started. The next one's `seq`. */
  steps: number;
  /** Steps run one at a time: the run cap is read and written between them. */
  tail: Promise<unknown>;
  signing: Promise<SigningClient> | null;
}

/** Keyed by the context, so the fetch and {@link simulateInferenceStep} count the same run. */
const runStates = new WeakMap<InferencePayContext, RunState>();

function runState(ctx: InferencePayContext): RunState {
  let state = runStates.get(ctx);
  if (!state) {
    state = { steps: Math.max(0, Math.floor(ctx.requests)), tail: Promise.resolve(), signing: null };
    runStates.set(ctx, state);
  }
  return state;
}

function inTurn<T>(state: RunState, work: () => Promise<T>): Promise<T> {
  const next = state.tail.then(work);
  state.tail = next.then(
    () => {},
    () => {},
  );
  return next;
}

/**
 * Stop the run: write the reason where the run reads it, and throw it. The x402 client
 * turns an error thrown inside it into a plain `Error`, so the class alone cannot carry
 * the reason out; `ctx.stop` can.
 */
function stopRun(ctx: InferencePayContext, reason: InferenceStopReason, detail: string): never {
  const safe = clean(detail);
  ctx.stop = { reason, detail: safe };
  if (INFERENCE_STOPS[reason] !== "limit") console.warn(`[inference] run ${ctx.runId} stopped: ${reason}: ${safe}`);
  throw new InferenceStop(reason, safe);
}

// ---------- the fetch ----------

/**
 * The fetch to hand an OpenAI-compatible provider for a pay-per-use agent:
 * `createOpenAI({ baseURL, apiKey: "x402", fetch: createInferenceFetch(ctx) }).chat(model)`.
 * Built once per run. Each call is one model step and at most one payment.
 */
export function createInferenceFetch(ctx: InferencePayContext, options: InferenceFetchOptions = {}): typeof fetch {
  return buildInferenceFetch(ctx, productionDeps(options));
}

/** {@link createInferenceFetch} with its surroundings handed in. For tests. */
export function buildInferenceFetch(ctx: InferencePayContext, deps: InferenceFetchDeps): typeof fetch {
  const state = runState(ctx);
  const call = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    inTurn(state, () => runStep(ctx, deps, state, input, init));
  return call as typeof fetch;
}

/** Where a step is, for the one case nobody named: an error that is not a stop. */
interface StepProgress {
  phase: "guard" | "quote" | "sign" | "paid";
  paymentId: string | null;
  /** The ledger row: nothing yet, reserved, marked signed, or resolved. */
  row: "none" | "reserved" | "signed" | "resolved";
  /** Ends `ctx.inFlight`, once this step has a ledger row of its own to finish. */
  settleInFlight: (() => void) | null;
}

async function runStep(
  ctx: InferencePayContext,
  deps: InferenceFetchDeps,
  state: RunState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const startedAt = deps.now();
  const progress: StepProgress = { phase: "guard", paymentId: null, row: "none", settleInFlight: null };
  try {
    return await step(ctx, deps, state, input, init, progress);
  } catch (err) {
    if (err instanceof InferenceStop) throw err;
    // Not a stop anybody named: a bug, or a failure in a place none was expected. The
    // ledger row is left in the state that matches what may have happened, and the run
    // stops under the reason of the phase it was in.
    const detail = `unexpected failure: ${describeError(err)}`;
    if (progress.paymentId && progress.row === "signed") {
      await ledgerWrite("markUnconfirmed", () => ctx.ledger.markUnconfirmed(progress.paymentId as string, { httpStatus: null, detail: clean(detail) }));
      stopRun(ctx, "paid_no_answer", detail);
    }
    if (progress.paymentId && progress.row === "reserved") {
      await ledgerWrite("release", () => ctx.ledger.release(progress.paymentId as string, clean(detail)));
    }
    const byPhase = { guard: "bad_request", quote: "quote_failed", sign: "signature_failed", paid: "paid_no_answer" } as const;
    return stopRun(ctx, byPhase[progress.phase], detail);
  } finally {
    ctx.maxStepMs = Math.max(ctx.maxStepMs, Math.max(0, deps.now() - startedAt));
    // Last of all, after any ledger write above: whoever waits on `ctx.inFlight` is
    // released only when this step's row is where it will stay.
    progress.settleInFlight?.();
  }
}

/**
 * From the reservation on, a step owns a ledger row that must not be left half-way. The
 * run awaits `ctx.inFlight` before it finishes, in case it stopped listening to this
 * fetch (its own clock fired) while the step was still signing, paying, or giving a
 * reservation back. The promise never rejects.
 */
function holdInFlight(ctx: InferencePayContext, progress: StepProgress): void {
  let settle: () => void = () => {};
  const inFlight = new Promise<void>((resolve) => {
    settle = resolve;
  });
  ctx.inFlight = inFlight;
  progress.settleInFlight = () => {
    settle();
    if (ctx.inFlight === inFlight) ctx.inFlight = null;
  };
}

/** A ledger write whose failure must not change what the step does next. Logged, never thrown. */
async function ledgerWrite(name: string, write: () => Promise<void>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    console.error(`[inference] ledger ${name} failed: ${dbErrorForLog(err)}`);
    return false;
  }
}

async function step(
  ctx: InferencePayContext,
  deps: InferenceFetchDeps,
  state: RunState,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  progress: StepProgress,
): Promise<Response> {
  // A run that has stopped stays stopped. Whatever calls again gets the same answer.
  if (ctx.stop) throw new InferenceStop(ctx.stop.reason, ctx.stop.detail);
  const stop: (reason: InferenceStopReason, detail: string) => never = (reason, detail) => stopRun(ctx, reason, detail);
  const gateway = INFERENCE_GATEWAY[ctx.chain];

  // a. Guard. None of the caller's headers is read: the provider adds an Authorization
  // header for a key we do not have, and nothing it could add belongs on this request.
  const request = await readRequest(input, init);
  const badUrl = checkInferenceUrl(request.url, request.method, ctx.chain);
  if (badUrl) stop("bad_request", `not sent: ${badUrl}`);
  const model = payPerUseModel(ctx.model);
  if (!model) stop("model_unavailable", `${ctx.model} is not offered for pay-per-use`);
  if (request.body === null) stop("bad_request", "not sent: the request has no JSON text body");
  const guarded = guardInferenceBody(request.body, ctx.model);
  if (!guarded.ok) stop("bad_request", `not sent: ${guarded.reason}`);
  if (state.steps >= ctx.caps.maxRequestsPerRun) stop("step_limit", `this run has made its ${ctx.caps.maxRequestsPerRun} requests`);
  const seq = state.steps;
  state.steps += 1;

  // b. Time. An abort from the caller is the run's own clock running out.
  const signal = request.signal;
  if (signal?.aborted) stop("deadline", "the run was aborted before anything was sent");
  if (ctx.deadlineAt - deps.now() < SIGN_MIN_REMAINING_MS) stop("deadline", "too little of the run's time is left to pay for another step");

  if (isMock(deps.env)) {
    const body = JSON.parse(guarded.body) as Record<string, unknown>;
    const simulated = await simulateStep(ctx, deps, seq, model, guarded.contentChars, guarded.messages, guarded.requestHash);
    return mockResponse(ctx, deps, seq, body, simulated);
  }

  // The switch, read where a signature could start. With it off nothing leaves the
  // process, whatever let the run get this far.
  if (inferenceFlags(deps.env).stage === "off") stop("flag_off", "INFERENCE_USDC is off");
  // The Solana scheme falls back to the public RPC when it is given none, and a payment
  // built on a rate-limited endpoint fails in ways that look like the wallet's fault.
  const rpcUrl = deps.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) stop("no_rpc", "SOLANA_RPC_URL is not set");
  if (!ctx.payer.walletId || ctx.payer.walletId.startsWith("paper_") || !isSolanaAddress(ctx.payer.address)) {
    stop("no_wallet", "the agent has no real Solana wallet to pay from");
  }

  // c. Quote: the unpaid request. Nothing is signed yet, so everything here is free.
  progress.phase = "quote";
  const quoted = await requestQuote(ctx.deadlineAt, deps, gateway.url, guarded.body, signal);
  if (quoted.kind === "stop") stop(quoted.reason, quoted.detail);
  if (quoted.kind === "answer") {
    // A free answer. Nothing was paid and nothing is recorded, but the rule about which
    // model answered holds whoever paid.
    if (quoted.rerouted) stop("rerouted", `the gateway answered without payment from another model (${quoted.servedModel ?? "unnamed"})`);
    return quoted.response;
  }

  // d. Pin. The 402 is compared with constants; the price with our own estimate.
  const pin = pinInferenceRequirement(quoted.paymentRequired, ctx.payer, ctx.chain);
  if (!pin.ok) stop("pin_mismatch", `nothing signed: ${pin.reason}`);
  const pinned = pin.pinned;
  const quotedUsd = pinned.amountUsd;
  const estimateUsd = estimateStepUsd(model, guarded.contentChars, guarded.messages);
  const capUsd = stepCapUsd(estimateUsd, Math.min(ctx.caps.stepUsd, HARD_STEP_CAP_USD));
  if (quotedUsd > capUsd) {
    stop("step_cap", `the gateway quoted ${usd(quotedUsd)} for a step estimated at ${usd(estimateUsd)}; the most a step may cost is ${usd(capUsd)}`);
  }
  // The ledger holds the run cap too. Checked here first so a run at its limit ends
  // without a reservation to give back.
  if (roundUsd(ctx.spentUsd + quotedUsd) > ctx.caps.runUsd) {
    stop("run_cap", `this step (${usd(quotedUsd)}) would take the run past ${usd(ctx.caps.runUsd)}`);
  }

  // e to g. Reserve, sign, verify.
  progress.phase = "sign";
  holdInFlight(ctx, progress);
  const reserveInput: InferenceReserveInput = {
    ownerId: ctx.ownerId,
    agentId: ctx.agentId,
    runId: ctx.runId,
    seq,
    requestHash: guarded.requestHash,
    chain: ctx.chain,
    network: pinned.network,
    host: gateway.host,
    model: ctx.model,
    payerWalletId: ctx.payer.walletId,
    payerAddress: ctx.payer.address,
    payTo: pinned.payTo,
    asset: pinned.asset,
    quotedUsd,
    caps: ctx.caps,
    runSpentUsd: ctx.spentUsd,
    now: new Date(deps.now()),
  };
  const release = async (detail: string): Promise<void> => {
    if (progress.paymentId === null || progress.row !== "reserved") return;
    // Nothing has left the process, so the reservation is given back. If this write
    // fails the row stays `reserved`, which the reconciler releases on its own.
    if (await ledgerWrite("release", () => ctx.ledger.release(progress.paymentId as string, clean(detail)))) progress.row = "none";
  };

  let client: SigningClient;
  try {
    if (!state.signing) state.signing = buildSigningClient(deps, ctx.payer, rpcUrl, ctx.chain);
    client = await state.signing;
  } catch (err) {
    state.signing = null;
    stop("signature_failed", `the wallet's signer could not be set up: ${describeError(err)}`);
  }

  const signed = await client.sign({
    paymentRequired: quoted.paymentRequired,
    pinned,
    capUsd,
    signal,
    beforeSign: async () => {
      // The last moment before the wallet is asked: the requirement is the pinned one,
      // and nothing has been written or signed.
      if (ctx.deadlineAt - deps.now() < SIGN_MIN_REMAINING_MS) {
        return { reason: "deadline", detail: "too little of the run's time was left once the price was known" };
      }
      let result;
      try {
        result = await ctx.ledger.reserve(reserveInput);
      } catch (err) {
        return { reason: "signature_failed", detail: `nothing signed: the ledger could not reserve the step (${dbErrorForLog(err)})` };
      }
      if (!result.ok) {
        const reason = isInferenceStopReason(result.reason) ? result.reason : "signature_failed";
        return { reason, detail: "nothing signed: the ledger refused the reservation" };
      }
      if (typeof result.paymentId !== "string" || result.paymentId.length === 0) {
        return { reason: "signature_failed", detail: "nothing signed: the ledger reserved the step without naming the payment" };
      }
      progress.paymentId = result.paymentId;
      progress.row = "reserved";
      return null;
    },
  });
  if (!signed.ok) {
    await release(`not signed: ${signed.detail}`);
    stop(signed.reason, signed.detail);
  }
  const paymentId = progress.paymentId;
  if (paymentId === null) stop("signature_failed", "a payment was signed that the ledger never reserved; nothing was sent");

  // Up to here an abort or a short clock costs nothing at all: the row is still
  // `reserved`, so it is simply given back. The clock must cover the ledger write that
  // comes next as well as the paid request.
  if (signal?.aborted) {
    await release("not sent: the run was aborted before the payment left");
    stop("deadline", "the run was aborted before the payment was sent");
  }
  if (ctx.deadlineAt - deps.now() < deps.clocks.paidTimeoutMs + deps.clocks.markSignedTimeoutMs + RESOLVE_MARGIN_MS) {
    await release("not sent: too little time was left for the paid request");
    stop("deadline", "signing took too long to leave time for the paid request; nothing was sent");
  }
  // The one wait between that look at the clock and the paid request. It is not allowed
  // to be an open-ended one: a ledger that stalls here would otherwise let the payment
  // leave whenever it came back, past the run's deadline and with nobody left to read
  // the answer.
  const marking = (async () =>
    ctx.ledger.markSigned(paymentId, {
      memo: signed.check.memo,
      blockhash: signed.check.blockhash,
      payerSignature: signed.check.payerSignature,
    }))();
  const marked = await within(marking, deps.clocks.markSignedTimeoutMs);
  if (marked.how === "failed") {
    // Without a `signed` row a crash after the send would leave a payment nobody looks
    // for. So nothing is sent.
    const detail = `nothing sent: the ledger could not record the signature (${dbErrorForLog(marked.error)})`;
    await release(detail);
    stop("signature_failed", detail);
  }
  if (marked.how === "late") {
    // Nothing is sent, and nothing more is waited for: a second write to a ledger that
    // is not answering would only be a second open-ended wait. The first one may still
    // land. If it does, the row is `signed` with no payment behind it, and the reconciler
    // gives it back once the blockhash has expired. If it fails, the row is still
    // `reserved` and is given back here, or by the reconciler if this process has gone.
    const detail = `nothing sent: the ledger did not record the signature within ${deps.clocks.markSignedTimeoutMs} ms`;
    void marking.then(
      () => console.warn(`[inference] run ${ctx.runId}: payment ${paymentId} was recorded as signed after the step had given up on the ledger; nothing was sent, and the reconciler returns it`),
      () => ledgerWrite("release", () => ctx.ledger.release(paymentId, clean(detail))),
    );
    stop("signature_failed", detail);
  }
  progress.row = "signed";

  // The point of no return is the next request, so the run's clock is read once more,
  // here, with nothing left to wait for between this line and the send. A row that stops
  // here stays `signed`: it cannot be released, because a signature is on record, and it
  // is not marked as a failed payment, because none was made. The reconciler finds no
  // memo on chain, waits out the blockhash and gives the amount back.
  const unsent = signal?.aborted
    ? "the run was aborted while the signature was being recorded"
    : ctx.deadlineAt - deps.now() < deps.clocks.paidTimeoutMs + RESOLVE_MARGIN_MS
      ? "recording the signature left too little time for the paid request"
      : null;
  if (unsent) {
    console.warn(`[inference] run ${ctx.runId}: payment ${paymentId} is signed and was not sent (${unsent}); the reconciler returns it`);
    stop("deadline", `${unsent}; nothing was sent`);
  }
  progress.phase = "paid";

  // From here the step counts as charged, whatever comes back.
  ctx.spentUsd = roundUsd(ctx.spentUsd + quotedUsd);
  ctx.requests += 1;
  ctx.maxStepUsd = Math.max(ctx.maxStepUsd, quotedUsd);

  // h and i. The paid request, and its ledger row.
  return payAndResolve(ctx, deps, gateway.url, guarded.body, { header: signed.header, transaction: signed.transaction }, paymentId, quotedUsd, progress);
}

/** How a wait with a clock on it ended. `late` means the clock won; the work may still finish. */
type Bounded = { how: "done" } | { how: "failed"; error: unknown } | { how: "late" };

function within(work: Promise<unknown>, ms: number): Promise<Bounded> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ how: "late" }), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve({ how: "done" });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ how: "failed", error });
      },
    );
  });
}

// ---------- a: the request as the caller made it ----------

interface CallerRequest {
  url: string;
  method: string;
  /** The body as text, or `null` when there is none or it is not text. */
  body: string | null;
  signal: AbortSignal | null;
}

async function readRequest(input: RequestInfo | URL, init: RequestInit | undefined): Promise<CallerRequest> {
  const fromRequest = typeof input === "object" && input !== null && !(input instanceof URL) ? input : null;
  const url = fromRequest ? fromRequest.url : input instanceof URL ? input.href : String(input);
  const method = (init?.method ?? fromRequest?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? fromRequest?.signal ?? null;
  const raw: unknown = init?.body;
  let body: string | null = null;
  if (typeof raw === "string") body = raw;
  else if (raw instanceof Uint8Array) body = new TextDecoder().decode(raw);
  else if (raw instanceof ArrayBuffer) body = new TextDecoder().decode(new Uint8Array(raw));
  else if ((raw === undefined || raw === null) && fromRequest) {
    try {
      body = await fromRequest.clone().text();
    } catch {
      body = null;
    }
  }
  return { url, method, body: body === "" ? null : body, signal };
}

// ---------- c: the unpaid request ----------

type Quote =
  | { kind: "quote"; paymentRequired: PaymentRequired }
  | { kind: "answer"; response: Response; rerouted: boolean; servedModel: string | null }
  | { kind: "stop"; reason: InferenceStopReason; detail: string };

const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" } as const;

/** A timer and a caller's abort, joined into the one signal a request is given. */
function requestClock(timeoutMs: number, caller: AbortSignal | null): { signal: AbortSignal; timedOut(): boolean; done(): void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (caller?.aborted) controller.abort();
  else caller?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onAbort);
    },
  };
}

function pause(ms: number, caller: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    caller?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * The unpaid POST, retried while it is still free to. Returns the 402's requirements, a
 * free answer, or the reason to stop. `redirect: "manual"` on purpose: the URL was
 * checked, and where it might redirect to was not.
 */
async function requestQuote(
  deadlineAt: number,
  deps: InferenceFetchDeps,
  url: string,
  body: string,
  caller: AbortSignal | null,
): Promise<Quote> {
  let last = "no attempt was made";
  for (let attempt = 0; attempt <= deps.clocks.quoteRetries; attempt += 1) {
    if (caller?.aborted) return { kind: "stop", reason: "deadline", detail: "the run was aborted while the price was being asked" };
    if (attempt > 0 && deadlineAt - deps.now() < SIGN_MIN_REMAINING_MS) {
      return { kind: "stop", reason: "deadline", detail: `too little time was left to ask the price again (${last})` };
    }

    const clock = requestClock(deps.clocks.quoteTimeoutMs, caller);
    let retryAfterMs: number | null = null;
    try {
      const response = await deps.fetch(url, { method: "POST", headers: { ...JSON_HEADERS }, body, redirect: "manual", signal: clock.signal });
      const status = response.status;

      if (status === 402) {
        const header = response.headers.get("payment-required");
        await discard(response);
        const paymentRequired = readPaymentRequired(header);
        // A 402 we cannot read is a gateway asking to be paid in a way we do not know.
        if (!paymentRequired) return { kind: "stop", reason: "pin_mismatch", detail: "nothing signed: the 402 carries no readable payment requirements" };
        return { kind: "quote", paymentRequired };
      }

      if (status >= 200 && status < 300) {
        const answer = await readAnswer(response, clock.signal);
        if (!answer.completion) return { kind: "stop", reason: "gateway_error", detail: `the gateway answered ${status} without payment and without a usable answer (${answer.problem})` };
        const reroute = readReroute(response.headers);
        return { kind: "answer", response: answer.response, rerouted: reroute.rerouted, servedModel: reroute.servedModel };
      }

      const said = await errorText(response, clock.signal);
      last = `HTTP ${status}${said ? `: ${said}` : ""}`;
      if (status === 408 || status === 429 || status >= 500) {
        retryAfterMs = retryAfter(response.headers);
      } else if (status >= 400) {
        return { kind: "stop", reason: "bad_request", detail: `the gateway refused the request before any payment (${last})` };
      } else {
        // A redirect, which is not followed, or a status that is no answer at all.
        return { kind: "stop", reason: "quote_failed", detail: `the gateway did not quote a price (${last})` };
      }
    } catch (err) {
      if (caller?.aborted) return { kind: "stop", reason: "deadline", detail: "the run was aborted while the price was being asked" };
      last = clock.timedOut() ? `no answer within ${deps.clocks.quoteTimeoutMs} ms` : describeError(err);
    } finally {
      clock.done();
    }

    if (attempt < deps.clocks.quoteRetries) {
      const backoff = deps.clocks.retryDelayMs * (attempt + 1);
      await pause(Math.min(retryAfterMs ?? backoff, MAX_RETRY_WAIT_MS), caller);
    }
  }
  return { kind: "stop", reason: "quote_failed", detail: `the gateway did not quote a price (${last})` };
}

function retryAfter(headers: Headers): number | null {
  const seconds = Number(headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}

/**
 * What a gateway's error says, for a log line and a ledger row. Only a machine code and
 * a short message are taken, and only from JSON: the gateway's error bodies also carry
 * a `debug` field with upstream text, which is not ours to keep.
 */
async function errorText(response: Response, signal: AbortSignal): Promise<string> {
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await readCapped(response, ERROR_BODY_BYTES, signal);
  } catch {
    return "";
  }
  if (!bytes || bytes.byteLength === 0) return "";
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(json)) return "";
    const inner = isRecord(json.error) ? json.error : json;
    const code = typeof inner.code === "string" ? inner.code : typeof json.code === "string" ? json.code : "";
    const message = typeof inner.message === "string" ? inner.message : typeof json.error === "string" ? json.error : typeof json.message === "string" ? json.message : "";
    return clean([code, message].filter(Boolean).join(" "), 160);
  } catch {
    return "";
  }
}

// ---------- reading an answer ----------

/**
 * Read a body up to a limit, inside the request's own clock. `null` means the body was
 * larger than the limit and was dropped. A stub's body is not tied to the request's
 * signal the way a real one is, so the signal is watched here as well.
 */
async function readCapped(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new Error("the answer was not read in time");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        return null;
      }
      chunks.push(value);
    }
    // A cancelled reader reports "done", so the signal has the last word.
    if (signal.aborted) throw new Error("the answer was not read in time");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface Completion {
  inputTokens: number | null;
  outputTokens: number | null;
}

/** A chat completion we can hand on: JSON, with a first choice that carries a message. */
function readCompletion(bytes: Uint8Array): Completion | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(json) || !Array.isArray(json.choices) || json.choices.length === 0) return null;
  const first: unknown = json.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const usage = isRecord(json.usage) ? json.usage : {};
  const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
  return { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens) };
}

/**
 * A response's whole body, read and checked, and the same response rebuilt around the
 * bytes so the SDK can read it again. Status, status text and headers are the
 * gateway's; only the headers that described the stream we already consumed are dropped.
 */
async function readAnswer(
  response: Response,
  signal: AbortSignal,
): Promise<{ response: Response; completion: Completion | null; problem: string }> {
  const bytes = await readCapped(response, MAX_RESPONSE_BYTES, signal);
  if (bytes === null) return { response, completion: null, problem: `the answer is over ${MAX_RESPONSE_BYTES} bytes` };
  const completion = readCompletion(bytes);
  const headers = new Headers(response.headers);
  for (const name of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(name);
  const rebuilt = new Response(bytes, { status: response.status, statusText: response.statusText, headers });
  return { response: rebuilt, completion, problem: completion ? "" : "the body is not a chat completion" };
}

/**
 * Did another model answer? The gateway says so in headers. The body's `model` string
 * is not compared: gateways rename models freely, and a rule keyed on a string that
 * merely differs would stop every run.
 */
function readReroute(headers: Headers): { rerouted: boolean; servedModel: string | null } {
  const yes = (name: string) => headers.get(name)?.trim().toLowerCase() === "true";
  const served = headers.get("x-served-model") ?? headers.get("x-fallback-model");
  return {
    // A paid request served from a free model with its settlement skipped is a
    // substitution too, whatever the other two headers say.
    rerouted: yes("x-fallback-used") || yes("x-health-reroute") || skippedSettlement(headers) !== null,
    servedModel: served ? clean(served, 120) : null,
  };
}

/** How a yes-or-no header says no. */
const SAYS_NO: ReadonlySet<string> = new Set(["false", "0", "no"]);

/**
 * `X-Settlement-Skipped`: the gateway served a paid request from a free model and says
 * it took no payment for it. Returns the header's value when it says so, else `null`.
 *
 * It is read by what it says, not by being there. Absent, empty or a plain no is "not
 * skipped": a gateway that starts sending `false` on every ordinary answer must not make
 * every step a paid-for answer thrown away. Any other value is a skip. Only
 * `free-fallback` has been seen, and of the two mistakes, handing the model an answer
 * from a model nobody chose is the worse one.
 */
function skippedSettlement(headers: Headers): string | null {
  const said = headers.get("x-settlement-skipped")?.trim();
  if (said === undefined || said === "" || SAYS_NO.has(said.toLowerCase())) return null;
  // Kept as it was written, for the ledger row: what a real gateway sends here is not yet known.
  return clean(said, 60);
}

/** What the gateway says about the payment itself, reduced to the two things the ledger is told. */
interface Receipt {
  /**
   * The payment's transaction id, and only when the gateway names one, says the
   * settlement succeeded, says nothing to the contrary anywhere else, and the id is
   * this payment's own (see `isPaymentTransactionId`). `null` in every other case.
   */
  txHash: string | null;
  /** The gateway said, in any of its ways, that it did not settle. */
  saysNotSettled: boolean;
}

const NO_RECEIPT: Receipt = { txHash: null, saysNotSettled: false };

/**
 * The gateway speaks about a payment in up to five headers: the x402 receipt under its
 * current and its older name, a bare transaction id, a settled flag and a skipped flag.
 * All of them are read, because a receipt is only as good as its weakest line. An id is
 * kept when a line that names it also says the payment settled, no line says otherwise,
 * every id named is the same one, and that one is the id of `transaction`, the payment
 * as it was sent.
 */
function readReceipt(headers: Headers, transaction: string): Receipt {
  const signatureShaped = (value: unknown) => (typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) ? value : null);
  // Ids are only collected from a line that also says the payment settled.
  const ids = new Set<string>();
  let saysNotSettled = skippedSettlement(headers) !== null;

  for (const name of ["payment-response", "x-payment-response"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    let decoded: unknown;
    try {
      decoded = decodePaymentResponseHeader(raw);
    } catch {
      // An unreadable receipt says nothing.
      continue;
    }
    if (!isRecord(decoded) || typeof decoded.success !== "boolean") continue;
    if (!decoded.success) {
      saysNotSettled = true;
      continue;
    }
    const id = signatureShaped(decoded.transaction);
    if (id) ids.add(id);
  }

  // A bare receipt names the settlement's transaction, which is the gateway saying there was one.
  const bare = signatureShaped(headers.get("x-payment-receipt")?.trim());
  if (bare) ids.add(bare);

  const flag = headers.get("x-payment-settled")?.trim().toLowerCase();
  if (flag !== undefined && SAYS_NO.has(flag)) saysNotSettled = true;

  const [id] = ids;
  const proven = !saysNotSettled && ids.size === 1 && id !== undefined && isPaymentTransactionId({ transaction, txId: id });
  return { txHash: proven ? id : null, saysNotSettled };
}

/** Every header the rules above read, and the two beside them a gateway is known to send. */
const GATEWAY_HEADERS = [
  "payment-response",
  "x-payment-response",
  "x-payment-receipt",
  "x-payment-settled",
  "x-settlement-skipped",
  "x-fallback-used",
  "x-fallback-model",
  "x-health-reroute",
  "x-served-model",
  "x-original-model",
] as const;

/**
 * Owner-only stage: write down what the gateway really sent with a paid response, and
 * how it was read. The rules that read these headers were written from documentation
 * and have never seen a paid answer, so the first real ones are recorded before the
 * switch goes to `on`. One log line: names and short, cleaned values. An x402 receipt
 * is shown decoded, as the two fields the rules read; everything in it is public.
 */
function noteGatewayHeaders(runId: string, status: number, headers: Headers, receipt: Receipt): void {
  const shown = (name: string, value: string): string => {
    if (!name.endsWith("payment-response")) return JSON.stringify(clean(value, 100));
    try {
      const decoded: unknown = decodePaymentResponseHeader(value);
      if (isRecord(decoded)) return `{success: ${clean(String(decoded.success), 12)}, transaction: ${JSON.stringify(clean(String(decoded.transaction ?? ""), 100))}}`;
    } catch {
      // Shown as unreadable below.
    }
    return `(unreadable, ${value.length} chars)`;
  };
  const said = GATEWAY_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value === null ? [] : [`${name}=${shown(name, value)}`];
  });
  const read = receipt.txHash ? "this payment's transaction id, settled" : receipt.saysNotSettled ? "not settled" : "no proof of settlement";
  console.info(`[inference] run ${runId}: paid response ${status} said ${said.length > 0 ? said.join(" ") : "nothing about the payment or the model"}; read as ${read}`);
}

// ---------- e to g: reserve, sign, verify ----------

interface SigningRequest {
  paymentRequired: PaymentRequired;
  pinned: PinnedRequirement;
  capUsd: number;
  /** The caller's abort. Honoured until a payload is returned, and not after. */
  signal: AbortSignal | null;
  /**
   * Runs inside the client's `onBeforePaymentCreation` hook, once it has chosen the
   * pinned requirement and before the wallet is asked. A reason returned here means
   * nothing is signed.
   */
  beforeSign(): Promise<{ reason: InferenceStopReason; detail: string } | null>;
}

type SigningResult =
  | {
      ok: true;
      /** The `PAYMENT-SIGNATURE` header value: the payload that was checked, encoded. */
      header: string;
      /** The transaction inside that payload, base64: what a receipt's transaction id is checked against. */
      transaction: string;
      check: { memo: string; blockhash: string; payerSignature: string | null; feePayer: string };
      signMs: number;
    }
  | { ok: false; reason: InferenceStopReason; detail: string };

interface SigningClient {
  sign(request: SigningRequest): Promise<SigningResult>;
}

interface SigningAttempt {
  request: SigningRequest;
  /** False once we have stopped waiting. A wallet answer that arrives later is dropped. */
  open: boolean;
  hookRan: boolean;
  /** Resolves when the hook has finished, so a reservation made in it is never lost track of. */
  hookDone: Promise<void>;
  /** `beforeSign` passed: the wallet may be asked. */
  cleared: boolean;
  asked: boolean;
  /** Why the attempt was refused from inside the client, where a thrown class would be flattened. */
  refusal: { reason: InferenceStopReason; detail: string } | null;
  startTimer(): void;
}

const SIGN_TIMED_OUT = Symbol("sign timed out");
const CALLER_ABORTED = Symbol("caller aborted");

function sameRequirement(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The x402 client for one wallet, built by hand.
 *
 * Privy's own helper registers `exact` on every EVM and every Solana network, plus the
 * version 1 names. Here one scheme is registered on one network, so `upto`,
 * `batch-settlement`, version 1 and every other chain are not something this client can
 * pay even if asked. The scheme is given `SOLANA_RPC_URL` for the reason the data path
 * re-registers it: without one it reads the mint through the public endpoint.
 *
 * The signer the scheme holds is a wrapper with one ability, `signTransactions`. It
 * checks the transaction against the pins before the wallet sees it, asks the wallet
 * once, and hands back the agent's signature and no other. The wallet's ability to
 * sign *and send* is not reachable through it.
 */
async function buildSigningClient(
  deps: InferenceFetchDeps,
  payer: { walletId: string; address: string },
  rpcUrl: string,
  chain: InferenceChain,
): Promise<SigningClient> {
  const gateway = INFERENCE_GATEWAY[chain];
  const [{ x402Client }, { ExactSvmScheme }, { getBase64EncodedWireTransaction }, wallet] = await Promise.all([
    import("@x402/core/client"),
    import("@x402/svm/exact/client"),
    import("@solana/kit"),
    deps.signerFor(payer),
  ]);
  if (wallet.address !== payer.address) throw new Error("the signer is for a different wallet");

  let current: SigningAttempt | null = null;

  const guarded: PaymentSigner = {
    address: wallet.address,
    async signTransactions(transactions) {
      const attempt = current;
      if (!attempt || !attempt.open || !attempt.cleared) throw new Error("no payment is cleared to be signed");
      if (attempt.asked) throw new Error("a second signature was asked for in one step");
      if (transactions.length !== 1) throw new Error("a payment is exactly one transaction");
      // Before the wallet is asked: the bytes it would sign must be the priced payment.
      const unsigned = verifySignedPayment({
        transaction: getBase64EncodedWireTransaction(transactions[0]),
        payer: payer.address,
        pinned: attempt.request.pinned,
        requireSignature: false,
        chain,
      });
      if (!unsigned.ok) {
        attempt.refusal = { reason: "pin_mismatch", detail: `nothing signed: ${unsigned.reason}` };
        throw new Error("the transaction is not the priced payment");
      }
      attempt.asked = true;
      const [signatures] = await wallet.signTransactions([transactions[0]]);
      const signature = signatures?.[wallet.address];
      if (!signature) throw new Error("the wallet returned no signature for its own address");
      // The agent's signature and nothing else: a dictionary is merged into the
      // transaction as it stands, and no other slot is this wallet's to fill.
      return [Object.freeze({ [wallet.address]: signature })] as Awaited<ReturnType<PaymentSigner["signTransactions"]>>;
    },
  };

  const client: X402Client = new x402Client();
  client.register(gateway.network, new ExactSvmScheme(guarded, { rpcUrl }));
  // Whatever the client is handed, only the requirement pinned for this step survives.
  client.registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => current !== null && sameRequirement(requirement, current.request.pinned.requirement)),
  );
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const attempt = current;
    if (!attempt || !attempt.open) return { abort: true, reason: "no payment is being signed" };
    const refuse = (reason: InferenceStopReason, detail: string) => {
      attempt.refusal = { reason, detail };
      return { abort: true as const, reason };
    };
    // One payment per step. A second creation would be a second signature.
    if (attempt.hookRan) return refuse("pin_mismatch", "nothing signed: the payment client tried to create a second payment in one step");
    attempt.hookRan = true;
    let finished: () => void = () => {};
    attempt.hookDone = new Promise<void>((resolve) => {
      finished = resolve;
    });
    try {
      if (!sameRequirement(selectedRequirements, attempt.request.pinned.requirement)) {
        return refuse("pin_mismatch", "nothing signed: the payment client chose a requirement other than the pinned one");
      }
      let refusal: { reason: InferenceStopReason; detail: string } | null;
      try {
        refusal = await attempt.request.beforeSign();
      } catch (err) {
        refusal = { reason: "signature_failed", detail: `nothing signed: ${describeError(err)}` };
      }
      if (refusal) return refuse(refusal.reason, refusal.detail);
      // The caller may have given up while the ledger was writing.
      if (!attempt.open) return { abort: true, reason: "the step was abandoned" };
      attempt.cleared = true;
      attempt.startTimer();
      return undefined;
    } finally {
      finished();
    }
  });

  return {
    async sign(request) {
      if (current) return { ok: false, reason: "signature_failed", detail: "nothing signed: another payment is still being signed" };

      if (request.signal?.aborted) return { ok: false, reason: "deadline", detail: "the run was aborted before the payment was signed" };

      const clock: { timer: ReturnType<typeof setTimeout> | null } = { timer: null };
      let timeOut: (reason: unknown) => void = () => {};
      const timedOut = new Promise<never>((_, reject) => {
        timeOut = reject;
      });
      let abort: (reason: unknown) => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        abort = reject;
      });
      const onAbort = () => abort(CALLER_ABORTED);
      // The losers of the race below reject with nobody listening. That is expected.
      timedOut.catch(() => {});
      aborted.catch(() => {});

      const attempt: SigningAttempt = {
        request,
        open: true,
        hookRan: false,
        hookDone: Promise.resolve(),
        cleared: false,
        asked: false,
        refusal: null,
        // The signing clock starts when the ledger has said yes, so a slow reservation
        // does not eat the wallet's ten seconds.
        startTimer: () => {
          clock.timer = setTimeout(() => timeOut(SIGN_TIMED_OUT), deps.clocks.signTimeoutMs);
        },
      };
      current = attempt;
      const startedAt = deps.now();
      request.signal?.addEventListener("abort", onAbort, { once: true });

      // The client's own limits, behind ours: the step cap in dollars and in USDC's units.
      const capAtomic = Math.floor(request.capUsd * 10 ** gateway.decimals + 1e-6);
      client.setSpendControls({
        maxAmountPerPayment: `$${request.capUsd.toFixed(6)}`,
        allowedAssets: [{ network: gateway.network, asset: gateway.asset, maxAmountPerPayment: String(capAtomic) }],
      });

      try {
        // Only the pinned requirement is offered to the client; the rest of the 402
        // travels with it because the gateway expects its own words echoed back.
        const creating = client.createPaymentPayload({ ...request.paymentRequired, accepts: [request.pinned.requirement] });
        // If we stop waiting, a late answer or a late failure has no listener. Give it one.
        creating.catch(() => {});
        const payload = await Promise.race([creating, timedOut, aborted]);
        attempt.open = false;
        return checkPayload(payload, attempt, payer.address, chain, deps.now() - startedAt);
      } catch (err) {
        attempt.open = false;
        // A reservation may be on its way in the hook. Wait for it, so the caller that
        // is told "not signed" also knows which row to give back.
        await attempt.hookDone;
        if (attempt.refusal) return { ok: false, ...attempt.refusal };
        if (err === SIGN_TIMED_OUT) {
          return { ok: false, reason: "signature_failed", detail: `the wallet did not sign within ${deps.clocks.signTimeoutMs} ms; nothing was sent` };
        }
        if (err === CALLER_ABORTED) return { ok: false, reason: "deadline", detail: "the run was aborted before the payment was signed" };
        if (!attempt.hookRan) {
          return { ok: false, reason: "pin_mismatch", detail: `nothing signed: the payment client would not take the pinned requirement (${describeError(err)})` };
        }
        return { ok: false, reason: "signature_failed", detail: `the wallet did not sign: ${describeError(err)}` };
      } finally {
        attempt.open = false;
        current = null;
        if (clock.timer) clearTimeout(clock.timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/**
 * g. The payload the client returned, checked as the thing that will be sent. Not as
 * the thing we asked for: the client can return a payload other than the one its scheme
 * built, and this is the last look before it leaves.
 */
function checkPayload(payload: PaymentPayload, attempt: SigningAttempt, payer: string, chain: InferenceChain, signMs: number): SigningResult {
  const pinned = attempt.request.pinned;
  const inner: unknown = isRecord(payload) ? payload.payload : undefined;
  const transaction = isRecord(inner) ? inner.transaction : undefined;
  if (
    !isRecord(payload) ||
    payload.x402Version !== 2 ||
    !sameRequirement(payload.accepted, pinned.requirement) ||
    !isRecord(inner) ||
    Object.keys(inner).length !== 1 ||
    typeof transaction !== "string"
  ) {
    return { ok: false, reason: "pin_mismatch", detail: "nothing sent: the payment payload is not the one that was priced" };
  }
  if (!attempt.asked) return { ok: false, reason: "pin_mismatch", detail: "nothing sent: a payment came back that this wallet was never asked to sign" };
  const check = verifySignedPayment({ transaction, payer, pinned, chain });
  if (!check.ok) {
    // A missing or wrong signature is the wallet failing; anything else is a transaction
    // that is not the payment we priced.
    return { ok: false, reason: check.signature ? "signature_failed" : "pin_mismatch", detail: `nothing sent: ${check.reason}` };
  }
  return {
    ok: true,
    header: encodePaymentSignatureHeader(payload),
    transaction,
    check: { memo: check.memo, blockhash: check.blockhash, payerSignature: check.payerSignature, feePayer: check.feePayer },
    signMs,
  };
}

// ---------- h and i: the paid request and its row ----------

/**
 * The one line in this file that sends a payment, and what is made of the answer. Called
 * once per step, after `markSigned`. Its clock is its own: the caller's abort signal is
 * not passed in, because aborting here loses an answer that may already be paid for.
 * Whatever happens, the ledger row leaves `signed` before this returns or throws, unless
 * the ledger itself cannot be written; a row left `signed` is the reconciler's.
 *
 * What the gateway says about the payment chooses the row's proof and nothing else: see
 * "What the gateway's word decides" at the top of this file.
 */
async function payAndResolve(
  ctx: InferencePayContext,
  deps: InferenceFetchDeps,
  url: string,
  body: string,
  payment: { header: string; transaction: string },
  paymentId: string,
  quotedUsd: number,
  progress: StepProgress,
): Promise<Response> {
  const clock = requestClock(deps.clocks.paidTimeoutMs, null);
  let response: Response | null = null;
  let answer: Awaited<ReturnType<typeof readAnswer>> | null = null;
  let failure = "";
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { ...JSON_HEADERS, "PAYMENT-SIGNATURE": payment.header },
      body,
      redirect: "manual",
      signal: clock.signal,
    });
    if (response.status >= 200 && response.status < 300) {
      answer = await readAnswer(response, clock.signal);
      if (!answer.completion) failure = `HTTP ${response.status}, but ${answer.problem}`;
    } else {
      const said = await errorText(response, clock.signal);
      failure = `HTTP ${response.status}${said ? `: ${said}` : ""}`;
    }
  } catch (err) {
    failure = clock.timedOut() ? `no answer within ${deps.clocks.paidTimeoutMs} ms` : describeError(err);
  } finally {
    clock.done();
  }

  const status = response ? response.status : null;
  const receipt = response ? readReceipt(response.headers, payment.transaction) : NO_RECEIPT;
  if (response && inferenceFlags(deps.env).stage === "owner") noteGatewayHeaders(ctx.runId, response.status, response.headers, receipt);
  const requestId = response?.headers.get("x-blockrun-gateway-request-id");
  const gatewayRequestId = requestId ? clean(requestId, 120) : null;

  if (response && answer?.completion) {
    const completion = answer.completion;
    const httpStatus = response.status;
    const reroute = readReroute(response.headers);
    if (reroute.rerouted && receipt.saysNotSettled) {
      // Another model answered and the gateway says no money moved. Its word is not
      // taken for that: the row stays counted as charged until the chain has been read.
      const skipped = skippedSettlement(response.headers);
      const detail = clean(
        `another model answered (${reroute.servedModel ?? "unnamed"}) and the gateway says it did not settle${skipped ? ` (x-settlement-skipped: ${skipped})` : ""}`,
      );
      if (await ledgerWrite("markUnconfirmed", () => ctx.ledger.markUnconfirmed(paymentId, { httpStatus: status, detail }))) progress.row = "resolved";
      stopRun(ctx, "rerouted", detail);
    }
    // An answered step is always booked `settled`. What the gateway said decides only
    // whether the row carries proof: `receipt.txHash` is set when a receipt names this
    // payment's own transaction id and says it settled, and is `null` when there is no
    // receipt, when the receipt says it did not settle, or when it names no id. A
    // `settled` row with no id is then checked against the chain by the reconciler.
    const settled = await ledgerWrite("settle", () =>
      ctx.ledger.settle(paymentId, {
        txHash: receipt.txHash,
        // The amount is the one in the signed transfer. An `exact` payment cannot settle
        // for any other, whatever a receipt says.
        settledUsd: quotedUsd,
        servedModel: reroute.servedModel,
        httpStatus,
        gatewayRequestId,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      }),
    );
    if (settled) progress.row = "resolved";
    if (reroute.rerouted) stopRun(ctx, "rerouted", `another model answered (${reroute.servedModel ?? "unnamed"}); the answer was not used`);
    return answer.response;
  }

  // Paid for, or possibly paid for, and no answer to show for it. Never sent again.
  // `paid_no_answer` is a final state the reconciler does not revisit, so it is written
  // here only on the same proof a settled row needs: this payment's own transaction id,
  // said to have settled. A receipt that falls short of that leaves the chain to decide.
  const detail = clean(`the paid request did not return an answer (${failure || "no response"})${gatewayRequestId ? ` [gateway request ${gatewayRequestId}]` : ""}`);
  const proof = receipt.txHash;
  const written =
    proof !== null
      ? await ledgerWrite("markPaidNoAnswer", () => ctx.ledger.markPaidNoAnswer(paymentId, { txHash: proof, httpStatus: status, detail }))
      : await ledgerWrite("markUnconfirmed", () => ctx.ledger.markUnconfirmed(paymentId, { httpStatus: status, detail }));
  if (written) progress.row = "resolved";
  stopRun(ctx, "paid_no_answer", detail);
}

// ---------- mock mode ----------

/**
 * One step's worth of limits, ledger and counters with nothing real behind it: the price
 * is our own estimate and the row is `simulated`. The same stops as a real step, so a
 * cap or a hold can be exercised locally.
 */
async function simulateStep(
  ctx: InferencePayContext,
  deps: Pick<InferenceFetchDeps, "now">,
  seq: number,
  model: PayPerUseModel,
  contentChars: number,
  messages: number,
  requestHash: string,
): Promise<{ paymentId: string; usd: number; inputTokens: number }> {
  const gateway = INFERENCE_GATEWAY[ctx.chain];
  const priceUsd = estimateStepUsd(model, contentChars, messages);
  const capUsd = stepCapUsd(priceUsd, Math.min(ctx.caps.stepUsd, HARD_STEP_CAP_USD));
  if (priceUsd > capUsd) stopRun(ctx, "step_cap", `a simulated step priced at ${usd(priceUsd)} is over the ${usd(capUsd)} a step may cost`);
  if (roundUsd(ctx.spentUsd + priceUsd) > ctx.caps.runUsd) {
    stopRun(ctx, "run_cap", `this simulated step (${usd(priceUsd)}) would take the run past ${usd(ctx.caps.runUsd)}`);
  }
  let result;
  try {
    result = await ctx.ledger.reserve({
      ownerId: ctx.ownerId,
      agentId: ctx.agentId,
      runId: ctx.runId,
      seq,
      requestHash,
      chain: ctx.chain,
      network: gateway.network,
      host: gateway.host,
      model: ctx.model,
      payerWalletId: ctx.payer.walletId,
      payerAddress: ctx.payer.address,
      payTo: gateway.payTo[0],
      asset: gateway.asset,
      quotedUsd: priceUsd,
      caps: ctx.caps,
      runSpentUsd: ctx.spentUsd,
      now: new Date(deps.now()),
      simulated: true,
    });
  } catch (err) {
    stopRun(ctx, "signature_failed", `the ledger could not record the simulated step (${dbErrorForLog(err)})`);
  }
  if (!result.ok) {
    stopRun(ctx, isInferenceStopReason(result.reason) ? result.reason : "signature_failed", "the ledger refused the simulated step");
  }
  ctx.spentUsd = roundUsd(ctx.spentUsd + priceUsd);
  ctx.requests += 1;
  ctx.maxStepUsd = Math.max(ctx.maxStepUsd, priceUsd);
  // The gateway's own rule of thumb, so a simulated row shows plausible token counts.
  return { paymentId: result.paymentId, usd: priceUsd, inputTokens: Math.round(0.48 * contentChars + 16 * messages) };
}

async function mockResponse(
  ctx: InferencePayContext,
  deps: InferenceFetchDeps,
  seq: number,
  body: Record<string, unknown>,
  simulated: { paymentId: string; usd: number; inputTokens: number },
): Promise<Response> {
  const scripted: unknown = deps.mockAnswer ? await deps.mockAnswer({ seq, body }) : undefined;
  const completion = scripted ?? {
    id: `mock-${ctx.runId}-${seq}`,
    object: "chat.completion",
    created: Math.floor(deps.now() / 1000),
    model: ctx.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Mock mode: no model was called and nothing was paid." },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: simulated.inputTokens, completion_tokens: 12, total_tokens: simulated.inputTokens + 12 },
  };
  const usage = isRecord(completion) && isRecord(completion.usage) ? completion.usage : {};
  const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
  // A simulated row never changes status; this only fills in what the screens show.
  await ledgerWrite("settle (simulated)", () =>
    ctx.ledger.settle(simulated.paymentId, {
      txHash: null,
      settledUsd: simulated.usd,
      servedModel: ctx.model,
      httpStatus: 200,
      gatewayRequestId: null,
      inputTokens: count(usage.prompt_tokens),
      outputTokens: count(usage.completion_tokens),
    }),
  );
  return new Response(JSON.stringify(completion), {
    status: 200,
    headers: { "content-type": "application/json", "x-tocker-simulated": "1" },
  });
}

/**
 * One step of a pay-per-use agent that thinks on the scripted model (`LLM_MOCK=1`).
 *
 * That model never calls a fetch, so the run loop calls this once per model step
 * instead. It touches no network and no wallet whatever the environment says: it applies
 * the same step, time and run limits as a real step, prices the step with
 * `estimateStepUsd` from the prompt's size, writes a `simulated` ledger row, and keeps
 * `ctx.spentUsd`, `ctx.requests`, `ctx.maxStepUsd` and `ctx.maxStepMs` as a real step
 * would. It stops the same way too: `ctx.stop` is set and `InferenceStop` is thrown.
 */
export async function simulateInferenceStep(
  ctx: InferencePayContext,
  size: { contentChars: number; messages: number },
  now: () => number = () => Date.now(),
): Promise<{ usd: number }> {
  const state = runState(ctx);
  return inTurn(state, async () => {
    const startedAt = now();
    try {
      if (ctx.stop) throw new InferenceStop(ctx.stop.reason, ctx.stop.detail);
      const model = payPerUseModel(ctx.model);
      if (!model) stopRun(ctx, "model_unavailable", `${ctx.model} is not offered for pay-per-use`);
      if (state.steps >= ctx.caps.maxRequestsPerRun) stopRun(ctx, "step_limit", `this run has made its ${ctx.caps.maxRequestsPerRun} requests`);
      const seq = state.steps;
      state.steps += 1;
      if (ctx.deadlineAt - now() < SIGN_MIN_REMAINING_MS) stopRun(ctx, "deadline", "too little of the run's time is left to pay for another step");
      const contentChars = Math.max(0, Math.floor(size.contentChars) || 0);
      const messages = Math.max(1, Math.floor(size.messages) || 1);
      const simulated = await simulateStep(ctx, { now }, seq, model, contentChars, messages, await sha256Hex(`simulated:${ctx.runId}:${seq}`));
      // The same details a mock-mode request leaves on its row, so the screens show both alike.
      await ledgerWrite("settle (simulated)", () =>
        ctx.ledger.settle(simulated.paymentId, {
          txHash: null,
          settledUsd: simulated.usd,
          servedModel: ctx.model,
          httpStatus: 200,
          gatewayRequestId: null,
          inputTokens: simulated.inputTokens,
          outputTokens: null,
        }),
      );
      return { usd: simulated.usd };
    } finally {
      ctx.maxStepMs = Math.max(ctx.maxStepMs, Math.max(0, now() - startedAt));
    }
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------- the sign-only probe ----------

/**
 * For the admin page, before any money moves: can this wallet sign a real quote?
 *
 * It asks the gateway for a real price with a tiny unpaid request, pins it, has the
 * wallet sign the payment under its real policy, and checks the signed bytes exactly as
 * a paid step would. Then it stops. The signed transaction is dropped here and goes
 * nowhere: this function has no line that sends a payment header, and writes nothing to
 * the ledger. The transaction dies on its own when its blockhash expires, about a minute
 * later.
 */
export async function probeInferenceSignature(payer: {
  walletId: string;
  address: string;
}): Promise<{ ok: true; checks: string[] } | { ok: false; reason: string }> {
  return probeWith(payer, productionDeps());
}

/** {@link probeInferenceSignature} with its surroundings handed in. For tests. */
export async function probeWith(
  payer: { walletId: string; address: string },
  deps: InferenceFetchDeps,
  chain: InferenceChain = "solana",
): Promise<{ ok: true; checks: string[] } | { ok: false; reason: string }> {
  const fail = (reason: string) => ({ ok: false as const, reason: clean(reason) });
  try {
    if (isMock(deps.env)) return fail("X402_MOCK=1: in mock mode no gateway and no wallet are touched, so there is nothing to probe");
    const rpcUrl = deps.env.SOLANA_RPC_URL?.trim();
    if (!rpcUrl) return fail("SOLANA_RPC_URL is not set");
    if (!payer.walletId || payer.walletId.startsWith("paper_") || !isSolanaAddress(payer.address)) return fail("this is not a real Solana wallet");

    const gateway = INFERENCE_GATEWAY[chain];
    const model = payPerUseModel(DEFAULT_PAY_PER_USE_MODEL);
    if (!model) return fail("the default pay-per-use model is not in the list");
    const guarded = guardInferenceBody(JSON.stringify({ model: model.id, messages: [{ role: "user", content: "Reply with OK." }] }), model.id);
    if (!guarded.ok) return fail(guarded.reason);

    // No run is waiting on this, so the quote has no deadline beyond its own retries.
    const quoted = await requestQuote(Number.POSITIVE_INFINITY, deps, gateway.url, guarded.body, null);
    if (quoted.kind === "stop") return fail(`${quoted.reason}: ${quoted.detail}`);
    if (quoted.kind === "answer") return fail("the gateway answered without asking for payment, so there was no quote to sign");

    const pin = pinInferenceRequirement(quoted.paymentRequired, payer, chain);
    if (!pin.ok) return fail(`the quote failed the pins: ${pin.reason}`);
    const estimateUsd = estimateStepUsd(model, guarded.contentChars, guarded.messages);
    const capUsd = stepCapUsd(estimateUsd);
    if (pin.pinned.amountUsd > capUsd) return fail(`the quote (${usd(pin.pinned.amountUsd)}) is over the step cap (${usd(capUsd)})`);

    const client = await buildSigningClient(deps, payer, rpcUrl, chain);
    const signed = await client.sign({ paymentRequired: quoted.paymentRequired, pinned: pin.pinned, capUsd, signal: null, beforeSign: async () => null });
    if (!signed.ok) return fail(`${signed.reason}: ${signed.detail}`);

    return {
      ok: true,
      checks: [
        `quote for ${model.id}: exact, Solana mainnet, USDC, ${usd(pin.pinned.amountUsd)} to the pinned pay-to (estimate ${usd(estimateUsd)}, cap ${usd(capUsd)})`,
        `the wallet signed in ${Math.max(0, Math.round(signed.signMs))} ms`,
        "the signed transaction is one USDC transfer of the quoted amount to the gateway's account, one memo, and nothing else",
        `the fee payer is the gateway's (${signed.check.feePayer}), not this wallet`,
        "the wallet's signature is valid for those bytes",
        "nothing was sent: the signed transaction was dropped and expires with its blockhash",
      ],
    };
  } catch (err) {
    return fail(`the probe failed: ${describeError(err)}`);
  }
}
