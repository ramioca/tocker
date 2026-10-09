/**
 * Editing a saved agent, decided without a browser: the working copy its settings page
 * starts from, what a save sends, what refuses one, which steps hold unsaved edits, what
 * a save would loosen on an agent that trades real money, and when the working copy may
 * be replaced. Pure, no React, so every one of these rules is tested in node
 * (`edit-model.test.ts`).
 *
 * The settings page edits a `BuilderDraft`, the shape the builder creates from, so both
 * pages draw the same step bodies. A saved agent has no funding plan and no start to
 * choose, and those fields of the draft are filled in and never sent. Its paper starting
 * balance is the one thing it was created with that a save can still change, and only
 * while the agent has not traded: the server decides that, and this file only keeps a
 * balance that can no longer change out of what is sent (`withPaperBalance`).
 *
 * Two sets of errors, on purpose. `validateEdit` is the only thing that refuses a save,
 * and it refuses exactly four things. `shownErrors` is what the page displays, which is
 * more: an agent with no key can still be saved, and must still be told it cannot run.
 */
import type { updateAgentAction } from "@/components/agents/agent-actions";
import {
  SETTINGS_STEPS,
  type KeyRef,
  type SettingsStepId,
  type SharedStepId,
  type StepStatus,
} from "@/components/agents/builder/contract";
import { placeOfError } from "@/components/agents/builder/flow";
import type { BuilderDraft } from "@/components/agents/builder/types";
import { validateDraft } from "@/components/agents/builder/validate";
import { checkUsdc, defaultUsdc, firstUsdcError } from "@/components/agents/thinking";
import { formatUsd } from "@/components/common/format";
import type { AgentConfig, PositionSizingConfig } from "@/db/schema";
import { MAX_AGENT_NAME, agentConfigSchema } from "@/lib/agent/config";
import { thinkSource } from "@/lib/agent/inference";
import { readCashReserveUsd, readMaxOpenPositions } from "@/lib/trading/hard-limits";
import { sameBalance } from "@/lib/trading/paper-balance";
import { readSizing } from "@/lib/trading/sizing";
import { chainLabelFor } from "@/lib/wallets/funding";
import type { AgentDetail } from "@/server/types";
import { sameConfig } from "./same-config";

type Config = BuilderDraft["config"];

/** As much of a saved agent as a save can change, as the server last returned it. */
export type SavedAgent = Pick<
  AgentDetail,
  "name" | "tagline" | "avatarSeed" | "isPublic" | "llmKeyId" | "paperStartingUsd"
> & {
  config: AgentConfig;
};

/** What a save sends: the second argument of `updateAgentAction`. */
export type SavePayload = Parameters<typeof updateAgentAction>[1];

/**
 * Whether a save that loosens a money limit on a live agent asks first
 * (`liveSaveWarnings`). False, and such a save goes through unasked, as it did before the
 * settings page had steps.
 */
export const CONFIRM_LIVE_SAVES = true;

// ------------------------------------------------------------- the working copy

/**
 * The working copy a settings page starts from, and what it goes back to on Discard.
 *
 * The seed is what the avatar is drawn from today: an agent that never picked one is
 * drawn from its name (`AgentAvatar`), so that is its seed here, and the avatar row shows
 * the picture the agent has. The funding and the start are a draft's plans; a saved agent
 * has none left, and no save reads them. The paper balance is the agent's own, and a save
 * sends it when it was changed.
 */
export function draftOf(
  agent: Pick<AgentDetail, "name" | "tagline" | "avatarSeed" | "isPublic" | "llmKeyId" | "paperStartingUsd" | "status">,
  config: AgentConfig,
): BuilderDraft {
  return {
    name: agent.name,
    tagline: agent.tagline ?? "",
    avatarSeed: agent.avatarSeed ?? agent.name,
    isPublic: agent.isPublic,
    llmKeyId: agent.llmKeyId,
    paperStartingUsd: agent.paperStartingUsd,
    activate: agent.status === "active",
    goLive: false,
    funding: { mode: "paper", amountUsd: 0, gasUsd: 0, split: null },
    config,
  };
}

