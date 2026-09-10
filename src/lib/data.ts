/**
 * The mock switch.
 *
 * Server queries and actions live behind interfaces that FOUNDATION implements;
 * until those land they throw `not implemented: …`. Pages call the real query
 * through `withMock` so the UI can be built, reviewed and demoed today and
 * needs no edit at merge time — the mock simply stops being reached.
 *
 * Mock data is returned when either:
 *   - `MOCK_DATA=1` is set (forced, e.g. local design work), or
 *   - the real implementation throws an Error whose message contains
 *     "not implemented" (the pre-merge stubs).
 *
 * Any other error is re-thrown so real failures still surface as errors.
 */

function isNotImplemented(error: unknown): boolean {
  return error instanceof Error && error.message.includes("not implemented");
}

export async function withMock<T>(real: () => Promise<T>, mock: () => T): Promise<T> {
  if (process.env.MOCK_DATA === "1") return mock();
  try {
    return await real();
  } catch (error) {
    if (isNotImplemented(error)) return mock();
    throw error;
  }
}
