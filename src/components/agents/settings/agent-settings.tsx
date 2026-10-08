"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { setAgentStatusAction, updateAgentAction } from "@/components/agents/agent-actions";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import type { StepView } from "@/components/agents/builder/builder-stepper";
import {
  SETTINGS_STEPS,
  type EditContext,
  type SettingsStepId,
  type SharedStepId,
  type SummaryEdit,
  type Via,
} from "@/components/agents/builder/contract";
import { firstErrorKey, firstErrorPlace } from "@/components/agents/builder/flow";
import { FOCUS } from "@/components/agents/builder/look";
import { AgentPreview } from "@/components/agents/builder/preview/agent-preview";
import { PreviewPeek } from "@/components/agents/builder/preview/preview-peek";
import { PRESS, SENTENCE, StepBar } from "@/components/agents/builder/step-bar";
import { StepPanel } from "@/components/agents/builder/step-panel";
import {
  ConfigPanels,
  STATUS_WORDS,
  STEP_LABELS,
  STEP_NAMES,
  type StepContext,
} from "@/components/agents/builder/step-registry";
import { StepShell } from "@/components/agents/builder/step-shell";
import { costFacts } from "@/components/agents/builder/summaries";
import type { BuilderDraft } from "@/components/agents/builder/types";
import { useAgentCard } from "@/components/agents/builder/use-agent-card";
import { useStepFlow } from "@/components/agents/builder/use-step-flow";
import { EmptyState } from "@/components/common/empty-state";
import { thinkSource } from "@/lib/agent/inference";
import { SESSION_QUERY_KEY } from "@/hooks/use-session";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import { noteBudgetChangeAction } from "@/server/actions/security";
import type { AgentConfig, WalletBudget } from "@/db/schema";
import type { AgentDetail, DataSourceInfo, LlmKeyRow, WalletBalance } from "@/server/types";
import { AgentBar, cashInWalletsText, useAgentCash } from "./agent-bar";
import {
  CONFIRM_LIVE_SAVES,
  changedSteps,
  configToSave,
  editStatus,
  liveSaveWarnings,
  savePayload,
  saveStateShort,
  saveStateText,
  savedFrom,
  shownErrors,
  validateEdit,
} from "./edit-model";
import { LiveSaveDialog } from "./live-save-dialog";
import {
  DEFAULT_MANAGE_SECTION,
  MANAGE_LEAD,
  MANAGE_SECTIONS,
  ManageStep,
  parseManageSection,
  type ManageSection,
} from "./manage-step";
import { SaveButton, useSaveState } from "./save-button";
import { ANCHOR_PLACE, agentSettingsHref, parseAnchor, placeOfAnchor, type SettingsPlace } from "./settings-href";
import { signedInNow } from "./signed-in-now";
import { useAgentEdit } from "./use-agent-edit";
import { useEditStash } from "./use-edit-stash";
import { useUnsavedGuard } from "./use-unsaved-guard";

/**
 * An agent's settings: the page of steps the builder is, over a saved agent.
 *
 * The rail, the seven config steps, the agent card and the bar underneath are the
 * builder's own (`builder/step-shell`, `builder/step-registry`), so a control reads the
 * same whether the agent is being made or changed. This file draws no control. What it
 * adds is what editing has that creating does not: the working copy (`./use-agent-edit`),
 * Save and what refuses it, the bar of money and status above the steps (`./agent-bar`),
 * the last step (`./manage-step`), and where a link into the page lands
 * (`./settings-href`).
 *
 * Moving between steps never asks to save. Edits live in one working copy that every step
 * shares and every step stays mounted, so nothing is lost on the way, and Save works from
 * any step.
 */

/** The four numbers that decide how much money can move: what the audit note records. */
function capsOf(config: AgentConfig) {
  return {
    maxTradeUsd: config.risk.maxTradeUsd,
    maxDailyTrades: config.risk.maxDailyTrades,
    maxPositionPct: config.risk.maxPositionPct,
    maxDataSpendUsdPerRun: config.risk.maxDataSpendUsdPerRun,
  };
}

