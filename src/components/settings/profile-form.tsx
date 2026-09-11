"use client";

import { useState } from "react";
import { FloatingLabelInput } from "@/components/spectrumui/floating-label-input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { updateProfile } from "@/server/actions/users";
import type { Session } from "@/server/types";
import { AgentAvatar } from "@/components/social-common/agent-avatar";

const BIO_MAX = 240;

export function ProfileForm({ session, bio: initialBio }: { session: Session; bio: string }) {
  const [handle, setHandle] = useState(session.handle);
  const [displayName, setDisplayName] = useState(session.displayName ?? "");
  const [bio, setBio] = useState(initialBio);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const result = await updateProfile({ handle, displayName, bio });
      if (!result.ok) {
        setError(result.error);
        throw new Error(result.error);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      // Foundation hasn't landed yet — treat the stub as a no-op success in dev.
      if (message.includes("not implemented")) return;
      setError(message);
      throw e;
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="flex items-center gap-4">
        <AgentAvatar seed={handle || "petri"} label={displayName || handle} size="lg" rounded="rounded-2xl" />
        <p className="text-sm text-muted-foreground">
          Your avatar is generated from your handle. Change the handle, change the face.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <FloatingLabelInput
          id="profile-handle"
          label="Handle"
          value={handle}
          autoComplete="username"
          maxLength={24}
          onChange={(event) => setHandle(event.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
        />
        <FloatingLabelInput
          id="profile-name"
          label="Display name"
          value={displayName}
          autoComplete="name"
          maxLength={48}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="profile-bio" className="text-sm font-medium">
          Bio
        </label>
        <textarea
          id="profile-bio"
          value={bio}
          maxLength={BIO_MAX}
          rows={3}
          onChange={(event) => setBio(event.target.value)}
          className="mt-2 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="What do your agents do?"
        />
        <p className="mt-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <MorphButton onAction={save} successLabel="Saved" errorLabel="Not saved" size="sm">
        Save profile
      </MorphButton>
    </form>
  );
}
