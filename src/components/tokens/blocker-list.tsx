/**
 * Blockers and warnings arrive as machine codes (`top10_holders_72pct`). A code
 * is not an explanation, so this file is the translation layer: every known code
 * becomes a sentence a person can act on, and anything unknown degrades to a
 * readable phrase instead of a dead end.
 */
import { Ban, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { verdictTint } from "./verdict";

export interface BlockerCopy {
  /** The sentence. Always says what is true, not which rule fired. */
  title: string;
  /** Why it matters, when the title alone is not enough. */
  detail?: string;
}

/** Codes with no embedded number. */
const EXACT: Record<string, BlockerCopy> = {
  mint_authority_active: {
    title: "The mint authority is still live",
    detail: "Whoever deployed it can print more supply at any moment and sell it into your bid.",
  },
  freeze_authority_active: {
    title: "The freeze authority is still live",
    detail: "The deployer can freeze your account and stop you selling.",
  },
  can_take_back_ownership: {
    title: "Ownership can be reclaimed",
    detail: "The contract was renounced in a way that can be undone.",
  },
  hidden_owner: { title: "The contract has a hidden owner" },
  transfer_pausable: { title: "Transfers can be paused by the contract owner" },
  honeypot: {
    title: "You can buy it but you cannot sell it",
    detail: "The contract blocks sells. Every dollar in is a dollar gone.",
  },
  liquidity_below_floor: {
    title: "Liquidity is below your floor",
    detail: "There is not enough depth to get in and back out at a price worth having.",
  },
  liquidity_unlocked: { title: "The liquidity pool is not locked" },
  holders_below_floor: { title: "Fewer holders than your floor allows" },
  age_below_floor: {
    title: "Younger than your minimum age",
    detail: "Most snipe-and-dump rugs are over inside the first half hour.",
  },
  age_above_ceiling: { title: "Older than your maximum age" },
  blocklisted: { title: "On your blocklist", detail: "You told this agent never to touch it." },
  score_below_floor: { title: "Scores below your bar" },
  no_route: { title: "No route to trade it", detail: "No venue will quote a swap for this token." },
  chain_not_enabled: { title: "On a chain this agent does not trade" },
};

/** `<something>_<number>pct` codes, keyed by the part before the number. */
const PERCENT_PATTERNS: Array<{
  match: RegExp;
  copy: (pct: string) => BlockerCopy;
}> = [
  {
    match: /^top10_holders_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({
      title: `Top 10 wallets hold ${pct}% of supply`,
      detail: "A handful of wallets can end this token in one transaction.",
    }),
  },
  {
    match: /^dev_balance_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({
      title: `The deployer still holds ${pct}% of supply`,
    }),
  },
  {
    match: /^buy_tax_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Buying costs a ${pct}% tax` }),
  },
  {
    match: /^sell_tax_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Selling costs a ${pct}% tax` }),
  },
  {
    match: /^owner_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `The contract owner holds ${pct}% of supply` }),
  },
  {
    match: /^liquidity_drop_(\d+(?:\.\d+)?)pct$/,
    copy: (pct) => ({ title: `Liquidity fell ${pct}% in the last day` }),
  },
];

/** `<something>_<number><unit>` for age-shaped codes. */
const AGE_PATTERNS: Array<{ match: RegExp; copy: (n: string) => BlockerCopy }> = [
  { match: /^age_(\d+)m$/, copy: (n) => ({ title: `Only ${n} minutes old` }) },
  { match: /^age_(\d+)h$/, copy: (n) => ({ title: `Only ${n} hours old` }) },
  { match: /^holders_(\d+)$/, copy: (n) => ({ title: `Only ${n} holders` }) },
];

/** `low_organic_volume` → "Low organic volume". Never shows a raw code to a user. */
function humanise(code: string): string {
  const words = code.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (words.length === 0) return "Unknown check failed";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeBlocker(code: string): BlockerCopy {
  const key = code.trim().toLowerCase();
  const exact = EXACT[key];
  if (exact) return exact;

  for (const pattern of PERCENT_PATTERNS) {
    const found = key.match(pattern.match);
    if (found) return pattern.copy(found[1]);
  }
  for (const pattern of AGE_PATTERNS) {
    const found = key.match(pattern.match);
    if (found) return pattern.copy(found[1]);
  }

  return { title: humanise(key) };
}

const TONE = {
  blocker: {
    color: "oklch(0.7 0.16 45)",
    Icon: Ban,
    heading: "Hard gates it failed",
  },
  warning: {
    color: "oklch(0.72 0.145 75)",
    Icon: TriangleAlert,
    heading: "Worth knowing",
  },
} as const;

export function BlockerList({
  blockers = [],
  warnings = [],
  /** `compact` drops the headings and details — for a row, not a card. */
  compact = false,
  max,
  className,
}: {
  blockers?: readonly string[];
  warnings?: readonly string[];
  compact?: boolean;
  max?: number;
  className?: string;
}) {
  if (blockers.length === 0 && warnings.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {blockers.length > 0 ? (
        <Group tone="blocker" codes={blockers} compact={compact} max={max} />
      ) : null}
      {warnings.length > 0 ? (
        <Group tone="warning" codes={warnings} compact={compact} max={max} />
      ) : null}
    </div>
  );
}

function Group({
  tone,
  codes,
  compact,
  max,
}: {
  tone: keyof typeof TONE;
  codes: readonly string[];
  compact: boolean;
  max?: number;
}) {
  const { color, Icon, heading } = TONE[tone];
  const shown = max ? codes.slice(0, max) : codes;
  const hidden = codes.length - shown.length;

  return (
    <div>
      {compact ? null : (
        <p
          className="text-[11px] font-semibold tracking-wide uppercase"
          style={{ color }}
        >
          {heading}
        </p>
      )}
      <ul className={cn("space-y-1.5", compact ? "" : "mt-2")}>
        {shown.map((code) => {
          const copy = describeBlocker(code);
          return (
            <li
              key={code}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5"
              style={{ backgroundColor: verdictTint(color, 8) }}
            >
              <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
              <span className="min-w-0">
                <span className="block text-xs leading-relaxed font-medium text-foreground/90">
                  {copy.title}
                </span>
                {!compact && copy.detail ? (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {copy.detail}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        {hidden > 0 ? (
          <li className="tnum px-2 text-[11px] text-muted-foreground">
            and {hidden} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}
