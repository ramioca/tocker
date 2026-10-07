/**
 * The check before a pay-per-use run, and the holds.
 *
 * Nothing here can pay: the check only reads, and its two outside reads (the environment
 * and the chain) are handed in. The database is the real code against in-memory PGlite,
 * so the day counters, the control row, the fee ledger and the hold columns are the ones
 * production reads and writes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { AgentConfig } from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { pauseInference, setInferenceHalt, clearInferencePause } from "@/lib/x402/inference-ledger";
import { usdcAccountOf, SPL_TOKEN_PROGRAM } from "@/lib/x402/inference-pins";
import {
  AGENT_DAY_REQUESTS,
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_GATEWAY,
  INFERENCE_STOPS,
  OWNER_DAY_MANUAL_RUNS,
  WALLET_FLOOR_USD,
  describeInferenceStop,
  utcDay,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { thinkingReserveUsd } from "./inference";
import {
  INFERENCE_HOLD_NOTICE,
  UNREADABLE_FORGET_MS,
  UNREADABLE_GRACE_MS,
  UNREADABLE_LOOK_AGAIN_MS,
  admitInferenceRun,
  applyInferenceHold,
  clearInferenceHold,
  countAgentsMissingKey,
  inferenceAllowedForOwner,
  preflightInference,
  readSolanaUsdc,
  recheckInferenceHolds,
  releaseInferenceHold,
  type PreflightDeps,
  type PreflightResult,
} from "./inference-gate";
import { attachLlmKey, seedAgent, setupTestDb } from "./test-support";

// `@/lib/admin` reads the session module; nothing here signs anyone in.
vi.mock("@/lib/auth", () => ({ getSession: async () => null, requireSession: async () => null }));

let db: Db;

const BONK_ID = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const USDC_ID = tokenId("solana", USDC_SOLANA);
const NOW = new Date("2026-10-06T12:00:00.000Z");
const RPC = "https://rpc.test.invalid";
/** The real path: the switch on, our own node named, and no mock mode. */
const LIVE_ENV = { INFERENCE_USDC: "on", SOLANA_RPC_URL: RPC };
const minutesAfter = (from: Date, to: Date | null) => (to ? (to.getTime() - from.getTime()) / 60_000 : Number.NaN);

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(async () => {
  // One control row and one platform counter are shared by every agent; start each case clear.
  await db.delete(schema.inferenceControl);
  await db.delete(schema.inferenceBudgetDays);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function usdcConfig(usdc: Partial<NonNullable<AgentConfig["llm"]["usdc"]>> = {}): Pick<AgentConfig, "llm" | "chains"> {
  return {
    chains: ["solana"],
    llm: {
      ...DEFAULT_AGENT_CONFIG.llm,
      source: "usdc",
      usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3, ...usdc },
    },
  };
}

/**
 * A pay-per-use agent with a real-looking Solana wallet (an address made here, a wallet
 * id that is not a paper placeholder) and a wallet policy, which is what the real path
 * asks for. `wallet: "paper"` leaves the seeded placeholder; `wallet: "none"` removes it.
 */
async function payingAgent(
  options: { usdc?: Partial<NonNullable<AgentConfig["llm"]["usdc"]>>; wallet?: "real" | "paper" | "none"; policy?: boolean; mode?: "paper" | "live" } = {},
) {
  const seeded = await seedAgent(db, { config: usdcConfig(options.usdc), mode: options.mode });
  const address = Keypair.generate().publicKey.toBase58();
  if (options.wallet !== "paper") {
    await db.delete(schema.wallets).where(and(eq(schema.wallets.agentId, seeded.agentId), eq(schema.wallets.chain, "solana")));
  }
  if (options.wallet === undefined || options.wallet === "real") {
    await db.insert(schema.wallets).values({ id: `wal_${nanoid(12)}`, kind: "agent_server", chain: "solana", address, userId: seeded.userId, agentId: seeded.agentId });
  }
  if (options.policy !== false) {
    await db
      .update(schema.agents)
      .set({ walletBudget: { perTxUsd: 100, policyIds: { solana: `pol_${nanoid(8)}` } } })
      .where(eq(schema.agents.id, seeded.agentId));
  }
  return { ...seeded, address };
}

async function rowOf(agentId: string) {
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!row) throw new Error("agent row missing");
  return row;
}

/** The check, on the real path, with the wallet's balance handed in. */
async function check(
  agentId: string,
  options: { usdc?: number | null; env?: Record<string, string | undefined>; trigger?: "schedule" | "manual"; now?: Date; invocationStartedAt?: number } = {},
): Promise<{ result: PreflightResult; reads: string[] }> {
  const reads: string[] = [];
  const deps: PreflightDeps = {
    env: options.env ?? LIVE_ENV,
    readUsdc: async (address) => {
      reads.push(address);
      return options.usdc === undefined ? 10 : options.usdc;
    },
  };
  const agent = await rowOf(agentId);
  const result = await preflightInference(
    { agent, trigger: options.trigger ?? "schedule", now: options.now ?? NOW, invocationStartedAt: options.invocationStartedAt },
    deps,
  );
  return { result, reads };
}

function reasonOf(result: PreflightResult): InferenceStopReason | "later" | null {
  if (result.ok) return null;
  return result.kind === "later" ? "later" : result.reason;
}

/** A fee this agent owes on a chain: an accrued row, which needs a trade to hang on. */
async function oweFee(agent: { agentId: string; userId: string }, chain: "solana" | "base", usd: number) {
  const tradeId = nanoid();
  await db.insert(schema.trades).values({
    id: tradeId,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: "buy",
    tokenId: BONK_ID,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(1, 12),
    amountUsd: toNumeric(1, 6),
    priceUsd: toNumeric(1, 12),
    feeUsd: toNumeric(0, 6),
    status: "filled",
    isPaper: false,
    origin: "manual",
  });
  await db.insert(schema.platformFees).values({ id: nanoid(), agentId: agent.agentId, tradeId, chain, amountUsd: toNumeric(usd, 6) });
}

async function setDay(scope: "platform" | "owner" | "agent", scopeId: string, values: { usd?: number; requests?: number; manualRuns?: number }, day = utcDay(NOW)) {
  await db
    .insert(schema.inferenceBudgetDays)
    .values({ scope, scopeId, day, usd: toNumeric(values.usd ?? 0, 6), requests: values.requests ?? 0, manualRuns: values.manualRuns ?? 0 });
}

async function noticesFor(userId: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
}

