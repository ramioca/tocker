/**
 * "Chrome on Linux" from a raw user-agent string, for the audit log.
 *
 * The raw string answers nothing at a glance — every row began "Mozilla/5.0 (X11; …"
 * and was cut off before the part that differs. The question someone reading an audit
 * trail is asking is "was that me?", and browser plus device answers it. The full
 * string stays on the row as a tooltip for anyone who needs the version.
 *
 * Order matters: every Chromium browser also says "Chrome" and "Safari", and every
 * iOS browser is WebKit, so the specific names are tested before the generic ones.
 */

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/Chrome\/|\bCriOS\//, "Chrome"],
  [/\bVersion\/[\d.]+.*Safari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMacintosh\b|\bMac OS X\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

function first(table: Array<[RegExp, string]>, ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name;
  return null;
}

export function describeUserAgent(ua: string): string {
  const browser = first(BROWSERS, ua);
  if (!browser) return "Unknown browser";
  const system = first(SYSTEMS, ua);
  return system ? `${browser} on ${system}` : browser;
}
