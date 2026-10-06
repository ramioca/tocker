/**
 * The route's access gate.
 *
 * This is the only thing standing between "every user's balances" and "anybody with the
 * URL", so it is tested at the route rather than only on the matcher: the matcher being
 * correct is useless if the page forgets to call it, and a page that renders its data
 * *before* awaiting the gate would pass a matcher test and leak anyway.
 *
 * The assertion is specifically a **404**, not a redirect and not a 403. A redirect tells
 * an anonymous visitor the route is real and worth returning to with credentials; a 403
 * says the same thing louder. `notFound()` is the only answer that leaks nothing.
 *
 * The queries are mocked so nothing here touches a database or Privy — the subject is the
 * gate, and a test that needed a seeded platform to prove a 404 would be testing the
 * wrong thing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/server/types";

const getSession = vi.fn<() => Promise<Session | null>>();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSession(),
  requireSession: () => getSession(),
}));

// Every read the page would do, stubbed empty: reaching any of these means the gate let
// somebody through, and `listAdminUsers` asserting it was never called says so plainly.
// The slot requests get the same assertion: they are the addresses of people who are not
// users yet, the one list here that is nobody's own account.
const listAdminUsers = vi.fn(async () => []);
const listAdminSlotRequests = vi.fn(async () => []);
vi.mock("@/server/queries/admin", () => ({
  getAdminBalances: vi.fn(async () => ({
    rows: [],
    fundedCount: 0,
    totalUsdc: 0,
    readAt: new Date(0).toISOString(),
    walletsOnRecord: 0,
    capped: false,
    privyConfigured: false,
  })),
  getAdminHeadline: vi.fn(async () => ({
    users: { total: 0, new7d: 0, new30d: 0 },
    agents: { total: 0, live: 0, paper: 0, active: 0, paused: 0, draft: 0, error: 0 },
    wallets: { agentServer: 0, userEmbedded: 0 },
    volume: {
      allTime: { notionalUsd: 0, count: 0, liveNotionalUsd: 0, liveCount: 0, paperNotionalUsd: 0, paperCount: 0 },
      d30: { notionalUsd: 0, count: 0, liveNotionalUsd: 0, liveCount: 0, paperNotionalUsd: 0, paperCount: 0 },
      d7: { notionalUsd: 0, count: 0, liveNotionalUsd: 0, liveCount: 0, paperNotionalUsd: 0, paperCount: 0 },
    },
    fees: { accruedUsd: 0, collectedUsd: 0 },
    dataSpend: { usd: 0, count: 0, simulatedCount: 0 },
    waitlistSignups: 0,
  })),
  getAdminSeries: vi.fn(async () => ({ signups: [], volumeUsd: [], feesUsd: [] })),
  listAdminUsers: () => listAdminUsers(),
  listAdminSlotRequests: () => listAdminSlotRequests(),
  listAdminAgents: vi.fn(async () => []),
  listAdminTrades: vi.fn(async () => []),
  listAdminAuditEvents: vi.fn(async () => []),
}));

vi.mock("@/lib/platform/wallets", () => ({ listPlatformWallets: vi.fn(async () => []) }));
vi.mock("@/components/settings/platform-card", () => ({ PlatformCard: () => null }));

const ADMIN: Session = {
  userId: "did:privy:admin",
  handle: "admin",
  displayName: null,
  avatarUrl: null,
  email: "admin@example.com",
};

/** `notFound()` throws a framework error carrying this digest. */
function isNotFound(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /settings/admin", () => {
  it("404s a signed-in user who is not on the admin list, without reading anything", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    getSession.mockResolvedValue({ ...ADMIN, userId: "did:privy:someone", email: "someone@example.com" });

    const { default: AdminSettingsPage } = await import("./page");
    await expect(AdminSettingsPage()).rejects.toSatisfy(isNotFound);
    expect(listAdminUsers).not.toHaveBeenCalled();
    expect(listAdminSlotRequests).not.toHaveBeenCalled();
  });

  it("404s an anonymous visitor rather than redirecting them to /login", async () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
    getSession.mockResolvedValue(null);

    const { default: AdminSettingsPage } = await import("./page");
    await expect(AdminSettingsPage()).rejects.toSatisfy(isNotFound);
    expect(listAdminSlotRequests).not.toHaveBeenCalled();
  });

  it("404s everyone, including the listed address, when ADMIN_EMAILS is unset", async () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    getSession.mockResolvedValue(ADMIN);

    const { default: AdminSettingsPage } = await import("./page");
    await expect(AdminSettingsPage()).rejects.toSatisfy(isNotFound);
  });

  it("renders for an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", " Admin@Example.COM ");
    getSession.mockResolvedValue(ADMIN);

    const { default: AdminSettingsPage } = await import("./page");
    const tree = await AdminSettingsPage();
    expect(tree).toBeTruthy();
    expect(listAdminUsers).toHaveBeenCalledTimes(1);
    expect(listAdminSlotRequests).toHaveBeenCalledTimes(1);
  });
});
