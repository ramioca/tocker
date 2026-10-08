/**
 * The figures and sentences the builder quotes about a draft: the read-back line of each
 * rule step, the cost sentence of the bottom bar, and the agent card. Each is worked out
 * here, once, so the card and the page can never quote two different numbers for the
 * same draft.
 *
 * Pure, no React, and it imports only `.ts` modules so a node test can load it
 * (`summaries.test.ts`). The two labels that live in `.tsx` files arrive as `labels`,
 * and the hunts text arrives as a string.
 *
 * The summaries and the one-line cost text were inline in `agent-builder.tsx`. They are
 * moved, not reworded: the tests pin them character for character.
 *
 * An agent's settings page shows the same card over a saved agent. Three of these would
 * then state a plan that was carried out when the agent was created (how it starts, how
 * it is funded, what is signed). Each of them takes an `edit` and, given one, says what
 * is true of the agent now. Without it every string is what it has always been.
 */
import { formatUsd } from "@/components/common/format";
import { formatFeeRate } from "@/lib/platform/fee";
import { checkUsdc, shownSource, usdcEstimate, walletNeedUsd } from "@/components/agents/thinking";
import { providerLabel as providerLabelFor, withArticle } from "@/lib/agent/providers";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { DataSourceInfo } from "@/server/types";
import {
  REQUIRED_ERROR_KEYS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  ROW_PLACE,
  type BuilderStepId,
  type CostFacts,
  type CostLine,
  type KeyRef,
  type PreviewRow,
  type PreviewRowId,
  type ReadyItem,
  type RequiredId,
  type SettingsStepId,
  type StepPlace,
  type SummaryEdit,
  type SummaryLabels,
} from "./contract";
import {
  PAID_LAUNCH_RADAR_USD_PER_CHAIN,
  STRATEGY_PRESETS,
  launchRadarUsdPerRun,
  type BuilderDraft,
} from "./types";
import { validateDraft } from "./validate";

/** Every figure the summaries quote, from the draft and the priced sources. */
export function costFacts(
  draft: BuilderDraft,
  sources: DataSourceInfo[],
  opts: { payPerUseAllowed: boolean; feeBps: number },
): CostFacts {
  const chosen = sources.filter((source) => draft.config.dataSources.includes(source.id));
  const sourcesPerRun = chosen.reduce((sum, source) => sum + (source.priceUsd ?? 0.01), 0);
  const radarPerRun = launchRadarUsdPerRun(draft.config.universe.discovery, draft.config.chains);
  // An estimate, not a ceiling: the cap below is the ceiling, so never show more than it.
  const costPerRun = Math.min(sourcesPerRun + radarPerRun, draft.config.risk.maxDataSpendUsdPerRun);
  const interval = draft.config.schedule.intervalMinutes;
  const runsPerDay = interval === 0 ? 0 : Math.round(1_440 / interval);
  // Pay per use: the run count and the cost are the panel's own estimate, so the commit
  // bar and the Brain step never quote two different numbers for the same schedule.
  const payPerUse = shownSource(draft.config, opts.payPerUseAllowed) === "usdc";
  const thinking = payPerUse ? usdcEstimate(draft.config.llm.usdc?.model, interval) : null;
  const thinkingNeedUsd = payPerUse && draft.config.llm.usdc ? walletNeedUsd(draft.config.llm.usdc) : null;
  return {
    chosenCount: chosen.length,
    sourcesPerRun,
    radarPerRun,
    costPerRun,
    dataCapUsd: draft.config.risk.maxDataSpendUsdPerRun,
    intervalMinutes: interval,
    runsPerDay,
    payPerUse,
    thinking,
    thinkingNeedUsd,
    providerLabel: providerLabelFor(draft.config.llm.provider),
    // Funded and headed for the checklist: the create holds its schedule until the switch.
    heldForLive: draft.funding.mode === "fund" && draft.goLive,
    feeBps: opts.feeBps,
  };
}

