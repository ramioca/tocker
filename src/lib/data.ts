/**
 * Dev-time data switch.
 *
 * Server queries in `src/server/queries/*` throw `not implemented: foundation workstream`
 * until the foundation branch merges. `withMock` lets UI workstreams render real page
 * trees against realistic fixtures in the meantime, and silently flips to the real
 * query the moment it exists.
 *
 * NOTE: UI-CORE creates an identical file. The reviewer should keep one copy.
 */
export async function withMock<T>(real: () => Promise<T>, mock: () => T): Promise<T> {
  if (process.env.MOCK_DATA === "1") return mock();
  try {
    return await real();
  } catch (error) {
    if (error instanceof Error && error.message.includes("not implemented")) return mock();
    throw error;
  }
}
