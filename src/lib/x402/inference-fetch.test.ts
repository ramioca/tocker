/**
 * The pay path, end to end, with nothing real behind it.
 *
 * The x402 client and the Solana scheme are the installed ones, so these tests are also
 * the alarm for a version that selects, signs or encodes differently. What is replaced:
 * the gateway (a scripted function that records every request), the wallet (a key made
 * in this process), the Solana RPC (one canned answer) and the ledger (a map).
 */
import { createHash, randomBytes } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { base58 } from "@scure/base";
import { generateKeyPairSigner, signBytes, type KeyPairSigner } from "@solana/kit";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { generateText } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInferenceFetch, INFERENCE_CLOCKS, probeWith, simulateInferenceStep, type InferenceFetchDeps, type PaymentSigner } from "./inference-fetch";
import { verifySignedPayment } from "./inference-pins";
import {
  blockrunBase402,
  blockrunSolana402,
  blockrunSolanaSmall402,
  chatRequest,
  completionResponse,
  FakeLedger,
  memoGateway402,
  mintRpcAnswer,
  payContext,
  quoteResponse,
  TEST_RPC_URL,
  TOKEN_2022_PROGRAM,
} from "./inference-test-support";
import {
  estimateStepUsd,
  INFERENCE_GATEWAY,
  INFERENCE_MAX_OUTPUT_TOKENS,
  InferenceStop,
  MAX_RESPONSE_BYTES,
  PAID_TIMEOUT_MS,
  payPerUseModel,
  QUOTE_RETRIES,
  QUOTE_TIMEOUT_MS,
  SIGN_MIN_REMAINING_MS,
  SIGN_TIMEOUT_MS,
  stepCapUsd,
  type InferencePayContext,
  type InferenceStopReason,
} from "./inference-types";

const SOLANA = INFERENCE_GATEWAY.solana;
const QUOTED_USD = 0.011961;

/** One request the gateway stand-in received. */
interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  redirect: RequestRedirect | undefined;
  signal: AbortSignal | null;
  /** Carried a payment header. */
  paid: boolean;
}

type Handler = (sent: Sent) => Response | Promise<Response>;

/** Never answers; fails the way a real fetch does when its signal aborts. */
const hang: Handler = (sent) =>
  new Promise<Response>((_, reject) => {
    sent.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
  });

const quote = (paymentRequired: unknown = blockrunSolana402()): Handler => () => quoteResponse(paymentRequired);
const answer = (overrides: Parameters<typeof completionResponse>[0] = {}): Handler => () => completionResponse(overrides);

/** A string shaped like a provider key, put together here so no such literal is in the repository. */
const KEY_SHAPED = `sk-${"Ab1".repeat(16)}`;

interface Harness {
  ctx: InferencePayContext;
  ledger: FakeLedger;
  fetch: typeof fetch;
  deps: InferenceFetchDeps;
  sent: Sent[];
  /** Sends, ledger writes and signatures, in the order they happened. */
  timeline: string[];
  wallet: KeyPairSigner;
  signer: { asked: number };
  rpc: { calls: number; decimals?: number; owner?: string };
  clock: { offsetMs: number };
  /** The reason the fetch stopped with, after asserting that it did. */
  stops(call: Promise<unknown>): Promise<{ reason: InferenceStopReason; detail: string }>;
}

let wallet: KeyPairSigner;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let rpc: Harness["rpc"];

