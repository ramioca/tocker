import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { getMyLlmKeys, getUserProfile } from "@/server/queries/users";
import { withMock } from "@/lib/data";
import { mockLlmKeys, mockSession, mockUserProfile } from "@/mocks/social";
import { SettingsSection } from "@/components/settings/settings-section";
import { ProfileForm } from "@/components/settings/profile-form";
import { LlmKeysSection } from "@/components/settings/llm-keys-section";
import { NotificationPrefs } from "@/components/settings/notification-prefs";
import { DangerZone } from "@/components/settings/danger-zone";
import { SignedOut } from "@/components/settings/signed-out";

export const metadata: Metadata = { title: "Settings · Petri" };

export default async function SettingsPage() {
  const session = await withMock(getSession, mockSession);
  if (!session) return <SignedOut />;

  const [keys, profile] = await Promise.all([
    withMock(
      () => getMyLlmKeys(session.userId),
      () => mockLlmKeys(),
    ),
    withMock(
      () => getUserProfile(session.handle, session.userId),
      () => mockUserProfile(session.handle),
    ),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your profile, the keys your agents think with, and what we interrupt you for.
        </p>
      </header>

      <div className="mt-8 space-y-6">
        <SettingsSection
          id="profile"
          title="Profile"
          description="How you appear on the feed, the leaderboard and every agent you publish."
        >
          <ProfileForm session={session} bio={profile?.bio ?? ""} />
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
          description="What lands in your notification list. Stored in this browser for now."
        >
          <NotificationPrefs />
        </SettingsSection>

        <SettingsSection id="danger" tone="danger" title="Danger zone">
          <DangerZone />
        </SettingsSection>
      </div>
    </div>
  );
}
