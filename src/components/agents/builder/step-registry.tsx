import { Fragment } from "react";
import Link from "next/link";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { shownSource } from "@/components/agents/thinking";
import { providerLabel as providerLabelFor } from "@/lib/agent/providers";
import type { AgentConfig } from "@/db/schema";
import type { DataSourceInfo, LlmKeyRow } from "@/server/types";
import { cn } from "@/lib/utils";
import type {
  CostFacts,
  EditContext,
  SharedStepId,
  StepStatus,
  SummaryEdit,
  SummaryLabels,
} from "./contract";
import { FOCUS } from "./look";
import { StepPanel } from "./step-panel";
import {
  DataStep,
  IdentityStep,
  RiskStep,
  ScheduleStep,
  StrategyStep,
  ThinkStep,
  UniverseStep,
  ttlLabel,
  type StepProps,
} from "./steps";
import { dataSummary, riskSummary, scheduleSummary } from "./summaries";
import type { BuilderDraft } from "./types";
import { universeSummary } from "./universe-copy";

/**
 * The seven steps that edit an agent's config, as data, and the words the steps are
 * called by. Creating an agent and editing a saved one both draw their steps from here,
 * so a control, its helper sentence and its id are the same in both: neither page has a
 * config control of its own. What each page adds is its last step and what it does with
 * the result.
 */

/** The two labels the summaries cannot import themselves: they live in `.tsx` files. */
export const SUMMARY_LABELS: SummaryLabels = { interval: intervalLabel, ttl: ttlLabel };

/** One word each: eight of them share the width of the form. */
export const STEP_LABELS: Record<SharedStepId | "create" | "manage", string> = {
  name: "Name",
  strategy: "Strategy",
  hunts: "Hunts",
  data: "Data",
  limits: "Limits",
  schedule: "Schedule",
  brain: "Brain",
  create: "Create",
  manage: "Manage",
};

/**
 * What a step is called where there is room for more than a word: the Next button, the
 * phone's "Step 3 of 8" line and a screen reader.
 */
export const STEP_NAMES: Record<SharedStepId | "create" | "manage", string> = {
  name: "Name",
  strategy: "Strategy",
  hunts: "Where it hunts",
  data: "Data it buys",
  limits: "Risk limits",
  schedule: "Schedule & mode",
  brain: "How it thinks",
  create: "Review and create",
  manage: "Manage",
};

/**
 * The status of a step as a word. The states are the same on both pages and the words are
 * not: a draft's step is still on its defaults or was edited, a saved agent's step is as
 * it was saved or has changes waiting. A saved agent's step is never "needed" or "ready",
 * so those two only keep the map whole.
 */
export const STATUS_WORDS: Record<"create" | "edit", Record<StepStatus, string>> = {
  create: {
    needed: "Needed",
    ready: "Ready",
    defaults: "Defaults",
    edited: "Edited",
    fix: "Fix",
  },
  edit: {
    needed: "Fix",
    ready: "Saved",
    defaults: "Saved",
    edited: "Changed",
    fix: "Fix",
  },
};

/** What a step is given to draw itself: the page's draft and the facts the page has about it. */
export interface StepContext {
  /** Creating an agent, or editing a saved one. It picks the sentence under each title. */
  mode: "create" | "edit";
  draft: BuilderDraft;
  update: (patch: Partial<BuilderDraft>) => void;
  updateConfig: (patch: Partial<BuilderDraft["config"]>) => void;
  /** The errors on show under the controls. Creating: none until a Create has failed. */
  errors: Record<string, string>;
  /** Everything wrong with the draft, shown or not: the sentences under the titles read this. */
  allErrors: Record<string, string>;
  /** `costFacts` of the draft. */
  facts: CostFacts;
  sources: DataSourceInfo[];
  /** Tocker's flat fee per fill, from the server; 0 when it is off. */
  feeUsd: number;
  keys: LlmKeyRow[];
  onKeyAdded: (key: LlmKeyRow) => void;
  /**
   * Whether pay per use is offered. Editing, that is also true for an agent saved on it,
   * whoever is allowed what today, so it can always be moved to its owner's key.
   */
  payPerUseAllowed: boolean;
  /** Whether a step reads "Fix" on the rail. */
  fix: (id: SharedStepId) => boolean;
  /** Set only when the steps are editing a saved agent. */
  edit?: EditContext;
  /** With `edit`: what the read-back lines are told about the saved agent. */
  summary?: SummaryEdit;
}

