/**
 * One agent tick, end to end. See SPEC.md → "Agent run loop".
 *
 * Contract with the foundation workstream:
 *   - `runAgent(input)` creates its own `agent_runs` row and resolves when the run is
 *     over. `triggerRun` can call it fire-and-forget.
 *   - `startRun(input)` inserts the run row synchronously, returns `{ runId }`
 *     immediately, and finishes the work in the background — use this when the caller
 *     needs the id right away (e.g. to redirect to the run detail page).
 *
 * Concurrency: the run row is claimed with a conditional UPDATE that also asserts no
 * other run for this agent is `running`, so two schedulers racing produce one run and
 * one `skipped`.
 *
 * Liveness (W7 B3): on a serverless platform the function is frozen the moment the
 * response is sent, so a run continued on a detached promise dies mid-flight and leaves
 * its row `running` forever — and that row then blocks every future run through the
 * `NOT EXISTS` above. Two fixes, both here:
 *   - the background continuation is scheduled with `after()` from `next/server`, which
 *     keeps the invocation alive until the callback resolves;
 *   - a `queued`/`running` row whose clock started more than {@link STALE_RUN_MS} ago is
 *     treated as dead — {@link reapStaleRuns} marks it `failed`, and `claimRun` ignores
 *     it when deciding whether the agent is busy.
 *
 * Pay-per-use thinking: an agent whose config says `llm.source: "usdc"` has no key. Each
 * model step is bought from the inference gateway and paid by the agent's own wallet
 * (src/lib/x402/inference-types.ts). Three things differ for such a run, and only for it:
 *   - it is checked before its row exists (`admitInferenceRun`), so an agent that cannot
 *     pay is put on hold and told once, not failed on every tick;
 *   - its model call takes no retries, a capped answer, a last step forced to `finish`
 *     when its money or its time runs short, and a deadline that also counts from the
 *     start of the serverless invocation;
 *   - a stop named by the pay path (`InferencePayContext.stop`) ends the run as that stop
 *     says: a limit is a normal end, anything else fails the run and holds the agent,
 *     without the generic failure notice.
 * A key agent's run is what it was, apart from two columns saying it thought on a key and
 * on which model.
 *
 * A key agent's provider: the key's row names it, the registry (`providers.ts`) says
 * whether it is still one, and `providers-server.ts` builds its model and says what a
 * step sends with it. The key is decrypted in this file and handed down as it is needed;
 * nothing below keeps it. Whatever a failed run says has that exact key taken out of it
 * before it is stored, shown or sent.
 */