beforeEach(async () => {
  wallet = await generateKeyPairSigner();
  rpc = { calls: 0 };
  // The only thing allowed through the runtime's own fetch is the scheme's one question
  // to the RPC. Any other network call fails the test that made it.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const mint = mintRpcAnswer(input, init, rpc);
    if (!mint) throw new Error(`unexpected network call: ${typeof input === "string" ? input : "a request"}`);
    rpc.calls += 1;
    return mint;
  });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function harness(
  handlers: Handler[],
  options: {
    ctx?: Partial<InferencePayContext>;
    env?: Record<string, string | undefined>;
    clocks?: Partial<InferenceFetchDeps["clocks"]>;
    /** Replaces the wallet's signing, to make it fail, stall or lie. */
    sign?: (transactions: Parameters<PaymentSigner["signTransactions"]>[0], real: KeyPairSigner) => ReturnType<PaymentSigner["signTransactions"]>;
    mockAnswer?: InferenceFetchDeps["mockAnswer"];
  } = {},
): Harness {
  const ledger = new FakeLedger();
  const timeline: string[] = [];
  ledger.onEvent = (event) => timeline.push(event);
  const sent: Sent[] = [];
  const signer = { asked: 0 };
  const clock = { offsetMs: 0 };
  const ctx = payContext(ledger, wallet.address, options.ctx);

  const gateway = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const record: Sent = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
      redirect: init?.redirect,
      signal: init?.signal ?? null,
      paid: "payment-signature" in headers || "x-payment" in headers,
    };
    sent.push(record);
    timeline.push(record.paid ? "send:paid" : "send:unpaid");
    const handler = handlers[sent.length - 1];
    if (!handler) throw new Error(`the gateway was called ${sent.length} times; only ${handlers.length} were expected`);
    return handler(record);
  };

  const deps: InferenceFetchDeps = {
    fetch: gateway as typeof fetch,
    signerFor: async () => ({
      address: wallet.address,
      signTransactions: async (transactions) => {
        signer.asked += 1;
        timeline.push("sign");
        return options.sign ? options.sign(transactions, wallet) : wallet.signTransactions(transactions);
      },
    }),
    now: () => Date.now() + clock.offsetMs,
    env: { INFERENCE_USDC: "on", SOLANA_RPC_URL: TEST_RPC_URL, ...(options.env ?? {}) },
    // Generous, so a busy machine does not turn a passing step into a timeout. The
    // tests about clocks shorten the one they are about.
    clocks: { quoteTimeoutMs: 5_000, quoteRetries: QUOTE_RETRIES, retryDelayMs: 1, signTimeoutMs: 5_000, paidTimeoutMs: 5_000, ...(options.clocks ?? {}) },
    ...(options.mockAnswer ? { mockAnswer: options.mockAnswer } : {}),
  };

  return {
    ctx,
    ledger,
    fetch: buildInferenceFetch(ctx, deps),
    deps,
    sent,
    timeline,
    wallet,
    signer,
    rpc,
    clock,
    async stops(call) {
      let thrown: unknown;
      try {
        await call;
      } catch (err) {
        thrown = err;
      }
      if (!(thrown instanceof InferenceStop)) throw new Error(`expected an InferenceStop, got ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      // Thrown and written: the class for the SDK, the context for the run.
      expect(ctx.stop).not.toBeNull();
      expect(ctx.stop?.reason).toBe(thrown.reason);
      expect(thrown.isRetryable).toBe(false);
      return { reason: thrown.reason, detail: ctx.stop?.detail ?? "" };
    },
  };
}

function paidHeaderOf(sent: Sent): { transaction: string; accepted: unknown; x402Version: number } {
  const decoded = decodePaymentSignatureHeader(sent.headers["payment-signature"]);
  return { transaction: (decoded.payload as { transaction: string }).transaction, accepted: decoded.accepted, x402Version: decoded.x402Version };
}

function receiptHeader(success: boolean): { header: string; txHash: string } {
  const txHash = base58.encode(randomBytes(64));
  return { txHash, header: encodePaymentResponseHeader({ success, transaction: txHash, network: SOLANA.network, payer: wallet.address }) };
}

describe("createInferenceFetch: one paid step", () => {
  it("quotes, reserves, signs, verifies, pays once and settles, in that order", async () => {
    const receipt = receiptHeader(true);
    const h = harness([quote(), answer({ headers: { "payment-response": receipt.header, "x-blockrun-gateway-request-id": "req-paid-9" } })]);

    const response = await h.fetch(...chatRequest());

    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "markSigned", "send:paid", "settle"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "ok" } }] });
    expect(response.headers.get("content-type")).toBe("application/json");

    // Two requests, to the one URL, neither following a redirect, neither carrying the
    // provider's Authorization header.
    expect(h.sent).toHaveLength(2);
    for (const sent of h.sent) {
      expect(sent.url).toBe(SOLANA.url);
      expect(sent.method).toBe("POST");
      expect(sent.redirect).toBe("manual");
      expect(sent.headers.authorization).toBeUndefined();
      expect(Object.keys(sent.headers).sort()).toEqual(sent.paid ? ["accept", "content-type", "payment-signature"] : ["accept", "content-type"]);
    }
    expect(h.sent.map((sent) => sent.paid)).toEqual([false, true]);

    // The same body on both legs, with the output cap under the name the gateway prices on.
    expect(h.sent[1].body).toBe(h.sent[0].body);
    const body = JSON.parse(h.sent[0].body) as Record<string, unknown>;
    expect(body.max_tokens).toBe(INFERENCE_MAX_OUTPUT_TOKENS);
    expect("max_completion_tokens" in body).toBe(false);
    expect(body.model).toBe("anthropic/claude-haiku-4.5");

    // What left is the pinned offer and a transaction that is exactly the priced payment.
    const paid = paidHeaderOf(h.sent[1]);
    expect(paid.x402Version).toBe(2);
    expect(paid.accepted).toEqual(blockrunSolana402().accepts[0]);
    const check = verifySignedPayment({
      transaction: paid.transaction,
      payer: wallet.address,
      pinned: { asset: SOLANA.asset, payTo: SOLANA.payTo[0], feePayer: "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX", amount: "11961" },
    });
    if (!check.ok) throw new Error(check.reason);

    // The ledger holds what the reconciler needs, read from the signed bytes.
    const row = h.ledger.only;
    expect(row).toMatchObject({
      status: "settled",
      memo: check.memo,
      blockhash: check.blockhash,
      payerSignature: check.payerSignature,
      txHash: receipt.txHash,
      settledUsd: QUOTED_USD,
      httpStatus: 200,
      gatewayRequestId: "req-paid-9",
      inputTokens: 120,
      outputTokens: 7,
      servedModel: null,
    });
    expect(row.input).toMatchObject({
      ownerId: "owner_1",
      agentId: "agent_1",
      runId: "run_1",
      seq: 0,
      requestHash: createHash("sha256").update(h.sent[0].body, "utf8").digest("hex"),
      chain: "solana",
      network: SOLANA.network,
      host: SOLANA.host,
      model: "anthropic/claude-haiku-4.5",
      payerWalletId: "wallet_1",
      payerAddress: wallet.address,
      payTo: SOLANA.payTo[0],
      asset: SOLANA.asset,
      quotedUsd: QUOTED_USD,
      runSpentUsd: 0,
    });
    expect(row.input.simulated).toBeUndefined();
    expect(row.input.caps).toEqual(h.ctx.caps);

    expect(h.ctx).toMatchObject({ stop: null, spentUsd: QUOTED_USD, requests: 1, maxStepUsd: QUOTED_USD, inFlight: null });
    expect(h.ctx.maxStepMs).toBeGreaterThanOrEqual(0);
    expect(h.signer.asked).toBe(1);
  });

  it("counts a run: the next step's place, what is already spent, one signer for the run", async () => {
    const h = harness([quote(), answer(), quote(), answer()]);
    await h.fetch(...chatRequest());
    await h.fetch(...chatRequest());

    const rows = [...h.ledger.rows.values()];
    expect(rows.map((row) => row.input.seq)).toEqual([0, 1]);
    expect(rows.map((row) => row.input.runSpentUsd)).toEqual([0, QUOTED_USD]);
    expect(rows.map((row) => row.status)).toEqual(["settled", "settled"]);
    expect(rows[0].memo).not.toBe(rows[1].memo);
    expect(h.ctx).toMatchObject({ spentUsd: 0.023922, requests: 2, maxStepUsd: QUOTED_USD });
    // The mint is read once per run, not once per step.
    expect(h.rpc.calls).toBe(1);
  });

  it("runs steps one at a time even when they are started together", async () => {
    const h = harness([quote(), answer(), quote(), answer()]);
    await Promise.all([h.fetch(...chatRequest()), h.fetch(...chatRequest())]);
    expect(h.timeline).toEqual([
      "send:unpaid", "reserve", "sign", "markSigned", "send:paid", "settle",
      "send:unpaid", "reserve", "sign", "markSigned", "send:paid", "settle",
    ]);
  });

  it("takes a Request object as well as a URL and an init", async () => {
    const h = harness([quote(), answer()]);
    const [url, init] = chatRequest();
    const response = await h.fetch(new Request(url, init));
    expect(response.status).toBe(200);
    expect(h.sent[1].headers.authorization).toBeUndefined();
    expect(h.ledger.only.status).toBe("settled");
  });

  it("keeps the spec's clocks unless a test says otherwise", () => {
    expect(INFERENCE_CLOCKS).toMatchObject({
      quoteTimeoutMs: QUOTE_TIMEOUT_MS,
      quoteRetries: QUOTE_RETRIES,
      signTimeoutMs: SIGN_TIMEOUT_MS,
      paidTimeoutMs: PAID_TIMEOUT_MS,
    });
    // A signature and a paid request fit inside the time a step must have left.
    expect(SIGN_TIMEOUT_MS + PAID_TIMEOUT_MS).toBeLessThan(SIGN_MIN_REMAINING_MS);
  });
});

describe("createInferenceFetch: what is refused before anything is sent", () => {
  const cases: Array<[string, () => [RequestInfo | URL, RequestInit?], InferenceStopReason]> = [
    ["the provider's default endpoint", () => ["https://sol.blockrun.ai/api/v1/responses", chatRequest()[1]], "bad_request"],
    ["another host", () => ["https://blockrun.ai/api/v1/chat/completions", chatRequest()[1]], "bad_request"],
    ["a query string", () => [`${SOLANA.url}?x=1`, chatRequest()[1]], "bad_request"],
    ["a GET", () => [SOLANA.url, { ...chatRequest()[1], method: "GET", body: undefined }], "bad_request"],
    ["no body", () => [SOLANA.url, { method: "POST" }], "bad_request"],
    ["a body that is not text", () => [SOLANA.url, { method: "POST", body: new URLSearchParams({ a: "b" }) }], "bad_request"],
    ["another model in the body", () => chatRequest({ model: "openai/gpt-4o-mini" }), "bad_request"],
    ["a streamed answer", () => chatRequest({ body: { stream: true } }), "bad_request"],
    ["no messages", () => chatRequest({ body: { messages: [] } }), "bad_request"],
  ];

  for (const [name, request, reason] of cases) {
    it(`refuses ${name}`, async () => {
      const h = harness([]);
      const stop = await h.stops(h.fetch(...request()));
      expect(stop.reason).toBe(reason);
      expect(h.sent).toHaveLength(0);
      expect(h.ledger.events).toEqual([]);
      expect(h.signer.asked).toBe(0);
    });
  }

  it("refuses a model that is not on the pay-per-use list", async () => {
    const h = harness([], { ctx: { model: "anthropic/claude-sonnet-5.5" } });
    const stop = await h.stops(h.fetch(...chatRequest({ model: "anthropic/claude-sonnet-5.5" })));
    expect(stop.reason).toBe("model_unavailable");
    expect(h.sent).toHaveLength(0);
  });

  it("refuses while the switch is off, which is how it merges", async () => {
    for (const value of [undefined, "", "off", "true", "1"]) {
      const h = harness([], { env: { INFERENCE_USDC: value } });
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason, String(value)).toBe("flag_off");
      expect(h.sent).toHaveLength(0);
      expect(h.ledger.events).toEqual([]);
      expect(h.signer.asked).toBe(0);
    }
    expect(rpc.calls).toBe(0);
  });

  it("refuses without our own RPC, and without a real Solana wallet", async () => {
    const noRpc = harness([], { env: { SOLANA_RPC_URL: " " } });
    expect((await noRpc.stops(noRpc.fetch(...chatRequest()))).reason).toBe("no_rpc");
    expect(noRpc.sent).toHaveLength(0);

    for (const payer of [
      { walletId: "paper_solana_abc", address: wallet.address },
      { walletId: "wallet_1", address: "PAPERabcdef" },
      { walletId: "", address: wallet.address },
      { walletId: "wallet_1", address: "0xe9030014F5DAe217d0A152f02A043567b16c1aBf" },
    ]) {
      const h = harness([], { ctx: { payer } });
      expect((await h.stops(h.fetch(...chatRequest()))).reason, JSON.stringify(payer)).toBe("no_wallet");
      expect(h.sent).toHaveLength(0);
    }
  });

  it("stops at the step limit", async () => {
    const h = harness([quote(), answer()], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, maxRequestsPerRun: 1 } } });
    await h.fetch(...chatRequest());
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("step_limit");
    expect(h.sent).toHaveLength(2);
    expect(h.ledger.rows.size).toBe(1);
    // A limit is not a failure, and is not logged as one.
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops when too little of the run's time is left to pay, or the run is already aborted", async () => {
    const late = harness([], { ctx: { deadlineAt: Date.now() + SIGN_MIN_REMAINING_MS - 1_000 } });
    expect((await late.stops(late.fetch(...chatRequest()))).reason).toBe("deadline");
    expect(late.sent).toHaveLength(0);

    const aborted = harness([]);
    expect((await aborted.stops(aborted.fetch(...chatRequest({ signal: AbortSignal.abort() })))).reason).toBe("deadline");
    expect(aborted.sent).toHaveLength(0);
  });

  it("stays stopped: nothing a caller does after a stop can start a payment", async () => {
    const h = harness([() => new Response("{}", { status: 400 })]);
    expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("bad_request");
    // Whatever calls again, an SDK retry included, gets the same stop and sends nothing.
    for (let again = 0; again < 3; again += 1) {
      expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("bad_request");
    }
    expect(h.sent).toHaveLength(1);
    expect(h.ledger.events).toEqual([]);
  });
});

describe("createInferenceFetch: the unpaid request", () => {
  it("retries while it is free to: a 503, a 429, then the quote", async () => {
    const h = harness([
      () => new Response("busy", { status: 503 }),
      () => new Response("slow down", { status: 429, headers: { "retry-after": "60" } }),
      quote(),
      answer(),
    ]);
    const started = Date.now();
    await h.fetch(...chatRequest());
    expect(h.timeline).toEqual(["send:unpaid", "send:unpaid", "send:unpaid", "reserve", "sign", "markSigned", "send:paid", "settle"]);
    // A minute of Retry-After is not waited out: the run's clock is worth more than that.
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("gives up after its retries, having signed nothing", async () => {
    const failing: Handler = () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    };
    const h = harness([failing, failing, failing]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("quote_failed");
    expect(stop.detail).toContain("ECONNRESET");
    expect(h.sent).toHaveLength(1 + QUOTE_RETRIES);
    expect(h.ledger.events).toEqual([]);
    expect(h.signer.asked).toBe(0);
    expect(h.ctx).toMatchObject({ spentUsd: 0, requests: 0 });
  });

  it("gives each attempt its own short clock", async () => {
    const h = harness([hang, hang, hang], { clocks: { quoteTimeoutMs: 20 } });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("quote_failed");
    expect(stop.detail).toContain("no answer within 20 ms");
    expect(h.sent).toHaveLength(3);
    expect(h.sent.every((sent) => sent.signal?.aborted)).toBe(true);
  });

  it("does not retry a refusal, and keeps the gateway's text short and clean", async () => {
    const h = harness([
      () =>
        Response.json(
          {
            error: { code: "INVALID_PARAMETER", message: `bad key ${KEY_SHAPED} sent with Bearer abc123def456ghi789 to @blockrun_support` },
            debug: `upstream said: ${"PROMPT TEXT ".repeat(50)}`,
          },
          { status: 400 },
        ),
    ]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("bad_request");
    expect(h.sent).toHaveLength(1);
    expect(stop.detail).toContain("INVALID_PARAMETER");
    for (const text of [stop.detail, String(warn.mock.calls.flat().join(" "))]) {
      expect(text).not.toContain(KEY_SHAPED);
      expect(text).not.toContain("abc123def456ghi789");
      expect(text).not.toContain("PROMPT TEXT");
      expect(text.length).toBeLessThan(600);
    }
  });

  it("does not follow a redirect", async () => {
    const h = harness([() => new Response(null, { status: 302, headers: { location: "https://other.example/api/v1/chat/completions" } })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("quote_failed");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].redirect).toBe("manual");
  });

  it("hands on a free answer and records nothing", async () => {
    const h = harness([answer()]);
    const response = await h.fetch(...chatRequest());
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "ok" } }] });
    expect(h.ledger.events).toEqual([]);
    expect(h.signer.asked).toBe(0);
    expect(h.ctx).toMatchObject({ stop: null, spentUsd: 0, requests: 0, maxStepUsd: 0 });
  });

  it("does not hand on a free answer another model gave, or one that is not an answer", async () => {
    const rerouted = harness([answer({ headers: { "x-health-reroute": "true", "x-served-model": "nvidia/nemotron-3-super-120b" } })]);
    const stop = await rerouted.stops(rerouted.fetch(...chatRequest()));
    expect(stop.reason).toBe("rerouted");
    expect(stop.detail).toContain("nvidia/nemotron-3-super-120b");
    expect(rerouted.ledger.events).toEqual([]);

    const garbage = harness([() => new Response("<html>ok</html>", { status: 200 })]);
    expect((await garbage.stops(garbage.fetch(...chatRequest()))).reason).toBe("gateway_error");
    expect(garbage.ledger.events).toEqual([]);
  });

  it("honours the caller's abort while nothing is signed", async () => {
    const controller = new AbortController();
    const h = harness([hang]);
    const call = h.fetch(...chatRequest({ signal: controller.signal }));
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    controller.abort();
    const stop = await h.stops(call);
    expect(stop.reason).toBe("deadline");
    expect(h.sent).toHaveLength(1);
    expect(h.ledger.events).toEqual([]);
  });

  it("stops asking once too little time is left to pay for the answer", async () => {
    // The first attempt eats the slack the run had; the retry is not made.
    const h = harness(
      [
        () => {
          h.clock.offsetMs += 11_000;
          return new Response("busy", { status: 503 });
        },
      ],
      { ctx: { deadlineAt: Date.now() + SIGN_MIN_REMAINING_MS + 10_000 } },
    );
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("deadline");
    expect(h.sent).toHaveLength(1);
    expect(h.ledger.events).toEqual([]);
  });
});

describe("createInferenceFetch: the pins and the caps", () => {
  const refused402s: Array<[string, () => Response]> = [
    ["a 402 with no requirements header", () => new Response(JSON.stringify(blockrunSolana402()), { status: 402 })],
    ["a 402 whose header is not readable", () => new Response("{}", { status: 402, headers: { "payment-required": "%%%" } })],
    ["BlockRun's own Base 402 (wrong network, and `upto`)", () => quoteResponse(blockrunBase402())],
    ["another gateway's 402 that dictates the memo (wrong pay-to)", () => quoteResponse(memoGateway402())],
    [
      "the right offer with a memo of the gateway's choosing",
      () => {
        const paymentRequired = blockrunSolana402();
        (paymentRequired.accepts[0].extra as Record<string, unknown>).memo = "pi_0b8e";
        return quoteResponse(paymentRequired);
      },
    ],
    [
      "an offer that makes the agent the fee payer",
      () => {
        const paymentRequired = blockrunSolana402();
        (paymentRequired.accepts[0].extra as Record<string, unknown>).feePayer = wallet.address;
        return quoteResponse(paymentRequired);
      },
    ],
    [
      "only the deposit-backed scheme",
      () => {
        const paymentRequired = blockrunSolana402();
        paymentRequired.accepts.shift();
        return quoteResponse(paymentRequired);
      },
    ],
  ];

  for (const [name, respond] of refused402s) {
    it(`signs nothing for ${name}`, async () => {
      const h = harness([respond]);
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason).toBe("pin_mismatch");
      expect(h.sent).toHaveLength(1);
      expect(h.ledger.events).toEqual([]);
      expect(h.signer.asked).toBe(0);
      expect(h.ctx).toMatchObject({ spentUsd: 0, requests: 0 });
    });
  }

  it("pays the exact offer when the deposit-backed scheme is listed first", async () => {
    const paymentRequired = blockrunSolana402();
    paymentRequired.accepts.reverse();
    const h = harness([quote(paymentRequired), answer()]);
    await h.fetch(...chatRequest());
    const paid = paidHeaderOf(h.sent[1]);
    expect((paid.accepted as { scheme: string }).scheme).toBe("exact");
    expect(h.ledger.only.input.quotedUsd).toBe(QUOTED_USD);
  });

  it("refuses a price far above our own estimate, whatever the run could afford", async () => {
    const model = payPerUseModel("anthropic/claude-haiku-4.5");
    if (!model) throw new Error("model missing");
    const [, init] = chatRequest();
    const body = JSON.parse(init.body as string) as { messages: Array<{ content: string }> };
    const chars = body.messages.reduce((sum, message) => sum + message.content.length, 0);
    const cap = stepCapUsd(estimateStepUsd(model, chars, body.messages.length));
    const overCap = String(Math.floor(cap * 1_000_000) + 1);
    const atCap = String(Math.floor(cap * 1_000_000));

    const price = (amount: string): PaymentRequired => {
      const paymentRequired = blockrunSolana402();
      paymentRequired.accepts[0].amount = amount;
      return paymentRequired;
    };
    const over = harness([quote(price(overCap))], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, runUsd: 2 } } });
    const stop = await over.stops(over.fetch(...chatRequest()));
    expect(stop.reason).toBe("step_cap");
    expect(over.sent).toHaveLength(1);
    expect(over.ledger.events).toEqual([]);
    expect(over.signer.asked).toBe(0);

    // One unit less is a price that is merely different, and is paid.
    const at = harness([quote(price(atCap)), answer()], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, runUsd: 2 } } });
    await at.fetch(...chatRequest());
    expect(at.ledger.only.status).toBe("settled");
  });

  it("never pays a step above the hard ceiling, or above the run's own step cap", async () => {
    // A prompt large enough that twice its estimate is over the hard ceiling.
    const huge = chatRequest({ body: { messages: [{ role: "user", content: "x".repeat(400_000) }] } });
    const paymentRequired = blockrunSolana402();
    paymentRequired.accepts[0].amount = "250001";
    const h = harness([quote(paymentRequired)], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, runUsd: 2, stepUsd: 5 } } });
    expect((await h.stops(h.fetch(...huge))).reason).toBe("step_cap");
    expect(h.signer.asked).toBe(0);

    const tight = harness([quote()], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, stepUsd: 0.005 } } });
    expect((await tight.stops(tight.fetch(...chatRequest()))).reason).toBe("step_cap");
    expect(tight.ledger.events).toEqual([]);
  });

  it("stops at the run cap without reserving", async () => {
    const h = harness([quote()], { ctx: { spentUsd: 0.29 } });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("run_cap");
    expect(h.sent).toHaveLength(1);
    expect(h.ledger.events).toEqual([]);
    expect(h.signer.asked).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("createInferenceFetch: the reservation", () => {
  const refusals: InferenceStopReason[] = ["run_cap", "agent_day_cap", "owner_day_cap", "platform_day_cap", "request_limit", "needs_funds", "halted", "paused"];

  for (const reason of refusals) {
    it(`signs nothing when the ledger refuses with ${reason}`, async () => {
      const h = harness([quote()]);
      h.ledger.refuse = reason;
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason).toBe(reason);
      expect(h.timeline).toEqual(["send:unpaid", "reserve"]);
      expect(h.signer.asked).toBe(0);
      expect(h.ledger.rows.size).toBe(0);
      expect(h.ctx).toMatchObject({ spentUsd: 0, requests: 0 });
    });
  }

  it("signs nothing when the ledger cannot be reached, and does not repeat what the database said", async () => {
    const h = harness([quote()]);
    h.ledger.failing.add("reserve");
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(h.timeline).toEqual(["send:unpaid", "reserve"]);
    expect(h.signer.asked).toBe(0);
    // The driver's message carries the statement and its parameters. Neither is kept.
    expect(stop.detail).not.toContain("secret-param");
    expect(stop.detail).not.toContain("inference_payments");
  });

  it("checks the clock again once the price is known", async () => {
    const h = harness([
      () => {
        h.clock.offsetMs += 200_000;
        return quoteResponse(blockrunSolana402());
      },
    ]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("deadline");
    expect(h.ledger.events).toEqual([]);
    expect(h.signer.asked).toBe(0);
  });
});

describe("createInferenceFetch: the signature", () => {
  it("gives the reservation back when the wallet refuses", async () => {
    const h = harness([quote()], {
      sign: async () => {
        throw new Error(`policy denied for key ${KEY_SHAPED}`);
      },
    });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(stop.detail).not.toContain(KEY_SHAPED);
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "release"]);
    expect(h.ledger.only.status).toBe("released");
    expect(h.ledger.only.detail).not.toContain(KEY_SHAPED);
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
    expect(h.ctx).toMatchObject({ spentUsd: 0, requests: 0, inFlight: null });
  });

  it("stops waiting for a wallet that does not answer, and drops a signature that arrives late", async () => {
    let finish: () => void = () => {};
    const h = harness([quote()], {
      clocks: { signTimeoutMs: 30 },
      sign: (transactions, real) =>
        new Promise((resolve) => {
          finish = () => resolve(real.signTransactions(transactions));
        }),
    });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(stop.detail).toContain("did not sign within 30 ms");
    expect(h.ledger.only.status).toBe("released");

    // The wallet answers after all. Nobody is waiting, and nothing is sent.
    finish();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.sent).toHaveLength(1);
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "release"]);
    expect(h.ledger.only.status).toBe("released");
  });

  it("honours the caller's abort while the wallet is still signing", async () => {
    const controller = new AbortController();
    const h = harness([quote()], { sign: () => new Promise(() => {}) });
    const call = h.fetch(...chatRequest({ signal: controller.signal }));
    await vi.waitFor(() => expect(h.signer.asked).toBe(1));
    controller.abort();
    const stop = await h.stops(call);
    expect(stop.reason).toBe("deadline");
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "release"]);
    expect(h.sent).toHaveLength(1);
  });

  it("gives back a reservation that lands after the caller has gone", async () => {
    const controller = new AbortController();
    const h = harness([quote()]);
    // The abort arrives while the ledger is still writing the reservation.
    h.ledger.duringReserve = async () => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
    };
    const stop = await h.stops(h.fetch(...chatRequest({ signal: controller.signal })));
    expect(stop.reason).toBe("deadline");
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "release"]);
    expect(h.signer.asked).toBe(0);
    expect(h.ledger.only.status).toBe("released");
  });

  it("sends nothing when the signature is not the wallet's over these bytes", async () => {
    const stranger = await generateKeyPairSigner();
    const h = harness([quote()], {
      // A real signature over the right bytes, from the wrong key.
      sign: async (transactions) => [{ [wallet.address]: await signBytes(stranger.keyPair.privateKey, transactions[0].messageBytes) }] as never,
    });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(stop.detail).toContain("signature does not match");
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "release"]);
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
    expect(h.ledger.only.status).toBe("released");
  });

  it("sends nothing when the wallet returns no signature of its own", async () => {
    const stranger = await generateKeyPairSigner();
    const h = harness([quote()], {
      sign: async (transactions) => [{ [stranger.address]: await signBytes(stranger.keyPair.privateKey, transactions[0].messageBytes) }] as never,
    });
    expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("signature_failed");
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
    expect(h.ledger.only.status).toBe("released");
  });

  it("hands on the agent's signature and no other the wallet returns", async () => {
    const h = harness([quote(), answer()], {
      sign: async (transactions, real) => {
        const [signatures] = await real.signTransactions(transactions);
        // A wallet that also fills in the fee payer's slot, with something that is not a signature.
        return [{ ...signatures, "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX": signatures[wallet.address] }] as never;
      },
    });
    await h.fetch(...chatRequest());
    const paid = paidHeaderOf(h.sent[1]);
    const check = verifySignedPayment({
      transaction: paid.transaction,
      payer: wallet.address,
      pinned: { asset: SOLANA.asset, payTo: SOLANA.payTo[0], feePayer: "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX", amount: "11961" },
    });
    // Verification refuses a transaction with anything in the fee payer's place, so
    // passing it is the proof the extra entry was dropped.
    expect(check.ok).toBe(true);
    expect(h.ledger.only.status).toBe("settled");
  });

  it("never asks the wallet to sign a transaction that is not the priced payment", async () => {
    // The RPC decides which token program and how many decimals the scheme builds with.
    // A lying RPC is caught on the bytes, before the wallet sees them.
    for (const lie of [{ decimals: 9 }, { owner: TOKEN_2022_PROGRAM }]) {
      Object.assign(rpc, { decimals: undefined, owner: undefined }, lie);
      const h = harness([quote()]);
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason, JSON.stringify(lie)).toBe("pin_mismatch");
      expect(h.signer.asked).toBe(0);
      expect(h.timeline).toEqual(["send:unpaid", "reserve", "release"]);
      expect(h.sent).toHaveLength(1);
      expect(h.ledger.only.status).toBe("released");
    }
  });

  it("sends nothing when the ledger cannot record the signature", async () => {
    const h = harness([quote()]);
    h.ledger.failing.add("markSigned");
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "markSigned", "release"]);
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
    expect(h.ledger.only.status).toBe("released");
    expect(h.ctx).toMatchObject({ spentUsd: 0, requests: 0 });
    expect(stop.detail).not.toContain("secret-param");
  });

  it("sends nothing when signing left too little time for the paid request", async () => {
    const h = harness([quote()], {
      ctx: { deadlineAt: Date.now() + SIGN_MIN_REMAINING_MS + 2_000 },
      clocks: { paidTimeoutMs: PAID_TIMEOUT_MS },
      sign: async (transactions, real) => {
        // The wallet took 20 seconds of the run's clock.
        h.clock.offsetMs += 20_000;
        return real.signTransactions(transactions);
      },
    });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("deadline");
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "release"]);
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
    expect(h.ledger.only.status).toBe("released");
  });

  it("fails closed when the wallet's signer cannot be built", async () => {
    const h = harness([quote()]);
    h.deps.signerFor = async () => {
      throw new Error("PRIVY_AUTHORIZATION_PRIVATE_KEY missing");
    };
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("signature_failed");
    expect(h.ledger.events).toEqual([]);
    expect(h.sent).toHaveLength(1);
  });

  it("refuses a signer that is for another wallet", async () => {
    const stranger = await generateKeyPairSigner();
    const h = harness([quote()]);
    h.deps.signerFor = async () => stranger;
    expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("signature_failed");
    expect(h.ledger.events).toEqual([]);
  });
});

describe("createInferenceFetch: the paid request", () => {
  it("is sent at most once, whatever comes back, and never after a stop", async () => {
    const h = harness([quote(), () => new Response("upstream down", { status: 503 })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");

    // What an SDK with retries left on would do next: call again, and again.
    for (let retry = 0; retry < 3; retry += 1) {
      expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("paid_no_answer");
    }
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(1);
    expect(h.sent).toHaveLength(2);
    expect(h.signer.asked).toBe(1);
    expect(h.timeline).toEqual(["send:unpaid", "reserve", "sign", "markSigned", "send:paid", "markUnconfirmed"]);

    // The step counts as charged until the chain says otherwise.
    expect(h.ledger.only).toMatchObject({ status: "unconfirmed", httpStatus: 503 });
    expect(h.ctx).toMatchObject({ spentUsd: QUOTED_USD, requests: 1, maxStepUsd: QUOTED_USD, inFlight: null });
  });

  it("is not aborted by the caller's signal, and still returns the answer that was paid for", async () => {
    const controller = new AbortController();
    let release: () => void = () => {};
    const h = harness([
      quote(),
      (sent) =>
        new Promise<Response>((resolve, reject) => {
          sent.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          release = () => resolve(completionResponse());
        }),
    ]);
    const call = h.fetch(...chatRequest({ signal: controller.signal }));
    await vi.waitFor(() => expect(h.sent).toHaveLength(2));

    // The run's clock fires while the paid request is in flight.
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.sent[1].signal).not.toBe(controller.signal);
    expect(h.sent[1].signal?.aborted).toBe(false);
    expect(h.ctx.inFlight).toBeInstanceOf(Promise);

    release();
    const response = await call;
    expect(response.status).toBe(200);
    expect(h.ledger.only.status).toBe("settled");
    expect(h.ctx).toMatchObject({ stop: null, inFlight: null });
  });

  it("keeps `inFlight` until the ledger row is resolved", async () => {
    let resolvedAt: string[] | null = null;
    const h = harness([
      quote(),
      () => {
        // Set before the paid request leaves, so a run that stops listening can still wait.
        const inFlight = h.ctx.inFlight;
        if (!(inFlight instanceof Promise)) throw new Error("inFlight was not set before the paid request");
        void inFlight.then(() => {
          resolvedAt = [...h.timeline];
        });
        return completionResponse();
      },
    ]);
    await h.fetch(...chatRequest());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolvedAt).toEqual(["send:unpaid", "reserve", "sign", "markSigned", "send:paid", "settle"]);
    expect(h.ctx.inFlight).toBeNull();

    // The same when the step ends badly: resolved, never rejected.
    let settledBadly = false;
    const bad = harness([
      quote(),
      () => {
        void bad.ctx.inFlight?.then(() => {
          settledBadly = bad.timeline.includes("markUnconfirmed");
        });
        return new Response("no", { status: 500 });
      },
    ]);
    await bad.stops(bad.fetch(...chatRequest()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settledBadly).toBe(true);
    expect(bad.ctx.inFlight).toBeNull();
  });

  it("holds `inFlight` from the reservation on, so a reservation is given back before the run finishes", async () => {
    let duringSign: unknown = null;
    let releasedBeforeSettled = false;
    const h = harness([quote()], {
      sign: async () => {
        duringSign = h.ctx.inFlight;
        void h.ctx.inFlight?.then(() => {
          releasedBeforeSettled = h.timeline.includes("release");
        });
        throw new Error("the wallet said no");
      },
    });
    await h.stops(h.fetch(...chatRequest()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(duringSign).toBeInstanceOf(Promise);
    expect(releasedBeforeSettled).toBe(true);
    expect(h.ctx.inFlight).toBeNull();

    // Before the reservation there is no row to wait for.
    const early = harness([
      () => {
        expect(early.ctx.inFlight).toBeNull();
        return new Response("no", { status: 400 });
      },
    ]);
    await early.stops(early.fetch(...chatRequest()));
    expect(early.ctx.inFlight).toBeNull();
  });

  it("has its own clock", async () => {
    const h = harness([quote(), hang], { clocks: { paidTimeoutMs: 30 } });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");
    expect(stop.detail).toContain("no answer within 30 ms");
    expect(h.ledger.only).toMatchObject({ status: "unconfirmed", httpStatus: null });
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(1);
  });

  it("reads the answer inside that clock too", async () => {
    const slowBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":['));
        // Never finishes.
      },
    });
    const h = harness([quote(), () => new Response(slowBody, { status: 200 })], { clocks: { paidTimeoutMs: 30 } });
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");
    expect(h.ledger.only.status).toBe("unconfirmed");
  });

  it("records a step the gateway says it charged for and did not answer", async () => {
    const receipt = receiptHeader(true);
    const h = harness([quote(), () => new Response("upstream failed", { status: 500, headers: { "x-payment-response": receipt.header } })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");
    expect(h.timeline.at(-1)).toBe("markPaidNoAnswer");
    expect(h.ledger.only).toMatchObject({ status: "paid_no_answer", txHash: receipt.txHash, httpStatus: 500 });
  });

  it("leaves it to the chain when the gateway says nothing, or says it did not charge", async () => {
    const notSettled = receiptHeader(false);
    const outcomes: Array<[string, Handler, number | null]> = [
      ["a 500", () => new Response("no", { status: 500 }), 500],
      ["a 402 after payment", () => Response.json({ error: { code: "PAYMENT_BLOCKHASH_STALE", message: "blockhash expired" } }, { status: 402 }), 402],
      ["a 500 with a receipt saying no settlement ran", () => new Response("no", { status: 500, headers: { "payment-response": notSettled.header } }), 500],
      ["a redirect", () => new Response(null, { status: 307, headers: { location: "https://other.example/" } }), 307],
      ["a 200 that is not a chat completion", () => new Response("<html>", { status: 200 }), 200],
      ["a 200 with an error body", () => Response.json({ error: { message: "model overloaded" } }, { status: 200 }), 200],
      ["an answer larger than we read", () => new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }), 200],
      [
        "a network error",
        () => {
          throw new TypeError("fetch failed");
        },
        null,
      ],
    ];
    for (const [name, handler, status] of outcomes) {
      const h = harness([quote(), handler]);
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason, name).toBe("paid_no_answer");
      expect(h.timeline.at(-1), name).toBe("markUnconfirmed");
      expect(h.ledger.only, name).toMatchObject({ status: "unconfirmed", httpStatus: status });
      expect(h.sent.filter((sent) => sent.paid), name).toHaveLength(1);
      expect(h.ctx.spentUsd, name).toBe(QUOTED_USD);
    }
  });

  it("names the gateway's own code for a paid request it rejected", async () => {
    const h = harness([quote(), () => Response.json({ error: { code: "PAYMENT_UNFUNDED", message: "insufficient USDC" } }, { status: 402 })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.detail).toContain("PAYMENT_UNFUNDED");
    expect(h.ledger.only.detail).toContain("PAYMENT_UNFUNDED");
  });

  it("reads an answer larger than the limit no further, and does not hand it on", async () => {
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(512_000));
      },
    });
    const h = harness([quote(), () => new Response(big, { status: 200 })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");
    expect(stop.detail).toContain(`over ${MAX_RESPONSE_BYTES} bytes`);
  });

  it("settles and discards an answer another model gave", async () => {
    const reroutes: Array<Record<string, string>> = [
      { "x-fallback-used": "true", "x-fallback-model": "anthropic/claude-haiku-4" },
      { "X-Fallback-Used": "TRUE", "X-Fallback-Model": "anthropic/claude-haiku-4" },
      { "x-health-reroute": "true", "x-served-model": "anthropic/claude-haiku-4" },
    ];
    for (const headers of reroutes) {
      const h = harness([quote(), answer({ headers })]);
      const stop = await h.stops(h.fetch(...chatRequest()));
      expect(stop.reason).toBe("rerouted");
      expect(h.timeline.at(-1)).toBe("settle");
      expect(h.ledger.only).toMatchObject({ status: "settled", servedModel: "anthropic/claude-haiku-4", settledUsd: QUOTED_USD });
      expect(h.ctx.spentUsd).toBe(QUOTED_USD);
    }
  });

  it("does not judge a reroute by the body's model string", async () => {
    // Gateways rename models freely ("gpt-5.5" for "openai/gpt-5.5"). Only the headers count.
    const renamed = completionResponse({
      body: { model: "claude-haiku-4-5-20251001", choices: [{ index: 0, message: { role: "assistant", content: "ok" } }] },
      headers: { "x-fallback-used": "false", "x-served-model": "anthropic/claude-haiku-4.5" },
    });
    const h = harness([quote(), () => renamed]);
    const response = await h.fetch(...chatRequest());
    expect(response.status).toBe(200);
    expect(h.ledger.only).toMatchObject({ status: "settled", servedModel: "anthropic/claude-haiku-4.5" });
    expect(h.ctx.stop).toBeNull();
  });

  it("does not take the gateway's word that a substituted answer was free", async () => {
    const h = harness([quote(), answer({ headers: { "x-fallback-used": "true", "x-fallback-model": "nvidia/free", "x-settlement-skipped": "free-fallback" } })]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("rerouted");
    // Counted as charged until the reconciler has looked for the memo on chain.
    expect(h.timeline.at(-1)).toBe("markUnconfirmed");
    expect(h.ledger.only.status).toBe("unconfirmed");
    expect(h.ctx.spentUsd).toBe(QUOTED_USD);
  });

  it("treats a skipped settlement as a substitution even with no other header", async () => {
    const h = harness([quote(), answer({ headers: { "x-settlement-skipped": "free-fallback" } })]);
    expect((await h.stops(h.fetch(...chatRequest()))).reason).toBe("rerouted");
    expect(h.ledger.only.status).toBe("unconfirmed");
  });

  it("returns a paid-for answer even when the ledger cannot settle the row", async () => {
    const h = harness([quote(), answer()]);
    h.ledger.failing.add("settle");
    const response = await h.fetch(...chatRequest());
    expect(response.status).toBe(200);
    // The row stays `signed`, which still counts as charged and which the reconciler picks up.
    expect(h.ledger.only.status).toBe("signed");
    expect(h.ctx).toMatchObject({ stop: null, spentUsd: QUOTED_USD, requests: 1 });
    expect(String(error.mock.calls.flat().join(" "))).not.toContain("secret-param");
  });

  it("still stops, and still counts the step, when the ledger cannot record a lost answer", async () => {
    const h = harness([quote(), () => new Response("no", { status: 500 })]);
    h.ledger.failing.add("markUnconfirmed");
    const stop = await h.stops(h.fetch(...chatRequest()));
    expect(stop.reason).toBe("paid_no_answer");
    expect(h.ledger.only.status).toBe("signed");
    expect(h.ctx.spentUsd).toBe(QUOTED_USD);
  });

  it("keeps the gateway's text out of the ledger, the stop and the log unless it is clean", async () => {
    const h = harness([
      quote(),
      () =>
        Response.json(
          { error: { code: "UPSTREAM", message: `provider rejected ${KEY_SHAPED}` }, debug: "STRATEGY PROMPT ECHOED BACK" },
          { status: 502, headers: { "x-blockrun-gateway-request-id": `req ${KEY_SHAPED}` } },
        ),
    ]);
    const stop = await h.stops(h.fetch(...chatRequest()));
    const everywhere = [stop.detail, h.ledger.only.detail ?? "", String(warn.mock.calls.flat().join(" ")), String(error.mock.calls.flat().join(" "))];
    for (const text of everywhere) {
      expect(text).not.toContain(KEY_SHAPED);
      expect(text).not.toContain("STRATEGY PROMPT");
    }
    expect(stop.detail).toContain("UPSTREAM");
    expect(stop.detail.length).toBeLessThanOrEqual(300);
  });

  it("cleans what the gateway says about which model answered", async () => {
    const h = harness([quote(), answer({ headers: { "x-served-model": `m ${KEY_SHAPED} ${"z".repeat(500)}` } })]);
    await h.fetch(...chatRequest());
    const served = h.ledger.only.servedModel ?? "";
    expect(served).not.toContain(KEY_SHAPED);
    expect(served.length).toBeLessThanOrEqual(120);
  });

  it("takes a transaction id only when it looks like one", async () => {
    const h = harness([quote(), answer({ headers: { "x-payment-receipt": "<script>alert(1)</script>" } })]);
    await h.fetch(...chatRequest());
    expect(h.ledger.only.txHash).toBeNull();

    const txHash = base58.encode(randomBytes(64));
    const bare = harness([quote(), answer({ headers: { "x-payment-receipt": txHash } })]);
    await bare.fetch(...chatRequest());
    expect(bare.ledger.only.txHash).toBe(txHash);
  });
});

describe("createInferenceFetch: under the real provider", () => {
  /** The model exactly as the run builds it: chat completions, a placeholder key, our fetch. */
  const modelOn = (h: Harness) => createOpenAI({ baseURL: SOLANA.baseUrl, apiKey: "x402", fetch: h.fetch }).chat("anthropic/claude-haiku-4.5");

  it("is called the way the guard expects, and its answer is one the provider can read", async () => {
    const h = harness([quote(blockrunSolanaSmall402()), answer()]);
    const result = await generateText({ model: modelOn(h), prompt: "Say ok.", maxRetries: 0, maxOutputTokens: INFERENCE_MAX_OUTPUT_TOKENS });

    expect(result.text).toBe("ok");
    expect(h.sent).toHaveLength(2);
    for (const sent of h.sent) {
      expect(sent.url).toBe(SOLANA.url);
      // The provider sends `Authorization: Bearer x402`. It does not leave the process.
      expect(sent.headers.authorization).toBeUndefined();
      const body = JSON.parse(sent.body) as Record<string, unknown>;
      expect(body.max_tokens).toBe(INFERENCE_MAX_OUTPUT_TOKENS);
      expect("max_completion_tokens" in body).toBe(false);
      expect(body.stream).toBeUndefined();
    }
    expect(h.ledger.only.status).toBe("settled");
    expect(h.ctx).toMatchObject({ stop: null, requests: 1 });
  });

  it("pays once and signs once for a step, with the provider's own retries left on", async () => {
    // A 503 is what the SDK retries by default. Each retry would be a new payment.
    const h = harness([quote(blockrunSolanaSmall402()), () => new Response("upstream down", { status: 503 })]);
    await expect(generateText({ model: modelOn(h), prompt: "Say ok." })).rejects.toThrow();

    expect(h.ctx.stop?.reason).toBe("paid_no_answer");
    expect(h.sent.filter((sent) => sent.paid)).toHaveLength(1);
    expect(h.sent).toHaveLength(2);
    expect(h.signer.asked).toBe(1);
    expect(h.ledger.rows.size).toBe(1);
    expect(h.ledger.only.status).toBe("unconfirmed");
  });

  it("refuses the provider's default endpoint, which the gateway does not serve", async () => {
    // `createOpenAI(...)(model)` posts to /responses. Only `.chat(model)` is a request we sell.
    const h = harness([]);
    const responses = createOpenAI({ baseURL: SOLANA.baseUrl, apiKey: "x402", fetch: h.fetch })("anthropic/claude-haiku-4.5");
    await expect(generateText({ model: responses, prompt: "Say ok.", maxRetries: 0 })).rejects.toThrow();
    expect(h.ctx.stop?.reason).toBe("bad_request");
    expect(h.sent).toHaveLength(0);
  });

  it("runs a whole scripted step through the provider in mock mode", async () => {
    const h = harness([], { env: { X402_MOCK: "1", INFERENCE_USDC: undefined, SOLANA_RPC_URL: undefined } });
    const result = await generateText({ model: modelOn(h), prompt: "Say ok.", maxRetries: 0 });
    expect(result.text).toContain("Mock mode");
    expect(h.sent).toHaveLength(0);
    expect(h.ledger.only.status).toBe("simulated");
  });
});

describe("createInferenceFetch: as production wires it", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/privy");
    vi.doUnmock("@privy-io/node/solana-kit");
    vi.resetModules();
  });

  it("signs with the agent's own Privy wallet under the app's authorization key, and pays through the runtime's fetch", async () => {
    vi.resetModules();
    vi.stubEnv("X402_MOCK", "");
    vi.stubEnv("INFERENCE_USDC", "on");
    vi.stubEnv("SOLANA_RPC_URL", TEST_RPC_URL);

    const privyClient = { name: "privy" };
    const authorization = { authorization_private_keys: ["stand-in"] };
    let signerInput: Record<string, unknown> | null = null;
    let signerClient: unknown = null;
    vi.doMock("@/lib/privy", () => ({ privy: () => privyClient, authorizationContext: () => authorization }));
    vi.doMock("@privy-io/node/solana-kit", () => ({
      createSolanaKitSigner: (client: unknown, input: Record<string, unknown>) => {
        signerClient = client;
        signerInput = input;
        // Privy's signer can also sign *and send*. The pay path must never reach for that.
        return {
          ...wallet,
          signAndSendTransactions: () => {
            throw new Error("the pay path asked the wallet to send a transaction");
          },
        };
      },
    }));

    const gateway: Array<{ paid: boolean; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const mint = mintRpcAnswer(input, init);
      if (mint) return mint;
      if (String(input) !== SOLANA.url) throw new Error(`unexpected network call: ${String(input)}`);
      const paid = new Headers(init?.headers).has("payment-signature");
      gateway.push({ paid, redirect: init?.redirect });
      return paid ? completionResponse() : quoteResponse(blockrunSolana402());
    });

    const { createInferenceFetch } = await import("./paidFetch");
    const ledger = new FakeLedger();
    const ctx = payContext(ledger, wallet.address, { payer: { walletId: "privy-wallet-7", address: wallet.address } });
    const response = await createInferenceFetch(ctx)(...chatRequest());

    expect(response.status).toBe(200);
    expect(gateway).toEqual([
      { paid: false, redirect: "manual" },
      { paid: true, redirect: "manual" },
    ]);
    expect(signerClient).toBe(privyClient);
    // The agent's wallet and the app's key. No network id: that is only needed to send.
    expect(signerInput).toEqual({ walletId: "privy-wallet-7", address: wallet.address, authorizationContext: authorization });
    expect(ledger.only.status).toBe("settled");
  });
});

describe("createInferenceFetch: mock mode", () => {
  const mockEnv = { X402_MOCK: "1", INFERENCE_USDC: undefined, SOLANA_RPC_URL: undefined };

  it("touches no network and no wallet, and writes a simulated row at our own estimate", async () => {
    const h = harness([], { env: mockEnv, ctx: { payer: { walletId: "paper_solana_abc", address: "PAPERabcdef" } } });
    const response = await h.fetch(...chatRequest());

    expect(h.sent).toHaveLength(0);
    expect(h.signer.asked).toBe(0);
    expect(rpc.calls).toBe(0);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-tocker-simulated")).toBe("1");
    expect(await response.json()).toMatchObject({ model: "anthropic/claude-haiku-4.5", choices: [{ message: { role: "assistant" }, finish_reason: "stop" }] });

    const model = payPerUseModel("anthropic/claude-haiku-4.5");
    if (!model) throw new Error("model missing");
    const estimate = estimateStepUsd(model, 24_000 + "You are a careful trading agent.".length, 2);
    expect(h.ledger.only).toMatchObject({ status: "simulated", httpStatus: 200 });
    expect(h.ledger.only.input).toMatchObject({ simulated: true, quotedUsd: estimate, seq: 0, model: "anthropic/claude-haiku-4.5" });
    expect(h.ledger.only.input.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.ctx).toMatchObject({ stop: null, spentUsd: estimate, requests: 1, maxStepUsd: estimate, inFlight: null });
    expect(h.timeline).toEqual(["reserve", "settle"]);
  });

  it("answers with the caller's script when given one", async () => {
    const h = harness([], {
      env: mockEnv,
      mockAnswer: ({ seq, body }) => ({
        choices: [{ index: 0, message: { role: "assistant", content: `step ${seq} for ${String(body.model)}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
      }),
    });
    const first = (await (await h.fetch(...chatRequest())).json()) as { choices: Array<{ message: { content: string } }> };
    const second = (await (await h.fetch(...chatRequest())).json()) as { choices: Array<{ message: { content: string } }> };
    expect(first.choices[0].message.content).toBe("step 0 for anthropic/claude-haiku-4.5");
    expect(second.choices[0].message.content).toBe("step 1 for anthropic/claude-haiku-4.5");
    expect([...h.ledger.rows.values()].map((row) => [row.status, row.inputTokens, row.outputTokens])).toEqual([
      ["simulated", 11, 3],
      ["simulated", 11, 3],
    ]);
  });

  it("applies the same guard, limits and holds to simulated steps", async () => {
    const guard = harness([], { env: mockEnv });
    expect((await guard.stops(guard.fetch(...chatRequest({ body: { stream: true } })))).reason).toBe("bad_request");
    expect(guard.ledger.events).toEqual([]);

    const capped = harness([], { env: mockEnv, ctx: { spentUsd: 0.295 } });
    expect((await capped.stops(capped.fetch(...chatRequest()))).reason).toBe("run_cap");
    expect(capped.ledger.events).toEqual([]);

    const held = harness([], { env: mockEnv });
    held.ledger.refuse = "platform_day_cap";
    expect((await held.stops(held.fetch(...chatRequest()))).reason).toBe("platform_day_cap");
    expect(held.ctx).toMatchObject({ spentUsd: 0, requests: 0 });

    const limited = harness([], { env: mockEnv, ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, maxRequestsPerRun: 1 } } });
    await limited.fetch(...chatRequest());
    expect((await limited.stops(limited.fetch(...chatRequest()))).reason).toBe("step_limit");

    const late = harness([], { env: mockEnv, ctx: { deadlineAt: Date.now() + 1_000 } });
    expect((await late.stops(late.fetch(...chatRequest()))).reason).toBe("deadline");
  });

  it("is not real mode with a different switch: anything but exactly 1 pays for real", async () => {
    // `X402_MOCK=true` is not mock mode anywhere else in the app either.
    const h = harness([quote(), answer()], { env: { X402_MOCK: "true" } });
    await h.fetch(...chatRequest());
    expect(h.sent).toHaveLength(2);
    expect(h.ledger.only.status).toBe("settled");
  });
});

