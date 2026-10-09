/**
 * The profile form's state, outside the component so it can be tested: what counts as a
 * change, what a save sends, and which field a refusal belongs under. No React.
 */
import { sameChoice } from "@/components/profile/avatar-picker-model";
import { photoAt, type AvatarChoice } from "@/lib/avatar";

export type ProfileField = "handle" | "displayName" | "bio" | "avatar" | "form";

export interface ProfileDraft {
  handle: string;
  displayName: string;
  bio: string;
  /** Null while the account has neither a picked avatar nor a photo: no tile is selected. */
  avatar: AvatarChoice | null;
}

/** What `updateProfile` is sent. `handle` and `avatarSeed` are there only when they changed. */
export interface ProfilePayload {
  handle?: string;
  displayName: string;
  bio: string;
  avatarSeed?: string | null;
}

/** Which field a server error belongs to, so it can sit under that field. */
export function fieldFor(message: string): ProfileField {
  // Every sentence about the handle says "username" (`src/lib/handles.test.ts` keeps it so).
  if (/username/i.test(message)) return "handle";
  if (/display name/i.test(message)) return "displayName";
  if (/bio/i.test(message)) return "bio";
  if (/avatar/i.test(message)) return "avatar";
  return "form";
}

/**
 * The avatar the account has now, as the picker holds it: the one it picked, else its
 * photo when that is one the app will show, else nothing. Nothing means the face is made
 * from the username, and no tile stands for that.
 */
export function savedAvatar(account: { avatarSeed?: string | null; avatarUrl?: string | null }): AvatarChoice | null {
  if (account.avatarSeed) return { kind: "seed", seed: account.avatarSeed };
  return photoAt(account.avatarUrl, 96) ? { kind: "photo" } : null;
}

export function profileDirty(draft: ProfileDraft, saved: ProfileDraft): boolean {
  return (
    draft.handle !== saved.handle ||
    draft.displayName !== saved.displayName ||
    draft.bio !== saved.bio ||
    !sameChoice(draft.avatar, saved.avatar)
  );
}

/**
 * What a save sends. The display name and the bio always go, as they always have. The
 * username and the avatar go only when they were changed, because the server leaves an
 * absent field alone and neither is this form's alone to say: the first-run card opens
 * over every page, Settings included. A form that sent the username it was opened with
 * renamed the account back to it, on the next save of anything. An untouched avatar
 * sends nothing either, so an account whose face is made from its username keeps that
 * through a rename. The photo is sent as a null seed, which is how the server is told
 * "no picked avatar".
 */
export function profilePayload(draft: ProfileDraft, saved: ProfileDraft): ProfilePayload {
  const payload: ProfilePayload = { displayName: draft.displayName, bio: draft.bio };
  if (draft.handle !== saved.handle) payload.handle = draft.handle;
  if (!sameChoice(draft.avatar, saved.avatar)) {
    payload.avatarSeed = draft.avatar?.kind === "seed" ? draft.avatar.seed : null;
  }
  return payload;
}

/**
 * The page rendered again with another username or avatar than the form holds as saved:
 * the first-run card saved them over this page, or this form's own save has come back.
 * `saved` takes the server's word. A field still showing the old saved value takes it
 * too; one the person has edited is left as they typed it.
 */
export function followServer(
  draft: ProfileDraft,
  saved: ProfileDraft,
  server: Pick<ProfileDraft, "handle" | "avatar">,
): { draft: ProfileDraft; saved: ProfileDraft } {
  return {
    draft: {
      ...draft,
      handle: draft.handle === saved.handle ? server.handle : draft.handle,
      avatar: sameChoice(draft.avatar, saved.avatar) ? server.avatar : draft.avatar,
    },
    saved: { ...saved, handle: server.handle, avatar: server.avatar },
  };
}

/**
 * Who the form's own avatar draws: the account as it would be after a save. With no
 * avatar picked it follows the username being typed, as the saved one will.
 */
export function previewUser(
  draft: Pick<ProfileDraft, "handle" | "avatar">,
  account: { handle: string; avatarUrl: string | null },
): { handle: string; avatarSeed: string | null; avatarUrl: string | null } {
  return {
    handle: draft.handle || account.handle,
    avatarSeed: draft.avatar?.kind === "seed" ? draft.avatar.seed : null,
    avatarUrl: account.avatarUrl,
  };
}