/**
 * A working copy as a saved agent: what the server holds once that copy has been saved,
 * as far as the page can know before it is told. Between a save and the page catching up,
 * this is the copy to compare with.
 */
export function savedFrom(draft: BuilderDraft): SavedAgent {
  return {
    name: draft.name.trim(),
    tagline: draft.tagline.trim() || null,
    avatarSeed: draft.avatarSeed,
    isPublic: draft.isPublic,
    llmKeyId: thinkSource(draft.config) === "usdc" ? null : draft.llmKeyId,
    paperStartingUsd: draft.paperStartingUsd,
    config: configToSave(draft),
  };
}

/**
 * The working copy the page may use, given the server's answer on whether the paper
 * balance can still be changed.
 *
 * While it can, the copy is the one being edited. Once it cannot, the balance in it is
 * the saved one, whatever was typed before: an edit made while the balance was open
 * (in this visit, or kept from an earlier one and put back) is not something to save any
 * more, and left in the copy it would mark the Schedule step as changed and have every
 * save refused for it. The rest of the copy is untouched, and so are its edits.
 */
export function withPaperBalance(working: BuilderDraft, savedUsd: number, open: boolean): BuilderDraft {
  return open || working.paperStartingUsd === savedUsd ? working : { ...working, paperStartingUsd: savedUsd };
}

// ------------------------------------------------------------- what a save sends

/**
 * The config a save sends. The working one, except for a pay-per-use agent that was saved
 * without its model and limits: the panel shows the defaults for it, so those are what is
 * saved, and the Brain step says it has something to save.
 */
export function configToSave(draft: BuilderDraft): AgentConfig {
  const { config } = draft;
  if (thinkSource(config) !== "usdc" || config.llm.usdc) return config;
  return { ...config, llm: { ...config.llm, source: "usdc", usdc: defaultUsdc(config.schedule.intervalMinutes) } };
}

/** The longest seed the save action takes (`MAX_AVATAR_SEED` in src/server/actions/agents.ts). */
const MAX_AVATAR_SEED = 64;

/**
 * What a save sends, from the working copy and the agent as it is saved.
 *
 * The name and the tagline go trimmed, and an emptied tagline goes as an empty string:
 * left out, the server kept the old one and a tagline could never be cleared. An agent
 * that pays per use is saved with no key.
 *
 * The avatar is sent only when it has to be. When the owner picked another one. And when
 * an agent that never picked one is renamed: its picture is drawn from its name, so it
 * would change with the name, although the card showed the old picture when Save was
 * pressed. The seed sent then is the old name, which keeps it. A name too long to be a
 * seed is the one case left alone: sending it would only have the whole save refused.
 *
 * The paper starting balance is sent only when it was changed. The server takes a change
 * of it only while the agent has not traded and refuses the whole save otherwise,
 * so a save that leaves it alone must not carry it.
 */
export function savePayload(draft: BuilderDraft, saved: SavedAgent): SavePayload {
  const name = draft.name.trim();
  const picked = draft.avatarSeed !== (saved.avatarSeed ?? saved.name);
  const renamedWithoutSeed =
    saved.avatarSeed === null && name !== saved.name.trim() && draft.avatarSeed.trim().length <= MAX_AVATAR_SEED;
  return {
    name,
    tagline: draft.tagline.trim(),
    ...(picked || renamedWithoutSeed ? { avatarSeed: draft.avatarSeed } : {}),
    isPublic: draft.isPublic,
    llmKeyId: thinkSource(draft.config) === "usdc" ? null : draft.llmKeyId,
    ...(sameBalance(draft.paperStartingUsd, saved.paperStartingUsd) ? {} : { paperStartingUsd: draft.paperStartingUsd }),
    config: configToSave(draft),
  };
}

// ------------------------------------------------------------- what refuses a save

