import "server-only";
/**
 * Pay-per-use thinking: what is checked before a run starts, and what happens to an agent
 * that may not run.
 *
 * `./inference.ts` holds the rules (pure). This file is the half that reads and writes:
 *
 *  - {@link canThinkSql}: the SQL twin of `canThink`, for the two places that pick agents
 *    in the database (the scheduler, and the kill switch's count).
 *  - {@link preflightInference}: every reason a pay-per-use run must not start, checked
 *    before a run row exists. It reads the agent's USDC from the chain, never from an
 *    index, because the run that follows is allowed to spend it. A balance the chain
 *    could not give is not held against the agent at once: see {@link unreadableBalance}.
 *  - {@link applyInferenceHold}, {@link releaseInferenceHold}, {@link clearInferenceHold}:
 *    an agent that may not run is put on hold with a time to look again, and its owner
 *    is told once. It is not failing: no run row is written while it waits.
 *  - {@link recheckInferenceHolds}: looks again at holds whose time has come, outside any
 *    run slot.
 *  - {@link admitInferenceRun}: what the run loop calls. A key agent passes straight
 *    through; nothing here reads or writes anything for it.
 *
 * Nothing in this file signs or pays. A refusal here costs nothing, so in doubt it refuses.
 */
import { and, asc, eq, isNotNull, isNull, lte, not, or, sql, type SQL } from "drizzle-orm";
import { agents, getDb, users, wallets } from "@/db";
import type { AgentConfig, WalletBudget } from "@/db/schema";
import { notify } from "@/lib/notifications";
import { accruedFees } from "@/lib/platform/fees";
import { dbErrorForLog } from "@/lib/security/redact";
import { capsFor, controlStop, dayCapStop } from "@/lib/x402/inference-budget";
import { dayUsage, noteManualRun, readInferenceControl } from "@/lib/x402/inference-ledger";
import { SPL_TOKEN_PROGRAM, isSolanaAddress, usdcAccountOf } from "@/lib/x402/inference-pins";
import {
  INFERENCE_GATEWAY,
  OWNER_DAY_MANUAL_RUNS,
  TYPICAL_RUN,
  WALLET_FLOOR_USD,
  describeInferenceStop,
  estimateStepUsd,
  inferenceAllowedFor,
  inferenceFlags,
  isInferenceStopReason,
  payPerUseModel,
  roundUsd,
  type InferenceCaps,
  type InferenceFlags,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";
import { parseAgentConfig } from "./config";
import { NO_INFERENCE_HOLD, fitsInvocation, holdsAgent, isHeldAt, nextHold, thinkSource, thinkingModel, type HoldState } from "./inference";
import { isLlmMock } from "./mock-model";

// ---------- the predicate, in SQL ----------

/** True for a row whose config says it pays per use. A config with no `source` is a key agent. */
export function paysPerUseSql(): SQL<boolean> {
  return sql<boolean>`(coalesce(${agents.config} #>> '{llm,source}', 'key') = 'usdc')`;
}

/**
 * `canThink`, for a query: the agent has something to think on, and is not waiting out a
 * hold.
 *
 *  - A key agent needs a key, unless the scripted model (`LLM_MOCK=1`) is thinking for
 *    everyone. Exactly the test the scheduler made before pay-per-use existed.
 *  - A pay-per-use agent needs no key. It is left alone while a hold has time to run;
 *    once that time has come it is picked up again, and the check before its run decides.
 */
export function canThinkSql(now: Date, llmMock: boolean = isLlmMock()): SQL {
  const paysPerUse = paysPerUseSql();
  const notWaiting = or(isNull(agents.inferenceHold), isNull(agents.inferenceHoldUntil), lte(agents.inferenceHoldUntil, now));
  const hasKey = llmMock ? sql`true` : isNotNull(agents.llmKeyId);
  return or(and(paysPerUse, notWaiting), and(not(paysPerUse), hasKey)) as SQL;
}

/**
 * A key agent with no key: the agents "attach this key to my keyless agents" is for. A
 * pay-per-use agent has no key on purpose and is never one of them.
 */
export function missingKeySql(): SQL {
  return and(isNull(agents.llmKeyId), not(paysPerUseSql())) as SQL;
}

/**
 * How many of an owner's agents think on a key and have none. What "attach this key to
 * my N agents without one" should offer: under the scripted model nobody is missing a
 * key, and an agent that pays per use never is.
 */
export async function countAgentsMissingKey(ownerId: string): Promise<number> {
  if (isLlmMock()) return 0;
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .where(and(eq(agents.ownerId, ownerId), missingKeySql()));
  return Number(row?.n ?? 0);
}

// ---------- who may use it ----------

/**
 * The owner's admin status, read the way the rest of the app reads it: their email
 * against `ADMIN_EMAILS`. Anything that goes wrong answers "not an admin", which can only
 * refuse.
 */
async function ownerIsAdmin(ownerId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId)).limit(1);
    const { isAdminEmail } = await import("@/lib/admin");
    return isAdminEmail(row?.email);
  } catch {
    return false;
  }
}

