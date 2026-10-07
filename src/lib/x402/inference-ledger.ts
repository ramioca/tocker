/**
 * Pay-per-use thinking: the ledger and the caps.
 *
 * One row in `inference_payments` per model step an agent pays for, written BEFORE
 * anything is signed, and three counters per UTC day in `inference_budget_days` (the
 * platform, the owner, the agent). The rules this file keeps:
 *
 *  - `reserve` is one database transaction. The switches are clear, the run and the three
 *    day limits each have room, and the row is written, or none of it happened. The day
 *    limits are conditional UPDATEs (`... WHERE usd + amount <= cap`), so two servers
 *    reserving at the same instant cannot both take the last cent: the second waits for
 *    the first row lock and then re-reads the counter.
 *  - A row only moves along its lifecycle (see `INFERENCE_MOVES`). Each move is one
 *    UPDATE guarded by the status it expects, so a move that is asked for twice, or by
 *    two processes at once, happens once.
 *  - An amount goes back to the counters exactly once, and to the counters of the day it
 *    was reserved on (`budget_day`), in the same transaction as the move that frees it.
 *  - Counter rows are always locked in the same order (platform, owner, agent), so two
 *    transactions never wait on each other in a circle.
 *
 * Nothing here signs, sends or reads a chain. Text that came from outside (a gateway's
 * error, a model id it reported) is redacted before it is stored, and a database error is
 * only ever logged through `dbErrorForLog`. It writes its own three tables and, in one
 * place, one column of another: `syncRunInferenceSpend` rewrites a run's recorded
 * thinking spend (`agent_runs.inference_spend_usd`) from the ledger's rows, for the
 * reconciler to call when a row of that run turns out never to have been charged.
 *
 * Server only: this file imports the database. The rules a screen may need (the caps, the
 * look-again times, the shape of a day's usage and of the switches) are pure and live in
 * `./inference-budget.ts`, which is the one to import from a client component.
 *
 * What a caller can rely on, call by call:
 *
 *  - `reserve` answers `{ ok: false, reason }` for every refusal and rejects only when
 *    the database itself fails or the call names no owner, agent or run. Either way
 *    nothing was reserved and nothing may be signed.
 *  - `markSigned` REJECTS when the row is not `reserved` (released by a time-out, swept
 *    as stale, unknown). The caller must then send nothing.
 *  - `release` never rejects over a row's state: a second release, or a release of a row
 *    that has since been signed, changes nothing and gives nothing back.
 *  - `settle`, `markPaidNoAnswer` and `markUnconfirmed` change nothing on a row that is
 *    already resolved and counted as charged. They reject when the row was never marked
 *    signed (it is then walked forward and counted as charged first) or when its amount
 *    was already given back (pay-per-use is then halted: the books and the caller
 *    disagree about whether money moved).
 *  - A `simulated` row is written whole by `reserve` and never moves; `settle` only fills
 *    in the answer's figures on it.
 *
 * One status carries two meanings, told apart by `tx_hash`. A `settled` row WITH a
 * transaction id is paid and answered, and final. A `settled` row with NO transaction id
 * is "answered, settlement not yet proven": the gateway answered and gave no receipt. It
 * is counted as charged like any settled row, and the reconciler looks for its memo on
 * chain. Found: `confirmSettled` writes the transaction id and the row stays `settled`.
 * Proven never to have landed: `resolveInferencePayment` makes it `not_charged` and the
 * amount goes back to its day, once (the answer was free). No other move leaves `settled`.
 */
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentRuns, agents, getDb, inferenceBudgetDays, inferenceControl, inferencePayments, type Db } from "@/db";
import { toNum, toNumeric } from "@/lib/money";
import { dbErrorForLog, redactSecrets } from "@/lib/security/redact";
import {
  BREAKER_LOOKBACK_MINUTES,
  BREAKER_PAYMENT_STATUSES,
  BREAKER_STOP_REASONS,
  INFERENCE_CONTROL_CLEAR,
  breakerDecision,
  controlStop,
  type BreakerRule,
  type InferenceControlState,
  type InferenceDayUsage,
} from "./inference-budget";
import {
  CHARGED_STATUSES,
  OWNER_DAY_MANUAL_RUNS,
  utcDay,
  type InferenceLedger,
  type InferencePaymentStatus,
  type InferenceReserveInput,
  type InferenceReserveResult,
  type InferenceStopReason,
} from "./inference-types";

// ---------- vocabulary ----------

/** The one control row. */
export const INFERENCE_CONTROL_ID = "global";
/** The platform's counter row is keyed by this, since there is only one platform. */
export const PLATFORM_SCOPE_ID = "all";
/** What the reason column starts with while the halt is off: the ISO time it was cleared follows. */
const CLEARED_PREFIX = "cleared ";
/**
 * Ends a stored reason, cleared or on: the transaction ids that clearing a halt has
 * acknowledged. The table has no column of its own for them. They stay behind the reason
 * of a later halt too, so what one clear acknowledged is not forgotten by the next.
 */
const ACKNOWLEDGED_MARK = " | acknowledged: ";
/** That ending, as stored: the mark, then nothing but transaction ids and spaces. Read by this file and, as a pattern, by Postgres. */
const ACKNOWLEDGED_TAIL = / \| acknowledged: [1-9A-HJ-NP-Za-km-z ]*$/;
/** What the mark becomes inside text that came from outside, so no reason can pass for that ending. */
const ACKNOWLEDGED_MARK_IN_TEXT = " | acknowledged; ";
/** A Solana transaction id as it appears in a halt reason. Addresses are shorter and are not matched. */
const TRANSACTION_ID = /[1-9A-HJ-NP-Za-km-z]{64,90}/g;
/** The same shape, as the whole of a string: what a caller may name a finding's transaction by. */
const WHOLE_TRANSACTION_ID = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
/** How many acknowledged transaction ids are kept: the newest. One that falls off halts again if it is still in view. */
export const MAX_ACKNOWLEDGED = 64;
/** The most a halt reason grows to as further evidence is added to it. */
export const MAX_HALT_REASON = 4000;
/** Ends a halt reason that had no room for more. The rest is in the server log. */
const MORE_IN_LOG = " | more was found: see the server log";
/** Opens a halt reason that holds more than one finding, so a screen that shows only its start still says so. */
const FINDINGS_PREFIX = /^\[(\d+) findings\] /;
/** The detail a row gets when it is closed without a verdict. See `closeUncheckedPayments`. */
export const CLOSED_UNCHECKED_DETAIL = "Could not be checked against the chain in time. Counted as charged.";

/**
 * Where a row may go from each status. Anything not listed is refused. `simulated` rows
 * are written whole by `reserve` and never move.
 *
 * `settled` to `not_charged` is open only to a row with no transaction id (answered,
 * settlement never proven), and only to the reconciler: `move` refuses to run it without
 * that guard in the UPDATE itself.
 */
export const INFERENCE_MOVES: Readonly<Record<InferencePaymentStatus, readonly InferencePaymentStatus[]>> = {
  reserved: ["released", "signed"],
  signed: ["settled", "paid_no_answer", "unconfirmed", "not_charged"],
  unconfirmed: ["paid_no_answer", "not_charged"],
  released: [],
  settled: ["not_charged"],
  paid_no_answer: [],
  not_charged: [],
  simulated: [],
};