import { discoverAnthropicWorkspace, isWorkspaceScopeError, needsWorkspaceHeader } from "./anthropic-workspace";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { AISDKError, APICallError, RetryError, ToolChoiceViolationError, generateText, stepCountIs, type LanguageModel } from "ai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys, notifications, tokens, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { MIN_SCHEDULE_MINUTES, parseAgentConfig } from "@/lib/agent/config";
import { decryptSecret } from "@/lib/crypto";
import { dbErrorForLog, redactSecrets } from "@/lib/security/redact";
import { resolveDataSources } from "@/lib/data-sources/registry";
import { applyInferenceBreakers, createInferenceLedger, runInferenceSpend } from "@/lib/x402/inference-ledger";
import {
  INFERENCE_GATEWAY,
  INFERENCE_MAX_OUTPUT_TOKENS,
  NO_NEW_STEP_AFTER_MS,
  describeInferenceStop,
  newPayCounters,
  payPerUseModel,
  type InferencePayContext,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";
import { createInferenceFetch, simulateInferenceStep } from "@/lib/x402/paidFetch";
import { newBudget, type X402Context } from "@/lib/x402/types";
import { describeGuardian, runGuardian } from "@/lib/trading/guardian";
import { paidStepLimit, payDeadlineAt, stopOutcome, thinkSource, thinkingModel, wrapUpReason } from "./inference";
import { admitInferenceRun, applyInferenceHold, clearInferenceHold, type InferencePlan, type RunAdmission } from "./inference-gate";
import { RunLogger } from "./logger";
import { createMockModel, isLlmMock } from "./mock-model";
import { getAgentWallets, getPortfolio, snapshotEquity } from "./portfolio";
import { buildSystemPrompt, buildTickPrompt, type RecentTrade } from "./prompts";
import { PROVIDER_UNSUPPORTED, isProvider, providerLabel, providerRow, withArticle, type LlmProvider } from "./providers";
import { callOptionsFor, keyScrubber, modelFor, noScrub, sentenceInBody, type KeyScrub } from "./providers-server";
import { RUN_DEFERRED, RunRefusedError } from "./run-gate";
import { buildTools, type RunAgentRecord, type RunContext } from "./tools";

export interface RunAgentInput {
  agentId: string;
  trigger: "schedule" | "manual" | "webhook";
  /**
   * Epoch ms at which the serverless invocation doing this run began. The platform ends
   * an invocation at its time limit whatever is in flight, so a pay-per-use run counts
   * its deadline from here as well as from its own start, and is not started at all with
   * too little left. Defaults to now: a caller that passes nothing has a whole
   * invocation ahead of it (a manual run, a script).
   */
  invocationStartedAt?: number;
}

export interface RunAgentResult {
  runId: string;
  status: "succeeded" | "failed" | "skipped";
  summary?: string;
  error?: string;
  /** Pay-per-use only: the named reason the run stopped, or was not started. */
  stopReason?: InferenceStopReason;
}

/** The model a run thinks on, and what the run needs to know about where it came from. */
export interface ResolvedModel {
  model: LanguageModel;
  /**
   * The provider of the key the model was built from, which is the provider every
   * request goes to. Null when no key was used: the scripted model, and pay-per-use.
   */
  provider: LlmProvider | null;
  /**
   * Takes this run's key out of text. The key never leaves `resolveModel`; this is how
   * the run removes it from whatever a provider said when it failed. Does nothing for a
   * run that has no key.
   */
  scrub: KeyScrub;
}

/**
 * Builds the language model an agent thinks on.
 *
 * A key agent: from its owner's encrypted key. A pay-per-use agent: an OpenAI-compatible
 * client pointed at the pinned gateway, whose every request goes through the paying fetch
 * for this run (`pay`). The mode is the config's word and nothing else: a pay-per-use
 * agent never reaches the key lookup, even with a key id still on its row.
 *
 * A key agent's model comes with the provider it was built for and with a function that
 * removes the key from text (see {@link ResolvedModel}). Anything thrown from here after
 * the key was read has already been through that function.
 */
export async function resolveModel(
  agent: {
    ownerId: string;
    llmKeyId: string | null;
    config: AgentConfig;
  },
  pay?: InferencePayContext | null,
): Promise<ResolvedModel> {
  if (isLlmMock()) return { model: createMockModel(), provider: null, scrub: noScrub };

  if (thinkSource(agent.config) === "usdc") {
    // No context means nobody checked this run or resolved its limits. Thinking on the
    // owner's key instead would spend something they did not ask to spend.
    if (!pay) throw new Error("This agent pays for its own thinking, and this run was started without its payment limits. Nothing was paid.");
    const { createOpenAI } = await import("@ai-sdk/openai");
    // `.chat`: the gateway serves chat completions, and the provider's default form posts
    // to /responses. The key is a placeholder; the fetch drops the header it becomes.
    const model = createOpenAI({ baseURL: INFERENCE_GATEWAY[pay.chain].baseUrl, apiKey: "x402", fetch: createInferenceFetch(pay) }).chat(pay.model);
    return { model, provider: null, scrub: noScrub };
  }

  if (!agent.llmKeyId) {
    throw new Error("This agent has no LLM API key attached. Add one in Settings and re-select it on the agent.");
  }
  const db = await getDb();
  // By id and by owner. Attaching a key checks whose it is; this is the same check at
  // the moment the key is used, so an agent can never think on somebody else's key
  // whatever wrote the id onto its row.
  const rows = await db
    .select()
    .from(llmKeys)
    .where(and(eq(llmKeys.id, agent.llmKeyId), eq(llmKeys.userId, agent.ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("The LLM API key attached to this agent no longer exists.");

  // The column is plain text, so nothing in the database says this provider is still
  // one. A key saved for a provider that has since been dropped is refused here, before
  // it is decrypted, and never sent to whichever provider happens to come next.
  const provider: unknown = row.provider;
  if (!isProvider(provider)) throw new Error(PROVIDER_UNSUPPORTED);
  // The key decides the host and the settings decide the model id. When they name
  // different providers the model id means nothing to that host; say so here rather
  // than send it and store whatever the provider answers.
  if (provider !== agent.config.llm.provider) {
    throw new Error(
      `This agent's key is ${withArticle(provider)} key, but its settings name ${providerLabel(agent.config.llm.provider)}. Open the agent's settings and choose a key for the provider it is set to, or change the provider.`,
    );
  }

  // The decrypted key stays in this scope and is never logged or persisted.
  const apiKey = decryptSecret(row.encryptedKey);
  const scrub = keyScrubber(apiKey);
  try {
    // Anthropic only. An organization-level key must name the workspace it acts in.
    // Unknown yet? One free request tells whether the key needs the header, and the
    // Admin API (which such a key may call) says which workspace; it is saved on the
    // key so this happens once.
    const workspaceId = provider === "anthropic" ? (row.workspaceId ?? (await ensureAnthropicWorkspace(row.id, apiKey))) : null;
    // The host is the key's provider, never the config's: a key only goes where it was saved for.
    const model = await modelFor(provider, { apiKey, modelId: agent.config.llm.model, workspaceId });
    return { model, provider, scrub };
  } catch (err) {
    // The caller has no scrub yet, so what went wrong here leaves without the key in it.
    const said = err instanceof Error ? err.message : String(err);
    const clean = scrub(said);
    if (clean === said) throw err;
    throw new Error(clean);
  }
}

/**
 * A provider's error, with the one sentence that says what to do when we know it.
 * Everything else passes through untouched.
 */
export function explainProviderError(message: string, provider: LlmProvider | null = "anthropic"): string {
  // Advice about an Anthropic key belongs only under a run that used one. A Claude model
  // reached through another provider can produce the same words about a key that is not ours.
  if (provider === "anthropic" && /anthropic-workspace-id/i.test(message)) {
    return `${message} — This Anthropic key is organization-level and Tocker could not find a workspace it may act in. Under Settings → LLM API keys, add it again with a Workspace ID (Anthropic Console → Settings → Workspaces), or create the key inside a workspace; then select it on the agent.`;
  }
  // The gateway's client answers a refused key with advice for whoever deploys it: set
  // an environment variable, or use another module. The owner of an agent can do neither.
  if (provider === "vercel" && /unauthenticated/i.test(message) && /AI_GATEWAY_API_KEY/.test(message)) {
    const row = providerRow(provider);
    return `${row.label} refused this key. Create a new one on its key page (${row.keyPage}), add it under Settings → LLM API keys, and select it on the agent.`;
  }
  return message;
}

/** The phrase that goes with a status code, for the ones a provider refuses a request with. */
const STATUS_PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

const BARE_PHRASES: ReadonlySet<string> = new Set(
  [...Object.values(STATUS_PHRASES), "Unprocessable Content", "Content Too Large", "Gateway Time-out", "Error"].map((phrase) => phrase.toLowerCase()),
);

/** How much of a provider's own sentence is kept as the reason a run failed. */
const BODY_REASON_MAX = 300;

/** True for a message that says nothing: empty, or the name of a status code and no more. */
function saysNothing(message: string): boolean {
  const bare = message
    .trim()
    .replace(/^\d{3}[:\s-]*/, "")
    .replace(/[.!]$/, "")
    .toLowerCase();
  return bare.length === 0 || BARE_PHRASES.has(bare);
}

/**
 * What a failed run says went wrong, with no key in it.
 *
 * Usually the error's own message. The exception is a refused model call whose message
 * is empty or only "Unauthorized": the generic OpenAI-compatible client (Venice, Nebius,
 * Novita, Hugging Face) and Mistral's on a 401 cannot read those hosts' error bodies, so
 * the reason the provider gave is still in the body. It is taken from there, with the
 * status code in front: "401: Invalid API key". A body with no sentence to read (an HTML
 * error page) is never kept; the status code and its phrase stand in.
 *
 * A call the provider may be asked again (a rate limit, an overload) is retried by the
 * client, which then throws its own error around the last refusal: "Failed after 3
 * attempts. Last error: ". The refusal inside is read the same way, and the number of
 * attempts is said after it.
 *
 * `scrub` is the run's own, and it runs after the text is chosen: a provider repeats the
 * key it refused in its body as readily as in its message. The body's sentence is cut to
 * length only once the key is out of it, so a cut never leaves half a key behind.
 */
export function failureText(err: unknown, scrub: KeyScrub): string {
  const clean = (text: string) => redactSecrets(scrub(text));
  const message = err instanceof Error ? err.message : String(err);
  const retried = RetryError.isInstance(err);
  const call = retried ? err.lastError : err;
  if (!APICallError.isInstance(call) || !saysNothing(call.message)) return clean(message);

  const tries = retried && err.errors.length > 1 ? ` (after ${err.errors.length} attempts)` : "";
  const status = typeof call.statusCode === "number" ? call.statusCode : null;
  const sentence = clean(sentenceInBody(call.responseBody)).slice(0, BODY_REASON_MAX).trim();
  if (sentence.length > 0) return `${status === null ? sentence : `${status}: ${sentence}`}${tries}`;
  // Nothing to read. Whatever the body is, it is not stored.
  if (status === null) return clean(call.message).trim() || `The provider refused the request and gave no reason${tries}.`;
  return `${status}: ${STATUS_PHRASES[status] ?? "the provider gave no reason"}${tries}`;
}

async function saveDiscoveredWorkspace(keyId: string, apiKey: string): Promise<string | null> {
  const found = await discoverAnthropicWorkspace(apiKey);
  if (found.kind !== "found") {
    // The reason can be whatever a failed request said, so it is logged without the key.
    const reason = found.kind === "unknown" ? ` — ${redactSecrets(keyScrubber(apiKey)(found.reason))}` : "";
    console.warn(`[run] anthropic workspace for key ${keyId}: ${found.kind}${reason}`);
    return null;
  }
  const db = await getDb();
  await db.update(llmKeys).set({ workspaceId: found.workspaceId }).where(eq(llmKeys.id, keyId));
  return found.workspaceId;
}

/** Before the first call on a key with no saved workspace: does it need one, and which. */
async function ensureAnthropicWorkspace(keyId: string, apiKey: string): Promise<string | null> {
  if ((await needsWorkspaceHeader(apiKey)) !== true) return null;
  return saveDiscoveredWorkspace(keyId, apiKey);
}

/** After a run failed for want of the header anyway: find it, save it, report it. */
async function recoverAnthropicWorkspace(llmKeyId: string, ownerId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(llmKeys)
    .where(and(eq(llmKeys.id, llmKeyId), eq(llmKeys.userId, ownerId)))
    .limit(1);
  if (!row || row.provider !== "anthropic" || row.workspaceId) return null;
  return saveDiscoveredWorkspace(llmKeyId, decryptSecret(row.encryptedKey));
}

async function loadRecentTrades(agentId: string, limit = 10): Promise<RecentTrade[]> {
  const db = await getDb();
  const rows = await db
    .select({ trade: trades, token: tokens })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    side: r.trade.side,
    symbol: r.token.symbol,
    chain: r.trade.chain,
    amountUsd: Number(r.trade.amountUsd),
    priceUsd: Number(r.trade.priceUsd),
    status: r.trade.status,
    createdAt: r.trade.createdAt,
    rationale: r.trade.rationale,
  }));
}

function nextRunAt(config: AgentConfig, from: Date): Date | null {
  if (config.schedule.intervalMinutes <= 0) return null;
  // The schema applies the same floor, but `executeRun` falls back to the config as
  // stored when a row no longer parses (the schema has tightened since it was saved),
  // and a row like that must not be the one agent that is due again every minute.
  const minutes = Math.max(config.schedule.intervalMinutes, MIN_SCHEDULE_MINUTES);
  return new Date(from.getTime() + minutes * 60_000);
}

/** What a run is started with once it has been let in: when its invocation began, and what it pays with. */
interface RunStart {
  invocationStartedAt: number;
  /** Null for a key agent. */
  plan: InferencePlan | null;
}

/**
 * Before any run row is written: does the agent exist, and may its run start.
 *
 * Returns `null` when the agent does not exist (the `agent_runs.agent_id` foreign key
 * would reject the insert anyway). A key agent is always let in, with nothing read
 * beyond its own row. A pay-per-use agent is checked here, so one that cannot pay leaves
 * no failed run behind it (see `admitInferenceRun`).
 *
 * If the check itself cannot be made (the database did not answer), the run is put off:
 * no run, no hold, and the agent is still due on the next pass.
 */
async function admitRun(input: RunAgentInput, invocationStartedAt: number): Promise<RunAdmission | null> {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent) return null;
  try {
    return await admitInferenceRun(agent, { trigger: input.trigger, invocationStartedAt });
  } catch (err) {
    console.error(`[run] ${input.agentId} could not be checked before its run: ${dbErrorForLog(err)}`);
    return { ok: false, kind: "later" };
  }
}