describe("preflightInference: a run that may start", () => {
  it("passes with the model, the limits and the agent's own Solana wallet as the payer", async () => {
    const agent = await payingAgent({ usdc: { model: "openai/gpt-4o-mini", maxUsdPerRun: 0.5, maxUsdPerDay: 4 } });
    const { result, reads } = await check(agent.agentId, { usdc: 0.5 + WALLET_FLOOR_USD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(result.payer.address).toBe(agent.address);
    expect(result.payer.walletId.startsWith("paper_")).toBe(false);
    expect(result.caps.runUsd).toBe(0.5);
    expect(result.caps.agentDayUsd).toBe(4);
    expect(result.simulated).toBe(false);
    // The balance asked for is that wallet's, and it was asked once.
    expect(reads).toEqual([agent.address]);
  });

  it("writes nothing: no hold, no notification, no counter", async () => {
    const agent = await payingAgent();
    await check(agent.agentId, { usdc: 0 });
    const row = await rowOf(agent.agentId);
    expect(row.inferenceHold).toBeNull();
    expect(row.inferenceStrikes).toBe(0);
    expect(await noticesFor(agent.userId)).toHaveLength(0);
    expect(await db.select().from(schema.inferenceBudgetDays)).toHaveLength(0);
  });
});

describe("preflightInference: one test per refusal", () => {
  it("flag_off: the switch is off, which is the default", async () => {
    const agent = await payingAgent();
    for (const env of [{}, { INFERENCE_USDC: "" }, { INFERENCE_USDC: "off" }, { INFERENCE_USDC: "yes" }]) {
      const { result, reads } = await check(agent.agentId, { env: { ...env, SOLANA_RPC_URL: RPC } });
      expect(reasonOf(result)).toBe("flag_off");
      // Nothing further was looked at, the chain least of all.
      expect(reads).toEqual([]);
    }
  });

  it("flag_off: mock mode does not turn the switch on", async () => {
    const agent = await payingAgent({ wallet: "paper" });
    for (const env of [{ LLM_MOCK: "1", X402_MOCK: "1" }, { LLM_MOCK: "1" }, { X402_MOCK: "1" }]) {
      expect(reasonOf((await check(agent.agentId, { env })).result)).toBe("flag_off");
    }
  });

  it("flag_off: at the owner stage, an account that is neither listed nor an admin", async () => {
    const agent = await payingAgent();
    const env = { INFERENCE_USDC: "owner", SOLANA_RPC_URL: RPC };
    expect(reasonOf((await check(agent.agentId, { env })).result)).toBe("flag_off");

    // Listed by id: allowed.
    expect((await check(agent.agentId, { env: { ...env, INFERENCE_USDC_USER_IDS: `someone-else, ${agent.userId}` } })).result.ok).toBe(true);

    // An admin, the way the app reads admins: the account's email against ADMIN_EMAILS.
    const email = `${nanoid(6).toLowerCase()}@example.test`;
    await db.update(schema.users).set({ email }).where(eq(schema.users.id, agent.userId));
    expect(reasonOf((await check(agent.agentId, { env })).result)).toBe("flag_off");
    vi.stubEnv("ADMIN_EMAILS", `first@example.test, ${email.toUpperCase()}`);
    expect((await check(agent.agentId, { env })).result.ok).toBe(true);
    expect(await inferenceAllowedForOwner(agent.userId, { stage: "owner", userIds: [], hardStepUsd: 0.25, ownerDayUsd: 25, platformDayUsd: 2 })).toBe(true);
  });

  it("halted: the admin's switch", async () => {
    const agent = await payingAgent();
    await setInferenceHalt({ halted: true, reason: "checking a payment", by: "admin" });
    const { result, reads } = await check(agent.agentId);
    expect(reasonOf(result)).toBe("halted");
    expect(reads).toEqual([]);

    await setInferenceHalt({ halted: false, reason: null, by: "admin" });
    expect((await check(agent.agentId)).result.ok).toBe(true);
  });

  it("paused: a breaker's pause, until it runs out", async () => {
    const agent = await payingAgent();
    await pauseInference(30, "three paid steps got no answer", NOW);
    expect(reasonOf((await check(agent.agentId)).result)).toBe("paused");
    expect(reasonOf((await check(agent.agentId, { now: new Date(NOW.getTime() + 29 * 60_000) })).result)).toBe("paused");
    expect((await check(agent.agentId, { now: new Date(NOW.getTime() + 31 * 60_000) })).result.ok).toBe(true);
    await clearInferencePause("admin", NOW);
  });

  it("no_rpc: our own node is not named", async () => {
    const agent = await payingAgent();
    for (const env of [{ INFERENCE_USDC: "on" }, { INFERENCE_USDC: "on", SOLANA_RPC_URL: "   " }]) {
      const { result, reads } = await check(agent.agentId, { env });
      expect(reasonOf(result)).toBe("no_rpc");
      expect(reads).toEqual([]);
    }
  });

  it("no_rpc: the wallet's balance could not be read from the chain, asked twice, and the refusal says it may pass", async () => {
    const agent = await payingAgent();
    for (const unreadable of [null, Number.NaN, -1]) {
      const { result, reads } = await check(agent.agentId, { usdc: unreadable });
      expect(reasonOf(result)).toBe("no_rpc");
      // Marked, so that whoever holds agents does not hold one over a single bad answer.
      expect(result).toMatchObject({ ok: false, kind: "stop", unreadable: true });
      expect(reads).toEqual([agent.address, agent.address]);
    }
  });

  it("no refusal but that one is marked as passing: a node that is not named, a wallet that is short", async () => {
    const agent = await payingAgent();
    const unnamed = (await check(agent.agentId, { env: { INFERENCE_USDC: "on" } })).result;
    expect(reasonOf(unnamed)).toBe("no_rpc");
    expect("unreadable" in unnamed).toBe(false);
    const short = (await check(agent.agentId, { usdc: 0 })).result;
    expect(reasonOf(short)).toBe("needs_funds");
    expect("unreadable" in short).toBe(false);
  });

  it("asks the chain once more before it says the balance could not be read, and takes the second answer", async () => {
    const agent = await payingAgent();
    const answers: Array<number | null> = [null, 10];
    const reads: string[] = [];
    const result = await preflightInference(
      { agent: await rowOf(agent.agentId), trigger: "schedule", now: NOW },
      {
        env: LIVE_ENV,
        readUsdc: async (address) => {
          reads.push(address);
          return answers.shift() ?? null;
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(reads).toEqual([agent.address, agent.address]);
  });

  it("model_unavailable: the model is not one of the offered ones", async () => {
    const agent = await payingAgent({ usdc: { model: "anthropic/claude-opus-5.5" } });
    const { result } = await check(agent.agentId);
    expect(reasonOf(result)).toBe("model_unavailable");
    if (!result.ok && result.kind === "stop") expect(result.detail).toContain("anthropic/claude-opus-5.5");
  });

  it("model_unavailable: the config asks for pay-per-use without a model or limits", async () => {
    const agent = await payingAgent();
    const llm = { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" as const };
    await db.update(schema.agents).set({ config: { ...DEFAULT_AGENT_CONFIG, chains: ["solana"], llm } }).where(eq(schema.agents.id, agent.agentId));
    expect(reasonOf((await check(agent.agentId)).result)).toBe("model_unavailable");

    // Limits that are not numbers are not given a default to spend either.
    const broken = { ...llm, usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: Number.NaN, maxUsdPerDay: 3 } };
    await db.update(schema.agents).set({ config: { ...DEFAULT_AGENT_CONFIG, chains: ["solana"], llm: broken } }).where(eq(schema.agents.id, agent.agentId));
    expect(reasonOf((await check(agent.agentId)).result)).toBe("model_unavailable");
  });

  it("no_wallet: the agent has no Solana wallet", async () => {
    const agent = await payingAgent({ wallet: "none" });
    expect(reasonOf((await check(agent.agentId)).result)).toBe("no_wallet");
  });

  it("no_wallet: its Solana wallet is a paper placeholder", async () => {
    const agent = await payingAgent({ wallet: "paper" });
    const { result, reads } = await check(agent.agentId);
    expect(reasonOf(result)).toBe("no_wallet");
    expect(reads).toEqual([]);
  });

  it("no_policy: the wallet has no spending limit applied", async () => {
    const agent = await payingAgent({ policy: false });
    expect(reasonOf((await check(agent.agentId)).result)).toBe("no_policy");

    // A policy on Base is not a policy on the wallet that pays.
    await db.update(schema.agents).set({ walletBudget: { perTxUsd: 100, policyIds: { base: "pol_base" } } }).where(eq(schema.agents.id, agent.agentId));
    const { result, reads } = await check(agent.agentId);
    expect(reasonOf(result)).toBe("no_policy");
    expect(reads).toEqual([]);
  });

  it("needs_funds: the wallet does not cover a whole run above the floor", async () => {
    const agent = await payingAgent({ usdc: { maxUsdPerRun: 0.3 } });
    const needed = 0.3 + WALLET_FLOOR_USD;
    expect(reasonOf((await check(agent.agentId, { usdc: 0 })).result)).toBe("needs_funds");
    expect(reasonOf((await check(agent.agentId, { usdc: needed - 0.000001 })).result)).toBe("needs_funds");
    expect((await check(agent.agentId, { usdc: needed })).result.ok).toBe(true);
  });

  it("needs_funds: what it owes in fees on Solana is not its to spend", async () => {
    const agent = await payingAgent({ usdc: { maxUsdPerRun: 0.3 } });
    const needed = 0.3 + WALLET_FLOOR_USD;
    await oweFee(agent, "solana", 0.1);
    expect(reasonOf((await check(agent.agentId, { usdc: needed })).result)).toBe("needs_funds");
    expect((await check(agent.agentId, { usdc: needed + 0.1 })).result.ok).toBe(true);

    // A fee owed on Base is paid from the Base wallet, and does not count against this one.
    await oweFee(agent, "base", 5);
    expect((await check(agent.agentId, { usdc: needed + 0.1 })).result.ok).toBe(true);
  });

  /**
   * What a live agent holds back from its buys, against what this check asks for. The
   * agent buys mid-run with every dollar a buy may spend, so its wallet is left at
   * exactly the reserve; the same run then goes on thinking, by as much as its whole
   * limit; and its next run must still be let in. With one run held back the reserve
   * equalled what this check asks for, any step paid after the buy took the wallet under
   * it, and the agent's own trade put it on a `needs_funds` hold.
   */
  it("needs_funds: not after a buy that used all the spendable cash and a whole run's thinking on top", async () => {
    for (const maxUsdPerRun of [0.05, 0.3, 2]) {
      const agent = await payingAgent({ usdc: { maxUsdPerRun, maxUsdPerDay: 50 }, mode: "live" });
      const config = (await rowOf(agent.agentId)).config;
      const leftAfterTheBuy = thinkingReserveUsd(config);
      const leftAfterTheRun = leftAfterTheBuy - maxUsdPerRun;
      expect((await check(agent.agentId, { usdc: leftAfterTheRun })).result.ok).toBe(true);
      // With one run held back, the same buy and the same run leave the floor alone, which this check refuses.
      expect(reasonOf((await check(agent.agentId, { usdc: leftAfterTheRun - maxUsdPerRun })).result)).toBe("needs_funds");
    }
  });

  it("platform_day_cap: every agent together has reached today's limit", async () => {
    const agent = await payingAgent();
    await setDay("platform", "all", { usd: 2 });
    expect(reasonOf((await check(agent.agentId)).result)).toBe("platform_day_cap");
    // A platform limit of zero is the off switch.
    await db.delete(schema.inferenceBudgetDays);
    expect(reasonOf((await check(agent.agentId, { env: { ...LIVE_ENV, INFERENCE_PLATFORM_DAILY_USD: "0" } })).result)).toBe("platform_day_cap");
  });

  it("owner_day_cap: the account has reached what one account may spend in a day", async () => {
    const agent = await payingAgent();
    await setDay("owner", agent.userId, { usd: 25 });
    expect(reasonOf((await check(agent.agentId, { env: { ...LIVE_ENV, INFERENCE_PLATFORM_DAILY_USD: "250" } })).result)).toBe("owner_day_cap");
  });

  it("request_limit: the agent has made its paid requests for the day", async () => {
    const agent = await payingAgent();
    await setDay("agent", agent.agentId, { requests: AGENT_DAY_REQUESTS });
    expect(reasonOf((await check(agent.agentId)).result)).toBe("request_limit");
  });

  it("agent_day_cap: the agent has spent the limit its owner set for a day", async () => {
    const agent = await payingAgent({ usdc: { maxUsdPerRun: 0.3, maxUsdPerDay: 1 } });
    await setDay("agent", agent.agentId, { usd: 1 });
    const { result } = await check(agent.agentId);
    expect(reasonOf(result)).toBe("agent_day_cap");
    if (!result.ok && result.kind === "stop") expect(result.detail).toContain("$1.00");

    // Yesterday's spending is yesterday's.
    expect((await check(agent.agentId, { now: new Date(NOW.getTime() + 86_400_000) })).result.ok).toBe(true);
  });

  it("manual_limit: the owner has started the day's runs by hand, and scheduled runs do not care", async () => {
    const agent = await payingAgent();
    await setDay("owner", agent.userId, { manualRuns: OWNER_DAY_MANUAL_RUNS });
    expect(reasonOf((await check(agent.agentId, { trigger: "manual" })).result)).toBe("manual_limit");
    expect((await check(agent.agentId, { trigger: "schedule" })).result.ok).toBe(true);
  });

  it("later: too little of the invocation is left, which is nobody's fault", async () => {
    const agent = await payingAgent();
    const begun = NOW.getTime() - 60_000;
    expect(reasonOf((await check(agent.agentId, { invocationStartedAt: begun })).result)).toBe("later");
    expect((await check(agent.agentId, { invocationStartedAt: NOW.getTime() - 10_000 })).result.ok).toBe(true);
    // With no invocation to fit into (a re-check of a hold), time is not asked about.
    expect((await check(agent.agentId)).result.ok).toBe(true);
  });

  it("names a fault before it says there is no time, so a hold is not put off a pass", async () => {
    const agent = await payingAgent();
    expect(reasonOf((await check(agent.agentId, { usdc: 0, invocationStartedAt: NOW.getTime() - 200_000 })).result)).toBe("needs_funds");
  });

  it("says each refusal in the sentence written for it, once", async () => {
    const agent = await payingAgent();
    const { result } = await check(agent.agentId, { usdc: 0 });
    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== "stop") return;
    const said = describeInferenceStop("needs_funds");
    expect(result.title).toBe(said.title);
    expect(result.detail).toBe(said.detail);
  });
});

describe("preflightInference: mock mode", () => {
  const MOCK_ENV = { INFERENCE_USDC: "on", LLM_MOCK: "1", X402_MOCK: "1" };

  it("asks no node and checks no wallet: nothing real can be paid", async () => {
    const agent = await payingAgent({ wallet: "paper", policy: false });
    const { result, reads } = await check(agent.agentId, { env: MOCK_ENV, usdc: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulated).toBe(true);
    expect(result.payer.walletId.startsWith("paper_")).toBe(true);
    expect(reads).toEqual([]);
  });

  it("still applies the switches, the model list, the day limits and the need for a Solana wallet", async () => {
    const agent = await payingAgent({ wallet: "paper", policy: false, usdc: { maxUsdPerDay: 1 } });
    await setInferenceHalt({ halted: true, reason: "drill", by: "admin" });
    expect(reasonOf((await check(agent.agentId, { env: MOCK_ENV })).result)).toBe("halted");
    await setInferenceHalt({ halted: false, reason: null, by: "admin" });

    await setDay("agent", agent.agentId, { usd: 1 });
    expect(reasonOf((await check(agent.agentId, { env: MOCK_ENV })).result)).toBe("agent_day_cap");

    const walletless = await payingAgent({ wallet: "none" });
    expect(reasonOf((await check(walletless.agentId, { env: MOCK_ENV })).result)).toBe("no_wallet");
  });
});

describe("readSolanaUsdc", () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const account = usdcAccountOf(owner);
  const tokenAccount = (amount: string, overrides: Record<string, unknown> = {}) => ({
    jsonrpc: "2.0",
    id: 1,
    result: {
      context: { slot: 1 },
      value: {
        owner: SPL_TOKEN_PROGRAM,
        data: { program: "spl-token", parsed: { type: "account", info: { mint: INFERENCE_GATEWAY.solana.asset, owner, tokenAmount: { amount, decimals: 6 }, ...overrides } } },
      },
    },
  });
  const answering = (body: unknown, status = 200) => {
    const calls: Array<{ url: string; body: { method: string; params: unknown[] } }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { fetchImpl, calls };
  };

  it("reads the wallet's own USDC account, at confirmed, from the node it was given", async () => {
    const { fetchImpl, calls } = answering(tokenAccount("1234567"));
    expect(await readSolanaUsdc(owner, RPC, fetchImpl)).toBeCloseTo(1.234567, 6);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(RPC);
    expect(calls[0]?.body.method).toBe("getAccountInfo");
    expect(calls[0]?.body.params[0]).toBe(account);
    expect(calls[0]?.body.params[1]).toMatchObject({ commitment: "confirmed" });
  });

  it("reads a wallet with no USDC account as holding none", async () => {
    const { fetchImpl } = answering({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: null } });
    expect(await readSolanaUsdc(owner, RPC, fetchImpl)).toBe(0);
  });

  it("answers null, never zero, when the node did not give a clear answer", async () => {
    const unclear: Array<[unknown, number?]> = [
      [{ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "node is behind" } }],
      [tokenAccount("1000000"), 503],
      [{ jsonrpc: "2.0", id: 1 }],
      [tokenAccount("1000000", { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" })],
      [tokenAccount("1000000", { owner: Keypair.generate().publicKey.toBase58() })],
      [tokenAccount("1.5")],
      [tokenAccount("-1")],
      ["not json at all"],
    ];
    for (const [body, status] of unclear) {
      expect(await readSolanaUsdc(owner, RPC, answering(body, status).fetchImpl)).toBeNull();
    }
    const failing = (async () => {
      throw new Error(`connect ECONNREFUSED ${RPC}?api-key=${nanoid(32)}`);
    }) as unknown as typeof fetch;
    expect(await readSolanaUsdc(owner, RPC, failing)).toBeNull();
    expect(await readSolanaUsdc("not-an-address", RPC, answering(tokenAccount("1")).fetchImpl)).toBeNull();
  });
});

describe("holds", () => {
  it("puts the agent on hold with the reason, when it began, when to look again, and one strike", async () => {
    const agent = await payingAgent();
    const applied = await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    expect(applied).toMatchObject({ held: true, notified: true });

    const row = await rowOf(agent.agentId);
    expect(row.inferenceHold).toBe("needs_funds");
    expect(row.inferenceHoldSince).toEqual(NOW);
    expect(minutesAfter(NOW, row.inferenceHoldUntil)).toBe(15);
    expect(row.inferenceStrikes).toBe(1);
    expect(row.inferenceNotifiedAt).toEqual(NOW);
  });

  it("tells the owner once, in the words written for the reason, with a link to the agent", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);

    const notices = await noticesFor(agent.userId);
    expect(notices).toHaveLength(1);
    const said = describeInferenceStop("needs_funds");
    expect(notices[0]?.kind).toBe(INFERENCE_HOLD_NOTICE);
    expect(notices[0]?.title).toBe(`Test Agent: ${said.title}`);
    expect(notices[0]?.body).toBe(said.detail);
    expect(notices[0]?.href).toBe(`/agents/${agent.slug}`);
    // Not the generic failure, which an owner may have muted.
    expect(notices.some((notice) => notice.kind === "run_failed")).toBe(false);
  });

  it("looks again later each time it is still stopped, and says nothing more", async () => {
    const agent = await payingAgent();
    const waits: number[] = [];
    let at = NOW;
    for (let i = 0; i < 6; i += 1) {
      const applied = await applyInferenceHold(agent.agentId, "needs_funds", at);
      waits.push(minutesAfter(at, applied.until));
      expect(applied.notified).toBe(i === 0);
      // The next look happens when this hold's time has come.
      at = new Date((applied.until as Date).getTime() + 1_000);
    }
    expect(waits).toEqual([15, 30, 60, 120, 360, 360]);
    expect((await rowOf(agent.agentId)).inferenceStrikes).toBe(6);
    expect((await rowOf(agent.agentId)).inferenceHoldSince).toEqual(NOW);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("leaves a hold that is in force for the same reason exactly as it is", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    const before = await rowOf(agent.agentId);

    // Run now, pressed five times before the wallet is funded.
    for (let i = 1; i <= 5; i += 1) {
      const again = await applyInferenceHold(agent.agentId, "needs_funds", new Date(NOW.getTime() + i * 60_000));
      expect(again).toEqual({ held: true, until: before.inferenceHoldUntil, notified: false });
    }
    const after = await rowOf(agent.agentId);
    expect(after.inferenceStrikes).toBe(1);
    expect(after.inferenceHoldUntil).toEqual(before.inferenceHoldUntil);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("waits for the next UTC day on a day limit", async () => {
    const agent = await payingAgent();
    const applied = await applyInferenceHold(agent.agentId, "agent_day_cap", NOW);
    expect(applied.until?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  it("tells the owner again only when the reason becomes one they can fix", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "quote_failed", NOW);
    // The provider is still down, and then Tocker pauses everything: not the owner's to fix.
    await applyInferenceHold(agent.agentId, "paused", new Date(NOW.getTime() + 16 * 60_000));
    await applyInferenceHold(agent.agentId, "gateway_error", new Date(NOW.getTime() + 60 * 60_000));
    expect(await noticesFor(agent.userId)).toHaveLength(1);

    // Now the wallet is short. That is news, and theirs to act on.
    const funds = await applyInferenceHold(agent.agentId, "needs_funds", new Date(NOW.getTime() + 180 * 60_000));
    expect(funds.notified).toBe(true);
    const notices = await noticesFor(agent.userId);
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.title).sort()).toEqual(
      [`Test Agent: ${describeInferenceStop("quote_failed").title}`, `Test Agent: ${describeInferenceStop("needs_funds").title}`].sort(),
    );
  });

  it("is not a hold when the reason only ends the run in hand, or caps runs started by hand", async () => {
    const agent = await payingAgent();
    for (const reason of ["run_cap", "deadline", "step_limit", "manual_limit"] as const) {
      expect(await applyInferenceHold(agent.agentId, reason, NOW)).toEqual({ held: false, until: null, notified: false });
    }
    const row = await rowOf(agent.agentId);
    expect(row.inferenceHold).toBeNull();
    expect(row.inferenceStrikes).toBe(0);
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("tells the owner once when two servers reach the same hold at the same moment", async () => {
    const agent = await payingAgent();
    const both = await Promise.all([
      applyInferenceHold(agent.agentId, "needs_funds", NOW),
      applyInferenceHold(agent.agentId, "needs_funds", NOW),
    ]);
    expect(both.filter((applied) => applied.notified)).toHaveLength(1);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("lifts a hold after a check that passed, keeping the strikes and the fact the owner was told", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "quote_failed", NOW);
    await releaseInferenceHold(agent.agentId);

    const lifted = await rowOf(agent.agentId);
    expect(lifted.inferenceHold).toBeNull();
    expect(lifted.inferenceHoldUntil).toBeNull();
    expect(lifted.inferenceStrikes).toBe(1);
    expect(lifted.inferenceNotifiedAt).toEqual(NOW);

    // The run that followed stopped the same way: a longer wait, and no second notice.
    const again = await applyInferenceHold(agent.agentId, "quote_failed", new Date(NOW.getTime() + 20 * 60_000));
    expect(again.notified).toBe(false);
    expect(minutesAfter(new Date(NOW.getTime() + 20 * 60_000), again.until)).toBe(30);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("starts afresh after a run that worked: no hold, no strikes, and the next hold is said", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    await applyInferenceHold(agent.agentId, "needs_funds", new Date(NOW.getTime() + 16 * 60_000));
    await clearInferenceHold(agent.agentId);

    const cleared = await rowOf(agent.agentId);
    expect(cleared).toMatchObject({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });

    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    const next = await applyInferenceHold(agent.agentId, "needs_funds", later);
    expect(next.notified).toBe(true);
    expect(minutesAfter(later, next.until)).toBe(15);
    expect(await noticesFor(agent.userId)).toHaveLength(2);
  });

  it("does nothing for an agent that does not exist", async () => {
    expect(await applyInferenceHold("no-such-agent", "needs_funds", NOW)).toEqual({ held: false, until: null, notified: false });
    await releaseInferenceHold("no-such-agent");
    await clearInferenceHold("no-such-agent");
  });
});

describe("recheckInferenceHolds", () => {
  // The re-check reads the environment itself; these cases hand it the real path.
  const deps = (usdc: number | null): PreflightDeps => ({ env: LIVE_ENV, readUsdc: async () => usdc });

  beforeEach(async () => {
    // A pass looks at every held agent in the table, so each case starts with none held.
    await db.update(schema.agents).set({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
  });

  it("lifts the hold of an agent whose wallet now covers a run, so the scheduler finds it due", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    const due = new Date(NOW.getTime() + 16 * 60_000);

    expect(await recheckInferenceHolds(25, due, deps(10))).toEqual({ checked: 1, cleared: 1, extended: 0, failed: 0 });
    const row = await rowOf(agent.agentId);
    expect(row.inferenceHold).toBeNull();
    // Not a run that worked: the strikes stay until one does.
    expect(row.inferenceStrikes).toBe(1);
  });

  it("gives a later time to an agent that is still stopped, and says nothing new", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    const due = new Date(NOW.getTime() + 16 * 60_000);

    expect(await recheckInferenceHolds(25, due, deps(0))).toEqual({ checked: 1, cleared: 0, extended: 1, failed: 0 });
    const row = await rowOf(agent.agentId);
    expect(row.inferenceHold).toBe("needs_funds");
    expect(row.inferenceStrikes).toBe(2);
    expect(minutesAfter(due, row.inferenceHoldUntil)).toBe(30);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("does not look at a hold before its time", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    expect(await recheckInferenceHolds(25, new Date(NOW.getTime() + 14 * 60_000), deps(10))).toEqual({ checked: 0, cleared: 0, extended: 0, failed: 0 });
    expect((await rowOf(agent.agentId)).inferenceHold).toBe("needs_funds");
  });

  it("leaves a paused agent's hold alone: it is not about to run", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, agent.agentId));
    expect((await recheckInferenceHolds(25, new Date(NOW.getTime() + 3_600_000), deps(10))).checked).toBe(0);
  });

  it("drops the hold of an agent that has gone back to its owner's key", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    await db.update(schema.agents).set({ config: { ...DEFAULT_AGENT_CONFIG, chains: ["solana"] } }).where(eq(schema.agents.id, agent.agentId));

    expect(await recheckInferenceHolds(25, new Date(NOW.getTime() + 3_600_000), deps(0))).toMatchObject({ checked: 1, cleared: 1 });
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
  });

  it("looks at no more than its limit in one pass, oldest first", async () => {
    const first = await payingAgent();
    const second = await payingAgent();
    const third = await payingAgent();
    await applyInferenceHold(second.agentId, "needs_funds", new Date(NOW.getTime() + 2 * 60_000));
    await applyInferenceHold(first.agentId, "needs_funds", NOW);
    await applyInferenceHold(third.agentId, "needs_funds", new Date(NOW.getTime() + 4 * 60_000));

    expect((await recheckInferenceHolds(2, new Date(NOW.getTime() + 3_600_000), deps(10))).checked).toBe(2);
    expect((await rowOf(first.agentId)).inferenceHold).toBeNull();
    expect((await rowOf(second.agentId)).inferenceHold).toBeNull();
    expect((await rowOf(third.agentId)).inferenceHold).toBe("needs_funds");
  });

  /**
   * A two-hour halt used to cost every held agent eight strikes, one per look, so the
   * first ordinary failure after it waited six hours. A halt is nobody's fault.
   */
  it("counts nothing against an agent for a halt it sat through: the first hiccup after it waits fifteen minutes", async () => {
    const agent = await payingAgent();
    await setInferenceHalt({ halted: true, reason: "checking a payment", by: "admin" });
    expect(await admitInferenceRun(await rowOf(agent.agentId), { trigger: "schedule", now: NOW }, deps(10))).toMatchObject({ ok: false, reason: "halted" });

    let at = NOW;
    for (let look = 0; look < 8; look += 1) {
      at = new Date(at.getTime() + 16 * 60_000);
      expect(await recheckInferenceHolds(25, at, deps(10))).toEqual({ checked: 1, cleared: 0, extended: 1, failed: 0 });
    }
    const halted = await rowOf(agent.agentId);
    expect(halted).toMatchObject({ inferenceHold: "halted", inferenceStrikes: 0 });
    expect(minutesAfter(at, halted.inferenceHoldUntil)).toBe(15);
    expect(await noticesFor(agent.userId)).toHaveLength(1);

    await setInferenceHalt({ halted: false, reason: null, by: "admin" });
    at = new Date(at.getTime() + 16 * 60_000);
    expect(await recheckInferenceHolds(25, at, deps(10))).toEqual({ checked: 1, cleared: 1, extended: 0, failed: 0 });

    // Its next run stops on the provider, once.
    const hiccup = await applyInferenceHold(agent.agentId, "quote_failed", at);
    expect(minutesAfter(at, hiccup.until)).toBe(15);
    expect((await rowOf(agent.agentId)).inferenceStrikes).toBe(1);
  });

  it("works with no arguments, and finds nothing to do when nobody is held", async () => {
    expect(await recheckInferenceHolds()).toEqual({ checked: 0, cleared: 0, extended: 0, failed: 0 });
  });
});

describe("admitInferenceRun", () => {
  const deps = (usdc: number | null): PreflightDeps => ({ env: LIVE_ENV, readUsdc: async () => usdc });

  it("lets a key agent through without reading or writing anything about pay-per-use", async () => {
    const seeded = await seedAgent(db);
    await attachLlmKey(db, seeded);
    const before = await rowOf(seeded.agentId);

    // The switch off, no node named, a balance reader that must never be called.
    const admitted = await admitInferenceRun(
      before,
      { trigger: "schedule", now: NOW },
      {
        env: {},
        readUsdc: async () => {
          throw new Error("a key agent's wallet was read");
        },
      },
    );
    expect(admitted).toEqual({ ok: true, pay: null });
    expect(await rowOf(seeded.agentId)).toEqual(before);
    expect(await db.select().from(schema.inferenceBudgetDays)).toHaveLength(0);
    expect(await noticesFor(seeded.userId)).toHaveLength(0);
  });

  it("holds a pay-per-use agent that may not run, and tells its owner", async () => {
    const agent = await payingAgent();
    const admitted = await admitInferenceRun(await rowOf(agent.agentId), { trigger: "schedule", now: NOW }, deps(0));
    expect(admitted).toMatchObject({ ok: false, kind: "stop", reason: "needs_funds", detail: describeInferenceStop("needs_funds").detail });
    expect((await rowOf(agent.agentId)).inferenceHold).toBe("needs_funds");
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("does not check a scheduled run again while a hold has time to run", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    let read = false;
    const admitted = await admitInferenceRun(
      await rowOf(agent.agentId),
      { trigger: "schedule", now: new Date(NOW.getTime() + 5 * 60_000) },
      {
        env: LIVE_ENV,
        readUsdc: async () => {
          read = true;
          return 10;
        },
      },
    );
    expect(admitted).toMatchObject({ ok: false, kind: "stop", reason: "needs_funds" });
    expect(read).toBe(false);
    expect((await rowOf(agent.agentId)).inferenceStrikes).toBe(1);
  });

  it("checks a run started by hand at once, whatever the hold says, and lifts the hold when it passes", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);

    const admitted = await admitInferenceRun(await rowOf(agent.agentId), { trigger: "manual", now: new Date(NOW.getTime() + 60_000) }, deps(10));
    expect(admitted.ok).toBe(true);
    if (admitted.ok) expect(admitted.pay?.payer.address).toBe(agent.address);
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
  });

  it("does not push a held agent's next look further out each time Run now is pressed", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    const before = await rowOf(agent.agentId);
    for (let i = 1; i <= 3; i += 1) {
      const admitted = await admitInferenceRun(await rowOf(agent.agentId), { trigger: "manual", now: new Date(NOW.getTime() + i * 60_000) }, deps(0));
      expect(admitted).toMatchObject({ ok: false, reason: "needs_funds" });
    }
    const after = await rowOf(agent.agentId);
    expect(after.inferenceHoldUntil).toEqual(before.inferenceHoldUntil);
    expect(after.inferenceStrikes).toBe(1);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("counts a run started by hand, and refuses the one past the day's limit without a hold", async () => {
    const agent = await payingAgent();
    await setDay("owner", agent.userId, { manualRuns: OWNER_DAY_MANUAL_RUNS - 1 });

    expect((await admitInferenceRun(await rowOf(agent.agentId), { trigger: "manual", now: NOW }, deps(10))).ok).toBe(true);
    const [counter] = await db
      .select()
      .from(schema.inferenceBudgetDays)
      .where(and(eq(schema.inferenceBudgetDays.scope, "owner"), eq(schema.inferenceBudgetDays.scopeId, agent.userId)));
    expect(counter?.manualRuns).toBe(OWNER_DAY_MANUAL_RUNS);

    const refused = await admitInferenceRun(await rowOf(agent.agentId), { trigger: "manual", now: NOW }, deps(10));
    expect(refused).toMatchObject({ ok: false, kind: "stop", reason: "manual_limit" });
    // Scheduled runs are not affected, so the agent is not held and nobody is notified.
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    expect(await noticesFor(agent.userId)).toHaveLength(0);
    expect((await admitInferenceRun(await rowOf(agent.agentId), { trigger: "schedule", now: NOW }, deps(10))).ok).toBe(true);
  });

  it("does not count a scheduled run, or a run by hand that was refused", async () => {
    const agent = await payingAgent();
    await admitInferenceRun(await rowOf(agent.agentId), { trigger: "schedule", now: NOW }, deps(10));
    await admitInferenceRun(await rowOf(agent.agentId), { trigger: "manual", now: NOW }, deps(0));
    const counters = await db
      .select()
      .from(schema.inferenceBudgetDays)
      .where(and(eq(schema.inferenceBudgetDays.scope, "owner"), eq(schema.inferenceBudgetDays.scopeId, agent.userId)));
    expect(counters.reduce((sum, row) => sum + row.manualRuns, 0)).toBe(0);
  });

  it("puts off a run that would not fit the invocation, with no hold", async () => {
    const agent = await payingAgent();
    const admitted = await admitInferenceRun(
      await rowOf(agent.agentId),
      { trigger: "schedule", now: NOW, invocationStartedAt: NOW.getTime() - 120_000 },
      deps(10),
    );
    expect(admitted).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("is never run with the switch unset: the agent is held and told to use a key", async () => {
    const agent = await payingAgent();
    const admitted = await admitInferenceRun(await rowOf(agent.agentId), { trigger: "schedule", now: NOW }, { env: { SOLANA_RPC_URL: RPC }, readUsdc: async () => 10 });
    expect(admitted).toMatchObject({ ok: false, kind: "stop", reason: "flag_off" });
    expect(INFERENCE_STOPS.flag_off).toBe("platform");
    expect((await rowOf(agent.agentId)).inferenceHold).toBe("flag_off");
    const notices = await noticesFor(agent.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toContain("your own API key");
  });
});

/**
 * One bad answer from a node used to hold a healthy agent for fifteen minutes and tell
 * its owner pay-per-use "is not set up", and to flip an agent held for an empty wallet to
 * `no_rpc` and back, telling its owner to add USDC again each time.
 */
describe("a balance the chain could not give", () => {
  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
  /** The chain's answers, in the order it is asked. Past the end it goes on giving the last. */
  const chain = (...answers: Array<number | null>): PreflightDeps & { asked: () => number } => {
    let asked = 0;
    return {
      env: LIVE_ENV,
      readUsdc: async () => {
        const answer = answers[Math.min(asked, answers.length - 1)] ?? null;
        asked += 1;
        return answer;
      },
      asked: () => asked,
    };
  };
  const admit = async (agentId: string, at: Date, deps: PreflightDeps, trigger: "schedule" | "manual" = "schedule") =>
    admitInferenceRun(await rowOf(agentId), { trigger, now: at }, deps);

  beforeEach(async () => {
    // The re-check pass looks at every held agent in the table.
    await db.update(schema.agents).set({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
  });

  it("runs a healthy agent whose first read failed and whose second did not: no hold, nothing said, nothing noted", async () => {
    const agent = await payingAgent();
    const node = chain(null, 10);
    expect((await admit(agent.agentId, NOW, node)).ok).toBe(true);
    expect(node.asked()).toBe(2);
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("puts the run off when neither read answered: no hold, no strike, no notice, and the agent stays due", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null))).toEqual({ ok: false, kind: "later" });

    const row = await rowOf(agent.agentId);
    expect(row).toMatchObject({ inferenceHold: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    expect(await noticesFor(agent.userId)).toHaveLength(0);
    // Not a hold on any screen, and not one to the re-check pass either.
    expect(await recheckInferenceHolds(25, minutes(1), chain(10))).toEqual({ checked: 0, cleared: 0, extended: 0, failed: 0 });

    // The next pass, five minutes on, reads it and runs it. Nothing is left behind.
    expect((await admit(agent.agentId, minutes(5), chain(10))).ok).toBe(true);
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceHoldSince: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("holds the agent, and tells its owner once, only when the balance is still unreadable ten minutes on", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null))).toEqual({ ok: false, kind: "later" });
    // The next pass: still put off, still nothing said.
    expect(await admit(agent.agentId, minutes(5), chain(null))).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    expect(await noticesFor(agent.userId)).toHaveLength(0);

    // The pass after that: it has lasted.
    const at = new Date(NOW.getTime() + UNREADABLE_GRACE_MS);
    expect(await admit(agent.agentId, at, chain(null))).toMatchObject({ ok: false, kind: "stop", reason: "no_rpc" });
    const row = await rowOf(agent.agentId);
    expect(row).toMatchObject({ inferenceHold: "no_rpc", inferenceStrikes: 1 });
    expect(minutesAfter(at, row.inferenceHoldUntil)).toBe(15);
    const notices = await noticesFor(agent.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toBe(`Test Agent: ${describeInferenceStop("no_rpc").title}`);

    // From here it is a hold like any other: looked at later each time, and nothing more said.
    const again = new Date((row.inferenceHoldUntil as Date).getTime() + 1_000);
    expect(await recheckInferenceHolds(25, again, chain(null))).toEqual({ checked: 1, cleared: 0, extended: 1, failed: 0 });
    const held = await rowOf(agent.agentId);
    expect(held).toMatchObject({ inferenceHold: "no_rpc", inferenceStrikes: 2 });
    expect(minutesAfter(again, held.inferenceHoldUntil)).toBe(30);
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("does not count two failures with a good read between them as one that lasted", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null))).toEqual({ ok: false, kind: "later" });
    expect((await admit(agent.agentId, minutes(5), chain(10))).ok).toBe(true);
    expect(await admit(agent.agentId, minutes(11), chain(null))).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("forgets a first failure nobody followed up within the hour: the next one starts the count again", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null))).toEqual({ ok: false, kind: "later" });
    const muchLater = new Date(NOW.getTime() + UNREADABLE_FORGET_MS + 60_000);
    expect(await admit(agent.agentId, muchLater, chain(null))).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    // Ten minutes after THAT one, it has lasted.
    expect(await admit(agent.agentId, new Date(muchLater.getTime() + UNREADABLE_GRACE_MS), chain(null))).toMatchObject({ ok: false, kind: "stop", reason: "no_rpc" });
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  /**
   * The note of a first failure is `inference_hold_since` on a row with no hold. A run
   * that works wipes everything about a hold, and that has to include the note: one
   * written by a second look while the run was in flight would otherwise sit on the row
   * and make the next blip, up to an hour later, count as one that had lasted.
   */
  it("is forgotten by a run that works, like everything else about a hold", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null))).toEqual({ ok: false, kind: "later" });
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceHoldSince: NOW });

    // What the run loop calls once a run has ended well.
    await clearInferenceHold(agent.agentId);
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });

    // So a blip eleven minutes after the first is a first one again.
    expect(await admit(agent.agentId, minutes(11), chain(null))).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    expect(await noticesFor(agent.userId)).toHaveLength(0);
  });

  it("tells a run started by hand to try again, without holding the agent", async () => {
    const agent = await payingAgent();
    expect(await admit(agent.agentId, NOW, chain(null), "manual")).toEqual({ ok: false, kind: "later" });
    expect(await admit(agent.agentId, minutes(1), chain(null), "manual")).toEqual({ ok: false, kind: "later" });
    expect((await rowOf(agent.agentId)).inferenceHold).toBeNull();
    // Not counted against the owner's day either: no run started.
    expect(await db.select().from(schema.inferenceBudgetDays)).toHaveLength(0);
  });

  it("leaves an agent held for an empty wallet exactly as it is, and does not tell its owner to add USDC twice", async () => {
    const agent = await payingAgent();
    await applyInferenceHold(agent.agentId, "needs_funds", NOW);
    const before = await rowOf(agent.agentId);
    expect(await noticesFor(agent.userId)).toHaveLength(1);

    // Its time comes and the node does not answer: same reason, same strikes, a look in five minutes.
    const due = minutes(16);
    expect(await recheckInferenceHolds(25, due, chain(null))).toEqual({ checked: 1, cleared: 0, extended: 1, failed: 0 });
    const blip = await rowOf(agent.agentId);
    expect(blip).toMatchObject({ inferenceHold: "needs_funds", inferenceStrikes: 1, inferenceHoldSince: before.inferenceHoldSince, inferenceNotifiedAt: before.inferenceNotifiedAt });
    expect((blip.inferenceHoldUntil as Date).getTime() - due.getTime()).toBe(UNREADABLE_LOOK_AGAIN_MS);

    // The node is back and the wallet is still empty: the same hold goes on. It was a
    // change of reason, to `no_rpc` and back, that used to send "Add USDC" again here.
    const next = new Date(due.getTime() + UNREADABLE_LOOK_AGAIN_MS + 1_000);
    expect(await recheckInferenceHolds(25, next, chain(0))).toEqual({ checked: 1, cleared: 0, extended: 1, failed: 0 });
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: "needs_funds", inferenceStrikes: 2 });
    expect(await noticesFor(agent.userId)).toHaveLength(1);

    // And however long the node stays down, that hold is never turned into this one.
    let at = minutes(120);
    for (let look = 0; look < 6; look += 1) {
      await recheckInferenceHolds(25, at, chain(null));
      at = new Date(at.getTime() + UNREADABLE_LOOK_AGAIN_MS + 1_000);
    }
    expect(await rowOf(agent.agentId)).toMatchObject({ inferenceHold: "needs_funds", inferenceStrikes: 2 });
    expect(await noticesFor(agent.userId)).toHaveLength(1);
  });

  it("does not bring a long hold's next look forward when Run now meets a node that does not answer", async () => {
    const agent = await payingAgent();
    // A fifth hold in a row: six hours to its next look.
    let at = NOW;
    for (let i = 0; i < 5; i += 1) {
      const applied = await applyInferenceHold(agent.agentId, "quote_failed", at);
      if (i < 4) at = new Date((applied.until as Date).getTime() + 1_000);
    }
    const before = await rowOf(agent.agentId);
    expect(minutesAfter(at, before.inferenceHoldUntil)).toBe(360);

    expect(await admit(agent.agentId, new Date(at.getTime() + 60_000), chain(null), "manual")).toEqual({ ok: false, kind: "later" });
    expect(await rowOf(agent.agentId)).toEqual(before);
  });
});

describe("countAgentsMissingKey", () => {
  it("counts key agents with no key, and never one that pays per use", async () => {
    vi.stubEnv("LLM_MOCK", "");
    const keyless = await seedAgent(db);
    const keyed = await seedAgent(db);
    await db.update(schema.agents).set({ ownerId: keyless.userId }).where(eq(schema.agents.id, keyed.agentId));
    await attachLlmKey(db, { userId: keyless.userId, agentId: keyed.agentId });
    const paying = await payingAgent();
    await db.update(schema.agents).set({ ownerId: keyless.userId }).where(eq(schema.agents.id, paying.agentId));

    expect(await countAgentsMissingKey(keyless.userId)).toBe(1);
    // The scripted model thinks for everyone: nobody is missing a key.
    vi.stubEnv("LLM_MOCK", "1");
    expect(await countAgentsMissingKey(keyless.userId)).toBe(0);
  });
});