export interface ConfigStep {
  id: SharedStepId;
  title: string;
  /** The sentence under the title. */
  lead: (ctx: StepContext) => React.ReactNode;
  /** The step's settings as one sentence, read back under the lead. */
  now?: (ctx: StepContext) => string;
  body: (ctx: StepContext) => React.ReactNode;
}

/** What every step body is handed. */
function bodyProps(ctx: StepContext): StepProps {
  return {
    draft: ctx.draft,
    update: ctx.update,
    updateConfig: ctx.updateConfig,
    errors: ctx.errors,
    hideHeading: true,
    edit: ctx.edit,
  };
}

/** How the Brain step opens over a saved agent: what it thinks on now, read from the draft itself. */
function savedThinkingLead(ctx: StepContext): string {
  const { draft } = ctx;
  if (shownSource(draft.config, ctx.payPerUseAllowed) === "usdc") {
    return "Paying per run in USDC from the agent's own wallet. No key needed.";
  }
  // The key has to be one the account still has, for the provider the model runs on.
  // Anything else fails every run, whatever a save would let through.
  const provider = draft.config.llm.provider;
  const usable = ctx.keys.some((key) => key.id === draft.llmKeyId && key.provider === provider);
  return usable
    ? `Using your ${providerLabelFor(provider)} key. Changing the key here is how a run that failed on its key gets a working one: adding a key in your account does not switch this agent by itself.`
    : "No key attached: every run fails until one is chosen here.";
}

