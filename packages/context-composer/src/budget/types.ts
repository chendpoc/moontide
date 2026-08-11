import type { Message, ToolSchema } from "@moontide/llm/protocol";
import type { ModelProfile } from "@moontide/llm/models";
import type { BudgetConfig } from "../ports/budget-config.js";

/** Context Budget Tiers. See docs/notes/context/context-backlog.md §3. */

export type BudgetTier = "pinned" | "dialogue" | "reference" | "reserved" | "flex";

export interface BudgetTierUsage {
  tier: BudgetTier;
  estimatedTokens: number;
  limitTokens: number;
  subAccounts?: Record<string, { estimatedTokens: number; limitTokens: number }>;
}

export interface BudgetPolicy {
  contextWindow: number;
  tiers: BudgetTierUsage[];
  /** L2 allocation cap (C − L4 − L1_cap − L3_cap [− L5]). */
  dialogueLimitTokens: number;
}

export interface ResolveBudgetPolicyInput {
  modelProfile: Pick<ModelProfile, "logicalModelId" | "contextWindow" | "maxOutputTokens" | "supportsThinking">;
  system?: string;
  tools?: ToolSchema[];
  messages?: Message[];
  /** L3 reference usage when known (default: estimate from messages). */
  referenceTokens?: number;
  /** System prompt without Working Set block (for L1 subAccounts). */
  systemBase?: string;
  /** Working Set snapshot text (Deep Task Mode). */
  workingSetSnapshot?: string;
  /** Context budget tier caps (injected by product layer). */
  budget?: BudgetConfig;
}