describe("simulateInferenceStep", () => {
  it("is one step of the scripted model: a simulated row, the same counters, no network", async () => {
    const h = harness([]);
    const model = payPerUseModel("anthropic/claude-haiku-4.5");
    if (!model) throw new Error("model missing");

    const first = await simulateInferenceStep(h.ctx, { contentChars: 14_500, messages: 2 });
    const second = await simulateInferenceStep(h.ctx, { contentChars: 18_700, messages: 4 });
    expect(first.usd).toBe(estimateStepUsd(model, 14_500, 2));
    expect(second.usd).toBe(estimateStepUsd(model, 18_700, 4));

    const rows = [...h.ledger.rows.values()];
    expect(rows.map((row) => [row.status, row.input.seq, row.input.simulated, row.input.quotedUsd])).toEqual([
      ["simulated", 0, true, first.usd],
      ["simulated", 1, true, second.usd],
    ]);
    expect(rows[1].input.runSpentUsd).toBe(first.usd);
    expect(rows[0].input.requestHash).not.toBe(rows[1].input.requestHash);
    expect(h.ctx.requests).toBe(2);
    expect(h.ctx.spentUsd).toBeCloseTo(first.usd + second.usd, 6);
    expect(h.ctx.maxStepUsd).toBe(second.usd);
    expect(h.sent).toHaveLength(0);
    expect(rpc.calls).toBe(0);
  });

  it("stops like a real step, and stays stopped", async () => {
    const h = harness([], { ctx: { caps: { ...payContext(new FakeLedger(), wallet.address).caps, runUsd: 0.02 } } });
    await simulateInferenceStep(h.ctx, { contentChars: 14_500, messages: 2 });
    expect((await h.stops(simulateInferenceStep(h.ctx, { contentChars: 18_700, messages: 4 }))).reason).toBe("run_cap");
    expect((await h.stops(simulateInferenceStep(h.ctx, { contentChars: 10, messages: 1 }))).reason).toBe("run_cap");
    expect(h.ledger.rows.size).toBe(1);

    const refused = harness([]);
    refused.ledger.refuse = "agent_day_cap";
    expect((await refused.stops(simulateInferenceStep(refused.ctx, { contentChars: 10, messages: 1 }))).reason).toBe("agent_day_cap");

    const unknown = harness([], { ctx: { model: "someone/else" } });
    expect((await unknown.stops(simulateInferenceStep(unknown.ctx, { contentChars: 10, messages: 1 }))).reason).toBe("model_unavailable");
  });

  it("shares the run's step count with the fetch", async () => {
    const h = harness([], { env: { X402_MOCK: "1" } });
    await simulateInferenceStep(h.ctx, { contentChars: 100, messages: 1 });
    await h.fetch(...chatRequest());
    expect([...h.ledger.rows.values()].map((row) => row.input.seq)).toEqual([0, 1]);
  });
});

