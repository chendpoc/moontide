import type { ModelProfile } from "../../llm/models/types.js";
import type { ToolSchema } from "../../llm/protocol/types.js";
import type { ContextAlert, ContextManifest } from "./types.js";

export interface BuildContextManifestInput {
  sessionId: string;
  turn: number;
  modelProfile: ModelProfile;
  tools: ToolSchema[];
  includedItemIds: string[];
  excludedItemIds?: string[];
  activeCompactionSaveId?: string;
  resumeCheckpointId?: string;
  estimatedInputTokens?: number;
  alerts?: ContextAlert[];
}

export function buildContextManifest(input: BuildContextManifestInput): ContextManifest {
  return {
    turn: input.turn,
    sessionId: input.sessionId,
    modelProfile: input.modelProfile,
    toolDefinitionNames: input.tools.map((tool) => tool.name),
    includedItemIds: input.includedItemIds,
    excludedItemIds: input.excludedItemIds,
    activeCompactionSaveId: input.activeCompactionSaveId,
    resumeCheckpointId: input.resumeCheckpointId,
    estimatedInputTokens: input.estimatedInputTokens,
    alerts: input.alerts,
  };
}
