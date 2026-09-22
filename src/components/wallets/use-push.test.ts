import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./use-push";

/**
 * The conversion that fails silently.
 *
 * A VAPID public key is 65 bytes of uncompressed P-256 point published as *unpadded
 * base64url*. Hand `atob` the raw string and it either throws or — worse, depending on
 * the browser — produces bytes that are subtly wrong, and `pushManager.subscribe()`
 * rejects with `InvalidAccessError` and no explanation. These tests pin the two things
 * that go wrong: the padding, and the two substituted characters.
 */
describe("urlBase64ToUint8Array", () => {
  it("decodes a real 65-byte VAPID public key", () => {
    // Uncompressed P-256 point: a 0x04 prefix and two 32-byte coordinates.
    const key =
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("re-pads a string whose length is not a multiple of four", () => {
    // "any carnal pleas" → 16 bytes → base64 needs no padding; the shorter prefixes do.
    expect(Array.from(urlBase64ToUint8Array("YW55"))).toEqual([97, 110, 121]);
    expect(Array.from(urlBase64ToUint8Array("YW55IGM"))).toEqual([97, 110, 121, 32, 99]);
    expect(Array.from(urlBase64ToUint8Array("YW55IGNh"))).toEqual([97, 110, 121, 32, 99, 97]);
  });

  it("accepts a key that already carries its padding", () => {
    expect(Array.from(urlBase64ToUint8Array("YW55IGM="))).toEqual([97, 110, 121, 32, 99]);
  });

  it("translates the base64url alphabet", () => {
    // 0xFB 0xFF 0xBF encodes as "+/+/" in base64 and "-_-_" in base64url. Skip the
    // substitution and `atob` throws instead of decoding.
    expect(Array.from(urlBase64ToUint8Array("-_-_"))).toEqual([251, 255, 191]);
  });

  it("round-trips arbitrary bytes", () => {
    const original = Uint8Array.from({ length: 96 }, (_, i) => (i * 37) % 256);
    const encoded = Buffer.from(original).toString("base64url");
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(Array.from(original));
  });

  it("ignores surrounding whitespace, which is how a key pasted into an env file arrives", () => {
    expect(Array.from(urlBase64ToUint8Array("  YW55  \n"))).toEqual([97, 110, 121]);
  });

  it("refuses an empty key rather than returning zero bytes", () => {
    expect(() => urlBase64ToUint8Array("")).toThrow();
    expect(() => urlBase64ToUint8Array("   ")).toThrow();
  });
});
