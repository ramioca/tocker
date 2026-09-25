"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { updateProfile } from "@/server/actions/users";
import type { Session } from "@/server/types";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { SESSION_QUERY_KEY } from "@/hooks/use-session";
import { MORPH_FOCUS, enterSubmits, useMorphAction } from "./use-morph-action";

const BIO_MAX = 240;
// Mirrors HANDLE_RE in src/server/actions/users.ts, so a bad handle is caught before the round trip.
const HANDLE_RE = /^[a-z0-9_]{2,20}$/i;

type Field = "handle" | "displayName" | "bio" | "form";

/** Which field a server error belongs to, so it can sit under that field. */
function fieldFor(message: string): Field {
  if (/handle/i.test(message)) return "handle";
  if (/display name/i.test(message)) return "displayName";
  if (/bio/i.test(message)) return "bio";
  return "form";
}

export function ProfileForm({ session, bio: initialBio }: { session: Session; bio: string }) {
  const [handle, setHandle] = useState(session.handle);
  const [displayName, setDisplayName] = useState(session.displayName ?? "");
  const [bio, setBio] = useState(initialBio);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  // What the server last accepted. Save stays disabled until something differs from it:
  // saving an untouched form played the whole save and said "Saved" about nothing.
  const [saved, setSaved] = useState({
    handle: session.handle,
    displayName: session.displayName ?? "",
    bio: initialBio,
  });
  const dirty = handle !== saved.handle || displayName !== saved.displayName || bio !== saved.bio;
  const queryClient = useQueryClient();
  const router = useRouter();

  async function save() {
    setError(null);
    if (!HANDLE_RE.test(handle)) {
      setError({ field: "handle", message: "Handles are 2–20 characters: letters, numbers and underscores." });
      throw new Error("invalid handle");
    }
    try {
      const result = await updateProfile({ handle, displayName, bio });
      if (!result.ok) {
        setError({ field: fieldFor(result.error), message: result.error });
        throw new Error(result.error);
      }
      setSaved({ handle, displayName, bio });
      // The account menu reads the session query (fresh for 30s, no refetch on focus), so
      // without this its Profile link kept pointing at the old handle — a page that no
      // longer exists. The refresh does the same for everything server-rendered.
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      // Foundation hasn't landed yet — treat the stub as a no-op success in dev.
      if (message.includes("not implemented")) return;
      setError((current) => current ?? { field: "form", message });
      throw e;
    }
  }

  const { state, run, reset } = useMorphAction(save);

  // Editing a field clears its error and takes the button out of "Not saved".
  const edited = (field: Field) => {
    if (error?.field === field || error?.field === "form") setError(null);
    reset();
  };

  const errorFor = (field: Field) =>
    error?.field === field ? (
      <p id={`profile-${field}-error`} role="alert" className="mt-1.5 text-sm text-destructive">
        {error.message}
      </p>
    ) : null;

  const invalid = (field: Field) =>
    error?.field === field ? { "aria-invalid": true, "aria-describedby": `profile-${field}-error` } : {};

  return (
    <form
      className="space-y-5"
      noValidate
      onKeyDown={enterSubmits(() => {
        if (dirty) void run();
      })}
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) void run();
      }}
    >
      <div className="flex items-center gap-4">
        <AgentAvatar seed={handle || "tocker"} label={displayName || handle} size="lg" rounded="rounded-2xl" />
        <p className="text-sm text-muted-foreground">
          Your avatar is generated from your handle. Change the handle, change the face.
        </p>
      </div>

      {/* Top labels, like Bio below: a floating label paints a dark box on this card. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-handle" className="text-sm font-medium">
            Handle
          </label>
          <Input
            id="profile-handle"
            value={handle}
            autoComplete="username"
            maxLength={20}
            {...invalid("handle")}
            onChange={(event) => {
              setHandle(event.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase());
              edited("handle");
            }}
            className="mt-2 h-9 dark:bg-transparent"
          />
          {errorFor("handle")}
        </div>
        <div>
          <label htmlFor="profile-name" className="text-sm font-medium">
            Display name
          </label>
          <Input
            id="profile-name"
            value={displayName}
            autoComplete="name"
            maxLength={48}
            {...invalid("displayName")}
            onChange={(event) => {
              setDisplayName(event.target.value);
              edited("displayName");
            }}
            className="mt-2 h-9 dark:bg-transparent"
          />
          {errorFor("displayName")}
        </div>
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
          {...invalid("bio")}
          onChange={(event) => {
            setBio(event.target.value);
            edited("bio");
          }}
          className="mt-2 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          placeholder="What do your agents do?"
        />
        <p className="mt-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {bio.length}/{BIO_MAX}
        </p>
        {errorFor("bio")}
      </div>

      {errorFor("form")}

      <MorphButton
        state={state}
        onClick={() => void run()}
        successLabel="Saved"
        errorLabel="Not saved"
        size="sm"
        disabled={state === "idle" && !dirty}
        className={MORPH_FOCUS}
      >
        Save profile
      </MorphButton>
    </form>
  );
}
