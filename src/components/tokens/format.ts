/** Display helpers the score surfaces share. Never used for money math. */

/** "18m", "3h", "2d", "14mo". Honest about precision: minutes only under an hour. */
export function formatAge(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}d`;
  const months = days / 30.44;
  if (months < 24) return `${Math.round(months)}mo`;
  return `${(months / 12).toFixed(1)}y`;
}

/** "$1.2M", "$96K", "$3.2K". Liquidity spans three orders of magnitude, so compact always. */
export function formatCompactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  if (abs >= 1) return `$${value.toFixed(0)}`;
  return `$${value.toPrecision(2)}`;
}

/** "812K", "1,260", "47". */
export function formatHolders(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("en-US");
}

/** Minutes as something a person says out loud: "30 minutes", "6 hours", "2 days". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "no minimum";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 1_440) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
  }
  const days = minutes / 1_440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? "" : "s"}`;
}

/** Hours as something a person says out loud: "6 hours", "3 days", "1 month". */
export function formatHours(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)} month${Math.round(months) === 1 ? "" : "s"}`;
  return `${Math.round(months / 12)} year${Math.round(months / 12) === 1 ? "" : "s"}`;
}

/** Provider ids as their makers write them: "RugCheck", not "rugcheck". */
export const PROVIDER_LABEL: Record<string, string> = {
  jupiter: "Jupiter",
  rugcheck: "RugCheck",
  dexscreener: "DexScreener",
  goplus: "GoPlus",
  geckoterminal: "GeckoTerminal",
};

/** A score source for display. Anything unlisted (a paid source's own name) passes through. */
export const providerLabel = (id: string): string => PROVIDER_LABEL[id] ?? id;
