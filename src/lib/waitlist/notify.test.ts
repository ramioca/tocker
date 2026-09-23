import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FROM_EMAIL, DEFAULT_NOTIFY_EMAIL, notifyWaitlistSignup, waitlistEmail } from "./notify";

const entry = {
  email: "desk@fund.xyz",
  volume: "$100k–1M",
  chains: ["Solana", "Base"],
  style: "Memecoins",
  at: "2026-09-23T12:00:00.000Z",
};

describe("notifyWaitlistSignup", () => {
  it("does nothing without an API key", async () => {
    const fetchImpl = vi.fn();
    const out = await notifyWaitlistSignup(entry, {}, fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ sent: false, reason: "no-key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts one email to Resend with the founder as recipient and the signup as reply-to", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const out = await notifyWaitlistSignup(
      entry,
      { RESEND_API_KEY: "re_test" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(out).toEqual({ sent: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual([DEFAULT_NOTIFY_EMAIL]);
    expect(body.from).toBe(DEFAULT_FROM_EMAIL);
    expect(body.reply_to).toBe("desk@fund.xyz");
    expect(body.subject).toBe("Waitlist: desk@fund.xyz · $100k–1M");
    expect(body.text).toContain("Chains:  Solana, Base");
  });

  it("honours the recipient and sender overrides", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await notifyWaitlistSignup(
      entry,
      {
        RESEND_API_KEY: "re_test",
        WAITLIST_NOTIFY_EMAIL: "ops@tocker.xyz",
        WAITLIST_FROM_EMAIL: "Tocker <waitlist@tocker.xyz>",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["ops@tocker.xyz"]);
    expect(body.from).toBe("Tocker <waitlist@tocker.xyz>");
  });

  it("reports, and never throws on, a rejected or failed request", async () => {
    const rejected = vi.fn(async () => new Response("bad from", { status: 422 }));
    await expect(
      notifyWaitlistSignup(entry, { RESEND_API_KEY: "re_test" }, rejected as unknown as typeof fetch),
    ).resolves.toEqual({ sent: false, reason: "http-422" });
    const failing = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(
      notifyWaitlistSignup(entry, { RESEND_API_KEY: "re_test" }, failing as unknown as typeof fetch),
    ).resolves.toEqual({ sent: false, reason: "network" });
  });

  it("escapes the signup's fields in the HTML body", () => {
    const { html, text } = waitlistEmail({ ...entry, style: "<b>x</b>", chains: [] });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(text).toContain("Chains:  —");
  });
});