/** Inserts a `queued` run row for an agent {@link admitRun} has let in. */
async function createRunRow(agentId: string, trigger: RunAgentInput["trigger"]): Promise<string> {
  const db = await getDb();
  const runId = nanoid();
  await db.insert(agentRuns).values({ id: runId, agentId, trigger, status: "queued" });
  return runId;
}

/**
 * How long a `queued`/`running` row may sit before it is presumed dead. The run itself
 * is capped well below this (`maxDuration` 300s on the route, a 240s abort on the model
 * call), so anything past ten minutes was killed by the platform, not by us.
 */
export const STALE_RUN_MS = 10 * 60_000;

/** What a reaped row's `error` says. Deliberately plain: an operator reads this. */
export const ABANDONED_RUN_ERROR = "abandoned: the function timed out";

/**
 * How long the model may think. Sits under the route's 300s `maxDuration` by a minute so
 * the run loop, not the platform, is the thing that gives up — and can say so on the row.
 */
export const RUN_MODEL_TIMEOUT_MS = 240_000;

/**
 * Marks every `queued`/`running` row older than {@link STALE_RUN_MS} as `failed`.
 *
 * Nothing else reads `agent_runs.status` to decide liveness, so without this a single
 * frozen invocation makes the agent permanently unrunnable: `claimRun` sees a `running`
 * row, refuses the claim, and the next run is cancelled — forever. Called from
 * `claimRun` (per agent), from both crons (globally), and from `triggerRun`.
 *
 * @param agentId Limit the sweep to one agent. Omit to reap every agent's.
 * @returns how many rows were reaped.
 */
