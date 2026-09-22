/**
 * The view-model types the security screens render.
 *
 * They live in their own module, with no imports at all, because every other file
 * in `src/lib/security/` is `server-only` — it reads the database, or Privy, or
 * `process.env`. A client component that needs one of these shapes must not have
 * even a type-level edge to a module that can reach a secret: `import type` is
 * erased by TypeScript, but relying on that erasure means one refactor from `type`
 * to a value import silently pulls a server module into a browser bundle.
 *
 * The server modules re-export everything here, so importing the type from either
 * place is correct on the server; only client components have to come here.
 */

// ---------------------------------------------------------------------- MFA

export type MfaMethod = "sms" | "totp" | "passkey" | "email";

export interface MfaStatus {
  /** Whether we could reach Privy at all. */
  available: boolean;
  /** MFA methods the Privy app has turned on in the dashboard. */
  appMethods: MfaMethod[];
  /** Methods this user has actually enrolled. */
  userMethods: MfaMethod[];
  enrolled: boolean;
  /**
   * Set when enrolment is impossible or unverifiable. The UI prints this verbatim
   * rather than showing a dead "Enrol" button.
   */
  blockedReason: string | null;
}

// ----------------------------------------------------------------- LLM keys

export interface LlmKeyDetail {
  id: string;
  provider: "anthropic" | "openai" | "openrouter";
  label: string | null;
  /** Last four characters only. Never more, on any surface. */
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  agentCount: number;
}

// ------------------------------------------------------------ live readiness

export type StepState = "pass" | "warn" | "fail";

export type ReadinessStepId =
  | "database"
  | "privy"
  | "mfa"
  | "wallets"
  | "funding"
  /** Can anything here pay a Solana network fee? Added in W7; see `./live-readiness.ts`. */
  | "gas"
  | "budget"
  | "risk"
  | "data"
  | "killswitch";

export interface ReadinessStep {
  id: ReadinessStepId;
  title: string;
  state: StepState;
  /** What is true right now, in one sentence. */
  detail: string;
  /** Where to go to fix it. `null` when there is nothing to fix. */
  fix: { label: string; href: string } | null;
  /** Waiting on the chain, not on the operator — the checklist re-checks itself while this is set. */
  pending?: boolean;
}

export interface LiveReadiness {
  agentId: string;
  slug: string;
  steps: ReadinessStep[];
  /** True when nothing is `fail`. Warnings do not block. */
  ready: boolean;
  /** Minimum USDC we insist on before a first live trade. */
  minUsdc: number;
  /** What the operator's caps currently are, for the confirmation copy. */
  caps: { maxTradeUsd: number; maxDailyTrades: number; chains: Array<"solana" | "base"> };
  checkedAt: string;
}

// ------------------------------------------------------------------- audit

export type AuditKind =
  | "withdraw"
  | "budget_change"
  | "go_live"
  | "go_paper"
  | "agent_paused"
  | "agent_resumed"
  | "llm_key_added"
  | "llm_key_rotated"
  | "llm_key_removed"
  | "kill_switch_on"
  | "kill_switch_off"
  | "mfa_enrolled"
  | "mfa_unenrolled"
  | "first_trade_preset"
  | "manual_run";

export interface AuditRow {
  id: string;
  kind: AuditKind;
  summary: string;
  agentId: string | null;
  agentName: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// -------------------------------------------------------------- kill switch

export interface KillSwitchState {
  paused: boolean;
  pausedAt: string | null;
}