/** Every status whose amount is still held in the day counters. */
const COUNTED_STATUSES: readonly InferencePaymentStatus[] = ["reserved", ...CHARGED_STATUSES, "simulated"];

/**
 * A call the ledger cannot honour: an unknown row, a row asked to move somewhere its
 * status does not allow when that matters to the caller, or input that is not a payment.
 * The message is written here, in plain words, and carries no database text.
 */
export class InferenceLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceLedgerError";
  }
}

/**
 * A clear of the halt that was refused, with nothing written. The message is the sentence
 * for whoever pressed the button.
 *
 *  - `changed`: the reason stored now is not the one the caller was shown. Something was
 *    added to it (or it was cleared and thrown again) since their page was drawn.
 *  - `unseen`: a halt with a reason is on and the caller did not say what it was shown.
 */
export class HaltClearRefused extends InferenceLedgerError {
  constructor(readonly why: "changed" | "unseen") {
    super(
      why === "changed"
        ? "The reason changed since this page was loaded. Reload and read it before clearing."
        : "This clear did not say which reason it was shown, and a halt with a reason is on. Reload and read it before clearing.",
    );
    this.name = "HaltClearRefused";
  }
}

/** Thrown inside `reserve`'s transaction to roll it back with a named reason. */
class Refusal extends Error {
  constructor(readonly reason: InferenceStopReason) {
    super(reason);
  }
}

/** A query runner: the shared connection, or a transaction on it. */
type Runner = Pick<Db, "select" | "insert" | "update">;

// ---------- small helpers ----------

const MAX_DETAIL = 500;
const MAX_FIELD = 200;
const INT4_MAX = 2_147_483_647;
/** Comparisons of dollar sums in JS allow this much representation noise. The database compares exactly. */
const EPSILON_USD = 1e-9;

/** Outside text, safe to keep: redacted and bounded. */
function clean(text: unknown, max = MAX_FIELD): string {
  return redactSecrets(typeof text === "string" ? text : String(text ?? "")).slice(0, max);
}

function cleanOrNull(text: unknown, max = MAX_FIELD): string | null {
  if (text === null || text === undefined) return null;
  const out = clean(text, max);
  return out === "" ? null : out;
}

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INT4_MAX ? value : null;
}

/**
 * A quoted amount in millionths of a dollar, rounded UP: a fraction of a micro-dollar
 * must never be counted as nothing. Null when it is not an amount at all.
 */
function microsOf(usd: number): number | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
  // The subtraction absorbs binary noise (0.001 * 1e6 is a hair over 1000) without
  // letting a real fraction round down.
  const micros = Math.ceil(usd * 1_000_000 - 1e-6);
  return micros >= 1 ? micros : null;
}

/** True when `spent + amount` fits under `cap`. Written so a cap that is not a number fits nothing. */
function fits(spent: number, amount: number, cap: number): boolean {
  return spent + amount <= cap + EPSILON_USD;
}

/** Every transaction id a text names, each once, in the order they appear. */
function transactionIdsIn(text: string | null | undefined): string[] {
  return [...new Set(text?.match(TRANSACTION_ID) ?? [])];
}

/** Outside text bound for the reason column: redacted, bounded, and unable to pass for the acknowledged ending. */
function reasonText(text: unknown): string {
  return clean(text, MAX_DETAIL).split(ACKNOWLEDGED_MARK).join(ACKNOWLEDGED_MARK_IN_TEXT);
}

/** A stored reason, apart: what it says, and the transaction ids kept behind it. */
function splitReason(stored: string | null | undefined): { body: string; acknowledged: string[] } {
  const text = stored ?? "";
  const tail = ACKNOWLEDGED_TAIL.exec(text);
  if (!tail) return { body: text, acknowledged: [] };
  return { body: text.slice(0, tail.index), acknowledged: transactionIdsIn(tail[0]) };
}

function joinReason(body: string, acknowledged: readonly string[]): string {
  return acknowledged.length > 0 ? `${body}${ACKNOWLEDGED_MARK}${acknowledged.join(" ")}` : body;
}

/**
 * For the reason column of a halt being thrown over an existing row: the new reason, with
 * the acknowledged ending of whatever the row held kept behind it. One expression, so the
 * statement that throws the halt is still a single one. `excluded` is the row it tried to
 * insert.
 */
const HALT_REASON_KEEPING_ACKNOWLEDGED = sql`nullif(coalesce(excluded.halt_reason, '') || coalesce(substring(${inferenceControl.haltReason} from ${ACKNOWLEDGED_TAIL.source}::text), ''), '')`;

/**
 * True of a stored row whose acknowledged ending does NOT hold `id`. A condition for the
 * statement that throws a halt, so "has an admin already cleared a halt that named this
 * transaction" is asked of the row as it is at that instant, by the statement that would
 * change it. `id` is a whole transaction id (letters and digits only); each stored id has
 * a space before it and, with the one added here, a space after it.
 */
function notAcknowledged(id: string) {
  return sql`strpos(coalesce(substring(${inferenceControl.haltReason} from ${ACKNOWLEDGED_TAIL.source}::text), '') || ' ', ${` ${id} `}::text) = 0`;
}

/**
 * A halt's reason as the admin page prints it: redacted once more on the way out,
 * trimmed, bounded, and null when there is nothing to print.
 *
 * One function for the page and for the clear. `setInferenceHalt` accepts a clear only
 * when it carries exactly this text for the reason stored at that moment, so the two must
 * never be worked out in two places.
 */
export function haltReasonAsShown(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const text = redactSecrets(reason).trim();
  return text === "" ? null : text.slice(0, MAX_HALT_REASON);
}

function scopesOf(row: { ownerId: string; agentId: string | null }): Array<{ scope: "platform" | "owner" | "agent"; scopeId: string }> {
  // Always this order. See the note on lock order at the top of the file.
  const scopes: Array<{ scope: "platform" | "owner" | "agent"; scopeId: string }> = [
    { scope: "platform", scopeId: PLATFORM_SCOPE_ID },
    { scope: "owner", scopeId: row.ownerId },
  ];
  if (row.agentId) scopes.push({ scope: "agent", scopeId: row.agentId });
  return scopes;
}

function dayRow(scope: string, scopeId: string, day: string) {
  return and(eq(inferenceBudgetDays.scope, scope), eq(inferenceBudgetDays.scopeId, scopeId), eq(inferenceBudgetDays.day, day));
}

async function readControl(runner: Runner): Promise<InferenceControlState> {
  const [row] = await runner
    .select({
      halted: inferenceControl.halted,
      haltReason: inferenceControl.haltReason,
      pausedUntil: inferenceControl.pausedUntil,
      pauseReason: inferenceControl.pauseReason,
      updatedBy: inferenceControl.updatedBy,
      updatedAt: inferenceControl.updatedAt,
    })
    .from(inferenceControl)
    .where(eq(inferenceControl.id, INFERENCE_CONTROL_ID))
    .limit(1);
  if (!row) return INFERENCE_CONTROL_CLEAR;
  // While the halt is off, the reason column holds when it was last cleared (see
  // `setInferenceHalt`). Readers get that as a date, and no reason for a halt that is not
  // on. The acknowledged transaction ids sit behind either kind of reason and are never
  // part of what a reader is shown as the reason.
  const { body, acknowledged } = splitReason(row.haltReason);
  const wasCleared = !row.halted && body.startsWith(CLEARED_PREFIX);
  const cleared = wasCleared ? new Date(body.slice(CLEARED_PREFIX.length, CLEARED_PREFIX.length + 24)) : null;
  return {
    ...row,
    haltReason: row.halted && body !== "" ? body : null,
    haltClearedAt: cleared && Number.isFinite(cleared.getTime()) ? cleared : null,
    haltAcknowledged: row.halted || wasCleared ? acknowledged : [],
  };
}