/** The step an address names: one of this page's eight, and anything else is none. */
function readStep(params: Pick<URLSearchParams, "get">): SettingsStepId | null {
  const named = params.get("step");
  return SETTINGS_STEPS.find((id) => id === named) ?? null;
}

/** Whether two working copies would save the same thing: neither has a change the other lacks. */
function sameSave(a: BuilderDraft, b: BuilderDraft): boolean {
  return changedSteps(a, savedFrom(b)).size === 0;
}

/**
 * Where the `#anchor` of an address lands, or null when it names nothing here. `named` is
 * the step the same address asks for in `?step=`.
 */
function placeOfHash(hash: string, named: SettingsStepId | null): SettingsPlace | null {
  const anchor = parseAnchor(hash);
  const place = anchor === null ? null : placeOfAnchor(anchor);
  if (anchor === null || place === null) return null;
  // The status button sits above the steps, on every one of them, so a link to it leaves
  // the step the address asked for.
  if (anchor === "status") return named ? { ...place, step: named } : place;
  // A control on Manage that is not on the page (the wallet budget's box, before the agent
  // has a real wallet) lands on its section, not back at the step's title.
  const section = parseManageSection(place.sub);
  const wrapper = section ? `manage-${section}` : null;
  if (wrapper === null || !place.focusIds || place.focusIds.includes(wrapper)) return place;
  return { ...place, focusIds: [...place.focusIds, wrapper] };
}

interface AgentSettingsProps {
  agent: AgentDetail;
  /** The x402 catalogue, for the Data step. */
  sources: DataSourceInfo[];
  /** The owner's API keys, for the Brain step. */
  llmKeys: LlmKeyRow[];
  /** The agent's wallets as the server read them: the first paint of every balance on the page. */
  balances: WalletBalance[];
  /** The cap the wallet itself enforces on one transfer, when one is set. */
  walletBudget: WalletBudget | null;
  /** Trading is paused account-wide (Security → Pause all trading). */
  accountPaused: boolean;
  /** Shows operator-only notes, such as which platform wallet pays for a source. */
  isAdmin: boolean;
  /**
   * Whether this viewer may put an agent on pay-per-use thinking, decided on the server
   * (`payPerUseAllowedFor`). An agent already saved on it is offered the choice either
   * way, so it can always be moved to its owner's key.
   */
  payPerUseAllowed: boolean;
  /** Tocker's fee in basis points of each fill, from the server; 0 when it is off. */
  feeBps: number;
}

/**
 * `AgentDetail.config` is null for anyone who is not the owner, so the page cannot be
 * built at all without one. The settings route is owner-gated, but the type is the real
 * contract: refuse, and never make a config up.
 */
export function AgentSettings({ config, ...props }: AgentSettingsProps & { config: AgentConfig | null }) {
  const resolved = config ?? props.agent.config;
  if (!resolved) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        {/* EmptyState's title is a <p>; the page still needs a heading to navigate by. */}
        <h1 className="sr-only">{props.agent.name} settings</h1>
        <EmptyState
          title="This agent's settings are not yours to see"
          description="A strategy belongs to whoever wrote it. Its record is public; its recipe is not."
        />
      </div>
    );
  }
  return <Settings {...props} config={resolved} />;
}

