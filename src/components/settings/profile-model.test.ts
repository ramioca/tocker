/**
 * The profile form's save: what counts as a change, what is sent, and where a refusal is
 * shown. The avatar is the part with rules: it is sent only when it was changed, and the
 * account's own photo is sent as "no picked avatar".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_REFUSED, AVATAR_SEED_RE, type AvatarChoice } from "@/lib/avatar";
import { HANDLE_INVALID, HANDLE_TAKEN } from "@/lib/handles";
import { HANDLE_RESERVED } from "@/lib/reserved-handles";
import {
  fieldFor,
  followServer,
  previewUser,
  profileDirty,
  profilePayload,
  savedAvatar,
  type ProfileDraft,
} from "./profile-model";

const X_PHOTO = "https://pbs.twimg.com/profile_images/1234567890/AbC_dEf-1_normal.jpg";
const PHOTO: AvatarChoice = { kind: "photo" };
const seed = (value: string): AvatarChoice => ({ kind: "seed", seed: value });

const saved = (avatar: AvatarChoice | null): ProfileDraft => ({
  handle: "rami",
  displayName: "Rami",
  bio: "Runs two agents.",
  avatar,
});

describe("the avatar an account has now", () => {
  it("is the one it picked, whatever its photo", () => {
    expect(savedAvatar({ avatarSeed: "k3j9x0a1bz", avatarUrl: X_PHOTO })).toEqual(seed("k3j9x0a1bz"));
    expect(savedAvatar({ avatarSeed: "k3j9x0a1bz", avatarUrl: null })).toEqual(seed("k3j9x0a1bz"));
  });

  it("is its photo when it picked none and the photo is one the app will show", () => {
    expect(savedAvatar({ avatarSeed: null, avatarUrl: X_PHOTO })).toEqual(PHOTO);
    expect(savedAvatar({ avatarUrl: X_PHOTO })).toEqual(PHOTO);
  });

  it("is nothing otherwise, so no tile is selected", () => {
    expect(savedAvatar({ avatarSeed: null, avatarUrl: null })).toBeNull();
    expect(savedAvatar({})).toBeNull();
    // A photo link the app will not show is no photo.
    expect(savedAvatar({ avatarSeed: null, avatarUrl: "https://example.com/me.jpg" })).toBeNull();
  });
});

describe("whether there is anything to save", () => {
  it("is not dirty as it opens", () => {
    for (const avatar of [null, PHOTO, seed("k3j9x0a1bz")]) {
      expect(profileDirty(saved(avatar), saved(avatar))).toBe(false);
    }
    // The same seed in a new object is the same avatar.
    expect(profileDirty(saved(seed("k3j9x0a1bz")), saved(seed("k3j9x0a1bz")))).toBe(false);
  });

  it("is dirty when any field differs", () => {
    const was = saved(null);
    expect(profileDirty({ ...was, handle: "rami2" }, was)).toBe(true);
    expect(profileDirty({ ...was, displayName: "" }, was)).toBe(true);
    expect(profileDirty({ ...was, bio: "" }, was)).toBe(true);
  });

  it("is dirty when the avatar alone differs", () => {
    expect(profileDirty(saved(seed("k3j9x0a1bz")), saved(null))).toBe(true);
    expect(profileDirty(saved(seed("k3j9x0a1bz")), saved(PHOTO))).toBe(true);
    expect(profileDirty(saved(PHOTO), saved(seed("k3j9x0a1bz")))).toBe(true);
    expect(profileDirty(saved(seed("aaaaaaaaa1")), saved(seed("k3j9x0a1bz")))).toBe(true);
  });
});

describe("what a save sends", () => {
  it("sends the display name and the bio, and neither username nor avatar while they are untouched", () => {
    for (const avatar of [null, PHOTO, seed("k3j9x0a1bz")]) {
      const was = saved(avatar);
      const payload = profilePayload({ ...was, bio: "" }, was);
      expect(payload).toEqual({ displayName: "Rami", bio: "" });
      // Absent, not undefined-valued or null: null would clear a picked avatar, and a
      // username that is sent is a username that is written.
      expect("handle" in payload).toBe(false);
      expect("avatarSeed" in payload).toBe(false);
    }
  });

  it("sends the username only when it was changed", () => {
    const was = saved(null);
    expect(profilePayload({ ...was, handle: "rami2" }, was)).toEqual({
      handle: "rami2",
      displayName: "Rami",
      bio: "Runs two agents.",
    });
  });

  it("does not send back the name a form was opened with, once the account has another", () => {
    // The first-run card saved a new name over the Settings page; this form was never
    // told. Its next save is about the bio alone, and must not rename the account back.
    const opened: ProfileDraft = { handle: "user5a5ppx", displayName: "", bio: "", avatar: null };
    const payload = profilePayload({ ...opened, bio: "Hello." }, opened);
    expect(payload).toEqual({ displayName: "", bio: "Hello." });
    expect(JSON.stringify(payload)).not.toContain("user5a5ppx");
  });

  it("sends a picked avatar as its seed", () => {
    const payload = profilePayload(saved(seed("k3j9x0a1bz")), saved(null));
    expect(payload).toEqual({ displayName: "Rami", bio: "Runs two agents.", avatarSeed: "k3j9x0a1bz" });
    expect(payload.avatarSeed).toMatch(AVATAR_SEED_RE);
    expect(profilePayload(saved(seed("aaaaaaaaa1")), saved(seed("k3j9x0a1bz"))).avatarSeed).toBe("aaaaaaaaa1");
    expect(profilePayload(saved(seed("aaaaaaaaa1")), saved(PHOTO)).avatarSeed).toBe("aaaaaaaaa1");
  });

  it("sends the account's own photo as no picked avatar", () => {
    const payload = profilePayload(saved(PHOTO), saved(seed("k3j9x0a1bz")));
    expect("avatarSeed" in payload).toBe(true);
    expect(payload.avatarSeed).toBeNull();
  });

  it("never sends a photo link", () => {
    const payload = profilePayload({ ...saved(PHOTO), handle: "rami2" }, saved(seed("k3j9x0a1bz")));
    expect(Object.keys(payload).sort()).toEqual(["avatarSeed", "bio", "displayName", "handle"]);
    expect(JSON.stringify(payload)).not.toContain("http");
  });

  it("keeps the face made from the username through a rename", () => {
    // Nothing picked and no photo: the rename goes alone, and the avatar follows the new name.
    const was = saved(null);
    expect(profilePayload({ ...was, handle: "newname" }, was)).toEqual({
      handle: "newname",
      displayName: "Rami",
      bio: "Runs two agents.",
    });
  });
});

describe("a username or avatar that changed on the server under a mounted form", () => {
  const opened: ProfileDraft = { handle: "user5a5ppx", displayName: "Rami", bio: "", avatar: null };
  const chosen = { handle: "rami", avatar: seed("k3j9x0a1bz") };

  it("is taken in whole by a form nobody has touched", () => {
    const next = followServer(opened, opened, chosen);
    expect(next.saved).toEqual({ ...opened, ...chosen });
    expect(next.draft).toEqual(next.saved);
    expect(profileDirty(next.draft, next.saved)).toBe(false);
  });

  it("leaves what the person has typed, and measures it against the new saved values", () => {
    const typing = { ...opened, handle: "ramid", bio: "Hello." };
    const next = followServer(typing, opened, chosen);
    expect(next.draft).toEqual({ ...typing, avatar: chosen.avatar });
    expect(next.saved).toEqual({ ...opened, ...chosen });
    // The rename they typed still goes, and it is a rename from the name the account has now.
    expect(profilePayload(next.draft, next.saved)).toEqual({ handle: "ramid", displayName: "Rami", bio: "Hello." });
  });

  it("leaves an avatar the person has picked here", () => {
    const picking = { ...opened, avatar: seed("aaaaaaaaa1") };
    const next = followServer(picking, opened, chosen);
    expect(next.draft.avatar).toEqual(seed("aaaaaaaaa1"));
    expect(next.draft.handle).toBe("rami");
    expect(profilePayload(next.draft, next.saved).avatarSeed).toBe("aaaaaaaaa1");
  });

  it("changes nothing when it is this form's own save coming back, in either order", () => {
    const sent = { ...opened, handle: "rami", avatar: seed("k3j9x0a1bz") };
    // The page's new props before the form has marked its save as done.
    const early = followServer(sent, opened, chosen);
    expect(early.draft).toEqual(sent);
    expect(early.saved).toEqual({ ...opened, ...chosen });
    // And after.
    const late = followServer(sent, sent, chosen);
    expect(late).toEqual({ draft: sent, saved: sent });
  });

  it("keeps the display name and the bio, which only this form changes", () => {
    const typing = { ...opened, displayName: "Rami D.", bio: "Typing." };
    const next = followServer(typing, opened, chosen);
    expect(next.draft.displayName).toBe("Rami D.");
    expect(next.draft.bio).toBe("Typing.");
    expect(next.saved.displayName).toBe("Rami");
    expect(next.saved.bio).toBe("");
  });
});

describe("the avatar the form itself draws", () => {
  const account = { handle: "rami", avatarUrl: X_PHOTO };

  it("is the picked one", () => {
    expect(previewUser({ handle: "rami", avatar: seed("k3j9x0a1bz") }, account)).toEqual({
      handle: "rami",
      avatarSeed: "k3j9x0a1bz",
      avatarUrl: X_PHOTO,
    });
  });

  it("is the photo, with no seed over it, when the photo is picked", () => {
    expect(previewUser({ handle: "rami", avatar: PHOTO }, account).avatarSeed).toBeNull();
  });

  it("follows the username being typed while nothing is picked", () => {
    const none = { handle: "rami", avatarUrl: null };
    expect(previewUser({ handle: "newname", avatar: null }, none)).toEqual({
      handle: "newname",
      avatarSeed: null,
      avatarUrl: null,
    });
    // An emptied field draws the saved name's face rather than a blank one.
    expect(previewUser({ handle: "", avatar: null }, none).handle).toBe("rami");
  });
});

describe("where a refusal is shown", () => {
  it("puts each of the server's sentences under its own field", () => {
    for (const sentence of [HANDLE_INVALID, HANDLE_TAKEN, HANDLE_RESERVED]) {
      expect(fieldFor(sentence), sentence).toBe("handle");
    }
    expect(fieldFor("Display name must be 60 characters or fewer")).toBe("displayName");
    expect(fieldFor("Bio must be 280 characters or fewer")).toBe("bio");
    expect(fieldFor(AVATAR_REFUSED)).toBe("avatar");
  });

  it("puts anything else under the form", () => {
    expect(fieldFor("Sign in first")).toBe("form");
    expect(fieldFor("Something went wrong")).toBe("form");
  });
});

describe("the form", () => {
  const SRC = join(process.cwd(), "src");
  const form = readFileSync(join(SRC, "components/settings/profile-form.tsx"), "utf8");
  const page = readFileSync(join(SRC, "app/(client)/(app)/settings/page.tsx"), "utf8");

  it("sends what profilePayload makes, and counts the avatar as a change", () => {
    expect(form).toMatch(/updateProfile\(profilePayload\(draft, saved\)\)/);
    expect(form.match(/updateProfile\(/g)).toHaveLength(1);
    expect(form).toMatch(/const dirty = profileDirty\(draft, saved\)/);
  });

  it("follows the username and avatar the page says the account has, without being remounted", () => {
    // A key on the form would do it too, and would cut "Saved" short after every rename.
    expect(form).toMatch(/if \(server\.handle !== session\.handle \|\| server\.avatarSeed !== \(session\.avatarSeed \?\? null\)\) \{/);
    expect(form).toMatch(/followServer\(draft, saved, \{ handle: session\.handle, avatar: savedAvatar\(session\) \}\)/);
    expect(page).not.toMatch(/<ProfileForm\s+key=/);
  });

  it("refreshes every cached list after a save, not only the session", () => {
    expect(form).toMatch(/queryClient\.invalidateQueries\(\)/);
    expect(form).not.toMatch(/invalidateQueries\(\{/);
  });

  it("no longer says the avatar is made from the handle", () => {
    expect(form).not.toMatch(/generated from your handle/i);
    expect(form).not.toMatch(/Change the handle, change the face/);
  });

  it("takes its generated avatars from the page, which makes them on the server", () => {
    expect(form).toMatch(/initialSeeds=\{avatarSeeds\}/);
    expect(page).toMatch(/avatarSeeds=\{avatarTiles\(null, seedCount\(false\)\)\}/);
  });
});
