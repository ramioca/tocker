"use client";

import { useEffect, useRef } from "react";
import { CHOICE_OFF, CHOICE_ON, EASE, FOCUS, FOCUS_OFFSET } from "@/components/agents/builder/look";
import { cn } from "@/lib/utils";
import type { AgentDetail, WalletBalance } from "@/server/types";
import { BudgetCard } from "./budget-card";
import { DangerZone } from "./danger-zone";
import { GoLiveCard } from "./go-live-card";
import { WalletsCard } from "./wallets-card";
import { WithdrawForm } from "./withdraw-form";

/** The sections of the Manage step, in the order their buttons are shown. */
export const MANAGE_SECTIONS = ["wallets", "withdraw", "live", "delete"] as const;
export type ManageSection = (typeof MANAGE_SECTIONS)[number];

/** The section the step opens on when nothing names another. */
export const DEFAULT_MANAGE_SECTION: ManageSection = "wallets";

const SECTION_LABEL: Record<ManageSection, string> = {
  wallets: "Wallets",
  withdraw: "Withdraw",
  live: "Live mode",
  delete: "Delete",
};

/** A section from the `sub` of a place on the page. Exact match only; anything else is null. */
export function parseManageSection(value: unknown): ManageSection | null {
  return typeof value === "string" && (MANAGE_SECTIONS as readonly string[]).includes(value)
    ? (value as ManageSection)
    : null;
}

/** The sentence under the step's title. */
export const MANAGE_LEAD = "Its wallets, its money, its mode, and deleting it. Nothing here waits for Save.";

/**
 * The last step of an agent's settings: everything that is not its config. Wallets, taking
 * money out, live mode with the wallet budget, and deleting it. Each applies when it is
 * done, so none of it is part of Save.
 *
 * One section shows at a time, chosen from the row of buttons at the top (a group of
 * pressed buttons, not a tablist, so Tab reaches each). Stacked, the five cards were the
 * long scroll this page used to be. Every section stays mounted, hidden and `inert` like
 * a step that is not showing, so a half-typed withdrawal survives a look at Wallets.
 *
 * Which section shows is the page's to say (`section`), so a link can open on one. Each
 * section's wrapper can take focus, and its id (`manage-wallets`, `manage-withdraw`,
 * `manage-live`, `manage-delete`) is where such a link lands.
 */
export function ManageStep({
  agent,
  balances,
  perTxUsd,
  isAdmin = false,
  section,
  onSection,
}: {
  agent: AgentDetail;
  /** The wallets as the server read them, the first paint of every card's balance. */
  balances: WalletBalance[];
  /** The wallet budget's cap on one USDC transfer, when one is set. */
  perTxUsd: number | null;
  /** Shows operator-only notes in the Fund sheet. */
  isAdmin?: boolean;
  section: ManageSection;
  onSection: (section: ManageSection) => void;
}) {
  const hasRealWallets = balances.some((wallet) => !wallet.walletId.startsWith("paper_"));

  // A section opened from inside another one. The control that was pressed is hidden by
  // the switch, so focus goes to the section it opened, once that section is showing.
  const focusOnShow = useRef<ManageSection | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnShow.current !== section) return;
    focusOnShow.current = null;
    document.getElementById(`manage-${section}`)?.focus({ preventScroll: true });
    // The section starts right under the row of buttons, so the row is what is brought
    // into view: nothing moves while it is on screen, and the top of the section is
    // never left under the page's top bar.
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [section]);

  return (
    <div>
      <div
        ref={rowRef}
        role="group"
        aria-label="Sections"
        className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2"
      >
        {MANAGE_SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={id === section}
            onClick={() => {
              // The pressed button stays on screen and keeps the focus. This also forgets
              // a move the page did not make, so it cannot take the focus later.
              focusOnShow.current = null;
              onSection(id);
            }}
            className={cn(
              // 44px where a finger presses: at a phone's width, where the four share one
              // row in equal cells, and on any touch screen.
              "inline-flex h-9 min-w-0 items-center justify-center rounded-lg border px-1.5 text-xs font-medium whitespace-nowrap",
              "max-sm:h-11 sm:px-3.5 sm:text-[13px] pointer-coarse:h-11",
              "transition-[border-color,background-color,color,scale] duration-150 active:scale-[0.97] motion-reduce:active:scale-100",
              EASE,
              FOCUS,
              FOCUS_OFFSET,
              id === section
                ? // The fill and the ring are colours, which forced colours would paint
                  // over, so the pressed button names a system colour there.
                  cn(CHOICE_ON, "text-foreground forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]")
                : cn(CHOICE_OFF, "text-muted-foreground hover:text-foreground"),
            )}
          >
            {SECTION_LABEL[id]}
          </button>
        ))}
      </div>

      <Section id="manage-wallets" label={SECTION_LABEL.wallets} active={section === "wallets"}>
        <WalletsCard agentId={agent.id} agentName={agent.name} initialBalances={balances} isAdmin={isAdmin} />
      </Section>

      <Section id="manage-withdraw" label={SECTION_LABEL.withdraw} active={section === "withdraw"}>
        <WithdrawForm agent={agent} balances={balances} perTxUsd={perTxUsd} />
      </Section>

      {/* Mode and the wallet budget share a section: both are about real money leaving a
          wallet, and both are short. */}
      <Section id="manage-live" label={SECTION_LABEL.live} active={section === "live"}>
        <GoLiveCard agent={agent} isAdmin={isAdmin} />
        <BudgetCard agentId={agent.id} initialPerTxUsd={perTxUsd} hasRealWallets={hasRealWallets} />
      </Section>

      <Section id="manage-delete" label={SECTION_LABEL.delete} active={section === "delete"}>
        <DangerZone
          agent={agent}
          balances={balances}
          onWithdraw={() => {
            focusOnShow.current = "withdraw";
            onSection("withdraw");
          }}
        />
      </Section>
    </div>
  );
}

/**
 * One section. It swaps with no motion at all: the sections are visited constantly while
 * moving money, and an entrance on each visit would only be in the way.
 */
function Section({
  id,
  label,
  active,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      // Focus lands here when a link opens the section. It is not a tab stop.
      tabIndex={-1}
      hidden={!active}
      inert={!active}
      className="mt-5 space-y-6 outline-none"
    >
      {children}
    </div>
  );
}