/**
 * What stops a save, keyed the way the builder's errors are, so the same table places
 * each one on its step (`placeOfError`). These four checks and no others: the rest of the
 * config is the server's to judge, and it answers in a sentence of its own.
 *
 *  - `name`: two characters to `MAX_AGENT_NAME`.
 *  - `strategyPrompt`: the schema's own rule for it.
 *  - `thinking`: on pay per use, a model that is offered, limits in range and above what
 *    the schedule is expected to cost, and a Solana wallet to pay from.
 *  - `llmKeyId`: leaving pay per use with no key chosen, which would turn an agent that
 *    runs into one that fails every tick.
 *
 * A key agent that has no key is not refused. It never was: its owner must be able to
 * change anything else first. That it cannot run is said by `shownErrors`.
 */
export function validateEdit(
  draft: BuilderDraft,
  saved: Pick<SavedAgent, "config" | "llmKeyId">,
): Record<string, string> {
  const errors: Record<string, string> = {};

  const name = draft.name.trim();
  if (name.length < 2) errors.name = "Give it a name — at least two characters.";
  else if (name.length > MAX_AGENT_NAME) errors.name = `Keep the name to ${MAX_AGENT_NAME} characters or fewer.`;

  const strategy = agentConfigSchema.shape.strategyPrompt.safeParse(draft.config.strategyPrompt);
  if (!strategy.success) {
    errors.strategyPrompt = strategy.error.issues[0]?.message ?? "Describe the strategy in at least a sentence.";
  }

  if (thinkSource(draft.config) === "usdc") {
    // Checked as it will be saved, so an agent shown the default limits is judged on them.
    const { llm, schedule, chains } = configToSave(draft);
    const problem = firstUsdcError(checkUsdc({ usdc: llm.usdc, intervalMinutes: schedule.intervalMinutes, chains }));
    if (problem) errors.thinking = problem;
  } else if (thinkSource(saved.config) === "usdc" && draft.llmKeyId === null) {
    errors.llmKeyId = "Choose or add a key before saving, or stay on pay per use. Without one every run would fail.";
  }

  return errors;
}

/** The builder's errors that are on show from the moment the page opens. */
const ALWAYS_SHOWN = ["llmKeyId", "llm", "thinking", "chains"] as const;
/** The refusals that are shown only once a save has been refused for them. */
const SHOWN_ONCE_REFUSED = ["name", "strategyPrompt"] as const;

/**
 * The errors the page displays: under a field, in the Brain step's first line, on the
 * agent card's "Yours to decide" and as "Fix" on the rail.
 *
 * How the agent thinks is judged by the builder's own `validateDraft`, at all times: a
 * saved agent with no usable key, or with pay-per-use limits that cannot be saved, has
 * something wrong with it now, whether or not anyone has pressed Save. A name or a
 * strategy is only marked after a save was refused for it (`refused`, the result of that
 * `validateEdit`, less whatever has been edited since). So every key of a refused save
 * is in here until the thing it is about is edited.
 *
 * `opts.payPerUseOffered` is what the steps are given as "allowed": the account may use
 * pay per use, or this agent is saved on it.
 */
export function shownErrors(
  draft: BuilderDraft,
  keys: readonly KeyRef[],
  opts: { payPerUseOffered: boolean },
  refused: Record<string, string> | null,
): Record<string, string> {
  const found = validateDraft(draft, keys, { payPerUseAllowed: opts.payPerUseOffered });
  const shown: Record<string, string> = {};
  for (const key of ALWAYS_SHOWN) if (found[key]) shown[key] = found[key];
  if (refused) {
    for (const key of SHOWN_ONCE_REFUSED) if (refused[key]) shown[key] = refused[key];
    // The refusal's sentence says what the choice is, which the builder's does not.
    if (refused.llmKeyId) shown.llmKeyId = refused.llmKeyId;
    // The builder files a missing Solana wallet under the chain picker, where it is
    // fixed. The save was refused on how the agent thinks, so that step is marked too.
    if (refused.thinking && !shown.thinking) shown.thinking = refused.thinking;
  }
  return shown;
}

/**
 * What is left of a refused save's errors after an edit. Each goes the moment the thing
 * it is about is edited, so a mark never outlives the mistake. Null when none is left.
 */
