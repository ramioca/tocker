import { describe, expect, it } from "vitest";
import { REDACTED, dbErrorForLog, looksLikeSecret, redactDeep, redactSecrets, secretParts } from "./redact";

/**
 * Stand-ins for real credentials, put together at run time. Nothing key-shaped is
 * written out in this file: the repository is public and scanned for exactly that
 * (`repo-secrets.test.ts`, and GitHub's own push protection).
 */
const body = (length: number) => "Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV".repeat(8).slice(0, length);
const ANTHROPIC = `sk-ant-api03-${body(90)}`;
const OPENAI = `sk-proj-${body(120)}`;
const OPENROUTER = `sk-or-v1-${"0a1b2c3d".repeat(8)}`;
const NO_ENV = {};

describe("redactSecrets", () => {
  it("cuts a provider key out of a sentence and keeps the sentence", () => {
    for (const key of [ANTHROPIC, OPENAI, OPENROUTER]) {
      const shown = redactSecrets(`The provider refused ${key}. Check it.`, NO_ENV);
      expect(shown).toBe(`The provider refused ${REDACTED}. Check it.`);
    }
  });

  /** OpenAI's 401 prints the key it refused with the middle starred out. */
  it("cuts the half-masked key a provider echoes in its own refusal", () => {
    const masked = `sk-proj-${body(5)}${"*".repeat(40)}${body(4)}`;
    const shown = redactSecrets(`Incorrect API key provided: ${masked}. You can find your API key at the dashboard.`, NO_ENV);
    expect(shown).toBe(`Incorrect API key provided: ${REDACTED}. You can find your API key at the dashboard.`);
  });

  it("knows the other vendors' shapes", () => {
    const samples = [
      `AIza${body(35)}`,
      `gsk_${body(52)}`,
      `xai-${body(80)}`,
      `hf_${body(34)}`,
      `ghp_${body(36)}`,
      `github_pat_${body(60)}`,
      `xoxb-${"1234567890-".repeat(3)}${body(12)}`,
      `AKIA${"Q7ZK2M9XW4RT8YNB".slice(0, 16)}`,
      `sk_live_${body(24)}`,
      `eyJ${body(20)}.${body(40)}.${body(43)}`,
    ];
    for (const sample of samples) {
      expect(redactSecrets(`got ${sample} back`, NO_ENV), sample.slice(0, 8)).toBe(`got ${REDACTED} back`);
    }
  });

  it("cuts a private key block whole", () => {
    const pem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + `\n${body(64)}\n${body(64)}\n` + ["-----END", "PRIVATE KEY-----"].join(" ");
    expect(redactSecrets(`key:\n${pem}\ndone`, NO_ENV)).toBe(`key:\n${REDACTED}\ndone`);
  });

  it("cuts the value and keeps the name where a credential is told by its place", () => {
    const token = body(40);
    expect(redactSecrets(`Authorization: Bearer ${token}`, NO_ENV)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactSecrets(`x-api-key: ${token}`, NO_ENV)).toBe(`x-api-key: ${REDACTED}`);
    expect(redactSecrets(`{"apiKey":"${token}"}`, NO_ENV)).toBe(`{"apiKey":"${REDACTED}"}`);
    expect(redactSecrets(`fetch failed: https://rpc.example.com/?api-key=${token}&commitment=final`, NO_ENV)).toBe(
      `fetch failed: https://rpc.example.com/?api-key=${REDACTED}&commitment=final`,
    );
    expect(redactSecrets(`ECONNREFUSED postgres://app:${body(18)}@db.example.com:5432/app`, NO_ENV)).toBe(
      `ECONNREFUSED postgres://app:${REDACTED}@db.example.com:5432/app`,
    );
  });

  /** What the feed is made of must come through untouched. */
  it("leaves ordinary text, addresses, signatures and links alone", () => {
    const kept = [
      "Bought $40 of WIF: momentum held through the open and liquidity is deep.",
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      "0x4200000000000000000000000000000000000006",
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
      "0x9f8e7d6c5b4a39281706f5e4d3c2b1a0918273645546372819a0b1c2d3e4f506",
      "https://tocker.xyz/agents/sk-momentum-rotation-bot",
      "risk-adjusted-return-on-a-short-horizon-task-list",
      "Slippage 150 bps; token=WIF; key levels at 2.10 and 2.45.",
      "Missing bearer authentication in the Authorization header.",
      "authorization: insufficient_permissions_for_this_model",
    ];
    for (const text of kept) expect(redactSecrets(text, NO_ENV), text.slice(0, 24)).toBe(text);
  });

  it("returns what it was given when that is nothing", () => {
    expect(redactSecrets("", NO_ENV)).toBe("");
  });
});