/** Whether this account may use pay-per-use under the switches as they are now. */
export async function inferenceAllowedForOwner(ownerId: string, flags: InferenceFlags = inferenceFlags()): Promise<boolean> {
  if (flags.stage === "off") return false;
  if (flags.stage === "on") return true;
  // Stage `owner`. The listed ids need no lookup; the admin list does.
  if (inferenceAllowedFor({ id: ownerId, isAdmin: false }, flags)) return true;
  return inferenceAllowedFor({ id: ownerId, isAdmin: await ownerIsAdmin(ownerId) }, flags);
}

// ---------- the wallet, read from the chain ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A healthy node answers this in well under a second. Past five, the answer is "could not say". */
const USDC_READ_TIMEOUT_MS = 5_000;

/**
 * A Solana wallet's USDC as the chain has it now, or null when the node could not say.
 *
 * Asked of the operator's own node, at `confirmed`, for the one token account a payment
 * is made from. Not Privy's balance endpoint: that is an index and can trail the chain by
 * minutes, and the run this decides about may spend what it reports.
 *
 * "No such account" is a balance of zero. Everything else that is not a clear answer (the
 * node is down, it answered something unexpected, the account belongs to another program)
 * is null, and the caller refuses. The endpoint is never put in an error or a log: it
 * carries the provider's key.
 */
