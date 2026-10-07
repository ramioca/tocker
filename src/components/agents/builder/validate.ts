import { agentConfigSchema } from "@/lib/agent/config";
import { PROVIDER_LABELS } from "@/lib/agent/models";
import { checkUsdc, shownSource } from "@/components/agents/thinking";
import type { LlmKeyRow } from "@/server/types";
import type { BuilderDraft } from "./types";

/**
 * What stops a draft from being created, keyed by the field or card the message belongs
 * to. Pure, so every rule that decides whether an agent may be made is tested without a
 * browser (`validate.test.ts`).
 *
 * How the agent thinks decides what it needs. On the owner's key it needs a key, of the
 * provider its model runs on. Paying per use it needs none, and instead a model that is
 * offered, limits inside their ranges and above what the schedule is expected to cost,
 * and a Solana wallet to pay from. A viewer who may not use pay-per-use is always
 * checked as a key draft (`shownSource`), which is also all the form shows them.
 */
export function validateDraft(
  draft: BuilderDraft,
  keys: ReadonlyArray<Pick<LlmKeyRow, "id" | "provider">>,
  options: { payPerUseAllowed?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (draft.name.trim().length < 2) errors.name = "Give it a name — at least two characters.";

  if (shownSource(draft.config, options.payPerUseAllowed === true) === "usdc") {
    const check = checkUsdc({
      usdc: draft.config.llm.usdc,
      intervalMinutes: draft.config.schedule.intervalMinutes,
      chains: draft.config.chains,
    });
    const thinking = check.errors.model ?? check.errors.maxUsdPerRun ?? check.errors.maxUsdPerDay;
    if (thinking) errors.thinking = thinking;
    // The fix for a missing Solana wallet is the chain picker, so the message goes there
    // (and opens that card), as well as showing in the pay-per-use panel.
    if (check.errors.chains) errors.chains = check.errors.chains;
  } else if (!draft.llmKeyId) {
    errors.llmKeyId = "Pick or add an API key. The agent cannot think without one.";
  }
  // A restored draft can name a key that has since been removed, and a key for another
  // provider would be kept but could never be used: both fail every run, so neither passes.
  else if (!keys.some((key) => key.id === draft.llmKeyId && key.provider === draft.config.llm.provider)) {
    errors.llmKeyId = `Pick one of your ${PROVIDER_LABELS[draft.config.llm.provider]} keys, or add one.`;
  }

  const parsed = agentConfigSchema.safeParse(draft.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "strategyPrompt") errors.strategyPrompt = issue.message;
      else if (key === "chains") errors.chains = issue.message;
      else if (typeof key === "string") errors[key] = issue.message;
    }
  }

  return errors;
}