/** Return a freed amount to the counters of the day it was reserved on. Call only inside the move's transaction. */
async function giveBack(
  tx: Runner,
  row: { ownerId: string; agentId: string | null; quotedUsd: string; budgetDay: string },
  now: Date,
): Promise<void> {
  for (const { scope, scopeId } of scopesOf(row)) {
    await tx
      .update(inferenceBudgetDays)
      .set({
        // Never below zero: a counter that was reset by hand must not go negative and
        // hand out room that does not exist.
        usd: sql`greatest(${inferenceBudgetDays.usd} - ${row.quotedUsd}::numeric, 0)`,
        requests: sql`greatest(${inferenceBudgetDays.requests} - 1, 0)`,
        updatedAt: now,
      })
      .where(dayRow(scope, scopeId, row.budgetDay));
  }
}

async function statusOf(paymentId: string): Promise<InferencePaymentStatus | null> {
  const db = await getDb();
  const [row] = await db.select({ status: inferencePayments.status }).from(inferencePayments).where(eq(inferencePayments.id, paymentId)).limit(1);
  return (row?.status as InferencePaymentStatus | undefined) ?? null;
}

type PaymentPatch = Partial<typeof inferencePayments.$inferInsert>;

/**
 * Every transaction here asks for READ COMMITTED by name. The caps depend on it: under
 * it, an UPDATE that waited for another transaction's row lock re-checks its WHERE
 * against the row as that transaction left it, which is what makes "add only if the cap
 * still holds" exact. It is Postgres's default, but a default can be changed per
 * database, and the money should not depend on nobody having done so.
 */
const READ_COMMITTED = { isolationLevel: "read committed" } as const;

/**
 * Move one row, if its status is one of `from`. A single guarded UPDATE, so of any number
 * of callers asking for the same move exactly one gets `true`. When the move frees the
 * amount, the counters get it back in the same transaction.
 */
async function move(
  paymentId: string,
  from: readonly InferencePaymentStatus[],
  to: InferencePaymentStatus,
  patch: PaymentPatch,
  options: { giveBack?: boolean; now?: Date; unprovenOnly?: boolean } = {},
): Promise<boolean> {
  for (const status of from) {
    // The table above is the rule; this keeps the code below from drifting away from it.
    if (!INFERENCE_MOVES[status].includes(to)) throw new InferenceLedgerError(`A ${status} payment cannot become ${to}.`);
  }
  // A settled row leaves `settled` only while nothing proves it was paid. The condition is
  // part of the UPDATE, so a transaction id written a moment earlier makes this a no-op.
  if (from.includes("settled") && !options.unprovenOnly) throw new InferenceLedgerError(`A settled payment cannot become ${to}.`);
  const now = options.now ?? new Date();
  const db = await getDb();
  const guarded = and(
    eq(inferencePayments.id, paymentId),
    inArray(inferencePayments.status, [...from]),
    options.unprovenOnly ? isNull(inferencePayments.txHash) : undefined,
  );
  if (!options.giveBack) {
    const moved = await db
      .update(inferencePayments)
      .set({ ...patch, status: to })
      .where(guarded)
      .returning({ id: inferencePayments.id });
    return moved.length > 0;
  }
  return db.transaction(async (tx) => {
    const [freed] = await tx
      .update(inferencePayments)
      .set({ ...patch, status: to })
      .where(guarded)
      .returning({
        ownerId: inferencePayments.ownerId,
        agentId: inferencePayments.agentId,
        quotedUsd: inferencePayments.quotedUsd,
        budgetDay: inferencePayments.budgetDay,
      });
    if (!freed) return false;
    await giveBack(tx, freed, now);
    return true;
  }, READ_COMMITTED);
}

// ---------- reserve ----------

