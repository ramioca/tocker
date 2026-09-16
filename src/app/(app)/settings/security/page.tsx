import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { listAuditEvents } from "@/lib/security/audit";
import { getKillSwitch } from "@/lib/security/kill-switch";
import { getMfaStatus } from "@/lib/security/mfa";
import { encryptionConfigured, getLlmKeyDetails } from "@/lib/security/llm-keys";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SignedOut } from "@/components/settings/signed-out";
import { MfaCard } from "@/components/settings/security/mfa-card";
import { KillSwitchCard } from "@/components/settings/security/kill-switch-card";
import { LlmKeyInventory } from "@/components/settings/security/llm-key-inventory";
import { AuditLog } from "@/components/settings/security/audit-log";

export const metadata: Metadata = { title: "Security · Tocker" };

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

  const [killSwitch, mfa, keys, events] = await Promise.all([
    getKillSwitch(session.userId),
    getMfaStatus(session.userId),
    getLlmKeyDetails(session.userId),
    listAuditEvents(session.userId, 60),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The controls that decide whether your agents can move real money, and the record of every time that
          changed.
        </p>
      </header>

      <SettingsTabs isAdmin={isAdminEmail(session.email)} />

      <div className="mt-6 space-y-6">
        <SettingsSection
          id="kill-switch"
          title="Stop everything"
          description="One switch for the whole account, for the moment when you want the trading to stop and the reasoning to happen afterwards."
        >
          <KillSwitchCard paused={killSwitch.paused} pausedAt={killSwitch.pausedAt} />
        </SettingsSection>

        <SettingsSection
          id="mfa"
          title="Second factor"
          description="Required before an agent can be switched to live mode, and before anything can be withdrawn from an agent wallet."
        >
          <MfaCard initial={mfa} />
        </SettingsSection>

        <SettingsSection
          id="keys"
          title="LLM keys"
          description="Your agents reason on your provider account. A key here can spend money on your bill, so it gets the same treatment as a wallet."
        >
          <LlmKeyInventory keys={keys} encryptionOk={encryptionConfigured()} />
        </SettingsSection>

        <SettingsSection
          id="audit"
          title="Audit log"
          description="Append-only. Every withdrawal, budget change, mode switch, key change and kill-switch flip, with the address it came from."
        >
          <AuditLog events={events} />
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