/** The seven, in the order of the rail. */
export const CONFIG_STEPS: ReadonlyArray<ConfigStep> = [
  {
    id: "name",
    title: "Name it",
    lead: (ctx) =>
      ctx.mode === "edit"
        ? "The name sits above every trade it posts."
        : "The name sits above every trade it posts. The rest of this step is optional.",
    body: (ctx) => <IdentityStep {...bodyProps(ctx)} />,
  },
  {
    id: "strategy",
    title: "What should it do?",
    lead: (ctx) =>
      ctx.mode === "edit" ? (
        "Its standing instructions. A preset replaces the prompt and sets what it needs; nothing applies until you save."
      ) : ctx.allErrors.strategyPrompt ? (
        "Pick a starting point or write your own."
      ) : (
        <>
          Pick a starting point or write your own. One is already written
          <span className="hidden sm:inline">, so you can press Next</span>.
        </>
      ),
    body: (ctx) => <StrategyStep {...bodyProps(ctx)} feeUsd={ctx.feeUsd} />,
  },
  {
    id: "hunts",
    title: "Where it hunts",
    lead: (ctx) =>
      ctx.mode === "edit" ? (
        "Which tokens it is allowed to look at. Saved changes apply from the next tick."
      ) : ctx.fix("hunts") ? (
        "Which tokens it is allowed to look at. It needs a look before you can create."
      ) : (
        <>
          Which tokens it is allowed to look at.
          <span className="max-sm:hidden"> Already set: change it only if you want to.</span>
        </>
      ),
    now: (ctx) => universeSummary(ctx.draft.config.universe as AgentConfig["universe"], ctx.draft.config.chains),
    body: (ctx) => <UniverseStep {...bodyProps(ctx)} />,
  },
  {
    id: "data",
    title: "Data it buys",
    lead: (ctx) =>
      ctx.mode === "edit" ? (
        "What it pays to read before it decides. Saved changes apply from the next tick."
      ) : ctx.fix("data") ? (
        "What it pays to read before it decides. It needs a look before you can create."
      ) : (
        <>
          What it pays to read before it decides.
          <span className="max-sm:hidden"> Already set: change it only if you want to.</span>
        </>
      ),
    now: (ctx) => dataSummary(ctx.facts),
    body: (ctx) => <DataStep {...bodyProps(ctx)} sources={ctx.sources} />,
  },
  {
    id: "limits",
    title: "Risk limits",
    lead: (ctx) =>
      ctx.mode === "edit" ? (
        // Two layers of cap, and which is which: these are checked in app code before any
        // order is built; the wallet budget is enforced by the wallet itself.
        <>
          Enforced in code before any trade. Saved changes apply from the next tick and are recorded in your{" "}
          <Link href="/settings/security" className={cn("rounded text-foreground underline underline-offset-2", FOCUS)}>
            audit log
          </Link>
          . The wallet budget under Manage is a second, lower layer that holds even if this app does not.
        </>
      ) : ctx.fix("limits") ? (
        "Enforced in code before any trade. One of them needs a look before you can create."
      ) : (
        <>
          Enforced in code before any trade.
          <span className="max-sm:hidden"> Already set: change them only if you want to.</span>
        </>
      ),
    // The fee closes the line: this is the one sentence about trades that is on screen
    // before any control, and nothing else on the page names the fee.
    now: (ctx) => riskSummary(ctx.draft.config.risk, ctx.feeUsd),
    body: (ctx) => <RiskStep {...bodyProps(ctx)} feeUsd={ctx.feeUsd} />,
  },
  {
    id: "schedule",
    title: "Schedule & mode",
    lead: (ctx) =>
      ctx.mode === "edit" ? (
        "How often it runs and whether it asks you first. Saved changes apply from the next tick."
      ) : ctx.fix("schedule") ? (
        "How often it runs and whether it asks you first. It needs a look before you can create."
      ) : (
        <>
          How often it runs and whether it asks you first.
          <span className="max-sm:hidden"> Already set: change it only if you want to.</span>
        </>
      ),
    now: (ctx) => scheduleSummary(ctx.draft, ctx.facts, SUMMARY_LABELS, ctx.summary),
    body: (ctx) => <ScheduleStep {...bodyProps(ctx)} payPerUseAllowed={ctx.payPerUseAllowed} />,
  },
  {
    id: "brain",
    title: "How it thinks",
    lead: (ctx) =>
      ctx.mode === "edit"
        ? savedThinkingLead(ctx)
        : shownSource(ctx.draft.config, ctx.payPerUseAllowed) === "usdc"
          ? "Paying per run in USDC from the agent's own wallet. No key needed."
          : ctx.allErrors.llmKeyId
            ? ctx.payPerUseAllowed
              ? "The one thing we cannot decide for you. Add a key from any provider, or choose pay per use below."
              : "The one thing we cannot decide for you. Add a key from any provider, or press Next and come back to it later."
            : ctx.allErrors.llm
              ? "Check the model settings below."
              : `Using your ${providerLabelFor(ctx.draft.config.llm.provider)} key. Nothing to do here unless you want a different model.`,
    body: (ctx) => (
      <ThinkStep
        {...bodyProps(ctx)}
        llmKeys={ctx.keys}
        onKeyAdded={ctx.onKeyAdded}
        payPerUseAllowed={ctx.payPerUseAllowed}
      />
    ),
  },
];

/**
 * The seven config steps as panels, then the page's own last panel (`children`): the
 * review and Create for a draft, Manage for a saved agent. All eight are one list of
 * siblings, as they were when the builder wrote them out by hand.
 */
export function ConfigPanels({
  ctx,
  flow,
  children,
}: {
  ctx: StepContext;
  /** The step that is open and how the page got there (`useStepFlow`). */
  flow: { step: string; direction: 1 | -1; animate: boolean };
  /** The page's last panel. */
  children?: React.ReactNode;
}) {
  return (
    <>
      {[
        ...CONFIG_STEPS.map((entry) => (
          <StepPanel
            key={entry.id}
            id={entry.id}
            active={flow.step === entry.id}
            direction={flow.direction}
            animate={flow.animate}
            title={entry.title}
            lead={entry.lead(ctx)}
            now={entry.now?.(ctx)}
          >
            {entry.body(ctx)}
          </StepPanel>
        )),
        <Fragment key="last">{children}</Fragment>,
      ]}
    </>
  );
}
