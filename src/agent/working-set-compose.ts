import { estimateContextTokens } from "../context/composer/compaction/apply-prune.js";
import type { CompactionPolicy } from "../context/composer/compaction/policy.js";
import { buildSystemFromInstructionState } from "../context/composer/system/build-system.js";
import type { InstructionState } from "../context/composer/system/types.js";
import { appendWorkingSetToSystem } from "../context/composer/working-set.js";
import type { ModelProfile } from "../llm/models/types.js";
import type { ToolSchema } from "../llm/protocol/types.js";
import { messagesFromContext } from "../session/transform/messages-from-context.js";
import type { SessionMessage } from "../session/types.js";

import type {
  ResolvedWorkingSetPort,
  WorkMemEscalationStagePort,
} from "./ports/work-mem.js";
import { getWorkMemAgentPorts } from "./ports/work-mem.js";

const STAGE_ORDER: WorkMemEscalationStagePort[] = [
  "normal",
  "refined_at_normal",
  "cap_upgraded",
  "emergency",
];

function stageRank(stage: WorkMemEscalationStagePort): number {
  return STAGE_ORDER.indexOf(stage);
}

function compactionThresholdExceeded(
  messages: readonly SessionMessage[],
  system: string,
  tools: ToolSchema[],
  modelId: string,
  modelProfile: ModelProfile,
  policy: CompactionPolicy,
  activeCompactionSaveId?: string,
): boolean {
  if (!policy.autoEnabled || activeCompactionSaveId || messages.length === 0) {
    return false;
  }
  if (modelProfile.contextWindow <= 0) {
    return false;
  }
  const protocolMessages = messagesFromContext({ messages });
  const tokens = estimateContextTokens(protocolMessages, system, tools, modelId);
  const percentUsed = (tokens / modelProfile.contextWindow) * 100;
  return percentUsed >= policy.thresholdPercent;
}

export interface ResolveWorkingSetForComposeInput {
  sessionId: string;
  workMemId: string;
  modelProfile: ModelProfile;
  instructionState: InstructionState;
  messages: readonly SessionMessage[];
  tools: ToolSchema[];
  compactionPolicy: CompactionPolicy;
  activeCompactionSaveId?: string;
}

/** Resolve Working Set snapshot; under compaction pressure, escalate to compact before message prune. */
export function resolveWorkingSetForCompose(
  input: ResolveWorkingSetForComposeInput,
): ResolvedWorkingSetPort | undefined {
  const ports = getWorkMemAgentPorts();
  const modelId = input.modelProfile.logicalModelId;
  const systemBase = buildSystemFromInstructionState(input.instructionState);

  let resolved = ports.resolveWorkingSetSnapshot({
    sessionId: input.sessionId,
    workMemId: input.workMemId,
    contextWindow: input.modelProfile.contextWindow,
  });

  const systemWithSnapshot = appendWorkingSetToSystem(systemBase, resolved.text);
  const overThreshold = compactionThresholdExceeded(
    input.messages,
    systemWithSnapshot,
    input.tools,
    modelId,
    input.modelProfile,
    input.compactionPolicy,
    input.activeCompactionSaveId,
  );

  if (overThreshold && stageRank(resolved.stage) < stageRank("refined_at_normal")) {
    resolved = ports.resolveWorkingSetSnapshot({
      sessionId: input.sessionId,
      workMemId: input.workMemId,
      contextWindow: input.modelProfile.contextWindow,
      minStage: "refined_at_normal",
    });
  }

  return resolved;
}