export function stillRefused(
  refused: Record<string, string> | null,
  before: BuilderDraft,
  after: BuilderDraft,
): Record<string, string> | null {
  if (refused === null) return null;
  const edited = (key: keyof Config) => !sameConfig(before.config[key], after.config[key]);
  const gone: Record<string, boolean> = {
    name: before.name !== after.name,
    strategyPrompt: before.config.strategyPrompt !== after.config.strategyPrompt,
    // Everything the pay-per-use check reads: the model and limits, the schedule they are
    // priced at, and the chains the wallet that pays is on.
    thinking: edited("llm") || edited("schedule") || edited("chains"),
    // A key chosen or added, or the way it thinks changed.
    llmKeyId: before.llmKeyId !== after.llmKeyId || edited("llm"),
  };
  const left = Object.fromEntries(Object.entries(refused).filter(([key]) => !gone[key]));
  return Object.keys(left).length > 0 ? left : null;
}

// ------------------------------------------------------------- what has changed

/** The seven steps that hold settings, in rail order. Manage holds none. */
const EDIT_STEPS = SETTINGS_STEPS.filter((step): step is SharedStepId => step !== "manage");

/**
 * The steps with unsaved edits, each answering for what its own controls write. The page
 * is dirty exactly when this is not empty.
 *
 * Sections of the config are compared whatever order their keys are in, because the
 * database does not keep it. The name and the tagline are compared trimmed, as they are
 * sent, so a space typed after a name is not a change. The key does not count on pay per
 * use, which is saved with none. The paper starting balance is on the Schedule step, and
 * counts there.
 */
export function changedSteps(draft: BuilderDraft, saved: SavedAgent): Set<SharedStepId> {
  const next = configToSave(draft);
  const was = saved.config;
  const differs = (key: keyof AgentConfig) => !sameConfig(next[key], was[key]);
  const changed: Record<SharedStepId, boolean> = {
    name:
      draft.name.trim() !== saved.name.trim() ||
      draft.tagline.trim() !== (saved.tagline ?? "").trim() ||
      draft.avatarSeed !== (saved.avatarSeed ?? saved.name) ||
      draft.isPublic !== saved.isPublic,
    strategy: differs("strategyPrompt"),
    // The chain picker is drawn with the hunting ground, so the chains count here.
    hunts: differs("chains") || differs("universe"),
    data: differs("dataSources"),
    // The exit rules, the position sizing and the per-run data cap are part of `risk`.
    limits: differs("risk"),
    schedule:
      differs("schedule") || differs("execution") || !sameBalance(draft.paperStartingUsd, saved.paperStartingUsd),
    brain: differs("llm") || (thinkSource(next) !== "usdc" && draft.llmKeyId !== saved.llmKeyId),
  };
  return new Set(EDIT_STEPS.filter((step) => changed[step]));
}

/**
 * The status of one step of the settings page, in the rail's own terms: `fix` when an
 * error on show belongs to it, `edited` when it holds unsaved edits, `defaults` when it
 * is as saved. The page words those "Fix", "Changed" and "Saved". Fix wins: a step with
 * a mistake on it is not merely changed.
 *
 * `errors` is `shownErrors`' result. Manage is always as saved, because nothing on it
 * waits for Save. The saved agent is not read: `changed` and `errors` already carry what
 * it decides.
 */
export function editStatus(
  step: SettingsStepId,
  changed: ReadonlySet<SharedStepId>,
  errors: Record<string, string>,
  _saved?: SavedAgent,
): StepStatus {
  if (step === "manage") return "defaults";
  // An error with no home on these steps is placed on the builder's last one, which this
  // page does not have, so it marks nothing here.
  if (Object.keys(errors).some((key) => errors[key] && placeOfError(key).step === step)) return "fix";
  return changed.has(step) ? "edited" : "defaults";
}

/**
 * What each step is called in the sentence about what is unsaved: the name it has where
 * there is room for more than a word, as on the button that leads to it. Exported so the
 * page that draws the steps can be held to these words.
 */
