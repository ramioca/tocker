import { describe, expect, it } from "vitest";
import { ipfsPath, logoCandidates } from "./logo";

describe("logoCandidates", () => {
  it("routes an ipfs.io logo through the gateways that serve it, keeping the original last", () => {
    expect(logoCandidates("https://ipfs.io/ipfs/bafkreiabc")).toEqual([
      "https://pump.mypinata.cloud/ipfs/bafkreiabc",
      "https://gateway.pinata.cloud/ipfs/bafkreiabc",
      "https://ipfs.io/ipfs/bafkreiabc",
    ]);
  });
  it("understands ipfs:// and subdomain gateways", () => {
    expect(ipfsPath("ipfs://QmXyz/logo.png")).toBe("QmXyz/logo.png");
    expect(ipfsPath("https://bafyabc.ipfs.dweb.link/")).toBe("bafyabc");
    expect(ipfsPath("https://bafyabc.ipfs.dweb.link/art.png")).toBe("bafyabc/art.png");
  });
  it("leaves a non-IPFS logo alone", () => {
    expect(logoCandidates("https://gateway.irys.xyz/8xQ6")).toEqual(["https://gateway.irys.xyz/8xQ6"]);
  });
  it("does not repeat a Pinata URL the registry already gave", () => {
    expect(logoCandidates("https://gateway.pinata.cloud/ipfs/Qm1")).toHaveLength(2);
  });
});