/** The "Data it buys" line: the step's read-back and the agent card's row. */
export function dataSummary(facts: CostFacts): string {
  return facts.chosenCount === 0 && facts.radarPerRun === 0
    ? // Not "nothing to pay for": every sweep buys the launch radar whatever
      // the feed list says (`discover_tokens`), and Tocker pays for it.
      `No paid sources. Each sweep still buys the launch radar (about ${formatUsd(PAID_LAUNCH_RADAR_USD_PER_CHAIN)} a chain), paid by Tocker.`
    : `${[
        facts.chosenCount > 0 ? `${facts.chosenCount} paid source${facts.chosenCount === 1 ? "" : "s"}` : null,
        facts.radarPerRun > 0 ? "launch radar" : null,
      ]
        .filter(Boolean)
        .join(" + ")} · ≈${formatUsd(facts.costPerRun)} per run, paid by Tocker`;
}

/**
 * The "Risk limits" line. The fee closes it, as its rate: this is the one sentence about
 * trades that is on screen before any control, and nothing else names the fee. The rate
 * is the server's, in basis points, handed down as a prop; 0 when the fee is off.
 */
export function riskSummary(risk: BuilderDraft["config"]["risk"], feeBps: number): string {
  return `${formatUsd(risk.maxTradeUsd)}/trade · ${risk.maxDailyTrades}/day · ${risk.maxPositionPct}% max position · ${formatUsd(risk.maxDataSpendUsdPerRun)} data/run${
    feeBps > 0 ? ` · Tocker fee ${formatFeeRate(feeBps)} of each fill` : ""
  }`;
}

/** A hold limit in the short form of `ttlLabel`: "30 min", "6 h", "3 d". Never "0.5 h". */
function holdLabel(hours: number): string {
  if (!Number.isInteger(hours)) return `${Math.round(hours * 60)} min`;
  return hours >= 48 && hours % 24 === 0 ? `${hours / 24} d` : `${hours} h`;
}

/**
 * The agent card's "When it sells" row: the exit rules that are on, in the order the
 * Risk limits step lists them. A rule that is off is left out.
 */