export const UNSAVED_STEP_NAMES: Record<SharedStepId, string> = {
  name: "Name",
  strategy: "Strategy",
  hunts: "Where it hunts",
  data: "Data it buys",
  limits: "Risk limits",
  schedule: "Schedule & mode",
  brain: "How it thinks",
};

/** Past this many, the sentence counts the steps and leaves their names to the rail. */
const MOST_NAMED = 3;

/**
 * Whether the paper starting balance is the only thing a save of this copy would change.
 * Such a save touches nothing a live agent trades with: its real-money book never reads
 * the paper balance, so nothing about it "applies to real money".
 */
export function onlyPaperBalanceChanged(draft: BuilderDraft, saved: SavedAgent): boolean {
  if (sameBalance(draft.paperStartingUsd, saved.paperStartingUsd)) return false;
  return changedSteps({ ...draft, paperStartingUsd: saved.paperStartingUsd }, saved).size === 0;
}

/**
 * The bottom bar's sentence about what is unsaved: how many steps and, while they fit,
 * which. On an agent that trades real money it also says when a save takes effect.
 */
export function saveStateText(changed: ReadonlySet<SharedStepId>, live: boolean): string {
  const steps = EDIT_STEPS.filter((step) => changed.has(step));
  if (steps.length === 0) return "Everything is saved";
  const count = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  const names = steps.length > MOST_NAMED ? "" : `: ${steps.map((step) => UNSAVED_STEP_NAMES[step]).join(", ")}`;
  return `Unsaved changes on ${count}${names}${live ? " · applies to real money from the next tick" : ""}`;
}

/** The same in the room a phone's bar has: "2 steps unsaved". */
export function saveStateShort(changed: ReadonlySet<SharedStepId>): string {
  const count = EDIT_STEPS.filter((step) => changed.has(step)).length;
  if (count === 0) return "Everything is saved";
  return `${count} step${count === 1 ? "" : "s"} unsaved`;
}

// ------------------------------------------------------------- a live agent

type Risk = AgentConfig["risk"];

/**
 * A slider hands back `min + n * step` in floating point, so a limit dragged away and
 * back can differ from itself in its last digit. Less than this is not a change.
 */
const EPSILON = 1e-9;

/**
 * Whether a limit is higher than it was. Asked as "not shown to be the same or lower", so
 * a saved limit that cannot be read as a number counts as raised by any number put in its
 * place: an unread limit must not be what lets a larger one through unasked.
 */
function raised(was: number, next: number): boolean {
  return Number.isFinite(next) && !(next <= was + EPSILON);
}

/** The same the other way, for a floor: lower lets more through. */
function lowered(was: number, next: number): boolean {
  return Number.isFinite(next) && !(next >= was - EPSILON);
}

/** A rule that is off is stored as null, and one a config predates is not stored at all. */
function isOn(value: number | null | undefined): value is number {
  return typeof value === "number";
}

function wholePct(value: number): string {
  return `${Math.round(value)}%`;
}

/** Slippage the way its own slider words it: basis points as a percentage, two places. */
function slippagePct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function sizingWords(sizing: PositionSizingConfig): string {
  if (sizing.mode === "fixed_usd") return "fixed at the max per trade";
  const share = `${Math.round(sizing.percentOfEquity * 100) / 100}% of equity`;
  if (sizing.mode === "percent_equity") return share;
  return `${share}, less on a token ranging over ${Math.round(sizing.referenceRangePct * 100) / 100}%`;
}

/**
 * Whether a change of sizing can make a ticket larger, whatever the agent's equity is and
 * however the token has been ranging. Under one cap a fixed ticket is the largest there
 * is, a share of equity is that or less, and a share scaled down for volatility is that
 * or less again. So a move up that ladder can raise a ticket and a move down never does.
 * Within a rung, a larger share can, and so can a wider reference range, which is what a
 * volatile token's ticket is scaled by.
 */
function sizingLoosened(was: PositionSizingConfig, next: PositionSizingConfig): boolean {
  if (was.mode === "fixed_usd") return false;
  if (next.mode === "fixed_usd") return true;
  if (raised(was.percentOfEquity, next.percentOfEquity)) return true;
  if (was.mode === "percent_equity") return false;
  if (next.mode === "percent_equity") return true;
  return raised(was.percentOfEquity * was.referenceRangePct, next.percentOfEquity * next.referenceRangePct);
}

