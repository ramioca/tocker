import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Ask the server who is signed in, now, and say whether it answered with somebody.
 *
 * This is what a page asks before it refreshes itself unprompted. A refresh that gets no
 * answer is not dropped: the router loads the whole page again in its place, and one sent
 * on a cookie that has run out comes back as the sign-in page. Either takes the page down
 * with everything typed into it. Reading the session first settles both: the read renews
 * a cookie that ran out while the tab was away (`src/hooks/session-fetch.ts`), and it
 * only succeeds when the server can be reached.
 *
 * True only for an answer this question got. The session the page already held proves
 * nothing: a read that failed leaves it in place, and with the browser offline the read
 * is not sent at all, only held until the connection is back. So it is the count of
 * answers that is compared, not the session.
 *
 * `sessionKey` is the session query (`SESSION_QUERY_KEY`), which this reads through so
 * every other reader of the session sees the same answer.
 */
export async function signedInNow(queryClient: QueryClient, sessionKey: QueryKey): Promise<boolean> {
  const before = queryClient.getQueryState(sessionKey)?.dataUpdateCount ?? 0;
  await queryClient.refetchQueries({ queryKey: sessionKey, exact: true });
  const read = queryClient.getQueryState(sessionKey);
  return read !== undefined && read.dataUpdateCount > before && read.data != null;
}