function Settings({
  agent,
  config,
  sources,
  llmKeys,
  balances,
  walletBudget,
  accountPaused,
  isAdmin,
  payPerUseAllowed,
  feeBps,
}: AgentSettingsProps & { config: AgentConfig }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    working,
    saved,
    savedDraft,
    refused,
    quietKey,
    edits,
    keys,
    update,
    updateConfig,
    addKey,
    refuse,
    markSaved,
    discard,
    restore,
  } = useAgentEdit(agent, config, llmKeys);
  const live = agent.mode === "live";
  // One answer for everything that asks whether pay per use is on offer: the choice on the
  // Brain step, the checks on the working copy and the costs on the card.
  const offered = payPerUseAllowed || thinkSource(saved.config) === "usdc";

  // What the page shows as wrong, which is more than what refuses a save: an agent with no
  // key is told so here and on the card, and can still save anything else.
  const errors = useMemo(
    () => shownErrors(working, keys, { payPerUseOffered: offered }, refused),
    [working, keys, offered, refused],
  );
  const changed = useMemo(() => changedSteps(working, saved), [working, saved]);
  const dirty = changed.size > 0;

  // A save in flight. The ref is what refuses a second one, the state is what the page
  // shows while the first one runs.
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useSaveState();
  /** A live agent's save that is waiting for its answer in the dialog, and the copy it would send. */
  const [asking, setAsking] = useState<{ lines: string[]; sent: BuilderDraft } | null>(null);

  const [section, setSection] = useState<ManageSection>(DEFAULT_MANAGE_SECTION);
  /** Counts the moves to a section of Manage, so each one can be looked at once it is on screen. */
  const [sectionMoves, setSectionMoves] = useState(0);
  /** The spot the address asked for on arrival. */
  const arrival = useRef<SettingsPlace | null>(null);

  const flow = useStepFlow<SettingsStepId>({
    steps: SETTINGS_STEPS,
    read: readStep,
    // Only the step: once the owner moves on, the spot a link arrived at is behind them.
    hrefOf: (id) => `${agentSettingsHref(agent.slug)}?${new URLSearchParams({ step: id }).toString()}`,
    // Nobody leaves the step while its changes are being saved.
    locked: () => savingRef.current,
    // The `#anchor` of a link, which the server never sees. A link from before the page had
    // steps has no `?step=` at all, and still lands.
    initialPlace: () => {
      const place = placeOfHash(window.location.hash, readStep(new URLSearchParams(window.location.search)));
      if (place) arrival.current = place;
      return place;
    },
    onMove: (place) => {
      const named = parseManageSection(place.sub);
      if (!named) return;
      setSection(named);
      setSectionMoves((count) => count + 1);
    },
  });
  const { step, goTo, goFromCard, back, next, columnRef } = flow;

  // A whole section of Manage is shown from the top of the step, like any step: its row of
  // section buttons says which one is open, and a tall one (the Withdraw form) brought to
  // the middle of the screen has its first lines under the top bar. This runs after the
  // flow has put the focus on the section.
  useEffect(() => {
    if (sectionMoves === 0) return;
    const focused = document.activeElement;
    if (focused === null || !MANAGE_SECTIONS.some((id) => focused.id === `manage-${id}`)) return;
    columnRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [sectionMoves, columnRef]);

  // The cards on Manage grow when their balances arrive, which moves a control a link
  // landed on. So it is brought back into view once, a beat later, unless the owner has
  // already put the focus somewhere else.
  useEffect(() => {
    const place = arrival.current;
    if (place?.step !== "manage") return;
    const timer = window.setTimeout(() => {
      const target = place.focusIds?.map((id) => document.getElementById(id)).find((el) => el !== null);
      if (!target || document.activeElement !== target) return;
      // A section is already shown from the top of the step, which does not move.
      if (MANAGE_SECTIONS.some((id) => target.id === `manage-${id}`)) return;
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    }, 400);
    return () => window.clearTimeout(timer);
  }, []);

  // A link to this very page that names a spot on it: the top bar's wallet menu has one, to
  // Withdraw. Followed as a link it would change the step and nothing else, and do nothing
  // at all when the address is already that one. So it is taken as a move of this page's
  // own. A hash typed into the address bar is taken the same way.
  const goToLatest = useRef(goTo);
  useEffect(() => {
    goToLatest.current = goTo;
  }, [goTo]);
  useEffect(() => {
    const land = (hash: string, search: URLSearchParams, via: Via): boolean => {
      const place = placeOfHash(hash, readStep(search));
      if (place) goToLatest.current(place, via);
      return place !== null;
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      // A modified click opens another tab, which lands by itself.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      // Prevented and not stopped: the link's own handler still runs (it closes the menu
      // it is in), and Next's <Link> skips a prevented click.
      if (land(url.hash, url.searchParams, event.detail === 0 ? "keyboard" : "pointer")) event.preventDefault();
    };
    const onHashChange = () => {
      land(window.location.hash, new URLSearchParams(window.location.search), "auto");
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  // The page can sit open while its agent changes somewhere else: another tab takes it
  // live, and the go-live checklist rewrites its caps. Coming back to the tab asks the
  // server for the agent again, so whether a save asks first, the status, and the saved
  // copy the edits are compared with are the ones that hold now. Unsaved edits stay: being
  // handed the agent again never touches the working copy. Only when the tab is shown
  // again, never on window focus: a wallet's popup takes the focus and hands it back with
  // nothing changed. Not while a save is on its way, which refreshes the page itself once
  // it has its answer.
  //
  // The server is asked who is signed in first, and the page is refreshed only when it
  // answers with somebody. A tab is shown again before the network is back (a laptop
  // lid, a phone out of a tunnel) and after its cookie has run out (an hour in the
  // background), and a refresh sent then does not fail quietly: the router loads the
  // whole page again, or lands on the sign-in page, and the edits go with it. That read
  // also renews the cookie, so the refresh that follows is recognised.
  useEffect(() => {
    let gone = false;
    const onVisibility = async () => {
      if (document.visibilityState !== "visible" || savingRef.current) return;
      if (!(await signedInNow(queryClient, SESSION_QUERY_KEY))) return;
      // The answer took a moment: a save may have started, or the tab or the page gone.
      if (gone || savingRef.current || document.visibilityState !== "visible") return;
      router.refresh();
    };
    const onChange = () => void onVisibility();
    document.addEventListener("visibilitychange", onChange);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [router, queryClient]);

  useUnsavedGuard(dirty);
  // Edits left behind by a way out that could not be asked about, offered back on return.
  // They are held in memory, for this owner and this agent, and nowhere in the browser's
  // storage: a reload ends them, and so does signing out.
  useEditStash({
    ownerId: agent.owner.id,
    agentId: agent.id,
    agentName: agent.name,
    working,
    base: savedDraft,
    same: sameSave,
    edits,
    onRestore: restore,
  });

  // The Undo of a Discard, while its toast is up. Undo puts the whole discarded copy back,
  // so once the owner edits something else it would take that edit away: the first edit
  // takes the toast down instead, as it does the offer of edits left behind.
  const undoOffer = useRef<{ id: string | number; since: number } | null>(null);
  useEffect(() => {
    const offer = undoOffer.current;
    if (offer === null || offer.since === edits) return;
    undoOffer.current = null;
    toast.dismiss(offer.id);
  }, [edits]);
  // It goes with the page too. The toaster is above every page, so the toast would still
  // be up on the next one, and its Undo would put the copy back into nothing.
  useEffect(
    () => () => {
      if (undoOffer.current) toast.dismiss(undoOffer.current.id);
    },
    [],
  );

  const cash = useAgentCash(agent, balances);
  // What the card and the Schedule step are told about the agent as it stands, where a
  // draft has only plans.
  const summary: SummaryEdit = { mode: agent.mode, status: agent.status, balanceText: cashInWalletsText(cash) };
  const edit: EditContext = {
    agentId: agent.id,
    mode: agent.mode,
    equityUsd: agent.equityUsd,
    isAdmin,
    savedConfig: saved.config,
    payPerUseStillAllowed: payPerUseAllowed,
  };
  // The agent card, from the working copy. A copy swapped whole (a save come back, a
  // discard, its undo) changes its rows without their tint.
  const { previewProps, readyCount, cardDraft } = useAgentCard({
    draft: working,
    keys,
    sources,
    payPerUseAllowed: offered,
    feeBps,
    quietKey,
    currentStep: step,
    onGo: goFromCard,
    disabled: saving,
    edit: summary,
  });

  /** Send a copy that has passed its checks. One save at a time. */
  const commit = async (sent: BuilderDraft) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveState("loading");
    try {
      const result = await safeAction(() => updateAgentAction(agent.id, savePayload(sent, saved)));
      if (!result.ok) {
        toast.error("Not saved", { description: result.error });
        setSaveState("error");
        return;
      }
      // The working copy takes the server's word for everything that was sent once the
      // page has been handed the agent again; until then it is compared with what was sent.
      markSaved(sent);
      // A change to the caps is a change to how much money can move, so it goes on the
      // audit record. Not awaited: the save already succeeded, and a failed audit write
      // must not turn a saved change into an error the owner retries.
      void safeAction(() =>
        noteBudgetChangeAction({
          agentId: agent.id,
          before: capsOf(saved.config),
          after: capsOf(configToSave(sent)),
        }),
      );
      toast.success("Saved");
      setSaveState("success");
      router.refresh();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /**
   * Save, from whichever step is showing. A copy that would be refused is not sent: the
   * owner is taken to the first step with something wrong, with the focus on the control.
   * On an agent that trades real money, a save that loosens a limit asks first.
   */
  const save = () => {
    if (savingRef.current) return;
    const sent = working;
    const refusal = validateEdit(sent, saved);
    const key = firstErrorKey(refusal);
    if (key !== null) {
      refuse(refusal);
      setSaveState("error");
      const place = firstErrorPlace(refusal, null);
      // The focused control carries its own message. Where there is none to focus, a
      // toast says it.
      if (place) goTo(place, "auto", () => toast.error("Not saved", { description: refusal[key] }));
      return;
    }
    // After the checks, so nobody is asked to confirm a save that would be refused. The
    // button stays at rest while the question is open: "Keep editing" is not a failure.
    const lines = live && CONFIRM_LIVE_SAVES ? liveSaveWarnings(saved.config, configToSave(sent)) : [];
    if (lines.length > 0) {
      setAsking({ lines, sent });
      return;
    }
    void commit(sent);
  };

  // Pause, Resume or Activate: at once, and no part of Save. The page is refreshed for
  // the new status, which leaves the working copy as it is.
  const togglingRef = useRef(false);
  const [statusPending, setStatusPending] = useState(false);
  const toggleStatus = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    setStatusPending(true);
    try {
      const nextStatus = agent.status === "active" ? "paused" : "active";
      const result = await safeAction(() => setAgentStatusAction(agent.id, nextStatus));
      if (!result.ok) {
        toast.error("Status not changed", { description: result.error });
        return;
      }
      // A draft has never run, so it is not resumed.
      const started = agent.status === "draft" ? "Activated" : "Resumed";
      toast.success(nextStatus === "active" ? started : "Paused", {
        description:
          nextStatus === "active"
            ? `It will tick ${intervalLabel(config.schedule.intervalMinutes).toLowerCase()}.`
            : "It will not run again until you resume it.",
      });
      router.refresh();
    } finally {
      togglingRef.current = false;
      setStatusPending(false);
    }
  };

  const discardChanges = () => {
    const discarded = discard();
    // One Undo at a time: an earlier one would put back a copy from before this discard.
    if (undoOffer.current) toast.dismiss(undoOffer.current.id);
    const id = toast.success("Changes discarded", {
      action: { label: "Undo", onClick: () => restore(discarded, edits) },
    });
    undoOffer.current = { id, since: edits };
    // The button goes with the changes, so focus goes to the step's heading rather than
    // falling back to the page.
    goTo({ step }, "auto");
  };

  const steps: StepView<SettingsStepId>[] = SETTINGS_STEPS.map((id) => {
    const status = editStatus(id, changed, errors);
    return {
      id,
      label: STEP_LABELS[id],
      name: STEP_NAMES[id],
      status,
      statusLabel: STATUS_WORDS.edit[status],
      tone: status === "fix" ? "error" : "neutral",
    };
  });

  // What the seven config steps are drawn from. The errors on show are the same ones the
  // sentences under the titles read.
  const ctx: StepContext = {
    mode: "edit",
    draft: working,
    update,
    updateConfig,
    errors,
    allErrors: errors,
    facts: costFacts(working, sources, { payPerUseAllowed: offered, feeBps }),
    sources,
    feeBps,
    keys,
    onKeyAdded: addKey,
    payPerUseAllowed: offered,
    fix: (id: SharedStepId) => editStatus(id, changed, errors) === "fix",
    edit,
    summary,
  };

  const saveStateLine = saveStateText(changed, live);

  return (
    <>
      <LiveSaveDialog
        agentName={agent.name}
        lines={asking?.lines ?? null}
        onKeep={() => setAsking(null)}
        onSave={() => {
          const ask = asking;
          setAsking(null);
          if (ask) void commit(ask.sent);
        }}
      />
      <StepShell
        flow={flow}
        steps={steps}
        // The one line that speaks the save state, at every width: the sentence in the bar
        // is not on a phone.
        announcement={saveStateLine}
        disabled={saving}
        topSpan="full"
        // The builder's own figure from lg, where the bar above is as tall as the builder's
        // title and sentence. Below that the bar is taller (two rows, four on a phone), and
        // the step gives that much back, so the page is no longer than the builder's and
        // the bar underneath sits in the same place on every step.
        panelMinHeight="min-h-[calc(100dvh-24.5rem)] sm:min-h-[calc(100dvh-20rem)] lg:min-h-[calc(100dvh-17rem)]"
        top={
          <AgentBar
            agent={agent}
            config={config}
            initialBalances={balances}
            accountPaused={accountPaused}
            isAdmin={isAdmin}
            statusPending={statusPending}
            onToggleStatus={() => void toggleStatus()}
            onWithdraw={() => goFromCard(ANCHOR_PLACE.withdraw)}
            onChooseKey={() => goFromCard(ANCHOR_PLACE.brain)}
          />
        }
        panels={
          <ConfigPanels ctx={ctx} flow={flow}>
            <StepPanel
              id="manage"
              active={step === "manage"}
              direction={flow.direction}
              animate={flow.animate}
              title={STEP_NAMES.manage}
              lead={MANAGE_LEAD}
            >
              <ManageStep
                agent={agent}
                balances={balances}
                perTxUsd={walletBudget?.perTxUsd ?? null}
                isAdmin={isAdmin}
                section={section}
                onSection={setSection}
              />
            </StepPanel>
          </ConfigPanels>
        }
        card={
          // The bar above ends in a rule, and the card would sit against it: this is the
          // gap the rail has, so the two start level.
          <div className="pt-6">
            <AgentPreview {...previewProps} reveal />
          </div>
        }
        bar={
          <StepBar
            peek={
              <PreviewPeek
                draft={cardDraft}
                readyCount={readyCount}
                readyLabel={saveStateShort(changed)}
                // Under the name on a phone, where the bar has no room for the sentence.
                shortLine={saveStateShort(changed)}
                compact={false}
                disabled={saving}
                footer={
                  dirty ? (
                    <button
                      type="button"
                      // Closes the sheet and leaves the focus alone: it goes to the step's heading.
                      data-go
                      onClick={discardChanges}
                      className={cn(
                        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium",
                        "transition-[background-color,transform] hover:bg-muted",
                        PRESS,
                        FOCUS,
                      )}
                    >
                      <Undo2 aria-hidden className="size-4" />
                      Discard changes
                    </button>
                  ) : null
                }
              >
                <AgentPreview {...previewProps} />
              </PreviewPeek>
            }
            message={
              <div className={cn(SENTENCE, "items-center gap-x-3 sm:flex")}>
                {/* In full where the bar is the page's width; beside the agent strip there is
                    room for the count alone. */}
                <p className="min-w-0">
                  <span className="lg:hidden">{saveStateShort(changed)}</span>
                  <span className="max-lg:hidden">{saveStateLine}</span>
                </p>
                {dirty ? (
                  <button
                    type="button"
                    // While a save is on its way there is nothing settled to go back to.
                    disabled={saving}
                    onClick={discardChanges}
                    // Below md the bar has no room for it: the agent strip's sheet has one.
                    className={cn(
                      "hidden h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-foreground md:inline-flex pointer-coarse:h-11",
                      "transition-[background-color,transform] hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
                      PRESS,
                      FOCUS,
                    )}
                  >
                    <Undo2 aria-hidden className="size-3.5" />
                    Discard
                  </button>
                ) : null}
              </div>
            }
            onBack={back ? (via) => goTo({ step: back }, via) : null}
            // Next never asks to save and never refuses: the bar says what is unsaved on
            // every step, and Save is beside it on every one.
            next={next ? { label: STEP_NAMES[next], onGo: (via) => goTo({ step: next }, via), tone: "outline" } : null}
            primary={<SaveButton state={saveState} dirty={dirty} onSave={save} />}
            disabled={saving}
          />
        }
      />
    </>
  );
}