/**
 * An exit rule's line, when a save would take the rule away or let a position go further
 * before it fires. `wider` says which way further is: a stop loss is wider when the
 * figure goes up, a score floor when it goes down.
 */
function exitLine(
  label: string,
  was: number | null | undefined,
  next: number | null | undefined,
  wider: (was: number, next: number) => boolean,
  say: (value: number) => string,
): string | null {
  if (!isOn(was)) return null;
  if (!isOn(next)) return `${label} switched off (was ${say(was)})`;
  return wider(was, next) ? `${label} ${say(was)} → ${say(next)}` : null;
}

/**
 * The position limit's line, when a save takes the limit away or lets the agent hold
 * more tokens. Setting one where there was none, or lowering it, is tightening and says
 * nothing. Both sides are read the way the guard reads them, so a config with no such
 * field is one with no limit.
 */
function positionLimitLine(was: Risk, next: Risk): string | null {
  const before = readMaxOpenPositions(was);
  const after = readMaxOpenPositions(next);
  if (before === null) return null;
  if (after === null) return `Max open positions switched off (was ${before})`;
  return raised(before, after) ? `Max open positions ${before} → ${after}` : null;
}

/**
 * The cash reserve's line, when a save takes the reserve away or lets a buy reach
 * further into the agent's cash. Raising it, or setting one where there was none, never
 * asks.
 */
function cashReserveLine(was: Risk, next: Risk): string | null {
  const before = readCashReserveUsd(was);
  const after = readCashReserveUsd(next);
  if (!(before > 0)) return null;
  if (!(after > 0)) return `Cash reserve switched off (was ${formatUsd(before)})`;
  return lowered(before, after) ? `Cash reserve ${formatUsd(before)} → ${formatUsd(after)}` : null;
}

/**
 * What a save would loosen on an agent that trades real money, one line each, in the
 * order the limits are set on the page. Empty when the save loosens nothing, and then
 * nobody is asked anything.
 *
 * A line is here because the change lets more money move, or lets it move with less of a
 * check: a cap raised, a position limit raised or taken away, a cash reserve lowered or
 * taken away, a larger ticket, trading without approval, a chain added, an exit taken
 * away or set wider. Tightening any of them is never a line, and neither is a
 * change that moves no limit (the strategy, the universe, the data sources, the schedule,
 * the model).
 */
export function liveSaveWarnings(saved: AgentConfig, next: AgentConfig): string[] {
  const was: Risk = saved.risk;
  const now: Risk = next.risk;
  const lines: Array<string | null> = [];

  lines.push(
    raised(was.maxTradeUsd, now.maxTradeUsd)
      ? `Max per trade ${formatUsd(was.maxTradeUsd)} → ${formatUsd(now.maxTradeUsd)}`
      : null,
    raised(was.maxDailyTrades, now.maxDailyTrades)
      ? `Max trades per day ${was.maxDailyTrades} → ${now.maxDailyTrades}`
      : null,
    raised(was.maxPositionPct, now.maxPositionPct)
      ? `Max position size ${wholePct(was.maxPositionPct)} → ${wholePct(now.maxPositionPct)}`
      : null,
    raised(was.maxDataSpendUsdPerRun, now.maxDataSpendUsdPerRun)
      ? `Data spend cap per run ${formatUsd(was.maxDataSpendUsdPerRun)} → ${formatUsd(now.maxDataSpendUsdPerRun)}`
      : null,
    raised(was.slippageBps, now.slippageBps)
      ? `Slippage tolerance ${slippagePct(was.slippageBps)} → ${slippagePct(now.slippageBps)}`
      : null,
    positionLimitLine(was, now),
    cashReserveLine(was, now),
  );

  const sizingWas = readSizing(was);
  const sizingNow = readSizing(now);
  if (sizingLoosened(sizingWas, sizingNow)) {
    lines.push(`Position sizing ${sizingWords(sizingWas)} → ${sizingWords(sizingNow)}`);
  }

  // From anything that is not already trading on its own.
  if (next.execution.mode === "auto" && saved.execution.mode !== "auto") {
    lines.push("Trades on its own, without asking you");
  }

  for (const chain of new Set(next.chains)) {
    if (!saved.chains.includes(chain)) lines.push(`Also trades on ${chainLabelFor(chain)}`);
  }

  lines.push(
    exitLine("Stop loss", was.stopLossPct, now.stopLossPct, raised, (v) => `${v}%`),
    exitLine("Score floor", was.exitScoreBelow, now.exitScoreBelow, lowered, (v) => `${v}`),
    exitLine("Liquidity collapse exit", was.exitOnLiquidityDropPct, now.exitOnLiquidityDropPct, raised, (v) => `${v}%`),
  );

  return lines.filter((line): line is string => line !== null);
}