export async function readSolanaUsdc(owner: string, rpcUrl: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const account = usdcAccountOf(owner);
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [account, { commitment: "confirmed", encoding: "jsonParsed" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(USDC_READ_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isRecord(body) || body.error !== undefined || !isRecord(body.result)) return null;
    const value = body.result.value;
    if (value === null) return 0;
    if (!isRecord(value) || value.owner !== SPL_TOKEN_PROGRAM || !isRecord(value.data) || !isRecord(value.data.parsed)) return null;
    const info = value.data.parsed.info;
    if (!isRecord(info) || info.mint !== INFERENCE_GATEWAY.solana.asset || info.owner !== owner || !isRecord(info.tokenAmount)) return null;
    const amount = info.tokenAmount.amount;
    if (typeof amount !== "string" || !/^\d{1,20}$/.test(amount)) return null;
    return Number(BigInt(amount)) / 10 ** INFERENCE_GATEWAY.solana.decimals;
  } catch {
    return null;
  }
}

// ---------- preflight ----------

/** What the check needs of an agent row. */
export interface PreflightAgent {
  id: string;
  ownerId: string;
  config: AgentConfig;
  walletBudget: WalletBudget | null;
}

export interface PreflightInput {
  agent: PreflightAgent;
  trigger: "schedule" | "manual" | "webhook";
  now?: Date;
  /**
   * Epoch ms at which the serverless invocation that would run the agent began. Leave it
   * out when no run is about to start in this invocation (a re-check of a hold).
   */
  invocationStartedAt?: number | null;
}

/** What the check touches outside the database. Production reads the environment and the chain. */
export interface PreflightDeps {
  env?: Record<string, string | undefined>;
  /** A wallet's USDC straight from the chain, or null when the chain could not say. */
  readUsdc?: (address: string) => Promise<number | null>;
}

/** What a run that may start pays with. Resolved once, here, and handed to the run. */
export interface InferencePlan {
  model: string;
  caps: InferenceCaps;
  payer: { walletId: string; address: string };
  /** Mock mode: nothing real can be paid, so the wallet was not checked. */
  simulated: boolean;
}

/** A refusal with a name. */
export interface PreflightStop {
  ok: false;
  kind: "stop";
  reason: InferenceStopReason;
  title: string;
  detail: string;
  note: string;
  /**
   * Set on the one refusal that is not yet a fact: the wallet's balance could not be
   * read from the chain, asked twice. The node may answer the next time it is asked, so
   * the callers that hold agents do not hold on this at once ({@link unreadableBalance}).
   */
  unreadable?: true;
}

export type PreflightResult =
  | ({ ok: true } & InferencePlan)
  | PreflightStop
  /** Nothing is wrong: the run would not fit in what is left of this invocation. It stays due. */
  | { ok: false; kind: "later" };

/**
 * Mock mode, for this check: the scripted model never calls the gateway, and with
 * `X402_MOCK=1` the inference fetch touches no network and no wallet. Either way nothing
 * real can be paid, so there is no node to ask and no wallet to check.
 */
function isSimulated(env: Record<string, string | undefined>): boolean {
  return env.LLM_MOCK === "1" || env.X402_MOCK === "1";
}

/**
 * Every reason a pay-per-use run must not start, in the order an owner would want to
 * hear them. Called before any run row is created, for scheduled and manual runs alike.
 *
 * It reads; it writes nothing. A refusal here has cost nothing. The same switches and
 * limits are checked again where money can move (the inference fetch, and `reserve` in
 * the ledger), so passing this is permission to try, never permission to pay.
 *
 * A database error is thrown, not turned into a reason: the caller starts no run and
 * puts no hold on an agent it could not read.
 */
export async function preflightInference(input: PreflightInput, deps: PreflightDeps = {}): Promise<PreflightResult> {
  const { agent } = input;
  const now = input.now ?? new Date();
  const env = deps.env ?? process.env;
  const config = agent.config;
  const model = thinkingModel(config);
  const flags = inferenceFlags(env);
  const caps = capsFor(config, flags);
  const stop = (reason: InferenceStopReason, note: string): PreflightStop => ({
    ok: false,
    kind: "stop",
    reason,
    ...describeInferenceStop(reason, { runCapUsd: caps.runUsd, dayCapUsd: caps.agentDayUsd, model }),
    note,
  });

  // 1. The switches. Off is the default, and off means no pay-per-use agent runs at all.
  if (!(await inferenceAllowedForOwner(agent.ownerId, flags))) return stop("flag_off", `INFERENCE_USDC is ${flags.stage}`);

  // 2. The admin's halt and the breakers' pause.
  const switched = controlStop(await readInferenceControl(), now);
  if (switched) return stop(switched, "the control row stops every payment");

  const simulated = isSimulated(env);

  // 3. Our own node. Without it the balance below cannot be read, and the payment itself
  //    would be built on a public endpoint nobody answers for.
  const rpcUrl = env.SOLANA_RPC_URL?.trim() ?? "";
  if (!simulated && !rpcUrl) return stop("no_rpc", "SOLANA_RPC_URL is not set");

  // 4. The model. A config that asks for pay-per-use without saying which model and how
  //    much is not given a default to spend. The settings form cannot save one like
  //    that, so this is a row written some other way; the same screen puts it right.
  const offered = payPerUseModel(config.llm.usdc?.model);
  if (!offered) return stop("model_unavailable", config.llm.usdc ? "the model is not offered" : "the config has no usdc block");
  const firstStepUsd = estimateStepUsd(offered, TYPICAL_RUN.openingChars, 2);
  if (caps.runUsd + 1e-9 < firstStepUsd || !(caps.agentDayUsd > 0)) {
    return stop("model_unavailable", "the config's limits do not cover one step on this model");
  }

  // 5. The wallet that pays: the agent's own, on Solana.
  const db = await getDb();
  const [wallet] = await db
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.agentId, agent.id), eq(wallets.kind, "agent_server"), eq(wallets.chain, "solana")))
    .orderBy(asc(wallets.createdAt))
    .limit(1);
  if (!wallet) return stop("no_wallet", "the agent has no Solana wallet");
  const payer = { walletId: wallet.id, address: wallet.address };

  if (!simulated) {
    if (payer.walletId.startsWith("paper_") || !isSolanaAddress(payer.address)) {
      return stop("no_wallet", "the Solana wallet is a paper placeholder");
    }
    // 6. The wallet's own limit. Without a policy the wallet signs whatever it is shown.
    const policy = agent.walletBudget?.policyIds?.solana;
    if (typeof policy !== "string" || policy.trim() === "") return stop("no_policy", "no Solana policy id on the agent");

    // 7. Enough USDC for a whole run, after what it already owes and the floor it keeps.
    const read = deps.readUsdc ?? ((address: string) => readSolanaUsdc(address, rpcUrl));
    const readable = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
    // One bad answer from a node is not a fact about the wallet or about the node, so it
    // is asked once more before anything is said. Still nothing: the refusal is marked,
    // and whoever holds agents decides whether this has gone on long enough to hold one.
    let usdc = await read(payer.address);
    if (!readable(usdc)) usdc = await read(payer.address);
    if (!readable(usdc)) return { ...stop("no_rpc", "the wallet's USDC could not be read from the chain"), unreadable: true };
    const owed = (await accruedFees(agent.id)).filter((fee) => fee.chain === "solana").reduce((sum, fee) => sum + Math.max(0, fee.amountUsd), 0);
    // The run limit and the floor (`runFundsNeededUsd` is this same sum, for the screens
    // that quote it). A live agent's trades are sized to leave this and one more run
    // behind: see `thinkingReserveUsd`.
    const free = roundUsd(usdc - owed - WALLET_FLOOR_USD);
    if (free + 1e-9 < caps.runUsd) {
      return stop("needs_funds", `$${usdc.toFixed(2)} in the wallet, $${owed.toFixed(2)} owed in fees, $${caps.runUsd.toFixed(2)} needed above the floor`);
    }
  }

  // 8. Room in today's counters for at least one step.
  const usage = await dayUsage({ ownerId: agent.ownerId, agentId: agent.id, day: now });
  const capped = dayCapStop(usage, caps, firstStepUsd);
  if (capped) return stop(capped, "today's counters have no room for a step");

  // 9. Runs started by hand are counted per owner per day.
  if (input.trigger === "manual" && usage.owner.manualRuns >= OWNER_DAY_MANUAL_RUNS) {
    return stop("manual_limit", `${usage.owner.manualRuns} manual runs today`);
  }

  // 10. Last, and not a fault: a run started with too little of the invocation left would
  //     be frozen by the platform mid-payment. It simply waits for the next pass.
  if (typeof input.invocationStartedAt === "number" && !fitsInvocation(input.invocationStartedAt, now.getTime())) {
    return { ok: false, kind: "later" };
  }

  return { ok: true, model: offered.id, caps, payer, simulated };
}

