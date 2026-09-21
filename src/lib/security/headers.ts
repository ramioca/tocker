/**
 * Response security headers, including the Content-Security-Policy.
 *
 * Applied in `src/proxy.ts` to every request. Kept here as a pure function of
 * `{ nonce, isDev, isHttps }` so the policy can be unit-tested — a CSP that is
 * only ever observed in a browser is a CSP nobody dares tighten.
 *
 * WHAT EACH HEADER PROTECTS AGAINST
 *  - CSP                      — injected script executing with the operator's session.
 *  - frame-ancestors 'none'   — clickjacking: nobody can iframe Tocker and trick the
 *    operator into holding "go live" inside an invisible frame. (X-Frame-Options is
 *    sent too, for the browsers that still only understand that.)
 *  - HSTS                     — a downgrade to http, where the Privy token cookie is
 *    readable on the wire. Production only: sending it from localhost poisons the
 *    browser's HSTS store for `localhost` across every project on the machine.
 *  - nosniff                  — a JSON response being re-interpreted as HTML/JS.
 *  - Referrer-Policy          — leaking `/agents/<slug>` paths to third-party hosts.
 *  - Permissions-Policy       — silently acquiring camera/mic/geolocation/payment.
 *  - Cross-Origin-Opener-Policy — a popup keeping a handle on `window.opener`.
 *
 * WHY THE ALLOWLIST LOOKS LIKE THIS
 *  - Privy renders its auth flow and its wallet UIs in an iframe served from
 *    `auth.privy.io`, and its SDK calls `auth.privy.io` / `*.privy.io` directly,
 *    so those need `frame-src` and `connect-src`. Without them login silently
 *    does nothing, which is the worst possible failure mode for a CSP.
 *  - The landing shader is a WebGPU renderer that ships as a bundled chunk (it is
 *    NOT loaded from a CDN — verified: the `shaders` package has no runtime fetch),
 *    but it compiles WGSL and spawns workers, hence `wasm-unsafe-eval`, `worker-src
 *    blob:` and `blob:` in `script-src`.
 *  - `img-src` has to include `https:` because token logos and social avatars are
 *    arbitrary third-party URLs coming from Jupiter, DexScreener and Twitter. An
 *    image is not a script; this is the one directive worth keeping wide.
 *  - `style-src` keeps `'unsafe-inline'`: `motion` writes inline style attributes
 *    on every animated element, and a nonce cannot cover a style attribute.
 */

/** Hosts Privy's SDK and iframes talk to. */
const PRIVY_HOSTS = ["https://auth.privy.io", "https://*.privy.io", "https://*.privy.systems"];
/** WalletConnect, reachable from Privy's external-wallet connectors. */
const WALLET_HOSTS = [
  "https://explorer-api.walletconnect.com",
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "wss://relay.walletconnect.com",
];
/**
 * Solana RPC for Privy's embedded-wallet UIs (`solana.rpcs` in the provider). HTTP goes
 * through the same-origin `/api/solana/rpc` proxy, so only the websocket endpoint —
 * which serverless cannot proxy — and any explicitly configured public endpoints need
 * listing here.
 */
function solanaHosts(): string[] {
  const hosts = ["wss://api.mainnet-beta.solana.com", "https://api.mainnet-beta.solana.com"];
  for (const raw of [process.env.NEXT_PUBLIC_SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_WSS_URL]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      hosts.push(new URL(value).origin);
    } catch {
      // A malformed URL is a deploy mistake the health check reports; do not let it break the CSP.
    }
  }
  return hosts;
}

export interface CspOptions {
  /** Per-request nonce. Next.js reads it off the request CSP header and stamps its own scripts. */
  nonce: string;
  /** Dev needs 'unsafe-eval' — React uses eval to rebuild server stacks in the browser. */
  isDev: boolean;
}

/** Build the CSP header value. One directive per line here, one line on the wire. */
export function contentSecurityPolicy({ nonce, isDev }: CspOptions): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        // 'strict-dynamic' lets a nonced bootstrap load Next's own chunks without
        // enumerating them, and makes the host allowlist irrelevant for scripts.
        "'strict-dynamic'",
        "'wasm-unsafe-eval'",
        "blob:",
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    [
      "connect-src",
      ["'self'", ...PRIVY_HOSTS, ...WALLET_HOSTS, ...solanaHosts(), ...(isDev ? ["ws:", "http://localhost:*"] : [])],
    ],
    ["frame-src", ["'self'", ...PRIVY_HOSTS, "https://challenges.cloudflare.com"]],
    ["worker-src", ["'self'", "blob:"]],
    ["media-src", ["'self'", "data:", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  // Only meaningful over TLS, and it makes local http reloads fail if sent in dev.
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export interface SecurityHeaderOptions extends CspOptions {
  /** HSTS is sent only over a real TLS origin. */
  isHttps: boolean;
}

/**
 * Every security header, as plain entries. The caller decides whether to attach
 * them to a request (so Next can read the nonce) or a response.
 */
export function securityHeaders(options: SecurityHeaderOptions): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["content-security-policy", contentSecurityPolicy(options)],
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    // Deny the powerful features outright rather than leaving them at the default,
    // which is "allow for same-origin".
    [
      "permissions-policy",
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    ],
  // `allow-popups`, not `same-origin`: Privy's login modal opens Coinbase Smart Wallet and
  // Base Account in popups that must be able to message this window back; plain
  // `same-origin` severs that and both SDKs log an error on load.
    ["cross-origin-opener-policy", "same-origin-allow-popups"],
    ["x-dns-prefetch-control", "off"],
  ];

  if (options.isHttps && !options.isDev) {
    headers.push(["strict-transport-security", "max-age=63072000; includeSubDomains; preload"]);
  }

  return headers;
}

/** 16 random bytes, base64. Unpredictable per request, which is the whole point of a nonce. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