async function reserve(input: InferenceReserveInput): Promise<InferenceReserveResult> {
  if (!input.ownerId || !input.agentId || !input.runId) {
    throw new InferenceLedgerError("A payment needs an owner, an agent and a run. Nothing was reserved.");
  }
  const { caps, now } = input;

  // The checks that need no database, cheapest first. Each also holds inside the
  // transaction's statements below; these only save the round trip.
  const micros = microsOf(input.quotedUsd);
  // An amount that is not a positive number is not a price this gateway can have quoted.
  if (micros === null) return { ok: false, reason: "pin_mismatch" };
  const amountUsd = micros / 1_000_000;
  const amount = toNumeric(amountUsd, 6);
  if (!fits(0, amountUsd, caps.stepUsd)) return { ok: false, reason: "step_cap" };
  if (!Number.isInteger(input.seq) || input.seq < 0 || !(input.seq < caps.maxRequestsPerRun)) return { ok: false, reason: "step_limit" };
  if (!fits(Math.max(0, input.runSpentUsd), amountUsd, caps.runUsd)) return { ok: false, reason: "run_cap" };
  // A platform limit of zero is the off switch: it refuses everything.
  if (!(caps.platformDayUsd > 0)) return { ok: false, reason: "platform_day_cap" };

  const budgetDay = utcDay(now);
  const paymentId = nanoid();
  const db = await getDb();

  try {
    return await db.transaction(async (tx) => {
      // 1. The switches. Read here, inside the transaction, so a halt thrown from the
      //    admin page stops the very next signature on every server.
      const stopped = controlStop(await readControl(tx), now);
      if (stopped) throw new Refusal(stopped);

      // 2. The three counter rows for today, if this is the day's first payment.
      const scopes = scopesOf({ ownerId: input.ownerId, agentId: input.agentId });
      await tx
        .insert(inferenceBudgetDays)
        .values(scopes.map(({ scope, scopeId }) => ({ scope, scopeId, day: budgetDay, updatedAt: now })))
        .onConflictDoNothing();

      // 3. Take the amount from each counter, only if its limit still holds. Each UPDATE
      //    locks its row until this transaction ends; one that matches nothing means the
      //    limit is reached, and throwing rolls back the counters already taken.
      const add = {
        usd: sql`${inferenceBudgetDays.usd} + ${amount}::numeric`,
        requests: sql`${inferenceBudgetDays.requests} + 1`,
        updatedAt: now,
      };
      const under = (capUsd: number) => sql`${inferenceBudgetDays.usd} + ${amount}::numeric <= ${toNumeric(capUsd, 6)}::numeric`;

      const platform = await tx
        .update(inferenceBudgetDays)
        .set(add)
        .where(and(dayRow("platform", PLATFORM_SCOPE_ID, budgetDay), under(caps.platformDayUsd)))
        .returning({ day: inferenceBudgetDays.day });
      if (platform.length === 0) throw new Refusal("platform_day_cap");

      const owner = await tx
        .update(inferenceBudgetDays)
        .set(add)
        .where(and(dayRow("owner", input.ownerId, budgetDay), under(caps.ownerDayUsd)))
        .returning({ day: inferenceBudgetDays.day });
      if (owner.length === 0) throw new Refusal("owner_day_cap");

      const requestLimit = Number.isFinite(caps.agentDayRequests) ? Math.max(0, Math.floor(caps.agentDayRequests)) : 0;
      const agent = await tx
        .update(inferenceBudgetDays)
        .set(add)
        .where(and(dayRow("agent", input.agentId, budgetDay), under(caps.agentDayUsd), lt(inferenceBudgetDays.requests, requestLimit)))
        .returning({ day: inferenceBudgetDays.day });
      if (agent.length === 0) {
        // Two limits guard this row. Say which one it was.
        const [held] = await tx
          .select({ requests: inferenceBudgetDays.requests })
          .from(inferenceBudgetDays)
          .where(dayRow("agent", input.agentId, budgetDay))
          .limit(1);
        throw new Refusal((held?.requests ?? 0) >= requestLimit ? "request_limit" : "agent_day_cap");
      }

      // 4. The run limit again, this time from the ledger's own rows. The agent's counter
      //    row is locked by now, so no other reserve for this agent can be between its
      //    own check and its own insert: the sum read here is the whole truth.
      const [spent] = await tx
        .select({
          usd: sql<string>`coalesce(sum(greatest(${inferencePayments.quotedUsd}, coalesce(${inferencePayments.settledUsd}, ${inferencePayments.quotedUsd}))), 0)`,
        })
        .from(inferencePayments)
        .where(and(eq(inferencePayments.runId, input.runId), inArray(inferencePayments.status, [...COUNTED_STATUSES])));
      if (!fits(Math.max(toNum(spent?.usd), Math.max(0, input.runSpentUsd)), amountUsd, caps.runUsd)) throw new Refusal("run_cap");

      // 5. The row. A second reserve for the same step of the same run writes nothing,
      //    and everything above is rolled back: one step is never counted or paid twice.
      const written = await tx
        .insert(inferencePayments)
        .values({
          id: paymentId,
          ownerId: input.ownerId,
          agentId: input.agentId,
          runId: input.runId,
          seq: input.seq,
          requestHash: clean(input.requestHash),
          chain: clean(input.chain),
          network: clean(input.network),
          host: clean(input.host),
          model: clean(input.model),
          payerWalletId: clean(input.payerWalletId),
          payerAddress: clean(input.payerAddress),
          payTo: clean(input.payTo),
          asset: clean(input.asset),
          quotedUsd: amount,
          status: input.simulated ? "simulated" : "reserved",
          budgetDay,
          createdAt: now,
          resolvedAt: input.simulated ? now : null,
        })
        .onConflictDoNothing({ target: [inferencePayments.runId, inferencePayments.seq] })
        .returning({ id: inferencePayments.id });
      if (written.length === 0) throw new Refusal("step_limit");

      return { ok: true as const, paymentId, budgetDay };
    }, READ_COMMITTED);
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.reason };
    // The database itself failed. Nothing was reserved, so nothing may be signed; the
    // caller hears that as a rejection, with no database text in it.
    console.error(`[inference] reserve failed: ${dbErrorForLog(err)}`);
    throw new InferenceLedgerError("The pay-per-use ledger could not be written. Nothing was reserved and nothing may be signed.");
  }
}

// ---------- the moves ----------

/**
 * A caller says money moved (or may have) on a row the ledger holds as never signed or
 * already given back. The two cannot both be right.
 *
 *  - `reserved`: the caller skipped `markSigned`. The row is walked forward through the
 *    lifecycle so the books count the payment, and the caller is told.
 *  - `released` / `not_charged`: the amount has already gone back to the counters. That
 *    cannot be undone here, so pay-per-use is halted until someone has looked.
 */
async function contradiction(paymentId: string, found: "reserved" | "released" | "not_charged", method: string): Promise<never> {
  if (found === "reserved") {
    const now = new Date();
    await move(paymentId, ["reserved"], "signed", { signedAt: now });
    await move(paymentId, ["signed"], "unconfirmed", {
      answered: false,
      detail: clean(`${method} was called before markSigned; counted as charged`, MAX_DETAIL),
    });
    throw new InferenceLedgerError(`${method} was called on a payment that was never marked signed. It is now counted as charged.`);
  }
  await haltInferenceOnce(`${method} was called on payment ${paymentId}, which the ledger holds as ${found}: its amount was already given back.`, "ledger");
  throw new InferenceLedgerError(`${method} was called on a ${found} payment. Pay-per-use has been halted until this is checked.`);
}

/**
 * After a move that did not happen. A simulated row never moves, and a row that is
 * already resolved and still counted as charged needs nothing: both are left alone. An
 * unknown row, or one the ledger holds as never paid, is the caller's to hear about.
 */
async function afterRefusedMove(paymentId: string, method: string): Promise<void> {
  const found = await statusOf(paymentId);
  if (found === null) throw new InferenceLedgerError(`${method}: no such payment.`);
  if (found === "reserved" || found === "released" || found === "not_charged") await contradiction(paymentId, found, method);
}

/** A payment ended badly: let the breakers look. Never lets its own failure reach the caller. */
async function breakersAfterBadEnd(): Promise<void> {
  try {
    await applyInferenceBreakers();
  } catch (err) {
    console.error(`[inference] breakers could not be evaluated: ${dbErrorForLog(err)}`);
  }
}

async function release(paymentId: string, detail: string): Promise<void> {
  const now = new Date();
  const released = await move(paymentId, ["reserved"], "released", { detail: clean(detail, MAX_DETAIL), resolvedAt: now }, { giveBack: true, now });
  if (released) return;
  // Not released by this call. A second release, a simulated row, and a row that has
  // been signed are all left exactly as they are: the amount goes back once or not at all.
  const found = await statusOf(paymentId);
  if (found !== "released" && found !== "simulated") {
    console.warn(`[inference] release ignored: payment ${paymentId} is ${found ?? "unknown"}, not reserved`);
  }
}

async function markSigned(paymentId: string, signed: { memo: string | null; blockhash: string | null; payerSignature: string | null }): Promise<void> {
  const moved = await move(paymentId, ["reserved"], "signed", {
    memo: cleanOrNull(signed.memo, 600),
    blockhash: cleanOrNull(signed.blockhash),
    payerSignature: cleanOrNull(signed.payerSignature),
    signedAt: new Date(),
  });
  if (moved) return;
  const found = await statusOf(paymentId);
  if (found === "simulated") return;
  // The one move whose refusal the caller must act on: without a `signed` row a crash
  // after the send would leave a payment the reconciler never looks for.
  throw new InferenceLedgerError(
    found === null ? "markSigned: no such payment. Nothing may be sent." : `markSigned: the payment is ${found}, not reserved. Nothing may be sent.`,
  );
}