describe("this deployment's own secrets", () => {
  const rpcKey = body(32);
  const env = {
    SOLANA_RPC_URL: `https://mainnet.node.example/?api-key=${rpcKey}`,
    BASE_RPC_URL: `https://base.node.example/v2/${body(28)}`,
    DATABASE_URL: `postgres://app:${body(20)}@db.example.com/app`,
    CRON_SECRET: body(44),
    JUPITER_API_KEY: "0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c",
    // Too short to be anything but a word: never hunted for.
    ENCRYPTION_KEY: "dev",
  };

  it("removes them wherever they turn up, in any spelling of the sentence", () => {
    const shown = redactSecrets(
      `HTTP request failed. URL: ${env.BASE_RPC_URL} Details: cron ${env.CRON_SECRET} jupiter ${env.JUPITER_API_KEY} rpc ${rpcKey}`,
      env,
    );
    expect(shown).toBe(
      `HTTP request failed. URL: https://base.node.example/v2/${REDACTED} Details: cron ${REDACTED} jupiter ${REDACTED} rpc ${REDACTED}`,
    );
  });

  it("keeps the host of a URL readable and takes only the secret parts", () => {
    expect(secretParts(env.SOLANA_RPC_URL)).toEqual([rpcKey]);
    expect(secretParts(env.BASE_RPC_URL)).toEqual([body(28)]);
    expect(secretParts(env.DATABASE_URL)).toEqual([body(20)]);
  });

  it("never hunts for a value short enough to be a word", () => {
    expect(secretParts("dev")).toEqual([]);
    expect(secretParts(undefined)).toEqual([]);
    expect(secretParts("postgres://postgres:postgres@localhost:5433/vibe")).toEqual([]);
    expect(secretParts("https://api.mainnet-beta.solana.com")).toEqual([]);
    expect(redactSecrets("the dev server and postgres are up", env)).toBe("the dev server and postgres are up");
  });
});

describe("redactDeep", () => {
  it("scrubs every string in a payload and leaves its shape and its other values", () => {
    const when = new Date(0);
    const scrubbed = redactDeep(
      { ok: false, tries: 3, error: `refused ${ANTHROPIC}`, nested: [{ note: `again ${OPENAI}`, at: when }, null, 7] },
      NO_ENV,
    );
    expect(scrubbed).toEqual({
      ok: false,
      tries: 3,
      error: `refused ${REDACTED}`,
      nested: [{ note: `again ${REDACTED}`, at: when }, null, 7],
    });
  });
});

describe("looksLikeSecret", () => {
  it("says yes to a credential, alone or inside a sentence", () => {
    for (const text of [ANTHROPIC, `my key is ${OPENAI} ok`, OPENROUTER, `Bearer ${body(30)}`]) {
      expect(looksLikeSecret(text), text.slice(0, 12)).toBe(true);
    }
  });

  it("says no to names, taglines and notes", () => {
    for (const text of ["Momentum Bot", "sk-momentum-rotation", "Buys strength, sells weakness.", "", null, undefined]) {
      expect(looksLikeSecret(text), String(text)).toBe(false);
    }
  });

  /** Asked twice of the same text it answers the same: the patterns keep no position. */
  it("answers the same every time", () => {
    expect(looksLikeSecret(ANTHROPIC)).toBe(true);
    expect(looksLikeSecret(ANTHROPIC)).toBe(true);
    expect(looksLikeSecret("plain")).toBe(false);
    expect(looksLikeSecret(ANTHROPIC)).toBe(true);
  });
});

describe("dbErrorForLog", () => {
  /** The shape drizzle throws: the statement, then every bound parameter. */
  function queryError(cause?: Error): Error {
    const err = new Error(`Failed query: insert into "llm_keys" values ($1, $2)\nparams: key_1,${body(120)}`);
    if (cause) (err as { cause?: unknown }).cause = cause;
    return err;
  }

  it("keeps the driver's reason and none of the parameters", () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "llm_keys_pkey"'), { code: "23505" });
    const line = dbErrorForLog(queryError(cause));
    expect(line).toBe('Error 23505: duplicate key value violates unique constraint "llm_keys_pkey"');
    expect(line).not.toContain(body(40));
  });

  it("says only that the query failed when there is nothing else to say", () => {
    const line = dbErrorForLog(queryError());
    expect(line).toBe("Error: query failed");
    expect(line).not.toContain("params");
  });

  it("scrubs a connection string out of whatever else was thrown", () => {
    expect(dbErrorForLog(new Error(`connect ECONNREFUSED postgres://app:${body(18)}@db.example.com/app`))).toBe(
      `Error: connect ECONNREFUSED postgres://app:${REDACTED}@db.example.com/app`,
    );
    expect(dbErrorForLog("boom")).toBe("boom");
  });
});