describe("probeInferenceSignature", () => {
  it("gets a real quote, has the wallet sign it, checks the bytes, and sends nothing", async () => {
    const h = harness([quote(blockrunSolanaSmall402())], { env: { INFERENCE_USDC: undefined } });
    const result = await probeWith({ walletId: "wallet_1", address: wallet.address }, h.deps);
    if (!result.ok) throw new Error(result.reason);

    // One request left the process, and it carried no payment.
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].paid).toBe(false);
    expect(Object.keys(h.sent[0].headers).sort()).toEqual(["accept", "content-type"]);
    expect(h.sent[0].redirect).toBe("manual");
    // Not a strategy prompt: a fixed, tiny request with the output cap a real step has.
    expect(JSON.parse(h.sent[0].body)).toEqual({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: INFERENCE_MAX_OUTPUT_TOKENS,
    });
    expect(h.signer.asked).toBe(1);
    expect(h.ledger.events).toEqual([]);
    expect(result.checks.join("\n")).toContain("nothing was sent");
    expect(result.checks.join("\n")).toContain("93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX");
    // The signature itself is not in what the admin page is handed.
    expect(result.checks.join("\n")).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{80,}/);
  });

  it("works with the switch off: it is how a wallet is tested before the switch goes on", async () => {
    const h = harness([quote(blockrunSolanaSmall402())], { env: { INFERENCE_USDC: "off" } });
    expect((await probeWith({ walletId: "wallet_1", address: wallet.address }, h.deps)).ok).toBe(true);
  });

  it("says why it could not, and still sends no payment", async () => {
    const payer = { walletId: "wallet_1", address: wallet.address };

    const mock = harness([], { env: { X402_MOCK: "1" } });
    expect(await probeWith(payer, mock.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("mock mode") });
    expect(mock.sent).toHaveLength(0);

    const noRpc = harness([], { env: { SOLANA_RPC_URL: undefined } });
    expect(await probeWith(payer, noRpc.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("SOLANA_RPC_URL") });

    const paper = harness([]);
    expect(await probeWith({ walletId: "paper_solana_x", address: "PAPERabc" }, paper.deps)).toMatchObject({ ok: false });
    expect(paper.sent).toHaveLength(0);

    const offPins = harness([quote(blockrunBase402())]);
    expect(await probeWith(payer, offPins.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("pins") });
    expect(offPins.signer.asked).toBe(0);

    const down = harness([() => new Response("no", { status: 500 }), () => new Response("no", { status: 500 }), () => new Response("no", { status: 500 })]);
    expect(await probeWith(payer, down.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("quote_failed") });

    const free = harness([answer()]);
    expect(await probeWith(payer, free.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("without asking for payment") });

    const denied = harness([quote(blockrunSolanaSmall402())], {
      sign: async () => {
        throw new Error(`policy violation ${KEY_SHAPED}`);
      },
    });
    const refused = await probeWith(payer, denied.deps);
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("signature_failed") });
    expect(JSON.stringify(refused)).not.toContain(KEY_SHAPED);

    const dear = harness([
      () => {
        const paymentRequired = blockrunSolanaSmall402();
        paymentRequired.accepts[0].amount = "90000";
        return quoteResponse(paymentRequired);
      },
    ]);
    expect(await probeWith(payer, dear.deps)).toMatchObject({ ok: false, reason: expect.stringContaining("step cap") });
    expect(dear.signer.asked).toBe(0);

    for (const h of [mock, noRpc, paper, offPins, down, free, denied, dear]) {
      expect(h.sent.filter((sent) => sent.paid)).toHaveLength(0);
      expect(h.ledger.events).toEqual([]);
    }
  });
});