async function settle(
  paymentId: string,
  result: {
    txHash: string | null;
    settledUsd: number;
    servedModel: string | null;
    httpStatus: number;
    gatewayRequestId: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  },
): Promise<void> {
  const settledMicros = microsOf(result.settledUsd);
  const answer: PaymentPatch = {
    answered: true,
    servedModel: cleanOrNull(result.servedModel),
    httpStatus: countOrNull(result.httpStatus),
    gatewayRequestId: cleanOrNull(result.gatewayRequestId),
    inputTokens: countOrNull(result.inputTokens),
    outputTokens: countOrNull(result.outputTokens),
  };
  const moved = await move(paymentId, ["signed"], "settled", {
    ...answer,
    txHash: cleanOrNull(result.txHash),
    // Null when the gateway named no amount: readers then fall back to the quote.
    settledUsd: settledMicros === null ? null : toNumeric(settledMicros / 1_000_000, 6),
    resolvedAt: new Date(),
  });
  if (moved) return;
  const found = await statusOf(paymentId);
  if (found === "simulated") {
    // A simulated step still has an answer worth showing; its status does not change.
    const db = await getDb();
    await db
      .update(inferencePayments)
      .set(answer)
      .where(and(eq(inferencePayments.id, paymentId), eq(inferencePayments.status, "simulated")));
    return;
  }
  await afterRefusedMove(paymentId, "settle");
}

async function markPaidNoAnswer(paymentId: string, result: { txHash: string | null; httpStatus: number | null; detail: string }): Promise<void> {
  const moved = await move(paymentId, ["signed", "unconfirmed"], "paid_no_answer", {
    answered: false,
    txHash: cleanOrNull(result.txHash),
    httpStatus: countOrNull(result.httpStatus),
    detail: clean(result.detail, MAX_DETAIL),
    resolvedAt: new Date(),
  });
  if (!moved) await afterRefusedMove(paymentId, "markPaidNoAnswer");
  await breakersAfterBadEnd();
}

async function markUnconfirmed(paymentId: string, result: { httpStatus: number | null; detail: string }): Promise<void> {
  const moved = await move(paymentId, ["signed"], "unconfirmed", {
    answered: false,
    httpStatus: countOrNull(result.httpStatus),
    detail: clean(result.detail, MAX_DETAIL),
  });
  if (!moved) await afterRefusedMove(paymentId, "markUnconfirmed");
  await breakersAfterBadEnd();
}

/** The ledger a run pays through. Stateless: every call goes to the database. */
export function createInferenceLedger(): InferenceLedger {
  return { reserve, release, markSigned, settle, markPaidNoAnswer, markUnconfirmed };
}

// ---------- for the reconciler ----------

/**
 * The reconciler's verdict on a row left `signed` or `unconfirmed`. Charged: the payment
 * is on chain, so the row becomes `paid_no_answer` and keeps its place in the counters.
 * Not charged: it can no longer land, so the row becomes `not_charged` and its amount
 * goes back to the day it was reserved on. Returns whether this call made the move.
 *
 * A not-charged verdict also applies to a `settled` row with no transaction id: it was
 * answered, and the chain proves it was never paid for. That row keeps `answered` (the
 * answer did arrive, free) and its amount goes back the same way, once. A `settled` row
 * WITH a transaction id is never touched, and a charged verdict on a settled row is
 * `confirmSettled`'s to record, not this function's.
 */
export async function resolveInferencePayment(
  paymentId: string,
  verdict: { charged: true; txHash: string | null; detail: string } | { charged: false; detail: string },
  now: Date = new Date(),
): Promise<boolean> {
  if (verdict.charged) {
    return move(paymentId, ["signed", "unconfirmed"], "paid_no_answer", {
      answered: false,
      txHash: cleanOrNull(verdict.txHash),
      detail: clean(verdict.detail, MAX_DETAIL),
      resolvedAt: now,
    });
  }
  const detail = clean(verdict.detail, MAX_DETAIL);
  if (await move(paymentId, ["signed", "unconfirmed"], "not_charged", { answered: false, detail, resolvedAt: now }, { giveBack: true, now })) return true;
  return move(paymentId, ["settled"], "not_charged", { detail, resolvedAt: now }, { giveBack: true, now, unprovenOnly: true });
}

/**
 * The reconciler found the payment of an answered row on chain: write its transaction id.
 * The row stays `settled` and keeps its place in the counters; all that changes is that
 * its settlement is now proven. One guarded UPDATE: it touches only a `settled` row that
 * has no transaction id yet, so a row already proven, already called not charged, or in
 * any other status is left exactly as it is. Returns whether this call wrote it.
 */
export async function confirmSettled(paymentId: string, txHash: string): Promise<boolean> {
  const hash = cleanOrNull(txHash);
  if (!hash) throw new InferenceLedgerError("confirmSettled needs the transaction id that was found.");
  const db = await getDb();
  const confirmed = await db
    .update(inferencePayments)
    .set({ txHash: hash })
    .where(and(eq(inferencePayments.id, paymentId), eq(inferencePayments.status, "settled"), isNull(inferencePayments.txHash)))
    .returning({ id: inferencePayments.id });
  return confirmed.length > 0;
}

/**
 * Close rows that are still `signed` or `unconfirmed` from before `olderThan` and that no
 * verdict could be reached on: the chain could not be read, or could not be read well
 * enough, for all that time.
 *
 * A closed row is `unconfirmed` with `resolved_at` set and `CLOSED_UNCHECKED_DETAIL` at
 * the head of its detail. That is its end state unless someone later proves otherwise:
 * it stays counted as charged in every cap and every total, because nothing shows the
 * money did not move, and a cap is never given back on a guess. The two verdicts remain
 * open to it (`resolveInferencePayment`), so a later look that does reach the chain can
 * still replace the guess with the fact. Bounded. Returns how many this call closed.
 */
export async function closeUncheckedPayments(olderThan: Date, limit = 50, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const open: InferencePaymentStatus[] = ["signed", "unconfirmed"];
  const stale = await db
    .select({ id: inferencePayments.id, detail: inferencePayments.detail })
    .from(inferencePayments)
    .where(and(inArray(inferencePayments.status, open), isNull(inferencePayments.resolvedAt), lt(inferencePayments.createdAt, olderThan)))
    .orderBy(inferencePayments.createdAt)
    .limit(Math.max(1, Math.min(limit, 500)));
  let closed = 0;
  for (const row of stale) {
    // What the row already said (a time-out, a status) is kept behind the new sentence.
    const detail = clean(row.detail ? `${CLOSED_UNCHECKED_DETAIL} Before that: ${row.detail}` : CLOSED_UNCHECKED_DETAIL, MAX_DETAIL);
    const written = await db
      .update(inferencePayments)
      .set({ status: "unconfirmed", answered: false, detail, resolvedAt: now })
      .where(and(eq(inferencePayments.id, row.id), inArray(inferencePayments.status, open), isNull(inferencePayments.resolvedAt)))
      .returning({ id: inferencePayments.id });
    if (written.length === 0) continue;
    closed += 1;
    console.error(`[inference] payment ${row.id} closed unchecked: no verdict could be reached in time. It stays counted as charged.`);
  }
  return closed;
}

/**
 * Release rows still `reserved` from before `olderThan`. Such a row belongs to a process
 * that died (or failed) between reserving and signing: `markSigned` is awaited before
 * anything is sent, so a `reserved` row's signature never left the server. Bounded.
 */
