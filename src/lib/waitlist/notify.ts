/**
 * Waitlist signup notifications over Resend.
 *
 * One email per signup to the founder's inbox, sent with a plain `fetch` to
 * Resend's REST API (no SDK to install or keep current). Configured entirely
 * from the environment:
 *
 *   RESEND_API_KEY         required; without it nothing is sent and a log line
 *                          says so, so a missing key never blocks a signup.
 *   WAITLIST_NOTIFY_EMAIL  where signups go; defaults to rami.djeb@gmail.com.
 *   WAITLIST_FROM_EMAIL    the sender. Defaults to Resend's onboarding sender,
 *                          which works without a verified domain but only
 *                          delivers to the Resend account owner; set a
 *                          `Tocker <waitlist@tocker.xyz>` address once the
 *                          domain is verified in Resend.
 *
 * Never throws: the caller runs this after the response with `after()`, and a
 * notification failure is logged, not surfaced.
 */
export interface WaitlistEntry {
  email: string;
  volume: string;
  chains: string[];
  style: string | null;
  at: string;
}

export const DEFAULT_NOTIFY_EMAIL = "rami.djeb@gmail.com";
export const DEFAULT_FROM_EMAIL = "Tocker <onboarding@resend.dev>";
const RESEND_URL = "https://api.resend.com/emails";

export function waitlistEmail(entry: WaitlistEntry): { subject: string; text: string; html: string } {
  const chains = entry.chains.length > 0 ? entry.chains.join(", ") : "—";
  const style = entry.style ?? "—";
  const subject = `Waitlist: ${entry.email} · ${entry.volume}`;
  const text = [
    `New waitlist signup`,
    ``,
    `Email:   ${entry.email}`,
    `Volume:  ${entry.volume}`,
    `Chains:  ${chains}`,
    `Mostly:  ${style}`,
    `At:      ${entry.at}`,
  ].join("\n");
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#6b6b70;font:12px/1.4 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em">${k}</td><td style="padding:6px 0;font:15px/1.4 -apple-system,Segoe UI,sans-serif;color:#17151d">${escapeHtml(v)}</td></tr>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#17151d"><p style="font-size:15px;margin:0 0 14px">New waitlist signup</p><table style="border-collapse:collapse">${row("Email", entry.email)}${row("Volume", entry.volume)}${row("Chains", chains)}${row("Mostly", style)}${row("At", entry.at)}</table></div>`;
  return { subject, text, html };
}

export async function notifyWaitlistSignup(
  entry: WaitlistEntry,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: boolean; reason?: string }> {
  const key = env.RESEND_API_KEY;
  if (!key) {
    console.log("[waitlist] RESEND_API_KEY unset; signup not emailed");
    return { sent: false, reason: "no-key" };
  }
  const to = env.WAITLIST_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
  const from = env.WAITLIST_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  const { subject, text, html } = waitlistEmail(entry);
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: entry.email, subject, text, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[waitlist] Resend answered ${res.status}: ${detail.slice(0, 200)}`);
      return { sent: false, reason: `http-${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[waitlist] Resend request failed:", err instanceof Error ? err.message : err);
    return { sent: false, reason: "network" };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