// ---------- holds ----------

/** The notification kind for a hold. Not one of the muteable kinds: an agent that stopped is always said. */
export const INFERENCE_HOLD_NOTICE = "inference_hold";

const HOLD_COLUMNS = {
  id: agents.id,
  ownerId: agents.ownerId,
  slug: agents.slug,
  name: agents.name,
  config: agents.config,
  inferenceHold: agents.inferenceHold,
  inferenceHoldSince: agents.inferenceHoldSince,
  inferenceHoldUntil: agents.inferenceHoldUntil,
  inferenceStrikes: agents.inferenceStrikes,
  inferenceNotifiedAt: agents.inferenceNotifiedAt,
} as const;

export interface AppliedHold {
  held: boolean;
  until: Date | null;
  /** Whether this call told the owner. */
  notified: boolean;
}

/**
 * Put a pay-per-use agent on hold for `reason`, or keep it there.
 *
 * Writes the reason, when to look again (later each time: see `nextHold`) and one more
 * strike. The owner is told once per hold, in the words of `describeInferenceStop`, with a
 * link to the agent. A hold already in force for the same reason is left exactly as it
 * is, so pressing Run now on a held agent neither pushes its next look further out nor
 * sends anything.
 *
 * A reason that only ends the run in hand (its limit, its time, its steps), and the cap
 * on runs started by hand, are not holds: nothing is written for them.
 */
