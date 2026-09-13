import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { derivePublicKey } from "./privy";

describe("derivePublicKey", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  it("turns a base64 PKCS8 P-256 private key into its base64 SPKI public key", () => {
    expect(derivePublicKey(pkcs8)).toBe(spki);
  });

  it("accepts the dashboard's wallet-auth: prefix", () => {
    expect(derivePublicKey(`wallet-auth:${pkcs8}`)).toBe(spki);
  });
});
