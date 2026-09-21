/**
 * Token art lives on IPFS more often than not, and the public gateways the registries
 * hand out are the ones that refuse hot-linked images: `ipfs.io` answers 403 and
 * `dweb.link` 429 for a pump.fun token's logo, while pump.fun's own Pinata gateway
 * serves it in half a second and Pinata's public gateway in six (probed 2026-09-21).
 * So an IPFS logo is tried through those gateways in that order, and the URL the
 * registry gave us last.
 */

const IPFS_GATEWAYS = ["https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/"] as const;

/** The `<cid>[/path]` behind an IPFS URL in any of its common spellings, or null. */
export function ipfsPath(url: string): string | null {
  const m =
    /^ipfs:\/\/(?:ipfs\/)?(.+)$/i.exec(url) ??
    /^https?:\/\/[^/]+\/ipfs\/(.+)$/i.exec(url) ??
    /^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+\/?(.*)$/i.exec(url);
  if (!m) return null;
  const path = m[2] !== undefined && m[0].includes(".ipfs.") ? `${m[1]}${m[2] ? `/${m[2]}` : ""}` : m[1];
  return path.replace(/^\/+/, "") || null;
}

/** The URLs to try for a logo, best first. Always at least the original. */
export function logoCandidates(url: string): string[] {
  const path = ipfsPath(url);
  if (path === null) return [url];
  const viaGateways = IPFS_GATEWAYS.map((gateway) => `${gateway}${path}`);
  return [...viaGateways, ...(viaGateways.includes(url) ? [] : [url])];
}