export async function applyInferenceHold(agentId: string, reason: InferenceStopReason, now: Date = new Date()): Promise<AppliedHold> {
  if (!holdsAgent(reason)) return { held: false, until: null, notified: false };
  const db = await getDb();
  const [agent] = await db.select(HOLD_COLUMNS).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return { held: false, until: null, notified: false };

  if (agent.inferenceHold === reason && isHeldAt(agent, now)) {
    return { held: true, until: agent.inferenceHoldUntil, notified: false };
  }

  const next = nextHold(agent, reason, now);
  const hold = {
    inferenceHold: next.inferenceHold,
    inferenceHoldSince: next.inferenceHoldSince,
    inferenceHoldUntil: next.inferenceHoldUntil,
    inferenceStrikes: next.inferenceStrikes,
  };

  // The hold and the claim on its notification are one statement: of two servers that
  // reach the same hold at once, one finds "told" already moved and says nothing, and a
  // failure half-way cannot leave an owner marked as told about a hold that was not set.
  let claimed = false;
  if (next.notify) {
    const unchanged = agent.inferenceNotifiedAt === null ? isNull(agents.inferenceNotifiedAt) : eq(agents.inferenceNotifiedAt, agent.inferenceNotifiedAt);
    const rows = await db
      .update(agents)
      .set({ ...hold, inferenceNotifiedAt: now })
      .where(and(eq(agents.id, agentId), unchanged))
      .returning({ id: agents.id });
    claimed = rows.length > 0;
  }
  if (!claimed) await db.update(agents).set(hold).where(eq(agents.id, agentId));

  if (claimed) {
    const usdc = agent.config?.llm?.usdc;
    const said = describeInferenceStop(reason, {
      runCapUsd: usdc?.maxUsdPerRun,
      dayCapUsd: usdc?.maxUsdPerDay,
      model: thinkingModel(agent.config),
    });
    // `notify` never throws and redacts what it writes.
    await notify([
      {
        userId: agent.ownerId,
        kind: INFERENCE_HOLD_NOTICE,
        title: `${agent.name}: ${said.title}`,
        body: said.detail,
        href: `/agents/${agent.slug}`,
      },
    ]);
  }
  return { held: true, until: next.inferenceHoldUntil, notified: claimed };
}

/**
 * Lift a hold because the check before a run passed. The agent is due again at once.
 *
 * The strikes and the fact that the owner was told are kept: passing the check is not a
 * run that worked. If the run that follows stops again, the next hold waits longer than
 * the last and says nothing new. Only {@link clearInferenceHold} starts the count again.
 */
export async function releaseInferenceHold(agentId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(agents)
    .set({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null })
    .where(and(eq(agents.id, agentId), isNotNull(agents.inferenceHold)));
}

/**
 * A run worked (or the agent no longer pays per use): no hold, no strikes, and the next
 * hold, if there is one, is said afresh. Touches nothing on a row that has none of these.
 */
