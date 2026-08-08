import type { ModelProfile } from "@moontide/llm/models";
import type { ToolSchema } from "@moontide/llm/protocol";
import type { ManifestAlert, ContextManifest } from "./types.js";
import type { BudgetTierUsage } from "./budget/types.js";

export interface BuildContextManifestInput {
  sessionId: string;
  turn: number;
  modelProfile: ModelProfile;
  tools: ToolSchema[];
  sourceItemIds: string[];
  checkpointExcludedItemIds?: string[];
  compiledMessageItemIds: string[];
  compactionExcludedItemIds?: string[];
  activeCompactionSaveId?: string;
  resumeCheckpointId?: string;
  estimatedInputTokens?: number;
  alerts?: ManifestAlert[];
  budgetTiers?: BudgetTierUsage[];
  deepTask?: {
    active: true;
    workMemId: string;
    goal: string;
    thinkingBump?: boolean;
    synthesizeSkipped?: boolean;
  };
}

export function buildContextManifest(input: BuildContextManifestInput): ContextManifest {
  return {
    turn: input.turn,
    sessionId: input.sessionId,
    modelProfile: input.modelProfile,
    toolDefinitionNames: input.tools.map((tool) => tool.name),
    sourceItemIds: input.sourceItemIds,
    checkpointExcludedItemIds: input.checkpointExcludedItemIds,
    compiledMessageItemIds: input.compiledMessageItemIds,
    compactionExcludedItemIds: input.compactionExcludedItemIds,
    activeCompactionSaveId: input.activeCompactionSaveId,
    resumeCheckpointId: input.resumeCheckpointId,
    estimatedInputTokens: input.estimatedInputTokens,
    alerts: input.alerts,
    budgetTiers: input.budgetTiers,
    deepTask: input.deepTask,
  };
}
