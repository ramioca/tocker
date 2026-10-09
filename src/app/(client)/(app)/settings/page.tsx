import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getMyLlmKeys, getNotificationPrefs, getUserProfile } from "@/server/queries/users";
import { withMock } from "@/lib/data";
import { mockLlmKeys, mockSession, mockUserProfile } from "@/mocks/social";
import { SettingsSection } from "@/components/settings/settings-section";
import { ProfileForm } from "@/components/settings/profile-form";
import { LlmKeysSection } from "@/components/settings/llm-keys-section";
import { NotificationPrefs } from "@/components/settings/notification-prefs";
import { SignOutSection } from "@/components/settings/sign-out-section";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { isAdminEmail } from "@/lib/admin";
import { avatarTiles } from "@/lib/avatar";
import { seedCount } from "@/components/profile/avatar-picker-model";

export const metadata: Metadata = { title: "Settings" }; // the root layout appends " · Tocker"

export default async function SettingsPage() {
  const session = await withMock(getSession, mockSession);
  if (!session) redirect(`/login?next=${encodeURIComponent("/settings")}`);

  const [keys, profile, notificationPrefs] = await Promise.all([
    withMock(
      () => getMyLlmKeys(session.userId),
      () => mockLlmKeys(),
    ),
    withMock(
      () => getUserProfile(session.handle, session.userId),
      () => mockUserProfile(session.handle),
    ),
    withMock(
      () => getNotificationPrefs(session.userId),
      () => ({}),
    ),
  ]);

  return (
    // The same container as the Admin tab, so the header and tabs do not jump sideways
    // when switching tabs; only the body below them is held to a reading width.
    <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Your profile, the keys your agents think with, and what reaches your notifications.
        </p>
      </header>

      <SettingsTabs isAdmin={isAdminEmail(session.email)} />

      <div className="mt-6 max-w-3xl space-y-6">
        <SettingsSection
          id="profile"
          title="Profile"
          description="How you appear on the feed, the leaderboard and every agent you publish."
        >
          {/* The picker's generated avatars are made here, once per request: the form is
              rendered on the server too, and random ones made in it would differ between
              the two renders. As many as the row can hold; it uses fewer beside a photo. */}
          <ProfileForm
            session={session}
            bio={profile?.bio ?? ""}
            avatarSeeds={avatarTiles(null, seedCount(false))}
          />
        </SettingsSection>

        <SettingsSection
          id="keys"
          title="LLM API keys"
          description="Your agents reason on your provider account, at your rates. One key can back many agents."
        >
          <LlmKeysSection initialKeys={keys} />
        </SettingsSection>

        <SettingsSection
          id="notifications"
          title="Notifications"
          description="What reaches the bell and your notifications list. Turning one off hides it there; nothing is deleted."
        >
          <NotificationPrefs initial={notificationPrefs} />
        </SettingsSection>

        {/*
          The Platform card used to sit here, visible to any signed-in user "until there
          is a role check". There is one now: it moved to Settings → Admin, behind
          `requireAdmin()`. The platform's own wallets and fee ledger are not a tenant's
          business, and this page is every tenant's.
        */}
        {/* Default tone: signing out is reversible and loses nothing, so it gets no red frame. */}
        <SettingsSection id="sign-out" title="Sign out">
          <SignOutSection />
        </SettingsSection>
      </div>
    </div>
  );
}