export async function clearInferenceHold(agentId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(agents)
    .set(NO_INFERENCE_HOLD)
    .where(
      and(
        eq(agents.id, agentId),
        or(
          isNotNull(agents.inferenceHold),
          isNotNull(agents.inferenceNotifiedAt),
          sql`${agents.inferenceStrikes} <> 0`,
          // The note of a balance that could not be read (`unreadableBalance`).
          isNotNull(agents.inferenceHoldSince),
        ),
      ),
    );
}

// ---------- a balance the chain could not give ----------

/** An unreadable balance is held against an agent only when it is still unreadable this long after it first was. */
export const UNREADABLE_GRACE_MS = 10 * 60_000;
/** A first failure older than this is forgotten: nobody was looking at the agent in between, so it says nothing about now. */
export const UNREADABLE_FORGET_MS = 60 * 60_000;
/** A hold whose re-check could not read the chain is looked at again this soon. */
export const UNREADABLE_LOOK_AGAIN_MS = 5 * 60_000;

/**
 * What becomes of an agent whose wallet balance the chain could not give (asked twice in
 * one check): `defer` its run and look again soon, or `hold` it.
 *
 * One bad answer from a node is a blip, not a fact about the agent. Held on the spot, a
 * healthy agent lost its run and at least fifteen minutes, and its owner was told that
 * pay-per-use "is not set up"; an agent held for an empty wallet was flipped to this
 * reason and back, and its owner told to add USDC again each time. So:
 *
 *  - Held for `no_rpc` already: it has lasted. `hold`, and the wait grows as for any hold.
 *  - Held for something else: that hold stays exactly as it is, reason and strikes and
 *    all, and is looked at again in five minutes (never sooner than it already would be).
 *    Nothing is said, and nothing new will be when the node answers again. `defer`.
 *  - Not held: the moment is noted and the run is put off. The agent stays due, so the
 *    next pass looks again. Only when a later look still cannot read the balance, ten
 *    minutes or more after the first, is it a `hold`, with its notice.
 *
 * The note is `inference_hold_since` on a row with no `inference_hold`. Every reader of a
 * hold asks for the reason first, so that pair shows nowhere and holds nothing; a balance
 * that is read, a real hold and a run that works each wipe it.
 */
async function unreadableBalance(agent: { id: string } & HoldState, now: Date): Promise<"defer" | "hold"> {
  if (agent.inferenceHold === "no_rpc") return "hold";
  const db = await getDb();

  if (agent.inferenceHold) {
    const soon = new Date(now.getTime() + UNREADABLE_LOOK_AGAIN_MS);
    if (!agent.inferenceHoldUntil || agent.inferenceHoldUntil.getTime() < soon.getTime()) {
      // Only if the hold is still the one that was read: a hold changed in between is left alone.
      await db
        .update(agents)
        .set({ inferenceHoldUntil: soon })
        .where(and(eq(agents.id, agent.id), eq(agents.inferenceHold, agent.inferenceHold)));
    }
    return "defer";
  }

  const firstAt = agent.inferenceHoldSince?.getTime() ?? null;
  const lasted = firstAt === null ? null : now.getTime() - firstAt;
  if (lasted !== null && lasted >= UNREADABLE_GRACE_MS && lasted <= UNREADABLE_FORGET_MS) return "hold";
  if (lasted === null || lasted < 0 || lasted > UNREADABLE_FORGET_MS) {
    await db
      .update(agents)
      .set({ inferenceHoldSince: now })
      .where(and(eq(agents.id, agent.id), isNull(agents.inferenceHold)));
  }
  return "defer";
}

/**
 * The check got past the balance (or never needed it): whatever was noted about not being
 * able to read it is over. Writes nothing for a row with no such note, which is every row
 * but the few a node has just failed.
 */