export function exitSummary(risk: BuilderDraft["config"]["risk"]): string {
  const on = (value: number | null | undefined): value is number => value !== null && value !== undefined;
  const parts = [
    on(risk.stopLossPct) ? `stop ${risk.stopLossPct}%` : null,
    on(risk.takeProfitPct) ? `take ${risk.takeProfitPct}%` : null,
    on(risk.trailingStopPct) ? `trail ${risk.trailingStopPct}%` : null,
    on(risk.maxHoldHours) ? `max hold ${holdLabel(risk.maxHoldHours)}` : null,
    on(risk.exitScoreBelow) ? `score under ${risk.exitScoreBelow}` : null,
    on(risk.exitOnLiquidityDropPct) ? `liquidity −${risk.exitOnLiquidityDropPct}%` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "No automatic exits";
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * The "Funding" line. A saved agent has no funding left to plan, so with `edit` this is
 * its "Money" line: what its wallets hold, in the words the page already uses for it
 * (`edit.balanceText`, which is also what says so when a wallet could not be read), then
 * the mode it is in.
 */
export function fundingSummary(draft: BuilderDraft, facts: CostFacts, edit?: SummaryEdit): string {
  if (edit) return `${edit.balanceText} · ${edit.mode}`;
  return draft.funding.mode === "paper"
    ? facts.thinkingNeedUsd !== null
      ? // Paper trades need no money; pay-per-use thinking does, from the first run.
        `Paper only. Its wallets are created empty, and it cannot think until its Solana wallet holds ${formatUsd(facts.thinkingNeedUsd)} of USDC`
      : "Paper only — its wallets are created empty, fund it whenever you like"
    : `${formatUsd(draft.funding.amountUsd)} USDC, signed by you on create`;
}

/**
 * The "Schedule & mode" line. With `edit` it closes on the mode the saved agent is in:
 * how it starts and what it starts with were decided when it was created, and no save
 * changes either. Only the mode is read, so the Schedule step, which is told the mode and
 * not the balance, can quote the same line as the agent card.
 */
export function scheduleSummary(
  draft: BuilderDraft,
  facts: CostFacts,
  labels: SummaryLabels,
  edit?: Pick<SummaryEdit, "mode">,
): string {
  const interval = facts.intervalMinutes;
  const execution = executionLabel(draft.config.execution, labels);
  if (edit) return `${labels.interval(interval)} · ${execution} · ${edit.mode}`;
  return facts.heldForLive
    ? `${labels.interval(interval)} · ${execution} · real money only, live after the checklist`
    : draft.funding.mode === "fund"
      ? `${labels.interval(interval)} · ${execution} · paper on the funded amount until you go live`
      : `${labels.interval(interval)} · ${execution} · ${draft.activate ? "starts active" : "starts paused"} · ${paperLabel(draft.paperStartingUsd)} paper`;
}

/**
 * "asks before each trade (1 h to decide)" or "trades on its own". "Ask me first" is the
 * default, and an agent in it never fills until you approve; away from the Schedule
 * step, nothing else on the page says so.
 */
export function executionLabel(execution: BuilderDraft["config"]["execution"], labels: SummaryLabels): string {
  return execution.mode === "approve"
    ? `asks before each trade (${labels.ttl(execution.proposalTtlMinutes)} to decide)`
    : "trades on its own";
}

/**
 * The paper balance in the short form of the Schedule step's buttons: "$10K". Only a
 * whole number of thousands has that form; anything else is the full amount, where
 * dividing by a thousand used to print "$12.345K".
 */
export function paperLabel(usd: number): string {
  return usd >= 1_000 && usd % 1_000 === 0 ? `$${usd / 1_000}K` : formatUsd(usd);
}

// What the "A way to think" row says while it is missing. `stillNeeded` reads these back,
// so the bar and the card name the same missing thing.
const PICK_A_MODEL = "Pick a model";
const CHECK_THE_LIMITS = "Check the limits";
const CHECK_THE_MODEL_SETTINGS = "Check the model settings";

/** How the agent thinks, from the errors `validateDraft` already found for this draft. */
function thinkFrom(
  draft: BuilderDraft,
  errors: Record<string, string>,
  opts: { payPerUseAllowed: boolean },
): { text: string; needed: boolean } {
  const { llm } = draft.config;
  const payPerUse = shownSource(draft.config, opts.payPerUseAllowed) === "usdc";
  if (payPerUse) {
    if (errors.thinking) {
      // The message is one string, so which control it belongs to is read from the same
      // check `validateDraft` ran. A missing model comes first there, and here.
      const check = checkUsdc({
        usdc: llm.usdc,
        intervalMinutes: draft.config.schedule.intervalMinutes,
        chains: draft.config.chains,
      });
      return { text: check.errors.model ? PICK_A_MODEL : CHECK_THE_LIMITS, needed: true };
    }
    if (errors.llm) return { text: CHECK_THE_MODEL_SETTINGS, needed: true };
    return { text: `Pay per use · ${llm.usdc?.model ?? ""}`, needed: false };
  }
  if (errors.llmKeyId) return { text: `Needs ${withArticle(llm.provider)} key`, needed: true };
  if (errors.llm) return { text: CHECK_THE_MODEL_SETTINGS, needed: true };
  return { text: `${providerLabelFor(llm.provider)} · ${llm.model} on your key`, needed: false };
}

/**
 * How the agent thinks, and whether that is still missing. `needed` is true exactly when
 * `validateDraft` returns `llmKeyId`, `thinking` or `llm` for the same draft: it is that
 * function's answer, not a second set of rules.
 */
export function thinkSummary(
  draft: BuilderDraft,
  keys: readonly KeyRef[],
  opts: { payPerUseAllowed: boolean },
): { text: string; needed: boolean } {
  return thinkFrom(draft, validateDraft(draft, keys, opts), opts);
}

/** "{Label} preset", "written for you" or "your own". */
export function strategyLabel(prompt: string): string {
  const preset = STRATEGY_PRESETS.find((candidate) => candidate.prompt === prompt);
  if (preset) return `${preset.label} preset`;
  return prompt === DEFAULT_AGENT_CONFIG.strategyPrompt ? "written for you" : "your own";
}

/**
 * The one-line cost text of the phone bar. One line on a phone: the full sentence
 * wrapped to five and made the bar a third of the screen. The money being signed stays
 * in it.
 */
export function commitShortLine(draft: BuilderDraft, facts: CostFacts): string {
  const { runsPerDay, thinking } = facts;
  return draft.funding.mode === "fund"
    ? `Signs ${formatUsd(draft.funding.amountUsd)} USDC · ${runsPerDay === 0 ? "manual runs" : `~${runsPerDay}/day`}`
    : runsPerDay === 0
      ? "Manual runs only"
      : thinking
        ? thinking.model
          ? `~${thinking.runsPerDay} runs/day · ≈${formatUsd(thinking.dayUsd)} thinking`
          : "Pick a model to see the cost"
        : // Whose bill the runs are, in the room one line has. The data estimate
          // that used to sit here is the part Tocker pays.
          `~${runsPerDay} runs/day on your key`;
}

const REQUIRED_LABEL: Record<RequiredId, string> = {
  strategy: "Strategy",
  think: "A way to think",
  name: "Name",
};

/**
 * The three "Yours to decide" rows, always three, in `REQUIRED_ORDER`. `errors` is the
 * whole of `validateDraft`'s result, not only the errors on show. `keys` is not read:
 * the errors already carry what the keys decide.
 */
export function readyItems(
  draft: BuilderDraft,
  errors: Record<string, string>,
  _keys: readonly KeyRef[],
  opts: { payPerUseAllowed: boolean },
): ReadyItem[] {
  const value: Record<RequiredId, (ready: boolean) => string> = {
    strategy: (ready) => (ready ? strategyLabel(draft.config.strategyPrompt) : "needed"),
    think: () => thinkFrom(draft, errors, opts).text,
    name: (ready) => (ready ? draft.name.trim() : "needed"),
  };
  return REQUIRED_ORDER.map((id) => {
    const ready = !REQUIRED_ERROR_KEYS[id].some((key) => errors[key]);
    return { id, label: REQUIRED_LABEL[id], ready, value: value[id](ready), place: REQUIRED_PLACE[id] };
  });
}

/** "a key and a name", or null when nothing required is missing. */
export function stillNeeded(items: ReadyItem[], errors: Record<string, string>): string | null {
  const words = items
    .filter((item) => !item.ready)
    .map((item) => {
      if (item.id === "strategy") return "a strategy";
      if (item.id === "name") return "a name";
      if (errors.llmKeyId) return "a key";
      // Pay per use has no key to ask for: what is missing is its model or its limits.
      if (item.value === PICK_A_MODEL) return "a model";
      if (item.value === CHECK_THE_LIMITS) return "its limits checked";
      return "its model settings checked";
    });
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const ROW_ORDER: readonly PreviewRowId[] = ["hunts", "data", "limits", "exits", "runs", "thinks", "money"];

// Each row is named after the step it leads to, so the agent card and the page use the same words.
const ROW_LABEL: Record<PreviewRowId, string> = {
  hunts: "Where it hunts",
  data: "Data it buys",
  limits: "Risk limits",
  exits: "When it sells",
  runs: "Schedule & mode",
  thinks: "How it thinks",
  money: "Funding",
};

/** What the last row is called on a saved agent's card, where it states a balance. */
const SAVED_MONEY_LABEL = "Money";

/**
 * A row of a saved agent's card. The same row, except that its place can be on the
 * settings page's own last step: that is where the money row leads.
 */
export type SavedPreviewRow = Omit<PreviewRow, "place"> & { place: StepPlace<BuilderStepId | SettingsStepId> };

/** A saved agent's money is in its wallets, which the settings page keeps under Manage. */
const SAVED_MONEY_PLACE: StepPlace<SettingsStepId> = { step: "manage", sub: "wallets" };

interface RowsContext {
  hunts: string;
  labels: SummaryLabels;
  payPerUseAllowed: boolean;
}

/**
 * The seven "Already set" rows, in the fixed order of `ROW_PLACE`. With `ctx.edit` the
 * card is a saved agent's: the schedule row closes on its mode, and the last row is its
 * money, not a funding plan, and leads to its wallets.
 */
export function previewRows(
  draft: BuilderDraft,
  facts: CostFacts,
  errors: Record<string, string>,
  ctx: RowsContext & { edit?: undefined },
): PreviewRow[];
export function previewRows(
  draft: BuilderDraft,
  facts: CostFacts,
  errors: Record<string, string>,
  ctx: RowsContext & { edit?: SummaryEdit },
): SavedPreviewRow[];
export function previewRows(
  draft: BuilderDraft,
  facts: CostFacts,
  errors: Record<string, string>,
  ctx: RowsContext & { edit?: SummaryEdit },
): SavedPreviewRow[] {
  const { edit } = ctx;
  const think = thinkFrom(draft, errors, { payPerUseAllowed: ctx.payPerUseAllowed });
  const text: Record<PreviewRowId, string> = {
    hunts: ctx.hunts,
    data: dataSummary(facts),
    limits: riskSummary(draft.config.risk, facts.feeBps),
    exits: exitSummary(draft.config.risk),
    runs: scheduleSummary(draft, facts, ctx.labels, edit),
    thinks: think.text,
    money: fundingSummary(draft, facts, edit),
  };
  return ROW_ORDER.map((id) => {
    const money = edit !== undefined && id === "money";
    return {
      id,
      label: money ? SAVED_MONEY_LABEL : ROW_LABEL[id],
      text: text[id],
      needed: id === "thinks" && think.needed,
      place: money ? SAVED_MONEY_PLACE : ROW_PLACE[id],
    };
  });
}

/**
 * The lines of "A run": how often, whose bill each part is, and what is signed. With
 * `edit` the last two are left out: a saved agent has nothing left to sign on create, and
 * what its wallet holds is on its money row.
 */
export function costLines(draft: BuilderDraft, facts: CostFacts, edit?: SummaryEdit): CostLine[] {
  const { thinking } = facts;
  const manual = facts.intervalMinutes === 0;
  const lines: CostLine[] = [];

  lines.push({
    id: "runs",
    label: "Runs",
    text: manual
      ? "Manual only"
      : facts.heldForLive
        ? "None until you switch it live on the checklist"
        : `${thinking?.model ? thinking.runsPerDay : facts.runsPerDay} a day`,
  });

  lines.push({
    id: "thinking",
    label: "Thinking",
    text: !thinking
      ? `billed to your ${facts.providerLabel} key`
      : !thinking.model
        ? // No listed model, no price: "$0.00 a day" would be a number nobody stands behind.
          "pick a model to see the cost"
        : manual
          ? // A manual schedule has no day of runs to price, only the run itself.
            `≈${formatUsd(thinking.runUsd)} a run, from the agent's wallet`
          : `≈${formatUsd(thinking.runUsd)} a run, about ${formatUsd(thinking.dayUsd)} a day, from the agent's wallet`,
  });

  lines.push({
    id: "data",
    label: "Data",
    text: `≈${formatUsd(facts.costPerRun)} a run, capped at ${formatUsd(facts.dataCapUsd)} · Tocker pays`,
  });

  if (facts.feeBps > 0) {
    lines.push({ id: "fee", label: "Fee", text: `${formatFeeRate(facts.feeBps)} of each fill` });
  }

  if (edit) return lines;

  if (draft.funding.mode === "fund") {
    lines.push({
      id: "sign",
      label: "You sign",
      text: `${formatUsd(draft.funding.amountUsd)} USDC right after it is created`,
    });
  }

  // Paper trades need no money; pay-per-use thinking does, from the first run.
  if (draft.funding.mode === "paper" && facts.thinkingNeedUsd !== null) {
    lines.push({
      id: "wallet",
      label: "Wallet needs",
      text: `${formatUsd(facts.thinkingNeedUsd)} of USDC before it can think`,
    });
  }

  return lines;
}

/** "Discover → Score 62+ → Propose → You approve". The last word follows the execution mode. */
export function runLine(config: BuilderDraft["config"]): string {
  return `Discover → Score ${config.universe.minScore}+ → Propose → ${
    config.execution.mode === "approve" ? "You approve" : "Trade"
  }`;
}