export async function releaseStaleReserved(olderThan: Date, limit = 50, now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const stale = await db
    .select({ id: inferencePayments.id })
    .from(inferencePayments)
    .where(and(eq(inferencePayments.status, "reserved"), lt(inferencePayments.createdAt, olderThan)))
    .orderBy(inferencePayments.createdAt)
    .limit(Math.max(1, Math.min(limit, 500)));
  let released = 0;
  for (const row of stale) {
    const moved = await move(
      row.id,
      ["reserved"],
      "released",
      { detail: "never signed: released by the reconciler", resolvedAt: now },
      { giveBack: true, now },
    );
    if (moved) released += 1;
  }
  return released;
}

// ---------- reading ----------

/**
 * What a run has been charged for thinking, and in how many requests: every row that
 * counts as spent (`CHARGED_STATUSES`) plus simulated ones, at the settled amount where
 * there is one and the quoted amount otherwise.
 */
export async function runInferenceSpend(runId: string): Promise<{ usd: number; requests: number }> {
  const spent = await readRunSpend(await getDb(), runId);
  return { usd: toNum(spent.usd), requests: spent.requests };
}

/** The one definition of what a run has spent, read through whichever runner asks. The sum stays a `numeric` string. */
async function readRunSpend(runner: Runner, runId: string): Promise<{ usd: string; requests: number }> {
  const [row] = await runner
    .select({
      usd: sql<string>`coalesce(sum(coalesce(${inferencePayments.settledUsd}, ${inferencePayments.quotedUsd})), 0)::numeric(18,6)`,
      requests: sql<number>`count(*)::int`,
    })
    .from(inferencePayments)
    .where(and(eq(inferencePayments.runId, runId), inArray(inferencePayments.status, [...CHARGED_STATUSES, "simulated"])));
  return { usd: row?.usd ?? "0", requests: Number(row?.requests ?? 0) };
}

/**
 * Write a run's thinking spend again from the ledger's rows, after a row of that run
 * stopped counting (the reconciler proved it was never charged). The run wrote the figure
 * itself when it finished, while that row still counted; without this the run would go
 * on showing a charge the ledger has since taken back.
 *
 * It writes one column of one row of `agent_runs`, `inference_spend_usd`, and nothing
 * else, to exactly what `runInferenceSpend` reads. The run's row is locked first and the
 * sum read after, so two verdicts on one run at the same moment leave the later sum, not
 * whichever was written last. Returns whether there was a run to write to.
 */
export async function syncRunInferenceSpend(runId: string): Promise<boolean> {
  if (!runId) return false;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [run] = await tx.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.id, runId)).limit(1).for("update");
    if (!run) return false;
    const spent = await readRunSpend(tx, runId);
    await tx.update(agentRuns).set({ inferenceSpendUsd: spent.usd }).where(eq(agentRuns.id, runId));
    return true;
  }, READ_COMMITTED);
}

/** What the three counters hold for one UTC day. `day` is `YYYY-MM-DD`, or a moment in that day. */
export async function dayUsage(input: { ownerId: string; agentId: string; day: string | Date }): Promise<InferenceDayUsage> {
  const day = typeof input.day === "string" ? input.day : utcDay(input.day);
  const db = await getDb();
  const rows = await db
    .select({
      scope: inferenceBudgetDays.scope,
      usd: inferenceBudgetDays.usd,
      requests: inferenceBudgetDays.requests,
      manualRuns: inferenceBudgetDays.manualRuns,
    })
    .from(inferenceBudgetDays)
    .where(
      and(
        eq(inferenceBudgetDays.day, day),
        or(
          and(eq(inferenceBudgetDays.scope, "platform"), eq(inferenceBudgetDays.scopeId, PLATFORM_SCOPE_ID)),
          and(eq(inferenceBudgetDays.scope, "owner"), eq(inferenceBudgetDays.scopeId, input.ownerId)),
          and(eq(inferenceBudgetDays.scope, "agent"), eq(inferenceBudgetDays.scopeId, input.agentId)),
        ),
      ),
    );
  const of = (scope: string) => rows.find((row) => row.scope === scope);
  const figures = (scope: string) => ({ usd: toNum(of(scope)?.usd), requests: of(scope)?.requests ?? 0 });
  return {
    day,
    platform: figures("platform"),
    owner: { ...figures("owner"), manualRuns: of("owner")?.manualRuns ?? 0 },
    agent: figures("agent"),
  };
}

/**
 * Count one pay-per-use run started by hand, if the owner is still under
 * `OWNER_DAY_MANUAL_RUNS` for the UTC day. Counted in the database, not in memory, so the
 * limit holds across servers. Returns whether the run is allowed.
 */
export async function noteManualRun(ownerId: string, now: Date): Promise<boolean> {
  if (!ownerId) return false;
  const day = utcDay(now);
  const db = await getDb();
  await db.insert(inferenceBudgetDays).values({ scope: "owner", scopeId: ownerId, day, updatedAt: now }).onConflictDoNothing();
  const counted = await db
    .update(inferenceBudgetDays)
    .set({ manualRuns: sql`${inferenceBudgetDays.manualRuns} + 1`, updatedAt: now })
    .where(and(dayRow("owner", ownerId, day), lt(inferenceBudgetDays.manualRuns, OWNER_DAY_MANUAL_RUNS)))
    .returning({ manualRuns: inferenceBudgetDays.manualRuns });
  return counted.length > 0;
}

// ---------- the switches ----------

/** The halt and pause switches as stored. Use `controlStop` to ask whether they stop a payment now. */
export async function readInferenceControl(): Promise<InferenceControlState> {
  return readControl(await getDb());
}

/**
 * Throw or clear the admin halt. While it is on, `reserve` refuses everything with
 * `halted`, on every server, from its next call. The caller checks that `by` is an admin.
 *
 * Clearing it records the moment in the reason column (the table has no column of its
 * own for it), and beside it the transaction ids named in the reason being cleared. Those
 * ids are what the clear acknowledges: the reconciler does not throw the halt again over
 * a transaction an admin has had named to them and has cleared. They are kept through
 * later halts and later clears (the newest `MAX_ACKNOWLEDGED` of them), so a second halt
 * over something else does not bring the first one back.
 *
 * A clear therefore has to be a clear of the reason its caller READ. The reconciler adds
 * findings to the reason of a halt that is on, and a page that was drawn before one was
 * added still shows the reason without it. So a clear carries `seenReason`: the reason as
 * the caller was shown it (`haltReasonAsShown` of what `readInferenceControl` returned,
 * which is what the admin page prints; null when it printed none). The stored reason is
 * read under a lock in the same transaction that clears it, and when the two differ the
 * clear is refused with `HaltClearRefused` and nothing is written. A clear that carries
 * no `seenReason` at all is refused whenever a halt with a reason is on: nothing is
 * acknowledged, and no halt is lifted, on behalf of a caller that cannot say what it read.
 * `seenReason` is only ever compared. It is never stored and never logged.
 */