async function forgetUnreadableBalance(agent: { id: string } & Pick<HoldState, "inferenceHold" | "inferenceHoldSince">): Promise<void> {
  if (agent.inferenceHold || !agent.inferenceHoldSince) return;
  const db = await getDb();
  await db
    .update(agents)
    .set({ inferenceHoldSince: null })
    .where(and(eq(agents.id, agent.id), isNull(agents.inferenceHold)));
}

// ---------- looking again ----------

export interface RecheckCounts {
  /** Holds whose time had come and that were looked at. */
  checked: number;
  /** Lifted: the agent is due again. */
  cleared: number;
  /** Still stopped: the hold was given a later time. */
  extended: number;
  /** Could not be looked at (a database error). Left as they were. */
  failed: number;
}

/** A pass looks at this many holds unless told otherwise. */
const RECHECK_DEFAULT_LIMIT = 25;
/** And stops starting new looks after this long: each one may ask the chain for a balance. */
const RECHECK_BUDGET_MS = 20_000;

export interface RecheckOptions extends PreflightDeps {
  /** Stop starting new looks after this long. The tick pass gives less than the default: its runs are waiting. */
  budgetMs?: number;
}

/**
 * Look again at held pay-per-use agents whose time has come.
 *
 * No run is started and no run slot is used: for each agent the check before a run is
 * repeated, and its hold is either lifted (the scheduler then finds it due) or given a
 * later time. Bounded by `limit` and by a wall-clock budget, oldest first, so a long
 * queue is worked through over several passes and never holds one up. Never throws.
 *
 * Called from the tick pass before it picks agents, and safe to call from anywhere else
 * with no arguments.
 */
export async function recheckInferenceHolds(limit: number = RECHECK_DEFAULT_LIMIT, now: Date = new Date(), options: RecheckOptions = {}): Promise<RecheckCounts> {
  const counts: RecheckCounts = { checked: 0, cleared: 0, extended: 0, failed: 0 };
  const bound = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 200)) : RECHECK_DEFAULT_LIMIT;
  const budgetMs = typeof options.budgetMs === "number" && options.budgetMs >= 0 ? options.budgetMs : RECHECK_BUDGET_MS;
  const deps: PreflightDeps = { env: options.env, readUsdc: options.readUsdc };
  let due: Array<typeof agents.$inferSelect>;
  try {
    const db = await getDb();
    due = await db
      .select()
      .from(agents)
      .where(
        and(
          // A paused or draft agent is not about to run; its hold is looked at when it is.
          eq(agents.status, "active"),
          isNotNull(agents.inferenceHold),
          or(isNull(agents.inferenceHoldUntil), lte(agents.inferenceHoldUntil, now)),
        ),
      )
      .orderBy(asc(agents.inferenceHoldUntil), asc(agents.id))
      .limit(bound);
  } catch (err) {
    console.error(`[inference] held agents could not be read: ${dbErrorForLog(err)}`);
    return counts;
  }

  const startedAt = Date.now();
  for (const agent of due) {
    if (Date.now() - startedAt > budgetMs) break;
    counts.checked += 1;
    try {
      const config = storedConfig(agent);
      if (thinkSource(config) !== "usdc") {
        // It went back to its owner's key since: there is nothing left to hold.
        await clearInferenceHold(agent.id);
        counts.cleared += 1;
        continue;
      }
      const checked = await preflightInference({ agent: { ...agent, config }, trigger: "schedule", now }, deps);
      if (checked.ok || checked.kind === "later") {
        await releaseInferenceHold(agent.id);
        counts.cleared += 1;
      } else if (checked.unreadable && (await unreadableBalance(agent, now)) === "defer") {
        // The chain could not say. The hold it has stays as it is, for a few minutes more.
        counts.extended += 1;
      } else {
        await applyInferenceHold(agent.id, checked.reason, now);
        counts.extended += 1;
      }
    } catch (err) {
      counts.failed += 1;
      console.error(`[inference] hold on ${agent.id} could not be re-checked: ${dbErrorForLog(err)}`);
    }
  }
  return counts;
}

