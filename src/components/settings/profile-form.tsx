"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { updateProfile } from "@/server/actions/users";
import type { Session } from "@/server/types";
import { UserAvatar } from "@/components/common/user-avatar";
import { AvatarPicker } from "@/components/profile/avatar-picker";
import { HANDLE_RE, handleProblem, handleProblemSentence } from "@/lib/handles";
import { MORPH_FOCUS, enterSubmits, useMorphAction } from "./use-morph-action";
import { cleanHandle, removedNote } from "./handle-filter";
import {
  fieldFor,
  followServer,
  previewUser,
  profileDirty,
  profilePayload,
  savedAvatar,
  type ProfileDraft,
  type ProfileField as Field,
} from "./profile-model";

const BIO_MAX = 240;

export function ProfileForm({
  session,
  bio: initialBio,
  avatarSeeds,
}: {
  session: Session;
  bio: string;
  /**
   * Generated avatars for the picker, made by the page. This form is rendered on the
   * server too, so it cannot make random ones itself: the two renders would differ.
   */
  avatarSeeds: readonly string[];
}) {
  const [handle, setHandle] = useState(session.handle);
  const [displayName, setDisplayName] = useState(session.displayName ?? "");
  const [bio, setBio] = useState(initialBio);
  const [avatar, setAvatar] = useState(() => savedAvatar(session));
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  // What the last keystroke dropped from Username, said in place of its hint until the next
  // one: characters that vanished without a word read as a broken field.
  const [dropped, setDropped] = useState<string | null>(null);
  // What the server last accepted. Save stays disabled until something differs from it:
  // saving an untouched form played the whole save and said "Saved" about nothing.
  const [saved, setSaved] = useState<ProfileDraft>(() => ({
    handle: session.handle,
    displayName: session.displayName ?? "",
    bio: initialBio,
    avatar: savedAvatar(session),
  }));
  const draft: ProfileDraft = { handle, displayName, bio, avatar };
  // What the page last said the account is. It can change under a mounted form: the
  // first-run card opens over every page, saves a username and an avatar, and the refresh
  // after it hands this form new props without resetting its state. Taken in while
  // rendering, so no frame shows the name the account has just left, and no save is
  // measured against it.
  const [server, setServer] = useState({ handle: session.handle, avatarSeed: session.avatarSeed ?? null });
  if (server.handle !== session.handle || server.avatarSeed !== (session.avatarSeed ?? null)) {
    const next = followServer(draft, saved, { handle: session.handle, avatar: savedAvatar(session) });
    setServer({ handle: session.handle, avatarSeed: session.avatarSeed ?? null });
    setHandle(next.draft.handle);
    setAvatar(next.draft.avatar);
    setSaved(next.saved);
  }
  const dirty = profileDirty(draft, saved);
  const queryClient = useQueryClient();
  const router = useRouter();

  async function save() {
    setError(null);
    // The same rule and the same sentences as `updateProfile`, before the round trip.
    // Only a change is refused, so a handle the account already holds still saves.
    const problem = handleProblem(handle, saved.handle);
    if (problem) {
      setError({ field: "handle", message: handleProblemSentence(problem) });
      throw new Error(`${problem} handle`);
    }
    try {
      const result = await updateProfile(profilePayload(draft, saved));
      if (!result.ok) {
        setError({ field: fieldFor(result.error), message: result.error });
        throw new Error(result.error);
      }
      setSaved(draft);
      // The account menu reads the session query (fresh for 30s, no refetch on focus), so
      // without this its Profile link kept pointing at the old handle — a page that no
      // longer exists. No key: every feed and comment list in the cache holds the old
      // name and avatar too. The refresh does the same for everything server-rendered.
      void queryClient.invalidateQueries();
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

  // The handle is the profile's address, so a valid new one orphans every link to the old.
  // Not while the handle has an error: "links will stop working" beside "that handle is
  // taken" warns about a rename that cannot happen.
  const renaming = HANDLE_RE.test(handle) && handle !== saved.handle && error?.field !== "handle";
  const handleDescribedBy = [
    dropped ? "profile-handle-dropped" : "profile-handle-hint",
    renaming ? "profile-handle-rename" : null,
    error?.field === "handle" ? "profile-handle-error" : null,
  ]
    .filter(Boolean)
    .join(" ");

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
      {/* On a phone the row of tiles needs the card's whole width, so it goes under the
          avatar and its label. From `sm` it sits beside the avatar, at the width the
          first-run card gives the same row. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 sm:gap-x-5 sm:gap-y-2.5">
        <UserAvatar
          user={previewUser(draft, { handle: saved.handle, avatarUrl: session.avatarUrl })}
          px={64}
          className="size-16 sm:row-span-2"
        />
        {/* Hidden from a screen reader: the group below carries the same name. */}
        <p aria-hidden className="text-sm font-medium">
          Avatar
        </p>
        <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:w-[336px]">
          <AvatarPicker
            photoUrl={session.avatarUrl}
            pinnedSeed={session.avatarSeed ?? null}
            initialSeeds={avatarSeeds}
            value={avatar}
            onChange={(choice) => {
              setAvatar(choice);
              edited("avatar");
            }}
            handle={handle || saved.handle}
          />
          {errorFor("avatar")}
        </div>
      </div>

      {/* Top labels, like Bio below: a floating label paints a dark box on this card. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-handle" className="text-sm font-medium">
            Username
          </label>
          <Input
            id="profile-handle"
            value={handle}
            autoComplete="username"
            maxLength={20}
            {...invalid("handle")}
            aria-describedby={handleDescribedBy}
            onChange={(event) => {
              const { value, removed } = cleanHandle(event.target.value);
              setHandle(value);
              setDropped(removedNote(removed));
              edited("handle");
            }}
            className="mt-2 h-9 dark:bg-transparent"
          />
          {/* The note takes the hint's place in one grid cell, so the fields below don't
              jump as it comes and goes. Its live region is always mounted, so it is
              announced; the hint is not live, or every keystroke would read the address back. */}
          <div className="mt-1.5 grid text-xs">
            <p
              id="profile-handle-hint"
              className={`col-start-1 row-start-1 text-muted-foreground${dropped ? " invisible" : ""}`}
            >
              Your profile: <span className="whitespace-nowrap text-foreground/80">/u/{handle || "…"}</span> ·{" "}
              <span className="whitespace-nowrap">
                letters, numbers and _ · <span className="tnum">2–20</span>
              </span>
            </p>
            <div aria-live="polite" className="col-start-1 row-start-1">
              {dropped ? (
                <p id="profile-handle-dropped" className="text-amber-700 dark:text-amber-400">
                  {dropped}
                </p>
              ) : null}
            </div>
          </div>
          {renaming ? (
            <p id="profile-handle-rename" className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Links to /u/{saved.handle} will stop working.
            </p>
          ) : null}
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
          className="mt-2 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none md:text-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
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
