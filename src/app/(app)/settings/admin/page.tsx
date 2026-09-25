import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { PlatformCard } from "@/components/settings/platform-card";
import { CreatePlatformWallets } from "@/components/settings/create-platform-wallets";
import { listPlatformWallets } from "@/lib/platform/wallets";
import { getMfaStatus } from "@/lib/security/mfa";
import { encryptionConfigured } from "@/lib/security/llm-keys";
import { isPrivyConfigured } from "@/lib/privy";
import { HeadlineTiles } from "@/components/admin/headline-tiles";
import { DailyBars } from "@/components/admin/daily-bars";
import { AdminUsersTable } from "@/components/admin/users-table";
import { AdminAgentsTable } from "@/components/admin/agents-table";
import { AdminTradesTable } from "@/components/admin/trades-table";
import { AdminAuditTable } from "@/components/admin/audit-table";
import { AdminBalancesTable } from "@/components/admin/balances-table";
import { fmtUsd } from "@/lib/money";
import { formatCount } from "@/components/common/format";
import {
  getAdminBalances,
  getAdminHeadline,
  getAdminSeries,
  listAdminAgents,
  listAdminAuditEvents,
  listAdminTrades,
  listAdminUsers,
  type AdminBalancesSnapshot,
} from "@/server/queries/admin";

export const metadata: Metadata = { title: "Admin" }; // the root layout appends " · Tocker"

/**
 * The admin dashboard: the whole platform in one page, for the people in `ADMIN_EMAILS`.
 *
 * `requireAdmin()` runs first and 404s anyone else — a 404 rather than a redirect, so a
 * non-admin cannot learn the route exists. Nothing below reads an identifier from the
 * request, so there is no id to tamper with even if they got here.
 *
 * **What this page will never show.** No strategy prompt, no universe rules, no
 * data-source list, no run transcript. Being an admin is not being the owner, and the
 * product's first rule is that the recipe belongs to the person who wrote it (SPEC rule
 * 1). Every agent link on this page goes to the agent's *public* page, which renders the
 * same thing for an admin as for a stranger. What is here instead is metadata and money:
 * names, counts, notionals, balances, timestamps.
 *
 * **Every number is a fact.** Counts and sums come from SQL, balances from Privy, and
 * there is no derived "growth" figure anywhere — see the note in the query module.
 */
