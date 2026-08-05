import {
  contextBudgetFlexPct,
  contextBudgetFlexEnabled,
  contextBudgetL1,
  contextBudgetL3,
  contextBudgetL4,
  contextBudgetL5,
} from "../../../config.js";
import type { Message, ToolSchema } from "../../../llm/protocol/types.js";
import type { ModelProfile } from "../../../llm/models/types.js";
import { estimateTextTokens } from "../../../context-inspect/metrics.js";
import {
  DEFAULT_FLEX_PCT,
  DEFAULT_L1_CAP,
  DEFAULT_L3_CAP,
  THINKING_HEADROOM_DEFAULT,
} from "./defaults.js";
import { estimateDialogueTokens, estimatePinnedTokens, estimateReferenceTokens } from "./estimate.js";
import type { BudgetPolicy, BudgetTierUsage, ResolveBudgetPolicyInput } from "./types.js";

export function resolveL4Reserved(
  profile: Pick<ModelProfile, "maxOutputTokens" | "supportsThinking">,
  override?: number,
): number {
  if (override !== undefined) {
    return override;
  }
  const thinking = profile.supportsThinking ? THINKING_HEADROOM_DEFAULT : 0;
  return profile.maxOutputTokens + thinking;
}

function resolveFlexLimit(contextWindow: number, includeFlex: boolean): number {
  if (!includeFlex) {
    return 0;
  }
  const envCap = contextBudgetL5();
  if (envCap !== undefined) {
    return envCap;
  }
  const pct = contextBudgetFlexPct() ?? DEFAULT_FLEX_PCT;
  return Math.max(0, Math.floor((contextWindow * pct) / 100));
}

function tierUsage(
  tier: BudgetTierUsage["tier"],
  estimatedTokens: number,
  limitTokens: number,
): BudgetTierUsage {
  return { tier, estimatedTokens, limitTokens };
}

function resolveTierCaps(contextWindow: number, l1Override?: number, l3Override?: number) {
  const l1Default = l1Override ?? DEFAULT_L1_CAP;
  const l3Default = l3Override ?? DEFAULT_L3_CAP;
  if (contextWindow >= 128_000 || l1Override !== undefined || l3Override !== undefined) {
    return { l1Cap: l1Default, l3Cap: l3Default };
  }
  const scale = contextWindow / 128_000;
  return {
    l1Cap: Math.max(512, Math.floor(l1Default * scale)),
    l3Cap: Math.max(0, Math.floor(l3Default * scale)),
  };
}

/** Multi-ledger budget policy for compose / compaction. */
export function resolveBudgetPolicy(input: ResolveBudgetPolicyInput): BudgetPolicy {
  const contextWindow = input.modelProfile.contextWindow;
  const modelId = input.modelProfile.logicalModelId;

  const l4Limit = resolveL4Reserved(input.modelProfile, contextBudgetL4());
  const { l1Cap, l3Cap } = resolveTierCaps(
    contextWindow,
    contextBudgetL1(),
    contextBudgetL3(),
  );
  const l5Limit = resolveFlexLimit(contextWindow, input.includeFlex ?? contextBudgetFlexEnabled());

  const available = Math.max(0, contextWindow - l4Limit - l5Limit);
  const dialogueLimitTokens = Math.max(0, available - l1Cap - l3Cap);

  const system = input.system ?? "";
  const tools = input.tools ?? [];
  const messages = input.messages ?? [];

  const pinnedUsed =
    system.length > 0 || tools.length > 0
      ? estimatePinnedTokens(system, tools, modelId)
      : 0;
  const dialogueUsed = messages.length > 0 ? estimateDialogueTokens(messages, modelId) : 0;
  const referenceUsed =
    input.referenceTokens ??
    (messages.length > 0 ? estimateReferenceTokens(messages, modelId) : 0);

  let pinnedTier = tierUsage("pinned", pinnedUsed, l1Cap);
  const workingSet = input.workingSetSnapshot?.trim();
  if (workingSet) {
    const baseSystem = input.systemBase ?? system;
    const basePinned = estimatePinnedTokens(baseSystem, tools, modelId);
    const wsTokens = estimateTextTokens(workingSet);
    const wsLimit = Math.min(
      Math.floor(contextWindow * 0.1),
      Math.max(0, l1Cap - basePinned),
    );
    pinnedTier = {
      ...pinnedTier,
      subAccounts: {
        workingSet: { estimatedTokens: wsTokens, limitTokens: wsLimit },
      },
    };
  }

  const tiers: BudgetTierUsage[] = [
    tierUsage("reserved", 0, l4Limit),
    pinnedTier,
    tierUsage("reference", referenceUsed, l3Cap),
    tierUsage("dialogue", dialogueUsed, dialogueLimitTokens),
  ];

  if (l5Limit > 0) {
    tiers.push(tierUsage("flex", 0, l5Limit));
  }

  return {
    contextWindow,
    tiers,
    dialogueLimitTokens,
  };
}

export function findTierUsage(policy: BudgetPolicy, tier: BudgetTierUsage["tier"]): BudgetTierUsage {
  const found = policy.tiers.find((entry) => entry.tier === tier);
  if (!found) {
    return { tier, estimatedTokens: 0, limitTokens: 0 };
  }
  return found;
}

/** L2-scoped compact threshold (percent of dialogue allocation). */
export function isDialogueOverThreshold(
  policy: BudgetPolicy,
  dialogueTokens: number,
  thresholdPercent: number,
): boolean {
  if (policy.dialogueLimitTokens <= 0) {
    return false;
  }
  return (dialogueTokens / policy.dialogueLimitTokens) * 100 >= thresholdPercent;
}

export interface ShouldCompactDialogueInput {
  modelProfile: Pick<ModelProfile, "logicalModelId" | "contextWindow" | "maxOutputTokens" | "supportsThinking">;
  system: string;
  tools: ToolSchema[];
  messages: Message[];
  thresholdPercent: number;
}

/** Whether dialogue tier usage exceeds the compaction threshold (L2-scoped). */
export function shouldCompactDialogue(input: ShouldCompactDialogueInput): boolean {
  if (input.messages.length === 0) {
    return false;
  }
  const policy = resolveBudgetPolicy({
    modelProfile: input.modelProfile,
    system: input.system,
    tools: input.tools,
    messages: input.messages,
  });
  const dialogueTokens = findTierUsage(policy, "dialogue").estimatedTokens;
  return isDialogueOverThreshold(policy, dialogueTokens, input.thresholdPercent);
}

/** Sum L1+L2+L3 estimated usage (excludes L4/L5 reserved slack). */
export function sumInputTierTokens(policy: BudgetPolicy): number {
  return policy.tiers
    .filter((tier) => tier.tier === "pinned" || tier.tier === "dialogue" || tier.tier === "reference")
    .reduce((sum, tier) => sum + tier.estimatedTokens, 0);
}
