import { getWorkdir } from "../config.js";
import { composeContext } from "@moontide/context-composer";
import type { CompactionPolicy } from "@moontide/context-composer";
import type { ComposedContext } from "@moontide/context-composer";
import type { SessionStores } from "@moontide/session/stores";
import { resolveModelProfile } from "@moontide/llm/models";
import { lookupModelEntry } from "@moontide/llm/models";
import type { ModelProfile } from "@moontide/llm/models";
import { isDeepThinkingBump } from "@moontide/llm";
import { resolveInstructionState } from "../instruction-state/index.js";
import type { ToolSchema } from "@moontide/llm/protocol";
import type { Session } from "@moontide/session";
import { getActiveWorkMemId, getDeepTaskGoal, isDeepModeEnabled } from "./deep-mode.js";
import { resolveWorkingSetForCompose } from "./working-set-compose.js";
import { composePortsFromConfig } from "./compose-options.js";

export interface ComposeForSessionInput {
  session: Session;
  stores: SessionStores;
  turn: number;
  toolDefinitions: ToolSchema[];
  compactionPolicy: CompactionPolicy;
  resumeFromCheckpointId?: string;
  activeCompactionSaveId?: string;
  /** Override system prompt (e.g. compact preview). */
  systemPrompt?: string;
  /** Override model profile (e.g. compaction preview / tests). */
  modelProfile?: ModelProfile;
}

/** Shared compose entry for AgentRun and compaction preview paths. */
export async function composeForSession(input: ComposeForSessionInput): Promise<ComposedContext> {
  const instructionState = input.systemPrompt
    ? { basePrompt: input.systemPrompt, epoch: 1 }
    : resolveInstructionState(getWorkdir());

  const modelProfile = input.modelProfile ?? resolveModelProfile();
  let workingSetSnapshot: string | undefined;
  let deepTask: { goal: string; workMemId: string; thinkingBump?: boolean } | undefined;

  if (isDeepModeEnabled()) {
    const workMemId = getActiveWorkMemId(input.session.sessionId);
    const goal = getDeepTaskGoal(input.session.sessionId);
    if (workMemId && goal) {
      const entry = lookupModelEntry(modelProfile.logicalModelId);
      const thinkingBump = isDeepThinkingBump({ entry, deepMode: true });
      deepTask = {
        goal,
        workMemId,
        thinkingBump: thinkingBump || undefined,
      };
      const resolved = resolveWorkingSetForCompose({
        sessionId: input.session.sessionId,
        workMemId,
        modelProfile,
        instructionState,
        messages: input.session.getMessages(),
        tools: input.toolDefinitions,
        compactionPolicy: input.compactionPolicy,
        activeCompactionSaveId: input.activeCompactionSaveId,
      });
      workingSetSnapshot = resolved?.text;
    }
  }

  return composeContext({
    sessionId: input.session.sessionId,
    turn: input.turn,
    messages: input.session.getMessages(),
    instructionState,
    artifactStore: input.stores.artifacts,
    compactionStore: input.stores.compaction,
    checkpointStore: input.stores.checkpoints,
    toolDefinitions: input.toolDefinitions,
    modelProfile,
    compactionPolicy: input.compactionPolicy,
    resumeFromCheckpointId: input.resumeFromCheckpointId,
    activeCompactionSaveId: input.activeCompactionSaveId,
    workingSetSnapshot,
    deepTask,
    ...composePortsFromConfig(getWorkdir()),
  });
}