export default async function AdminSettingsPage() {
  const session = await requireAdmin();

  // Balances are the only expensive read (two Privy calls per real wallet, cached for a
  // minute). A failure here must not take the page down: every SQL-backed number below is
  // still correct and still worth showing, so the tables that need a balance say "—".
  let balances: AdminBalancesSnapshot | null = null;
  let balanceError: string | null = null;
  try {
    balances = await getAdminBalances();
  } catch (err) {
    balanceError = err instanceof Error ? err.message : "Could not read the agent wallets.";
  }

  const [headline, series, userRows, agentRows, tradeRows, auditRows, platformHasWallets, mfa] = await Promise.all([
    getAdminHeadline(),
    getAdminSeries(),
    listAdminUsers(),
    listAdminAgents(balances),
    listAdminTrades(),
    listAdminAuditEvents(),
    listPlatformWallets()
      .then((rows) => rows.length > 0)
      .catch(() => false),
    getMfaStatus(session.userId),
  ]);
  const encryptionOk = encryptionConfigured();

  const sum = (points: Array<{ value: number }>) => points.reduce((a, p) => a + p.value, 0);

  return (
    // `min-w-0` on every level down to each table's scroll container: the page itself
    // must never scroll sideways, whatever a table's minimum width is.
    <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Everything on the platform, read-only. You are seeing this because{" "}
          <span className="font-mono text-foreground">{session.email}</span> is in{" "}
          <span className="font-mono text-foreground">ADMIN_EMAILS</span>. No strategy, universe rule or run transcript
          appears on this page — an admin is not an owner.
        </p>
      </header>

      <SettingsTabs isAdmin />

      <div className="mt-6 min-w-0 space-y-6">
        <SettingsSection
          id="headline"
          title="The platform right now"
          description="Counts and sums straight from the database, plus USDC read from Privy. Nothing here is derived or projected."
          className="p-0 sm:p-0 border-0 bg-transparent"
        >
          <HeadlineTiles headline={headline} balances={balances} />
        </SettingsSection>

        <SettingsSection
          id="trend"
          title="Last 30 days"
          description="One bar per UTC day. An empty day is an empty day, not a gap in a line."
        >
          <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <DailyBars
              label="Waitlist signups"
              points={series.signups}
              total={formatCount(sum(series.signups))}
              format={(v) => `${formatCount(v)} signup${v === 1 ? "" : "s"}`}
            />
            <DailyBars
              label="Trade volume"
              points={series.volumeUsd}
              total={fmtUsd(sum(series.volumeUsd), { compact: true })}
              format={(v) => fmtUsd(v, { compact: true })}
            />
            <DailyBars
              label="Fees charged · live"
              points={series.feesUsd}
              total={fmtUsd(sum(series.feesUsd))}
              format={(v) => fmtUsd(v)}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          id="wallets"
          title="Agent wallets"
          description="The only reading on this page that costs money: two Privy calls per real wallet, capped at the 200 most recently active, cached for a minute."
          className="min-w-0"
        >
          {balances === null ? (
            <p className="rounded-lg border border-destructive/25 bg-destructive/[0.06] px-3 py-4 text-sm text-muted-foreground">
              Could not read the agent wallets: {balanceError ?? "unknown error"}. Every other number on this page is
              from the database and is unaffected.
            </p>
          ) : (
            <AdminBalancesTable snapshot={balances} />
          )}
        </SettingsSection>

        <SettingsSection
          id="tables"
          title="Users and agents"
          description="Newest first, capped at 100 rows each. Names, counts, money and timestamps — the agent links go to the public page."
          className="min-w-0"
        >
          <div className="min-w-0 space-y-4">
            <AdminUsersTable rows={userRows} />
            {/* Without Privy every balance is a placeholder zero, not a reading. */}
            <AdminAgentsTable rows={agentRows} balancesRead={balances !== null && balances.privyConfigured} />
          </div>
        </SettingsSection>

        <SettingsSection
          id="activity"
          title="Activity"
          description="The last 50 fills and the last 50 audit events, across every user. A fill links to its receipt on the token page."
          className="min-w-0"
        >
          <div className="min-w-0 space-y-4">
            <AdminTradesTable rows={tradeRows} />
            <AdminAuditTable rows={auditRows} />
          </div>
        </SettingsSection>

        {/*
          The Platform card lived under general Settings and was visible to any signed-in
          user "until there is a role check". This is that role check — it is the
          platform's own ledger, so it belongs behind the same gate as everything else
          here.
        */}
        <SettingsSection
          id="platform"
          title="Platform wallets"
          description="The app's own wallets: what pays for every agent's data, and where the per-fill fee lands."
        >
          <PlatformCard />
          {/* The same answer the balances notice gives, so the button cannot offer what
              the page already says is impossible. */}
          <CreatePlatformWallets
            hasWallets={platformHasWallets}
            privyConfigured={balances?.privyConfigured ?? isPrivyConfigured()}
          />
        </SettingsSection>

        {/*
          Deployment detail that only an operator can act on. Tenants see a one-line
          version of each on their own Security tab.
        */}
        <SettingsSection
          id="operator"
          title="Deployment"
          description="How this deployment stores secrets and what it offers for sign-in. Users see a plain one-line version of each."
        >
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-medium">LLM key storage</dt>
              <dd className="mt-1 leading-6 text-muted-foreground">
                AES-256-GCM at rest, as <code className="font-mono text-foreground">base64(iv|tag|ciphertext)</code>,
                keyed by <code className="font-mono text-foreground">ENCRYPTION_KEY</code>
                {encryptionOk ? (
                  " (configured)"
                ) : (
                  <span className="text-destructive"> — which is NOT configured on this deployment</span>
                )}
                . The plaintext is decrypted in exactly one place, inside the agent run loop, and never reaches a
                server component, an action result, a run transcript or a browser.
              </dd>
            </div>
            {mfa.operatorNote ? (
              <div>
                <dt className="font-medium">Second factor</dt>
                <dd className="mt-1 leading-6 text-muted-foreground">{mfa.operatorNote}</dd>
              </div>
            ) : null}
          </dl>
        </SettingsSection>
      </div>
    </div>
  );
}
