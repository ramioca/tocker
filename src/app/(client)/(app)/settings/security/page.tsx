import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { listAuditEvents } from "@/lib/security/audit";
import { getKillSwitch } from "@/lib/security/kill-switch";
import { getMfaStatus } from "@/lib/security/mfa";
import { getLlmKeyDetails } from "@/lib/security/llm-keys";
import { countAgentsKeyFits, countKeylessAgents } from "@/server/queries/users";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SignedOut } from "@/components/settings/signed-out";
import { MfaCard } from "@/components/settings/security/mfa-card";
import { KillSwitchCard } from "@/components/settings/security/kill-switch-card";
import { LlmKeyInventory } from "@/components/settings/security/llm-key-inventory";
import { AuditLog } from "@/components/settings/security/audit-log";

export const metadata: Metadata = { title: "Security" }; // the root layout appends " · Tocker"

/** How many audit rows the page lists. */
const AUDIT_CAP = 60;

/**
 * Everything that decides whether money can move, on one page, in the order
 * someone would reach for it in an emergency: stop it, prove it is you, see the
 * keys, read what happened.
 *
 * Every read here is scoped by the session's own user id. Nothing on this page
 * takes an identifier from the request.
 */
export default async function SecuritySettingsPage() {
  const session = await getSession();
  if (!session) {
    return (
      <SignedOut
        title="Sign in to see your security settings"
        body="The kill switch, your second factor and your audit trail are yours alone."
      />
    );
  }

  const [killSwitch, mfa, keys, fetched, keylessAgents] = await Promise.all([
    getKillSwitch(session.userId),
    getMfaStatus(session.userId),
    getLlmKeyDetails(session.userId),
    // One past the cap, only to learn whether there is anything the list leaves out.
    listAuditEvents(session.userId, AUDIT_CAP + 1),
    // A count, not a reason to fail the page.
    countKeylessAgents(session.userId).catch(() => 0),
  ]);
  // One key: attaching it is offered, for the agents set to its provider. Several: each
  // agent picks its own, so there is nothing to count. A failed count offers nothing.
  const onlyKey = keys.length === 1 ? keys[0] : null;
  const attachableAgents =
    onlyKey && keylessAgents > 0 ? await countAgentsKeyFits(session.userId, onlyKey.provider).catch(() => 0) : 0;
  const events = fetched.slice(0, AUDIT_CAP);
  const hasMore = fetched.length > AUDIT_CAP;

  return (
    // The same container as the Admin tab, so the header and tabs do not jump sideways
    // when switching tabs; only the body below them is held to a reading width.
    <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          The controls that decide whether your agents can move real money, and the record of every time that
          changed.
        </p>
      </header>

      <SettingsTabs isAdmin={isAdminEmail(session.email)} />

      <div className="mt-6 max-w-3xl space-y-6">
        <SettingsSection
          id="kill-switch"
          title="Pause all trading"
          description="One switch that pauses trading on every agent you own, for the moment when you want the trading to stop and the reasoning to happen afterwards."
        >
          <KillSwitchCard paused={killSwitch.paused} pausedAt={killSwitch.pausedAt} />
        </SettingsSection>

        <SettingsSection
          id="mfa"
          title="Second factor"
          description="Optional. Tocker does not require one to go live or to withdraw — it protects the account those wallets live under."
        >
          <MfaCard initial={mfa} />
        </SettingsSection>

        <SettingsSection
          id="keys"
          title="LLM keys"
          description="Your agents reason on your provider account. A key here can spend money on your bill, so it gets the same treatment as a wallet."
        >
          <LlmKeyInventory
            keys={keys}
            isAdmin={isAdminEmail(session.email)}
            keylessAgents={keylessAgents}
            attachableAgents={attachableAgents}
          />
        </SettingsSection>

        {/*
          The description names what the log covers, not "every withdrawal": a cash
          withdrawal on Base is signed and broadcast in the browser with no server call,
          so there is no row for it. Someone checking whether their account was used has
          to be told where that one shows up instead.
        */}
        <SettingsSection
          id="audit"
          title="Audit log"
          description="Append-only. Every withdrawal Tocker signs or co-signs (from an agent, or from your cash on Solana), budget change, mode switch, key change and kill-switch flip, with the IP address it came from. Cash withdrawals on Base are signed in your browser, so they show on BaseScan, not here."
        >
          <AuditLog events={events} hasMore={hasMore} cap={AUDIT_CAP} />
        </SettingsSection>

        <p className="px-1 text-xs leading-6 text-muted-foreground">
          Going live with an agent for the first time has its own checklist —{" "}
          <Link href="/agents" className="text-foreground underline underline-offset-2">
            open an agent
          </Link>{" "}
          and follow &ldquo;First live trade&rdquo; from its settings.
        </p>
      </div>
    </div>
  );
}
