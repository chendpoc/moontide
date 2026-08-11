import type { CompactionPolicy } from "@moontide/context-composer";
import { shouldCompactDialogue } from "@moontide/context-composer";
import {
  buildSystemFromInstructionState,
  appendWorkingSetToSystem,
  type InstructionState,
} from "@moontide/context-composer";
import { budgetConfigFromEnv } from "./compose-options.js";
import type { ModelProfile } from "@moontide/llm/models";
import type { ToolSchema } from "@moontide/llm/protocol";
import { messagesFromContext } from "@moontide/session";
import type { SessionMessage } from "@moontide/session";

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

function dialogueCompactionThresholdExceeded(
  messages: readonly SessionMessage[],
  system: string,
  tools: ToolSchema[],
  modelProfile: ModelProfile,
  policy: CompactionPolicy,
  activeCompactionSaveId?: string,
): boolean {
  if (!policy.autoEnabled || activeCompactionSaveId || messages.length === 0) {
    return false;
  }
  const protocolMessages = messagesFromContext({ messages });
  return shouldCompactDialogue({
    modelProfile,
    system,
    tools,
    messages: protocolMessages,
    thresholdPercent: policy.thresholdPercent,
    budget: budgetConfigFromEnv(),
  });
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
  const systemBase = buildSystemFromInstructionState(input.instructionState);

  let resolved = ports.resolveWorkingSetSnapshot({
    sessionId: input.sessionId,
    workMemId: input.workMemId,
    contextWindow: input.modelProfile.contextWindow,
  });

  const systemWithSnapshot = appendWorkingSetToSystem(systemBase, resolved.text);
  const overThreshold = dialogueCompactionThresholdExceeded(
    input.messages,
    systemWithSnapshot,
    input.tools,
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