export async function reapStaleRuns(agentId?: string, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  // Bound as ISO text on purpose: a Date inside a raw `sql` template is serialised with
  // Date#toString() ("Mon Sep 21 2026 14:58:23 GMT+0000 (...)"), which Postgres rejects.
  // PGlite in the tests tolerated it; Neon in production 500'd every cron pass.
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  const reaped = await db
    .update(agentRuns)
    .set({ status: "failed", error: ABANDONED_RUN_ERROR, finishedAt: now })
    .where(
      and(
        inArray(agentRuns.status, ["queued", "running"]),
        sql`coalesce(${agentRuns.startedAt}, ${agentRuns.createdAt}) < ${cutoff.toISOString()}`,
        ...(agentId === undefined ? [] : [eq(agentRuns.agentId, agentId)]),
      ),
    )
    .returning({ id: agentRuns.id, llmSource: agentRuns.llmSource });
  // A pay-per-use run that was frozen never reached the line that writes what it spent.
  // The ledger knows, so the row is given the figure here. Best effort: the ledger stays
  // the record either way, and a reap must never fail over a number on a dead row.
  for (const row of reaped) {
    if (row.llmSource !== "usdc") continue;
    try {
      const spent = await runInferenceSpend(row.id);
      await db.update(agentRuns).set({ inferenceSpendUsd: spent.usd.toFixed(6) }).where(eq(agentRuns.id, row.id));
    } catch (err) {
      console.error(`[run] thinking spend of reaped run ${row.id} could not be written: ${dbErrorForLog(err)}`);
    }
  }
  return reaped.length;
}

/**
 * Atomically moves the run from `queued` to `running`, but only if no other *live* run
 * for this agent is already `running`. A `running` row that stopped moving more than
 * {@link STALE_RUN_MS} ago is not live — it is reaped first, and ignored by the guard
 * even if the reap lost a race.
 */