// ---------- what the run loop calls ----------

/** A stored config as the run loop reads it: parsed, or as stored when it no longer parses. */
function storedConfig(agent: { config: AgentConfig }): AgentConfig {
  try {
    return parseAgentConfig(agent.config);
  } catch {
    return agent.config;
  }
}

export type RunAdmission =
  /** `pay` is null for a key agent, which this file has nothing to say about. */
  | { ok: true; pay: InferencePlan | null }
  | { ok: false; kind: "stop"; reason: InferenceStopReason; title: string; detail: string }
  | { ok: false; kind: "later" };

/** What {@link admitInferenceRun} needs of an agent row: the columns the check and the hold read. */
export type AdmissionAgent = PreflightAgent & HoldState;

/**
 * May this agent's run start. Called by the run loop before it writes a run row.
 *
 *  - A key agent: yes, and nothing is read or written.
 *  - A pay-per-use agent on a scheduled run that is waiting out a hold: no, and nothing
 *    changes. (The scheduler does not pick such an agent; this covers every other caller.)
 *  - Otherwise the check is run now. A run started by hand always gets it, whatever the
 *    hold says. A refusal puts the agent on hold; a pass lifts the hold it had, and, for
 *    a run started by hand, counts it against the owner's day.
 *  - One refusal is not acted on at once: a wallet balance the chain could not give. The
 *    run is put off like one that would not fit its invocation, and the agent is held
 *    only if the balance is still unreadable ten minutes on (`unreadableBalance`).
 */
export async function admitInferenceRun(
  agent: AdmissionAgent,
  input: { trigger: "schedule" | "manual" | "webhook"; now?: Date; invocationStartedAt?: number | null },
  deps: PreflightDeps = {},
): Promise<RunAdmission> {
  const config = storedConfig(agent);
  if (thinkSource(config) !== "usdc") return { ok: true, pay: null };

  const now = input.now ?? new Date();
  const usdc = config.llm.usdc;
  const refuse = (reason: InferenceStopReason): RunAdmission => ({
    ok: false,
    kind: "stop",
    reason,
    ...describeInferenceStop(reason, { runCapUsd: usdc?.maxUsdPerRun, dayCapUsd: usdc?.maxUsdPerDay, model: thinkingModel(config) }),
  });

  if (input.trigger !== "manual" && isHeldAt(agent, now) && isInferenceStopReason(agent.inferenceHold)) {
    return refuse(agent.inferenceHold);
  }

  const checked = await preflightInference(
    { agent: { id: agent.id, ownerId: agent.ownerId, config, walletBudget: agent.walletBudget }, trigger: input.trigger, now, invocationStartedAt: input.invocationStartedAt },
    deps,
  );
  if (!checked.ok) {
    if (checked.kind === "stop" && checked.unreadable) {
      // The chain could not give the wallet's balance. Not a hold yet, and nothing is
      // said: the run is put off and the agent stays due. See `unreadableBalance`.
      if ((await unreadableBalance(agent, now)) === "defer") return { ok: false, kind: "later" };
    } else {
      await forgetUnreadableBalance(agent);
    }
    if (checked.kind === "later") return checked;
    if (holdsAgent(checked.reason)) await applyInferenceHold(agent.id, checked.reason, now);
    return { ok: false, kind: "stop", reason: checked.reason, title: checked.title, detail: checked.detail };
  }

  // Counted only now, when the run will really start. The count is the limit: two Run
  // now presses at the last allowed run cannot both get through.
  if (input.trigger === "manual" && !(await noteManualRun(agent.ownerId, now))) {
    await forgetUnreadableBalance(agent);
    return refuse("manual_limit");
  }

  if (agent.inferenceHold) await releaseInferenceHold(agent.id);
  else await forgetUnreadableBalance(agent);
  return { ok: true, pay: { model: checked.model, caps: checked.caps, payer: checked.payer, simulated: checked.simulated } };
}