export async function setInferenceHalt(input: { halted: boolean; reason: string | null; by: string; seenReason?: string | null }): Promise<void> {
  const now = new Date();
  const note = reasonText(input.reason ?? "");
  const by = clean(input.by);
  const db = await getDb();
  if (input.halted) {
    const values = { halted: true, haltReason: note === "" ? null : note, updatedBy: by, updatedAt: now };
    await db
      .insert(inferenceControl)
      .values({ id: INFERENCE_CONTROL_ID, ...values })
      .onConflictDoUpdate({ target: inferenceControl.id, set: { ...values, haltReason: HALT_REASON_KEEPING_ACKNOWLEDGED } });
    return;
  }
  const clearedNote = `${CLEARED_PREFIX}${now.toISOString()}${note ? ` ${note}` : ""}`.slice(0, MAX_DETAIL);
  await db.transaction(async (tx) => {
    // Locked, so evidence added to the reason at this very moment is either read here
    // (and the clear refused, because the caller was not shown it), or lands after the
    // clear and is judged as new.
    const [current] = await tx
      .select({ halted: inferenceControl.halted, haltReason: inferenceControl.haltReason })
      .from(inferenceControl)
      .where(eq(inferenceControl.id, INFERENCE_CONTROL_ID))
      .limit(1)
      .for("update");
    const { body, acknowledged: earlier } = splitReason(current?.haltReason);
    // What a page drawn at this instant would print as the reason: none with no halt on.
    const shownNow = current?.halted ? haltReasonAsShown(body) : null;
    if (input.seenReason === undefined) {
      if (shownNow !== null) throw new HaltClearRefused("unseen");
    } else if ((input.seenReason === "" ? null : input.seenReason) !== shownNow) {
      throw new HaltClearRefused("changed");
    }
    // What this clear acknowledges: everything earlier clears did, and the ids named in
    // the reason that was on, which is the reason the caller read. With no halt on there
    // is nothing new to acknowledge.
    const named = current?.halted ? transactionIdsIn(body) : [];
    const acknowledged = [...earlier.filter((id) => !named.includes(id)), ...named].slice(-MAX_ACKNOWLEDGED);
    const values = { halted: false, haltReason: joinReason(clearedNote, acknowledged), updatedBy: by, updatedAt: now };
    if (current) {
      // The row that was read, still locked: nothing can have been added to it since.
      await tx.update(inferenceControl).set(values).where(eq(inferenceControl.id, INFERENCE_CONTROL_ID));
      return;
    }
    // There was no row to read, so none to lock. If one has been written in the meantime
    // (the first halt ever thrown, at this very moment), it holds a reason this caller
    // was never shown, and it is not this clear's to write over.
    const written = await tx
      .insert(inferenceControl)
      .values({ id: INFERENCE_CONTROL_ID, ...values })
      .onConflictDoNothing({ target: inferenceControl.id })
      .returning({ id: inferenceControl.id });
    if (written.length === 0) throw new HaltClearRefused("changed");
  }, READ_COMMITTED);
}

/** What became of a finding handed to `raiseInferenceHalt`. */
export type HaltOutcome =
  /** This call threw the halt. The finding is its reason. */
  | "thrown"
  /** A halt was already on. The finding is now in its reason. */
  | "added"
  /** A halt was already on, and its reason already holds the finding. */
  | "known"
  /** The finding is over a transaction an admin has had named to them and has cleared. Nothing was written. */
  | "acknowledged"
  /** A halt was already on and the finding is NOT in its reason: no room, or it could not be written. Only the log has it. */
  | "unrecorded";

/**
 * Throw the halt on the system's own evidence (the reconciler, the ledger), and say what
 * became of the finding.
 *
 * When a halt is already on, the first reason stays at the head and stays the one whose
 * author is recorded, but the new finding is not dropped: it is logged, and added to the
 * stored reason (bounded, each finding once). Clearing a halt acknowledges the
 * transactions its reason names and nothing else, so an admin can read everything the
 * clear will acknowledge, and a finding that had no room in the reason is raised again
 * after the clear instead of being passed over unread.
 *
 * `over` is the transaction the finding is about, when it is about one. A finding over a
 * transaction that a clear has acknowledged is not raised again, and that is decided by
 * the statement that throws the halt, against the row as it is at that instant: a caller
 * that read the acknowledged ids a minute ago (a reconciler pass does, once, at its
 * start) cannot undo a clear that landed since.
 *
 * A caller that is about to make its evidence unfindable (a row it is about to mark
 * final) must not do so on `unrecorded`: nothing an admin will read holds the finding.
 * A database failure while throwing the halt rejects; one while adding to a halt that is
 * already on is `unrecorded`.
 */
export async function raiseInferenceHalt(reason: string, by: string, over?: string | null): Promise<HaltOutcome> {
  const now = new Date();
  const text = reasonText(reason);
  const who = clean(by);
  // Anything that is not a transaction id cannot have been acknowledged as one.
  const id = typeof over === "string" && WHOLE_TRANSACTION_ID.test(over) ? over : null;
  const values = { halted: true, haltReason: text, updatedBy: who, updatedAt: now };
  const db = await getDb();
  // Twice at most. The second time is for a clear that landed between this call's two
  // statements: the halt it found on is off again, so there is one to throw after all.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const thrown = await db
      .insert(inferenceControl)
      .values({ id: INFERENCE_CONTROL_ID, ...values })
      .onConflictDoUpdate({
        target: inferenceControl.id,
        // What earlier clears acknowledged stays behind the new reason.
        set: { ...values, haltReason: HALT_REASON_KEEPING_ACKNOWLEDGED },
        setWhere: and(eq(inferenceControl.halted, false), id ? notAcknowledged(id) : undefined),
      })
      .returning({ id: inferenceControl.id });
    if (thrown.length > 0) {
      console.error(`[inference] HALTED by ${who}: ${text}`);
      return "thrown";
    }
    let added: Awaited<ReturnType<typeof addToHaltReason>>;
    try {
      added = await addToHaltReason(text, who, now, id);
    } catch (err) {
      console.error(`[inference] found while already halted (${who}): ${text}`);
      console.error(`[inference] that finding could not be added to the stored halt reason: ${dbErrorForLog(err)}`);
      return "unrecorded";
    }
    if (added === "acknowledged") return "acknowledged";
    if (added === "cleared") continue;
    // Said once, when it is first recorded: the reconciler finds the same transaction on
    // every pass, and a line every five minutes would bury the ones that matter.
    if (added !== "known") console.error(`[inference] found while already halted (${who}): ${text}${added === "full" ? " (not added to the stored reason: it is full)" : ""}`);
    return added === "full" ? "unrecorded" : added;
  }
  // Cleared, thrown by someone else and cleared again, all inside one call. The finding is
  // in nobody's reason; the caller's next look raises it.
  console.error(`[inference] found while a halt was being cleared (${who}): ${text}`);
  return "unrecorded";
}

/**
 * Throw the halt on the system's own evidence. Returns whether this call threw it. See
 * {@link raiseInferenceHalt}, which this is, for a caller that needs no more than that.
 */
export async function haltInferenceOnce(reason: string, by: string, over?: string | null): Promise<boolean> {
  return (await raiseInferenceHalt(reason, by, over)) === "thrown";
}

/**
 * Add one finding to the reason of a halt that is on. Each finding once; bounded by
 * `MAX_HALT_REASON`. `cleared`: no halt is on to add to. `acknowledged`: the finding is
 * over a transaction (`over`) that a clear has acknowledged, so it belongs in no reason.
 */