async function claimRun(runId: string, agentId: string, now: Date = new Date()): Promise<boolean> {
  const db = await getDb();
  await reapStaleRuns(agentId, now);
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  const claimed = await db
    .update(agentRuns)
    .set({ status: "running", startedAt: now })
    .where(
      and(
        eq(agentRuns.id, runId),
        eq(agentRuns.status, "queued"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${agentRuns} AS other
          WHERE other.agent_id = ${agentId}
            AND other.status = 'running'
            AND coalesce(other.started_at, other.created_at) >= ${cutoff.toISOString()}
        )`,
      ),
    )
    .returning({ id: agentRuns.id });
  return claimed.length > 0;
}

/**
 * Executes one tick. Safe to call concurrently: a second caller gets
 * `status: "skipped"` while the first is still running.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const invocationStartedAt = input.invocationStartedAt ?? Date.now();
  const admission = await admitRun(input, invocationStartedAt);
  if (admission === null) return { runId: "", status: "failed", error: "Agent not found" };
  if (!admission.ok) {
    // A pay-per-use agent that may not run, or whose run would not fit what is left of
    // this invocation. No row is written: the agent is waiting, not failing.
    return admission.kind === "stop"
      ? { runId: "", status: "skipped", error: admission.detail, stopReason: admission.reason }
      : { runId: "", status: "skipped", error: RUN_DEFERRED };
  }
  const runId = await createRunRow(input.agentId, input.trigger);
  return executeRun(runId, input, { invocationStartedAt, plan: admission.pay });
}

/**
 * Creates the run row synchronously and returns its id, continuing the work in the
 * background. Foundation's `triggerRun` can use either this or `runAgent`.
 *
 * The continuation is handed to `after()` so the serverless invocation stays alive until
 * the tick is done: a bare `void executeRun(...)` is frozen the instant the response is
 * flushed, which is how a first live trade used to leave a `running` row that blocked
 * the agent forever. `after()` only exists inside a request scope, so scripts and tests
 * fall back to the detached promise — nothing freezes there.
 *
 * A pay-per-use agent that may not run throws {@link RunRefusedError} before any row is
 * written; its message is the sentence to show.
 */
export async function startRun(input: RunAgentInput): Promise<{ runId: string }> {
  const invocationStartedAt = input.invocationStartedAt ?? Date.now();
  const admission = await admitRun(input, invocationStartedAt);
  if (admission === null) throw new Error("Agent not found");
  if (!admission.ok) {
    throw admission.kind === "stop" ? new RunRefusedError(admission.detail, admission.reason) : new RunRefusedError(RUN_DEFERRED, null);
  }
  const runId = await createRunRow(input.agentId, input.trigger);
  const start: RunStart = { invocationStartedAt, plan: admission.pay };
  const finishInBackground = () =>
    executeRun(runId, input, start).catch(() => {
      // executeRun already records failures on the run row.
    });
  try {
    after(finishInBackground);
  } catch {
    void finishInBackground();
  }
  return { runId };
}

/**
 * The two writes to an agent's hold that follow a run. The run row is already written
 * when they are made, so a failure here is logged and left: a hold that was not cleared
 * lifts itself at the next look, and one that was not set is set by the next run to stop.
 * Neither may turn a run that has ended into one that threw.
 */
async function endHoldAfterRun(agentId: string): Promise<void> {
  try {
    await clearInferenceHold(agentId);
  } catch (err) {
    console.error(`[run] hold on ${agentId} could not be cleared: ${dbErrorForLog(err)}`);
  }
}

async function holdAfterStop(agentId: string, reason: InferenceStopReason, at: Date): Promise<void> {
  try {
    await applyInferenceHold(agentId, reason, at);
  } catch (err) {
    console.error(`[run] ${agentId} could not be put on hold (${reason}): ${dbErrorForLog(err)}`);
  }
}

/** What a pay-per-use run has been charged so far, from the ledger; the fetch's own count if the ledger cannot be read. */
async function thinkingSpendUsd(runId: string, pay: InferencePayContext): Promise<number> {
  try {
    return (await runInferenceSpend(runId)).usd;
  } catch (err) {
    console.error(`[run] thinking spend of run ${runId} could not be read: ${dbErrorForLog(err)}`);
    return pay.spentUsd;
  }
}

/** Roughly how much text a step sends, for pricing a simulated step. The scripted model has no request to measure. */
function promptSize(system: string, messages: readonly unknown[]): { contentChars: number; messages: number } {
  let contentChars = system.length;
  try {
    contentChars += JSON.stringify(messages).length;
  } catch {
    // Something in the transcript does not serialise. The opening prompt alone will do.
  }
  return { contentChars, messages: messages.length + 1 };
}

/**
 * What a finished run is summarised as. Pure.
 *
 * The summary `finish` accepted, when there is one. Otherwise the model's last free text,
 * which nothing bounded: it is stored and shown publicly, so it gets the same ceiling
 * `finish` puts on a summary. A pay-per-use run that was cut short (`cutShort` is the
 * sentence for the limit it reached) says that instead: its last free text is a remark
 * made mid-thought, not an account of the run.
 */
export function runSummary(accepted: string | null, lastText: string, cutShort: string | null): string | null {
  if (accepted !== null) return accepted;
  if (cutShort) return cutShort;
  return lastText.trim().slice(0, 1000) || null;
}

function isAbort(err: unknown): boolean {
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * The summary the model handed to `finish` in a step it was told to finish in.
 *
 * `finish` may send a model back once for more research or a fuller shortlist. A run
 * that is being wrapped up has no money or time for that, so what the model wrote is
 * taken as its summary whether or not the tool accepted it. Same ceiling as the tool's.
 */
function summaryOfForcedFinish(step: { toolCalls: ReadonlyArray<{ toolName: string; input?: unknown }> }): string | null {
  for (const call of step.toolCalls) {
    if (call.toolName !== "finish") continue;
    const summary = (call.input as { summary?: unknown } | null | undefined)?.summary;
    if (typeof summary === "string" && summary.trim().length >= 5) return summary.trim().slice(0, 1000);
  }
  return null;
}

async function executeRun(runId: string, input: RunAgentInput, start: RunStart): Promise<RunAgentResult> {
  const db = await getDb();
  const logger = new RunLogger(runId);

  const agentRows = await db.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  const agentRow = agentRows[0];
  if (!agentRow) {
    await db
      .update(agentRuns)
      .set({ status: "failed", error: "Agent not found", finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    return { runId, status: "failed", error: "Agent not found" };
  }

  if (!(await claimRun(runId, input.agentId))) {
    await db
      .update(agentRuns)
      .set({ status: "cancelled", error: "Another run is already in progress", finishedAt: new Date() })
      .where(eq(agentRuns.id, runId));
    return { runId, status: "skipped", error: "Another run is already in progress" };
  }

  const startedAt = new Date();
  let config: AgentConfig;
  try {
    config = parseAgentConfig(agentRow.config);
  } catch {
    config = agentRow.config;
  }

  // How this run thinks, written on its row whichever way it ends.
  const source = thinkSource(config);
  const thinking = { llmSource: source, model: thinkingModel(config) };

  // The context every paid step goes through, for a pay-per-use run that was let in. One
  // per run: the fetch counts the run's steps and spend on this object. A pay-per-use
  // agent that reaches here without a plan gets none, and `resolveModel` refuses it.
  const pay: InferencePayContext | null =
    source === "usdc" && start.plan
      ? {
          ownerId: agentRow.ownerId,
          agentId: agentRow.id,
          runId,
          model: start.plan.model,
          chain: "solana",
          payer: start.plan.payer,
          caps: start.plan.caps,
          // Set again when the model call starts, which is the moment its own cut-off is
          // counted from. Nothing can be paid before then: the fetch is not yet built.
          deadlineAt: payDeadlineAt(Date.now(), start.invocationStartedAt, RUN_MODEL_TIMEOUT_MS),
          ledger: createInferenceLedger(),
          ...newPayCounters(),
        }
      : null;
  if (pay) {
    // Said at the start as well as the end, so a run the platform froze half-way is
    // still known for a pay-per-use run and gets its spend from the ledger when reaped.
    await db.update(agentRuns).set(thinking).where(eq(agentRuns.id, runId));
  }

  const budget = newBudget(config.risk.maxDataSpendUsdPerRun);
  const wallets = await getAgentWallets(input.agentId);

  const agentRecord: RunAgentRecord = {
    id: agentRow.id,
    ownerId: agentRow.ownerId,
    slug: agentRow.slug,
    name: agentRow.name,
    mode: agentRow.mode,
    config,
  };

  const x402: X402Context = {
    agentId: agentRow.id,
    runId,
    mode: agentRow.mode,
    wallets,
    budget,
  };

  const ctx: RunContext = {
    runId,
    agent: agentRecord,
    x402,
    budget,
    logger,
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };

  // Pay-per-use only. Why the model was told to finish early, whether the run ran out of
  // time between steps, and the tokens counted step by step: a run that stops on a limit
  // ends in the catch below, where there is no result to read them from.
  let wrapUp: InferenceStopReason | null = null;
  let outOfTime = false;
  let modelCallStarted = false;
  const counted = { inputTokens: 0, outputTokens: 0 };
  let runSignal: AbortSignal | null = null;
  // Set once the model is built from a key. Until then no key has been read, and what
  // `resolveModel` throws has already had it taken out.
  let scrub: KeyScrub = noScrub;
  // Whose key the run thought on, once that is known. Null for a run with no key.
  let keyProvider: LlmProvider | null = null;

  /** Ends a pay-per-use run that stopped on one of its own limits: a normal end, as far as it got. */
  const finishAtLimit = async (reason: InferenceStopReason, paid: InferencePayContext): Promise<RunAgentResult> => {
    // No figures, here as in the success branch below: a run's summary is public (the run
    // list and the run page show it to anyone who can see the agent), and the limits are
    // the owner's own settings. Which limit it was is on the row as `stop_reason`.
    const summary = ctx.finished.summary ?? describeInferenceStop(reason, { model: paid.model }).detail;
    await logger.flush();

    const finalPortfolio = await getPortfolio(input.agentId);
    await snapshotEquity(finalPortfolio);

    const finishedAt = new Date();
    await db
      .update(agentRuns)
      .set({
        status: "succeeded",
        summary,
        finishedAt,
        dataSpendUsd: budget.spentUsd.toFixed(6),
        inputTokens: counted.inputTokens,
        outputTokens: counted.outputTokens,
        ...thinking,
        inferenceSpendUsd: (await thinkingSpendUsd(runId, paid)).toFixed(6),
        stopReason: reason,
      })
      .where(eq(agentRuns.id, runId));

    await db
      .update(agents)
      .set({ lastRunAt: finishedAt, nextRunAt: nextRunAt(config, finishedAt), updatedAt: finishedAt })
      .where(eq(agents.id, input.agentId));
    // It thought and it paid: whatever held it before is over.
    await endHoldAfterRun(input.agentId);

    return { runId, status: "succeeded", summary, stopReason: reason };
  };

  try {
    if (agentRow.mode === "live") {
      const usable = wallets.filter((w) => !w.walletId.startsWith("paper_") && w.address);
      const missing = config.chains.filter((c) => !usable.some((w) => w.chain === c));
      if (missing.length > 0) {
        throw new Error(
          `Live mode requires real Privy server wallets. Missing or placeholder wallet(s) for: ${missing.join(", ")}. Fund the agent or switch it back to paper.`,
        );
      }
    }

    const thought = await resolveModel({ ownerId: agentRow.ownerId, llmKeyId: agentRow.llmKeyId, config }, pay);
    scrub = thought.scrub;
    keyProvider = thought.provider;
    const model = thought.model;
    // Read by `buildTools` below: some providers refuse a free-form object parameter.
    ctx.freeFormParamsAsJson = thought.provider ? providerRow(thought.provider).freeFormParams === "json-string" : false;
    // What each step sends beside the prompt and the tools. A key agent: what its key's
    // provider takes (`callOptionsFor`), which for Anthropic is its prompt caching. A run
    // with no key (pay-per-use, the scripted model) is sent what it always was; the
    // gateway's client does not read the Anthropic option.
    const callOptions = thought.provider
      ? callOptionsFor(thought.provider, config)
      : {
          // A pay-per-use model that refuses a temperature is sent none: a request the
          // provider turns down after payment is a step paid for and not answered.
          temperature: pay && payPerUseModel(pay.model)?.omitTemperature ? undefined : config.llm.temperature,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } },
        };
    const sources = resolveDataSources(config.dataSources);

    // The exit engine runs *before* the model thinks, so the book it reads is the book
    // after stops, targets and collapse rules have been enforced. Its trades join this
    // run's transcript, and whatever fired is handed to the prompt below.
    const guardian = await runGuardian({ agentId: input.agentId, trigger: "tick", runId, now: startedAt });
    if (guardian.exits.length > 0 || guardian.skipped.length > 0) {
      await logger.log({
        kind: "tool_result",
        toolName: "guardian",
        payload: {
          summary: describeGuardian(guardian),
          trigger: "tick",
          exits: guardian.exits.map((e) => ({
            symbol: e.symbol,
            reason: e.reason,
            status: e.status,
            amountUsd: e.amountUsd,
            priceUsd: e.priceUsd,
            rationale: e.rationale,
            error: e.error,
          })),
          skipped: guardian.skipped,
        },
      });
    }

    const portfolio = await getPortfolio(input.agentId);
    const recent = await loadRecentTrades(input.agentId, 10);

    const system = buildSystemPrompt(
      { name: agentRow.name, tagline: agentRow.tagline, mode: agentRow.mode, config },
      sources,
    );
    const prompt = buildTickPrompt({
      portfolio,
      config,
      recentTrades: recent,
      dataBudgetRemainingUsd: budget.maxUsd - budget.spentUsd,
      trigger: input.trigger,
      now: startedAt,
      exits: guardian.exits
        .filter((e) => e.status === "filled")
        .map((e) => ({ symbol: e.symbol, reason: e.reason, amountUsd: e.amountUsd, rationale: e.rationale })),
    });

    const tools = buildTools(ctx);
    const modelStartedAt = Date.now();
    modelCallStarted = true;
    // The steps a pay-per-use run may take before the one that wraps it up.
    const stepLimit = pay ? paidStepLimit(config) : config.llm.maxSteps;
    let stepStartedAt = modelStartedAt;
    let slowestStepMs = 0;
    if (pay) pay.deadlineAt = payDeadlineAt(modelStartedAt, start.invocationStartedAt, RUN_MODEL_TIMEOUT_MS);
    // The route is allowed 300s. Cut the model off at 240 so the remaining minute is
    // ours: the catch below still gets to write `failed` + the reason on the run row,
    // which is the difference between "the model stalled" and a row stuck on `running`
    // that bricks the agent until the reaper notices. A pay-per-use run is cut off at its
    // payment deadline, which is that same moment or the invocation's, whichever is
    // first; the paying fetch stops listening to this signal once a payment has left.
    runSignal = AbortSignal.timeout(pay ? Math.max(1, pay.deadlineAt - modelStartedAt) : RUN_MODEL_TIMEOUT_MS);

    const result = await generateText({
      model,
      system,
      prompt,
      tools,
      // The temperature, and for a key agent whatever else its provider needs sent.
      ...callOptions,
      abortSignal: runSignal,
      // The run ends when `finish` *accepted* the summary, not when it was merely called:
      // in approval mode the tool sends the model back once for an unproposed shortlist.
      stopWhen: [
        // A pay-per-use run gets one step beyond its limit: the one it is told to finish in.
        stepCountIs(pay ? stepLimit + 1 : stepLimit),
        () => ctx.finished.summary !== null,
        ...(pay
          ? [
              () => {
                // No new request once the run has been thinking this long. The paying
                // fetch would refuse one a little later anyway; this ends the run cleanly.
                if (Date.now() - modelStartedAt < NO_NEW_STEP_AFTER_MS) return false;
                outOfTime = true;
                return true;
              },
            ]
          : []),
      ],
      ...(pay
        ? {
            // Every request is a payment. A retry would be a second one, and the answer
            // is priced on its cap, so neither is left to a default.
            maxRetries: 0,
            maxOutputTokens: INFERENCE_MAX_OUTPUT_TOKENS,
            prepareStep: async ({ stepNumber, messages }) => {
              const now = Date.now();
              if (stepNumber > 0) slowestStepMs = Math.max(slowestStepMs, now - stepStartedAt);
              stepStartedAt = now;
              // Once the run is being wrapped up it stays that way: a model sent back by
              // `finish` is told to finish again, not given the steps it asked for.
              wrapUp ??= wrapUpReason({
                stepNumber,
                stepLimit,
                runCapUsd: pay.caps.runUsd,
                spentUsd: pay.spentUsd,
                maxStepUsd: pay.maxStepUsd,
                // A step is the model's answer and the tools it then runs; the fetch only times the first.
                maxStepMs: Math.max(pay.maxStepMs, slowestStepMs),
                deadlineAt: pay.deadlineAt,
                // The same moment the `stopWhen` above ends the run at. The wrap-up has to
                // come before it, or the run is cut with nothing written down.
                noNewStepAt: modelStartedAt + NO_NEW_STEP_AFTER_MS,
                now,
              });
              // The scripted model never calls the gateway, so the step it is about to
              // take is put through the same limits and ledger here, as a simulated row.
              if (isLlmMock()) await simulateInferenceStep(pay, promptSize(system, messages));
              return wrapUp ? { toolChoice: { type: "tool" as const, toolName: "finish" as const } } : {};
            },
          }
        : {}),
      onStepFinish: async (step) => {
        const text = step.text?.trim();
        if (text) await logger.log({ kind: "message", payload: { text } });
        if (!pay) return;
        counted.inputTokens += step.usage.inputTokens ?? 0;
        counted.outputTokens += step.usage.outputTokens ?? 0;
        if (wrapUp && ctx.finished.summary === null) ctx.finished.summary = summaryOfForcedFinish(step);
      },
    });

    // Before anything is written: a paid step still resolving its ledger row is waited
    // for, so the spend below is the whole of it.
    if (pay) await pay.inFlight;
    // Why a pay-per-use run ended before the model was done, if it did: the limit that
    // had it wrapped up, or the clock between two steps.
    const stopReason: InferenceStopReason | null = pay ? (wrapUp ?? (outOfTime && ctx.finished.summary === null ? "deadline" : null)) : null;

    const summary = runSummary(
      ctx.finished.summary,
      result.text,
      // No figures: a summary is public, and the limits are the owner's own settings.
      pay && stopReason ? describeInferenceStop(stopReason, { model: pay.model }).detail : null,
    );
    await logger.flush();

    const finalPortfolio = await getPortfolio(input.agentId);
    await snapshotEquity(finalPortfolio);

    const finishedAt = new Date();
    await db
      .update(agentRuns)
      .set({
        status: "succeeded",
        summary,
        finishedAt,
        dataSpendUsd: budget.spentUsd.toFixed(6),
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        ...thinking,
        ...(pay ? { inferenceSpendUsd: (await thinkingSpendUsd(runId, pay)).toFixed(6), stopReason } : {}),
      })
      .where(eq(agentRuns.id, runId));

    await db
      .update(agents)
      .set({ lastRunAt: finishedAt, nextRunAt: nextRunAt(config, finishedAt), updatedAt: finishedAt })
      .where(eq(agents.id, input.agentId));
    // A pay-per-use run that worked ends whatever hold and strikes came before it.
    if (pay) await endHoldAfterRun(input.agentId);

    return { runId, status: "succeeded", summary: summary ?? undefined, ...(stopReason ? { stopReason } : {}) };
  } catch (thrown) {
    // A paid step may still be resolving its ledger row (the run stopped listening to
    // it, or it is giving a reservation back). Nothing is decided or written before it has.
    if (pay) await pay.inFlight;

    // A pay-per-use run that stopped for a reason with a name. The pay path flattens
    // error classes on the way out, so the reason is read from the context, not the error.
    let err: unknown = thrown;
    const stop = pay ? paidStop(pay, thrown, { wrapUp, modelCallStarted, aborted: runSignal?.aborted === true }) : null;
    if (pay && stop && stopOutcome(stop.reason).status === "succeeded") {
      try {
        return await finishAtLimit(stop.reason, pay);
      } catch (finishErr) {
        // Writing the normal end failed. The ordinary failure below says what broke.
        err = finishErr;
      }
    }

    if (pay && stop && stopOutcome(stop.reason).hold) {
      // Not the generic failure: the owner is told what happened and what fixes it, in
      // the sentence written for this reason, and told once (the hold does that).
      const said = describeInferenceStop(stop.reason, { runCapUsd: pay.caps.runUsd, dayCapUsd: pay.caps.agentDayUsd, model: pay.model });
      await logger.log({
        kind: "error",
        // The detail is what the pay path recorded, already redacted there; once more
        // here because it is about to be stored where the owner reads it.
        payload: { error: said.detail, reason: stop.reason, ...(stop.detail ? { detail: redactSecrets(stop.detail).slice(0, 500) } : {}) },
      });
      await logger.flush();

      const finishedAt = new Date();
      await db
        .update(agentRuns)
        .set({
          status: "failed",
          error: said.detail,
          finishedAt,
          dataSpendUsd: budget.spentUsd.toFixed(6),
          inputTokens: counted.inputTokens,
          outputTokens: counted.outputTokens,
          ...thinking,
          inferenceSpendUsd: (await thinkingSpendUsd(runId, pay)).toFixed(6),
          stopReason: stop.reason,
        })
        .where(eq(agentRuns.id, runId));

      await db
        .update(agents)
        .set({ lastRunAt: finishedAt, nextRunAt: nextRunAt(config, finishedAt), updatedAt: finishedAt })
        .where(eq(agents.id, input.agentId));

      // The hold keeps the scheduler away until its time, and tells the owner once.
      await holdAfterStop(input.agentId, stop.reason, finishedAt);
      // Several runs stopping this way pause pay-per-use for everyone. The cron looks
      // every five minutes; looking now makes the pause immediate. Never this run's problem.
      try {
        await applyInferenceBreakers(finishedAt);
      } catch (breakerErr) {
        console.error(`[run] breakers could not be evaluated: ${dbErrorForLog(breakerErr)}`);
      }

      return { runId, status: "failed", error: said.detail, stopReason: stop.reason };
    }

    // What broke said this, and it is about to be stored, shown to the owner and sent as
    // a notification. A provider's refusal echoes the key it refused (half masked), and
    // an RPC or database client prints the address it was given, key and all. The run's
    // own key goes first, by its exact value: many providers' keys have no shape for
    // `redactSecrets` to know them by. Everything below is made from `raw`.
    // Where the client could not read the provider's reason, it is taken from the body
    // first and cleaned the same way (`failureText`).
    const raw = failureText(err, scrub);
    // A multi-workspace key that still failed for want of the header: find the
    // workspace now, save it on the key, and make the agent due again so the next tick
    // simply works. Only for an agent that thinks on a key: no other run touches one.
    const recovered =
      source === "key" && isWorkspaceScopeError(raw) && agentRow.llmKeyId
        ? await recoverAnthropicWorkspace(agentRow.llmKeyId, agentRow.ownerId).catch(() => null)
        : null;
    const message = recovered
      ? `${raw} — Tocker found this key's workspace (${recovered}) and saved it on the key. The agent runs again on the next tick.`
      : explainProviderError(raw, keyProvider);
    await logger.log({ kind: "error", payload: { error: message } });
    await logger.flush();

    const finishedAt = new Date();
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        error: message,
        finishedAt,
        dataSpendUsd: budget.spentUsd.toFixed(6),
        ...thinking,
        ...(pay ? { inferenceSpendUsd: (await thinkingSpendUsd(runId, pay)).toFixed(6) } : {}),
      })
      .where(eq(agentRuns.id, runId));

    await db
      .update(agents)
      .set({ lastRunAt: finishedAt, nextRunAt: recovered ? finishedAt : nextRunAt(config, finishedAt), updatedAt: finishedAt })
      .where(eq(agents.id, input.agentId));

    await db.insert(notifications).values({
      id: nanoid(),
      userId: agentRow.ownerId,
      kind: "run_failed",
      title: `${agentRow.name} run failed`,
      body: message.slice(0, 500),
      href: `/agents/${agentRow.slug}`,
    });

    return { runId, status: "failed", error: message };
  }
}

