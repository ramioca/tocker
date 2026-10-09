/**
 * A person's avatar: which photo links the app will put on a page, what a seed may be,
 * and which of seed, photo and fallback is drawn.
 *
 * `photoAt` is the interesting one. The link in `users.avatar_url` came from a sign-in
 * provider, and every viewer's browser fetches whatever it says, so the refusals are
 * what is checked.
 */
import { describe, expect, it } from "vitest";
import { AVATAR_REFUSED, AVATAR_SEED_RE, avatarFor, avatarTiles, photoAt, randomSeed } from "./avatar";

/** A repeatable `rand`: a fixed sequence in [0, 1), started again by each call. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const X_PHOTO = "https://pbs.twimg.com/profile_images/1234567890/AbC_dEf-1_normal.jpg";

describe("photoAt", () => {
  it("answers null when there is no link", () => {
    expect(photoAt(null, 96)).toBeNull();
    expect(photoAt(undefined, 96)).toBeNull();
    expect(photoAt("", 96)).toBeNull();
    expect(photoAt("not a url", 96)).toBeNull();
  });

  it("refuses anything that is not https", () => {
    expect(photoAt(X_PHOTO.replace("https:", "http:"), 96)).toBeNull();
    expect(photoAt("data:image/png;base64,AAAA", 96)).toBeNull();
    expect(photoAt("javascript:alert(1)", 96)).toBeNull();
    expect(photoAt("//pbs.twimg.com/profile_images/1/a_normal.jpg", 96)).toBeNull();
  });

  it("refuses every other host, and the ones made to look like X's", () => {
    for (const url of [
      "https://example.com/profile_images/1/a_normal.jpg",
      "https://lh3.googleusercontent.com/a/photo",
      "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
      "https://pbs.twimg.com.example.com/profile_images/1/a_normal.jpg",
      "https://example.com/pbs.twimg.com/profile_images/1/a_normal.jpg",
      "https://pbs.twimg.com@example.com/profile_images/1/a_normal.jpg",
      "https://user:pass@pbs.twimg.com/profile_images/1/a_normal.jpg",
      "https://xpbs.twimg.com/profile_images/1/a_normal.jpg",
      "https://pbs.twimg.com:8443/profile_images/1/a_normal.jpg",
    ]) {
      expect(photoAt(url, 96), url).toBeNull();
    }
  });

  it("refuses a path that could close the url() it is written into", () => {
    expect(photoAt('https://pbs.twimg.com/a")}body{display:none', 96)).toBeNull();
    expect(photoAt("https://pbs.twimg.com/a\\b.jpg", 96)).toBe("https://pbs.twimg.com/a/b.jpg");
    // A space is escaped by the URL parser, so it never reaches the page as one.
    expect(photoAt("https://pbs.twimg.com/a b.jpg", 96)).toBe("https://pbs.twimg.com/a%20b.jpg");
    expect(photoAt("https://pbs.twimg.com/", 96)).toBeNull();
  });

  it("drops the query and the fragment", () => {
    expect(photoAt(`${X_PHOTO}?track=1#frag`, 24)).toBe(X_PHOTO);
  });

  it("asks for the size the avatar is drawn at", () => {
    const sized = (suffix: string) => X_PHOTO.replace("_normal", suffix);
    // 48px, 73px and 200px files: a small avatar keeps the small one.
    expect(photoAt(X_PHOTO, 24)).toBe(X_PHOTO);
    expect(photoAt(X_PHOTO, 28)).toBe(sized("_bigger"));
    expect(photoAt(X_PHOTO, 36)).toBe(sized("_bigger"));
    expect(photoAt(X_PHOTO, 44)).toBe(sized("_200x200"));
    expect(photoAt(X_PHOTO, 96)).toBe(sized("_200x200"));
  });

  it("uses a link without the size suffix as it is", () => {
    const plain = "https://pbs.twimg.com/profile_images/1234567890/photo.png";
    expect(photoAt(plain, 96)).toBe(plain);
    // Only the suffix before the extension is a size.
    const inName = "https://pbs.twimg.com/profile_images/1/my_normal_face.jpg";
    expect(photoAt(inName, 96)).toBe(inName);
  });
});

describe("randomSeed", () => {
  it("makes ten lowercase letters or digits, which is all a seed may be", () => {
    for (let i = 0; i < 200; i += 1) expect(randomSeed()).toMatch(AVATAR_SEED_RE);
    expect(randomSeed(() => 0)).toBe("aaaaaaaaaa");
    // A `rand` that answers 1, which Math.random never does, still stays in range.
    expect(randomSeed(() => 1)).toBe("9999999999");
  });

  it("is repeatable with an injected rand", () => {
    expect(randomSeed(sequence(7))).toBe(randomSeed(sequence(7)));
    expect(randomSeed(sequence(7))).not.toBe(randomSeed(sequence(8)));
  });

  it("refuses, as a seed, anything a person could have typed a message into", () => {
    for (const seed of ["", "short", "UPPERCASE1", "has space 1", "eleven_char", "abcdefghijk", "user5a5ppx!", "jane-doe-1"]) {
      expect(AVATAR_SEED_RE.test(seed), seed).toBe(false);
    }
  });
});

describe("avatarTiles", () => {
  it("keeps the pinned seed first and as it is", () => {
    const tiles = avatarTiles("pinnedseed", 5, sequence(3));
    expect(tiles).toHaveLength(5);
    expect(tiles[0]).toBe("pinnedseed");
    for (const seed of tiles.slice(1)) expect(seed).toMatch(AVATAR_SEED_RE);
  });

  it("returns distinct seeds", () => {
    const tiles = avatarTiles(null, 5, sequence(11));
    expect(new Set(tiles).size).toBe(5);
    // Also when a draw repeats the pinned one.
    const pinned = randomSeed(sequence(5));
    const again = avatarTiles(pinned, 4, sequence(5));
    expect(again[0]).toBe(pinned);
    expect(new Set(again).size).toBe(4);
  });

  it("is repeatable with an injected rand", () => {
    expect(avatarTiles(null, 5, sequence(42))).toEqual(avatarTiles(null, 5, sequence(42)));
  });

  it("stops, rather than loop, on a rand that is stuck", () => {
    expect(avatarTiles(null, 5, () => 0)).toEqual(["aaaaaaaaaa"]);
    expect(avatarTiles(null, 0)).toEqual([]);
    expect(avatarTiles("pinnedseed", 0)).toEqual([]);
  });
});

describe("the refusal", () => {
  it("fits one line of the first-run card", () => {
    expect(AVATAR_REFUSED.length).toBeLessThanOrEqual(44);
  });
});

describe("avatarFor", () => {
  it("draws the picked avatar and loads no photo", () => {
    expect(avatarFor({ handle: "rami", avatarSeed: "k3j9x0a1bz", avatarUrl: X_PHOTO }, 96)).toEqual({
      seed: "k3j9x0a1bz",
      photo: null,
    });
  });

  it("draws the photo, over the avatar made from the username, when none was picked", () => {
    expect(avatarFor({ handle: "rami", avatarSeed: null, avatarUrl: X_PHOTO }, 96)).toEqual({
      seed: "rami",
      photo: X_PHOTO.replace("_normal", "_200x200"),
    });
    expect(avatarFor({ handle: "rami", avatarUrl: X_PHOTO }, 24).photo).toBe(X_PHOTO);
  });

  it("falls back to the avatar made from the username", () => {
    expect(avatarFor({ handle: "rami" }, 96)).toEqual({ seed: "rami", photo: null });
    expect(avatarFor({ handle: "rami", avatarSeed: null, avatarUrl: null }, 96)).toEqual({ seed: "rami", photo: null });
    // A link the app will not show is the same as none.
    expect(avatarFor({ handle: "rami", avatarUrl: "https://example.com/me.jpg" }, 96)).toEqual({ seed: "rami", photo: null });
  });
});
