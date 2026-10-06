import { describe, expect, it } from "vitest";
import { readSession, type SessionResponse } from "./session-fetch";

const SESSION = { userId: "did:privy:test", handle: "ada" };

function response(status: number, body: unknown = { error: "unauthenticated" }): SessionResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/** An `/api/me` that answers with each response in turn, and counts how often it was asked. */
function server(...answers: SessionResponse[]) {
  const state = { asked: 0 };
  const ask = async () => {
    const answer = answers[Math.min(state.asked, answers.length - 1)];
    state.asked += 1;
    return answer;
  };
  return { state, ask };
}

/** An auth client that hands back `token`, and counts how often it was asked to renew. */
function authClient(token: string | null) {
  const state = { renewed: 0 };
  const renew = async () => {
    state.renewed += 1;
    return token;
  };
  return { state, renew };
}

describe("readSession", () => {
  it("returns the session and renews nothing when the server recognises the browser", async () => {
    const api = server(response(200, SESSION));
    const auth = authClient("token");
    await expect(readSession(api.ask, auth.renew)).resolves.toEqual(SESSION);
    expect(api.state.asked).toBe(1);
    expect(auth.state.renewed).toBe(0);
  });

  /** The tab left open for an hour: the cookie ran out, the auth client can still renew it. */
  it("renews and reads once more when a signed-in browser gets a 401", async () => {
    const api = server(response(401), response(200, SESSION));
    const auth = authClient("renewed-token");
    await expect(readSession(api.ask, auth.renew)).resolves.toEqual(SESSION);
    expect(api.state.asked).toBe(2);
    expect(auth.state.renewed).toBe(1);
  });

  /** A signed-out visitor has no token, so there is no second request. */
  it("is signed out, after one request, when there is no token to renew", async () => {
    const api = server(response(401));
    const auth = authClient(null);
    await expect(readSession(api.ask, auth.renew)).resolves.toBeNull();
    expect(api.state.asked).toBe(1);
    expect(auth.state.renewed).toBe(1);
  });

  /** One retry, not a loop: a token the server still refuses is a real no. */
  it("stops after the second 401", async () => {
    const api = server(response(401), response(401), response(200, SESSION));
    const auth = authClient("token-the-server-refuses");
    await expect(readSession(api.ask, auth.renew)).resolves.toBeNull();
    expect(api.state.asked).toBe(2);
    expect(auth.state.renewed).toBe(1);
  });

  it("does not try to renew where there is no auth client", async () => {
    const api = server(response(401));
    await expect(readSession(api.ask, null)).resolves.toBeNull();
    expect(api.state.asked).toBe(1);
  });

  /** A rate limit or a server error is not "signed out", and must not be reported as it. */
  it("throws on a failure that is not a 401, without renewing", async () => {
    const auth = authClient("token");
    await expect(readSession(server(response(429)).ask, auth.renew)).rejects.toThrow("/api/me failed: 429");
    await expect(readSession(server(response(500)).ask, auth.renew)).rejects.toThrow("/api/me failed: 500");
    expect(auth.state.renewed).toBe(0);
  });

  it("throws when the read after a renewal fails for another reason", async () => {
    const api = server(response(401), response(503));
    await expect(readSession(api.ask, authClient("token").renew)).rejects.toThrow("/api/me failed: 503");
    expect(api.state.asked).toBe(2);
  });
});