/**
 * The named reason a pay-per-use run stopped, or null when what broke has no name (a
 * bug, a database that did not answer) and the ordinary failure applies.
 *
 *  - The pay path wrote one on the context: that is the reason.
 *  - The run's own clock fired between steps: its time limit.
 *  - The model was told to finish and did not call `finish`: the limit that had it told.
 *  - The model call failed in the SDK without the pay path naming a stop (an answer it
 *    could not read, say): the provider's side, as far as an owner is concerned, and a
 *    reason to back off instead of paying for the same failure on every tick.
 *
 * Pure, and exported for its tests: the clock running out cannot be staged in one.
 */
export function paidStop(
  pay: InferencePayContext,
  err: unknown,
  state: { wrapUp: InferenceStopReason | null; modelCallStarted: boolean; aborted: boolean },
): { reason: InferenceStopReason; detail?: string } | null {
  if (pay.stop) return pay.stop;
  if (!state.modelCallStarted) return null;
  if (state.aborted && isAbort(err)) return { reason: "deadline", detail: "the run's clock ran out between steps" };
  if (ToolChoiceViolationError.isInstance(err) && state.wrapUp) {
    return { reason: state.wrapUp, detail: "the model was told to finish and did not" };
  }
  if (AISDKError.isInstance(err)) return { reason: "gateway_error", detail: `the model call failed: ${err.message}` };
  return null;
}