async function addToHaltReason(text: string, by: string, now: Date, over: string | null): Promise<"added" | "known" | "full" | "cleared" | "acknowledged"> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ halted: inferenceControl.halted, haltReason: inferenceControl.haltReason })
      .from(inferenceControl)
      .where(eq(inferenceControl.id, INFERENCE_CONTROL_ID))
      .limit(1)
      .for("update");
    if (!row) return "cleared" as const;
    // The ids earlier clears acknowledged are not part of the reason: they are set
    // aside here and put back behind whatever the reason becomes.
    const { body: current, acknowledged } = splitReason(row.haltReason);
    if (over !== null && acknowledged.includes(over)) return "acknowledged" as const;
    // Cleared between the caller's two statements: there is no halt to add to.
    if (!row.halted) return "cleared" as const;
    if (text === "" || current.includes(text)) return "known" as const;
    // Already closed off with the note that more is in the log: nothing further is stored.
    if (current.endsWith(MORE_IN_LOG)) return "full" as const;
    // The count goes at the head, where a screen that shows only the start of the reason
    // still shows that there is more than the first finding to read.
    const counted = FINDINGS_PREFIX.exec(current);
    const first = counted ? current.slice(counted[0].length) : current;
    const findings = (counted ? Number(counted[1]) : 1) + 1;
    const grown = `[${findings} findings] ${first} | also (${by}): ${text}`;
    const fits = grown.length + MORE_IN_LOG.length <= MAX_HALT_REASON;
    await tx
      .update(inferenceControl)
      .set({ haltReason: joinReason(fits ? grown : `${current}${MORE_IN_LOG}`, acknowledged), updatedAt: now })
      .where(eq(inferenceControl.id, INFERENCE_CONTROL_ID));
    return fits ? ("added" as const) : ("full" as const);
  }, READ_COMMITTED);
}

/**
 * Pause every payment until `until`. A pause is only ever lengthened: one already set to
 * end later stays, with its own reason. Returns the end now in force.
 */
export async function pauseInferenceUntil(until: Date, reason: string, by = "breaker"): Promise<Date> {
  const now = new Date();
  const text = clean(reason, MAX_DETAIL);
  const db = await getDb();
  const [row] = await db
    .insert(inferenceControl)
    .values({ id: INFERENCE_CONTROL_ID, pausedUntil: until, pauseReason: text, updatedBy: clean(by), updatedAt: now })
    .onConflictDoUpdate({
      target: inferenceControl.id,
      set: {
        // `excluded` is the row this statement tried to insert, so the timestamps are
        // compared in the database and never built from a JS date in raw SQL.
        pausedUntil: sql`greatest(${inferenceControl.pausedUntil}, excluded.paused_until)`,
        pauseReason: sql`case when ${inferenceControl.pausedUntil} is null or excluded.paused_until > ${inferenceControl.pausedUntil} then excluded.pause_reason else ${inferenceControl.pauseReason} end`,
        updatedBy: sql`case when ${inferenceControl.pausedUntil} is null or excluded.paused_until > ${inferenceControl.pausedUntil} then excluded.updated_by else ${inferenceControl.updatedBy} end`,
        updatedAt: now,
      },
    })
    .returning({ pausedUntil: inferenceControl.pausedUntil });
  return row?.pausedUntil ?? until;
}

/** Pause every payment for `minutes` from `from`. See {@link pauseInferenceUntil}. */
export async function pauseInference(minutes: number, reason: string, from: Date = new Date()): Promise<Date> {
  // A pause is a breaker, not a switch: a day at most. Anything longer is the admin halt.
  const bounded = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 0), 1440) : 0;
  return pauseInferenceUntil(new Date(from.getTime() + bounded * 60_000), reason);
}

/**
 * End a pause now. The end is written as this moment rather than erased, which is what
 * tells the breakers that everything before it has been dealt with and must not pause
 * the platform again.
 */
export async function clearInferencePause(by: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  await db
    .update(inferenceControl)
    .set({ pausedUntil: now, pauseReason: null, updatedBy: clean(by), updatedAt: now })
    .where(eq(inferenceControl.id, INFERENCE_CONTROL_ID));
}

// ---------- breakers ----------

/**
 * Read what ended badly lately and pause pay-per-use if a breaker rule says so
 * (`breakerDecision` in `./inference-budget.ts`). Called by the ledger whenever a paid
 * step gets no answer, and by the cron pass, which is what catches runs that stopped
 * before any payment (those leave a `stop_reason` on the run, not a ledger row).
 *
 * Every piece of evidence is read with the account it came from (a payment's own owner,
 * a stopped run's agent's owner), because the rules that pause everyone need more than
 * one account behind them. It reads `agents` for that and writes nothing there.
 */
export async function applyInferenceBreakers(now: Date = new Date()): Promise<{ tripped: BreakerRule | null; pausedUntil: Date | null }> {
  const db = await getDb();
  const control = await readControl(db);
  // A pause that has ended (or was cleared by hand) closes the book on what came before it.
  const dealtWith = control.pausedUntil && control.pausedUntil.getTime() <= now.getTime() ? control.pausedUntil.getTime() : 0;
  // A run is created up to five minutes before it finishes; a payment a minute before it ends.
  const since = new Date(now.getTime() - (BREAKER_LOOKBACK_MINUTES + 10) * 60_000);

  const [payments, stops] = await Promise.all([
    db
      .select({
        status: inferencePayments.status,
        agentId: inferencePayments.agentId,
        ownerId: inferencePayments.ownerId,
        signedAt: inferencePayments.signedAt,
        createdAt: inferencePayments.createdAt,
      })
      .from(inferencePayments)
      .where(and(inArray(inferencePayments.status, [...BREAKER_PAYMENT_STATUSES]), gte(inferencePayments.createdAt, since)))
      .orderBy(desc(inferencePayments.createdAt))
      .limit(500),
    // With the owner of each stopped run's agent: the rules count accounts. A run always
    // has its agent (the run goes when the agent does), so the join loses none.
    db
      .select({ reason: agentRuns.stopReason, ownerId: agents.ownerId, finishedAt: agentRuns.finishedAt, createdAt: agentRuns.createdAt })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .where(and(inArray(agentRuns.stopReason, [...BREAKER_STOP_REASONS]), gte(agentRuns.createdAt, since)))
      // Newest first, so that if there are ever more than are read, the ones left out are the oldest.
      .orderBy(desc(agentRuns.createdAt))
      .limit(500),
  ]);

  const trip = breakerDecision(
    {
      payments: payments
        .map((row) => ({ status: row.status, agentId: row.agentId, ownerId: row.ownerId, at: row.signedAt ?? row.createdAt }))
        .filter((row) => row.at.getTime() > dealtWith),
      stops: stops
        .map((row) => ({ reason: row.reason, ownerId: row.ownerId, at: row.finishedAt ?? row.createdAt }))
        .filter((row) => row.at.getTime() > dealtWith),
    },
    now,
  );
  if (!trip) return { tripped: null, pausedUntil: null };
  const pausedUntil = await pauseInferenceUntil(trip.pauseUntil, trip.reason, "breaker");
  return { tripped: trip.rule, pausedUntil };
}
