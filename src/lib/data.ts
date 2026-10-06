/**
 * The mock switch.
 *
 * Server queries and actions live behind interfaces that FOUNDATION implements;
 * until those land they throw `not implemented: …`. Pages call the real query
 * through `withMock` so the UI can be built, reviewed and demoed today and
 * needs no edit at merge time — the mock simply stops being reached.
 *
 * Mock data is returned, outside production only, when either:
 *   - `MOCK_DATA=1` is set (forced, e.g. local design work), or
 *   - the real implementation throws an Error whose message contains
 *     "not implemented" (the pre-merge stubs).
 *
 * Any other error is re-thrown so real failures still surface as errors.
 *
 * A production build never answers with a mock. The mocks include a signed-in session
 * and write bridges that report an invented success, so `MOCK_DATA=1` set by mistake on
 * the live project would make every visitor the mock user and every button a liar.
 * `/api/health` tells the operator when the variable is set and counts it against live
 * readiness, so the mistake is seen rather than silently ignored.
 */

function isNotImplemented(error: unknown): boolean {
  return error instanceof Error && error.message.includes("not implemented");
}

/** `MOCK_DATA=1` is set. Says nothing about whether it is honoured: the health report's question. */
export function mockDataRequested(): boolean {
  return process.env.MOCK_DATA === "1";
}

/** Mock data is forced: `MOCK_DATA=1`, and this is not a production build. */
export function mockDataForced(): boolean {
  return mockDataRequested() && process.env.NODE_ENV !== "production";
}

export async function withMock<T>(real: () => Promise<T>, mock: () => T): Promise<T> {
  if (mockDataForced()) return mock();
  try {
    return await real();
  } catch (error) {
    // Production never answers with a mock, on this path either: no stub is left to
    // throw this, so there it could only be a real failure whose text happens to match.
    if (isNotImplemented(error) && process.env.NODE_ENV !== "production") return mock();
    throw error;
  }
}
