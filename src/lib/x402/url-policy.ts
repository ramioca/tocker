/**
 * Which URLs `paidFetch` may call — and therefore pay.
 *
 * The rule is narrow on purpose: `https`, the default port, no credentials, and a host
 * that belongs to a registry source. Every source builds its URL from its own constants
 * plus the model's *parameters*; none takes a host from the model. Checking it again
 * here, at the one place a payment can start, means a source added later cannot loosen
 * the rule by accident: `sources.test.ts` calls every source in mock mode, which runs
 * this check on the URL it really builds, and fails when the list and the registry drift.
 */
export const PAID_HOSTS: readonly string[] = [
  "agentdata-api.com",
  "api.deepnets.ai",
  "api.dripmetrics.ai",
  "api.getplexa.com",
  "api.nansen.ai",
  "api.solenrich.com",
  "gate402.app",
  "pro-api.coinmarketcap.com",
  "sentimentalpha.ai",
  "twitter.use.x402atlas.com",
  "x402.ottoai.services",
];

/** Pure: why this URL may not be called, or `null` if it may. */
export function checkPaidUrl(raw: string, allowedHosts: readonly string[] = PAID_HOSTS): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "the URL could not be read";
  }
  if (url.protocol !== "https:") return "only https URLs are paid for";
  if (url.username || url.password) return "URLs with credentials are not allowed";
  if (url.port !== "") return "only the default https port is allowed";
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host)) return `${host} is not a registry source's host`;
  return null;
}