// ------------------------------------------------------------- when the copy may move

/**
 * The working copy of a settings page and everything that decides when it changes.
 *
 * The page is re-rendered under it all the time: pausing the agent, funding it, a
 * withdrawal, a wallet budget and coming back to its tab all refresh the page, and each
 * hands it a fresh copy of the saved agent. None of those may touch what the owner is in
 * the middle of editing. So the working copy is replaced whole in three cases only: this
 * page's own save has come back from the server, Discard, and putting a copy back (an
 * Undo, or edits kept from an earlier visit). A copy is put back only while nothing has
 * been edited since it was offered, so it never replaces something newer than itself.
 */
export interface EditState {
  /** What the steps show and a save sends. */
  working: BuilderDraft;
  /** The saved agent as the page was last told it, as a working copy. Follows the page; nothing here writes it. */
  saved: BuilderDraft;
  /**
   * A save of this page's that the page has not caught up with yet: the copy that was
   * sent, and the saved copy from just before it. Null at every other time.
   */
  pending: { sent: BuilderDraft; base: BuilderDraft } | null;
  /** The errors of the last refused save, less whatever has been edited since. */
  refused: Record<string, string> | null;
  /** Goes up each time the working copy is replaced whole, so the agent card does not mark every row as changed. */
  quietKey: number;
  /**
   * Goes up each time the owner changes the working copy: an edit, or a copy put back. An
   * offer to put a copy back (Undo, Restore) is good only for as long as it has not moved.
   */
  edits: number;
}

export type EditEvent =
  /** A control was changed: a patch of the draft, a patch of its config, or both. */
  | { type: "edit"; patch?: Partial<BuilderDraft>; config?: Partial<Config> }
  /** The page was handed the saved agent again. `saved` is `draftOf` it. */
  | { type: "propsChanged"; saved: BuilderDraft }
  /**
   * This page's save succeeded. `sent` is the working copy as it was when it was sent,
   * the same object the payload was built from.
   */
  | { type: "saved"; sent: BuilderDraft }
  /** A save was refused before it was sent. `errors` is `validateEdit`'s result. */
  | { type: "refused"; errors: Record<string, string> }
  /** Back to what is saved. */
  | { type: "discard" }
  /**
   * Put a copy back as the working copy. Nothing is saved by it. `since` is `edits` as it
   * was when the copy was offered.
   */
  | { type: "restore"; draft: BuilderDraft; since: number };

/** The state a settings page opens in: the working copy is the saved agent. */
export function startEdit(saved: BuilderDraft): EditState {
  return { working: saved, saved, pending: null, refused: null, quietKey: 0, edits: 0 };
}

/**
 * Whether two copies, working or saved, agree on everything a save writes, whatever order
 * the keys of their configs are in. That includes the paper starting balance, which a
 * save writes when it was changed. What no save writes (whether the agent is running) is
 * not looked at.
 */
export function sameSettings(a: BuilderDraft, b: BuilderDraft): boolean {
  return (
    a.name === b.name &&
    a.tagline === b.tagline &&
    a.avatarSeed === b.avatarSeed &&
    a.isPublic === b.isPublic &&
    a.llmKeyId === b.llmKeyId &&
    sameBalance(a.paperStartingUsd, b.paperStartingUsd) &&
    sameConfig(a.config, b.config)
  );
}

