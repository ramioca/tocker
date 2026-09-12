import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { ownerRenounced, parseGoPlusSecurity } from "./providers/goplus";
import { parsePoolTokens } from "./providers/geckoterminal";
import { hardGates, toFacts } from "./score";

const TOKEN = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const LIVE_OWNER = "0x704ec5c12ca20a293c2c0b72b22619a4231f3c0d";
const ZERO = "0x0000000000000000000000000000000000000000";
const universe = { ...DEFAULT_AGENT_CONFIG.universe, minHolderCount: 0, minLiquidityUsd: 0, minAgeMinutes: 0 };

function gatesFor(gp: Record<string, string>) {
  const facts = toFacts({ chain: "base", address: TOKEN, symbol: "T", goplus: parseGoPlusSecurity(TOKEN, gp), now: Date.now() });
  return hardGates(facts, universe);
}

describe("EVM mint risk", () => {
  it("blocks a mintable contract whose owner is live", () => {
    expect(gatesFor({ is_mintable: "1", owner_address: LIVE_OWNER, is_honeypot: "0" })).toContain("mint_authority_active");
  });

  it("does not block a mintable contract whose owner renounced", () => {
    for (const owner of ["", ZERO, "0x000000000000000000000000000000000000dEaD"]) {
      expect(gatesFor({ is_mintable: "1", owner_address: owner, is_honeypot: "0" }), owner || "(empty)").not.toContain(
        "mint_authority_active",
      );
    }
  });

  it("still blocks when a renounced owner can reclaim ownership or a hidden owner exists", () => {
    expect(gatesFor({ is_mintable: "1", owner_address: ZERO, can_take_back_ownership: "1", is_honeypot: "0" })).toContain(
      "mint_authority_active",
    );
    expect(gatesFor({ is_mintable: "1", owner_address: ZERO, hidden_owner: "1", is_honeypot: "0" })).toContain(
      "mint_authority_active",
    );
  });

  it("keeps mint risk unknown when GoPlus does not say, so the buy is refused", () => {
    expect(gatesFor({ is_honeypot: "0" })).toContain("mint_authority_unknown");
  });

  it("classifies owner addresses", () => {
    expect(ownerRenounced("")).toBe(true);
    expect(ownerRenounced(ZERO)).toBe(true);
    expect(ownerRenounced(LIVE_OWNER)).toBe(false);
    expect(ownerRenounced(undefined)).toBeNull();
  });
});

describe("GeckoTerminal pool feed", () => {
  it("extracts base-token addresses, lowercased and deduped, and ignores junk", () => {
    const body = {
      data: [
        { relationships: { base_token: { data: { id: "base_0xAbCdEf0000000000000000000000000000000001" } } } },
        { relationships: { base_token: { data: { id: "base_0xabcdef0000000000000000000000000000000001" } } } },
        { relationships: { base_token: { data: { id: "eth_0x1111111111111111111111111111111111111111" } } } },
        { relationships: {} },
        null,
      ],
    };
    expect(parsePoolTokens(body)).toEqual(["0xabcdef0000000000000000000000000000000001"]);
    expect(parsePoolTokens(null)).toEqual([]);
  });
});
