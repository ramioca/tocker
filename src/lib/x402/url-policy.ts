/**
 * Which URLs `paidFetch` may call — and therefore pay.
 *
 * The rule is narrow on purpose: `https`, the default port, no credentials, and a host
 * that belongs to a registry source. Every source builds its URL from its own constants
 * plus the model's *parameters*; none takes a host from the model. Checking it again
 * here, at the one place a payment can start, means a source added later cannot loosen
 * the rule by accident: `sources.test.ts` calls every source in mock mode, which runs
 * this check on the URL it really builds, and fails when the list and the registry drift.
 *
 * Pay-per-use thinking has its own, narrower rule ({@link checkInferenceUrl}): one exact
 * URL, not a host list. The gateway is deliberately absent from `PAID_HOSTS`. That list
 * is what the *platform* wallet may pay for data, and an inference request is paid by an
 * agent's own wallet through a different door.
 */
import { INFERENCE_GATEWAY, type InferenceChain } from "./inference-types";

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

/**
 * Pure: why this request may not be sent to the inference gateway, or `null` if it may.
 *
 * The whole strategy prompt travels in this request, before any payment and again with
 * it, so the destination is one exact URL per chain and nothing near it: no other path
 * on the same host, no query string, no fragment, no other port, no credentials. The
 * method is part of the rule because the gateway only sells `POST`.
 */
export function checkInferenceUrl(raw: string, method: string = "POST", chain: InferenceChain = "solana"): string | null {
  const gateway = INFERENCE_GATEWAY[chain];
  if (!gateway) return "this chain has no inference gateway";
  if (method.toUpperCase() !== "POST") return "only POST requests are sent to the inference gateway";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "the URL could not be read";
  }
  if (url.protocol !== "https:") return "only https URLs are paid for";
  if (url.username || url.password) return "URLs with credentials are not allowed";
  if (url.port !== "") return "only the default https port is allowed";
  if (url.hostname.toLowerCase() !== gateway.host) return "the host is not the inference gateway's";
  if (url.search !== "" || url.hash !== "") return "the inference URL takes no query string or fragment";
  // The parser has already resolved dot segments and lowercased the host, so comparing
  // what it produced is comparing where the request would really go.
  if (url.href !== gateway.url) return "the path is not the gateway's chat completions endpoint";
  return null;
}