/**
 * The working copy after this page's save came back: what the server now holds, except
 * where the owner went on editing while the save was on its way. Anything that still
 * reads as it was sent is taken from the server, so a name sent as "Aileen " comes back
 * as "Aileen". Anything that differs from what was sent was typed since, and is kept.
 */
function rebased(working: BuilderDraft, sent: BuilderDraft, server: BuilderDraft): BuilderDraft {
  if (working === sent) return server;
  const config: Record<string, unknown> = { ...server.config };
  const sections = new Set([...Object.keys(working.config), ...Object.keys(sent.config)]) as Set<keyof Config>;
  for (const key of sections) {
    if (!sameConfig(working.config[key], sent.config[key])) config[key] = working.config[key];
  }
  return {
    ...server,
    name: working.name === sent.name ? server.name : working.name,
    tagline: working.tagline === sent.tagline ? server.tagline : working.tagline,
    avatarSeed: working.avatarSeed === sent.avatarSeed ? server.avatarSeed : working.avatarSeed,
    isPublic: working.isPublic === sent.isPublic ? server.isPublic : working.isPublic,
    llmKeyId: working.llmKeyId === sent.llmKeyId ? server.llmKeyId : working.llmKeyId,
    paperStartingUsd:
      working.paperStartingUsd === sent.paperStartingUsd ? server.paperStartingUsd : working.paperStartingUsd,
    config: config as Config,
  };
}

/** The rules of the working copy, as a reducer, so a hook can hold them and a test can run them. */
export function editReducer(state: EditState, event: EditEvent): EditState {
  switch (event.type) {
    case "edit": {
      const working: BuilderDraft = {
        ...state.working,
        ...event.patch,
        config: { ...(event.patch?.config ?? state.working.config), ...event.config },
      };
      return {
        ...state,
        working,
        refused: stillRefused(state.refused, state.working, working),
        edits: state.edits + 1,
      };
    }
    case "propsChanged": {
      if (event.saved === state.saved) return state;
      const { pending } = state;
      // Not the answer to a save of this page's. Either none is awaited, or this copy
      // shows nothing a save writes as different from before the save: a refresh that
      // was already on its way (a pause pressed a moment earlier), carrying the agent as
      // it was. Taking that for the save's answer would put the old settings back.
      if (pending === null || sameSettings(event.saved, pending.base)) return { ...state, saved: event.saved };
      return {
        ...state,
        working: rebased(state.working, pending.sent, event.saved),
        saved: event.saved,
        pending: null,
        quietKey: state.quietKey + 1,
      };
    }
    case "saved":
      // The page can be handed the saved agent a moment before it hears that its own save
      // went through. Then that copy already shows everything that was sent, there is
      // nothing left to wait for, and waiting would take some later, unrelated refresh
      // for the answer.
      if (changedSteps(event.sent, state.saved).size === 0) {
        return {
          ...state,
          working: rebased(state.working, event.sent, state.saved),
          pending: null,
          refused: null,
          quietKey: state.quietKey + 1,
        };
      }
      return { ...state, pending: { sent: event.sent, base: state.saved }, refused: null };
    case "refused":
      return { ...state, refused: Object.keys(event.errors).length > 0 ? event.errors : null };
    case "discard":
      return {
        ...state,
        // While a save is awaited, what is saved is what was sent: the page's own copy of
        // the agent is from before it.
        working: state.pending ? state.pending.sent : state.saved,
        refused: null,
        quietKey: state.quietKey + 1,
      };
    case "restore":
      // The copy on offer is a whole one, from the moment it was offered. Anything the
      // owner has changed since is newer than it, and putting it back would drop that
      // change with nothing left to get it back from. The page takes the offer down at
      // the first edit; this is the same rule for a press that got in before it did.
      if (event.since !== state.edits) return state;
      return {
        ...state,
        working: event.draft,
        refused: null,
        quietKey: state.quietKey + 1,
        edits: state.edits + 1,
      };
  }
}
