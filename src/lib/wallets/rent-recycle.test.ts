import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  RENT_RECYCLE_MAX_ACCOUNTS_PER_TX,
  buildRentRecycleTransaction,
  closableTokenAccounts,
  closeAccountInstruction,
  creationRentPayer,
  parseRawAccount,
  parseTokenAccounts,
  rawTokenAccountProblem,
  rentBandFor,
  recycleAgentRent,
  recycleQuietEnough,
  rentRecycleBudget,
  type TokenAccountSummary,
} from "./rent-recycle";
import { SOLANA_USDC_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./solana-transfer";

const PLATFORM = "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza";
const AGENT = "3XiU5e1cwsHB4V9tAeRvtsu4NSKN8pf5jW1t9aswohnY";
const STRANGER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const LEGACY = TOKEN_PROGRAM_ID.toBase58();
const T22 = TOKEN_2022_PROGRAM_ID.toBase58();

/** One `getTokenAccountsByOwner` jsonParsed row, shaped exactly like mainnet's (probed 2026-09-23). */
function row(input: {
  pubkey: string;
  program?: string;
  mint: string;
  amount?: string;
  owner?: string;
  state?: string;
  isNative?: boolean;
  closeAuthority?: string;
  withheld?: number;
  lamports?: number;
}) {
  const program = input.program ?? LEGACY;
  return {
    pubkey: input.pubkey,
    account: {
      lamports: input.lamports ?? 1_488_440,
      owner: program,
      executable: false,
      space: program === T22 ? 170 : 165,
      data: {
        program: program === T22 ? "spl-token-2022" : "spl-token",
        space: program === T22 ? 170 : 165,
        parsed: {
          type: "account",
          info: {
            isNative: input.isNative ?? false,
            mint: input.mint,
            owner: input.owner ?? AGENT,
            state: input.state ?? "initialized",
            tokenAmount: { amount: input.amount ?? "0", decimals: 6, uiAmount: 0, uiAmountString: "0" },
            ...(input.closeAuthority ? { closeAuthority: input.closeAuthority } : {}),
            extensions:
              input.withheld === undefined
                ? [{ extension: "immutableOwner" }]
                : [{ extension: "immutableOwner" }, { extension: "transferFeeAmount", state: { withheldAmount: input.withheld } }],
          },
        },
      },
    },
  };
}

const MEME = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WSOL = "So11111111111111111111111111111111111111112";

describe("parseTokenAccounts", () => {
  it("reads legacy and Token-2022 rows, including withheld transfer fees", () => {
    const parsed = parseTokenAccounts([
      row({ pubkey: "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw", program: T22, mint: MEME, lamports: 1_513_840 }),
      row({ pubkey: "BM7e3QSjPKFDtWAgBC4JBvsZ5BDtHBFw2G6Eq5bTbhTE", program: T22, mint: BONK, withheld: 12 }),
      { pubkey: "junk", account: { data: { parsed: { type: "mint", info: {} } } } },
      null,
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ programId: T22, mint: MEME, owner: AGENT, amount: "0", state: "initialized", lamports: 1_513_840, withheldAmount: "0" });
    expect(parsed[1]?.withheldAmount).toBe("12");
    expect(parseTokenAccounts(undefined)).toEqual([]);
  });
});

describe("closableTokenAccounts", () => {
  const accounts: TokenAccountSummary[] = parseTokenAccounts([
    row({ pubkey: "empty-legacy", mint: BONK, lamports: 1_488_440 }),
    row({ pubkey: "empty-t22", program: T22, mint: MEME, lamports: 1_574_800 }),
    row({ pubkey: "usdc", mint: SOLANA_USDC_MINT.toBase58() }),
    row({ pubkey: "holding", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", amount: "57200" }),
    row({ pubkey: "wsol", mint: WSOL, isNative: true }),
    row({ pubkey: "frozen", mint: "5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2", state: "frozen" }),
    row({ pubkey: "foreign-close", mint: "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", closeAuthority: STRANGER }),
    row({ pubkey: "withheld", program: T22, mint: "HgcxVs6kNJN6TfxfNWyKhZdxxY3Q4QxA3yYQ7gFx2zH1", withheld: 5 }),
    row({ pubkey: "someone-elses", mint: "CWZ6Bsdn1zQ6tEjpHG1wgBBAE8wXhPHNtFdNnJEB4Ebc", owner: STRANGER }),
    row({ pubkey: "held-in-book", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" }),
  ]);

  it("closes only empty, non-USDC, non-native accounts the agent alone can close, most rent first", () => {
    const closable = closableTokenAccounts(accounts, {
      owner: AGENT,
      heldMints: new Set(["2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv"]),
      max: 8,
    });
    expect(closable.map((a) => a.address)).toEqual(["empty-t22", "empty-legacy"]);
  });

  it("never closes the USDC account, whatever it holds", () => {
    const onlyUsdc = parseTokenAccounts([row({ pubkey: "usdc", mint: SOLANA_USDC_MINT.toBase58(), amount: "0" })]);
    expect(closableTokenAccounts(onlyUsdc, { owner: AGENT, max: 8 })).toEqual([]);
  });

  it("respects the per-call bound and the per-transaction ceiling", () => {
    expect(closableTokenAccounts(accounts, { owner: AGENT, max: 1 }).map((a) => a.address)).toEqual(["empty-t22"]);
    const many = parseTokenAccounts(
      Array.from({ length: 20 }, (_, i) => row({ pubkey: `acct-${i}`, mint: `${BONK.slice(0, 40)}${String(i).padStart(4, "0")}` })),
    );
    expect(closableTokenAccounts(many, { owner: AGENT, max: 50 })).toHaveLength(RENT_RECYCLE_MAX_ACCOUNTS_PER_TX);
    expect(closableTokenAccounts(many, { owner: AGENT, max: 0 })).toEqual([]);
  });
});

describe("the recycle transaction", () => {
  it("closes each account on its own token program, rent to the platform, authority the agent", () => {
    const ix = closeAccountInstruction({ account: "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw", destination: PLATFORM, authority: AGENT, programId: T22 });
    expect(ix.programId.toBase58()).toBe(T22);
    expect(Array.from(ix.data)).toEqual([9]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      ["A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw", false, true],
      [PLATFORM, false, true],
      [AGENT, true, false],
    ]);
  });

  it("is paid for by the platform, signed by two, and touches nothing but the listed accounts", () => {
    const legacyAccount = Keypair.generate().publicKey.toBase58();
    const bytes = buildRentRecycleTransaction({
      agent: AGENT,
      feePayer: PLATFORM,
      accounts: [
        { address: "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw", programId: T22 },
        { address: legacyAccount, programId: LEGACY },
      ],
      blockhash: BLOCKHASH,
    });
    const tx = VersionedTransaction.deserialize(bytes);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(PLATFORM);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(tx.message.addressTableLookups).toHaveLength(0);
    const instructions = tx.message.compiledInstructions;
    expect(instructions.map((ix) => keys[ix.programIdIndex])).toEqual([T22, LEGACY]);
    for (const ix of instructions) {
      expect(Array.from(ix.data)).toEqual([9]);
      expect(keys[ix.accountKeyIndexes[1]]).toBe(PLATFORM); // rent goes back to whoever paid it
      expect(keys[ix.accountKeyIndexes[2]]).toBe(AGENT);
    }
  });

  it("refuses the platform as the agent, nothing to close, too many, and non-token programs", () => {
    const one = [{ address: "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw", programId: T22 }];
    expect(() => buildRentRecycleTransaction({ agent: PLATFORM, feePayer: PLATFORM, accounts: one, blockhash: BLOCKHASH })).toThrow();
    expect(() => buildRentRecycleTransaction({ agent: AGENT, feePayer: PLATFORM, accounts: [], blockhash: BLOCKHASH })).toThrow();
    expect(() =>
      buildRentRecycleTransaction({ agent: AGENT, feePayer: PLATFORM, accounts: Array(9).fill(one[0]), blockhash: BLOCKHASH }),
    ).toThrow(/At most/);
    expect(() =>
      buildRentRecycleTransaction({ agent: AGENT, feePayer: PLATFORM, accounts: [{ ...one[0], programId: STRANGER }], blockhash: BLOCKHASH }),
    ).toThrow(/not a token account/);
  });

  it("budgets two signatures — the simulation shows the platform gaining the rent", () => {
    // Simulated against mainnet (2026-09-23): closing three empty accounts moved the
    // platform by +4,567,080 lamports (1,574,800 + 1,513,840 + 1,488,440 − 10,000).
    expect(rentRecycleBudget()).toBe(10_000);
  });
});

describe("creationRentPayer", () => {
  const ACCOUNT = "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw";
  const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const SYSTEM = "11111111111111111111111111111111";
  /** A `getTransaction` jsonParsed result, shaped like a sponsored Ultra buy: platform pays, account opened at the top level. */
  function tx(input: { payer: string; pre?: number; post?: number; err?: unknown; inner?: boolean; creator?: "ata" | "system" }) {
    const create =
      input.creator === "system"
        ? { program: "system", programId: SYSTEM, parsed: { type: "createAccount", info: { source: input.payer, newAccount: ACCOUNT, lamports: 1_513_840, space: 170, owner: T22 } } }
        : {
            program: "spl-associated-token-account",
            programId: ATA_PROGRAM,
            parsed: { type: "createIdempotent", info: { source: input.payer, account: ACCOUNT, wallet: AGENT, mint: MEME, systemProgram: SYSTEM, tokenProgram: T22 } },
          };
    return {
      meta: {
        err: input.err ?? null,
        preBalances: [50_000_000, 0, input.pre ?? 0, 1],
        postBalances: [48_322_369, 0, input.post ?? 1_513_840, 1],
        innerInstructions: input.inner ? [{ index: 1, instructions: [create] }] : [],
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: input.payer, signer: true, writable: true, source: "transaction" },
            { pubkey: AGENT, signer: true, writable: false, source: "transaction" },
            { pubkey: ACCOUNT, signer: false, writable: true, source: "lookupTable" },
            { pubkey: ATA_PROGRAM, signer: false, writable: false, source: "transaction" },
          ],
          instructions: input.inner ? [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", data: "x", accounts: [] }] : [create],
        },
      },
    };
  }

  it("names whoever the opening instruction says paid — top level, inner, or a System createAccount", () => {
    expect(creationRentPayer(tx({ payer: PLATFORM }), ACCOUNT)).toEqual({ created: true, payer: PLATFORM });
    expect(creationRentPayer(tx({ payer: STRANGER, inner: true }), ACCOUNT)).toEqual({ created: true, payer: STRANGER });
    expect(creationRentPayer(tx({ payer: AGENT, creator: "system" }), ACCOUNT)).toEqual({ created: true, payer: AGENT });
  });

  it("is not an opening when the account already held lamports, the transaction failed, or it is not in it", () => {
    expect(creationRentPayer(tx({ payer: PLATFORM, pre: 1_513_840 }), ACCOUNT).created).toBe(false);
    expect(creationRentPayer(tx({ payer: PLATFORM, err: { InstructionError: [1, "Custom"] } }), ACCOUNT).created).toBe(false);
    expect(creationRentPayer(tx({ payer: PLATFORM }), STRANGER).created).toBe(false);
    expect(creationRentPayer(null, ACCOUNT).created).toBe(false);
  });

  it("opened here but by no instruction it can read: created, payer unknown — so never recycled", () => {
    const opened = tx({ payer: PLATFORM });
    opened.transaction.message.instructions = [];
    expect(creationRentPayer(opened, ACCOUNT)).toEqual({ created: true, payer: null });
  });
});

describe("recycleQuietEnough", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("waits out a recent trade", () => {
    expect(recycleQuietEnough(null, now)).toBe(true);
    expect(recycleQuietEnough(new Date("2026-09-23T11:50:00Z"), now)).toBe(false);
    expect(recycleQuietEnough(new Date("2026-09-23T11:45:00Z"), now)).toBe(true);
  });
});

describe("recycleAgentRent", () => {
  it("never throws, and does nothing when asked to close nothing", async () => {
    await expect(recycleAgentRent("agent_x", { maxAccounts: 0 })).resolves.toMatchObject({ closed: 0, note: "asked to close nothing" });
  });
});

describe("the raw read before a close", () => {
  /** A token account's bytes, laid out exactly as the SPL token program stores one. */
  function bytes(input: {
    mint?: string;
    owner?: string;
    amount?: bigint;
    state?: number;
    isNative?: bigint | null;
    closeAuthority?: string | null;
    extensions?: boolean;
  }): Uint8Array {
    const d = new Uint8Array(input.extensions ? 170 : 165);
    const view = new DataView(d.buffer);
    d.set(new PublicKey(input.mint ?? MEME).toBytes(), 0);
    d.set(new PublicKey(input.owner ?? AGENT).toBytes(), 32);
    view.setBigUint64(64, input.amount ?? BigInt(0), true);
    d[108] = input.state ?? 1;
    if (input.isNative !== undefined && input.isNative !== null) {
      view.setUint32(109, 1, true);
      view.setBigUint64(113, input.isNative, true);
    }
    if (input.closeAuthority) {
      view.setUint32(129, 1, true);
      d.set(new PublicKey(input.closeAuthority).toBytes(), 133);
    }
    if (input.extensions) d[165] = 2; // Token-2022 AccountType::Account
    return d;
  }
  const ACCOUNT = "A6YnKpUo3MLiAA1NPt8sak8cUtNgjq7FEK6ncngGxozw";
  const RENT_165 = 1_488_440;
  const raw = (over: Partial<{ programId: string; lamports: number; data: Uint8Array }> = {}) => ({
    address: ACCOUNT,
    programId: LEGACY,
    lamports: RENT_165,
    data: bytes({}),
    ...over,
  });
  const expected = { mint: MEME, owner: AGENT, programId: LEGACY, rentMinimumLamports: RENT_165 };

  it("passes an empty account the agent owns, holding exactly its rent", () => {
    expect(rawTokenAccountProblem(raw(), expected)).toBeNull();
    expect(rawTokenAccountProblem(raw({ data: bytes({ closeAuthority: AGENT }) }), expected)).toBeNull();
    expect(
      rawTokenAccountProblem(raw({ programId: T22, lamports: 1_513_840, data: bytes({ extensions: true }) }), {
        ...expected,
        programId: T22,
        rentMinimumLamports: 1_513_840,
      }),
    ).toBeNull();
  });

  it("refuses a wrapped-SOL account the listing called something else — a close would sweep the agent's SOL", () => {
    // The listing said MEME, isNative false; the bytes say wrapped SOL.
    expect(rawTokenAccountProblem(raw({ data: bytes({ mint: WSOL }) }), expected)).toMatch(/wrapped-SOL/);
    expect(rawTokenAccountProblem(raw({ data: bytes({ isNative: BigInt(2_039_280) }), lamports: 52_039_280 }), expected)).toMatch(/native/);
  });

  it("refuses an account holding more lamports than its rent — whatever the listing says it is", () => {
    expect(rawTokenAccountProblem(raw({ lamports: RENT_165 + 1 }), expected)).toMatch(/more than its/);
  });

  it("refuses every disagreement with the listing, and anything that is not an empty, open, agent-closable account", () => {
    expect(rawTokenAccountProblem(raw({ data: bytes({ mint: BONK }) }), expected)).toMatch(/mint/);
    expect(rawTokenAccountProblem(raw({ data: bytes({ owner: STRANGER }) }), expected)).toMatch(/not the agent's/);
    expect(rawTokenAccountProblem(raw({ data: bytes({ amount: BigInt(1) }) }), expected)).toMatch(/holds tokens/);
    expect(rawTokenAccountProblem(raw({ data: bytes({ state: 2 }) }), expected)).toMatch(/unfrozen/);
    expect(rawTokenAccountProblem(raw({ data: bytes({ closeAuthority: STRANGER }) }), expected)).toMatch(/someone else/);
    expect(rawTokenAccountProblem(raw({ programId: T22 }), expected)).toMatch(/token program/);
    expect(rawTokenAccountProblem(raw({ programId: STRANGER }), { ...expected, programId: STRANGER })).toMatch(/token program/);
    expect(rawTokenAccountProblem(raw({ data: new Uint8Array(82) }), expected)).toMatch(/too short/);
    const mintLike = bytes({ extensions: true });
    mintLike[165] = 1;
    expect(rawTokenAccountProblem(raw({ programId: T22, data: mintLike }), { ...expected, programId: T22 })).toMatch(/not a token account/);
  });

  it("parses a getMultipleAccounts base64 value, and nothing else", () => {
    const data = bytes({});
    const parsed = parseRawAccount(ACCOUNT, { data: [Buffer.from(data).toString("base64"), "base64"], lamports: RENT_165, owner: LEGACY, executable: false });
    expect(parsed).toMatchObject({ address: ACCOUNT, programId: LEGACY, lamports: RENT_165 });
    expect(Array.from(parsed?.data ?? [])).toEqual(Array.from(data));
    expect(parseRawAccount(ACCOUNT, null)).toBeNull();
    expect(parseRawAccount(ACCOUNT, { data: ["", "base58"], lamports: 1, owner: LEGACY })).toBeNull();
  });

  it("trusts a live rent read only inside 4,000–6,960 lamports a byte", () => {
    expect(rentBandFor(165)).toEqual({ min: 1_172_000, max: 2_039_280 });
    const band = rentBandFor(170);
    expect(1_513_840).toBeGreaterThanOrEqual(band.min);
    expect(1_513_840).toBeLessThanOrEqual(band.max);
  });
});
