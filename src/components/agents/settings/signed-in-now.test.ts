import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { signedInNow } from "./signed-in-now";

const KEY = ["session"] as const;
const SESSION = { userId: "did:privy:test", handle: "ada" };

type Answer = typeof SESSION | null | Error;

/**
 * A query client that already holds a session, as a settings page's does, over a server
 * that answers the next read with `next.answer`. An Error is a read that got no answer.
 */
async function signedIn() {
  const next: { answer: Answer; asked: number } = { answer: SESSION, asked: 0 };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await queryClient.fetchQuery({
    queryKey: KEY,
    queryFn: async () => {
      next.asked += 1;
      if (next.answer instanceof Error) throw next.answer;
      return next.answer;
    },
  });
  next.asked = 0;
  return { queryClient, next };
}

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("asking who is signed in before a page refreshes itself", () => {
  it("says yes when the server answers with the session", async () => {
    const { queryClient, next } = await signedIn();
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(true);
    expect(next.asked).toBe(1);
  });

  it("says no when the server answers that nobody is", async () => {
    const { queryClient, next } = await signedIn();
    next.answer = null;
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(false);
    expect(queryClient.getQueryData(KEY)).toBeNull();
  });

  /** The laptop lid: the tab is shown again before the network is back. */
  it("says no when the read gets no answer, though the session it held is still there", async () => {
    const { queryClient, next } = await signedIn();
    next.answer = new Error("Failed to fetch");
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(false);
    expect(next.asked).toBe(1);
    expect(queryClient.getQueryData(KEY)).toEqual(SESSION);
  });

  /** The browser knows it is offline: the read is held, not sent, and nothing fails. */
  it("says no when the browser is offline and the read was never sent", async () => {
    const { queryClient, next } = await signedIn();
    onlineManager.setOnline(false);
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(false);
    expect(next.asked).toBe(0);
    expect(queryClient.getQueryData(KEY)).toEqual(SESSION);
    await queryClient.cancelQueries({ queryKey: KEY });
  });

  it("says yes again once the server can be reached", async () => {
    const { queryClient, next } = await signedIn();
    next.answer = new Error("Failed to fetch");
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(false);
    next.answer = SESSION;
    await expect(signedInNow(queryClient, KEY)).resolves.toBe(true);
  });

  it("says no when the page holds no session to read again", async () => {
    await expect(signedInNow(new QueryClient(), KEY)).resolves.toBe(false);
  });
});
